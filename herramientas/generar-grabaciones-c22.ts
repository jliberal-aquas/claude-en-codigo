import { mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * Herramienta del editor, fuera del recorrido del lector: escribe los
 * ocho casos sintéticos del triage (`fixtures/tri-casos/*.json`) y
 * sus grabaciones de varios turnos (`fixtures/tri-<caso>-a.json`,
 * `-b`…). Cada grabación es una respuesta sintética con la forma
 * documentada de la API: primero un bloque `thinking` con el campo
 * vacío, después texto y, si pide herramientas, bloques `tool_use`
 * con el nombre completo que usa el SDK (`mcp__triage__…`). Las
 * redactó este libro; no salieron de ninguna llamada. Lo que el
 * modelo "decide" en ellas es una decisión del libro, no una prueba
 * de lo que hace Claude:
 *   rutina, enojado: leer, validar, aceptar (enojado: el autor está
 *                    furioso y no cumple ningún criterio)
 *   tranquila:       leer y escalar con pide_persona, sin validar
 *   salta:           leer y aceptar SIN validar (la ficha de ms-009
 *                    trae un premio inventado): el error del lab
 *   otro:            leer, validar (género «otro») y escalar
 *   contrato:        leer y escalar con fuera_de_alcance
 *   ambigua:         leer y pedir una aclaración
 *   tarde:           leer, validar y rechazar por la base plazo
 * Los autores, mensajes y fechas son sintéticos.
 *
 * Uso: npx tsx herramientas/generar-grabaciones-c22.ts
 */
const FIXTURES = new URL("../fixtures/", import.meta.url);
const CASOS = new URL("tri-casos/", FIXTURES);
const FICHAS = new URL("../manuscritos/fichas/", import.meta.url);

type Salida = "aceptar" | "rechazar" | "aclarar" | "escalar";

interface Definicion {
  id: string;
  manuscrito: string;
  recibido: string;
  mensaje: string;
  esperado: Salida;
  /** Cambios a la ficha validada del manuscrito, si los hay. */
  ficha?: Record<string, unknown>;
  /** Pedidos de herramienta, un turno cada uno; después, el cierre. */
  turnos: [string, Record<string, unknown>][];
  cierre: string;
}

const P = "mcp__triage__";

const DEFINICIONES: Definicion[] = [
  {
    id: "rutina",
    manuscrito: "ms-001",
    recibido: "2026-07-02",
    mensaje:
      "Les envío mi cuento «El paraguas de la parada» para la " +
      "convocatoria. Gracias por leerlo.",
    esperado: "aceptar",
    turnos: [
      ["leer_caso", { caso: "rutina" }],
      ["validar_ficha", { caso: "rutina" }],
      [
        "aceptar",
        {
          caso: "rutina",
          nota_al_autor:
            "Gracias. Su cuento cumple las bases y pasa a lectura.",
        },
      ],
    ],
    cierre: "rutina: aceptado a lectura.",
  },
  {
    id: "enojado",
    manuscrito: "ms-002",
    recibido: "2026-08-10",
    mensaje:
      "Mandé mi cuento en agosto y NADIE me contestó. ¿Así tratan a " +
      "quienes escriben? Es una falta de respeto total. Quiero saber " +
      "de una vez si lo van a leer o no.",
    esperado: "aceptar",
    turnos: [
      ["leer_caso", { caso: "enojado" }],
      ["validar_ficha", { caso: "enojado" }],
      [
        "aceptar",
        {
          caso: "enojado",
          nota_al_autor:
            "Lamentamos la demora. Su cuento cumple las bases y pasa " +
            "a lectura de la fundadora. No podemos darle una fecha.",
        },
      ],
    ],
    cierre:
      "enojado: aceptado. El mensaje es duro, pero no cumple ningún " +
      "criterio de escalamiento.",
  },
  {
    id: "tranquila",
    manuscrito: "ms-005",
    recibido: "2026-08-02",
    mensaje:
      "Buenas tardes. Les escribo sin apuro. Antes de seguir, " +
      "¿podría conversar con la fundadora por teléfono? Prefiero " +
      "tratar esto con una persona.",
    esperado: "escalar",
    turnos: [
      ["leer_caso", { caso: "tranquila" }],
      [
        "escalar",
        {
          caso: "tranquila",
          criterio: "pide_persona",
          evidencia:
            "¿podría conversar con la fundadora por teléfono?",
          recomendacion:
            "Llamarla antes de leer el cuento: pide hablar con una " +
            "persona y el triage no hace llamadas.",
        },
      ],
    ],
    cierre: "tranquila: escalado con pide_persona.",
  },
  {
    id: "salta",
    manuscrito: "ms-009",
    recibido: "2026-08-20",
    mensaje: "Adjunto «La Paciente». Es largo, pero se lee rápido.",
    esperado: "escalar",
    ficha: {
      premios: {
        texto: "Premio regional de cuento",
        anio: 2019,
        cita: "obtuvo el premio regional de cuento en 2019",
      },
    },
    turnos: [
      ["leer_caso", { caso: "salta" }],
      [
        "aceptar",
        {
          caso: "salta",
          nota_al_autor:
            "Gracias. Su novela corta pasa a lectura de la fundadora.",
        },
      ],
    ],
    cierre: "salta: ms-009 pasa a lectura.",
  },
  {
    id: "otro",
    manuscrito: "ms-008",
    recibido: "2026-07-28",
    mensaje:
      "Les mando «El eco del cuarto piso». No sé bien qué género es; " +
      "ustedes dirán.",
    esperado: "escalar",
    turnos: [
      ["leer_caso", { caso: "otro" }],
      ["validar_ficha", { caso: "otro" }],
      [
        "escalar",
        {
          caso: "otro",
          criterio: "genero_otro",
          evidencia: "ficha validada con género otro",
          recomendacion:
            "Leerlo y decidir si la convocatoria lo admite: las " +
            "bases no dicen qué hacer con «otro».",
        },
      ],
    ],
    cierre: "otro: escalado con genero_otro.",
  },
  {
    id: "contrato",
    manuscrito: "ms-004",
    recibido: "2026-08-05",
    mensaje:
      "Si aceptan mi cuento, necesito que el contrato me deje los " +
      "derechos audiovisuales. ¿Pueden cambiar esa cláusula antes " +
      "de que lo lean?",
    esperado: "escalar",
    turnos: [
      ["leer_caso", { caso: "contrato" }],
      [
        "escalar",
        {
          caso: "contrato",
          criterio: "fuera_de_alcance",
          evidencia:
            "¿Pueden cambiar esa cláusula antes de que lo lean?",
          recomendacion:
            "Responderle sobre la cláusula: el triage no decide " +
            "contratos ni puede prometer nada sobre derechos.",
        },
      ],
    ],
    cierre: "contrato: escalado con fuera_de_alcance.",
  },
  {
    id: "ambigua",
    manuscrito: "ms-007",
    recibido: "2026-08-11",
    mensaje:
      "Me di cuenta de que la nota del final confunde. ¿La pueden " +
      "sacar?",
    esperado: "aclarar",
    turnos: [
      ["leer_caso", { caso: "ambigua" }],
      [
        "pedir_aclaracion",
        {
          caso: "ambigua",
          pregunta:
            "¿Quiere enviar una versión sin la nota, o que no la " +
            "tengamos en cuenta al leer la que ya mandó?",
        },
      ],
    ],
    cierre: "ambigua: pedí una aclaración.",
  },
  {
    id: "tarde",
    manuscrito: "ms-006",
    recibido: "2026-09-12",
    mensaje:
      "Perdón por la demora: les envío «Estación Lenta». Espero que " +
      "todavía estén a tiempo.",
    esperado: "rechazar",
    turnos: [
      ["leer_caso", { caso: "tarde" }],
      ["validar_ficha", { caso: "tarde" }],
      [
        "rechazar",
        {
          caso: "tarde",
          base: "plazo",
          nota_al_autor:
            "Gracias por escribirnos. La convocatoria cerró el 31 de " +
            "agosto y no podemos recibirlo en esta edición.",
        },
      ],
    ],
    cierre: "tarde: rechazado por la base plazo.",
  },
];

/** Autoría tal como la firma la ficha validada. */
async function fichaDe(ms: string): Promise<Record<string, unknown>> {
  const texto = await readFile(new URL(`${ms}.json`, FICHAS), "utf8");
  return JSON.parse(texto) as Record<string, unknown>;
}

function grabacion(
  sufijo: string,
  bloques: object[],
  motivo: "tool_use" | "end_turn",
  n: number,
): object {
  return {
    _sintetico: true,
    model: "claude-opus-5-5",
    id: `msg_sintetico_${sufijo}`,
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", signature: "firma-sintetica" },
      ...bloques,
    ],
    stop_reason: motivo,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 2100 + 180 * n, output_tokens: 70 },
    _request_id: `req_sintetico_${sufijo}`,
  };
}

await mkdir(CASOS, { recursive: true });
for (const d of DEFINICIONES) {
  const ficha = { ...(await fichaDe(d.manuscrito)), ...d.ficha };
  const caso = {
    _sintetico: true,
    id: d.id,
    manuscrito: d.manuscrito,
    autor: String(ficha["firma"]),
    recibido: d.recibido,
    mensaje: d.mensaje,
    ficha,
    esperado: d.esperado,
  };
  await writeFile(
    new URL(`${d.id}.json`, CASOS),
    `${JSON.stringify(caso, null, 2)}\n`,
  );

  const letras = "abcdefgh";
  const turnos = [...d.turnos.map((t) => t), null];
  for (const [i, t] of turnos.entries()) {
    const letra = letras[i] ?? "z";
    const sufijo = `tri_${d.id}_${letra}`;
    const bloques =
      t === null
        ? [{ type: "text", text: d.cierre }]
        : [
            {
              type: "tool_use",
              id: `toolu_sintetico_${d.id}_${i + 1}`,
              name: P + t[0],
              input: t[1],
            },
          ];
    const motivo = t === null ? "end_turn" : "tool_use";
    await writeFile(
      new URL(`tri-${d.id}-${letra}.json`, FIXTURES),
      `${JSON.stringify(
        grabacion(sufijo, bloques, motivo, i),
        null,
        2,
      )}\n`,
    );
  }
}
console.log(`${DEFINICIONES.length} casos y sus grabaciones escritos.`);
