import { z } from "zod";

/**
 * Lo que un subagente devuelve al coordinador. No es texto libre: es
 * un objeto que dice qué encontró y de dónde salió cada cosa, o qué
 * falló, qué intentó y si vale la pena reintentar. El coordinador no
 * le cree a un párrafo; le cree a una fuente que puede abrir.
 */

/** De dónde salió una afirmación: un archivo y cómo se sabe. */
export const FuenteSchema = z
  .object({
    /** Relativa a la raíz del repositorio. */
    ruta: z.string().min(1),
    /** Copiada letra por letra del archivo. */
    cita: z.string().min(1).optional(),
    /** Cómo se obtuvo, si no hay cita: "contar_palabras", "Grep…". */
    metodo: z.string().min(1).optional(),
    /** El número medido, si el método mide algo. */
    valor: z.number().optional(),
    /** Fecha de la fuente, si la tiene: ante un conflicto, se ve. */
    fecha: z.string().optional(),
  })
  .refine((f) => f.cita !== undefined || f.metodo !== undefined, {
    message: "una fuente necesita una cita o un método",
  });

export const HallazgoSchema = z.object({
  afirmacion: z.string().min(1),
  /** Qué dato responde. Dos hallazgos con la misma clave, uno. */
  clave: z.string().min(1).optional(),
  fuente: FuenteSchema,
});

/**
 * Un fallo que se puede leer y decidir. `acceso`: no pudo mirar (no es
 * lo mismo que «no hay»). `formato`: devolvió algo que no es esto.
 * `sin_respuesta`: terminó sin entregar. `negado`: el coordinador no
 * lo dejó salir. `tope`: se quedó sin turnos o presupuesto.
 */
export const ErrorSchema = z.object({
  tipo: z.enum([
    "acceso",
    "formato",
    "sin_respuesta",
    "negado",
    "tope",
  ]),
  motivo: z.string().min(1),
  intentado: z.array(z.string()),
  reintentable: z.boolean(),
  sugerencia: z.string().optional(),
});

export const VueltaSchema = z.discriminatedUnion("estado", [
  z.object({
    estado: z.literal("ok"),
    hallazgos: z.array(HallazgoSchema).min(1),
  }),
  z.object({ estado: z.literal("error"), error: ErrorSchema }),
]);

export type Fuente = z.infer<typeof FuenteSchema>;
export type Hallazgo = z.infer<typeof HallazgoSchema>;
export type ErrorEstructurado = z.infer<typeof ErrorSchema>;
export type Vuelta = z.infer<typeof VueltaSchema>;

/** Tres acentos graves: abren y cierran un bloque de código. */
const CERCA = "`".repeat(3);

/**
 * El formato, dicho para el modelo. Va en la definición del
 * subagente: lo que no está escrito ahí, el subagente no lo sabe.
 */
export const FORMATO_DE_VUELTA = [
  `Termina con un único bloque ${CERCA}json y nada después, con una de`,
  "estas dos formas:",
  '{"estado":"ok","hallazgos":[{"afirmacion":"...","fuente":',
  '{"ruta":"manuscritos/...","cita":"texto copiado del archivo"}}]}',
  '{"estado":"error","error":{"tipo":"acceso","motivo":"...",',
  '"intentado":["..."],"reintentable":false,"sugerencia":"..."}}',
  "Cada afirmación lleva su fuente: una cita literal del archivo o,",
  "si mediste algo, el método y el valor. Si no pudiste leer algo,",
  "devuelve un error de tipo acceso: no digas que no existe.",
  "Si dos fuentes dicen cosas distintas del mismo dato, devuelve las",
  "dos con la misma clave y su fecha si la tienen: no elijas.",
  "Si una herramienta falla por algo pasajero, reintenta una vez;",
  "devuelve un error solo si no lo resuelves.",
].join("\n");

/** Un error armado por el coordinador, no por el subagente. */
export function fallo(
  tipo: ErrorEstructurado["tipo"],
  motivo: string,
  reintentable: boolean,
  sugerencia?: string,
): Vuelta {
  const error: ErrorEstructurado = {
    tipo,
    motivo,
    intentado: [],
    reintentable,
  };
  if (sugerencia !== undefined) error.sugerencia = sugerencia;
  return { estado: "error", error };
}

/**
 * El último bloque de código json del texto; si no hay, el texto
 * entero. El formato pide ese bloque: se busca, en vez de suponer
 * que todo el texto es JSON.
 */
function extraerJson(texto: string): string {
  const bloques = [...texto.matchAll(/`{3}json\s*([\s\S]*?)`{3}/g)];
  const ultimo = bloques.at(-1)?.[1];
  return (ultimo ?? texto).trim();
}

/**
 * Lee lo que devolvió un subagente. Texto libre no entra al informe
 * como hallazgo: se convierte en un error de formato, con el texto
 * guardado en el motivo para que una persona lo lea.
 */
export function leerVuelta(texto: string, esError: boolean): Vuelta {
  if (esError) {
    return fallo(
      "sin_respuesta",
      texto || "El subagente terminó sin respuesta.",
      true,
    );
  }
  let crudo: unknown;
  try {
    crudo = JSON.parse(extraerJson(texto));
  } catch {
    return fallo(
      "formato",
      `Texto libre, sin fuente: «${texto.trim().slice(0, 160)}»`,
      true,
      "Repetir la delegación pidiendo el formato de vuelta.",
    );
  }
  const r = VueltaSchema.safeParse(crudo);
  if (!r.success) {
    const problema = r.error.issues[0];
    return fallo(
      "formato",
      `JSON fuera del formato: ${problema?.path.join(".") ?? ""} ` +
        `${problema?.message ?? ""}`.trim(),
      true,
    );
  }
  return r.data;
}
