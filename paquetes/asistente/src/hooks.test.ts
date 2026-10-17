import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  HookInput,
  HookJSONOutput,
  Options,
} from "@anthropic-ai/claude-agent-sdk";
import { opcionesDelAsistente } from "./asistente.js";
import { TIEMPO_LIMITE, crearHookFicha } from "./hooks.js";

/**
 * Pruebas del hook del SDK con dobles: el SDK no corre. Las entradas
 * son objetos con la forma documentada de PreToolUse (sintéticos), y
 * `aplicarPreToolUse` hace de doble del SDK: elige por matcher los
 * hooks que registraste en las opciones y los llama.
 */

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));
const FICHA = `${RAIZ}manuscritos/fichas/ms-004.json`;

/** Doble de la entrada que el SDK le pasa a un hook PreToolUse. */
const entradaWrite = (ruta: string, contenido: string): HookInput => ({
  session_id: "ses-doble",
  transcript_path: "/tmp/doble.jsonl",
  cwd: RAIZ,
  hook_event_name: "PreToolUse",
  tool_name: "Write",
  tool_input: { file_path: ruta, content: contenido },
  tool_use_id: "toolu-doble",
});

const senal = { signal: new AbortController().signal };

/** Qué decidió un hook: deny con su motivo, o nada. */
function decision(salida: HookJSONOutput): string | null {
  if (!("hookSpecificOutput" in salida)) return null;
  const h = salida.hookSpecificOutput;
  if (h?.hookEventName !== "PreToolUse") return null;
  return h.permissionDecision === "deny"
    ? `deny: ${h.permissionDecisionReason ?? ""}`
    : null;
}

/** Doble del SDK: corre los PreToolUse cuyo matcher calza. */
async function aplicarPreToolUse(
  opciones: Options,
  entrada: HookInput & { tool_name: string },
): Promise<string[]> {
  const decisiones: string[] = [];
  for (const m of opciones.hooks?.PreToolUse ?? []) {
    // Solo letras y |: lista de nombres exactos.
    const nombres = (m.matcher ?? "").split("|");
    if (m.matcher !== undefined && !nombres.includes(entrada.tool_name)) {
      continue;
    }
    for (const hook of m.hooks) {
      const d = decision(await hook(entrada, "toolu-doble", senal));
      if (d !== null) decisiones.push(d);
    }
  }
  return decisiones;
}

const hook = crearHookFicha(RAIZ);
const valida = () => readFile(FICHA, "utf8");

test("una ficha válida pasa sin decisión: {}", async () => {
  const salida = await hook(
    entradaWrite(FICHA, await valida()),
    "toolu-doble",
    senal,
  );
  assert.deepEqual(salida, {});
});

test("un premio sin cita en el manuscrito se niega", async () => {
  const ficha = JSON.parse(await valida()) as Record<string, unknown>;
  ficha["premios"] = {
    texto: "Premio Nacional de Cuento",
    anio: 2019,
    cita: "ganó el Premio Nacional de Cuento en 2019",
  };
  const salida = await hook(
    entradaWrite(FICHA, JSON.stringify(ficha)),
    "toolu-doble",
    senal,
  );
  const d = decision(salida) ?? "";
  assert.match(d, /^deny: ms-004: no pasa la capa de sentido/);
  assert.match(d, /premios\.cita/);
});

test("un contenido que no es JSON se niega", async () => {
  const salida = await hook(
    entradaWrite(FICHA, "{ titulo: sin comillas"),
    "toolu-doble",
    senal,
  );
  assert.match(decision(salida) ?? "", /no es JSON válido/);
});

test("fuera de manuscritos/fichas/ el hook no opina", async () => {
  const salida = await hook(
    entradaWrite(`${RAIZ}landing/src/pages/x.json`, "no es JSON"),
    "toolu-doble",
    senal,
  );
  assert.deepEqual(salida, {});
});

test("las opciones registran el hook con matcher y tiempo", () => {
  const o = opcionesDelAsistente({ pedido: "x", raiz: RAIZ });
  const grupo = o.hooks?.PreToolUse?.[0];
  assert.equal(grupo?.matcher, "Write");
  assert.equal(grupo?.timeout, TIEMPO_LIMITE);
  assert.equal(grupo?.hooks.length, 1);
});

test("con el doble del SDK, un Read no dispara el hook", async () => {
  const o = opcionesDelAsistente({ pedido: "x", raiz: RAIZ });
  const leer = {
    ...entradaWrite(FICHA, "no es JSON"),
    tool_name: "Read",
  };
  const escribir = entradaWrite(FICHA, "no es JSON") as HookInput & {
    tool_name: string;
  };
  assert.deepEqual(await aplicarPreToolUse(o, leer), []);
  assert.equal((await aplicarPreToolUse(o, escribir)).length, 1);
});
