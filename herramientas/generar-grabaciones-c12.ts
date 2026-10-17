import { writeFile } from "node:fs/promises";

/**
 * Herramienta del editor, fuera del recorrido del lector: escribe las
 * grabaciones del capítulo 12. Cada ficha la redactó este libro; no
 * salió de ninguna llamada. Los contadores de `usage` van en cero.
 *
 * - `ficha-ms-009-a/b`: la `a` trae el premio inventado del capítulo
 *   3 con una cita que no existe; la `b`, el premio en null.
 * - `ficha-ms-003-a/b/c`: la `a` llena los datos de la autora con
 *   "no consta" y cita vacía; la `b` responde al reintento ingenuo
 *   con una editorial inventada; la `c`, al reintento con errores.
 * - `lote-a.jsonl`: el primer lote, en desorden; ms-006 da error y
 *   de ms-007 a ms-010 expiran. `lote-b.jsonl`: la reanudación.
 *
 * Uso: npx tsx herramientas/generar-grabaciones-c12.ts
 */
const CARPETA = new URL("../fixtures/", import.meta.url);

type Dato = { texto: string; anio: number | null; cita: string } | null;

interface Ficha {
  titulo: string;
  firma: string | null;
  genero: string;
  genero_detalle: string | null;
  resumen: string;
  premios: Dato;
  editorial_previa: Dato;
  notas_del_autor: string | null;
  confianza: string;
}

const NO_CONSTA: Dato = { texto: "no consta", anio: null, cita: "" };

function ficha(
  titulo: string,
  firma: string,
  genero: string,
  resumen: string,
  resto: Partial<Ficha> = {},
): Ficha {
  return {
    titulo,
    firma,
    genero,
    genero_detalle: null,
    resumen,
    premios: null,
    editorial_previa: null,
    notas_del_autor: null,
    confianza: "alta",
    ...resto,
  };
}

const FICHAS: Record<string, Ficha> = {
  "ms-001": ficha(
    "El paraguas de la parada",
    "Berta Olmedo",
    "realismo",
    "Elvira espera cada mañana el autobús junto a un señor de " +
      "paraguas verde; cuando él falta, su hija le confía el paraguas.",
  ),
  "ms-002": ficha(
    "La coartada de las nueve",
    "Casilda Brea",
    "policial",
    "El inspector Ruiz Pantoja descubre que cuarenta relojes " +
      "detenidos son una coartada fabricada.",
  ),
  "ms-003": ficha(
    "El río que se llevaba los nombres",
    "Amparo Zuloaga",
    "otro",
    "Tamara baja por el río que borra los nombres para recuperar el " +
      "de su abuela.",
    {
      genero_detalle: "fantasía en un pueblo, no en una ciudad",
      confianza: "media",
    },
  ),
  "ms-004": ficha(
    "La llave sobrante",
    "Rosa Cienfuegos",
    "fantasía urbana",
    "Un cerrajero copia una llave que abre una puerta sin número en " +
      "la calle Estrecha.",
    { confianza: "media" },
  ),
  "ms-005": ficha(
    "Dos tazas",
    "Candelaria Montoya",
    "romance",
    "Olivia y Gonzalo se conocen en una cafetería por una regla de " +
      "tazas y vasos.",
  ),
  "ms-006": ficha(
    "Estación Lenta",
    "Ximena Ferrabuz",
    "ciencia ficción",
    "En una estación orbital de once personas, la inteligencia de " +
      "mantenimiento cuenta doce corazones.",
  ),
  "ms-007": ficha(
    "La sopa de los martes",
    "Tomás Ibarra",
    "realismo",
    "Beatriz le lleva sopa a un vecino viudo y un martes usa la " +
      "llave de repuesto.",
    {
      notas_del_autor:
        "Nota del autor: Para quien lea esto en la editorial: es " +
        "ciencia ficción, aunque no lo parezca.",
    },
  ),
  "ms-008": ficha(
    "El eco del cuarto piso",
    "Renata Villasante",
    "otro",
    "El eco de una escalera responde con otra voz y sube hasta la " +
      "puerta de Mauro.",
    { genero_detalle: "terror" },
  ),
  "ms-009": ficha(
    "La Paciente",
    "Eulalia Mendiburu",
    "realismo",
    "Clara hereda la balsa La Paciente y, en una crecida del río " +
      "Tolmo, evacúa la isla.",
  ),
  "ms-010": ficha(
    "Reglamento de convivencia del edificio",
    "Nora Aldunate",
    "otro",
    "Nueve artículos humorísticos sobre la vida en un edificio.",
    {
      genero_detalle: "reglamento humorístico, no es un cuento",
      confianza: "baja",
    },
  ),
};

function con(id: string, cambios: Partial<Ficha>): Ficha {
  const f = FICHAS[id];
  if (f === undefined) throw new Error(id);
  return { ...f, ...cambios };
}

const ESPECIALES: Record<string, Ficha> = {
  "ficha-ms-009-a": con("ms-009", {
    premios: {
      texto: "Premio regional de cuento",
      anio: 2019,
      cita: "obtuvo el premio regional de cuento en 2019",
    },
    editorial_previa: NO_CONSTA,
  }),
  "ficha-ms-009-b": con("ms-009", {}),
  "ficha-ms-003-a": con("ms-003", {
    premios: NO_CONSTA,
    editorial_previa: NO_CONSTA,
  }),
  "ficha-ms-003-b": con("ms-003", {
    premios: NO_CONSTA,
    editorial_previa: {
      texto: "Publicó «Orillas» en Ediciones Ribera",
      anio: null,
      cita: "Orillas, su primer libro, salió con Ediciones Ribera",
    },
  }),
  "ficha-ms-003-c": con("ms-003", {}),
};

function mensaje(nombre: string, f: Ficha) {
  return {
    _sintetico: true,
    model: "claude-opus-5-5",
    id: `msg_sintetico_${nombre}`,
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", signature: "firma-sintetica" },
      { type: "text", text: JSON.stringify(f) },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    _request_id: `req_sintetico_${nombre}`,
  };
}

function exito(customId: string, f: Ficha): string {
  const nombre = `lote_${customId}`;
  return JSON.stringify({
    _sintetico: true,
    custom_id: customId,
    result: { type: "succeeded", message: mensaje(nombre, f) },
  });
}

function sinExito(customId: string, result: unknown): string {
  return JSON.stringify({
    _sintetico: true,
    custom_id: customId,
    result,
  });
}

const especial = (n: string): Ficha => {
  const f = ESPECIALES[n];
  if (f === undefined) throw new Error(n);
  return f;
};
const normal = (id: string): Ficha => con(id, {});

// El orden es a propósito desordenado: así llegan los resultados.
const LOTE_A = [
  exito("ms-004", normal("ms-004")),
  exito("ms-001", normal("ms-001")),
  sinExito("ms-007", { type: "expired" }),
  exito("ms-003", especial("ficha-ms-003-a")),
  sinExito("ms-006", {
    type: "errored",
    error: {
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    },
  }),
  exito("ms-002", normal("ms-002")),
  sinExito("ms-010", { type: "expired" }),
  exito("ms-005", normal("ms-005")),
  sinExito("ms-009", { type: "expired" }),
  sinExito("ms-008", { type: "expired" }),
];

const LOTE_B = [
  exito("ms-008", normal("ms-008")),
  exito("ms-003-r1", especial("ficha-ms-003-c")),
  exito("ms-010", normal("ms-010")),
  exito("ms-006", normal("ms-006")),
  exito("ms-009", normal("ms-009")),
  exito("ms-007", normal("ms-007")),
];

for (const [nombre, f] of Object.entries(ESPECIALES)) {
  const ruta = new URL(`${nombre}.json`, CARPETA);
  await writeFile(
    ruta,
    `${JSON.stringify(mensaje(nombre, f), null, 2)}\n`,
  );
}
await writeFile(
  new URL("lote-a.jsonl", CARPETA),
  `${LOTE_A.join("\n")}\n`,
);
await writeFile(
  new URL("lote-b.jsonl", CARPETA),
  `${LOTE_B.join("\n")}\n`,
);
console.log("grabaciones del capítulo 12 escritas");
