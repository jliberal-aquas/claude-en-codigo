import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  INVESTIGADOR,
  investigar,
  opcionesDelCoordinador,
} from "./coordinador.js";
import { dobleGrabado, type Bitacora } from "./doble-grabado.js";
import { armarInforme, verificarProcedencia } from "./informe.js";
import { PEDIDO, guion } from "./investigar.js";
import { leerVuelta } from "./vuelta.js";

/**
 * Pruebas del coordinador con el doble grabado: las respuestas del
 * modelo son sintéticas; tu callback, tu lectura de vueltas, tu
 * informe y tu verificación corren de verdad. Sin red.
 */

const RAIZ = fileURLToPath(new URL("../../../../", import.meta.url));
const encargo = { ...PEDIDO, raiz: RAIZ };

test("Agent no se aprueba solo: cada delegación pasa por ti", () => {
  const o = opcionesDelCoordinador(encargo, new Map());
  assert.ok(!(o.allowedTools ?? []).includes("Agent"));
  assert.ok((o.tools as string[]).includes("Agent"));
  assert.deepEqual(Object.keys(o.agents ?? {}), ["investigador"]);
  assert.ok(INVESTIGADOR.prompt.includes('"estado":"ok"'));
});

test("pregunta simple: ni Agent ni subagentes", () => {
  const o = opcionesDelCoordinador(
    { ...encargo, maxSubagentes: 0 },
    new Map(),
  );
  assert.ok(!(o.tools as string[]).includes("Agent"));
  assert.equal(o.agents, undefined);
});

test("una delegación sin el id se niega, y se reescribe", async () => {
  const bitacora: Bitacora = { pedidos: [] };
  const inv = await investigar(
    encargo,
    dobleGrabado(guion(false), bitacora),
  );
  const agentes = bitacora.pedidos.filter(
    (p) => p.herramienta === "Agent",
  );
  assert.deepEqual(
    agentes.map((p) => p.decision),
    ["allow", "deny", "allow", "allow"],
  );
  const negada = inv.delegaciones[1];
  assert.equal(negada?.vuelta?.estado, "error");
});

test("un subagente que falla no tumba el informe", async () => {
  const inv = await investigar(encargo, dobleGrabado(guion(false)));
  const informe = armarInforme(PEDIDO.pregunta, inv);
  assert.equal(inv.estado, "success");
  assert.equal(informe.hallazgos.length, 7);
  assert.deepEqual(informe.faltantes, ["Tema en la landing"]);
  assert.match(informe.texto, /NO COMPROBADO\. acceso/);
});

test("dos versiones del mismo dato: se ven las dos", async () => {
  const inv = await investigar(encargo, dobleGrabado(guion(false)));
  const informe = armarInforme(PEDIDO.pregunta, inv);
  assert.deepEqual(informe.conflictos, ["género de ms-007: [3] y [4]"]);
  assert.match(informe.texto, /## Conflictos \(no se elige\)/);
});

test("cada afirmación se sostiene en su fuente", async () => {
  const inv = await investigar(encargo, dobleGrabado(guion(false)));
  const { hallazgos } = armarInforme(PEDIDO.pregunta, inv);
  const v = await verificarProcedencia(hallazgos, RAIZ);
  assert.deepEqual(v.problemas, []);
});

test("texto libre no entra como hallazgo", async () => {
  const inv = await investigar(encargo, dobleGrabado(guion(true)));
  const informe = armarInforme(PEDIDO.pregunta, inv);
  assert.ok(informe.faltantes.includes("Largo frente a los demás"));
  assert.match(informe.texto, /NO COMPROBADO\. formato: Texto libre/);
});

test("una cita inventada o un conteo falso no pasan", async () => {
  const v = await verificarProcedencia(
    [
      {
        afirmacion: "ms-006 ganó un premio.",
        fuente: {
          ruta: "manuscritos/fichas/ms-006.json",
          cita: "premio de cuento",
        },
      },
      {
        afirmacion: "ms-006 tiene 1.000 palabras.",
        fuente: {
          ruta: "manuscritos/entrada/ms-006.md",
          metodo: "contar_palabras",
          valor: 1000,
        },
      },
    ],
    RAIZ,
  );
  assert.equal(v.problemas.length, 2);
});

test("un subagente sin respuesta queda como faltante", async () => {
  const sinLanding = guion(false);
  delete sinLanding.subagentes["Tema en la landing"];
  const inv = await investigar(encargo, dobleGrabado(sinLanding));
  const landing = inv.delegaciones.find(
    (d) => d.descripcion === "Tema en la landing",
  );
  assert.equal(landing?.vuelta?.estado, "error");
  if (landing?.vuelta?.estado === "error") {
    assert.equal(landing.vuelta.error.tipo, "sin_respuesta");
  }
});

test("el costo separa al coordinador de cada subagente", async () => {
  const inv = await investigar(encargo, dobleGrabado(guion(false)));
  assert.ok(inv.tokens["coordinador"] !== undefined);
  assert.equal(Object.keys(inv.tokens).length, 4);
  assert.ok(inv.costoUsd > 0);
});

test("la vuelta acepta el bloque json aunque traiga texto", () => {
  const cerca = "`".repeat(3);
  const v = leerVuelta(
    `Listo.\n${cerca}json\n{"estado":"error","error":` +
      '{"tipo":"acceso","motivo":"x","intentado":[],' +
      `"reintentable":false}}\n${cerca}`,
    false,
  );
  assert.equal(v.estado, "error");
});
