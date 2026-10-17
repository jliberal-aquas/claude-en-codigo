import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { crearCliente } from "./crear-cliente.js";
import { llamar } from "./llamar.js";
import {
  calcularEspera,
  conReintentos,
  esperaConAzar,
  POLITICA,
} from "./reintentos.js";
import {
  errorInterno,
  exito,
  iniciarServidorFalso,
  limiteDeTasa,
  limiteSinPista,
  peticionInvalida,
  rechazo,
  sobrecarga,
  topeDeGasto,
  type Paso,
} from "./servidor-falso.js";

const RUTA = "manuscritos/entrada/ms-004.md";

/** Corre `llamar` con reintentos contra un servidor programado. */
async function correr(pasos: Paso[]) {
  const servidor = await iniciarServidorFalso(pasos);
  const cliente = crearCliente({ baseURL: servidor.url });
  const esperas: number[] = [];
  const log: string[] = [];
  let error: unknown;
  let respuesta;
  try {
    respuesta = await conReintentos(
      "ms-004",
      () => llamar(cliente, RUTA),
      {
        // Sin esperar de verdad: solo anotamos cuánto se pidió.
        dormir: async (ms) => void esperas.push(ms),
        azar: () => 1,
        registrar: (linea) => void log.push(linea),
      },
    );
  } catch (e) {
    error = e;
  }
  const peticiones = servidor.peticiones.length;
  await servidor.cerrar();
  return { peticiones, esperas, log, error, respuesta };
}

test("la espera crece al doble y se detiene en el tope", () => {
  const maximas = [0, 1, 2, 3, 6, 7, 20].map((i) =>
    esperaConAzar(i, POLITICA, () => 1),
  );
  assert.deepEqual(maximas, [
    1_000, 2_000, 4_000, 8_000, 60_000, 60_000, 60_000,
  ]);
  assert.equal(esperaConAzar(3, POLITICA, () => 0), 0);
});

test("retry-after manda sobre el azar", () => {
  // El azar pediría como mucho 1 s; el servidor pide 30.
  assert.equal(calcularEspera(0, POLITICA, 30, () => 1), 30_000);
  assert.equal(calcularEspera(0, POLITICA, null, () => 1), 1_000);
});

test("400: falla al primer intento y deja su id", async () => {
  const r = await correr([peticionInvalida()]);
  assert.equal(r.peticiones, 1);
  assert.ok(r.error instanceof Anthropic.BadRequestError);
  assert.match(r.log.join("\n"), /estado=400[^]*id=req_falso_000001/);
});

test("529: reintenta y termina bien", async () => {
  const r = await correr([sobrecarga(), sobrecarga(), exito()]);
  assert.equal(r.peticiones, 3);
  assert.equal(r.esperas.length, 2);
  assert.equal(r.respuesta?.stopReason, "end_turn");
});

test("429 con retry-after: espera lo que dice", async () => {
  const r = await correr([limiteDeTasa(2), exito()]);
  assert.equal(r.peticiones, 2);
  assert.deepEqual(r.esperas, [2_000]);
});

test("429 por tope de gasto: no se reintenta", async () => {
  const r = await correr([topeDeGasto()]);
  assert.equal(r.peticiones, 1);
  assert.ok(r.error instanceof Anthropic.RateLimitError);
});

test("429 sin retry-after ni error_code: se reintenta", async () => {
  // La documentación no dice que la falta de `retry-after` sea gasto.
  const r = await correr([limiteSinPista(), exito()]);
  assert.equal(r.peticiones, 2);
  assert.equal(r.respuesta?.stopReason, "end_turn");
});

test("500: se reintenta", async () => {
  const r = await correr([errorInterno(), exito()]);
  assert.equal(r.peticiones, 2);
});

test("529 sin fin: se rinde en el último intento", async () => {
  const r = await correr([sobrecarga()]);
  assert.equal(r.peticiones, POLITICA.intentos);
  assert.equal(r.esperas.length, POLITICA.intentos - 1);
  assert.match(r.log.at(-1) ?? "", /agotado/);
});

test("refusal llega como 200 y no se reintenta", async () => {
  const r = await correr([rechazo()]);
  assert.equal(r.peticiones, 1);
  assert.equal(r.error, undefined);
  assert.equal(r.respuesta?.stopReason, "refusal");
});
