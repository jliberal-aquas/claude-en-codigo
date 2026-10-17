import { z } from "zod";

/**
 * Lo que la revisión del CI cree de lo que dicen los dos pases de
 * `claude -p`. El modelo opina; este archivo decide. Regla de la
 * casa: una salida que no se entiende es una revisión que falló,
 * nunca una revisión sin hallazgos.
 */

/** Un hallazgo del primer pase: dónde, qué tan grave y la prueba. */
export const Hallazgo = z
  .object({
    archivo: z.string().min(1),
    linea: z.number().int().min(1),
    severidad: z.enum(["critica", "menor"]),
    regla: z.string().min(1),
    evidencia: z
      .string()
      .min(1)
      .describe("La línea del diff que lo muestra, copiada tal cual"),
    explicacion: z.string().min(1),
  })
  .strict();

export const Revision = z
  .object({ hallazgos: z.array(Hallazgo) })
  .strict();

/** El segundo pase confirma o refuta cada hallazgo por su índice. */
export const Confirmacion = z
  .object({
    indice: z.number().int().min(0),
    confirmado: z.boolean(),
    motivo: z.string().min(1),
  })
  .strict();

export const SegundoPase = z
  .object({ confirmaciones: z.array(Confirmacion) })
  .strict();

export type Hallazgo = z.infer<typeof Hallazgo>;
export type Revision = z.infer<typeof Revision>;
export type SegundoPase = z.infer<typeof SegundoPase>;

/**
 * Lo que este archivo lee de `--output-format json`. La documentación
 * nombra `result` y `structured_output`, pero no publica el objeto
 * completo: el resto de los campos se deja pasar sin mirarlo.
 */
const SalidaCli = z
  .object({
    result: z.string().optional(),
    structured_output: z.unknown().optional(),
  })
  .passthrough();

/** Una salida que no es una revisión, con el pase y el motivo. */
export class SalidaInvalida extends Error {
  override name = "SalidaInvalida";
  constructor(
    readonly pase: string,
    readonly motivo: string,
  ) {
    super(`${pase}: ${motivo}`);
  }
}

/**
 * Lee la salida de un pase y la valida con su esquema. Cada salida
 * que no es una revisión completa lanza `SalidaInvalida`: no hay
 * camino que devuelva una lista vacía por no entender.
 */
export function leerPase<T>(
  pase: string,
  texto: string,
  esquema: z.ZodType<T>,
): T {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    throw new SalidaInvalida(pase, "la salida no es JSON");
  }
  const cli = SalidaCli.safeParse(crudo);
  if (!cli.success) {
    throw new SalidaInvalida(
      pase,
      "no tiene la forma de --output-format json",
    );
  }
  if (cli.data.structured_output === undefined) {
    // Un campo que no llega no es una revisión vacía. Mostramos el
    // comienzo de `result`: suele decir qué pasó.
    const dice = (cli.data.result ?? "").slice(0, 80);
    throw new SalidaInvalida(
      pase,
      `sin structured_output; result dice: «${dice}»`,
    );
  }
  const datos = esquema.safeParse(cli.data.structured_output);
  if (!datos.success) {
    const campos = datos.error.issues
      .map((i) => i.path.join(".") || "(raíz)")
      .join(", ");
    throw new SalidaInvalida(
      pase,
      `structured_output no cumple el esquema (${campos})`,
    );
  }
  return datos.data;
}

export interface Veredicto {
  /** 0 pasa; 1 hay hallazgos críticos confirmados. */
  codigo: 0 | 1;
  lineas: string[];
}

function fila(etiqueta: string, h: Hallazgo, extra = ""): string {
  return (
    `${etiqueta.padEnd(10)} ${h.archivo}:${h.linea}  ` +
    `${h.regla}${extra}`
  );
}

/**
 * Junta los dos pases. Un hallazgo crítico bloquea si el segundo
 * pase no lo refutó: lo que no se refuta, cuenta. Una confirmación
 * de un hallazgo que no existe invalida el segundo pase.
 */
export function veredicto(
  revision: Revision,
  segundo: SegundoPase,
): Veredicto {
  const total = revision.hallazgos.length;
  for (const c of segundo.confirmaciones) {
    if (c.indice >= total) {
      throw new SalidaInvalida(
        "segundo pase",
        `confirma el hallazgo ${c.indice} y solo hay ${total}`,
      );
    }
  }

  const lineas: string[] = [];
  let bloquean = 0;
  revision.hallazgos.forEach((h, i) => {
    const c = segundo.confirmaciones.find((x) => x.indice === i);
    if (h.severidad === "menor") {
      lineas.push(fila("NOTA", h));
    } else if (c !== undefined && !c.confirmado) {
      lineas.push(fila("REFUTADO", h, ` · ${c.motivo}`));
    } else {
      bloquean += 1;
      lineas.push(fila("BLOQUEA", h, ` · ${h.explicacion}`));
    }
  });
  lineas.push(
    `veredicto: ${bloquean > 0 ? 1 : 0} · ${bloquean} bloquean, ` +
      `${total - bloquean} no bloquean`,
  );
  return { codigo: bloquean > 0 ? 1 : 0, lineas };
}
