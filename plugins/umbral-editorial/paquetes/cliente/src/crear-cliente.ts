import Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile } from "node:fs/promises";

/**
 * El conmutador único del libro: todo el código que habla con el
 * modelo pide su cliente aquí y nunca llama a `new Anthropic()` por su
 * cuenta. Así el mismo programa corre contra una grabación (`grabado`,
 * el modo por defecto, sin red y sin costo) o contra la API real
 * (`real`).
 */
export type ModoCliente = "grabado" | "real";

/**
 * Lo mínimo que el resto del código necesita de una respuesta. El SDK
 * devuelve un `Message` con más campos; este tipo exige solo los que
 * el libro lee, y un `Message` real cumple con él.
 */
export type RespuestaMensaje = Pick<
  Anthropic.Message,
  | "id"
  | "type"
  | "role"
  | "content"
  | "model"
  | "stop_reason"
  | "stop_sequence"
> & {
  usage: Pick<Anthropic.Usage, "input_tokens" | "output_tokens"> &
    Partial<
      Pick<
        Anthropic.Usage,
        | "cache_creation_input_tokens"
        | "cache_read_input_tokens"
        | "output_tokens_details"
      >
    >;
  _request_id?: string | null;
};

/**
 * La forma que comparten el cliente real y el grabado. Los capítulos
 * siguientes agregan métodos aquí (conteo de tokens, lectura en
 * flujo…); el grabado tendrá que ofrecerlos también. `stream`
 * devuelve los eventos de la respuesta a medida que llegan.
 */
export interface ClienteClaude {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<RespuestaMensaje>;
    stream(
      params: Anthropic.MessageStreamParams,
    ): AsyncIterable<Anthropic.MessageStreamEvent>;
    countTokens(
      params: Anthropic.MessageCountTokensParams,
    ): Promise<{ input_tokens: number }>;
  };
}

export interface OpcionesCliente {
  /** Nombre base: `ms-004` lee `ms-004-a.json`, `ms-004-b.json`… */
  grabacion?: string;
  /**
   * Qué grabación leer (`a`, `b`, `c`). Si falta, se usa la variable
   * `CLAUDE_GRABACION` y, si tampoco está, `a`. En modo real se ignora.
   */
  variante?: string;
  /**
   * Dirección de un servidor LOCAL (el servidor falso del capítulo 5).
   * Si la das, el cliente es el del SDK apuntando ahí, sin leer
   * `CLAUDE_MODO` ni usar tu clave. Solo acepta 127.0.0.1 o localhost.
   */
  baseURL?: string;
  /**
   * Reintentos que hace el SDK por su cuenta. Aquí son 0 por defecto:
   * el único bucle de reintentos del libro es el nuestro.
   */
  maxRetries?: number;
}

/** Lee `CLAUDE_GRABACION`: una letra minúscula, `a` por defecto. */
export function leerVariante(
  entorno: NodeJS.ProcessEnv = process.env,
): string {
  const valor = entorno["CLAUDE_GRABACION"];
  if (valor === undefined || valor === "") return "a";
  if (/^[a-z]$/.test(valor)) return valor;
  throw new Error(
    `CLAUDE_GRABACION=${valor} no es válida. Usa una letra: a, b, c.`,
  );
}

/**
 * Lee `CLAUDE_MODO`. Un valor desconocido falla en voz alta: un error
 * de tipeo no debe cambiar en silencio de la grabación a la API que
 * cobra.
 */
export function leerModo(
  entorno: NodeJS.ProcessEnv = process.env,
): ModoCliente {
  const valor = entorno["CLAUDE_MODO"];
  if (valor === undefined || valor === "") return "grabado";
  if (valor === "grabado" || valor === "real") return valor;
  throw new Error(
    `CLAUDE_MODO=${valor} no es válido. ` +
      `Usa "grabado" (por defecto) o "real".`,
  );
}

/** Cliente del SDK contra un servidor de esta misma máquina. */
function crearClienteLocal(
  baseURL: string,
  maxRetries: number,
): ClienteClaude {
  const { hostname } = new URL(baseURL);
  // Una clave real nunca debe viajar a otra máquina por un descuido.
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`baseURL=${baseURL} no es local; no se acepta.`);
  }
  return new Anthropic({
    baseURL,
    apiKey: "sk-ant-clave-falsa-local",
    maxRetries,
  });
}

export function crearCliente(
  opciones: OpcionesCliente = {},
): ClienteClaude {
  const maxRetries = opciones.maxRetries ?? 0;
  if (opciones.baseURL !== undefined) {
    return crearClienteLocal(opciones.baseURL, maxRetries);
  }
  if (leerModo() === "real") {
    // Comprobamos la clave aquí para fallar antes de la primera
    // petición y con un mensaje que diga qué hacer. `new Anthropic()`
    // la lee sola del entorno.
    if (!process.env["ANTHROPIC_API_KEY"]) {
      throw new Error(
        "CLAUDE_MODO=real exige ANTHROPIC_API_KEY (una clave de la " +
          "Claude Console). Cárgala desde .env con " +
          "`npm run llamar:real` o vuelve al modo grabado.",
      );
    }
    return new Anthropic({ maxRetries });
  }

  return crearClienteGrabado(
    opciones.grabacion ?? "ms-004",
    opciones.variante ?? leerVariante(),
  );
}

const CARPETA = new URL("../../../fixtures/", import.meta.url);

/**
 * Imita lo que la API documenta para los modelos actuales:
 * `temperature` solo admite 1, `top_p` solo 0,99 o más y `top_k` se
 * rechaza siempre. Es una imitación sintética: el error de verdad lo
 * lanza el servidor.
 */
function rechazarAjustesObsoletos(
  params: Anthropic.MessageCreateParamsNonStreaming,
): void {
  const invalidos: string[] = [];
  if (params.temperature !== undefined && params.temperature !== 1) {
    invalidos.push("temperature");
  }
  if (params.top_p !== undefined && params.top_p < 0.99) {
    invalidos.push("top_p");
  }
  if (params.top_k !== undefined) invalidos.push("top_k");
  if (invalidos.length > 0) {
    throw new Error(
      `400 (imitación sintética): no admite fijar ` +
        `${invalidos.join(", ")}.`,
    );
  }
}

/**
 * Devuelve un cliente que no sale a la red: cada `messages.create`
 * entrega la misma grabación, la que elegiste. Una grabación es una
 * foto fija, así que repetirla da siempre lo mismo. No compara la
 * petición con la grabación.
 */
function crearClienteGrabado(
  nombre: string,
  variante: string,
): ClienteClaude {
  return {
    messages: {
      async create(params) {
        rechazarAjustesObsoletos(params);
        const archivo = `${nombre}-${variante}.json`;
        const disponibles = await listarVariantes(nombre);
        if (!disponibles.includes(variante)) {
          throw new Error(
            `No hay grabación "${variante}" de "${nombre}". ` +
              `Disponibles: ${disponibles.join(", ") || "ninguna"}.`,
          );
        }
        return leerGrabacion(new URL(archivo, CARPETA));
      },
      // Una grabación es una foto fija: no tiene tiempos que medir.
      stream() {
        throw new Error(
          "El modo grabado no transmite. Usa el servidor falso " +
            "(npm run en-vivo) o CLAUDE_MODO=real.",
        );
      },
      // Una cifra grabada sería una cifra inventada: el conteo exacto
      // solo existe contra la API real.
      async countTokens() {
        throw new Error(
          "count_tokens solo existe con CLAUDE_MODO=real.",
        );
      },
    },
  };
}

/** Las letras con grabación: `ms-004-a.json` aporta la `a`. */
async function listarVariantes(nombre: string): Promise<string[]> {
  const existentes = await readdir(CARPETA);
  const patron = new RegExp(`^${nombre}-([a-z])\\.json$`);
  return existentes
    .map((f) => patron.exec(f)?.[1])
    .filter((letra): letra is string => letra !== undefined)
    .sort();
}

async function leerGrabacion(ruta: URL): Promise<RespuestaMensaje> {
  const crudo: unknown = JSON.parse(await readFile(ruta, "utf8"));
  if (!esRespuesta(crudo)) {
    throw new Error(
      `${ruta.pathname} no tiene la forma de una respuesta.`,
    );
  }
  return crudo;
}

function esRespuesta(valor: unknown): valor is RespuestaMensaje {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    v["type"] === "message" &&
    v["role"] === "assistant" &&
    Array.isArray(v["content"]) &&
    typeof v["usage"] === "object" &&
    v["usage"] !== null &&
    // Toda grabación de este libro se declara sintética: nadie la
    // confunde con una respuesta que salió de la API.
    v["_sintetico"] === true
  );
}

/**
 * Capítulo 12. El lote de mensajes, con el mismo conmutador: en modo
 * `real`, el del SDK; en `grabado`, uno que lee
 * `fixtures/<nombre>-<variante>.jsonl`, una línea por resultado.
 */
export type PeticionLote =
  Anthropic.Messages.Batches.BatchCreateParams.Request;

/** Lo que el libro lee de cada resultado; el del SDK cumple con él. */
export interface ResultadoLote {
  custom_id: string;
  result:
    | { type: "succeeded"; message: RespuestaMensaje }
    | { type: "errored"; error: { error: { type: string } } }
    | { type: "canceled" }
    | { type: "expired" };
}

export interface ClienteLotes {
  create(params: { requests: PeticionLote[] }): Promise<{ id: string }>;
  retrieve(id: string): Promise<{ processing_status: string }>;
  results(id: string): Promise<AsyncIterable<ResultadoLote>>;
}

export function crearClienteLotes(
  opciones: OpcionesCliente = {},
): ClienteLotes {
  if (leerModo() === "real") {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      throw new Error("CLAUDE_MODO=real exige ANTHROPIC_API_KEY.");
    }
    return new Anthropic({ maxRetries: opciones.maxRetries ?? 0 })
      .messages.batches;
  }
  const nombre = opciones.grabacion ?? "lote";
  const variante = opciones.variante ?? leerVariante();
  const pedidos = new Map<string, Set<string>>();
  return {
    async create({ requests }) {
      const id = `msgbatch_sintetico_${nombre}_${variante}`;
      pedidos.set(id, new Set(requests.map((r) => r.custom_id)));
      return { id };
    },
    // Una grabación ya terminó: no hay nada que esperar.
    async retrieve() {
      return { processing_status: "ended" };
    },
    async results(id) {
      const enviados = pedidos.get(id);
      if (enviados === undefined) {
        throw new Error(`Lote ${id} no existe.`);
      }
      const ruta = new URL(`${nombre}-${variante}.jsonl`, CARPETA);
      const lineas = (await readFile(ruta, "utf8"))
        .split("\n")
        .filter((l) => l.trim() !== "");
      const resultados = lineas.map((l) => {
        const r = JSON.parse(l) as ResultadoLote & {
          _sintetico?: true;
        };
        if (r._sintetico !== true) {
          throw new Error(`${ruta.pathname}: línea sin _sintetico.`);
        }
        // Un lote real solo devuelve lo que se le pidió.
        if (!enviados.has(r.custom_id)) {
          throw new Error(`Grabación con ${r.custom_id}: no se pidió.`);
        }
        return r;
      });
      return (async function* () {
        yield* resultados;
      })();
    },
  };
}
