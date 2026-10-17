import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Un servidor local que FINGE ser la Messages API. No es Claude ni la
 * API: es un programa de este libro que responde con los formatos que
 * la documentación describe (el JSON de error con `type`, `error` y
 * `request_id`; la cabecera `retry-after`; los eventos SSE). Sirve
 * para provocar fallas a voluntad y medir cómo reacciona tu cliente.
 *
 * Se programa con una lista de pasos: la petición número 1 recibe el
 * paso 1, la 2 el paso 2, y a partir de ahí se repite el último.
 */

/** Un evento SSE: su nombre (`event:`) y su carga (`data:`). */
export interface EventoSse {
  event: string;
  data: unknown;
}

export type Paso =
  | {
      tipo: "json";
      estado: number;
      cabeceras?: Record<string, string>;
      cuerpo: unknown;
      /** Espera antes de responder, para imitar una respuesta larga. */
      demoraMs?: number;
    }
  | { tipo: "sse"; eventos: EventoSse[]; pausaMs: number }
  /** Responde 200 con un resumen de lo que recibió (para el PDF). */
  | { tipo: "eco" };

export interface PeticionRegistrada {
  numero: number;
  stream: boolean;
  cuerpo: unknown;
  /** Verdadero si el cliente colgó antes de que terminara el paso. */
  cortadaPorElCliente: boolean;
}

export interface ServidorFalso {
  url: string;
  peticiones: PeticionRegistrada[];
  cerrar(): Promise<void>;
}

const MODELO = "claude-opus-5-5";

function mensaje(texto: string, stopReason: string) {
  return {
    id: "msg_falso_001",
    type: "message",
    role: "assistant",
    model: MODELO,
    content: [
      { type: "thinking", thinking: "", signature: "firma-falsa" },
      { type: "text", text: texto },
    ],
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 12, output_tokens: 9 },
  };
}

function error(
  estado: number,
  tipo: string,
  texto: string,
  extra: Record<string, unknown> = {},
  cabeceras: Record<string, string> = {},
): Paso {
  return {
    tipo: "json",
    estado,
    cabeceras,
    cuerpo: {
      type: "error",
      error: { type: tipo, message: texto, ...extra },
    },
  };
}

export const FRASE_FIJA = "Texto fijo del servidor falso.";

/** 200: una respuesta normal, con un texto fijo. */
export function exito(demoraMs = 0): Paso {
  return {
    tipo: "json",
    estado: 200,
    cuerpo: mensaje(FRASE_FIJA, "end_turn"),
    demoraMs,
  };
}

/** 200 con un resumen de lo recibido (para comprobar el PDF). */
export function eco(): Paso {
  return { tipo: "eco" };
}

/** 200 con `stop_reason: refusal`: no es un error HTTP. */
export function rechazo(): Paso {
  return {
    tipo: "json",
    estado: 200,
    cuerpo: mensaje("", "refusal"),
  };
}

/** 529 `overloaded_error`: sin `retry-after`. */
export function sobrecarga(): Paso {
  return error(529, "overloaded_error", "servidor falso: sobrecargado");
}

/** 429 `rate_limit_error` con `retry-after` en segundos. */
export function limiteDeTasa(segundos: number): Paso {
  return error(
    429,
    "rate_limit_error",
    "servidor falso: límite de tasa",
    {},
    { "retry-after": String(segundos) },
  );
}

/** 429 por tope de gasto: sin `retry-after` y con su `error_code`. */
export function topeDeGasto(): Paso {
  return error(
    429,
    "rate_limit_error",
    "servidor falso: tope de gasto",
    { details: { error_code: "enforced_spend_limit_reached" } },
  );
}

/**
 * 429 sin `retry-after` y sin `error_code`: no dice si es la tasa o el
 * gasto. La documentación no define este caso; es un caso de prueba.
 */
export function limiteSinPista(): Paso {
  return error(
    429,
    "rate_limit_error",
    "servidor falso: 429 sin retry-after ni error_code",
  );
}

/** 400 `invalid_request_error`: la petición está mal. */
export function peticionInvalida(): Paso {
  return error(
    400,
    "invalid_request_error",
    "servidor falso: petición mal formada",
  );
}

/** 500 `api_error`. */
export function errorInterno(): Paso {
  return error(500, "api_error", "servidor falso: error interno");
}

/**
 * Los eventos de una respuesta por SSE, en el orden documentado:
 * `message_start`, un bloque por cada pieza (`content_block_start`,
 * deltas, `content_block_stop`), `message_delta` con el `usage`
 * acumulado y `message_stop`. En estos modelos el primer bloque es el
 * pensamiento (capítulo 1); aquí va en su forma mínima, con un solo
 * `signature_delta`, porque el libro no tiene un hecho de la forma
 * completa. El segundo bloque, `index: 1`, es el texto.
 */
export function eventosDeTexto(palabras: string[]): EventoSse[] {
  const inicio = mensaje("", "end_turn");
  const arranque = {
    ...inicio,
    content: [],
    stop_reason: null,
    usage: { input_tokens: 12, output_tokens: 1 },
  };
  return [
    {
      event: "message_start",
      data: { type: "message_start", message: arranque },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "firma-falsa" },
      },
    },
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      },
    },
    { event: "ping", data: { type: "ping" } },
    ...palabras.map((p, i) => ({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "text_delta",
          text: i < palabras.length - 1 ? p + " " : p,
        },
      },
    })),
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 1 },
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: {
          stop_reason: "end_turn",
          stop_sequence: null,
          stop_details: null,
          container: null,
        },
        usage: { output_tokens: palabras.length },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ];
}

export const PALABRAS = [
  "El", "servidor", "falso", "escribe", "esta", "frase", "palabra",
  "por", "palabra.",
];

/** Un stream completo: una palabra cada `pausaMs`. */
export function transmision(
  pausaMs: number,
  palabras: string[] = PALABRAS,
): Paso {
  return { tipo: "sse", eventos: eventosDeTexto(palabras), pausaMs };
}

/** ¿Este evento trae una parte de texto? Solo esas hacen esperar. */
function esTexto(e: EventoSse): boolean {
  const delta = (e.data as { delta?: { type?: string } }).delta;
  return (
    e.event === "content_block_delta" && delta?.type === "text_delta"
  );
}

/**
 * Un stream que se rompe: responde 200, manda `tras` palabras y
 * después un evento `error` de tipo `overloaded_error`.
 */
export function transmisionCortada(
  pausaMs: number,
  tras: number,
): Paso {
  const completos = eventosDeTexto(PALABRAS);
  let vistas = 0;
  const hasta =
    completos.findIndex((e) => esTexto(e) && ++vistas === tras) + 1;
  return {
    tipo: "sse",
    pausaMs,
    eventos: [
      ...completos.slice(0, hasta),
      {
        event: "error",
        data: {
          type: "error",
          error: {
            type: "overloaded_error",
            message: "servidor falso: sobrecargado a mitad de stream",
          },
        },
      },
    ],
  };
}

const dormir = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

async function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  const trozos: Buffer[] = [];
  for await (const t of req) trozos.push(t as Buffer);
  try {
    return JSON.parse(Buffer.concat(trozos).toString("utf8"));
  } catch {
    return null;
  }
}

/** Resume los bloques recibidos (¿llegó el PDF entero?). */
function resumirBloques(cuerpo: unknown): string[] {
  const msgs = (cuerpo as { messages?: { content?: unknown }[] })
    ?.messages;
  const contenido = msgs?.at(-1)?.content;
  if (typeof contenido === "string") return ["texto simple"];
  if (!Array.isArray(contenido)) return ["nada reconocible"];
  return contenido.map((b: Record<string, unknown>) => {
    const s = b["source"] as Record<string, string> | undefined;
    if (b["type"] === "text") return "text";
    if (s?.["type"] !== "base64") return String(b["type"]);
    const bytes = Buffer.from(s["data"] ?? "", "base64");
    const firma = bytes.subarray(0, 5).toString("latin1");
    return (
      `${b["type"]}: ${s["media_type"]}, ${bytes.length} bytes, ` +
      `empieza por ${firma}`
    );
  });
}

export async function iniciarServidorFalso(
  pasos: Paso[],
): Promise<ServidorFalso> {
  const peticiones: PeticionRegistrada[] = [];

  async function atender(req: IncomingMessage, res: ServerResponse) {
    const cuerpo = await leerCuerpo(req);
    const numero = peticiones.length + 1;
    const stream =
      (cuerpo as { stream?: boolean } | null)?.stream === true;
    const registro: PeticionRegistrada = {
      numero,
      stream,
      cuerpo,
      cortadaPorElCliente: false,
    };
    peticiones.push(registro);
    res.on("close", () => {
      if (!res.writableFinished) registro.cortadaPorElCliente = true;
    });

    const id = `req_falso_${String(numero).padStart(6, "0")}`;
    const cabecerasBase = { "request-id": id };
    const paso = pasos[Math.min(numero, pasos.length) - 1];

    if (req.method !== "POST" || req.url !== "/v1/messages" || !paso) {
      res.writeHead(404, cabecerasBase).end("{}");
      return;
    }

    if (paso.tipo === "sse") {
      res.writeHead(200, {
        ...cabecerasBase,
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      for (const e of paso.eventos) {
        if (esTexto(e)) await dormir(paso.pausaMs);
        if (res.destroyed) return;
        const datos = JSON.stringify(e.data);
        res.write(`event: ${e.event}\ndata: ${datos}\n\n`);
      }
      res.end();
      return;
    }

    let estado = 200;
    let cabeceras: Record<string, string> = {};
    let salida: unknown;
    if (paso.tipo === "eco") {
      const lineas = resumirBloques(cuerpo).map((l) => `- ${l}`);
      const texto = ["Recibí:", ...lineas].join("\n");
      salida = mensaje(texto, "end_turn");
    } else {
      estado = paso.estado;
      cabeceras = paso.cabeceras ?? {};
      salida = paso.cuerpo;
      if (paso.demoraMs) await dormir(paso.demoraMs);
    }
    // El JSON de error lleva el mismo `request_id` que la cabecera.
    const cargaUtil =
      (salida as { type?: string }).type === "error"
        ? { ...(salida as object), request_id: id }
        : salida;
    res.writeHead(estado, {
      ...cabecerasBase,
      ...cabeceras,
      "content-type": "application/json",
    });
    res.end(JSON.stringify(cargaUtil));
  }

  const servidor = createServer((req, res) => {
    atender(req, res).catch(() => res.destroy());
  });
  await new Promise<void>((ok) =>
    servidor.listen(0, "127.0.0.1", () => ok()),
  );
  const { port } = servidor.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    peticiones,
    cerrar: () =>
      new Promise<void>((ok) => {
        servidor.closeAllConnections();
        servidor.close(() => ok());
      }),
  };
}
