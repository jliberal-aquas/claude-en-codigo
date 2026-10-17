import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

/**
 * Revisa las instrucciones en capas de este repositorio: el
 * `CLAUDE.md` de la raíz con sus imports y las reglas de
 * `.claude/rules/` con su frontmatter. Imita lo que la documentación
 * de Claude Code describe; no es Claude Code. Solo mira el
 * repositorio: lo de tu carpeta personal no viaja por Git. Lo que una
 * sesión cargó de verdad lo dice `/context`.
 *
 * Uso: npm run capas -- [archivo que Claude tocaría] ...
 * Sale con 1 si una regla no parsea o si un import no existe.
 */

/** La documentación admite hasta cuatro saltos de imports. */
const MAX_SALTOS = 4;
const RAIZ = process.cwd();

export interface Regla {
  archivo: string;
  /** `null`: la regla no tiene `paths` y se carga al arrancar. */
  paths: string[] | null;
  /** El error del YAML, si el frontmatter no parsea. */
  error?: string;
  /** Campos distintos de `paths`: Claude Code los ignora. */
  ignorados: string[];
}

/** Lee el frontmatter de una regla: el YAML entre dos `---`. */
export function leerRegla(archivo: string, texto: string): Regla {
  const sin: Regla = { archivo, paths: null, ignorados: [] };
  if (!texto.startsWith("---\n")) return sin;
  const fin = texto.indexOf("\n---", 3);
  if (fin === -1) return sin;

  let datos: unknown;
  try {
    datos = parse(texto.slice(4, fin + 1));
  } catch (e) {
    // Aquí es una falla. Qué hace Claude Code con un frontmatter
    // así lo dice su documentación, no este programa.
    const motivo = e instanceof Error ? e.message : String(e);
    return { ...sin, error: motivo.split("\n")[0] ?? motivo };
  }
  if (typeof datos !== "object" || datos === null) return sin;

  const { paths, ...resto } = datos as Record<string, unknown>;
  const ignorados = Object.keys(resto);
  if (Array.isArray(paths)) {
    return { archivo, paths: paths.map(String), ignorados };
  }
  if (typeof paths === "string") {
    // También vale una cadena con patrones separados por comas.
    const lista = paths.split(",").map((p) => p.trim());
    return { archivo, paths: lista.filter((p) => p !== ""), ignorados };
  }
  return { ...sin, ignorados };
}

/**
 * Los imports `@ruta` de un texto. Como Claude Code, salta los bloques
 * y los fragmentos de código; también los comentarios HTML, que no
 * llegan al contexto.
 */
export function importsDe(texto: string): string[] {
  const limpio = texto
    .replace(/`{3}[\s\S]*?`{3}/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  return [...limpio.matchAll(/(?:^|\s)@(\S+)/g)].map((m) => m[1] ?? "");
}

/** `landing/x.astro`, siempre con `/`, relativo a la raíz. */
function relativa(ruta: string): string {
  return path.relative(RAIZ, ruta).split(path.sep).join("/");
}

async function esArchivo(ruta: string): Promise<boolean> {
  try {
    return (await stat(ruta)).isFile();
  } catch {
    return false;
  }
}

async function listarReglas(): Promise<string[]> {
  const carpeta = path.join(RAIZ, ".claude", "rules");
  try {
    const entradas = await readdir(carpeta, {
      recursive: true,
      withFileTypes: true,
    });
    return entradas
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => path.join(e.parentPath, e.name))
      .sort();
  } catch {
    return [];
  }
}

interface Informe {
  lineas: string[];
  fallas: string[];
}

/** Anota un archivo y, con sangría, lo que importa, salto a salto. */
async function conImports(
  archivo: string,
  salto: number,
  informe: Informe,
): Promise<void> {
  const sangria = "  ".repeat(salto + 1);
  const texto = await readFile(archivo, "utf8");
  for (const ref of importsDe(texto)) {
    // Una ruta relativa parte del archivo que importa, no de la raíz.
    const destino = path.resolve(path.dirname(archivo), ref);
    const nombre = `${sangria}  + ${relativa(destino)} (import)`;
    if (salto + 1 > MAX_SALTOS) {
      informe.lineas.push(`${nombre}: más de ${MAX_SALTOS} saltos`);
    } else if (!(await esArchivo(destino))) {
      informe.lineas.push(`${nombre}: NO EXISTE`);
      informe.fallas.push(`import roto: @${ref}`);
    } else {
      informe.lineas.push(nombre);
      await conImports(destino, salto + 1, informe);
    }
  }
}

/** Lo que entra al arrancar y lo que entra al tocar cada archivo. */
export async function revisar(tocados: string[]): Promise<Informe> {
  const informe: Informe = { lineas: ["Al arrancar:"], fallas: [] };
  const enRaiz = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];
  for (const nombre of enRaiz) {
    const archivo = path.join(RAIZ, nombre);
    if (!(await esArchivo(archivo))) continue;
    informe.lineas.push(`  ${nombre}`);
    await conImports(archivo, 0, informe);
  }

  const reglas: Regla[] = [];
  for (const archivo of await listarReglas()) {
    reglas.push(leerRegla(archivo, await readFile(archivo, "utf8")));
  }
  for (const r of reglas) {
    const nombre = relativa(r.archivo);
    if (r.error !== undefined) {
      informe.lineas.push(`  ${nombre}: FRONTMATTER NO PARSEA`);
      informe.lineas.push(`  ${r.error}`);
      informe.fallas.push(`${nombre}: frontmatter que no parsea`);
    } else if (r.paths === null) {
      informe.lineas.push(`  ${nombre} (sin paths)`);
    }
    if (r.ignorados.length > 0) {
      const campos = r.ignorados.join(", ");
      informe.lineas.push(`  ${nombre}: se ignoran ${campos}`);
    }
  }
  if (informe.lineas.length === 1) informe.lineas.push("  (nada)");

  for (const tocado of tocados) {
    const rel = relativa(path.resolve(RAIZ, tocado));
    informe.lineas.push(`Al tocar ${rel}:`);
    const antes = informe.lineas.length;
    for (const r of reglas) {
      const coincide = r.paths?.some((p) => path.matchesGlob(rel, p));
      if (coincide) informe.lineas.push(`  + ${relativa(r.archivo)}`);
    }
    // Los CLAUDE.md de las subcarpetas que hay entre la raíz y el
    // archivo se cargan a demanda, al leer o editar algo en ellas.
    const carpetas = path.posix.dirname(rel).split("/");
    for (let i = 1; i <= carpetas.length; i++) {
      const sub = carpetas.slice(0, i).join("/");
      if (sub === ".") continue;
      if (await esArchivo(path.join(RAIZ, sub, "CLAUDE.md"))) {
        informe.lineas.push(`  + ${sub}/CLAUDE.md (de subcarpeta)`);
      }
    }
    if (informe.lineas.length === antes) {
      informe.lineas.push("  (nada nuevo)");
    }
  }
  return informe;
}

// Solo corre como programa si lo invocas directamente.
const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  const informe = await revisar(process.argv.slice(2));
  console.log(informe.lineas.join("\n"));
  if (informe.fallas.length > 0) {
    console.log(`fallas: ${informe.fallas.length}`);
    process.exitCode = 1;
  } else {
    console.log("fallas: 0");
  }
}
