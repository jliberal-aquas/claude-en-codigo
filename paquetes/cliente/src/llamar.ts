import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  crearCliente,
  type ClienteClaude,
  type RespuestaMensaje,
} from "./crear-cliente.js";
import { conReintentos } from "./reintentos.js";

/** ID de modelo vigente al escribir el libro [VERIFICAR AL CIERRE]. */
export const MODELO = "claude-opus-5-5";

export interface ResultadoLlamada {
  /** La respuesta entera, tal como llegó: la usan las pruebas. */
  respuesta: RespuestaMensaje;
  texto: string;
  /** El `type` de cada bloque de `content`, en orden. */
  tiposDeBloque: string[];
  stopReason: string | null;
  tokensEntrada: number;
  tokensSalida: number;
  idPeticion: string;
}

/** Envía un manuscrito y devuelve lo que importa de la respuesta. */
export async function llamar(
  cliente: ClienteClaude,
  rutaManuscrito: string,
): Promise<ResultadoLlamada> {
  const manuscrito = await readFile(rutaManuscrito, "utf8");

  const respuesta = await cliente.messages.create({
    model: MODELO,
    // Tope absoluto de tokens de salida, generoso a propósito.
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content:
          "Resume este manuscrito en cinco líneas y di a qué género " +
          "parece pertenecer. Si algo no está en el texto, dilo.\n\n" +
          manuscrito,
      },
    ],
  });

  // `content` es una lista de bloques, no un string: aquí nos
  // quedamos con los de tipo `text`.
  const texto = respuesta.content
    .filter((bloque) => bloque.type === "text")
    .map((bloque) => bloque.text)
    .join("\n");

  return {
    respuesta,
    texto,
    tiposDeBloque: respuesta.content.map((bloque) => bloque.type),
    stopReason: respuesta.stop_reason,
    tokensEntrada: respuesta.usage.input_tokens,
    tokensSalida: respuesta.usage.output_tokens,
    // Es lo primero que pide el soporte de la API cuando algo falla.
    idPeticion: respuesta._request_id ?? "(sin id)",
  };
}

// Solo corre como programa si lo invocas directamente; al importarlo
// desde otro archivo (por ejemplo, la prueba) no hace nada.
const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  try {
    const ruta = process.argv[2] ?? "manuscritos/entrada/ms-004.md";
    const cliente = crearCliente({ grabacion: basename(ruta, ".md") });
    // Un solo bucle de reintentos: el nuestro (capítulo 5).
    const nombre = basename(ruta, ".md");
    const r = await conReintentos(nombre, () => llamar(cliente, ruta));

    console.log(r.texto);
    // Los metadatos van por la salida de errores para no mezclarlos
    // con el texto.
    console.error(
      `bloques=${r.tiposDeBloque.join(",")} ` +
        `stop_reason=${r.stopReason} ` +
        `entrada=${r.tokensEntrada} salida=${r.tokensSalida}`,
    );
    console.error(`id=${r.idPeticion}`);
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
