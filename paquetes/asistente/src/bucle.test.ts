import test from "node:test";
import assert from "node:assert/strict";
import {
  crearContexto,
  ejecutar,
  type Contexto,
} from "../../cliente/src/herramientas/ejecutar.js";
import {
  clientePorTurnos,
  correrBucle,
  PEDIDO,
  TOPE_DE_TURNOS,
} from "./bucle.js";

/**
 * Las respuestas del modelo son grabaciones sintéticas; el bucle, el
 * despachador y el registro corren de verdad.
 */
async function correr(nombre: string) {
  const ctx = crearContexto();
  const final = await correrBucle({
    cliente: await clientePorTurnos(`bucle-${nombre}`),
    pedido: PEDIDO,
    contexto: ctx,
  });
  return { final, ctx };
}

/** El género de ms-010 según el registro, no según el texto. */
async function generoRegistrado(ctx: Contexto): Promise<unknown> {
  const r = await ejecutar(
    { id: "toolu_prueba", name: "leer_ficha", input: { id: "ms-010" } },
    ctx,
  );
  return JSON.parse(String(r.content))["genero"];
}

test("texto y pedido en el mismo turno: el bucle sigue", async () => {
  const { final, ctx } = await correr("ficha");
  assert.equal(final.motivo, "end_turn");
  assert.equal(final.ok, true);
  assert.equal(final.turnos, 4);
  assert.equal(await generoRegistrado(ctx), "otro");
});

test("cada pedido, respondido en el mensaje siguiente", async () => {
  const { final } = await correr("ficha");
  const roles = final.messages.map((m) => m.role);
  // El pedido, tres pares (turno del modelo, resultados) y el final.
  assert.deepEqual(roles, [
    "user", "assistant", "user", "assistant", "user",
    "assistant", "user", "assistant",
  ]);
  for (let i = 1; i < final.messages.length - 1; i += 2) {
    const pedidos = final.messages[i]?.content;
    const resultados = final.messages[i + 1]?.content;
    assert.ok(Array.isArray(pedidos) && Array.isArray(resultados));
    const ids = pedidos.flatMap((b) =>
      b.type === "tool_use" ? [b.id] : [],
    );
    const respondidos = resultados.flatMap((b) =>
      b.type === "tool_result" ? [b.tool_use_id] : [],
    );
    assert.deepEqual(respondidos, ids);
    assert.equal(respondidos.length, resultados.length);
  }
});

test("pide lo mismo sin parar: tope_de_turnos, no éxito", async () => {
  const { final, ctx } = await correr("repite");
  assert.equal(final.ok, false);
  assert.equal(final.motivo, "tope_de_turnos");
  assert.equal(final.turnos, TOPE_DE_TURNOS);
  assert.equal(await generoRegistrado(ctx), null);
});

test("cortada a medias: respuesta_cortada, no éxito", async () => {
  const { final, ctx } = await correr("corta");
  assert.equal(final.ok, false);
  assert.equal(final.motivo, "respuesta_cortada");
  assert.equal(final.turnos, 3);
  // Lo ya ejecutado no se deshace: el registro quedó hecho.
  assert.equal(await generoRegistrado(ctx), "otro");
});

test("negativa a medias: negativa, con el registro vacío", async () => {
  const { final, ctx } = await correr("niega");
  assert.equal(final.ok, false);
  assert.equal(final.motivo, "negativa");
  assert.equal(await generoRegistrado(ctx), null);
});
