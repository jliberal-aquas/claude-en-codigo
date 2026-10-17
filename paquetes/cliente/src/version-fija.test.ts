import test from "node:test";
import assert from "node:assert/strict";
import { diasHasta, revisar } from "./version-fija.js";

const HOY = new Date("2026-10-16T00:00:00Z");

test("cuenta los días hasta una fecha de retiro", () => {
  assert.equal(diasHasta("2026-11-30", HOY), 45);
});

test("un retiro cercano manda a migrar al reemplazo", () => {
  const linea = revisar("claude-sonnet-4-5-20250929", HOY);
  assert.match(linea, /migra a claude-sonnet-5-5/);
});

test("un retiro lejano no manda a migrar", () => {
  assert.doesNotMatch(revisar("claude-opus-5-5", HOY), /migra/);
});
