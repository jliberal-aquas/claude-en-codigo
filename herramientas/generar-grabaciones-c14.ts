import { mkdir, writeFile } from "node:fs/promises";

/**
 * Herramienta del editor, fuera del recorrido del lector: escribe las
 * grabaciones `bucle-*.json` del capítulo 14. Son grabaciones de
 * varios turnos: cada letra es la respuesta de un turno (`a` el
 * primero, `b` el segundo…). Cada una es una respuesta sintética con
 * la forma documentada de la API: primero un bloque `thinking` con el
 * campo vacío (como en los capítulos anteriores), después texto y, si
 * pide herramientas, bloques `tool_use`. Las redactó este libro; no
 * salieron de ninguna llamada. Lo que el modelo "decide" en ellas es
 * una decisión del libro, no una prueba de lo que hace Claude:
 *   bucle-ficha-a..d:  ficha ms-010 en cuatro turnos; el primero trae
 *                      texto y un pedido a la vez
 *   bucle-repite-a:    pide lo mismo; repetida, imita un modelo que
 *                      insiste para siempre
 *   bucle-corta-a..c:  el tercer turno llega a max_tokens
 *   bucle-niega-a..b:  el segundo turno es una negativa (refusal)
 * Lo que dicen los turnos coincide con lo que devuelve el despachador
 * real del capítulo 11 con los manuscritos de la herencia.
 *
 * Uso: npx tsx herramientas/generar-grabaciones-c14.ts
 */
const CARPETA = new URL("../fixtures/", import.meta.url);

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: object };

type Motivo = "tool_use" | "end_turn" | "max_tokens" | "refusal";

interface Grabacion {
  nombre: string;
  bloques: Bloque[];
  /** Si falta, `tool_use` cuando hay pedidos y `end_turn` si no. */
  motivo?: Motivo;
  tokensEntrada: number;
  tokensSalida: number;
}

const texto = (t: string): Bloque => ({ type: "text", text: t });
const pide = (id: string, name: string, input: object): Bloque => ({
  type: "tool_use",
  id,
  name,
  input,
});

const MOTIVO_MS010 =
  "Artículo 1. Los vecinos del edificio se comprometen a convivir " +
  "en paz.";

const GRABACIONES: Grabacion[] = [
  {
    nombre: "bucle-ficha-a",
    tokensEntrada: 1520,
    tokensSalida: 58,
    bloques: [
      texto("Primero leo la ficha de ms-010."),
      pide("toolu_sintetico_b1", "leer_ficha", { id: "ms-010" }),
    ],
  },
  {
    nombre: "bucle-ficha-b",
    tokensEntrada: 1641,
    tokensSalida: 61,
    bloques: [
      texto("Busco en el catálogo otros textos que ocurran en un edificio."),
      pide("toolu_sintetico_b2", "buscar_manuscrito", {
        texto: "edificio",
      }),
    ],
  },
  {
    nombre: "bucle-ficha-c",
    tokensEntrada: 1797,
    tokensSalida: 74,
    bloques: [
      pide("toolu_sintetico_b3", "registrar_genero", {
        id: "ms-010",
        genero: "otro",
        motivo: MOTIVO_MS010,
      }),
    ],
  },
  {
    nombre: "bucle-ficha-d",
    tokensEntrada: 1912,
    tokensSalida: 121,
    bloques: [
      texto(
        "Fiché ms-010, «Reglamento de convivencia del edificio», de " +
          "Nora Aldunate (autora sintética), como «otro»: es humor con " +
          "forma de reglamento. En el catálogo solo ms-008, «El eco " +
          "del cuarto piso», también ocurre en un edificio. Propuesta: " +
          "que siga a lectura de una persona.",
      ),
    ],
  },
  {
    nombre: "bucle-repite-a",
    tokensEntrada: 1533,
    tokensSalida: 39,
    bloques: [
      pide("toolu_sintetico_r1", "buscar_manuscrito", {
        texto: "reglamento",
      }),
    ],
  },
  {
    nombre: "bucle-corta-a",
    tokensEntrada: 1520,
    tokensSalida: 58,
    bloques: [
      texto("Primero leo la ficha de ms-010."),
      pide("toolu_sintetico_c1", "leer_ficha", { id: "ms-010" }),
    ],
  },
  {
    nombre: "bucle-corta-b",
    tokensEntrada: 1641,
    tokensSalida: 74,
    bloques: [
      pide("toolu_sintetico_c2", "registrar_genero", {
        id: "ms-010",
        genero: "otro",
        motivo: MOTIVO_MS010,
      }),
    ],
  },
  {
    nombre: "bucle-corta-c",
    motivo: "max_tokens",
    tokensEntrada: 1756,
    tokensSalida: 2000,
    bloques: [
      texto(
        "Fiché ms-010 como «otro». Propuesta: que siga a lectura de " +
          "una persona, porque",
      ),
    ],
  },
  {
    nombre: "bucle-niega-a",
    tokensEntrada: 1520,
    tokensSalida: 58,
    bloques: [
      texto("Primero leo la ficha de ms-010."),
      pide("toolu_sintetico_n1", "leer_ficha", { id: "ms-010" }),
    ],
  },
  {
    nombre: "bucle-niega-b",
    motivo: "refusal",
    tokensEntrada: 1641,
    tokensSalida: 12,
    bloques: [],
  },
];

await mkdir(CARPETA, { recursive: true });

for (const g of GRABACIONES) {
  const sufijo = g.nombre.replaceAll("-", "_");
  const pideHerramienta = g.bloques.some((b) => b.type === "tool_use");
  const respuesta = {
    _sintetico: true,
    model: "claude-opus-5-5",
    id: `msg_sintetico_${sufijo}`,
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", signature: "firma-sintetica" },
      ...g.bloques,
    ],
    stop_reason: g.motivo ?? (pideHerramienta ? "tool_use" : "end_turn"),
    stop_sequence: null,
    stop_details: null,
    // Los números de uso también son inventados, como el texto.
    usage: {
      input_tokens: g.tokensEntrada,
      output_tokens: g.tokensSalida,
    },
    _request_id: `req_sintetico_${sufijo}`,
  };
  const destino = new URL(`${g.nombre}.json`, CARPETA);
  await writeFile(destino, JSON.stringify(respuesta, null, 2) + "\n");
}

console.log(`Grabaciones sintéticas escritas: ${GRABACIONES.length}.`);
