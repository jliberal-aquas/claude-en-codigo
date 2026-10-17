import { readFile, readdir } from "node:fs/promises";
import type {
  Options,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  RespuestaMensaje,
} from "../../../cliente/src/crear-cliente.js";
import { TARIFAS } from "../../../cliente/src/precios.js";
import type { Consultar } from "../asistente.js";

/**
 * Un doble de `query()` que reproduce grabaciones de varios turnos:
 * `inv-coord-a.json` es el primer turno del coordinador, la `b` el
 * segundo… y cada delegación permitida reproduce las de su subagente.
 * No lanza Claude Code, no usa red ni credencial, y no ejecuta
 * herramientas: la grabación siguiente ya trae lo que el modelo
 * «leyó». Lo que sí corre de verdad es tu código: el callback decide
 * cada pedido, y tu coordinador lee lo que el doble emite.
 *
 * Qué copia el esquema del SDK y qué inventa el libro:
 * - Del SDK (tipos del paquete 0.3.301): `type`, `subtype`,
 *   `session_id`; en `assistant`, `message` con forma de respuesta
 *   de la API y `parent_tool_use_id` (null en el coordinador; el id
 *   de la delegación en un subagente, fila SDK-PTU-001); en `result`,
 *   `num_turns`, `total_cost_usd`, `permission_denials` y `result`.
 * - Del libro: los ids (`ses-doble-inv`, `toolu_sintetico_…`), que
 *   el resultado de `Agent` traiga el texto final del subagente, el
 *   aviso «terminó sin respuesta (doble)», el costo calculado con los
 *   precios del libro y, en las grabaciones, `_sintetico`,
 *   `_request_id` y la firma del bloque `thinking`.
 */

export interface GuionGrabado {
  /** Base de las grabaciones del coordinador: `inv-coord`. */
  coordinador: string;
  /** Por descripción de la delegación, la base de su subagente. */
  subagentes: Record<string, string>;
}

/** Lo que el doble vio pasar: para las pruebas. */
export interface Bitacora {
  /** Herramienta, quién la pidió y qué decidió el callback. */
  pedidos: { herramienta: string; agente: string; decision: string }[];
}

const FIXTURES = new URL("../../../../fixtures/", import.meta.url);

/** Las letras con grabación de una base, en orden. */
async function turnos(base: string): Promise<RespuestaMensaje[]> {
  const patron = new RegExp(`^${base}-([a-z])\\.json$`);
  const letras = (await readdir(FIXTURES))
    .map((f) => patron.exec(f)?.[1])
    .filter((l): l is string => l !== undefined)
    .sort();
  const leidas: RespuestaMensaje[] = [];
  for (const l of letras) {
    const ruta = new URL(`${base}-${l}.json`, FIXTURES);
    const g = JSON.parse(await readFile(ruta, "utf8")) as Record<
      string,
      unknown
    >;
    // Toda grabación del libro se declara sintética.
    if (g["_sintetico"] !== true || g["type"] !== "message") {
      throw new Error(`${ruta.pathname}: no es una grabación.`);
    }
    leidas.push(g as unknown as RespuestaMensaje);
  }
  return leidas;
}

const mensaje = (m: Record<string, unknown>) =>
  m as unknown as SDKMessage;

type Pedido = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

const pedidosDe = (r: RespuestaMensaje): Pedido[] =>
  r.content.flatMap((b) =>
    b.type === "tool_use"
      ? [{ id: b.id, name: b.name, input: b.input as Pedido["input"] }]
      : [],
  );

const textoDe = (r: RespuestaMensaje): string =>
  r.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n");

/** Precio de una respuesta, en USD: estimación del doble. */
function costo(r: RespuestaMensaje, modelo: "opus" | "sonnet"): number {
  const t = TARIFAS[
    modelo === "opus" ? "claude-opus-5-5" : "claude-sonnet-5-5"
  ];
  const { input_tokens, output_tokens } = r.usage;
  return (input_tokens * t.entrada + output_tokens * t.salida) / 1e6;
}

export function dobleGrabado(
  guion: GuionGrabado,
  bitacora: Bitacora = { pedidos: [] },
): Consultar {
  return async function* ({ options }) {
    const sesion = "ses-doble-inv";
    const opciones: Options = options ?? {};
    const aprobadas = new Set(opciones.allowedTools ?? []);
    let gasto = 0;
    let turnosConHerramientas = 0;

    /** Pregunta al callback, como el SDK, si nadie lo aprobó antes. */
    async function decidir(p: Pedido, agente?: string) {
      if (aprobadas.has(p.name)) {
        return { behavior: "allow" as const, updatedInput: p.input };
      }
      const d = await opciones.canUseTool?.(p.name, p.input, {
        signal: new AbortController().signal,
        toolUseID: p.id,
        requestId: `req-doble-${p.id}`,
        ...(agente !== undefined ? { agentID: agente } : {}),
      });
      if (d === undefined || d === null) {
        throw new Error("El doble necesita un canUseTool.");
      }
      bitacora.pedidos.push({
        herramienta: p.name,
        agente: agente ?? "coordinador",
        decision: d.behavior,
      });
      return d;
    }

    yield mensaje({
      type: "system",
      subtype: "init",
      session_id: sesion,
    });

    for (const turno of await turnos(guion.coordinador)) {
      gasto += costo(turno, "opus");
      yield mensaje({
        type: "assistant",
        session_id: sesion,
        parent_tool_use_id: null,
        message: turno,
      });
      if (turno.stop_reason !== "tool_use") {
        yield mensaje({
          type: "result",
          subtype: "success",
          session_id: sesion,
          num_turns: turnosConHerramientas,
          total_cost_usd: Number(gasto.toFixed(4)),
          permission_denials: [],
          result: textoDe(turno),
        });
        return;
      }
      turnosConHerramientas += 1;

      const resultados: Record<string, unknown>[] = [];
      for (const p of pedidosDe(turno)) {
        const d = await decidir(p);
        if (d.behavior === "deny") {
          resultados.push({
            type: "tool_result",
            tool_use_id: p.id,
            content: d.message,
            is_error: true,
          });
          continue;
        }
        const entrada = d.updatedInput ?? p.input;
        const base = guion.subagentes[String(entrada["description"])];
        const suyos = base === undefined ? [] : await turnos(base);
        let ultimo: RespuestaMensaje | undefined;
        for (const t of suyos) {
          gasto += costo(t, "sonnet");
          yield mensaje({
            type: "assistant",
            session_id: sesion,
            parent_tool_use_id: p.id,
            message: t,
          });
          for (const q of pedidosDe(t)) await decidir(q, p.id);
          ultimo = t;
        }
        // Sin grabación, o cortado: el subagente no entregó.
        const entrego = ultimo?.stop_reason === "end_turn";
        resultados.push({
          type: "tool_result",
          tool_use_id: p.id,
          content: [
            {
              type: "text",
              text: entrego
                ? textoDe(ultimo!)
                : "El subagente terminó sin respuesta (doble).",
            },
          ],
          is_error: !entrego,
        });
      }
      yield mensaje({
        type: "user",
        session_id: sesion,
        parent_tool_use_id: null,
        message: { role: "user", content: resultados },
      });
    }
    throw new Error("Las grabaciones del coordinador no terminan.");
  };
}
