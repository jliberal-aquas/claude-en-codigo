import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import {
  APROBADAS,
  INTEGRADAS,
  correrAsistente,
  opcionesDelAsistente,
} from "./asistente.js";
import { dobleDeQuery, type Registro } from "./doble-sdk.js";

/**
 * Pruebas del asistente con un doble de `query()`: el bucle no corre
 * (eso lo hace el SDK), pero sí tus opciones, tu callback y tu
 * informe. Sin red y sin credencial.
 */

const existe = (ruta: string) =>
  access(ruta).then(
    () => true,
    () => false,
  );

/** El pedido del guion: escribir una ficha en `ruta`, absoluta. */
const fichaEn = (raiz: string, ruta: string) => ({
  herramienta: "Write",
  entrada: { file_path: join(raiz, ruta), content: '{"id":"ms-004"}' },
});
const LANDING = "landing/src/pages/ms-004.json";

test("las opciones no dan Bash ni aprueban Write", () => {
  const o = opcionesDelAsistente({ pedido: "x", raiz: "/repo" });
  assert.equal(o.cwd, "/repo/manuscritos");
  assert.deepEqual(o.tools, INTEGRADAS);
  assert.ok(!INTEGRADAS.includes("Bash"));
  assert.deepEqual(o.allowedTools, APROBADAS);
  assert.ok(!APROBADAS.includes("Write"));
  assert.equal(o.permissionMode, "default");
  assert.deepEqual(Object.keys(o.mcpServers ?? {}), [
    "catalogo",
    "editorial",
  ]);
  assert.equal(o.maxBudgetUsd, 0.5);
});

test("el callback niega la ficha en landing/", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "asistente-"));
  const registro: Registro = { decisiones: [] };
  const informe = await correrAsistente(
    { pedido: "Guarda la ficha de ms-004", raiz },
    dobleDeQuery({ pedidos: [fichaEn(raiz, LANDING)] }, registro),
  );
  assert.equal(registro.decisiones[0]?.decision, "deny");
  assert.equal(informe.negadas[0], "Write");
  assert.equal(
    await existe(join(raiz, LANDING)),
    false,
  );
});

test("si el callback permite todo, cae en landing/", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "asistente-"));
  const permitirTodo: CanUseTool = async (_h, entrada) => ({
    behavior: "allow",
    updatedInput: entrada,
  });
  await correrAsistente(
    {
      pedido: "Guarda la ficha de ms-004",
      raiz,
      permisos: permitirTodo,
    },
    dobleDeQuery(
      { pedidos: [fichaEn(raiz, LANDING)] },
      { decisiones: [] },
    ),
  );
  assert.equal(
    await existe(join(raiz, LANDING)),
    true,
  );
});

test("un error deja estado y sesión aunque lance", async () => {
  const informe = await correrAsistente(
    { pedido: "x", raiz: "/repo" },
    dobleDeQuery(
      { pedidos: [], final: "error_max_turns" },
      { decisiones: [] },
    ),
  );
  assert.equal(informe.estado, "error_max_turns");
  assert.equal(informe.sesion, "ses-doble-0001");
  assert.ok(informe.error !== undefined);
});

test("reanudar y bifurcar llegan a las opciones", () => {
  const o = opcionesDelAsistente({
    pedido: "x",
    raiz: "/repo",
    reanudar: "ses-anterior",
    bifurcar: true,
  });
  assert.equal(o.resume, "ses-anterior");
  assert.equal(o.forkSession, true);
});

test("el costo por mensaje no repite un id", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "asistente-"));
  const ficha = fichaEn(raiz, "manuscritos/fichas/ms-004.json");
  const informe = await correrAsistente(
    { pedido: "x", raiz },
    dobleDeQuery(
      {
        pedidos: [ficha, ficha],
        repetirMensaje: true,
        costoUsd: 0.04,
      },
      { decisiones: [] },
    ),
  );
  assert.equal(informe.porMensaje.length, 2);
  assert.equal(informe.costoUsd, 0.04);
  assert.equal(informe.estado, "success");
});
