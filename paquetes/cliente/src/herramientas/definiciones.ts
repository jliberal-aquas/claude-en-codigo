import type Anthropic from "@anthropic-ai/sdk";

/**
 * Las herramientas que tu programa le ofrece al modelo. Aquí solo se
 * describen: el modelo lee el nombre, la descripción y el esquema, y
 * con eso decide qué pedir. Quien las ejecuta es `ejecutar.ts`, en tu
 * máquina.
 */

/** Los géneros de `heredado/rubrica.md`, sección 6. */
export const GENEROS = [
  "realismo",
  "policial",
  "fantasía urbana",
  "ciencia ficción",
  "romance",
  "otro",
] as const;

export type Genero = (typeof GENEROS)[number];

export const buscarManuscrito: Anthropic.Tool = {
  name: "buscar_manuscrito",
  description: [
    "Busca manuscritos de la convocatoria cuyo título, autoría o",
    "texto contengan una palabra o frase, sin distinguir mayúsculas",
    "ni tildes. Devuelve una lista con id (ms-001…), título y autoría",
    "de cada coincidencia; no devuelve el texto, el género ni la",
    "ficha. Úsala cuando no conoces el id, por ejemplo «¿hay cuentos",
    "con una llave?». No la uses si la pregunta ya trae un id como",
    "ms-004: para eso está leer_ficha. Una lista vacía significa que",
    "ningún manuscrito contiene ese texto, no que la búsqueda falló.",
  ].join(" "),
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      texto: {
        type: "string",
        description: "Palabra o frase a buscar, de 1 a 80 caracteres.",
      },
    },
    required: ["texto"],
    additionalProperties: false,
  },
};

export const leerFicha: Anthropic.Tool = {
  name: "leer_ficha",
  description: [
    "Lee la ficha de un manuscrito cuyo id ya conoces. Devuelve id,",
    "título, autoría y el género registrado, o null si nadie lo",
    "registró todavía. Úsala para preguntas sobre un manuscrito",
    "concreto, como «¿qué dice la ficha de ms-004?». No la uses para",
    "buscar por palabras: si no conoces el id, usa antes",
    "buscar_manuscrito. Si el id no existe, devuelve un error de",
    "validación.",
  ].join(" "),
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Id del manuscrito: ms- y tres cifras (ms-004).",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
};

export const registrarGenero: Anthropic.Tool = {
  name: "registrar_genero",
  description: [
    "Registra el género de un manuscrito, con una frase del texto",
    "que lo respalde. Devuelve el registro guardado. Úsala solo",
    "cuando te pidan clasificar o anotar un género. No la uses para",
    "cambiar un género ya registrado: eso lo decide una persona, y",
    "la herramienta lo rechaza con un error de negocio.",
  ].join(" "),
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Id del manuscrito: ms- y tres cifras (ms-004).",
      },
      genero: {
        type: "string",
        enum: [...GENEROS],
        description: "Uno de los géneros de la rúbrica.",
      },
      motivo: {
        type: "string",
        description: "Una frase copiada del manuscrito.",
      },
    },
    required: ["id", "genero", "motivo"],
    additionalProperties: false,
  },
};

/** Lo que viaja en el campo `tools` de cada petición. */
export const HERRAMIENTAS: Anthropic.Tool[] = [
  buscarManuscrito,
  leerFicha,
  registrarGenero,
];
