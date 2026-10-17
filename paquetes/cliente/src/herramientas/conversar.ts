import type Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "node:url";
import {
  crearCliente,
  type RespuestaMensaje,
} from "../crear-cliente.js";
import { MODELO } from "../llamar.js";
import { HERRAMIENTAS } from "./definiciones.js";
import { crearContexto, ejecutarTodas } from "./ejecutar.js";

/**
 * Una ida y vuelta con herramientas: pregunta, el modelo pide, tu
 * programa ejecuta, el modelo contesta. Solo dos turnos del modelo;
 * repetir hasta que no pida más es el capítulo 14.
 * Uso: npm run conversar -- <pregunta> [letra de ida] [letra de vuelta]
 * En modo grabado, las letras eligen las grabaciones `herr-<pregunta>`.
 */
const PREGUNTAS: Record<string, string> = {
  terror: "¿Cuántos manuscritos de terror llegaron?",
  ficha: "¿Qué dice la ficha de ms-004?",
  paralelo: "Compara las fichas de ms-004 y ms-007.",
};

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

/** Un bloque de la respuesta, en pocas líneas legibles. */
function describir(bloque: RespuestaMensaje["content"][number]) {
  switch (bloque.type) {
    case "thinking":
      return [`thinking (${bloque.thinking === "" ? "vacío" : "…"})`];
    case "text":
      return envolver(`text: ${bloque.text}`);
    case "tool_use":
      return envolver(
        `tool_use ${bloque.name} ${JSON.stringify(bloque.input)} ` +
          `id=${bloque.id}`,
      );
    default:
      return [bloque.type];
  }
}

function describirResultado(r: Anthropic.ToolResultBlockParam) {
  const marca = r.is_error === true ? " is_error" : "";
  return envolver(`tool_result ${r.tool_use_id}${marca}: ${r.content}`);
}

export async function conversar(
  nombre: string,
  ida: string,
  vuelta: string,
): Promise<string[]> {
  const pregunta = PREGUNTAS[nombre];
  if (pregunta === undefined) {
    const conocidas = Object.keys(PREGUNTAS).join(", ");
    throw new Error(`No conozco "${nombre}". Usa: ${conocidas}.`);
  }
  const salida = [`pregunta: ${pregunta}`];
  const mostrar = (titulo: string, lineas: string[]) =>
    salida.push(titulo, ...lineas.map((l) => `   ${l}`));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: pregunta },
  ];
  const peticion = {
    model: MODELO,
    max_tokens: 2000,
    tools: HERRAMIENTAS,
  };
  const grabacion = `herr-${nombre}`;

  // Turno 1: el modelo no responde la pregunta; pide herramientas.
  const r1 = await crearCliente({ grabacion, variante: ida })
    .messages.create({ ...peticion, messages });
  mostrar(
    `<- modelo (stop_reason=${r1.stop_reason})`,
    r1.content.flatMap(describir),
  );
  if (r1.stop_reason !== "tool_use") return salida;

  // Tu programa ejecuta TODO lo que pidió y responde en UN mensaje.
  const resultados = await ejecutarTodas(r1.content, crearContexto());
  const bloques =
    resultados.content as Anthropic.ToolResultBlockParam[];
  mostrar(
    `-> tu programa: 1 mensaje user con ${bloques.length} tool_result`,
    bloques.flatMap(describirResultado),
  );
  // El turno del modelo vuelve tal cual, seguido de los resultados.
  messages.push({ role: "assistant", content: r1.content }, resultados);

  // Turno 2: con los resultados en el contexto, el modelo contesta.
  const r2 = await crearCliente({ grabacion, variante: vuelta })
    .messages.create({ ...peticion, messages });
  mostrar(
    `<- modelo (stop_reason=${r2.stop_reason})`,
    r2.content.flatMap(describir),
  );
  if (r2.stop_reason === "tool_use") {
    salida.push("(pide otra herramienta: seguir es el capítulo 14)");
  }
  return salida;
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  try {
    const [nombre = "terror", ida = "a", vuelta = "b"] =
      process.argv.slice(2);
    console.log((await conversar(nombre, ida, vuelta)).join("\n"));
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
