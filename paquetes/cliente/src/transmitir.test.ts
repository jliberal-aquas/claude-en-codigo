import test from "node:test";
import assert from "node:assert/strict";
import { crearCliente } from "./crear-cliente.js";
import { MODELO } from "./llamar.js";
import { conReintentos } from "./reintentos.js";
import {
  iniciarServidorFalso,
  PALABRAS,
  transmision,
  transmisionCortada,
} from "./servidor-falso.js";
import {
  primerasPartes,
  transmitir,
  transmitirContinuable,
} from "./transmitir.js";

const params = {
  model: MODELO,
  max_tokens: 1024,
  messages: [{ role: "user" as const, content: "Escribe la frase." }],
};

test("los eventos llegan en el orden documentado", async () => {
  const servidor = await iniciarServidorFalso([transmision(5)]);
  const cliente = crearCliente({ baseURL: servidor.url });
  const r = await transmitir(cliente, params);
  await servidor.cerrar();

  const sinRepetir = [...new Set(r.eventos)];
  assert.deepEqual(sinRepetir, [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]);
  // Dos bloques: el pensamiento y el texto. Solo el texto se lee.
  const bloques = r.eventos.filter((e) => e === "content_block_start");
  assert.equal(bloques.length, 2);
  assert.equal(r.texto, PALABRAS.join(" "));
  assert.equal(r.stopReason, "end_turn");
  assert.equal(r.tokensSalida, PALABRAS.length);
});

test("la primera parte llega mucho antes que el final", async () => {
  const servidor = await iniciarServidorFalso([transmision(30)]);
  const cliente = crearCliente({ baseURL: servidor.url });
  const r = await transmitir(cliente, params);
  await servidor.cerrar();
  assert.ok(r.msPrimerTexto !== null);
  assert.ok(r.msPrimerTexto < r.msTotal / 3, "no adelantó lo primero");
});

test("break corta la conexión", async () => {
  const servidor = await iniciarServidorFalso([transmision(30)]);
  const cliente = crearCliente({ baseURL: servidor.url });
  const partes = await primerasPartes(cliente, params, 2);
  await new Promise((ok) => setTimeout(ok, 100));
  const cortada = servidor.peticiones[0]?.cortadaPorElCliente;
  await servidor.cerrar();
  assert.deepEqual(partes, ["El ", "servidor "]);
  assert.equal(cortada, true);
});

test("un error tras el 200 se reintenta y empieza limpio", async () => {
  const servidor = await iniciarServidorFalso([
    transmisionCortada(5, 3),
    transmision(5),
  ]);
  const cliente = crearCliente({ baseURL: servidor.url });
  const log: string[] = [];
  const r = await conReintentos(
    "stream",
    () => transmitir(cliente, params),
    { dormir: async () => {}, registrar: (l) => void log.push(l) },
  );
  const peticiones = servidor.peticiones.length;
  await servidor.cerrar();
  assert.equal(peticiones, 2);
  assert.equal(r.texto, PALABRAS.join(" "));
  assert.match(log[0] ?? "", /estado=sin-estado tipo=overloaded_error/);
});

test("un stream cortado se continúa, no se repite", async () => {
  const servidor = await iniciarServidorFalso([
    transmisionCortada(5, 3),
    transmision(5, PALABRAS.slice(3)),
  ]);
  const cliente = crearCliente({ baseURL: servidor.url });
  const r = await conReintentos(
    "stream",
    transmitirContinuable(cliente, params),
    { dormir: async () => {}, registrar: () => {} },
  );
  const segunda = servidor.peticiones[1]?.cuerpo as {
    messages: { role: string; content: { text?: string }[] }[];
  };
  await servidor.cerrar();
  const pedido = segunda.messages.at(-1);
  assert.equal(pedido?.role, "user");
  assert.match(JSON.stringify(pedido), /El servidor falso /);
  assert.equal(r.texto, PALABRAS.join(" "));
});
