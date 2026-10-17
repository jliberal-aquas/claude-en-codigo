import { mkdir, writeFile } from "node:fs/promises";

/**
 * Herramienta del editor, fuera del recorrido del lector: escribe las
 * cuatro grabaciones de `ms-009` que la herencia trae en `fixtures/`.
 * Cada una es una respuesta sintética que redactó este libro: no salió
 * de ninguna llamada. La `a` responde a la instrucción v2 ampliada con
 * "datos de la autora"; la `b`, la `c` y la `d` responden a la v3. La
 * `d` falla a propósito, para que el verificador tenga algo que
 * encontrar. Los contadores de `usage` van en cero: una cifra de
 * tokens grabada sería una cifra inventada.
 *
 * Uso: npx tsx herramientas/generar-grabaciones-c03.ts
 */
const CARPETA = new URL("../fixtures/", import.meta.url);

interface Grabacion {
  letra: string;
  lineas: string[];
}

const GRABACIONES: Grabacion[] = [
  {
    letra: "a",
    lineas: [
      "<ficha>",
      "Género: realismo",
      "Hechos:",
      "- Clara Ibáñez cruza gente por el río Tolmo en la balsa " +
        "La Paciente.",
      "- Una creciente amenaza a los veintitrés habitantes de la isla.",
      "- Su hermana Marta debe decidir sobre la oferta de la " +
        "provincia.",
      "Autora: obtuvo el premio regional de cuento en 2019.",
      "</ficha>",
    ],
  },
  {
    letra: "b",
    lineas: [
      "<ficha>",
      "Género: realismo",
      "Hechos:",
      "- Clara hereda la balsa de su padre. " +
        "«Clara, la menor, se quedó con La Paciente.»",
      "- En la isla viven 23 personas. " +
        "«Veintitrés personas viven en Isla Menor»",
      "- La provincia ofrece comprar el cruce. " +
        "«Dieciocho mil pesos por la concesión del cruce y el " +
        "desmontaje del cable»",
      "- Hay que evacuar la isla en tres viajes. " +
        "«23 personas, 8 por viaje, 3 viajes»",
      "Autora: no consta en el manuscrito.",
      "</ficha>",
    ],
  },
  {
    letra: "c",
    lineas: [
      "<ficha>",
      "Género: realismo",
      "Hechos:",
      "- Clara tiene treinta y siete años. " +
        "«Tenía treinta y siete años, Clara»",
      "- Telmo Pardo trabaja para el ministerio. " +
        "«Telmo Pardo, agrimensor, del ministerio de obras»",
      "- El puente tiene un costo previsto. " +
        "«Costaría ciento ochenta millones.»",
      "- Año de nacimiento de la autora: no consta en el manuscrito.",
      "Autora: no consta en el manuscrito.",
      "</ficha>",
    ],
  },
  {
    letra: "d",
    lineas: [
      "<ficha>",
      "Género: realismo",
      "Hechos:",
      "- Clara tiene treinta y ocho años. " +
        "«Tenía treinta y ocho años, Clara»",
      "- La balsa se hunde en la creciente.",
      "- Telmo Pardo es agrimensor. " +
        "«Telmo Pardo, agrimensor, del ministerio de obras»",
      "Autora: no consta en el manuscrito.",
      "</ficha>",
    ],
  },
];

await mkdir(CARPETA, { recursive: true });
for (const g of GRABACIONES) {
  const respuesta = {
    _sintetico: true,
    model: "claude-opus-5-5",
    id: `msg_sintetico_009${g.letra}`,
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", signature: "firma-sintetica" },
      { type: "text", text: g.lineas.join("\n") },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    _request_id: `req_sintetico_009${g.letra}`,
  };
  await writeFile(
    new URL(`ms-009-${g.letra}.json`, CARPETA),
    `${JSON.stringify(respuesta, null, 2)}\n`,
  );
}
console.log(`${GRABACIONES.length} grabaciones escritas.`);
