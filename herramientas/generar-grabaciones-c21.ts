import { writeFile } from "node:fs/promises";

/**
 * Herramienta del editor, fuera del recorrido del lector: escribe las
 * grabaciones `inv-*.json` del capítulo 21. Son grabaciones de varios
 * turnos con la forma documentada de la API: un bloque `thinking` con
 * el campo vacío, texto y, si pide herramientas, bloques `tool_use`.
 * Las redactó este libro; no salieron de ninguna llamada. Lo que el
 * modelo «decide» en ellas es una decisión del libro:
 *   inv-coord-a..c:     el coordinador reparte en tres; una delegación
 *                       sale sin el id, la reescribe, y resume
 *   inv-catalogo-a..c:  busca parecidos en las fichas
 *   inv-largo-a..b:     cuenta palabras y devuelve el formato
 *   inv-largo-libre-a..b: igual, pero termina en texto libre
 *   inv-landing-a..b:   intenta leer landing/, se lo niegan y devuelve
 *                       un error de acceso
 * Los datos de las vueltas coinciden con la herencia: fichas de
 * manuscritos/fichas/ y conteos de contar_palabras.
 *
 * Uso: npx tsx herramientas/generar-grabaciones-c21.ts
 */
const CARPETA = new URL("../fixtures/", import.meta.url);

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: object };

interface Grabacion {
  nombre: string;
  bloques: Bloque[];
  entrada: number;
  salida: number;
}

const texto = (t: string): Bloque => ({ type: "text", text: t });
const pide = (id: string, name: string, input: object): Bloque => ({
  type: "tool_use",
  id,
  name,
  input,
});
/** Un texto final con el bloque ```json que pide el formato. */
const vuelta = (previo: string, obj: object): Bloque =>
  texto(
    `${previo}\n\n\`\`\`json\n` +
      `${JSON.stringify(obj, null, 2)}\n\`\`\``,
  );

const CONTAR = "mcp__investigacion__contar_palabras";

const IDS = Array.from(
  { length: 10 },
  (_, i) => `ms-${String(i + 1).padStart(3, "0")}`,
);

const GRABACIONES: Grabacion[] = [
  {
    nombre: "inv-coord-a",
    entrada: 2100,
    salida: 420,
    bloques: [
      texto("Son tres preguntas independientes: las reparto."),
      pide("toolu_sintetico_inv1", "Agent", {
        description: "Parecidos en el catálogo",
        subagent_type: "investigador",
        prompt:
          "Manuscrito: ms-006, «Estación Lenta», ciencia ficción. " +
          "Pregunta: ¿qué otros manuscritos del catálogo se le " +
          "parecen por género o tema? Mira las fichas de " +
          "manuscritos/fichas/ (genero, genero_detalle y " +
          "notas_del_autor). Devuelve el formato de vuelta.",
      }),
      pide("toolu_sintetico_inv2", "Agent", {
        description: "Largo frente a los demás",
        subagent_type: "investigador",
        prompt:
          "Compara su largo con el de los demás manuscritos de la " +
          "convocatoria y dime si es más largo o más corto.",
      }),
      pide("toolu_sintetico_inv3", "Agent", {
        description: "Tema en la landing",
        subagent_type: "investigador",
        prompt:
          "Manuscrito: ms-006, «Estación Lenta»: una estación " +
          "orbital y una inteligencia de mantenimiento. Pregunta: " +
          "¿la landing de la editorial ya presenta ese tema? Mira " +
          "landing/src/ (páginas y datos). Devuelve el formato de " +
          "vuelta.",
      }),
    ],
  },
  {
    nombre: "inv-coord-b",
    entrada: 2900,
    salida: 180,
    bloques: [
      texto(
        "La delegación del largo no decía qué manuscrito. " +
          "La reescribo.",
      ),
      pide("toolu_sintetico_inv4", "Agent", {
        description: "Largo frente a los demás",
        subagent_type: "investigador",
        prompt:
          "Manuscrito: ms-006 (manuscritos/entrada/ms-006.md). " +
          "Pregunta: ¿qué tan largo es frente a los otros nueve de " +
          "manuscritos/entrada/ (ms-001 a ms-010)? Usa " +
          "contar_palabras con los diez ids. Devuelve el formato " +
          "de vuelta.",
      }),
    ],
  },
  {
    nombre: "inv-coord-c",
    entrada: 4100,
    salida: 120,
    bloques: [
      texto(
        "Estación Lenta es el único cuento de ciencia ficción del " +
          "catálogo, tiene un largo parecido al de los demás y su " +
          "tema no aparece en la landing: no repetiría nada publicado.",
      ),
    ],
  },
  {
    nombre: "inv-catalogo-a",
    entrada: 1800,
    salida: 60,
    bloques: [
      texto("Busco el género y las notas en las fichas."),
      pide("toolu_sintetico_cat1", "Grep", {
        pattern: "ciencia ficción",
        path: "fichas",
        output_mode: "content",
      }),
    ],
  },
  {
    nombre: "inv-catalogo-b",
    entrada: 2600,
    salida: 70,
    bloques: [
      texto("Coinciden dos fichas. Las leo enteras."),
      pide("toolu_sintetico_cat2", "Read", {
        file_path: "fichas/ms-006.json",
      }),
      pide("toolu_sintetico_cat3", "Read", {
        file_path: "fichas/ms-007.json",
      }),
    ],
  },
  {
    nombre: "inv-catalogo-c",
    entrada: 5200,
    salida: 310,
    bloques: [
      vuelta("Listo.", {
        estado: "ok",
        hallazgos: [
          {
            afirmacion:
              "La ficha de ms-006 lo registra como ciencia ficción.",
            fuente: {
              ruta: "manuscritos/fichas/ms-006.json",
              cita: '"genero": "ciencia ficción"',
            },
          },
          {
            afirmacion:
              "Ninguna otra ficha tiene género ciencia ficción.",
            fuente: {
              ruta: "manuscritos/fichas",
              metodo:
                "Grep «ciencia ficción» en las diez fichas: " +
                "coinciden ms-006 (género) y ms-007 (nota)",
            },
          },
          {
            afirmacion: "La ficha de ms-007 lo registra como realismo.",
            clave: "género de ms-007",
            fuente: {
              ruta: "manuscritos/fichas/ms-007.json",
              cita: '"genero": "realismo"',
            },
          },
          {
            afirmacion:
              "El autor de ms-007, «La sopa de los martes», anota " +
              "que es ciencia ficción.",
            clave: "género de ms-007",
            fuente: {
              ruta: "manuscritos/fichas/ms-007.json",
              cita: "es ciencia ficción, aunque no lo parezca",
            },
          },
        ],
      }),
    ],
  },
  {
    nombre: "inv-largo-a",
    entrada: 1700,
    salida: 50,
    bloques: [
      texto("Cuento las palabras de los diez."),
      pide("toolu_sintetico_lar1", CONTAR, { ids: IDS }),
    ],
  },
  {
    nombre: "inv-largo-b",
    entrada: 2100,
    salida: 260,
    bloques: [
      vuelta("Listo.", {
        estado: "ok",
        hallazgos: [
          {
            afirmacion: "ms-006 tiene 400 palabras.",
            fuente: {
              ruta: "manuscritos/entrada/ms-006.md",
              metodo: "contar_palabras",
              valor: 400,
            },
          },
          {
            afirmacion:
              "La mediana de los otros nueve es 384 palabras: " +
              "ms-006 queda en el medio del grupo.",
            fuente: {
              ruta: "manuscritos/entrada",
              metodo: "contar_palabras de los diez; mediana sin ms-006",
            },
          },
          {
            afirmacion:
              "El promedio de los otros nueve, 1.302, no representa " +
              "al grupo: ms-009 solo tiene 8.957 palabras.",
            fuente: {
              ruta: "manuscritos/entrada/ms-009.md",
              metodo: "contar_palabras",
              valor: 8957,
            },
          },
        ],
      }),
    ],
  },
  {
    nombre: "inv-largo-libre-a",
    entrada: 1700,
    salida: 50,
    bloques: [
      texto("Cuento las palabras de los diez."),
      pide("toolu_sintetico_lib1", CONTAR, { ids: IDS }),
    ],
  },
  {
    nombre: "inv-largo-libre-b",
    entrada: 2100,
    salida: 40,
    bloques: [
      texto(
        "Estación Lenta es bastante más corta que el promedio de la " +
          "convocatoria, que ronda las 1.300 palabras.",
      ),
    ],
  },
  {
    nombre: "inv-landing-a",
    entrada: 1750,
    salida: 40,
    bloques: [
      texto("Leo los datos del libro en la landing."),
      pide("toolu_sintetico_lan1", "Read", {
        file_path: "../landing/src/data/libro.ts",
      }),
    ],
  },
  {
    nombre: "inv-landing-b",
    entrada: 1900,
    salida: 150,
    bloques: [
      vuelta("No pude leer la landing.", {
        estado: "error",
        error: {
          tipo: "acceso",
          motivo:
            "Read de ../landing/src/data/libro.ts negado: solo se " +
            "lee dentro de manuscritos/.",
          intentado: ["Read ../landing/src/data/libro.ts"],
          reintentable: false,
          sugerencia:
            "Delegar con lectura en landing/src/ o revisarlo a mano: " +
            "no se sabe si el tema está.",
        },
      }),
    ],
  },
];

for (const g of GRABACIONES) {
  const pideAlgo = g.bloques.some((b) => b.type === "tool_use");
  const respuesta = {
    _sintetico: true,
    // El coordinador, con Opus; los subagentes, con Sonnet.
    model: g.nombre.startsWith("inv-coord")
      ? "claude-opus-5-5"
      : "claude-sonnet-5-5",
    id: `msg_sintetico_${g.nombre.replaceAll("-", "_")}`,
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", signature: "firma-sintetica" },
      ...g.bloques,
    ],
    stop_reason: pideAlgo ? "tool_use" : "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: g.entrada, output_tokens: g.salida },
    _request_id: `req_sintetico_${g.nombre.replaceAll("-", "_")}`,
  };
  await writeFile(
    new URL(`${g.nombre}.json`, CARPETA),
    JSON.stringify(respuesta, null, 2) + "\n",
  );
}
console.log(`${GRABACIONES.length} grabaciones escritas.`);
