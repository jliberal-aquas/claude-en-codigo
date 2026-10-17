import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Comprueba `docs/mapa-landing.md` contra el código de `landing/src/`.
 * Un mapa escrito por Claude Code es una afirmación sobre el código:
 * este programa la contrasta, entrada por entrada, con el disco.
 *
 * Cada entrada del mapa empieza con un encabezado `### `ruta`` y
 * puede traer dos tipos de línea que se comprueban:
 *   Contiene: `texto`, `otro texto`
 *   Lo usan: `pages/index.astro`, `pages/404.astro`
 * Lo que va entre comillas invertidas es una afirmación; el resto
 * del texto se lee, pero no se comprueba.
 */

export interface Entrada {
  /** Línea del encabezado, para que el aviso diga dónde corregir. */
  linea: number;
  /** Ruta relativa a `landing/src/`, como `pages/index.astro`. */
  archivo: string;
  /** Textos que deben aparecer tal cual dentro del archivo. */
  contiene: string[];
  /** Archivos que deben importarlo por su nombre. */
  loUsan: string[];
}

/** Lo que va entre comillas invertidas en una línea. */
function citas(linea: string): string[] {
  return [...linea.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
}

export function leerEntradas(mapa: string): Entrada[] {
  const entradas: Entrada[] = [];
  let actual: Entrada | undefined;
  mapa.split("\n").forEach((texto, i) => {
    if (texto.startsWith("#")) {
      // Un encabezado `### `ruta`` abre una entrada; cualquier otro
      // encabezado la cierra.
      const ruta = texto.startsWith("### ")
        ? citas(texto)[0]
        : undefined;
      actual = ruta === undefined
        ? undefined
        : { linea: i + 1, archivo: ruta, contiene: [], loUsan: [] };
      if (actual) entradas.push(actual);
      return;
    }
    if (!actual) return;
    if (texto.startsWith("Contiene:")) {
      actual.contiene.push(...citas(texto));
    } else if (texto.startsWith("Lo usan:")) {
      actual.loUsan.push(...citas(texto));
    }
  });
  return entradas;
}

/** El texto del archivo, o `undefined` si no existe. */
async function leer(ruta: string): Promise<string | undefined> {
  try {
    return await readFile(ruta, "utf8");
  } catch {
    return undefined;
  }
}

export async function comprobar(
  entradas: Entrada[],
  raiz: string,
): Promise<string[]> {
  const diferencias: string[] = [];
  // Un mapa sin entradas no afirma nada y pasaría todas las reglas:
  // se rechaza, para que un mapa mal escrito no parezca correcto.
  if (entradas.length === 0) {
    diferencias.push("el mapa no tiene entradas ### `ruta`");
  }
  for (const e of entradas) {
    const donde = `línea ${e.linea}`;
    const codigo = await leer(join(raiz, e.archivo));

    // Regla 1: el archivo existe.
    if (codigo === undefined) {
      diferencias.push(`${donde}: no existe ${e.archivo}`);
      continue;
    }

    // Regla 2: cada texto citado aparece tal cual en el archivo.
    for (const texto of e.contiene) {
      if (!codigo.includes(texto)) {
        diferencias.push(
          `${donde}: ${texto} no aparece en ${e.archivo}`,
        );
      }
    }

    // Regla 3: cada archivo que «lo usa» lo importa por su nombre,
    // como en `from "../components/Pie.astro"`.
    const nombre = basename(e.archivo);
    for (const usuario of e.loUsan) {
      const suyo = await leer(join(raiz, usuario));
      if (suyo === undefined) {
        diferencias.push(`${donde}: no existe ${usuario}`);
      } else if (!suyo.includes(`/${nombre}"`)) {
        diferencias.push(`${donde}: ${usuario} no importa ${nombre}`);
      }
    }
  }
  return diferencias;
}

// Solo corre como programa si lo invocas directamente.
const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  const rutaMapa = process.argv[2] ?? "docs/mapa-landing.md";
  const raiz = process.argv[3] ?? "landing/src";
  const entradas = leerEntradas(await readFile(rutaMapa, "utf8"));
  const diferencias = await comprobar(entradas, raiz);
  for (const d of diferencias) console.log(d);
  console.log(
    `entradas: ${entradas.length}, diferencias: ${diferencias.length}`,
  );
  // Código de salida distinto de 0: un script o una CI se detienen.
  process.exitCode = diferencias.length === 0 ? 0 : 1;
}
