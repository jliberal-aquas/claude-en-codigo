/**
 * Las reglas escritas del triage de la convocatoria. Son de la
 * editorial (sintéticas: las redactó este libro con la fundadora), no
 * de Anthropic. Un caso llega a la fundadora solo si cumple un
 * criterio de esta lista, con su evidencia. El tono del autor y la
 * confianza que declara una ficha no están: no son criterios.
 */

/** De dónde sale la evidencia de un criterio. */
export type Evidencia =
  | "cita" // una frase copiada, letra por letra, del mensaje
  | "dato"; // un campo que el código ya comprobó

export const CRITERIOS = {
  pide_persona: {
    evidencia: "cita",
    regla: "El autor pide hablar con una persona.",
  },
  fuera_de_alcance: {
    evidencia: "cita",
    regla:
      "Pide algo que el triage no decide: contratos, derechos, " +
      "pagos o fechas de publicación.",
  },
  genero_otro: {
    evidencia: "dato",
    regla:
      "La ficha validada dice «otro»: las bases no dicen qué " +
      "hacer con ese manuscrito.",
  },
  ficha_invalida: {
    evidencia: "dato",
    regla: "La ficha no pasa la validación: no hay con qué decidir.",
  },
} as const satisfies Record<
  string,
  { evidencia: Evidencia; regla: string }
>;

export type Criterio = keyof typeof CRITERIOS;

/** Los nombres, en el formato que piden Zod y la compuerta. */
export const NOMBRES_CRITERIOS = Object.keys(CRITERIOS) as [
  Criterio,
  ...Criterio[],
];

/** Fecha de cierre de la convocatoria (sintética). */
export const CIERRE = "2026-08-31";

/** Las bases que permiten rechazar sin una persona. */
export const BASES = {
  plazo: `Se reciben manuscritos hasta el ${CIERRE}.`,
  inedito: "Solo se reciben manuscritos inéditos.",
} as const;

export type Base = keyof typeof BASES;

export const NOMBRES_BASES = Object.keys(BASES) as [Base, ...Base[]];

/**
 * El límite de alcance: lo único que el triage hace. Todo pedido que
 * caiga fuera (un contrato, un pago, una fecha de publicación) no se
 * resuelve ni se promete: se escala con `fuera_de_alcance`.
 */
export const ALCANCE = [
  "leer_caso",
  "validar_ficha",
  "aceptar",
  "rechazar",
  "pedir_aclaracion",
  "escalar",
] as const;

export type Herramienta = (typeof ALCANCE)[number];

/** Las que cierran un caso: una por caso, nunca dos. */
export const SALIDAS: readonly Herramienta[] = [
  "aceptar",
  "rechazar",
  "pedir_aclaracion",
  "escalar",
];
