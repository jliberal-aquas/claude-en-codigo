import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * Prueba de caracterización de la landing: fija lo que el sitio
 * construido hace HOY, defectos incluidos, antes de cambiar nada. Lee
 * el HTML de `dist/`, el que recibe quien visita el sitio; por eso
 * `npm test` construye primero (`pretest` en package.json).
 */

export interface Pagina {
  titulo: string;
  descripcion: string;
  /** Cada enlace como "destino texto", en el orden de la página. */
  enlaces: string[];
  /** El texto alternativo de cada imagen, en orden. */
  alts: string[];
}

const DIST = new URL("../dist/", import.meta.url);

/** Quita etiquetas y junta espacios: el texto que lee una persona. */
function textoPlano(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Extrae de una página construida lo que esta prueba fija. */
export async function leerPagina(ruta: string): Promise<Pagina> {
  const html = await readFile(new URL(ruta, DIST), "utf8");
  const titulo = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1];
  const descripcion =
    /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
  const enlaces = [
    ...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g),
  ].map((m) => `${m[1]} ${textoPlano(m[2] ?? "")}`);
  // Una imagen sin el atributo se distingue de una con alt="".
  const alts = [...html.matchAll(/<img\b[^>]*>/g)].map(
    (m) => /\balt="([^"]*)"/.exec(m[0])?.[1] ?? "(sin alt)",
  );
  return {
    titulo: titulo ?? "(sin título)",
    descripcion: descripcion ?? "(sin descripción)",
    enlaces,
    alts,
  };
}

const CASA =
  "Ediciones del Patio, una editorial pequeña de cuentos, " +
  "cómics y recetas.";

/** Los cuatro enlaces de la cabecera, iguales en todas las páginas. */
const CABECERA = [
  "/editorial-web/ Ediciones del Patio",
  "/editorial-web/ Inicio",
  "/editorial-web/libro/ El libro",
  "/editorial-web/sofia/ Sofía",
];

/** Lo que la landing hacía al heredarla, copiado de `dist/`. */
const HOY: Record<string, Pagina> = {
  "index.html": {
    titulo: "Ediciones del Patio",
    descripcion: CASA,
    enlaces: [
      ...CABECERA,
      // Arreglado a propósito (antes, "/libro …", sin camino base).
      "/editorial-web/libro/ Conoce el primer libro",
      "/editorial-web/libro/cuento/ Leer el primer cuento",
      "/editorial-web/sofia/ Más sobre Sofía",
    ],
    alts: [
      // Arreglado a propósito (antes, "": alt vacío).
      "Portada del libro: una puerta azul en un muro blanco",
      "Portada de La puerta azul",
    ],
  },
  "libro/index.html": {
    titulo: "La puerta azul | Ediciones del Patio",
    descripcion:
      "La puerta azul, el primer libro de Ediciones del Patio.",
    enlaces: [
      ...CABECERA,
      "/editorial-web/sofia/ Conócela",
      "/editorial-web/ Volver al inicio",
    ],
    alts: [
      "Portada de La puerta azul: una puerta azul en un muro blanco",
    ],
  },
  "sofia/index.html": {
    titulo: "Sofía | Ediciones del Patio",
    descripcion: CASA,
    enlaces: [...CABECERA, "/editorial-web/libro/ Ver su libro"],
    alts: [],
  },
  "404.html": {
    titulo: "Página no encontrada",
    descripcion: CASA,
    enlaces: [...CABECERA, "/editorial-web/ Ir al inicio"],
    alts: [],
  },
};

for (const [ruta, esperado] of Object.entries(HOY)) {
  test(`caracterización: ${ruta}`, async () => {
    assert.deepEqual(await leerPagina(ruta), esperado);
  });
}

/**
 * Reglas: lo que la landing DEBE hacer, no lo que hacía. Se escriben
 * antes del arreglo y nacen en rojo con los dos defectos puestos.
 */
const CAMINO_BASE = "/editorial-web/";

for (const ruta of Object.keys(HOY)) {
  test(`reglas: ${ruta}`, async () => {
    const pagina = await leerPagina(ruta);
    const sinBase = pagina.enlaces.filter(
      (e) => e.startsWith("/") && !e.startsWith(CAMINO_BASE),
    );
    assert.deepEqual(sinBase, [], "enlace interno sin camino base");
    assert.ok(!pagina.alts.includes(""), "imagen con alt vacío");
  });
}
