import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { cargarPlantilla } from "./armar-peticion.js";
import {
  FACTOR_LOTE,
  FECHA_PRECIOS,
  MINIMO_CACHE,
  TARIFAS,
  type IdModelo,
} from "./precios.js";
import { estimar, PALABRAS_POR_MILLON } from "./presupuesto.js";

const MTOK = 1_000_000;

/** Lo que `usage` informa y cuesta dinero. */
export interface Uso {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens_details?: { thinking_tokens: number } | null;
}

/** Cuánto vive lo guardado: 5 minutos o 1 hora. */
export type Vida = "5m" | "1h";

/** Cómo se cobra una petición: vida del caché y si va en un lote. */
export interface Cobro {
  vida: Vida;
  lote: boolean;
}

export interface Desglose {
  entrada: number;
  escritura: number;
  lectura: number;
  salida: number;
}

/** USD de una petición, por categoría, con el descuento del lote. */
export function desglose(
  modelo: IdModelo,
  uso: Uso,
  cobro: Cobro,
): Desglose {
  const t = TARIFAS[modelo];
  const escritura = uso.cache_creation_input_tokens ?? 0;
  const lectura = uso.cache_read_input_tokens ?? 0;
  const precioEscritura =
    cobro.vida === "1h" ? t.escritura1h : t.escritura5m;
  // Se supone que el descuento del lote se apila con los del caché:
  // la documentación dice que se combinan [VERIFICAR AL CIERRE].
  const f = cobro.lote ? FACTOR_LOTE : 1;
  return {
    entrada: (uso.input_tokens * t.entrada * f) / MTOK,
    escritura: (escritura * precioEscritura * f) / MTOK,
    lectura: (lectura * t.lectura * f) / MTOK,
    salida: (uso.output_tokens * t.salida * f) / MTOK,
  };
}

export function costoPeticion(
  modelo: IdModelo,
  uso: Uso,
  cobro: Cobro,
): number {
  const d = desglose(modelo, uso, cobro);
  return d.entrada + d.escritura + d.lectura + d.salida;
}

/** Tokens de un manuscrito, con la proporción del capítulo 3. */
export function tokensDePalabras(palabras: number): number {
  return Math.ceil((palabras / PALABRAS_POR_MILLON) * MTOK);
}

/** Supuestos del libro (sintéticos): reemplázalos por medidas. */
export interface Supuestos {
  manuscritos: number;
  palabrasPorManuscrito: number;
  /** Tokens de la instrucción fija. */
  prefijo: number;
  /** Tokens del texto que sí ves en la respuesta. */
  salidaVisible: number;
  /** Tokens de razonamiento: se cobran como salida. */
  razonamiento: number;
}

export const SUPUESTOS: Supuestos = {
  manuscritos: 500,
  palabrasPorManuscrito: 1500,
  prefijo: 1000,
  salidaVisible: 300,
  razonamiento: 900,
};

export interface Configuracion {
  nombre: string;
  modelo: IdModelo;
  lote: boolean;
  cache: "no" | Vida;
  /** "ninguno": el prefijo cambia y toda petición escribe. */
  aciertos: "todos" | "ninguno";
}

const OPUS = "claude-opus-5-5";
const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";

function cfg(
  nombre: string,
  modelo: IdModelo,
  lote: boolean,
  cache: "no" | Vida,
  aciertos: "todos" | "ninguno" = "todos",
): Configuracion {
  return { nombre, modelo, lote, cache, aciertos };
}

export const CONFIGURACIONES: Configuracion[] = [
  cfg("base: Opus 5.5, sin caché, de uno en uno", OPUS, false, "no"),
  cfg("(a) Sonnet 5.5, sin caché", SONNET, false, "no"),
  cfg("(a) Haiku 5.5, sin caché", HAIKU, false, "no"),
  cfg("(b) Opus 5.5, caché de 5 min", OPUS, false, "5m"),
  cfg("(b) caché, prefijo que cambia", OPUS, false, "5m", "ninguno"),
  cfg("(c) Opus 5.5 en lote, sin caché", OPUS, true, "no"),
  cfg("lote + caché 1 h, mejor caso", OPUS, true, "1h"),
  cfg("lote + caché 1 h, peor caso", OPUS, true, "1h", "ninguno"),
  cfg("Haiku 5.5, lote + caché 1 h, mejor", HAIKU, true, "1h"),
];

/** El `usage` que dejaría cada manuscrito del escenario. */
export function usosDe(c: Configuracion, s: Supuestos): Uso[] {
  const manuscrito = tokensDePalabras(s.palabrasPorManuscrito);
  const salida = s.salidaVisible + s.razonamiento;
  const detalle = { thinking_tokens: s.razonamiento };
  // Bajo el mínimo, el servicio no guarda nada y no avisa.
  const guarda = c.cache !== "no" && s.prefijo >= MINIMO_CACHE;
  const usos: Uso[] = [];
  for (let i = 0; i < s.manuscritos; i++) {
    if (!guarda) {
      usos.push({
        input_tokens: s.prefijo + manuscrito,
        output_tokens: salida,
        output_tokens_details: detalle,
      });
      continue;
    }
    // La primera petición escribe el prefijo; las demás lo leen, si
    // el prefijo se repite y lo guardado no venció.
    const lee = c.aciertos === "todos" && i > 0;
    usos.push({
      input_tokens: manuscrito,
      output_tokens: salida,
      cache_creation_input_tokens: lee ? 0 : s.prefijo,
      cache_read_input_tokens: lee ? s.prefijo : 0,
      output_tokens_details: detalle,
    });
  }
  return usos;
}

export function costoTotal(c: Configuracion, s: Supuestos): number {
  const cobro: Cobro = {
    vida: c.cache === "1h" ? "1h" : "5m",
    lote: c.lote,
  };
  return usosDe(c, s).reduce(
    (suma, uso) => suma + costoPeticion(c.modelo, uso, cobro),
    0,
  );
}

export const usd = (n: number): string => n.toFixed(2);

/** Cuánto más o menos que la base, en por ciento. */
export function contra(n: number, base: number): string {
  const p = Math.round((n / base - 1) * 100);
  return p === 0 ? "=" : `${p > 0 ? "+" : ""}${p} %`;
}

/** La tabla de configuraciones: lo que el libro rotula estimación. */
export function tablaDeConfiguraciones(s: Supuestos): string[] {
  const base = costoTotal(CONFIGURACIONES[0]!, s);
  return CONFIGURACIONES.map((c) => {
    const total = costoTotal(c, s);
    return (
      c.nombre.padEnd(42) +
      usd(total).padStart(8) +
      contra(total, base).padStart(10)
    );
  });
}

/** Qué pasa si el razonamiento o la instrucción son otros. */
export function sensibilidades(s: Supuestos): string[] {
  const lineas = ["Si el razonamiento por manuscrito fuera:"];
  for (const razonamiento of [300, 900, 2400]) {
    const t = { ...s, razonamiento };
    lineas.push(
      `  ${razonamiento} tokens: lote + caché 1 h cuesta ` +
        usd(costoTotal(CONFIGURACIONES[6]!, t)),
    );
  }
  lineas.push("Si la instrucción fija midiera (Opus, caché de 5 min):");
  for (const prefijo of [400, 1000, 4000, 12000]) {
    const t = { ...s, prefijo };
    const sin = costoTotal(CONFIGURACIONES[0]!, t);
    const sano = costoTotal(CONFIGURACIONES[3]!, t);
    const roto = costoTotal(CONFIGURACIONES[4]!, t);
    lineas.push(
      `  ${prefijo} tokens: sin ${usd(sin)}, ` +
        `sano ${usd(sano)} (${contra(sano, sin)}), ` +
        `cambiante ${usd(roto)} (${contra(roto, sin)})`,
    );
  }
  return lineas;
}

interface Grabacion {
  _sintetico?: boolean;
  modelo: IdModelo;
  vida: Vida;
  lote: boolean;
  peticiones: { enviada: string; esfuerzo: string; usage: Uso }[];
}

/** Cobra una lista de `usage` ya recibidos, petición por petición. */
export async function leerGrabacion(ruta: string): Promise<string[]> {
  const g = JSON.parse(await readFile(ruta, "utf8")) as Grabacion;
  const cobro: Cobro = { vida: g.vida, lote: g.lote };
  const suma = { entrada: 0, escritura: 0, lectura: 0, salida: 0 };
  let tokensSalida = 0;
  let razonamiento = 0;
  let aciertos = 0;
  const lineas = g.peticiones.map((p, i) => {
    const u = p.usage;
    const d = desglose(g.modelo, u, cobro);
    suma.entrada += d.entrada;
    suma.escritura += d.escritura;
    suma.lectura += d.lectura;
    suma.salida += d.salida;
    tokensSalida += u.output_tokens;
    razonamiento += u.output_tokens_details?.thinking_tokens ?? 0;
    if ((u.cache_read_input_tokens ?? 0) > 0) aciertos++;
    return (
      `${i + 1}: entrada ${u.input_tokens}, ` +
      `escribió ${u.cache_creation_input_tokens ?? 0}, ` +
      `leyó ${u.cache_read_input_tokens ?? 0}, ` +
      `salida ${u.output_tokens} ` +
      `(razonando ${u.output_tokens_details?.thinking_tokens ?? 0}), ` +
      `${costoPeticion(g.modelo, u, cobro).toFixed(4)} USD`
    );
  });
  const u4 = (n: number): string => n.toFixed(4);
  const total =
    suma.entrada + suma.escritura + suma.lectura + suma.salida;
  return [
    `${ruta}${g._sintetico ? " (grabación sintética)" : ""}`,
    `${g.modelo}, vida ${g.vida}, lote ${g.lote ? "sí" : "no"}`,
    ...lineas,
    `USD: entrada ${u4(suma.entrada)}, escritura ` +
      `${u4(suma.escritura)}, lectura ${u4(suma.lectura)}, ` +
      `salida ${u4(suma.salida)}; total ${u4(total)}`,
    `salida: ${tokensSalida} tokens, ${razonamiento} de razonamiento`,
    `aciertos de caché: ${aciertos} de ${g.peticiones.length}`,
  ];
}

/** Lo que imprime `npm run costos` sin argumentos. */
export async function resumen(): Promise<string[]> {
  const plantilla = await cargarPlantilla("clasificar.v3");
  const s: Supuestos = {
    ...SUPUESTOS,
    // La estimación del capítulo 3: la mayor de las dos.
    prefijo: estimar(plantilla.sistema ?? "").estimacion,
  };
  return [
    `Estimación con precios a la fecha (${FECHA_PRECIOS}) ` +
      "[VERIFICAR AL CIERRE]",
    `Supuestos sintéticos: ${s.manuscritos} manuscritos de ` +
      `${s.palabrasPorManuscrito} palabras ` +
      `(~${tokensDePalabras(s.palabrasPorManuscrito)} tokens).`,
    `Instrucción fija medida: ~${s.prefijo} tokens. Salida: ` +
      `${s.salidaVisible} visibles + ${s.razonamiento} razonando.`,
    "",
    "configuración".padEnd(42) +
      "USD".padStart(8) +
      "vs base".padStart(10),
    ...tablaDeConfiguraciones(s),
    "",
    ...sensibilidades(s),
  ];
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  try {
    const [bandera, ruta] = process.argv.slice(2);
    const lineas =
      bandera === "--uso" && ruta !== undefined
        ? await leerGrabacion(ruta)
        : await resumen();
    console.log(lineas.join("\n"));
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
