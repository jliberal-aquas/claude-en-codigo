import { mkdir, writeFile } from "node:fs/promises";

/**
 * Herramienta del editor, fuera del recorrido del lector: escribe las
 * grabaciones `herr-*.json` del capítulo 11. Cada una es una respuesta
 * sintética con la forma documentada de la API: primero un bloque
 * `thinking` con el campo vacío (como en los capítulos 1 a 5), después
 * texto y, si pide herramientas, bloques `tool_use` con `id`, `name` e
 * `input`, y `stop_reason: "tool_use"`. Las redactó este libro; no
 * salieron de ninguna llamada. Lo que el modelo "elige" en ellas es
 * una decisión del libro, no una prueba de lo que hace Claude:
 *   herr-terror-a/b:   busca "terror" y contesta con la lista vacía
 *   herr-ficha-a/b:    con descripciones mínimas, elige mal la
 *                      herramienta (busca en vez de leer la ficha)
 *   herr-ficha-c/d:    con descripciones reparadas, lee la ficha
 *   herr-paralelo-a/b: pide dos fichas en la misma respuesta
 * Lo que dicen las vueltas (b y d) coincide con lo que devuelve el
 * despachador real con los manuscritos de la herencia.
 *
 * Uso: npx tsx herramientas/generar-grabaciones-c11.ts
 */
const CARPETA = new URL("../fixtures/", import.meta.url);

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: object };

interface Grabacion {
  nombre: string;
  bloques: Bloque[];
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

const GRABACIONES: Grabacion[] = [
  {
    nombre: "herr-terror-a",
    tokensEntrada: 1342,
    tokensSalida: 61,
    bloques: [
      texto("Lo busco en los manuscritos de la convocatoria."),
      pide("toolu_sintetico_t1", "buscar_manuscrito", {
        texto: "terror",
      }),
    ],
  },
  {
    nombre: "herr-terror-b",
    tokensEntrada: 1431,
    tokensSalida: 88,
    bloques: [
      texto(
        "Ningún manuscrito contiene la palabra «terror». Eso no dice " +
          "cuántos son de terror: la búsqueda solo mira palabras, " +
          "ningún manuscrito tiene género registrado y «terror» no " +
          "está entre los géneros de la rúbrica.",
      ),
    ],
  },
  {
    nombre: "herr-ficha-a",
    tokensEntrada: 498,
    tokensSalida: 44,
    bloques: [
      pide("toolu_sintetico_f1", "buscar_manuscrito", {
        texto: "ficha ms-004",
      }),
    ],
  },
  {
    nombre: "herr-ficha-b",
    tokensEntrada: 571,
    tokensSalida: 37,
    bloques: [
      texto(
        "No encontré ninguna ficha de ms-004. Puede que todavía no " +
          "se haya cargado.",
      ),
    ],
  },
  {
    nombre: "herr-ficha-c",
    tokensEntrada: 1347,
    tokensSalida: 41,
    bloques: [
      pide("toolu_sintetico_f2", "leer_ficha", { id: "ms-004" }),
    ],
  },
  {
    nombre: "herr-ficha-d",
    tokensEntrada: 1436,
    tokensSalida: 52,
    bloques: [
      texto(
        "ms-004 es «La llave sobrante», de Rosa Cienfuegos (autora " +
          "sintética). Todavía no tiene género registrado.",
      ),
    ],
  },
  {
    nombre: "herr-paralelo-a",
    tokensEntrada: 1349,
    tokensSalida: 83,
    bloques: [
      texto("Leo las dos fichas."),
      pide("toolu_sintetico_p1", "leer_ficha", { id: "ms-004" }),
      pide("toolu_sintetico_p2", "leer_ficha", { id: "ms-007" }),
    ],
  },
  {
    nombre: "herr-paralelo-b",
    tokensEntrada: 1528,
    tokensSalida: 79,
    bloques: [
      texto(
        "ms-004 es «La llave sobrante», de Rosa Cienfuegos, y " +
          "ms-007, " +
          "«La sopa de los martes», de Tomás Ibarra. Ninguno tiene " +
          "género registrado: por ahora solo puedo comparar título y " +
          "autoría.",
      ),
    ],
  },
];

await mkdir(CARPETA, { recursive: true });

for (const g of GRABACIONES) {
  const sufijo = g.nombre.replace("herr-", "").replace("-", "_");
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
    stop_reason: pideHerramienta ? "tool_use" : "end_turn",
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
