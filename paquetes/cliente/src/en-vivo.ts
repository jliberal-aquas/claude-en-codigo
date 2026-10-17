import { performance } from "node:perf_hooks";
import { crearCliente } from "./crear-cliente.js";
import { MODELO } from "./llamar.js";
import { transmitir } from "./transmitir.js";
import {
  exito,
  iniciarServidorFalso,
  PALABRAS,
  transmision,
} from "./servidor-falso.js";

/**
 * Mide dos cosas contra el servidor falso, que escribe una palabra
 * cada PAUSA_MS: cuándo llega la respuesta entera sin streaming y
 * cuándo llegan la primera parte y la última con streaming.
 */
const PAUSA_MS = 150;
const params = {
  model: MODELO,
  // El pensamiento también cuenta contra `max_tokens`: va con holgura.
  max_tokens: 1024,
  messages: [{ role: "user" as const, content: "Escribe la frase." }],
};

// Sin streaming: el servidor tarda lo mismo que tardaría en escribir
// todas las palabras, y recién entonces responde.
const lento = await iniciarServidorFalso([
  exito(PALABRAS.length * PAUSA_MS),
]);
const clienteLento = crearCliente({ baseURL: lento.url });
const t0 = performance.now();
await clienteLento.messages.create({ ...params });
const total = performance.now() - t0;
console.log(
  `sin streaming: respuesta completa a ${Math.round(total)} ms`,
);
await lento.cerrar();

const rapido = await iniciarServidorFalso([transmision(PAUSA_MS)]);
const clienteRapido = crearCliente({ baseURL: rapido.url });
const r = await transmitir(clienteRapido, params, (parte, ms) => {
  console.log(`  ${String(Math.round(ms)).padStart(5)} ms  «${parte}»`);
});
const primero = Math.round(r.msPrimerTexto ?? 0);
console.log(
  `con streaming: primer texto a ${primero} ms, ` +
    `respuesta completa a ${Math.round(r.msTotal)} ms`,
);
const cuentas = new Map<string, number>();
for (const e of r.eventos) cuentas.set(e, (cuentas.get(e) ?? 0) + 1);
console.log("eventos recibidos:");
for (const [tipo, n] of cuentas) console.log(`  ${tipo} x ${n}`);
console.log(
  `stop_reason=${r.stopReason} tokens_salida=${r.tokensSalida}`,
);
await rapido.cerrar();
