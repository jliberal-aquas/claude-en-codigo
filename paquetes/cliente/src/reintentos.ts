import Anthropic from "@anthropic-ai/sdk";

/** Cuántas veces y cuánto se espera. */
export interface Politica {
  /** Intentos totales, contando el primero. */
  intentos: number;
  /** Espera máxima tras el primer fallo, antes del azar. */
  baseMs: number;
  /** Ninguna espera exponencial supera esto. */
  topeMs: number;
}

export const POLITICA: Politica = {
  intentos: 6,
  baseMs: 1_000,
  topeMs: 60_000,
};

/** Segundos que pide la cabecera `retry-after`, o null si no viene. */
export function segundosRetryAfter(err: unknown): number | null {
  if (!(err instanceof Anthropic.APIError)) return null;
  const valor = err.headers?.get("retry-after");
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Valor de `error.details.error_code` en un 429 por tope de gasto. */
export const CODIGO_GASTO = "enforced_spend_limit_reached";

/** El `error_code` que trae el cuerpo del error, o null si no hay. */
export function codigoDeError(err: unknown): string | null {
  if (!(err instanceof Anthropic.APIError)) return null;
  const cuerpo = err.error as
    | { error?: { details?: { error_code?: unknown } } }
    | undefined;
  const codigo = cuerpo?.error?.details?.error_code;
  return typeof codigo === "string" ? codigo : null;
}

/**
 * Lo que esperar puede arreglar: sin respuesta, 408, 409, 5xx (el 529
 * incluido) y un 429 que no sea de gasto. Todo lo demás es tuyo (400,
 * 401, 403, 404, 413, 422) y sigue igual de mal mañana.
 */
export function esReintentable(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (!(err instanceof Anthropic.APIError)) return false;
  const estado = err.status;
  // Un `error` en pleno stream llega tras un 200: no hay estado
  // HTTP, se mira el tipo que trae.
  if (estado === undefined) {
    return err.type === "overloaded_error" || err.type === "api_error";
  }
  // La documentación distingue el 429 de gasto por su `error_code`.
  // Que ese 429 no traiga `retry-after` no significa que todo 429 sin
  // la cabecera sea de gasto: sin código se reintenta, y los intentos
  // de la política ponen el límite.
  if (estado === 429) return codigoDeError(err) !== CODIGO_GASTO;
  return estado === 408 || estado === 409 || estado >= 500;
}

/**
 * Espera con azar: un número entre 0 y la espera exponencial, que
 * se duplica en cada intento hasta el tope. El azar evita que muchos
 * clientes caídos a la vez vuelvan al mismo instante.
 */
export function esperaConAzar(
  intento: number,
  p: Politica,
  azar: () => number = Math.random,
): number {
  const techo = Math.min(p.topeMs, p.baseMs * 2 ** intento);
  return azar() * techo;
}

/** Si el servidor dice cuánto esperar, nunca se espera menos. */
export function calcularEspera(
  intento: number,
  p: Politica,
  retryAfterS: number | null,
  azar: () => number = Math.random,
): number {
  const pedido = retryAfterS === null ? 0 : retryAfterS * 1_000;
  return Math.max(pedido, esperaConAzar(intento, p, azar));
}

/** Lo que el log necesita saber de un error, sea de la API o no. */
export function describirError(err: unknown) {
  if (err instanceof Anthropic.APIError) {
    return {
      estado: err.status ?? "sin-estado",
      tipo: err.type ?? "-",
      id: err.headers?.get("request-id") ?? "-",
    };
  }
  const tipo = err instanceof Error ? err.name : "desconocido";
  return { estado: "-", tipo, id: "-" };
}

export interface OpcionesReintentos {
  politica?: Politica;
  reintentable?: (err: unknown) => boolean;
  /** Se inyectan en las pruebas para no esperar de verdad. */
  dormir?: (ms: number) => Promise<void>;
  azar?: () => number;
  registrar?: (linea: string) => void;
}

const dormirDeVerdad = (ms: number) =>
  new Promise<void>((ok) => setTimeout(ok, ms));

/**
 * El único bucle de reintentos del libro. Reintenta lo que
 * `esReintentable` acepta, hasta `politica.intentos`, y escribe cada
 * decisión con el estado real, el tipo de error y el identificador
 * que la respuesta trae.
 */
export async function conReintentos<T>(
  etiqueta: string,
  fn: () => Promise<T>,
  opciones: OpcionesReintentos = {},
): Promise<T> {
  const p = opciones.politica ?? POLITICA;
  const reintentable = opciones.reintentable ?? esReintentable;
  const dormir = opciones.dormir ?? dormirDeVerdad;
  const registrar = opciones.registrar ?? console.error;

  for (let intento = 0; ; intento++) {
    try {
      return await fn();
    } catch (err) {
      const { estado, tipo, id } = describirError(err);
      const donde = `${etiqueta} estado=${estado} tipo=${tipo}`;
      const cuenta = `intento=${intento + 1}/${p.intentos}`;
      if (!reintentable(err)) {
        // Un error nuestro (no de la API) sube sin ruido de log.
        if (err instanceof Anthropic.APIError) {
          registrar(
            `[fallo] ${donde}\n` +
              `        ${cuenta} id=${id} sin-reintento`,
          );
        }
        throw err;
      }
      if (intento + 1 >= p.intentos) {
        registrar(
          `[fallo] ${donde}\n        ${cuenta} id=${id} agotado`,
        );
        throw err;
      }
      const ra = segundosRetryAfter(err);
      const espera = calcularEspera(intento, p, ra, opciones.azar);
      registrar(
        `[reintento] ${donde}\n` +
          `            ${cuenta} retry-after=${ra ?? "-"} ` +
          `espera=${Math.round(espera)}ms id=${id}`,
      );
      await dormir(espera);
    }
  }
}
