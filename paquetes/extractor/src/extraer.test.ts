import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  crearCliente,
  type RespuestaMensaje,
} from "../../cliente/src/crear-cliente.js";
import {
  analizarRespuesta,
  armarPeticionFicha,
  armarReintento,
  cargarInstruccion,
  extraerFicha,
  mensajeReintento,
  validarEntrada,
} from "./extraer.js";
import { cargarEsquema } from "./validar.js";

const esquema = await cargarEsquema();
const plantilla = await cargarInstruccion();
const ms003 = await readFile("manuscritos/entrada/ms-003.md", "utf8");

/** Una respuesta mínima con el texto y el stop_reason que elijas. */
function respuesta(
  texto: string,
  stop_reason: RespuestaMensaje["stop_reason"],
  stop_sequence: string | null = null,
): RespuestaMensaje {
  return {
    id: "msg_prueba",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: texto, citations: null }],
    stop_reason,
    stop_sequence,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

test("una ficha cortada por max_tokens no se lee", () => {
  const a = analizarRespuesta(
    respuesta('{"titulo": "La', "max_tokens"),
  );
  assert.equal(a.ok, false);
});

test("una secuencia de parada deja la ficha a medias", () => {
  const r = respuesta('{"titulo": "La', "stop_sequence", "FIN");
  const a = analizarRespuesta(r);
  assert.ok(!a.ok && a.motivo.includes("FIN"));
});

test("un texto que no es JSON se nombra, no se adivina", () => {
  const a = analizarRespuesta(
    respuesta("Aquí va la ficha:", "end_turn"),
  );
  assert.ok(!a.ok && a.motivo === "el texto no es JSON");
});

test("la petición lleva el esquema de la ficha", () => {
  const p = armarPeticionFicha(plantilla, ms003, esquema);
  assert.deepEqual(p.output_config?.format?.schema, esquema);
  assert.match(String(p.messages[0]?.content), /^<manuscrito>/);
});

test("el reintento lleva la ficha y termina con el usuario", () => {
  const base = armarPeticionFicha(plantilla, ms003, esquema);
  const errores = [{ campo: "premios.cita", mensaje: "vacía" }];
  const r = armarReintento(base, "{}", errores, "con-errores");
  assert.deepEqual(
    r.messages.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.match(
    String(r.messages[2]?.content),
    /- premios\.cita: vacía/,
  );
});

test("el reintento ingenuo no dice qué falló", () => {
  const errores = [{ campo: "premios.cita", mensaje: "vacía" }];
  assert.doesNotMatch(mensajeReintento(errores, "ingenuo"), /premios/);
});

test("un id que no sirve de custom_id no sale", () => {
  assert.throws(() => validarEntrada("ms 003", ms003));
  assert.throws(() => validarEntrada("ms-003", "  "));
});

// Grabaciones sintéticas: prueban tu código, no al modelo.
test("ms-003 con a y c: reintento con errores, null", async () => {
  const clientes = ["a", "c"].map((variante) =>
    crearCliente({ grabacion: "ficha-ms-003", variante }),
  );
  const x = await extraerFicha(
    clientes,
    "ms-003",
    ms003,
    esquema,
    plantilla,
  );
  assert.equal(x.intentos.length, 2);
  assert.equal(x.ficha?.editorial_previa, null);
});

test("ms-003 con a y b: la editorial inventada no pasa", async () => {
  const clientes = ["a", "b"].map((variante) =>
    crearCliente({ grabacion: "ficha-ms-003", variante }),
  );
  const x = await extraerFicha(
    clientes,
    "ms-003",
    ms003,
    esquema,
    plantilla,
    "ingenuo",
  );
  assert.equal(x.ficha, null);
  const campos = x.intentos[1]?.errores.map((e) => e.campo);
  assert.ok(campos?.includes("editorial_previa.cita"));
});
