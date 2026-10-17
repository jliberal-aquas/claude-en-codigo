import type { Base, Criterio, Herramienta } from "./criterios.js";

/**
 * Lo que el triage sabe de un caso. No lo escribe el modelo: lo
 * escriben las herramientas al terminar. La compuerta decide mirando
 * esto, no lo que el modelo diga que hizo.
 */

/** Un caso de la convocatoria, tal como llega (sintético). */
export interface Caso {
  id: string;
  /** Id del manuscrito, como `ms-002`. */
  manuscrito: string;
  autor: string;
  /** Fecha de llegada, AAAA-MM-DD. */
  recibido: string;
  /** El mensaje del autor: texto no confiable. */
  mensaje: string;
  /** La ficha que propuso el extractor para este manuscrito. */
  ficha: unknown;
  /** Qué decidiría la editorial: lo usa la medición, no el modelo. */
  esperado: Salida;
}

export type Salida = "aceptar" | "rechazar" | "aclarar" | "escalar";

/** El resultado de validar la ficha, si ya se validó. */
export type Validacion =
  | { ok: true; genero: string; editorialPrevia: boolean }
  | { ok: false; motivo: string };

/** El papel para la fundadora: se entiende sin la conversación. */
export interface Traspaso {
  caso: string;
  manuscrito: string;
  autor: string;
  criterio: Criterio;
  /** La regla escrita que se cumplió, copiada de `CRITERIOS`. */
  regla: string;
  /** Estado de la ficha: válida, no pasa o sin validar. */
  ficha: string;
  /** La cita del mensaje o el dato que lo prueba. */
  evidencia: string;
  /** Lo que el triage ya hizo, en orden. Lo escribe el código. */
  yaHecho: string[];
  /** Lo que haría el triage si pudiera, y por qué no puede. */
  recomendacion: string;
}

export interface Cierre {
  salida: Salida;
  /** Lo que se le dice al autor, o la base que se aplicó. */
  detalle: string;
  base?: Base;
  traspaso?: Traspaso;
}

export interface Expediente {
  caso: Caso;
  leido: boolean;
  ficha: Validacion | null;
  /** Herramientas que corrieron, en orden, con su resultado. */
  hecho: string[];
  cierre: Cierre | null;
}

export function nuevoExpediente(caso: Caso): Expediente {
  return { caso, leido: false, ficha: null, hecho: [], cierre: null };
}

/** La ficha en una línea, para el traspaso. */
export function estadoFicha(exp: Expediente): string {
  if (exp.ficha === null) return "sin validar";
  return exp.ficha.ok
    ? `válida (${exp.ficha.genero})`
    : `no pasa: ${exp.ficha.motivo}`;
}

/** Una entrada de la bitácora de la compuerta. */
export interface Paso {
  caso: string;
  herramienta: Herramienta | string;
  permitir: boolean;
  motivo?: string;
}
