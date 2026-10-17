import test from "node:test";
import assert from "node:assert/strict";
import { crearCliente } from "./crear-cliente.js";
import { llamar, type ResultadoLlamada } from "./llamar.js";

const RUTA = "manuscritos/entrada/ms-004.md";

/**
 * Una ejecución. En modo grabado, `variante` elige qué grabación se
 * lee (`a`, `b`, `c`); con la API real se ignora: cada llamada es otra.
 */
async function ejecutar(variante: string): Promise<ResultadoLlamada> {
  const cliente = crearCliente({ grabacion: "ms-004", variante });
  return llamar(cliente, RUTA);
}

/**
 * PROMETIDO: lo que la API documenta de toda respuesta. `type` y
 * `role`, un `content` que es una lista, un `stop_reason` de texto y
 * un `usage` con números. Si esto falla, algo está roto. No exige
 * `end_turn` ni un bloque `text`: un `refusal` puede no traerlo.
 */
export function exigirLoPrometido(r: ResultadoLlamada): void {
  const m = r.respuesta;
  assert.equal(m.type, "message");
  assert.equal(m.role, "assistant");
  assert.ok(Array.isArray(m.content), "content no es una lista");
  assert.equal(typeof m.stop_reason, "string");
  assert.equal(typeof m.usage.input_tokens, "number");
  assert.equal(typeof m.usage.output_tokens, "number");
}

/** Los siete valores de `stop_reason` que la API lista hoy. */
const STOP_REASONS: readonly (string | null)[] = [
  "end_turn",
  "max_tokens",
  "stop_sequence",
  "tool_use",
  "pause_turn",
  "refusal",
  "model_context_window_exceeded",
];

/**
 * ESPERADO, NO PROMETIDO: es verdad hoy y sería raro que cambiara,
 * pero la API no lo garantiza. Un valor nuevo de `stop_reason` o un
 * bloque `text` vacío no violan nada documentado. Si esto falla,
 * revisa la documentación antes de culpar a tu código.
 */
export function esperarLoHabitual(r: ResultadoLlamada): void {
  assert.ok(
    STOP_REASONS.includes(r.respuesta.stop_reason),
    `stop_reason fuera de la lista: ${r.respuesta.stop_reason}`,
  );
  if (r.tiposDeBloque.includes("text")) {
    assert.ok(r.texto.length > 0, "hay bloque text y no se extrajo");
  }
}

for (const g of ["a", "b", "c"]) {
  test(`grabación ${g}: estructura documentada`, async () => {
    const r = await ejecutar(g);
    exigirLoPrometido(r);
    esperarLoHabitual(r);
  });
}
