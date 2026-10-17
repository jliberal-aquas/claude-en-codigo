import type { Caso } from "./expediente.js";
import type { Informe } from "./triage.js";

/**
 * La medición de una corrida del triage. La tasa de resolución dice
 * cuántos casos cerró el sistema sin una persona; sola engaña, porque
 * sube si el triage acepta lo que debía escalar. Por eso va junto a
 * los escalamientos que faltaron y los que sobraron, contra lo que la
 * editorial decidiría (`esperado`, sintético).
 */

export interface Medicion {
  total: number;
  /** Aceptados o rechazados: cerrados sin una persona. */
  resueltos: number;
  escalados: number;
  aclaraciones: number;
  abiertos: number;
  /** resueltos / total, entre 0 y 1. */
  tasaResolucion: number;
  /** Debían escalar y no escalaron. */
  faltaron: string[];
  /** Escalaron sin que la editorial lo pidiera. */
  sobraron: string[];
  resumen: string;
}

/** 0,375 -> "37,5 %": coma decimal, como el resto del libro. */
const pct = (x: number) =>
  `${String(Math.round(x * 1000) / 10).replace(".", ",")} %`;

export function medir(
  informes: Informe[],
  casos: Map<string, Caso>,
): Medicion {
  const cuenta = (s: Informe["salida"]) =>
    informes.filter((i) => i.salida === s).length;
  const resueltos = cuenta("aceptar") + cuenta("rechazar");
  const total = informes.length;
  const esperado = (i: Informe) => casos.get(i.caso)?.esperado;
  const faltaron = informes
    .filter((i) => esperado(i) === "escalar" && i.salida !== "escalar")
    .map((i) => i.caso);
  const sobraron = informes
    .filter((i) => i.salida === "escalar" && esperado(i) !== "escalar")
    .map((i) => i.caso);
  const tasaResolucion = total === 0 ? 0 : resueltos / total;
  const m = {
    total,
    resueltos,
    escalados: cuenta("escalar"),
    aclaraciones: cuenta("aclarar"),
    abiertos: cuenta("abierto"),
    tasaResolucion,
    faltaron,
    sobraron,
  };
  const resumen = [
    `casos=${total} resueltos=${resueltos} escalados=${m.escalados} ` +
      `aclaraciones=${m.aclaraciones} abiertos=${m.abiertos}`,
    `tasa de resolución: ${pct(tasaResolucion)}`,
    `escalamientos que faltaron: ${faltaron.join(", ") || "ninguno"}`,
    `escalamientos que sobraron: ${sobraron.join(", ") || "ninguno"}`,
  ].join("\n");
  return { ...m, resumen };
}
