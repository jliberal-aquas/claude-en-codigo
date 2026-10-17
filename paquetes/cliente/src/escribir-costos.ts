import { mkdir, writeFile } from "node:fs/promises";
import { cargarPlantilla } from "./armar-peticion.js";
import {
  CONFIGURACIONES,
  SUPUESTOS,
  contra,
  costoTotal,
  tokensDePalabras,
  usd,
  type Supuestos,
} from "./costos.js";
import { MODELO } from "./llamar.js";
import { FECHA_PRECIOS, RETIROS } from "./precios.js";
import { estimar } from "./presupuesto.js";
import { MARGEN_PROPIO_DIAS } from "./version-fija.js";

/**
 * Escribe `docs/costos.md` con la tabla que calcula `costos.ts`. La
 * tabla sale del programa; la decisión que sigue es una propuesta que
 * tú cambias y firmas. Solo da formato: no enseña nada nuevo.
 */
const plantilla = await cargarPlantilla("clasificar.v3");
const s: Supuestos = {
  ...SUPUESTOS,
  prefijo: estimar(plantilla.sistema ?? "").estimacion,
};

const por = (i: number): number => costoTotal(CONFIGURACIONES[i]!, s);
const retiro = RETIROS[MODELO];

const lineas = [
  "# Costos de clasificar la convocatoria",
  "",
  `Estimación con precios a la fecha (${FECHA_PRECIOS})`,
  "`[VERIFICAR AL CIERRE]`. Escenario sintético, no una factura.",
  "",
  "## Supuestos (sintéticos: reemplázalos por medidas)",
  "",
  `- ${s.manuscritos} manuscritos de ${s.palabrasPorManuscrito} ` +
    `palabras (~${tokensDePalabras(s.palabrasPorManuscrito)} tokens).`,
  `- Instrucción fija medida: ~${s.prefijo} tokens.`,
  `- Salida por manuscrito: ${s.salidaVisible} tokens visibles y`,
  `  ${s.razonamiento} de razonamiento.`,
  "- El caché acierta en todas las peticiones menos la primera,",
  "  salvo donde se dice que el prefijo cambia.",
  "",
  "## Tabla de costos.ts",
  "",
  "| Configuración | USD | Frente a la base |",
  "|:--|--:|--:|",
  ...CONFIGURACIONES.map(
    (c, i) =>
      `| ${c.nombre} | ${usd(por(i))} | ${contra(por(i), por(0))} |`,
  ),
  "",
  "## Las situaciones en juego",
  "",
  "- Una autora espera la decisión: Opus 5.5, una petición por vez,",
  `  sin caché, ${usd(por(0))} USD por los 500. Riesgo: es lo más ` +
    "caro; el",
  "  caché de 5 min solo ahorra si llegan más peticiones antes de que",
  "  venza.",
  "- Ráfaga, a menos de 5 min una de otra: Opus 5.5, caché de 5 min,",
  `  ${usd(por(3))} USD. Riesgo: si el prefijo cambia, cuesta más ` +
    "que sin",
  "  caché.",
  "- La convocatoria, de noche: Opus 5.5, lote y caché de 1 h,",
  `  ${usd(por(6))} a ${usd(por(7))} USD. Riesgo: los aciertos de ` +
    "caché en lote no",
  "  están garantizados.",
  `- Económica: Haiku 5.5, lote y caché de 1 h, ${usd(por(8))} USD.`,
  "  Riesgo: calidad sin medir.",
  "",
  "## Decisión (propuesta sintética del libro: cámbiala y fírmala)",
  "",
  "- Convocatoria: nocturna, en lote. Un lote expira si no termina en",
  "  24 horas; la mayoría termina en menos de una. Hasta que exista el",
  "  lote, corre como peticiones directas.",
  "- Rechazo a una autora que espera: una petición por vez, sin caché.",
  "- Haiku 5.5 queda en evaluación hasta que sus fichas pasen los",
  "  casos guardados.",
  "",
  "Firma: ______________  Fecha: ______________",
  "",
  "## Versión fija y migración",
  "",
  `- ID fijado: \`${MODELO}\`, en una sola constante (\`MODELO\`).`,
  `- Retiro: ${retiro?.tipo ?? "?"} ${retiro?.fecha ?? "?"}`,
  "  `[VERIFICAR AL CIERRE]`. La documentación promete al menos 60",
  "  días de aviso.",
  `- Margen propio: empezar a migrar ${MARGEN_PROPIO_DIAS} días ` +
    "antes de",
  "  cualquier fecha de retiro (`npm run version-fija`).",
  "- Antes de cambiar el ID: volver a contar tokens con el modelo",
  "  nuevo, leer sus cambios incompatibles, repetir `npm run costos`",
  "  y pasar los casos guardados.",
  "",
];

await mkdir("docs", { recursive: true });
await writeFile("docs/costos.md", lineas.join("\n"));
console.log(`escrito docs/costos.md (${lineas.length - 1} líneas)`);
