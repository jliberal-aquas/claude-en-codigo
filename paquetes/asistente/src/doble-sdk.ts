import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  Options,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Consultar } from "./asistente.js";

/**
 * Un doble de `query()` para las pruebas: no lanza Claude Code, no usa
 * red ni credencial. Sigue un guion de pedidos de herramientas que
 * escribió este libro (sintético) y, como el SDK, consulta al callback
 * de permisos antes de cada uno. Si el callback permite un Write, el
 * doble escribe el archivo de verdad, en la carpeta de la prueba.
 */

export interface Pedido {
  herramienta: string;
  entrada: Record<string, unknown>;
}

export interface Guion {
  pedidos: Pedido[];
  /** Subtipo del mensaje de resultado; por defecto `success`. */
  final?: "success" | "error_max_turns" | "error_max_budget_usd";
  /** Costo estimado que informa el resultado. */
  costoUsd?: number;
  /** Repite el mensaje del modelo con el mismo id, como en paralelo. */
  repetirMensaje?: boolean;
}

/** Lo que el doble observó: opciones recibidas y lo que respondió. */
export interface Registro {
  opciones?: Options;
  decisiones: {
    herramienta: string;
    decision: "allow" | "deny";
    motivo?: string;
  }[];
}

/** Un mensaje del SDK armado a mano; la forma es la de sus tipos. */
const mensaje = (m: Record<string, unknown>) =>
  m as unknown as SDKMessage;

export function dobleDeQuery(
  guion: Guion,
  registro: Registro,
): Consultar {
  return async function* ({ options }) {
    registro.opciones = options;
    const sesion = "ses-doble-0001";
    yield mensaje({
      type: "system",
      subtype: "init",
      session_id: sesion,
    });

    const negadas: { tool_name: string }[] = [];
    let n = 0;
    for (const p of guion.pedidos) {
      n += 1;
      const asistente = mensaje({
        type: "assistant",
        session_id: sesion,
        parent_tool_use_id: null,
        message: {
          id: `msg-doble-${n}`,
          content: [
            {
              type: "tool_use",
              id: `toolu-${n}`,
              name: p.herramienta,
              input: p.entrada,
            },
          ],
          usage: { input_tokens: 1000 * n, output_tokens: 50 },
        },
      });
      yield asistente;
      if (guion.repetirMensaje === true) yield asistente;

      const decision = await options?.canUseTool?.(
        p.herramienta,
        p.entrada,
        {
          signal: new AbortController().signal,
          toolUseID: `toolu-${n}`,
          requestId: `req-doble-${n}`,
        },
      );
      if (decision === undefined || decision === null) {
        throw new Error("El doble necesita un canUseTool.");
      }
      if (decision.behavior === "deny") {
        registro.decisiones.push({
          herramienta: p.herramienta,
          decision: "deny",
          motivo: decision.message,
        });
        negadas.push({ tool_name: p.herramienta });
        continue;
      }
      registro.decisiones.push({
        herramienta: p.herramienta,
        decision: "allow",
      });
      if (p.herramienta === "Write") {
        const ruta = resolve(
          options?.cwd ?? ".",
          String(p.entrada["file_path"]),
        );
        await mkdir(dirname(ruta), { recursive: true });
        await writeFile(ruta, String(p.entrada["content"] ?? ""));
      }
    }

    const final = guion.final ?? "success";
    yield mensaje({
      type: "result",
      subtype: final,
      session_id: sesion,
      num_turns: guion.pedidos.length,
      total_cost_usd: guion.costoUsd ?? 0.0123,
      permission_denials: negadas,
      ...(final === "success" ? { result: "Listo." } : {}),
    });
    // Como el SDK: tras un resultado de error, la consulta lanza.
    if (final !== "success") {
      throw new Error(`Consulta terminada con ${final} (doble)`);
    }
  };
}
