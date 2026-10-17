import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Consultar } from "../asistente.js";
import { decidir } from "./compuerta.js";
import { dobleDelTriage, type Llamada } from "./doble-triage.js";
import { cargarCasos, crearMesa } from "./herramientas.js";
import { triar, type Informe } from "./triage.js";

/**
 * Pruebas del triage con dobles: el SDK no corre y el modelo es una
 * grabación sintética, pero las herramientas, la compuerta y la
 * validación de fichas corren de verdad.
 */

const RAIZ = fileURLToPath(new URL("../../../../", import.meta.url));
const casos = await cargarCasos();
const nuevaMesa = () => crearMesa(RAIZ, casos);

/** Corre un caso sobre su grabación, con las opciones de verdad. */
async function correr(
  caso: string,
  cambiar: (c: Consultar) => Consultar = (c) => c,
): Promise<Informe> {
  const mesa = nuevaMesa();
  const doble = dobleDelTriage(`tri-${caso}`, mesa);
  return triar(mesa, caso, cambiar(doble));
}

/** Un expediente leído y sin validar, para probar `decidir` sola. */
function leido(caso: string) {
  const exp = nuevaMesa().expedientes.get(caso);
  assert.ok(exp !== undefined);
  exp.leido = true;
  return exp;
}

test("decidir: no se acepta sin validar la ficha", () => {
  const d = decidir(leido("salta"), "aceptar", { caso: "salta" });
  assert.equal(d.permitir, false);
  assert.match(!d.permitir ? d.motivo : "", /^Primero validar_ficha/);
});

test("decidir: el tono no es un criterio escrito", () => {
  const d = decidir(leido("enojado"), "escalar", {
    caso: "enojado",
    criterio: "autor_molesto",
    evidencia: "Es una falta de respeto total.",
  });
  const motivo = !d.permitir ? d.motivo : "";
  assert.match(motivo, /no es un criterio escrito/);
});

test("decidir: pide_persona exige una cita que esté", () => {
  const exp = leido("tranquila");
  const inventada = decidir(exp, "escalar", {
    caso: "tranquila",
    criterio: "pide_persona",
    evidencia: "quiero hablar con un humano ya mismo",
  });
  const copiada = decidir(exp, "escalar", {
    caso: "tranquila",
    criterio: "pide_persona",
    evidencia: "¿podría conversar con la fundadora por teléfono?",
  });
  assert.equal(inventada.permitir, false);
  // Quien pide una persona no espera a que validemos la ficha.
  assert.equal(copiada.permitir, true);
});

test("decidir: una herramienta ajena queda fuera del alcance", () => {
  const d = decidir(leido("rutina"), "Bash", { caso: "rutina" });
  assert.match(!d.permitir ? d.motivo : "", /fuera del alcance/);
});

test("enojado: furioso, sin criterio, se acepta", async () => {
  const i = await correr("enojado");
  assert.equal(i.salida, "aceptar");
  assert.deepEqual(i.negadas, []);
});

test("tranquila: pide una persona, escala con traspaso", async () => {
  const i = await correr("tranquila");
  assert.equal(i.salida, "escalar");
  const t = i.cierre?.traspaso;
  assert.equal(t?.criterio, "pide_persona");
  // El modelo no validó: escaló apenas leyó el pedido.
  assert.equal(t?.yaHecho[0], "leer_caso");
});

/** Lo que harías en el lab: las mismas opciones, otra política. */
const sinCompuerta =
  (llamadas: Llamada[] = [], vistas: string[] = []) =>
  (c: Consultar): Consultar =>
  (p) =>
    c({
      ...p,
      options: {
        ...p.options,
        hooks: {},
        canUseTool: async (herramienta) => {
          vistas.push(herramienta);
          return { behavior: "deny", message: "nada sin revisar" };
        },
      },
    });

test("salta sin compuerta: acepta sin validar (el error)", async () => {
  const i = await correr("salta", sinCompuerta());
  assert.equal(i.salida, "aceptar");
  assert.deepEqual(i.hecho, ["leer_caso", "aceptar"]);
});

test("salta: canUseTool no ve lo que aprobó allowedTools", async () => {
  const vistas: string[] = [];
  const i = await correr("salta", sinCompuerta([], vistas));
  assert.equal(vistas.length, 0);
  assert.equal(i.salida, "aceptar");
});

test("salta con compuerta: aceptar negado, queda abierto", async () => {
  const i = await correr("salta");
  assert.equal(i.salida, "abierto");
  assert.equal(i.negadas[0]?.herramienta, "aceptar");
});
