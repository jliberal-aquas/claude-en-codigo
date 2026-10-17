import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  leerPase,
  Revision,
  SalidaInvalida,
  SegundoPase,
  veredicto,
} from "./hallazgos.js";
import { leerWorkflow } from "./verificar-workflows.js";

const RAIZ = process.cwd();
const FIX = path.join(RAIZ, "fixtures", "revision");
const leer = (f: string) => readFile(path.join(FIX, f), "utf8");

/** Comprueba que `fn` lance `SalidaInvalida` con este motivo. */
function invalida(fn: () => unknown, motivo: RegExp): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof SalidaInvalida, "no es SalidaInvalida");
    assert.match(e.motivo, motivo);
    return true;
  });
}

test("viernes: los dos hallazgos críticos bloquean", async () => {
  const r = leerPase("p1", await leer("pase1-viernes.json"), Revision);
  const s = leerPase(
    "p2",
    await leer("pase2-viernes.json"),
    SegundoPase,
  );
  const v = veredicto(r, s);
  assert.equal(v.codigo, 1);
  const bloquean = v.lineas.filter((l) => l.startsWith("BLOQUEA"));
  assert.equal(bloquean.length, 2);
});

test("texto libre: falla con nombre, no aprueba", async () => {
  const texto = await leer("pase1-texto.json");
  invalida(
    () => leerPase("p1", texto, Revision),
    /sin structured_output/,
  );
});

test("sin credencial (salida real): falla con nombre", async () => {
  const texto = await leer("sin-credencial.json");
  invalida(() => leerPase("p1", texto, Revision), /Not logged in/);
});

test("fuera del esquema: dice qué campos", async () => {
  const texto = await leer("pase1-fuera-de-esquema.json");
  invalida(
    () => leerPase("p1", texto, Revision),
    /hallazgos\.0\.severidad, hallazgos\.0\.evidencia/,
  );
});

test("lo que no es JSON: falla con nombre", () => {
  invalida(() => leerPase("p1", "Todo bien.", Revision), /no es JSON/);
});

test("un crítico refutado por el segundo pase no bloquea", async () => {
  const r = leerPase("p1", await leer("pase1-viernes.json"), Revision);
  const s = leerPase(
    "p2",
    await leer("pase2-refuta.json"),
    SegundoPase,
  );
  const v = veredicto(r, s);
  // El 0 se refutó; el 1 no se mencionó: lo que no se refuta, cuenta.
  assert.equal(v.codigo, 1);
  assert.match(v.lineas[0] ?? "", /^REFUTADO/);
  assert.match(v.lineas[1] ?? "", /^BLOQUEA/);
});

test("confirmar un hallazgo que no existe invalida el pase", () => {
  const r: Revision = { hallazgos: [] };
  const s: SegundoPase = {
    confirmaciones: [{ indice: 3, confirmado: true, motivo: "x" }],
  };
  invalida(() => veredicto(r, s), /solo hay 0/);
});

test("el esquema que recibe --json-schema exige hallazgos", () => {
  const e = z.toJSONSchema(Revision) as { required?: string[] };
  assert.deepEqual(e.required, ["hallazgos"]);
});

/**
 * Corre los pasos `pase1`, `pase2` y `veredicto` de revision.yml tal
 * como están escritos, con bash, y con un `claude` falso en el PATH:
 * el doble. Devuelve el paso que falló (o null) y lo que imprimió.
 */
async function simular(pase1: string, pase2: string) {
  const w = await leerWorkflow(
    path.join(RAIZ, ".github", "workflows", "revision.yml"),
  );
  const pasos = w.jobs["revision-claude"]?.steps ?? [];
  const dir = await mkdtemp(path.join(tmpdir(), "revision-"));
  const bin = path.join(dir, "claude");
  const doble = path.join(RAIZ, "herramientas", "doble-claude.ts");
  await writeFile(bin, `#!/bin/sh\nexec npx tsx "${doble}" "$@"\n`);
  await chmod(bin, 0o755);
  const diff = await leer("viernes.diff");
  await writeFile(path.join(dir, "diff.txt"), diff);

  let salida = "";
  for (const id of ["pase1", "pase2", "veredicto"]) {
    const run = pasos.find((p) => p.id === id)?.run;
    assert.ok(run, `revision.yml no tiene el paso ${id}`);
    const r = spawnSync("bash", ["-e", "-c", run], {
      cwd: RAIZ,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env["PATH"] ?? ""}`,
        REVISION_DIR: dir,
        ANTHROPIC_API_KEY: "doble",
        DOBLE_PASE1: path.join(FIX, pase1),
        DOBLE_PASE2: path.join(FIX, pase2),
      },
    });
    salida += r.stdout + r.stderr;
    if (r.status !== 0) return { fallo: id, codigo: r.status, salida };
  }
  return { fallo: null, codigo: 0, salida };
}

test("revision.yml con el doble: viernes en rojo", async () => {
  const r = await simular("pase1-viernes.json", "pase2-viernes.json");
  assert.equal(r.fallo, "veredicto");
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /veredicto: 1 · 2 bloquean/);
});

test("revision.yml con el doble: texto libre en rojo", async () => {
  const r = await simular("pase1-texto.json", "pase2-viernes.json");
  assert.equal(r.fallo, "pase2");
  assert.equal(r.codigo, 2);
  assert.match(r.salida, /REVISIÓN INVÁLIDA · primer pase/);
});
