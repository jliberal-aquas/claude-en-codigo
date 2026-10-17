import { performance } from "node:perf_hooks";
import { crearCliente } from "./crear-cliente.js";
import { llamar } from "./llamar.js";
import { reintentarTodo } from "./ingenuo.js";
import { conReintentos, POLITICA } from "./reintentos.js";
import {
  exito,
  iniciarServidorFalso,
  limiteDeTasa,
  peticionInvalida,
  rechazo,
  sobrecarga,
  topeDeGasto,
  type Paso,
} from "./servidor-falso.js";

/**
 * Banco de pruebas del capítulo: elige un cliente y un escenario, lo
 * corre contra el servidor falso y cuenta lo que el servidor vio.
 *
 *   npx tsx paquetes/cliente/src/lab.ts ingenuo 400
 *   npx tsx paquetes/cliente/src/lab.ts reparado 529 [sdk]
 *
 * Con LAB_BASE_MS puedes acortar la espera inicial (por defecto 1000).
 */
const ESCENARIOS: Record<string, Paso[]> = {
  "400": [peticionInvalida()],
  "429": [limiteDeTasa(2), exito()],
  "429-gasto": [topeDeGasto()],
  "529": [sobrecarga(), sobrecarga(), exito()],
  "529-siempre": [sobrecarga()],
  refusal: [rechazo()],
};

const [quien, nombre, sdk] = process.argv.slice(2);
const pasos = nombre === undefined ? undefined : ESCENARIOS[nombre];
if ((quien !== "ingenuo" && quien !== "reparado") || !pasos) {
  console.error(
    "uso: lab <ingenuo|reparado> <" +
      Object.keys(ESCENARIOS).join("|") +
      "> [reintentos-del-sdk]",
  );
  process.exit(2);
}

const baseMs = Number(process.env["LAB_BASE_MS"] ?? POLITICA.baseMs);
const servidor = await iniciarServidorFalso(pasos);
const cliente = crearCliente({
  baseURL: servidor.url,
  maxRetries: sdk === undefined ? 0 : Number(sdk),
});
const ruta = "manuscritos/entrada/ms-004.md";
const intento = () => llamar(cliente, ruta);

const inicio = performance.now();
let resultado: string;
try {
  const r =
    quien === "ingenuo"
      ? await reintentarTodo("ms-004", intento, 6, baseMs)
      : await conReintentos("ms-004", intento, {
          politica: { ...POLITICA, baseMs },
        });
  resultado = `ok\nstop_reason=${r.stopReason} id=${r.idPeticion}`;
} catch {
  resultado = "fallo";
}
const segundos = (performance.now() - inicio) / 1_000;
console.log(
  `cliente=${quien} escenario=${nombre} resultado=${resultado}`,
);
console.log(
  `peticiones_al_servidor=${servidor.peticiones.length} ` +
    `tiempo=${segundos.toFixed(1)}s`,
);
await servidor.cerrar();
