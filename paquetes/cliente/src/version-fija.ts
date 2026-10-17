import { pathToFileURL } from "node:url";
import { MODELO } from "./llamar.js";
import { RETIROS } from "./precios.js";

const DIA_MS = 86_400_000;

/**
 * Decisión de la editorial, no del fabricante: él promete al menos 60
 * días de aviso [VERIFICAR AL CIERRE]; nosotros pedimos el doble de
 * margen para migrar.
 */
export const MARGEN_PROPIO_DIAS = 120;

export function diasHasta(fecha: string, hoy: Date): number {
  const limite = Date.parse(`${fecha}T00:00:00Z`);
  return Math.floor((limite - hoy.getTime()) / DIA_MS);
}

/** Una línea de resumen por ID de modelo. */
export function revisar(modelo: string, hoy: Date): string {
  const r = RETIROS[modelo];
  if (r === undefined) return `${modelo}: sin fecha en la tabla`;
  const dias = diasHasta(r.fecha, hoy);
  const desde = r.tipo === "fija" ? "el" : "no antes del";
  const migrar =
    dias < MARGEN_PROPIO_DIAS
      ? `; migra a ${r.reemplazo ?? "(sin reemplazo en la tabla)"}`
      : "";
  return `${modelo}: retiro ${desde} ${r.fecha}, ${dias} días${migrar}`;
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  const hoy = new Date(process.argv[2] ?? Date.now());
  console.log(revisar(MODELO, hoy));
  // Un modelo ya deprecado, solo para ver cómo avisa el script.
  console.log(revisar("claude-sonnet-4-5-20250929", hoy));
}
