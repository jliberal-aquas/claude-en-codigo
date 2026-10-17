import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  cargarEsquema,
  validarFicha,
  type Ficha,
  type Resultado,
} from "./validar.js";

const esquema = await cargarEsquema();
const ms009 = await readFile("manuscritos/entrada/ms-009.md", "utf8");

/** Una ficha de ms-009 que pasa; cada prueba cambia un campo. */
const BUENA: Ficha = {
  titulo: "La Paciente",
  firma: "Eulalia Mendiburu",
  genero: "realismo",
  genero_detalle: null,
  resumen: "Clara hereda la balsa y evacúa la isla en una crecida.",
  premios: null,
  editorial_previa: null,
  notas_del_autor: null,
  confianza: "alta",
};

const con = (cambios: Record<string, unknown>): Resultado =>
  validarFicha({ ...BUENA, ...cambios }, esquema, ms009);

/** "capa campo" de cada error, o "ok". */
function veredicto(r: Resultado): string[] {
  return r.ok ? ["ok"] : r.errores.map((e) => `${r.capa} ${e.campo}`);
}

test("la ficha buena pasa las dos capas", () => {
  assert.deepEqual(veredicto(con({})), ["ok"]);
});

test("null en un dato de quien firma es válido", () => {
  assert.deepEqual(
    veredicto(con({ premios: null, editorial_previa: null })),
    ["ok"],
  );
});

test("un premio sin cita en el manuscrito no pasa", () => {
  const premio = {
    texto: "Premio regional de cuento",
    anio: 2019,
    cita: "obtuvo el premio regional de cuento en 2019",
  };
  assert.deepEqual(veredicto(con({ premios: premio })), [
    "sentido premios.cita",
  ]);
});

test("un año imposible no pasa aunque la cita exista", () => {
  const premio = {
    texto: "Mención",
    anio: 2999,
    cita: "Tenía treinta y siete años, Clara",
  };
  assert.deepEqual(veredicto(con({ premios: premio })), [
    "sentido premios.anio",
  ]);
});

test("el género con otra grafía no pasa el esquema", () => {
  assert.deepEqual(veredicto(con({ genero: "ciencia-ficción" })), [
    "esquema ficha.genero",
  ]);
});

test("las mayúsculas del género no cuentan", () => {
  assert.deepEqual(veredicto(con({ genero: "Realismo" })), ["ok"]);
});

test("un campo que el esquema no tiene no pasa el esquema", () => {
  assert.deepEqual(veredicto(con({ editorial: "Ribera" })), [
    "esquema ficha.editorial",
  ]);
});

test("una firma que no está en el manuscrito no pasa", () => {
  assert.deepEqual(veredicto(con({ firma: "Eulalia Mendívil" })), [
    "sentido firma",
  ]);
});

test('con género "otro" hace falta decir cuál', () => {
  assert.deepEqual(veredicto(con({ genero: "otro" })), [
    "sentido genero_detalle",
  ]);
});
