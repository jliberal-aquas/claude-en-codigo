import test from "node:test";
import assert from "node:assert/strict";
import { PATRON_CUSTOM_ID } from "./extraer.js";
import {
  customIdDe,
  elegirParaRevision,
  pendientes,
  type Estado,
} from "./lote.js";
import type { Ficha } from "./validar.js";

const IDS = Array.from(
  { length: 10 },
  (_, i) => `ms-${String(i + 1).padStart(3, "0")}`,
);
const vacio = (): Estado => ({
  enCurso: null,
  reintentos: {},
  revision: {},
});

test("la reanudación no repite lo terminado", () => {
  const hechas = new Set(["ms-001", "ms-002", "ms-004", "ms-005"]);
  assert.deepEqual(pendientes(IDS, hechas, vacio()), [
    "ms-003",
    "ms-006",
    "ms-007",
    "ms-008",
    "ms-009",
    "ms-010",
  ]);
});

test("lo que espera a una persona no se reenvía", () => {
  const estado = vacio();
  estado.revision["ms-006"] = "petición inválida";
  const faltan = pendientes(IDS, new Set(), estado);
  assert.ok(!faltan.includes("ms-006"));
  assert.equal(faltan.length, 9);
});

test("el reintento tiene su propio custom_id, válido", () => {
  assert.equal(customIdDe("ms-003", true), "ms-003-r1");
  assert.match(customIdDe("ms-003", true), PATRON_CUSTOM_ID);
  assert.throws(() => customIdDe("ms 003", false));
});

function ficha(cambios: Partial<Ficha>): Ficha {
  return {
    titulo: "t",
    firma: "f",
    genero: "realismo",
    genero_detalle: null,
    resumen: "r",
    premios: null,
    editorial_previa: null,
    notas_del_autor: null,
    confianza: "alta",
    ...cambios,
  };
}

test("revisión: todo lo de riesgo y dos al azar", () => {
  const fichas = new Map<string, Ficha>(
    IDS.map((id) => [id, ficha({})]),
  );
  fichas.set("ms-010", ficha({ confianza: "baja" }));
  fichas.set("ms-008", ficha({ genero: "otro", genero_detalle: "x" }));
  const dato = { texto: "Premio", anio: null, cita: "una cita larga" };
  fichas.set("ms-002", ficha({ premios: dato }));
  const una = elegirParaRevision(fichas);
  const otra = elegirParaRevision(fichas);
  assert.deepEqual(una, otra);
  const ids = una.map((p) => p.id);
  for (const id of ["ms-002", "ms-008", "ms-010"]) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(
    una.filter((p) => p.motivo.startsWith("al azar")).length,
    2,
  );
});
