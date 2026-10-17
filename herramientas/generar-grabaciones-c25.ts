import { writeFile } from "node:fs/promises";

/**
 * Herramienta del editor, fuera del recorrido del lector: escribe las
 * salidas sintéticas de `claude -p --output-format json` que usa el
 * capítulo 25 en `fixtures/revision/`. Las redactó este libro; no
 * salieron de ninguna llamada. La documentación nombra `result`,
 * `session_id`, `structured_output` y `total_cost_usd`, pero no
 * publica el objeto completo: estas grabaciones solo llevan esos.
 *   pase1-viernes:          dos hallazgos críticos sobre viernes.diff
 *   pase2-viernes:          el segundo pase confirma los dos
 *   pase2-refuta:           refuta el primero y calla el segundo
 *   pase2-vacio:            nada que confirmar
 *   pase1-texto:            texto libre, sin structured_output
 *   pase1-fuera-de-esquema: severidad inventada y sin evidencia
 * `sin-credencial.json` no sale de aquí: es la salida real de
 * `claude -p --bare` sin clave en la máquina del libro.
 *
 * Uso: npx tsx herramientas/generar-grabaciones-c25.ts
 */
const CARPETA = new URL("../fixtures/revision/", import.meta.url);

function salida(result: string, estructurada?: object): object {
  return {
    _sintetico: true,
    type: "result",
    result,
    session_id: "sintetico-revision",
    total_cost_usd: 0.08,
    ...(estructurada === undefined
      ? {}
      : { structured_output: estructurada }),
  };
}

const enlace = {
  archivo: "landing/src/pages/index.astro",
  linea: 27,
  severidad: "critica",
  regla: "enlace-interno",
  evidencia:
    "+        <Boton href={`${base}/libro/cuento/`}>" +
    "Leer el primer cuento</Boton>",
  explicacion: "lleva a /libro/cuento/, y src/pages no tiene esa página",
};

const prueba = {
  archivo: "landing/pruebas/caracterizacion.test.ts",
  linea: 70,
  severidad: "critica",
  regla: "prueba-ajustada",
  evidencia:
    '+      "/editorial-web/libro/cuento/ Leer el primer cuento",',
  explicacion:
    "la prueba cambia en el mismo diff que el enlace: ya no lo vigila",
};

const grabaciones: Record<string, object> = {
  "pase1-viernes": salida("Dos hallazgos críticos.", {
    hallazgos: [enlace, prueba],
  }),
  "pase2-viernes": salida("Los dos se sostienen.", {
    confirmaciones: [
      {
        indice: 0,
        confirmado: true,
        motivo: "no existe src/pages/libro/cuento",
      },
      {
        indice: 1,
        confirmado: true,
        motivo: "la expectativa sigue al código, no al sitio",
      },
    ],
  }),
  "pase1-texto": salida(
    "Revisé el diff. Hay un problema crítico: el botón «Leer el " +
      "primer cuento» lleva a /editorial-web/libro/cuento/, que no " +
      "existe.",
  ),
  "pase1-fuera-de-esquema": salida("Un hallazgo.", {
    hallazgos: [
      {
        archivo: "landing/src/pages/index.astro",
        linea: 27,
        severidad: "alta",
        regla: "enlace-interno",
        explicacion: "el botón da 404",
      },
    ],
  }),
  "pase2-refuta": salida("El primero no se sostiene.", {
    confirmaciones: [
      {
        indice: 0,
        confirmado: false,
        motivo: "src/pages/libro/cuento.astro existe",
      },
    ],
  }),
  "pase2-vacio": salida("No hay hallazgos que confirmar.", {
    confirmaciones: [],
  }),
};

for (const [nombre, contenido] of Object.entries(grabaciones)) {
  const texto = JSON.stringify(contenido, null, 2) + "\n";
  await writeFile(new URL(`${nombre}.json`, CARPETA), texto);
  console.log(`escrita fixtures/revision/${nombre}.json`);
}
