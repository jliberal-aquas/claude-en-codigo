import type {
  HookInput,
  HookJSONOutput,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { MODELO } from "../../../cliente/src/llamar.js";
import type { Consultar } from "../asistente.js";
import { clientePorTurnos } from "../bucle.js";
import { PREFIJO, type Mesa } from "./herramientas.js";

/**
 * Un doble de `query()` para el triage. No lanza Claude Code ni usa
 * red: cada turno del modelo sale de una grabación sintética
 * (`tri-<nombre>-a.json`, `-b`…), y lo demás corre de verdad. Para
 * cada pedido de herramienta sigue el orden de permisos que documenta
 * el SDK: hooks, reglas (aquí no hay), modo, `allowedTools` y, al
 * final, `canUseTool`. Lo aprobado ejecuta la herramienta real de la
 * mesa. La grabación no lee los resultados: el turno siguiente ya
 * está escrito, como el de un modelo que no cambia de idea.
 */

/** Quién decidió cada pedido, para verlo en las pruebas. */
export interface Llamada {
  turno: number;
  herramienta: string;
  quien: "hook" | "allowedTools" | "canUseTool" | "nadie";
  permitir: boolean;
  motivo?: string;
}

const mensaje = (m: Record<string, unknown>) =>
  m as unknown as SDKMessage;

/** El motivo de un deny de hook, o `null` si no negó. */
function negacion(salida: HookJSONOutput): string | null {
  if (!("hookSpecificOutput" in salida)) return null;
  const h = salida.hookSpecificOutput;
  if (h?.hookEventName !== "PreToolUse") return null;
  return h.permissionDecision === "deny"
    ? (h.permissionDecisionReason ?? "")
    : null;
}

export function dobleDelTriage(
  grabacion: string,
  mesa: Mesa,
  llamadas: Llamada[] = [],
): Consultar {
  return async function* ({ prompt, options }) {
    const cliente = await clientePorTurnos(grabacion);
    const sesion = "ses-doble-triage";
    yield mensaje({
      type: "system",
      subtype: "init",
      session_id: sesion,
    });

    const negadas: { tool_name: string }[] = [];
    let texto = "";
    let turno = 0;
    const tope = options?.maxTurns ?? 8;
    while (turno < tope) {
      turno += 1;
      const r = await cliente.messages.create({
        model: MODELO,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });
      yield mensaje({
        type: "assistant",
        session_id: sesion,
        // null: lo emite el agente principal. Dentro de un subagente
        // sería el id del tool_use que lo lanzó (tipos del SDK).
        parent_tool_use_id: null,
        message: r,
      });
      for (const b of r.content) {
        if (b.type === "text") texto = b.text;
        if (b.type !== "tool_use") continue;
        const entrada = b.input as Record<string, unknown>;
        const anotar = (l: Omit<Llamada, "turno" | "herramienta">) => {
          llamadas.push({ turno, herramienta: b.name, ...l });
          if (!l.permitir) negadas.push({ tool_name: b.name });
          return l.permitir;
        };

        // 1. Hooks PreToolUse: un deny gana siempre.
        let motivo: string | null = null;
        for (const m of options?.hooks?.PreToolUse ?? []) {
          const nombres = m.matcher?.split("|");
          if (nombres !== undefined && !nombres.includes(b.name)) {
            continue;
          }
          for (const hook of m.hooks) {
            const pre: HookInput = {
              session_id: sesion,
              transcript_path: "/tmp/doble-triage.jsonl",
              cwd: options?.cwd ?? ".",
              hook_event_name: "PreToolUse",
              tool_name: b.name,
              tool_input: entrada,
              tool_use_id: b.id,
            };
            const salida = await hook(pre, b.id, {
              signal: new AbortController().signal,
            });
            motivo ??= negacion(salida);
          }
        }
        let permitir: boolean;
        if (motivo !== null) {
          permitir = anotar({ quien: "hook", permitir: false, motivo });
        } else if (options?.allowedTools?.includes(b.name)) {
          // Aprobada antes: el callback de permisos ni se entera.
          permitir = anotar({ quien: "allowedTools", permitir: true });
        } else if (options?.canUseTool !== undefined) {
          const d = await options.canUseTool(b.name, entrada, {
            signal: new AbortController().signal,
            toolUseID: b.id,
            requestId: `req-doble-${turno}`,
          });
          permitir = anotar(
            d?.behavior === "allow"
              ? { quien: "canUseTool", permitir: true }
              : {
                  quien: "canUseTool",
                  permitir: false,
                  motivo: d?.behavior === "deny" ? d.message : "",
                },
          );
        } else {
          permitir = anotar({ quien: "nadie", permitir: false });
        }
        if (!permitir) continue;

        // 2. Aprobada: corre la herramienta real, con su esquema Zod.
        const def = mesa.herramientas.find(
          (h) => PREFIJO + h.name === b.name,
        );
        const args =
          def && z.object(def.inputSchema).safeParse(entrada);
        if (def !== undefined && args?.success === true) {
          await def.handler(args.data, {});
        }
      }
      if (r.stop_reason !== "tool_use") break;
    }

    yield mensaje({
      type: "result",
      subtype: "success",
      session_id: sesion,
      num_turns: turno,
      total_cost_usd: 0,
      permission_denials: negadas,
      result: texto,
    });
  };
}
