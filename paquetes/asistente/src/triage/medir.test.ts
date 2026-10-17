import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dobleDelTriage } from "./doble-triage.js";
import { cargarCasos, crearMesa } from "./herramientas.js";
import { medir } from "./medir.js";
import { triar, type Informe } from "./triage.js";

/** La medición sobre los ocho casos grabados, con la compuerta. */

const RAIZ = fileURLToPath(new URL("../../../../", import.meta.url));

test("medición: resueltos, abiertos y escalamientos", async () => {
  const casos = await cargarCasos();
  const mesa = crearMesa(RAIZ, casos);
  const informes: Informe[] = [];
  for (const id of casos.keys()) {
    const doble = dobleDelTriage(`tri-${id}`, mesa);
    informes.push(await triar(mesa, id, doble));
  }
  const m = medir(informes, casos);
  assert.equal(m.total, 8);
  assert.equal(m.tasaResolucion, 3 / 8);
  assert.equal(m.abiertos, 1);
  assert.deepEqual(m.faltaron, ["salta"]);
  assert.deepEqual(m.sobraron, []);
});
