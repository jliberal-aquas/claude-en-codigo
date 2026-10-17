import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  leerSkills,
  separar,
  type Documento,
} from "./verificar-skills.js";

/**
 * Revisa las definiciones de `.claude/agents/` y las skills que
 * corren en un subagente (`context: fork`). Imita lo que documenta
 * Claude Code; no es Claude Code. Qué delegó una sesión lo dice la
 * sesión.
 *
 * Uso: npm run agentes
 *      npm run agentes -- revisor-ficha "texto del mensaje"
 * La segunda forma muestra, además, lo que ese subagente recibiría
 * al empezar con ese mensaje, y lo que no recibiría.
 *
 * Sale con 1 si un frontmatter no parsea, si falta `name` o
 * `description`, si hay un campo que Claude Code ignoraría en
 * silencio, si un valor no es de los documentados o si un agente que
 * se dice de solo lectura puede escribir.
 */

const RAIZ = process.cwd();
const AGENTES = path.join(RAIZ, ".claude", "agents");

/** Campos de la tabla de la documentación [VERIFICAR AL CIERRE]. */
const CAMPOS = new Set([
  "name", "description", "tools", "disallowedTools", "model",
  "permissionMode", "maxTurns", "skills", "mcpServers", "hooks",
  "memory", "background", "omitClaudeMd", "effort", "isolation",
  "color", "initialPrompt", "experimental",
]);
const MODELOS = new Set([
  "sonnet", "opus", "haiku", "fable", "inherit",
]);
const MODOS = new Set([
  "default", "acceptEdits", "auto", "dontAsk", "bypassPermissions",
  "plan", "manual",
]);
const MEMORIAS = new Set(["user", "project", "local"]);
/** Con cualquiera de estas, el subagente puede cambiar archivos. */
const ESCRIBEN = new Set([
  "Write", "Edit", "NotebookEdit", "Bash", "PowerShell",
]);
/** Subagentes que trae Claude Code y que la documentación nombra. */
const INTEGRADOS = new Set(["Explore", "Plan", "general-purpose"]);

/** Regla de la casa: la descripción dice cuándo delegar. */
const DICE_CUANDO = /(^|[^\p{L}])(cuando|úsal[ao])(?!\p{L})/iu;
const SOLO_LECTURA = /solo lectura/i;

export interface Agente {
  nombre: string;
  archivo: string;
  doc: Documento;
  /** `null`: no hay `tools` y hereda todas las herramientas. */
  herramientas: string[] | null;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * `tools` y `disallowedTools` aceptan una cadena separada por comas
 * o una lista YAML. `Bash(git push *)` cuenta como `Bash`: la
 * documentación dice que un especificador quita la herramienta
 * entera.
 */
export function lista(v: unknown): string[] {
  const crudo = Array.isArray(v) ? v.map(String) : texto(v).split(",");
  return crudo
    .map((h) => h.trim().replace(/\(.*\)$/, ""))
    .filter((h) => h !== "");
}

export function leerAgente(archivo: string, contenido: string): Agente {
  const doc = separar(contenido);
  const d = doc.datos;
  const quitar = new Set(lista(d["disallowedTools"]));
  const propias =
    d["tools"] === undefined
      ? null
      : lista(d["tools"]).filter((h) => !quitar.has(h));
  return {
    nombre: texto(d["name"]) || path.basename(archivo, ".md"),
    archivo,
    doc,
    herramientas: propias,
  };
}

/** Sin `tools` hereda todas, también `Write` y `Edit`. */
export function puedeEscribir(a: Agente): boolean {
  if (a.herramientas === null) return true;
  return a.herramientas.some((h) => ESCRIBEN.has(h));
}

export interface Informe {
  lineas: string[];
  fallas: string[];
}

function fallar(i: Informe, quien: string, motivo: string): void {
  i.lineas.push(`  FALLA: ${motivo}`);
  i.fallas.push(`${quien}: ${motivo}`);
}

export function revisarAgente(a: Agente, i: Informe): void {
  i.lineas.push(`${a.nombre} (${path.relative(RAIZ, a.archivo)})`);
  if (a.doc.error !== undefined) {
    fallar(i, a.nombre, `el frontmatter no parsea: ${a.doc.error}`);
    return;
  }
  const d = a.doc.datos;
  const nombre = texto(d["name"]);
  const descripcion = texto(d["description"]);
  if (nombre === "") fallar(i, a.nombre, "no tiene name");
  if (nombre.includes(":") || nombre.length > 256) {
    fallar(i, a.nombre, "name con «:» o de más de 256 caracteres");
  }
  if (descripcion === "") {
    fallar(i, a.nombre, "no tiene description");
  } else if (!DICE_CUANDO.test(descripcion)) {
    fallar(i, a.nombre, "description no dice cuándo delegar");
  }
  // Claude Code ignora sin avisar un campo que no conoce: un
  // `allowed-tools` o un `Tools` mal escrito deja al subagente con
  // todas las herramientas. Aquí eso no pasa en silencio.
  for (const campo of Object.keys(d)) {
    if (!CAMPOS.has(campo)) {
      fallar(i, a.nombre, `campo ${campo}: Claude Code lo ignoraría`);
    }
  }
  const modelo = texto(d["model"]);
  const conocido = MODELOS.has(modelo) || /^claude-/.test(modelo);
  if (modelo !== "" && !conocido) {
    fallar(i, a.nombre, `model ${modelo} no es de los documentados`);
  }
  const modo = texto(d["permissionMode"]);
  if (modo !== "" && !MODOS.has(modo)) {
    fallar(i, a.nombre, `permissionMode ${modo} no existe`);
  }
  const memoria = texto(d["memory"]);
  if (memoria !== "" && !MEMORIAS.has(memoria)) {
    fallar(i, a.nombre, `memory ${memoria}: usa user, project o local`);
  }

  const h = a.herramientas;
  const nombres = h === null ? "todas (no hay tools)" : h.join(", ");
  i.lineas.push(`  herramientas: ${nombres}`);
  const escribe = puedeEscribir(a);
  i.lineas.push(`  puede escribir: ${escribe ? "sí" : "no"}`);
  if (escribe && SOLO_LECTURA.test(descripcion)) {
    fallar(i, a.nombre, "dice «solo lectura» y puede escribir");
  }
  if (h?.includes("Agent") === true) {
    i.lineas.push("  aviso: con Agent puede lanzar subagentes");
  }
  i.lineas.push(`  modelo: ${modelo || "el de la sesión"}`);
  if (memoria !== "") {
    i.lineas.push(`  memoria entre sesiones: ${memoria}`);
  }
  if (d["background"] === true) {
    i.lineas.push("  corre siempre en segundo plano");
  }

  // El cuerpo es su instrucción de sistema: sin él, el subagente solo
  // tiene el mensaje que le escriban.
  const cuerpo = a.doc.cuerpo.trim();
  if (cuerpo === "") {
    fallar(i, a.nombre, "el cuerpo está vacío");
  } else {
    i.lineas.push(`  instrucción de sistema: ${cuerpo.length} car.`);
    if (!/devuelv/i.test(cuerpo)) {
      i.lineas.push("  aviso: el cuerpo no dice qué devolver");
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

export async function leerAgentes(): Promise<Agente[]> {
  const agentes: Agente[] = [];
  for (const nombre of await listar(AGENTES)) {
    if (!nombre.endsWith(".md")) continue;
    const archivo = path.join(AGENTES, nombre);
    agentes.push(leerAgente(archivo, await readFile(archivo, "utf8")));
  }
  return agentes;
}

/**
 * Una skill con `context: fork` corre en un subagente del tipo de
 * `agent`, con su cuerpo como mensaje y sin tu conversación.
 */
export async function revisarForks(
  nombresAgentes: Set<string>,
  i: Informe,
): Promise<void> {
  const forks = (await leerSkills()).filter(
    (s) => s.doc.datos["context"] === "fork",
  );
  i.lineas.push(`skills con context: fork: ${forks.length}`);
  for (const s of forks) {
    const tipo = texto(s.doc.datos["agent"]);
    i.lineas.push(`${s.nombre} (agent: ${tipo || "sin agent"})`);
    const conocido = INTEGRADOS.has(tipo) || nombresAgentes.has(tipo);
    if (tipo !== "" && !conocido) {
      fallar(i, s.nombre, `agent ${tipo} no existe`);
    }
    // La documentación: con pautas y sin una tarea, el subagente
    // vuelve sin nada útil.
    if (!/^\s*\d+\.\s/m.test(s.doc.cuerpo)) {
      i.lineas.push("  aviso: no tiene pasos; ¿hay una tarea?");
    }
    // Regla de la casa: el subagente trabaja desde su mensaje y
    // devuelve al final; no va y vuelve contigo.
    if (/pregunt/i.test(s.doc.cuerpo)) {
      i.lineas.push("  aviso: pide preguntarte en medio de la tarea");
    }
  }
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rutas que nombra el mensaje. Un `*` en el último tramo se expande
 * contra la carpeta: `manuscritos/fichas/*.json`.
 */
export async function archivosNombrados(
  mensaje: string,
): Promise<{ ruta: string; existe: boolean }[]> {
  const encontrados: { ruta: string; existe: boolean }[] = [];
  for (const m of mensaje.matchAll(/[\w.*-]+(?:\/[\w.*-]+)+/g)) {
    const ruta = m[0].replace(/[.,;:]+$/, "");
    if (!ruta.includes("*")) {
      encontrados.push({ ruta, existe: await existe(ruta) });
      continue;
    }
    const carpeta = path.dirname(ruta);
    const patron = new RegExp(
      "^" + path.basename(ruta).replace(/\./g, "\\.")
        .replace(/\*/g, ".*") + "$",
    );
    for (const f of await listar(path.join(RAIZ, carpeta))) {
      if (patron.test(f)) {
        encontrados.push({ ruta: `${carpeta}/${f}`, existe: true });
      }
    }
  }
  return encontrados;
}

/** CLAUDE.md de la raíz, con sus líneas `@ruta` traídas un nivel. */
async function claudeMd(): Promise<string> {
  const raiz = path.join(RAIZ, "CLAUDE.md");
  if (!(await existe(raiz))) return "";
  const lineas = (await readFile(raiz, "utf8")).split("\n");
  const salida: string[] = [];
  for (const l of lineas) {
    const m = /^@(\S+)$/.exec(l.trim());
    const ruta = m?.[1];
    if (ruta !== undefined && (await existe(ruta))) {
      salida.push((await readFile(ruta, "utf8")).trimEnd());
    } else {
      salida.push(l);
    }
  }
  return salida.join("\n");
}

/**
 * Imita el arranque de un subagente según la documentación: su
 * cuerpo como instrucción de sistema, los CLAUDE.md (salvo
 * `omitClaudeMd`), datos del entorno, sus herramientas y el mensaje
 * de delegación. Nada de tu conversación.
 */
export async function imitarArranque(
  a: Agente,
  mensaje: string,
): Promise<string> {
  const partes: string[] = [];
  partes.push("== instrucción de sistema (su cuerpo)");
  partes.push(a.doc.cuerpo.trim());
  if (a.doc.datos["omitClaudeMd"] === true) {
    partes.push("== CLAUDE.md: no (omitClaudeMd)");
  } else {
    partes.push("== CLAUDE.md (con sus imports)");
    partes.push(await claudeMd());
  }
  partes.push("== entorno");
  partes.push(`directorio de trabajo: ${RAIZ}`);
  partes.push("== herramientas");
  partes.push(a.herramientas?.join(", ") ?? "todas (no hay tools)");
  partes.push("== mensaje de delegación");
  partes.push(mensaje);
  const nombrados = await archivosNombrados(mensaje);
  const faltan = nombrados.filter((n) => !n.existe);
  partes.push("== resumen");
  partes.push(
    `mensaje: ${mensaje.length} car.; ` +
      `archivos que nombra: ${nombrados.length}, ` +
      `que no existen: ${faltan.length}`,
  );
  for (const f of faltan) partes.push(`  no existe: ${f.ruta}`);
  partes.push("no recibe: tu conversación, las skills que invocaste");
  partes.push("  ni los archivos que Claude ya leyó");
  return partes.join("\n");
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  const informe: Informe = { lineas: [], fallas: [] };
  const agentes = await leerAgentes();
  for (const a of agentes) revisarAgente(a, informe);
  await revisarForks(new Set(agentes.map((a) => a.nombre)), informe);
  console.log(informe.lineas.join("\n"));
  console.log(
    `agentes=${agentes.length} fallas=${informe.fallas.length}`,
  );
  process.exitCode = informe.fallas.length > 0 ? 1 : 0;

  const [nombre, ...resto] = process.argv.slice(2);
  if (nombre !== undefined) {
    const elegido = agentes.find((a) => a.nombre === nombre);
    if (elegido === undefined) {
      console.log(`no hay un agente llamado ${nombre}`);
      process.exitCode = 1;
    } else {
      console.log(`\nlo que recibe ${nombre} al empezar (imitación):`);
      console.log(await imitarArranque(elegido, resto.join(" ")));
    }
  }
}
