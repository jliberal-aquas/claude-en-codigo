import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * La única lectura de `manuscritos/fichas/`. El servidor la llama en
 * cada petición: no guarda copias que envejezcan.
 */

/** Lo mínimo que el catálogo exige de una ficha; el resto viaja tal
 * cual, con la forma que le dio el esquema del capítulo 12. */
export interface Ficha {
  id: string;
  titulo: string;
  genero: string | null;
  [campo: string]: unknown;
}

export interface Catalogo {
  fichas: Ficha[];
  /** Archivos que no se pudieron leer como ficha: no se sirven. */
  ilegibles: string[];
}

/**
 * La carpeta se resuelve desde este archivo, no desde el directorio
 * de trabajo: así da igual desde dónde lance el servidor quien lo use.
 * `FICHAS_DIR` la cambia, para probar con otra carpeta.
 */
export function carpetaFichas(
  entorno: NodeJS.ProcessEnv = process.env,
): string {
  const propia = entorno["FICHAS_DIR"];
  if (propia !== undefined && propia !== "") return propia;
  return fileURLToPath(
    new URL("../../../manuscritos/fichas/", import.meta.url),
  );
}

export async function leerCatalogo(dir: string): Promise<Catalogo> {
  const nombres = (await readdir(dir))
    .filter((n) => n.endsWith(".json"))
    .sort(); // mismo orden en cualquier máquina
  const fichas: Ficha[] = [];
  const ilegibles: string[] = [];
  for (const nombre of nombres) {
    const ficha = aFicha(await readFile(join(dir, nombre), "utf8"));
    if (ficha === null) ilegibles.push(nombre);
    else fichas.push(ficha);
  }
  return { fichas, ilegibles };
}

/** Acepta solo lo que trae `id` y `titulo` de texto; `genero` puede
 * ser `null`: anulable, para no inventar uno. */
function aFicha(texto: string): Ficha | null {
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof valor !== "object" || valor === null) return null;
  const v = valor as Record<string, unknown>;
  const genero = v["genero"];
  if (
    typeof v["id"] !== "string" ||
    typeof v["titulo"] !== "string" ||
    (typeof genero !== "string" && genero !== null)
  ) {
    return null;
  }
  return { ...v, id: v["id"], titulo: v["titulo"], genero };
}
