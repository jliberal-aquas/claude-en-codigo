import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  citaEnTexto,
  MIN_CITA,
  normalizar,
} from "../../cliente/src/verificar-citas.js";

/**
 * Validación de una ficha en dos capas. El esquema: que el valor
 * cumpla `manuscritos/ficha.schema.json`. El sentido: lo que ningún
 * esquema puede decir, como que una cita exista en el manuscrito o
 * que un año sea posible. Sin red y sin modelo: son reglas tuyas.
 */

/** El subconjunto de esquema JSON que usa la ficha. */
export interface Esquema {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, Esquema>;
  required?: string[];
  additionalProperties?: boolean;
  anyOf?: Esquema[];
  $ref?: string;
  $defs?: Record<string, Esquema>;
}

/** Un error con su campo y un mensaje que el modelo pueda usar. */
export interface ErrorFicha {
  campo: string;
  mensaje: string;
}

/** Un dato de quien firma, con la frase que lo respalda. */
export interface Dato {
  texto: string;
  anio: number | null;
  cita: string;
}

export interface Ficha {
  titulo: string;
  firma: string | null;
  genero: string;
  genero_detalle: string | null;
  resumen: string;
  premios: Dato | null;
  editorial_previa: Dato | null;
  notas_del_autor: string | null;
  confianza: "alta" | "media" | "baja";
}

export const RUTA_ESQUEMA = "manuscritos/ficha.schema.json";
export const CARPETA_FICHAS = "manuscritos/fichas";
export const CARPETA_ENTRADA = "manuscritos/entrada";

export async function cargarEsquema(
  ruta: string = RUTA_ESQUEMA,
): Promise<Esquema> {
  return JSON.parse(await readFile(ruta, "utf8")) as Esquema;
}

function tipoDe(valor: unknown): string {
  if (valor === null) return "null";
  if (Array.isArray(valor)) return "array";
  if (Number.isInteger(valor)) return "integer";
  return typeof valor;
}

/** Solo referencias internas, como `#/$defs/dato`. */
function resolver(esquema: Esquema, raiz: Esquema): Esquema {
  if (esquema.$ref === undefined) return esquema;
  const nombre = /^#\/\$defs\/(.+)$/.exec(esquema.$ref)?.[1];
  const destino = nombre ? raiz.$defs?.[nombre] : undefined;
  if (destino === undefined) {
    throw new Error(`Referencia que no existe: ${esquema.$ref}`);
  }
  return destino;
}

/** Capa del esquema. Devuelve todos los errores, no el primero. */
export function revisarEsquema(
  valor: unknown,
  esquema: Esquema,
  raiz: Esquema = esquema,
  ruta = "ficha",
): ErrorFicha[] {
  const e = resolver(esquema, raiz);
  if (e.anyOf !== undefined) {
    const ramas = e.anyOf.map((r) =>
      revisarEsquema(valor, r, raiz, ruta),
    );
    if (ramas.some((errores) => errores.length === 0)) return [];
    return ramas.reduce((a, b) => (b.length < a.length ? b : a));
  }
  const errores: ErrorFicha[] = [];
  const falla = (campo: string, mensaje: string) =>
    errores.push({ campo, mensaje });
  const tipos = e.type === undefined ? [] : [e.type].flat();
  const tipo = tipoDe(valor);
  // Un entero también es un número para el esquema JSON.
  const calza = (t: string) =>
    t === tipo || (t === "number" && tipo === "integer");
  if (tipos.length > 0 && !tipos.some(calza)) {
    falla(ruta, `se esperaba ${tipos.join(" o ")} y llegó ${tipo}`);
    return errores;
  }
  if (e.enum !== undefined && !e.enum.includes(valor)) {
    falla(ruta, `${JSON.stringify(valor)} no está en la lista`);
  }
  if (tipo === "object" && e.properties !== undefined) {
    const o = valor as Record<string, unknown>;
    for (const campo of e.required ?? []) {
      if (!(campo in o)) falla(`${ruta}.${campo}`, "falta el campo");
    }
    for (const [campo, v] of Object.entries(o)) {
      const sub = e.properties[campo];
      if (sub === undefined) {
        if (e.additionalProperties === false) {
          falla(`${ruta}.${campo}`, "campo que el esquema no tiene");
        }
        continue;
      }
      errores.push(...revisarEsquema(v, sub, raiz, `${ruta}.${campo}`));
    }
  }
  return errores;
}

/**
 * La documentación no garantiza las mayúsculas de un `enum`: antes de
 * comparar, se pasa a minúsculas lo que coincide sin distinguirlas.
 */
export function normalizarMayusculas(valor: unknown): unknown {
  if (typeof valor !== "object" || valor === null) return valor;
  const o = { ...(valor as Record<string, unknown>) };
  for (const campo of ["genero", "confianza"]) {
    const v = o[campo];
    if (typeof v === "string") o[campo] = v.trim().toLowerCase();
  }
  return o;
}

/** El año más alto posible para un dato: el actual. */
export const ANIO_MAXIMO = new Date().getFullYear();
export const ANIO_MINIMO = 1900;

/** Un dato de quien firma: o es null, o trae una cita que existe. */
function revisarDato(
  campo: string,
  dato: Dato | null,
  manuscrito: string,
): ErrorFicha[] {
  if (dato === null) return [];
  const errores: ErrorFicha[] = [];
  const siFalta = `si el manuscrito no lo dice, ${campo} es null`;
  const cita = normalizar(dato.cita);
  if (cita === "") {
    errores.push({
      campo: `${campo}.cita`,
      mensaje: `la cita está vacía; ${siFalta}`,
    });
  } else if (cita.length < MIN_CITA) {
    errores.push({
      campo: `${campo}.cita`,
      mensaje: `la cita tiene menos de ${MIN_CITA} caracteres`,
    });
  } else if (!citaEnTexto(cita, manuscrito)) {
    errores.push({
      campo: `${campo}.cita`,
      mensaje: `la cita no aparece en el manuscrito; ${siFalta}`,
    });
  }
  if (dato.anio !== null) {
    if (dato.anio < ANIO_MINIMO || dato.anio > ANIO_MAXIMO) {
      errores.push({
        campo: `${campo}.anio`,
        mensaje:
          `${dato.anio} es imposible: debe estar entre ` +
          `${ANIO_MINIMO} y ${ANIO_MAXIMO}`,
      });
    } else if (!cita.includes(String(dato.anio))) {
      errores.push({
        campo: `${campo}.anio`,
        mensaje:
          `${dato.anio} no está en la cita; ` +
          `si la cita no trae el año, anio es null`,
      });
    }
  }
  return errores;
}

/** Capa del sentido. Supone que el esquema ya pasó. */
export function revisarSentido(
  ficha: Ficha,
  manuscrito: string,
): ErrorFicha[] {
  const errores: ErrorFicha[] = [];
  const falla = (campo: string, mensaje: string) =>
    errores.push({ campo, mensaje });
  if (ficha.firma !== null && !citaEnTexto(ficha.firma, manuscrito)) {
    falla(
      "firma",
      `«${ficha.firma}» no aparece en el manuscrito; ` +
        "si no está firmado, firma es null",
    );
  }
  const detalle = ficha.genero_detalle?.trim() ?? "";
  if (ficha.genero === "otro" && detalle === "") {
    falla("genero_detalle", 'con género "otro", di cuál es');
  }
  if (ficha.genero !== "otro" && ficha.genero_detalle !== null) {
    falla("genero_detalle", 'solo lleva texto con género "otro"');
  }
  if (normalizar(ficha.resumen) === "") {
    falla("resumen", "el resumen está vacío");
  }
  errores.push(
    ...revisarDato("premios", ficha.premios, manuscrito),
    ...revisarDato(
      "editorial_previa",
      ficha.editorial_previa,
      manuscrito,
    ),
  );
  const notas = ficha.notas_del_autor;
  if (notas !== null && !citaEnTexto(notas, manuscrito)) {
    falla(
      "notas_del_autor",
      "no aparece tal cual en el manuscrito; si no hay nota, es null",
    );
  }
  return errores;
}

export type Resultado =
  | { ok: true; ficha: Ficha }
  | { ok: false; capa: "esquema" | "sentido"; errores: ErrorFicha[] };

/** En orden: el sentido no se mira si el esquema falla. */
export function validarFicha(
  valor: unknown,
  esquema: Esquema,
  manuscrito: string,
): Resultado {
  const normal = normalizarMayusculas(valor);
  const deEsquema = revisarEsquema(normal, esquema);
  if (deEsquema.length > 0) {
    return { ok: false, capa: "esquema", errores: deEsquema };
  }
  const ficha = normal as Ficha;
  const sentido = revisarSentido(ficha, manuscrito);
  if (sentido.length > 0) {
    return { ok: false, capa: "sentido", errores: sentido };
  }
  return { ok: true, ficha };
}

/** Parte un mensaje largo en líneas que caben en la terminal. */
export function envolver(texto: string, ancho = 60): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(" ")) {
    if (actual !== "" && actual.length + palabra.length >= ancho) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = actual === "" ? palabra : `${actual} ${palabra}`;
    }
  }
  return actual === "" ? lineas : [...lineas, actual];
}

/** Valida las fichas guardadas contra su manuscrito, por nombre. */
async function validarCarpeta(ids: string[]): Promise<number> {
  const esquema = await cargarEsquema();
  const todas = (await readdir(CARPETA_FICHAS))
    .filter((f) => /^ms-\d{3}\.json$/.test(f))
    .map((f) => basename(f, ".json"));
  const elegidas = ids.length > 0 ? ids : todas;
  let malas = 0;
  for (const id of elegidas) {
    const guardada = JSON.parse(
      await readFile(`${CARPETA_FICHAS}/${id}.json`, "utf8"),
    ) as Record<string, unknown>;
    // El id lo pone tu programa, no el modelo: no está en el esquema.
    const { id: suyo, ...ficha } = guardada;
    const texto = await readFile(`${CARPETA_ENTRADA}/${id}.md`, "utf8");
    const r = validarFicha(ficha, esquema, texto);
    const errores = r.ok
      ? []
      : r.errores.map((e) => ({ ...e, capa: r.capa }));
    if (suyo !== id) {
      errores.push({
        capa: "esquema",
        campo: "id",
        mensaje: `el archivo dice ${String(suyo)}`,
      });
    }
    if (errores.length === 0) {
      console.log(`${id} ok`);
      continue;
    }
    malas += 1;
    for (const e of errores) {
      console.log(`${id} FALLA ${e.capa} ${e.campo}`);
      for (const l of envolver(e.mensaje)) console.log(`    ${l}`);
    }
  }
  console.log(`${elegidas.length} fichas, ${malas} con errores`);
  return malas;
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  try {
    const malas = await validarCarpeta(process.argv.slice(2));
    process.exitCode = malas > 0 ? 1 : 0;
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 2;
  }
}
