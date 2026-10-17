import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
  HookCallback,
  HookJSONOutput,
  Options,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import {
  CARPETA_ENTRADA,
  RUTA_ESQUEMA,
  cargarEsquema,
  validarFicha,
} from "../../extractor/src/validar.js";
import { ESCRITURA, dentroDe } from "./permisos.js";

/**
 * El PreToolUse de las fichas, portado al Agent SDK. En Claude Code es
 * un script que lee stdin y sale con 2; aquí es una función que recibe
 * la entrada como objeto y devuelve el mismo JSON de decisión. Valida
 * cada Write sobre manuscritos/fichas/ con las dos capas del capítulo
 * 12 (esquema y sentido), contra el manuscrito de esa ficha.
 */

/**
 * Segundos. En el SDK, un callback que no responde a tiempo impide la
 * herramienta: si el disco se cuelga, la ficha no se escribe.
 */
export const TIEMPO_LIMITE = 10;

const negar = (motivo: string): HookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    // Lo lee Claude: que diga qué corregir.
    permissionDecisionReason: motivo,
  },
});

/** Revisa una ficha antes de escribirla. Sin problemas, `null`. */
export async function revisarFicha(
  raiz: string,
  ruta: string,
  contenido: string,
): Promise<string | null> {
  const id = basename(ruta, ".json");
  let valor: unknown;
  try {
    valor = JSON.parse(contenido);
  } catch {
    return `${id}: el contenido no es JSON válido.`;
  }
  if (typeof valor !== "object" || valor === null) {
    return `${id}: una ficha es un objeto JSON.`;
  }
  // El id lo pone tu programa y no está en el esquema (capítulo 12).
  const { id: suyo, ...ficha } = valor as Record<string, unknown>;
  if (suyo !== id) {
    return `${id}: el campo id dice ${String(suyo)}; debe decir ${id}.`;
  }
  let manuscrito: string;
  try {
    const texto = resolve(raiz, CARPETA_ENTRADA, `${id}.md`);
    manuscrito = await readFile(texto, "utf8");
  } catch {
    return `${id}: no existe ${CARPETA_ENTRADA}/${id}.md para cotejar.`;
  }
  const esquema = await cargarEsquema(resolve(raiz, RUTA_ESQUEMA));
  const r = validarFicha(ficha, esquema, manuscrito);
  if (r.ok) return null;
  const errores = r.errores.map((e) => `${e.campo}: ${e.mensaje}`);
  return (
    `${id}: no pasa la capa de ${r.capa}. ${errores.join("; ")}. ` +
    "Corrige la ficha y vuelve a escribirla."
  );
}

/** El callback: solo mira Write de fichas JSON; el resto, `{}`. */
export function crearHookFicha(raiz: string): HookCallback {
  return async (entrada) => {
    if (entrada.hook_event_name !== "PreToolUse") return {};
    const pre = entrada as PreToolUseHookInput;
    const herramienta = pre.tool_input as Record<string, unknown>;
    const ruta = herramienta["file_path"];
    if (pre.tool_name !== "Write" || typeof ruta !== "string") {
      return {};
    }
    if (!dentroDe(raiz, ESCRITURA, ruta) || !ruta.endsWith(".json")) {
      // Fuera de las fichas decide el callback de permisos, no este.
      return {};
    }
    const contenido = String(herramienta["content"] ?? "");
    const motivo = await revisarFicha(raiz, ruta, contenido);
    // `{}` no aprueba: deja seguir el flujo normal de permisos.
    return motivo === null ? {} : negar(motivo);
  };
}

/** Los hooks del asistente, listos para `options.hooks`. */
export function hooksDelAsistente(raiz: string): Options["hooks"] {
  return {
    PreToolUse: [
      {
        matcher: "Write",
        hooks: [crearHookFicha(raiz)],
        timeout: TIEMPO_LIMITE,
      },
    ],
  };
}
