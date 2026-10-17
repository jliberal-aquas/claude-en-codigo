import type { EstadoFichas } from "../types/index.js";

/**
 * La parte del mod que no toca la API de mods: decide si una ficha
 * se ve válida y resume la carpeta. Es una revisión de forma, más
 * liviana que el hook de configuración que valida contra el esquema y
 * las citas: el módulo de hooks no tiene Node, así que no puede
 * importar el validador de `paquetes/extractor`.
 */

const CAMPOS = [
  "titulo",
  "firma",
  "genero",
  "genero_detalle",
  "resumen",
  "premios",
  "editorial_previa",
  "notas_del_autor",
  "confianza",
] as const;

const GENEROS = [
  "realismo",
  "policial",
  "fantasía urbana",
  "ciencia ficción",
  "romance",
  "otro",
];

const CONFIANZAS = ["alta", "media", "baja"];

/** El motivo por el que la ficha no sirve, o `null` si se ve bien. */
export function motivoInvalida(texto: string): string | null {
  let dato: unknown;
  try {
    dato = JSON.parse(texto);
  } catch {
    return "no es JSON";
  }
  if (typeof dato !== "object" || dato === null) {
    return "no es un objeto";
  }
  const ficha = dato as Record<string, unknown>;
  const falta = CAMPOS.find((campo) => !(campo in ficha));
  if (falta !== undefined) return `falta ${falta}`;
  if (!GENEROS.includes(String(ficha["genero"]))) {
    return "género fuera de la lista";
  }
  if (!CONFIANZAS.includes(String(ficha["confianza"]))) {
    return "confianza fuera de la lista";
  }
  return null;
}

/**
 * Cruza la entrada con las fichas: válidas, inválidas (con su id) y
 * pendientes (manuscritos sin ficha). `fichas` va de id a texto.
 */
export function resumir(
  manuscritos: string[],
  fichas: Map<string, string>,
): EstadoFichas {
  const invalidas: string[] = [];
  let validas = 0;
  for (const [id, texto] of fichas) {
    if (motivoInvalida(texto) === null) validas += 1;
    else invalidas.push(id);
  }
  const pendientes = manuscritos.filter((id) => !fichas.has(id));
  return {
    validas,
    invalidas: invalidas.sort(),
    pendientes: pendientes.sort(),
  };
}

/** `ms-004.md` y `ms-004.json` dan `ms-004`; lo demás, `null`. */
export function idDe(nombre: string, extension: string): string | null {
  const m = /^(ms-\d{3})\.(\w+)$/.exec(nombre);
  return m !== null && m[2] === extension ? (m[1] ?? null) : null;
}
