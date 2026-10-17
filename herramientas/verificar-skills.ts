import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";

/**
 * Revisa las skills de `.claude/skills/` y los archivos de
 * `.claude/output-styles/`. Imita lo que la documentación de Claude
 * Code describe; no es Claude Code. Lo que una sesión cargó lo dicen
 * el menú `/` y `/skill-doctor`.
 *
 * Uso: npm run skills
 *      npm run skills -- ficha-manuscrito ms-004
 * La segunda forma muestra además el cuerpo como lo armaría esa
 * invocación: argumentos sustituidos y comandos `!` ejecutados.
 *
 * Sale con 1 si un frontmatter no parsea, si una skill no dice qué
 * hace y cuándo usarla, si nombra un archivo que no existe o si dos
 * descripciones se parecen tanto que Claude no tendría cómo elegir.
 */

const RAIZ = process.cwd();
const SKILLS = path.join(RAIZ, ".claude", "skills");
const ESTILOS = path.join(RAIZ, ".claude", "output-styles");

/** Lo que entra al listado se corta aquí [VERIFICAR AL CIERRE]. */
const TOPE_LISTADO = 1536;
/** La documentación pide `SKILL.md` de menos de 500 líneas. */
const MAX_LINEAS = 500;
/** Regla de la casa: más parecido que esto es ambiguo. */
const MAX_PARECIDO = 0.5;

/** Campos de la tabla de la documentación; otro da un aviso. */
const CAMPOS_SKILL = new Set([
  "name", "description", "when_to_use", "argument-hint",
  "arguments", "disable-model-invocation", "user-invocable",
  "allowed-tools", "disallowed-tools", "model", "effort",
  "context", "agent", "background", "hooks", "paths", "shell",
  "metadata", "license", "compatibility",
]);
const CAMPOS_ESTILO = new Set([
  "name", "description", "keep-coding-instructions",
  "force-for-plugin",
]);

/**
 * Skills que trae Claude Code y que la documentación nombra; no es
 * la lista completa. Una tuya con el mismo nombre la reemplaza.
 */
const INTEGRADAS = new Set(["code-review", "doctor"]);

/** Regla de la casa: la descripción dice cuándo usarla. */
const DICE_CUANDO = /(^|[^\p{L}])(cuando|úsal[ao]|se usa)(?!\p{L})/iu;

export interface Documento {
  datos: Record<string, unknown>;
  cuerpo: string;
  error?: string;
}

/** Separa el frontmatter (YAML entre dos `---`) del cuerpo. */
export function separar(texto: string): Documento {
  if (!texto.startsWith("---\n")) return { datos: {}, cuerpo: texto };
  const fin = texto.indexOf("\n---", 3);
  if (fin === -1) return { datos: {}, cuerpo: texto };
  const cuerpo = texto.slice(texto.indexOf("\n", fin + 1) + 1);
  try {
    const datos: unknown = parse(texto.slice(4, fin + 1));
    if (typeof datos === "object" && datos !== null) {
      return { datos: datos as Record<string, unknown>, cuerpo };
    }
    return { datos: {}, cuerpo };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    return { datos: {}, cuerpo, error: motivo.split("\n")[0] };
  }
}

export interface Skill {
  /** El comando: `name` o, si falta, el nombre de la carpeta. */
  nombre: string;
  carpeta: string;
  doc: Documento;
  /** Lo que entra siempre: descripción y `when_to_use`. */
  listado: string;
  /** Con `disable-model-invocation: true` ni eso entra. */
  soloManual: boolean;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function leerSkill(carpeta: string, contenido: string): Skill {
  const doc = separar(contenido);
  const d = doc.datos;
  const descripcion = texto(d["description"]);
  // Sin `description`, la documentación usa la primera línea del
  // cuerpo que no esté vacía.
  const primera =
    doc.cuerpo.split("\n").find((l) => l.trim() !== "") ?? "";
  const cuando = texto(d["when_to_use"]);
  const listado = [descripcion || primera.trim(), cuando]
    .filter((t) => t !== "")
    .join(" ");
  return {
    nombre: texto(d["name"]) || path.basename(carpeta),
    carpeta,
    doc,
    listado,
    soloManual: d["disable-model-invocation"] === true,
  };
}

/**
 * Archivos que el cuerpo nombra: enlaces Markdown, rutas entre
 * comillas invertidas y `${CLAUDE_SKILL_DIR}/…`. Una ruta con `$` o
 * `*` depende de los argumentos: no se puede comprobar aquí.
 */
export function rutasNombradas(cuerpo: string): string[] {
  const rutas = new Set<string>();
  for (const m of cuerpo.matchAll(/\]\(([^)\s#]+)\)/g)) {
    if (!/^[a-z]+:/i.test(m[1] ?? "")) rutas.add(m[1] ?? "");
  }
  for (const m of cuerpo.matchAll(/`([\w./-]+\.[a-z]{1,4})`/g)) {
    rutas.add(m[1] ?? "");
  }
  for (const m of cuerpo.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/(\S+)/g)) {
    rutas.add(m[1] ?? "");
  }
  return [...rutas].filter((r) => r !== "" && !/[$*]/.test(r));
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

/** Palabras con contenido, sin tildes ni mayúsculas. */
function palabras(t: string): Set<string> {
  const llano = t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return new Set(llano.match(/\p{L}{4,}/gu) ?? []);
}

/**
 * Palabras en común sobre las de la descripción más corta: una
 * descripción breve contenida en otra larga cuenta como parecida.
 */
export function parecido(a: string, b: string): number {
  const pa = palabras(a);
  const pb = palabras(b);
  const comunes = [...pa].filter((p) => pb.has(p)).length;
  const menor = Math.min(pa.size, pb.size);
  return menor === 0 ? 0 : comunes / menor;
}

export interface Informe {
  lineas: string[];
  fallas: string[];
}

export async function revisarSkill(
  s: Skill,
  informe: Informe,
): Promise<void> {
  const { lineas, fallas } = informe;
  const rel = path.relative(RAIZ, s.carpeta);
  lineas.push(`${s.nombre} (${rel})`);
  if (s.doc.error !== undefined) {
    // La documentación: un frontmatter que no parsea se ignora.
    lineas.push(`  FALLA: el frontmatter no parsea: ${s.doc.error}`);
    fallas.push(`${s.nombre}: frontmatter`);
    return;
  }
  const extra = Object.keys(s.doc.datos).filter(
    (k) => !CAMPOS_SKILL.has(k),
  );
  if (extra.length > 0) {
    lineas.push(`  aviso: campos que no conozco: ${extra.join(", ")}`);
  }
  if (INTEGRADAS.has(s.nombre)) {
    lineas.push(`  aviso: reemplaza a /${s.nombre}, de Claude Code`);
  }

  if (s.soloManual) {
    lineas.push("  siempre: nada (solo la invocas tú)");
  } else {
    lineas.push(`  siempre: ${s.listado.length} car.`);
    if (texto(s.doc.datos["description"]) === "") {
      lineas.push("  FALLA: no tiene description");
      fallas.push(`${s.nombre}: sin description`);
    } else if (!DICE_CUANDO.test(s.listado)) {
      lineas.push("  FALLA: dice qué es, no cuándo usarla");
      fallas.push(`${s.nombre}: descripción sin cuándo`);
    }
    if (s.listado.length > TOPE_LISTADO) {
      lineas.push(`  aviso: el listado la corta en ${TOPE_LISTADO}`);
    }
  }

  const n = s.doc.cuerpo.split("\n").length;
  lineas.push(
    `  al invocarla: ${s.doc.cuerpo.length} car., ${n} líneas`,
  );
  if (n > MAX_LINEAS) {
    lineas.push(`  aviso: más de ${MAX_LINEAS} líneas`);
  }
  const permitidas = s.doc.datos["allowed-tools"];
  if (permitidas !== undefined) {
    const lista = Array.isArray(permitidas)
      ? permitidas.join(" ")
      : String(permitidas);
    lineas.push(`  preaprueba: ${lista}`);
  }

  for (const ruta of rutasNombradas(s.doc.cuerpo)) {
    // Relativa a la carpeta de la skill o, si no, a la raíz.
    const enSkill = path.join(s.carpeta, ruta);
    if (await existe(enSkill)) {
      const tam = (await readFile(enSkill, "utf8")).length;
      lineas.push(`  apoyo, si hace falta: ${ruta} ${tam} car.`);
    } else if (!(await existe(path.join(RAIZ, ruta)))) {
      lineas.push(`  FALLA: nombra ${ruta}, que no existe`);
      fallas.push(`${s.nombre}: ${ruta} no existe`);
    }
  }
}

async function listar(carpeta: string): Promise<string[]> {
  try {
    return (await readdir(carpeta)).sort();
  } catch {
    return [];
  }
}

export async function leerSkills(): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const nombre of await listar(SKILLS)) {
    const archivo = path.join(SKILLS, nombre, "SKILL.md");
    if (!(await existe(archivo))) continue;
    const contenido = await readFile(archivo, "utf8");
    skills.push(leerSkill(path.join(SKILLS, nombre), contenido));
  }
  return skills;
}

/** Dos descripciones parecidas: Claude no tiene cómo elegir. */
export function compararListados(
  skills: Skill[],
  informe: Informe,
): void {
  const visibles = skills.filter((s) => !s.soloManual);
  for (let i = 0; i < visibles.length; i++) {
    for (let j = i + 1; j < visibles.length; j++) {
      const a = visibles[i];
      const b = visibles[j];
      if (a === undefined || b === undefined) continue;
      const p = parecido(a.listado, b.listado);
      if (p > MAX_PARECIDO) {
        const pct = Math.round(p * 100);
        informe.lineas.push(
          `FALLA: ${a.nombre} y ${b.nombre} se parecen (${pct} %)`,
        );
        informe.fallas.push(`${a.nombre} ~ ${b.nombre}`);
      }
    }
  }
}

export async function revisarEstilos(informe: Informe): Promise<void> {
  for (const nombre of await listar(ESTILOS)) {
    if (!nombre.endsWith(".md")) continue;
    const archivo = path.join(ESTILOS, nombre);
    const doc = separar(await readFile(archivo, "utf8"));
    informe.lineas.push(`estilo ${nombre}`);
    if (doc.error !== undefined) {
      informe.lineas.push(`  FALLA: no parsea: ${doc.error}`);
      informe.fallas.push(`${nombre}: frontmatter`);
      continue;
    }
    const extra = Object.keys(doc.datos).filter(
      (k) => !CAMPOS_ESTILO.has(k),
    );
    if (extra.length > 0) {
      informe.lineas.push(`  aviso: campos que no conozco: ${extra}`);
    }
    // Sin esto, el archivo deja fuera las instrucciones de ingeniería
    // de software que trae Claude Code.
    const conserva = doc.datos["keep-coding-instructions"] === true;
    informe.lineas.push(
      conserva
        ? "  conserva las instrucciones de programación"
        : "  aviso: deja fuera las instrucciones de programación",
    );
  }
}

/**
 * Imita una invocación: sustituye `$ARGUMENTS`, `$N` y los nombres
 * de `arguments`, y ejecuta los comandos `!` antes de que Claude lea
 * el texto. Si ningún marcador recibe los argumentos, los agrega al
 * final como `ARGUMENTS: …`, como dice la documentación.
 */
export async function expandir(
  s: Skill,
  args: string[],
): Promise<string> {
  const nombres = s.doc.datos["arguments"];
  const lista = Array.isArray(nombres)
    ? nombres.map(String)
    : texto(nombres).split(/\s+/).filter((x) => x !== "");
  let usado = false;
  const poner = (valor: string) => {
    usado = true;
    return valor;
  };
  let cuerpo = s.doc.cuerpo
    .replace(/\$ARGUMENTS\[(\d+)\]/g, (_, i) => poner(args[+i] ?? ""))
    .replace(/\$ARGUMENTS/g, () => poner(args.join(" ")))
    .replace(/\$(\d+)/g, (_, i) => poner(args[+i] ?? ""))
    .replace(/\$([a-z_]\w*)/gi, (m, n: string) => {
      const i = lista.indexOf(n);
      return i === -1 ? m : poner(args[i] ?? "");
    });
  const ejecutar = promisify(execFile);
  for (const m of [...cuerpo.matchAll(/!`([^`]+)`/g)]) {
    const { stdout } = await ejecutar("bash", ["-c", m[1] ?? ""], {
      cwd: RAIZ,
    });
    cuerpo = cuerpo.replace(m[0], stdout.trimEnd());
  }
  if (!usado && args.length > 0) {
    cuerpo += `\nARGUMENTS: ${args.join(" ")}\n`;
  }
  return cuerpo;
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  const informe: Informe = { lineas: [], fallas: [] };
  const skills = await leerSkills();
  for (const s of skills) await revisarSkill(s, informe);
  compararListados(skills, informe);
  await revisarEstilos(informe);
  console.log(informe.lineas.join("\n"));
  const fallas = informe.fallas.length;
  console.log(`skills=${skills.length} fallas=${fallas}`);
  process.exitCode = informe.fallas.length > 0 ? 1 : 0;

  const [nombre, ...args] = process.argv.slice(2);
  const elegida = skills.find((s) => s.nombre === nombre);
  if (nombre !== undefined && elegida === undefined) {
    console.log(`no hay una skill llamada ${nombre}`);
    process.exitCode = 1;
  } else if (elegida !== undefined) {
    console.log(`\n/${elegida.nombre} ${args.join(" ")}, imitada:`);
    console.log(await expandir(elegida, args));
  }
}
