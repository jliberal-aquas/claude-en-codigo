import test from "node:test";
import assert from "node:assert/strict";
import {
  bloqueDocumento,
  bloqueImagen,
  LIMITE_PETICION_BYTES,
  peticionConPdf,
  tokensDeImagen,
} from "./adjuntos.js";
import { crearCliente } from "./crear-cliente.js";
import { eco, iniciarServidorFalso } from "./servidor-falso.js";

const PDF = Buffer.from("%PDF-1.4\nsintético\n", "latin1");

test("el bloque de documento lleva el PDF en base64", () => {
  const b = bloqueDocumento(PDF);
  assert.equal(b.type, "document");
  assert.ok(b.source.type === "base64");
  assert.equal(b.source.media_type, "application/pdf");
  const bytes = Buffer.from(b.source.data, "base64");
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("la imagen declara su tipo y la costea en parches", () => {
  const b = bloqueImagen(Buffer.from("x"), "image/png");
  assert.ok(b.source.type === "base64");
  assert.equal(b.source.media_type, "image/png");
  assert.equal(tokensDeImagen(2000, 1500), 72 * 54);
});

test("un PDF que no cabe en la petición se rechaza antes", () => {
  const casiTodo = Math.ceil((LIMITE_PETICION_BYTES * 3) / 4) + 3;
  assert.throws(
    () => bloqueDocumento(Buffer.alloc(casiTodo)),
    /admite/,
  );
});

test("el servidor falso recibe el PDF entero y el texto", async () => {
  const servidor = await iniciarServidorFalso([eco()]);
  const cliente = crearCliente({ baseURL: servidor.url });
  const r = await cliente.messages.create(peticionConPdf(PDF, "¿?"));
  await servidor.cerrar();
  const texto = r.content.find((b) => b.type === "text");
  assert.ok(texto?.type === "text");
  assert.match(texto.text, /- document: application\/pdf, 19 bytes/);
  assert.match(texto.text, /empieza por %PDF-\n- text$/);
});
