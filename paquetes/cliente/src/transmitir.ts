import { performance } from "node:perf_hooks";
import type Anthropic from "@anthropic-ai/sdk";
import type { ClienteClaude } from "./crear-cliente.js";

export type ParamsBase = Anthropic.MessageStreamParams;

export interface ResultadoTransmision {
  texto: string;
  /** Milisegundos hasta la primera parte de texto (null si no hubo). */
  msPrimerTexto: number | null;
  msTotal: number;
  /** El `type` de cada evento recibido, en orden. */
  eventos: string[];
  stopReason: string | null;
  tokensSalida: number | null;
}

/**
 * Lee una respuesta por streaming. `alTexto` se llama con cada parte
 * en cuanto llega. Si el stream se rompe a mitad, el error sube tal
 * cual y este texto a medias se pierde: quien quiera aprovecharlo
 * lo guarda en `alTexto` (ver `transmitirContinuable`).
 */
export async function transmitir(
  cliente: ClienteClaude,
  params: ParamsBase,
  alTexto: (parte: string, ms: number) => void = () => {},
): Promise<ResultadoTransmision> {
  const inicio = performance.now();
  const flujo = cliente.messages.stream(params);

  const r: ResultadoTransmision = {
    texto: "",
    msPrimerTexto: null,
    msTotal: 0,
    eventos: [],
    stopReason: null,
    tokensSalida: null,
  };
  for await (const ev of flujo) {
    r.eventos.push(ev.type);
    if (ev.type === "content_block_delta") {
      // El bloque de pensamiento trae sus propios deltas (firma,
      // pensamiento) y las herramientas, JSON parcial: aquí solo nos
      // interesa el texto, y se filtra por tipo.
      if (ev.delta.type === "text_delta") {
        const ms = performance.now() - inicio;
        r.msPrimerTexto ??= ms;
        r.texto += ev.delta.text;
        alTexto(ev.delta.text, ms);
      }
    } else if (ev.type === "message_delta") {
      // El `usage` de este evento es acumulativo, no incremental.
      r.stopReason = ev.delta.stop_reason;
      r.tokensSalida = ev.usage.output_tokens;
    }
    // Cualquier otro tipo (incluidos los que aún no existen) se
    // ignora sin romper.
  }
  r.msTotal = performance.now() - inicio;
  return r;
}

/**
 * Cancela un stream a propósito: sale del `for await` con `break`
 * tras `n` partes de texto. Al salir, el SDK cierra la conexión.
 */
export async function primerasPartes(
  cliente: ClienteClaude,
  params: ParamsBase,
  n: number,
): Promise<string[]> {
  const flujo = cliente.messages.stream(params);
  const partes: string[] = [];
  for await (const ev of flujo) {
    if (
      ev.type === "content_block_delta" &&
      ev.delta.type === "text_delta"
    ) {
      partes.push(ev.delta.text);
      if (partes.length >= n) break;
    }
  }
  return partes;
}

/**
 * La petición que pide seguir donde quedó un stream cortado. Para los
 * modelos actuales no se pone lo recibido en un mensaje del asistente:
 * se agrega al último mensaje de usuario una instrucción de continuar.
 */
export function peticionParaContinuar(
  params: ParamsBase,
  parcial: string,
): ParamsBase {
  const ultimo = params.messages.at(-1);
  const bloques: Anthropic.ContentBlockParam[] =
    typeof ultimo?.content === "string"
      ? [{ type: "text", text: ultimo.content }]
      : (ultimo?.content ?? []);
  const aviso =
    "Tu respuesta anterior se cortó. Esto es lo que alcanzó a " +
    `llegar:\n\n${parcial}\n\nContinúa exactamente desde ahí, sin ` +
    "repetir lo ya escrito.";
  return {
    ...params,
    messages: [
      ...params.messages.slice(0, -1),
      {
        role: "user",
        content: [...bloques, { type: "text", text: aviso }],
      },
    ],
  };
}

/**
 * Una función para `conReintentos` que, si el stream se rompe, guarda
 * el texto que alcanzó a llegar y en el intento siguiente pide que
 * continúe en vez de empezar de cero. Los bloques de pensamiento y de
 * herramienta no se recuperan a medias: solo se guarda el texto.
 */
export function transmitirContinuable(
  cliente: ClienteClaude,
  params: ParamsBase,
  alTexto: (parte: string, ms: number) => void = () => {},
): () => Promise<ResultadoTransmision> {
  let guardado = "";
  return async () => {
    let nuevo = "";
    const pedido =
      guardado === ""
        ? params
        : peticionParaContinuar(params, guardado);
    try {
      const r = await transmitir(cliente, pedido, (parte, ms) => {
        nuevo += parte;
        alTexto(parte, ms);
      });
      return { ...r, texto: guardado + r.texto };
    } catch (e) {
      guardado += nuevo;
      throw e;
    }
  };
}
