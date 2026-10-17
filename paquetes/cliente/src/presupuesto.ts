import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { crearCliente } from "./crear-cliente.js";
import { MODELO } from "./llamar.js";

/**
 * Tamaño de la ventana de contexto de Claude Opus 5.5, en tokens, y
 * las dos proporciones que la documentación da para el tokenizador
 * actual: un millón de tokens son unas 555.000 palabras o unos 2,5
 * millones de caracteres [VERIFICAR AL CIERRE]. Son proporciones
 * generales: tu texto puede apartarse de ellas, por eso el conteo
 * exacto (opcional, con la API real) manda sobre este cálculo.
 */
export const VENTANA = 1_000_000;
export const PALABRAS_POR_MILLON = 555_000;
export const CARACTERES_POR_MILLON = 2_500_000;

/**
 * Cuántas veces más tokens podría pedir tu texto que lo que dicen las
 * proporciones. No es un hecho: es la suposición del libro para no
 * declarar que "cabe" por un margen estrecho.
 */
export const PRUDENCIA = 2;

export interface Presupuesto {
  palabras: number;
  caracteres: number;
  tokensPorPalabras: number;
  tokensPorCaracteres: number;
  /** La mayor de las dos estimaciones: la que no se queda corta. */
  estimacion: number;
  conPrudencia: number;
  reservaSalida: number;
  /** Fracción de la ventana que ocuparía (con prudencia y salida). */
  fraccion: number;
  cabe: boolean;
}

/**
 * Trozos separados por espacio. `wc -w` puede dar una unidad menos o
 * más, según la configuración regional de tu shell.
 */
export function contarPalabras(texto: string): number {
  return texto.split(/\s+/).filter((t) => t !== "").length;
}

/**
 * Estima lo que ocupa un texto, sin llamar a nadie. `reservaSalida` es
 * el `max_tokens` de la petición: la salida también ocupa la ventana.
 */
export function estimar(
  texto: string,
  reservaSalida = 2000,
): Presupuesto {
  const palabras = contarPalabras(texto);
  const caracteres = [...texto].length;
  const tokensPorPalabras = Math.ceil(
    (palabras / PALABRAS_POR_MILLON) * 1_000_000,
  );
  const tokensPorCaracteres = Math.ceil(
    (caracteres / CARACTERES_POR_MILLON) * 1_000_000,
  );
  const estimacion = Math.max(tokensPorPalabras, tokensPorCaracteres);
  const conPrudencia = estimacion * PRUDENCIA;
  const usado = conPrudencia + reservaSalida;
  return {
    palabras,
    caracteres,
    tokensPorPalabras,
    tokensPorCaracteres,
    estimacion,
    conPrudencia,
    reservaSalida,
    fraccion: usado / VENTANA,
    cabe: usado <= VENTANA,
  };
}

function imprimir(ruta: string, p: Presupuesto): void {
  const fila = (nombre: string, valor: number | string) =>
    console.log(`  ${nombre.padEnd(28)}${String(valor).padStart(9)}`);
  console.log(ruta);
  fila("palabras", p.palabras);
  fila("caracteres", p.caracteres);
  fila("tokens (por palabras)", p.tokensPorPalabras);
  fila("tokens (por caracteres)", p.tokensPorCaracteres);
  fila("estimación (la mayor)", p.estimacion);
  fila(`con prudencia x${PRUDENCIA}`, p.conPrudencia);
  fila("reserva de salida", p.reservaSalida);
  fila("ventana", VENTANA);
  fila("uso de la ventana", `${(p.fraccion * 100).toFixed(1)} %`);
  fila("cabe", p.cabe ? "sí" : "no");
}

/**
 * Con la API real, el conteo exacto de tokens. En modo grabado el
 * cliente lo rechaza a propósito: no hay cifra honesta que grabar.
 */
async function contarConLaApi(texto: string): Promise<void> {
  try {
    const cliente = crearCliente();
    const r = await cliente.messages.countTokens({
      model: MODELO,
      messages: [{ role: "user", content: texto }],
    });
    console.log(`  conteo exacto (API)   ${r.input_tokens}`);
  } catch (e) {
    console.log(`  sin conteo exacto: ${(e as Error).message}`);
  }
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  const args = process.argv.slice(2);
  const contar = args.includes("--contar");
  const rutas = args.filter((a) => !a.startsWith("--"));
  if (rutas.length === 0) {
    console.error("uso: presupuesto.ts <archivo>... [--contar]");
    process.exitCode = 1;
  }
  for (const ruta of rutas) {
    const texto = await readFile(ruta, "utf8");
    imprimir(ruta, estimar(texto));
    if (contar) await contarConLaApi(texto);
  }
}
