import test from "node:test";
import assert from "node:assert/strict";
import { HERRAMIENTAS } from "./definiciones.js";
import { EJECUTABLES } from "./ejecutar.js";

/**
 * Esta prueba no mide a Claude. Es una regla del libro: cada
 * descripción dice qué hace, qué devuelve, cuándo usarla y cuándo no,
 * en varias frases (eso lo pide la documentación), y dos herramientas
 * no se presentan con la misma palabra (eso es nuestro).
 */
for (const h of HERRAMIENTAS) {
  test(`${h.name}: qué devuelve, cuándo sí y cuándo no`, () => {
    const d = h.description ?? "";
    const frases = d.split(/[.?!](?:\s|$)/).filter((f) => f.trim());
    assert.ok(frases.length >= 3, `solo ${frases.length} frase(s)`);
    assert.match(d, /Devuelve/, "no dice qué devuelve");
    assert.match(d, /Úsala/, "no dice cuándo usarla");
    assert.match(d, /No la uses/, "no dice cuándo no usarla");
  });
}

test("ninguna descripción empieza con la misma palabra", () => {
  const primeras = HERRAMIENTAS.map(
    (h) => `${(h.description ?? "").split(" ")[0]} (${h.name})`,
  );
  const palabras = primeras.map((p) => p.split(" ")[0]);
  assert.equal(
    new Set(palabras).size,
    palabras.length,
    `repetidas: ${primeras.join(", ")}`,
  );
});

test("toda herramienta definida tiene quien la ejecute", () => {
  for (const h of HERRAMIENTAS) {
    assert.ok(EJECUTABLES.includes(h.name), `${h.name} sin ejecutar`);
  }
});
