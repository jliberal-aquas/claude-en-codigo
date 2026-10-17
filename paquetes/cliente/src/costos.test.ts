import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIGURACIONES,
  SUPUESTOS,
  costoPeticion,
  costoTotal,
  type Configuracion,
} from "./costos.js";

const AHORA = { vida: "5m", lote: false } as const;

function config(i: number): Configuracion {
  const c = CONFIGURACIONES[i];
  assert.ok(c, `no hay configuración ${i}`);
  return c;
}

test("un millón de tokens cuesta la tarifa, a mano", () => {
  const entrada = { input_tokens: 1_000_000, output_tokens: 0 };
  const salida = { input_tokens: 0, output_tokens: 1_000_000 };
  assert.equal(costoPeticion("claude-opus-5-5", entrada, AHORA), 4);
  assert.equal(costoPeticion("claude-opus-5-5", salida, AHORA), 20);
});

test("el razonamiento ya está dentro de output_tokens", () => {
  const uso = {
    input_tokens: 0,
    output_tokens: 1000,
    output_tokens_details: { thinking_tokens: 900 },
  };
  // Si se sumara el detalle otra vez, costaría 0,038.
  const costo = costoPeticion("claude-opus-5-5", uso, AHORA);
  assert.ok(Math.abs(costo - 0.02) < 1e-12);
});

test("el lote cuesta la mitad", () => {
  const uso = { input_tokens: 5000, output_tokens: 1200 };
  const lote = { vida: "5m", lote: true } as const;
  const normal = costoPeticion("claude-opus-5-5", uso, AHORA);
  const enLote = costoPeticion("claude-opus-5-5", uso, lote);
  assert.ok(Math.abs(enLote - normal / 2) < 1e-12);
});

test("el caché ahorra si el prefijo se repite y cuesta si no", () => {
  const s = { ...SUPUESTOS, prefijo: 4000 };
  const sin = costoTotal(config(0), s);
  const sano = costoTotal(config(3), s);
  const roto = costoTotal(config(4), s);
  assert.ok(sano < sin, "el caché sano debe ahorrar");
  assert.ok(roto > sin, "el caché roto debe costar más que nada");
});

test("bajo el mínimo de 512 tokens el caché no cambia nada", () => {
  const s = { ...SUPUESTOS, prefijo: 400 };
  assert.equal(costoTotal(config(0), s), costoTotal(config(3), s));
  assert.equal(costoTotal(config(0), s), costoTotal(config(4), s));
});
