import Anthropic from "@anthropic-ai/sdk";

const dormir = (ms: number) =>
  new Promise<void>((ok) => setTimeout(ok, ms));

/**
 * La primera idea: "si falla, reintento". Todo error de la API se
 * reintenta, la espera se duplica y no hay tope ni azar. Está aquí
 * para romperla a propósito; no la uses.
 */
export async function reintentarTodo<T>(
  etiqueta: string,
  fn: () => Promise<T>,
  intentos = 6,
  baseMs = 1_000,
): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof Anthropic.APIError)) throw err;
      if (intento >= intentos) {
        console.error(
          `${etiqueta}: fallo transitorio, reintentos agotados`,
        );
        throw err;
      }
      const espera = baseMs * 2 ** (intento - 1);
      const id = err.headers?.get("request-id");
      console.error(
        `[reintento] ${etiqueta} estado=${err.status} ` +
          `${intento}/${intentos} espera=${espera}ms id=${id}`,
      );
      await dormir(espera);
    }
  }
}
