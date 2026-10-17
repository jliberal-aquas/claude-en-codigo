import type {
  HookCallback,
  HookJSONOutput,
  Options,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import {
  MIN_CITA,
  citaEnTexto,
  normalizar,
} from "../../../cliente/src/verificar-citas.js";
import { TIEMPO_LIMITE } from "../hooks.js";
import {
  ALCANCE,
  CIERRE,
  CRITERIOS,
  NOMBRES_CRITERIOS,
  type Base,
  type Criterio,
} from "./criterios.js";
import type { Expediente } from "./expediente.js";
import { PREFIJO, type Mesa } from "./herramientas.js";

/**
 * La compuerta de prerrequisitos del triage. `decidir` es una función
 * pura: mira el expediente, que llenaron las herramientas, y dice si
 * una llamada puede correr. `crearCompuerta` la monta como hook
 * PreToolUse del SDK, que corre antes de cada llamada, también de las
 * herramientas que `allowedTools` ya aprobó.
 */

export type Decision =
  | { permitir: true }
  | { permitir: false; motivo: string };

const SI: Decision = { permitir: true };
const no = (motivo: string): Decision => ({ permitir: false, motivo });

/** Las bases que el caso incumple, comprobadas con datos. */
export function basesIncumplidas(exp: Expediente): Base[] {
  const fallas: Base[] = [];
  // Fechas AAAA-MM-DD: el orden de texto es el orden de fechas.
  if (exp.caso.recibido > CIERRE) fallas.push("plazo");
  if (exp.ficha?.ok === true && exp.ficha.editorialPrevia) {
    fallas.push("inedito");
  }
  return fallas;
}

/** ¿La evidencia sostiene el criterio? Sin evidencia, no se escala. */
function revisarEvidencia(
  exp: Expediente,
  entrada: Record<string, unknown>,
): Decision {
  const criterio = entrada["criterio"];
  if (
    typeof criterio !== "string" ||
    !(NOMBRES_CRITERIOS as string[]).includes(criterio)
  ) {
    return no(
      `«${String(criterio)}» no es un criterio escrito. Los ` +
        `criterios son: ${NOMBRES_CRITERIOS.join(", ")}. El tono no ` +
        "es uno.",
    );
  }
  const c = criterio as Criterio;
  const evidencia = String(entrada["evidencia"] ?? "");
  if (CRITERIOS[c].evidencia === "cita") {
    // Como las citas del capítulo 3: letra por letra, y no tan corta
    // que aparezca en cualquier mensaje.
    if (
      normalizar(evidencia).length < MIN_CITA ||
      !citaEnTexto(evidencia, exp.caso.mensaje)
    ) {
      return no(
        `${c} pide como evidencia una frase copiada del mensaje del ` +
          `autor, de al menos ${MIN_CITA} caracteres.`,
      );
    }
    return SI;
  }
  if (c === "genero_otro") {
    return exp.ficha?.ok === true && exp.ficha.genero === "otro"
      ? SI
      : no("genero_otro exige una ficha validada con género «otro».");
  }
  return exp.ficha?.ok === false
    ? SI
    : no("ficha_invalida exige validar_ficha con resultado inválido.");
}

export function decidir(
  exp: Expediente | undefined,
  herramienta: string,
  entrada: Record<string, unknown>,
): Decision {
  if (!(ALCANCE as readonly string[]).includes(herramienta)) {
    return no(
      `${herramienta} está fuera del alcance del triage. Si el caso ` +
        "pide algo que no puedes hacer, escala con fuera_de_alcance.",
    );
  }
  if (exp === undefined) {
    return no("No hay un caso con ese id. Usa el id que te dieron.");
  }
  if (herramienta === "leer_caso") return SI;
  if (!exp.leido) return no("Primero leer_caso.");
  if (exp.cierre !== null) {
    return no(
      `El caso ya se cerró con ${exp.cierre.salida}: una salida por ` +
        "caso.",
    );
  }
  // Pedir una aclaración o escalar no exigen la ficha: quien pide una
  // persona no espera a que validemos nada.
  if (herramienta === "pedir_aclaracion") return SI;
  if (herramienta === "escalar") return revisarEvidencia(exp, entrada);
  if (herramienta === "validar_ficha") return SI;

  // Quedan aceptar y rechazar: deciden sobre el manuscrito.
  if (exp.ficha === null) {
    return no(
      "Primero validar_ficha: no se acepta ni se rechaza sin ficha " +
        "validada.",
    );
  }
  if (!exp.ficha.ok) {
    return no(
      "La ficha no pasó la validación: escala con ficha_invalida.",
    );
  }
  if (exp.ficha.genero === "otro") {
    return no("La ficha dice «otro»: escala con genero_otro.");
  }
  const fallas = basesIncumplidas(exp);
  if (herramienta === "aceptar") {
    return fallas.length === 0
      ? SI
      : no(`Incumple la base ${fallas.join(", ")}: no se acepta.`);
  }
  const base = String(entrada["base"]);
  return fallas.includes(base as Base)
    ? SI
    : no(
        `Los datos no muestran que incumpla ${base}. Sin una base ` +
          "incumplida no se rechaza.",
      );
}

const negar = (motivo: string): HookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    // Lo lee el modelo: dice qué hacer en su lugar.
    permissionDecisionReason: motivo,
  },
});

/** El hook: corre `decidir` en cada llamada y anota lo que decidió. */
export function crearCompuerta(mesa: Mesa): HookCallback {
  return async (entrada) => {
    if (entrada.hook_event_name !== "PreToolUse") return {};
    const pre = entrada as PreToolUseHookInput;
    const nombre = pre.tool_name.startsWith(PREFIJO)
      ? pre.tool_name.slice(PREFIJO.length)
      : pre.tool_name;
    const datos = (pre.tool_input ?? {}) as Record<string, unknown>;
    const caso = typeof datos["caso"] === "string" ? datos["caso"] : "";
    const d = decidir(mesa.expedientes.get(caso), nombre, datos);
    mesa.bitacora.push({
      caso,
      herramienta: nombre,
      ...(d.permitir
        ? { permitir: true }
        : { permitir: false, motivo: d.motivo }),
    });
    // `{}` no aprueba: deja seguir el orden normal de permisos.
    return d.permitir ? {} : negar(d.motivo);
  };
}

/** Sin matcher: la compuerta ve todas las llamadas, también ajenas. */
export function hooksDelTriage(mesa: Mesa): Options["hooks"] {
  return {
    PreToolUse: [
      { hooks: [crearCompuerta(mesa)], timeout: TIEMPO_LIMITE },
    ],
  };
}
