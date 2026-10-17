import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dobleDelTriage } from "./doble-triage.js";
import { cargarCasos, crearMesa } from "./herramientas.js";
import { triar } from "./triage.js";

/**
 * El traspaso se basta solo: la fundadora no abre el caso para saber
 * si el manuscrito pasa. Corre cada caso grabado y revisa que todo
 * traspaso diga el estado de la ficha, y que coincida con lo que el
 * código anotó en el expediente.
 */

const RAIZ = fileURLToPath(new URL("../../../../", import.meta.url));
const casos = await cargarCasos();

for (const id of casos.keys()) {
  test(`${id}: el traspaso trae la ficha validada`, async () => {
    const mesa = crearMesa(RAIZ, casos);
    const i = await triar(mesa, id, dobleDelTriage(`tri-${id}`, mesa));
    const t = i.cierre?.traspaso;
    if (t === undefined) return; // Sin escalamiento, sin traspaso.
    assert.notEqual(t.ficha, "sin validar", "expediente incompleto");
    assert.ok(
      t.yaHecho.some((h) => h.endsWith(t.ficha)),
      "la ficha del traspaso no está en el expediente",
    );
  });
}
