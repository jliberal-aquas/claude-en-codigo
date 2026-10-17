import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  armarPeticion,
  cargarPlantilla,
  type Plantilla,
} from "./armar-peticion.js";
import {
  crearCliente,
  type ClienteClaude,
  type RespuestaMensaje,
} from "./crear-cliente.js";
import { MODELO } from "./llamar.js";

/**
 * Verificador local de citas. Recibe la ficha que escribió el modelo y
 * el manuscrito que le enviaste. Comprueba una sola cosa: que cada
 * hecho y la línea de la autora lleven una cita que exista, palabra
 * por palabra, en el manuscrito, o declaren "no consta" en la forma
 * exacta. No comprueba que la cita diga lo que la afirmación dice,
 * ni el género (lo que sigue a "Género:" no se mira), ni el mundo.
 * No llama a nadie: es una regla tuya.
 */
export type TipoHallazgo =
  | "sin-cita"
  | "cita-corta"
  | "cita-inexistente";

export interface Hallazgo {
  /** Línea de la ficha donde empieza la afirmación (desde 1). */
  linea: number;
  tipo: TipoHallazgo;
  texto: string;
}

export interface Informe {
  revisadas: number;
  hallazgos: Hallazgo[];
}

export interface Afirmacion {
  linea: number;
  texto: string;
}

/** Una cita más corta que esto "demuestra" casi cualquier cosa. */
export const MIN_CITA = 15;

/** Sin diferencias de espacios ni de forma Unicode, nada más. */
export function normalizar(texto: string): string {
  return texto.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** La cita debe estar, palabra por palabra, en el manuscrito. */
export function citaEnTexto(cita: string, manuscrito: string): boolean {
  return normalizar(manuscrito).includes(normalizar(cita));
}

/** Lo único que no afirma nada: la etiqueta, "Hechos:" y el género. */
const ESTRUCTURA = /^\s*(?:<\/?ficha>|Hechos:|Género:.*)\s*$/;

/** Una línea que abre una afirmación nueva. */
const ABRE = /^\s*(?:-\s|Autora:)/;

/**
 * "No consta" sin cita solo vale como la línea entera, con una
 * etiqueta corta delante: hasta seis palabras, sin guiones ni puntos.
 * "Ganó el premio. Nota: no consta" y "- Ganó el premio - nota: no
 * consta" no lo son.
 */
const ETIQUETA = "(?:[^\\s«».:\\-–—]+\\s+){0,5}[^\\s«».:\\-–—]+";
const AUSENCIA = new RegExp(
  `^\\s*(?:-\\s+)?${ETIQUETA}:\\s*no consta en el manuscrito\\.?\\s*$`,
  "i",
);

/**
 * Quita el formato que una aplicación añade al copiar: negritas y
 * viñetas con asterisco. El texto de las citas no cambia.
 */
export function sinFormato(linea: string): string {
  return linea
    .replace(/\*\*|__/g, "")
    .replace(/^(\s*)\*\s/, "$1- ");
}

const sinCerrar = (t: string) =>
  (t.match(/«/g) ?? []).length > (t.match(/»/g) ?? []).length;

/**
 * Toda línea que no sea estructura es una afirmación. Una cita que el
 * modelo partió en dos líneas se pega a su afirmación; cualquier otra
 * línea suelta abre una afirmación propia, que no tendrá cita.
 */
export function afirmaciones(ficha: string): Afirmacion[] {
  const salida: Afirmacion[] = [];
  ficha.split("\n").forEach((cruda, i) => {
    const linea = sinFormato(cruda);
    if (linea.trim() === "" || ESTRUCTURA.test(linea)) return;
    const ultima = salida.at(-1);
    if (
      ultima !== undefined &&
      sinCerrar(ultima.texto) &&
      !ABRE.test(linea)
    ) {
      ultima.texto += ` ${linea.trim()}`;
    } else {
      salida.push({ linea: i + 1, texto: linea.trim() });
    }
  });
  return salida;
}

export function verificarCitas(
  ficha: string,
  manuscrito: string,
): Informe {
  const hallazgos: Hallazgo[] = [];
  let revisadas = 0;
  for (const a of afirmaciones(ficha)) {
    if (AUSENCIA.test(a.texto)) continue;
    revisadas += 1;
    const citas = [...a.texto.matchAll(/«([^»]+)»/g)].map(
      (m) => m[1] ?? "",
    );
    const nueva = (tipo: TipoHallazgo): Hallazgo => ({
      linea: a.linea,
      tipo,
      texto: a.texto,
    });
    if (citas.length === 0) {
      hallazgos.push(nueva("sin-cita"));
    } else if (citas.some((c) => normalizar(c).length < MIN_CITA)) {
      hallazgos.push(nueva("cita-corta"));
    } else if (citas.some((c) => !citaEnTexto(c, manuscrito))) {
      hallazgos.push(nueva("cita-inexistente"));
    }
  }
  return { revisadas, hallazgos };
}

/** Une los bloques de tipo `text` de la respuesta. */
function textoDe(respuesta: RespuestaMensaje): string {
  return respuesta.content
    .filter((bloque) => bloque.type === "text")
    .map((bloque) => bloque.text)
    .join("\n");
}

/**
 * Pide la ficha como en el capítulo 2: la instrucción va en `system`
 * y el manuscrito, neutralizado y entre etiquetas, en el mensaje.
 */
export async function pedirFicha(
  cliente: ClienteClaude,
  plantilla: Plantilla,
  manuscrito: string,
): Promise<string> {
  const peticion = armarPeticion(plantilla, manuscrito);
  const respuesta = await cliente.messages.create({
    model: MODELO,
    max_tokens: 2000,
    system: peticion.system,
    messages: peticion.messages,
  });
  return textoDe(respuesta);
}

const RECORTE = 44;

function recortar(texto: string): string {
  return texto.length <= RECORTE
    ? texto
    : `${texto.slice(0, RECORTE - 1)}…`;
}

function imprimir(ficha: string, informe: Informe): void {
  const malas = new Map(informe.hallazgos.map((h) => [h.linea, h]));
  for (const a of afirmaciones(ficha)) {
    const h = malas.get(a.linea);
    const marca = h ? `FALLA ${h.tipo}` : "ok";
    console.log(`L${a.linea} ${marca.padEnd(24)}${recortar(a.texto)}`);
  }
  console.log(
    `${informe.revisadas} afirmaciones, ` +
      `${informe.hallazgos.length} sin respaldo`,
  );
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  try {
    const args = process.argv.slice(2);
    const mostrar = args.includes("--ficha");
    const desde = args.find((a) => a.startsWith("--desde="));
    const [ruta, nombre = "clasificar.v3"] = args.filter(
      (a) => !a.startsWith("--"),
    );
    if (ruta === undefined) {
      throw new Error(
        "uso: verificar-citas.ts <manuscrito> [plantilla] " +
          "[--ficha] [--desde=<archivo con una ficha>]",
      );
    }
    const manuscrito = await readFile(ruta, "utf8");
    // Con `--desde` no se llama a nadie: revisas una ficha que ya
    // tienes, por ejemplo la que pegaste desde la aplicación.
    const ficha =
      desde !== undefined
        ? await readFile(desde.slice("--desde=".length), "utf8")
        : await pedirFicha(
            crearCliente({ grabacion: basename(ruta, ".md") }),
            await cargarPlantilla(nombre),
            manuscrito,
          );
    if (mostrar) console.log(`${ficha}\n`);
    const informe = verificarCitas(ficha, manuscrito);
    imprimir(ficha, informe);
    if (informe.hallazgos.length > 0) process.exitCode = 1;
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 2;
  }
}
