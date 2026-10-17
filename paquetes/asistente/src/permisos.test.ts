import { test } from "node:test";
import assert from "node:assert/strict";
import { crearPermisos, dentroDe } from "./permisos.js";

/**
 * Pruebas del callback de permisos, sin SDK, sin red y sin modelo: el
 * callback es una función, y se llama como la llamaría el SDK.
 */

const RAIZ = "/repo";
const permisos = crearPermisos(RAIZ);
const opciones = {
  signal: new AbortController().signal,
  toolUseID: "toolu-prueba",
  requestId: "req-prueba",
};

const decidir = (
  herramienta: string,
  entrada: Record<string, unknown>,
) => permisos(herramienta, entrada, opciones);

test("permite una ficha JSON en manuscritos/fichas/", async () => {
  const relativa = await decidir("Write", {
    file_path: "fichas/ms-004.json",
    content: "{}",
  });
  const absoluta = await decidir("Write", {
    file_path: "/repo/manuscritos/fichas/ms-004.json",
    content: "{}",
  });
  assert.equal(relativa?.behavior, "allow");
  assert.equal(absoluta?.behavior, "allow");
});

test("niega escribir en landing/ y dice dónde sí", async () => {
  const r = await decidir("Write", {
    file_path: "/repo/landing/src/pages/ms-004.json",
    content: "{}",
  });
  assert.equal(r?.behavior, "deny");
  assert.match(
    r?.behavior === "deny" ? r.message : "",
    /manuscritos\/fichas\//,
  );
});

test("niega salir de la carpeta con ..", async () => {
  const r = await decidir("Edit", {
    file_path: "fichas/../../.env",
  });
  assert.equal(r?.behavior, "deny");
});

test("niega escribir algo que no es una ficha JSON", async () => {
  const r = await decidir("Write", {
    file_path: "fichas/notas.md",
    content: "",
  });
  assert.equal(r?.behavior, "deny");
});

test("permite leer un manuscrito y niega leer .env", async () => {
  const si = await decidir("Read", {
    file_path: "entrada/ms-004.md",
  });
  const no = await decidir("Read", { file_path: "/repo/.env" });
  assert.equal(si?.behavior, "allow");
  assert.equal(no?.behavior, "deny");
});

test("niega una herramienta que no es del asistente", async () => {
  const r = await decidir("Bash", { command: "rm -rf landing" });
  assert.equal(r?.behavior, "deny");
});

test("dentroDe no confunde la carpeta con un prefijo", () => {
  const fichas = "manuscritos/fichas";
  assert.equal(dentroDe(RAIZ, fichas, "fichas/a.json"), true);
  assert.equal(dentroDe(RAIZ, fichas, "fichas-viejas/a.json"), false);
  assert.equal(dentroDe(RAIZ, fichas, `/repo/${fichas}/a.json`), true);
});
