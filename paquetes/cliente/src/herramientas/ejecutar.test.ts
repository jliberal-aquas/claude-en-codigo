import test from "node:test";
import assert from "node:assert/strict";
import {
  crearContexto,
  ejecutar,
  ejecutarTodas,
  type Disco,
  type ErrorHerramienta,
} from "./ejecutar.js";

/** Ejecuta una llamada y devuelve el resultado ya interpretado. */
async function llamar(
  name: string,
  input: unknown,
  ctx = crearContexto(),
) {
  const r = await ejecutar({ id: "toolu_prueba", name, input }, ctx);
  assert.equal(r.tool_use_id, "toolu_prueba");
  return {
    esError: r.is_error === true,
    datos: JSON.parse(String(r.content)) as Record<string, unknown>,
  };
}

/** Un disco que falla con el código que le pidas. */
function discoQueFalla(codigo: string): Disco {
  const fallo = () =>
    Promise.reject(Object.assign(new Error(codigo), { code: codigo }));
  return { listar: fallo, leer: fallo };
}

test("sin coincidencias: lista vacía, no es un error", async () => {
  const r = await llamar("buscar_manuscrito", { texto: "terror" });
  assert.equal(r.esError, false);
  assert.deepEqual(r.datos, { coincidencias: [], total: 0 });
});

test("leer_ficha de ms-004: título y autoría", async () => {
  const r = await llamar("leer_ficha", { id: "ms-004" });
  assert.equal(r.esError, false);
  assert.equal(r.datos["titulo"], "La llave sobrante");
  assert.equal(r.datos["genero"], null);
});

test("id inexistente: validación, reintentable", async () => {
  const r = await llamar("leer_ficha", { id: "ms-099" });
  const e = r.datos as unknown as ErrorHerramienta;
  assert.equal(r.esError, true);
  assert.equal(e.categoria, "validacion");
  assert.equal(e.reintentable, true);
});

test("cambiar un género registrado: negocio", async () => {
  const ctx = crearContexto();
  const pedido = { id: "ms-004", motivo: "«abría una puerta baja»" };
  const a = await llamar(
    "registrar_genero",
    { ...pedido, genero: "realismo" },
    ctx,
  );
  assert.equal(a.esError, false);
  const b = await llamar(
    "registrar_genero",
    { ...pedido, genero: "fantasía urbana" },
    ctx,
  );
  assert.equal(b.esError, true);
  assert.equal(b.datos["categoria"], "negocio");
  assert.equal(b.datos["reintentable"], false);
});

test("escribir sin permiso: permiso", async () => {
  const r = await llamar(
    "registrar_genero",
    { id: "ms-004", genero: "realismo", motivo: "x" },
    crearContexto({ soloLectura: true }),
  );
  assert.equal(r.datos["categoria"], "permiso");
});

test("disco ocupado: transitorio, reintentable", async () => {
  const ctx = crearContexto({ disco: discoQueFalla("EBUSY") });
  const r = await llamar("buscar_manuscrito", { texto: "llave" }, ctx);
  assert.equal(r.datos["categoria"], "transitorio");
  assert.equal(r.datos["reintentable"], true);
});

test("un fallo imprevisto no corta la conversación", async () => {
  const ctx = crearContexto({ disco: discoQueFalla("ENOTDIR") });
  const r = await llamar("leer_ficha", { id: "ms-004" }, ctx);
  assert.equal(r.esError, true);
  assert.equal(r.datos["categoria"], "interno");
});

test("dos pedidos: un mensaje user, en el mismo orden", async () => {
  const content = [
    { type: "text", text: "Leo las dos fichas." },
    { type: "tool_use", id: "toolu_1", name: "leer_ficha",
      input: { id: "ms-004" } },
    { type: "tool_use", id: "toolu_2", name: "leer_ficha",
      input: { id: "ms-007" } },
  ];
  const mensaje = await ejecutarTodas(content, crearContexto());
  assert.equal(mensaje.role, "user");
  assert.ok(Array.isArray(mensaje.content));
  const ids = mensaje.content.map((b) =>
    b.type === "tool_result" ? b.tool_use_id : b.type,
  );
  assert.deepEqual(ids, ["toolu_1", "toolu_2"]);
});
