import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Pruebas de los hooks del capítulo 18, ejecutados de verdad: cada
 * prueba lanza el script como lo lanzaría Claude Code, con el evento
 * en JSON por stdin, y mira el código de salida, stdout y el disco.
 * Lo que Claude Code hace con esa respuesta no se prueba aquí: lo
 * dice la documentación.
 */

const CARPETA = ".claude/hooks";
const PERMISO = `${CARPETA}/permiso-landing.ts`;
const COMPACTAR = `${CARPETA}/compactacion.ts`;

interface Corrida {
  codigo: number | null;
  salida: string;
}

function correr(
  script: string,
  evento: unknown,
  entorno: Record<string, string> = {},
): Corrida {
  const r = spawnSync(process.execPath, ["--import", "tsx", script], {
    input: typeof evento === "string" ? evento : JSON.stringify(evento),
    encoding: "utf8",
    // Sin CLAUDE_PROJECT_DIR heredado: la raíz sale del evento.
    env: { PATH: process.env["PATH"] ?? "", ...entorno },
  });
  return { codigo: r.status, salida: r.stdout };
}

const pedido = (herramienta: string, ruta: string) => ({
  session_id: "ses-prueba",
  cwd: "/repo",
  hook_event_name: "PermissionRequest",
  tool_name: herramienta,
  tool_input: { file_path: ruta, content: "x" },
});

test("permiso en landing/: niega con JSON y sale con 0", () => {
  const r = correr(PERMISO, pedido("Edit", "/repo/landing/a.mjs"));
  assert.equal(r.codigo, 0, "en PermissionRequest, 2 no se respeta");
  const salida = JSON.parse(r.salida) as {
    hookSpecificOutput: {
      hookEventName: string;
      decision: { behavior: string; message: string };
    };
  };
  const h = salida.hookSpecificOutput;
  assert.equal(h.hookEventName, "PermissionRequest");
  assert.equal(h.decision.behavior, "deny");
  assert.match(h.decision.message, /landing\//);
});

test("permiso fuera de landing/: no imprime nada", () => {
  const r = correr(
    PERMISO,
    pedido("Write", "/repo/manuscritos/fichas/ms-004.json"),
  );
  assert.equal(r.codigo, 0);
  assert.equal(r.salida, "");
});

test("landing-vieja/ no es landing/, y ../ no engaña", () => {
  const vieja = correr(
    PERMISO,
    pedido("Write", "/repo/landing-vieja/a"),
  );
  const vuelta = correr(
    PERMISO,
    pedido("Write", "/repo/docs/../landing/b.astro"),
  );
  assert.equal(vieja.salida, "");
  assert.match(vuelta.salida, /"deny"/);
});

test("una entrada rota hace fallar al script, sin un 2", () => {
  const r = correr(PERMISO, "esto no es JSON");
  assert.notEqual(r.codigo, 0);
  assert.notEqual(r.codigo, 2);
});

test("PreCompact copia la conversación y anota el índice", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "compactar-"));
  await writeFile(join(raiz, "t.jsonl"), '{"rol":"user"}\n');
  const r = correr(
    COMPACTAR,
    {
      session_id: "ses-1",
      transcript_path: join(raiz, "t.jsonl"),
      cwd: raiz,
      hook_event_name: "PreCompact",
      trigger: "auto",
      custom_instructions: null,
    },
    { CLAUDE_PROJECT_DIR: raiz },
  );
  assert.equal(r.codigo, 0);
  const carpeta = join(raiz, ".claude/compactaciones");
  const copias = (await readdir(carpeta)).filter((f) =>
    f.endsWith("-antes.jsonl"),
  );
  assert.equal(copias.length, 1);
  const copia = await readFile(join(carpeta, copias[0] ?? ""), "utf8");
  assert.equal(copia, '{"rol":"user"}\n');
  const indice = await readFile(join(carpeta, "indice.md"), "utf8");
  assert.match(indice, /PreCompact · auto\n/);
  assert.match(indice, /instrucciones: ninguna/);
});

test("PostCompact guarda el resumen de la compactación", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "compactar-"));
  const r = correr(COMPACTAR, {
    session_id: "ses-2",
    cwd: raiz,
    hook_event_name: "PostCompact",
    trigger: "manual",
    compact_summary: "Quedan ms-005 y ms-006.",
  });
  assert.equal(r.codigo, 0);
  const carpeta = join(raiz, ".claude/compactaciones");
  const resumen = (await readdir(carpeta)).find((f) =>
    f.endsWith("-resumen.md"),
  );
  const texto = await readFile(join(carpeta, resumen ?? ""), "utf8");
  assert.equal(texto, "Quedan ms-005 y ms-006.\n");
});
