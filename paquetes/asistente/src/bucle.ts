import type Anthropic from "@anthropic-ai/sdk";
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  crearCliente,
  type ClienteClaude,
  type RespuestaMensaje,
} from "../../cliente/src/crear-cliente.js";
import { MODELO } from "../../cliente/src/llamar.js";
import {
  HERRAMIENTAS,
} from "../../cliente/src/herramientas/definiciones.js";
import {
  crearContexto,
  ejecutar,
  ejecutarTodas,
  type Contexto,
} from "../../cliente/src/herramientas/ejecutar.js";

/**
 * El bucle de la editorial, escrito a mano sobre la Messages API:
 * envía la conversación, ejecuta lo que el modelo pida con el
 * despachador del capítulo 11 y repite.
 * Uso: npm run bucle -- [ficha | repite | corta | niega]
 * En modo grabado, el nombre elige las grabaciones `bucle-<nombre>`.
 */

/** El trabajo, dicho una vez para todas las peticiones. */
export const SISTEMA = [
  "Eres el asistente de una editorial pequeña. Para fichar un",
  "manuscrito: lee su ficha, compáralo con el catálogo, registra su",
  "género con una frase copiada del texto y termina con una",
  "propuesta: si sigue a lectura de una persona, y por qué. El orden",
  "y las herramientas los eliges tú.",
].join(" ");

/** El pedido de la fundadora (sintético). */
export const PEDIDO =
  "Revisa ms-010: su ficha salió con confianza baja. Fíchalo de " +
  "nuevo, compáralo con lo que ya tenemos y dime si sigue a lectura.";

/** El texto de los bloques `text` de una respuesta, juntos. */
export function textoDe(r: RespuestaMensaje): string {
  return r.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Por qué se detuvo el bucle cuando no terminó bien. */
export type Fallo =
  | "respuesta_cortada" // max_tokens: quedó a medias
  | "negativa" // refusal: el modelo declinó
  | "pausa" // pause_turn: el trabajo no terminó
  | "contexto_lleno" // model_context_window_exceeded
  | "secuencia_de_parada" // stop_sequence: aquí no pedimos ninguna
  | "motivo_desconocido" // un valor que la documentación no lista
  | "tope_de_turnos"; // siguió pidiendo hasta el tope

export interface Final {
  /** `true` solo si el modelo terminó con `end_turn`. */
  ok: boolean;
  motivo: "end_turn" | Fallo;
  /** Qué pasó, en una frase. */
  detalle: string;
  /** Texto del último turno; sin `ok`, puede estar a medias. */
  texto: string;
  turnos: number;
  /** El historial completo: la evidencia de lo que pasó. */
  messages: Anthropic.MessageParam[];
}

export interface OpcionesBucle {
  cliente: ClienteClaude;
  pedido: string;
  /** El estado de las herramientas (capítulo 11). */
  contexto?: Contexto;
  /** Máximo de turnos: una red de seguridad, no la señal de fin. */
  tope?: number;
  /** Se llama con cada respuesta, para mostrar el progreso. */
  alResponder?: (turno: number, r: RespuestaMensaje) => void;
}

export const TOPE_DE_TURNOS = 10;

export async function correrBucle(op: OpcionesBucle): Promise<Final> {
  const ctx = op.contexto ?? crearContexto();
  const tope = op.tope ?? TOPE_DE_TURNOS;
  // Una sola lista que crece: cada turno ve todo lo anterior.
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: op.pedido },
  ];

  for (let turno = 1; turno <= tope; turno++) {
    const r = await op.cliente.messages.create({
      model: MODELO,
      max_tokens: 2000,
      system: SISTEMA,
      tools: HERRAMIENTAS,
      messages,
    });
    op.alResponder?.(turno, r);
    // El turno del modelo vuelve tal cual al historial.
    messages.push({ role: "assistant", content: r.content });
    const fin = (motivo: Final["motivo"], detalle: string): Final => ({
      ok: motivo === "end_turn",
      motivo,
      detalle,
      texto: textoDe(r),
      turnos: turno,
      messages,
    });

    // La señal es stop_reason, nunca el texto: una respuesta con texto
    // puede traer además pedidos de herramientas.
    switch (r.stop_reason) {
      case "tool_use":
        // Todo lo pedido, con los resultados juntos en UN mensaje.
        messages.push(await ejecutarTodas(r.content, ctx));
        continue;
      case "end_turn":
        return fin("end_turn", "El modelo terminó su trabajo.");
      case "max_tokens":
        return fin("respuesta_cortada", "Llegó a max_tokens a medias.");
      case "refusal":
        return fin("negativa", "El modelo declinó seguir.");
      case "pause_turn":
        return fin("pausa", "Turno en pausa: el trabajo no terminó.");
      case "model_context_window_exceeded":
        return fin("contexto_lleno", "Se llenó la ventana.");
      case "stop_sequence":
        return fin("secuencia_de_parada", "Paró en una secuencia.");
      default:
        return fin(
          "motivo_desconocido",
          `stop_reason=${String(r.stop_reason)}`,
        );
    }
  }
  // Salir por aquí es un fallo que se informa, nunca un éxito.
  return {
    ok: false,
    motivo: "tope_de_turnos",
    detalle: `${tope} turnos sin que el modelo terminara.`,
    texto: "",
    turnos: tope,
    messages,
  };
}

const FIXTURES = new URL("../../../fixtures/", import.meta.url);

/**
 * Un cliente para grabaciones de varios turnos: el turno 1 lee la
 * letra `a`; el 2, la `b`, y así. Si se acaban las letras, repite la
 * última: una sola grabación imita a un modelo que insiste. En modo
 * real, `crearCliente()` ignora las letras.
 */
export async function clientePorTurnos(
  grabacion: string,
): Promise<ClienteClaude> {
  const patron = new RegExp(`^${grabacion}-([a-z])\\.json$`);
  const letras = (await readdir(FIXTURES))
    .map((f) => patron.exec(f)?.[1])
    .filter((l): l is string => l !== undefined)
    .sort();
  let llamadas = 0;
  return {
    messages: {
      create(params) {
        const i = Math.min(llamadas, letras.length - 1);
        llamadas++;
        const variante = letras[i] ?? "a";
        return crearCliente({ grabacion, variante }).messages.create(
          params,
        );
      },
      stream: (p) => crearCliente({ grabacion }).messages.stream(p),
      countTokens: (p) =>
        crearCliente({ grabacion }).messages.countTokens(p),
    },
  };
}

/** Parte un texto largo en líneas de hasta `ancho` caracteres. */
function envolver(texto: string, ancho = 64): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(/\s+/)) {
    if (actual !== "" && actual.length + palabra.length + 1 > ancho) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = actual === "" ? palabra : `${actual} ${palabra}`;
    }
  }
  if (actual !== "") lineas.push(actual);
  return lineas;
}

/** Qué trae una respuesta: `text` y el nombre de cada pedido. */
function resumir(r: RespuestaMensaje): string {
  const partes = r.content.flatMap((b) => {
    if (b.type === "text") return ["text"];
    return b.type === "tool_use" ? [b.name] : [];
  });
  return partes.join(", ") || "(nada)";
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  try {
    const nombre = process.argv[2] ?? "ficha";
    const ctx = crearContexto();
    for (const l of envolver(`pedido: ${PEDIDO}`)) console.log(l);
    const final = await correrBucle({
      cliente: await clientePorTurnos(`bucle-${nombre}`),
      pedido: PEDIDO,
      contexto: ctx,
      alResponder: (turno, r) =>
        console.log(
          `turno ${turno} · ${r.stop_reason} · ${resumir(r)}`,
        ),
    });
    const estado = final.ok ? "ok" : "FALLO";
    const plural = final.turnos > 1 ? "s" : "";
    const turnos = `${final.turnos} turno${plural}`;
    console.log(`fin: ${final.motivo} en ${turnos} (${estado})`);
    console.log(`   ${final.detalle}`);
    for (const l of envolver(`texto: ${final.texto || "(vacío)"}`)) {
      console.log(`   ${l}`);
    }
    // Lo que importa es el estado, no lo que el modelo dice de él.
    const ficha = await ejecutar(
      { id: "comprobar", name: "leer_ficha", input: { id: "ms-010" } },
      ctx,
    );
    const genero = JSON.parse(String(ficha.content))["genero"];
    console.log(`registro de ms-010: genero=${genero}`);
    process.exitCode = final.ok ? 0 : 1;
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
