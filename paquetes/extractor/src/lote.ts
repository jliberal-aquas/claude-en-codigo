import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  crearClienteLotes,
  type ClienteLotes,
  type PeticionLote,
} from "../../cliente/src/crear-cliente.js";
import {
  analizarRespuesta,
  armarPeticionFicha,
  armarReintento,
  cargarInstruccion,
  PATRON_CUSTOM_ID,
  validarEntrada,
} from "./extraer.js";
import {
  CARPETA_ENTRADA,
  CARPETA_FICHAS,
  cargarEsquema,
  envolver,
  validarFicha,
  type ErrorFicha,
  type Esquema,
  type Ficha,
} from "./validar.js";

/**
 * Las fichas de toda la carpeta en un lote. Se puede cortar en
 * cualquier punto y volver a correr: lo terminado es lo que ya está
 * en `manuscritos/fichas/` y valida; solo se envía lo demás.
 */

const ESTADO = ".lote/estado.json";

/** Una ficha que falló y espera su reintento. */
export interface Reintento {
  ficha: string;
  errores: ErrorFicha[];
}

export interface Estado {
  /** Un lote enviado y todavía sin recoger: custom_id -> id. */
  enCurso: { lote: string; enviados: Record<string, string> } | null;
  reintentos: Record<string, Reintento>;
  /** Lo que ya no se reintenta: lo decide una persona. */
  revision: Record<string, string>;
}

const VACIO: Estado = { enCurso: null, reintentos: {}, revision: {} };

async function leerEstado(): Promise<Estado> {
  try {
    return JSON.parse(await readFile(ESTADO, "utf8")) as Estado;
  } catch {
    return structuredClone(VACIO);
  }
}

async function guardarEstado(estado: Estado): Promise<void> {
  await mkdir(".lote", { recursive: true });
  await writeFile(ESTADO, `${JSON.stringify(estado, null, 2)}\n`);
}

/** El reintento tiene su propio custom_id: no pisa al primero. */
export function customIdDe(id: string, esReintento: boolean): string {
  const c = esReintento ? `${id}-r1` : id;
  if (!PATRON_CUSTOM_ID.test(c)) throw new Error(`custom_id: ${c}`);
  return c;
}

/** Lo que falta: ni ficha válida ni en manos de una persona. */
export function pendientes(
  ids: string[],
  hechas: Set<string>,
  estado: Estado,
): string[] {
  return ids.filter(
    (id) => !hechas.has(id) && !(id in estado.revision),
  );
}

/** Una ficha guardada cuenta como hecha solo si valida hoy. */
async function fichasHechas(
  ids: string[],
  esquema: Esquema,
): Promise<Map<string, Ficha>> {
  const hechas = new Map<string, Ficha>();
  for (const id of ids) {
    let guardada: Record<string, unknown>;
    try {
      const ruta = `${CARPETA_FICHAS}/${id}.json`;
      guardada = JSON.parse(
        await readFile(ruta, "utf8"),
      ) as typeof guardada;
    } catch {
      continue;
    }
    // El id no se le pide al modelo: lo pone tu programa.
    const { id: suyo, ...ficha } = guardada;
    const texto = await readFile(`${CARPETA_ENTRADA}/${id}.md`, "utf8");
    const r = validarFicha(ficha, esquema, texto);
    if (suyo === id && r.ok) hechas.set(id, r.ficha);
  }
  return hechas;
}

async function idsDeEntrada(): Promise<string[]> {
  return (await readdir(CARPETA_ENTRADA))
    .filter((f) => /^ms-\d{3}\.md$/.test(f))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** Envía lo pendiente, o recoge un lote que quedó a medias. */
export async function correrLote(cliente: ClienteLotes): Promise<void> {
  const esquema = await cargarEsquema();
  const plantilla = await cargarInstruccion();
  const estado = await leerEstado();
  const ids = await idsDeEntrada();
  const textos = new Map<string, string>();
  for (const id of ids) {
    textos.set(
      id,
      await readFile(`${CARPETA_ENTRADA}/${id}.md`, "utf8"),
    );
  }

  if (estado.enCurso === null) {
    const hechas = await fichasHechas(ids, esquema);
    const faltan = pendientes(ids, new Set(hechas.keys()), estado);
    if (faltan.length === 0) {
      console.log(`nada pendiente: ${hechas.size} fichas válidas`);
      return;
    }
    const requests: PeticionLote[] = [];
    const enviados: Record<string, string> = {};
    for (const id of faltan) {
      const texto = textos.get(id) ?? "";
      validarEntrada(id, texto);
      const base = armarPeticionFicha(plantilla, texto, esquema);
      const r = estado.reintentos[id];
      const custom_id = customIdDe(id, r !== undefined);
      const params = r
        ? armarReintento(base, r.ficha, r.errores, "con-errores")
        : base;
      requests.push({ custom_id, params });
      enviados[custom_id] = id;
    }
    const { id: lote } = await cliente.create({ requests });
    // Se anota antes de esperar: si el programa se corta, la próxima
    // vez recoge este lote en vez de pagar otro.
    estado.enCurso = { lote, enviados };
    await guardarEstado(estado);
    const lista = Object.keys(enviados).join(" ");
    console.log(`enviadas ${requests.length}:`);
    for (const l of envolver(lista)) console.log(`  ${l}`);
  } else {
    console.log(`recojo el lote que quedó a medias`);
  }

  const { lote, enviados } = estado.enCurso;
  while ((await cliente.retrieve(lote)).processing_status !== "ended") {
    await new Promise((listo) => setTimeout(listo, 60_000));
  }

  const recibidos = new Set<string>();
  const cuenta = {
    validas: 0,
    reintentar: 0,
    reenviar: 0,
    revision: 0,
  };
  await mkdir(CARPETA_FICHAS, { recursive: true });
  // Llegan en cualquier orden: todo se busca por custom_id.
  for await (const r of await cliente.results(lote)) {
    const id = enviados[r.custom_id];
    if (id === undefined) throw new Error(`¿${r.custom_id}?`);
    recibidos.add(r.custom_id);
    const esReintento = r.custom_id !== id;
    const nota = (s: string) => console.log(`${r.custom_id} ${s}`);
    if (r.result.type !== "succeeded") {
      const tipo =
        r.result.type === "errored"
          ? r.result.error.error.type
          : r.result.type;
      if (tipo === "invalid_request_error") {
        // Reenviarla igual daría el mismo error: hay que corregirla.
        estado.revision[id] = "petición inválida";
        cuenta.revision += 1;
        nota(`${tipo}: a revisión`);
      } else {
        cuenta.reenviar += 1;
        nota(`${tipo}: queda pendiente`);
      }
      continue;
    }
    const a = analizarRespuesta(r.result.message);
    const v = a.ok
      ? validarFicha(a.valor, esquema, textos.get(id) ?? "")
      : null;
    if (v?.ok) {
      const ruta = `${CARPETA_FICHAS}/${id}.json`;
      const guardada = { id, ...v.ficha };
      await writeFile(ruta, `${JSON.stringify(guardada, null, 2)}\n`);
      delete estado.reintentos[id];
      cuenta.validas += 1;
      nota("ficha válida");
    } else if (a.ok && v !== null && !v.ok && !esReintento) {
      estado.reintentos[id] = { ficha: a.texto, errores: v.errores };
      cuenta.reintentar += 1;
      nota(`${v.errores.length} errores: se reintenta`);
    } else {
      delete estado.reintentos[id];
      estado.revision[id] = a.ok
        ? "no pasó tras el reintento"
        : a.motivo;
      cuenta.revision += 1;
      nota(`a revisión: ${estado.revision[id]}`);
    }
  }
  for (const c of Object.keys(enviados)) {
    if (!recibidos.has(c)) {
      cuenta.reenviar += 1;
      console.log(`${c} sin resultado: queda pendiente`);
    }
  }
  estado.enCurso = null;
  await guardarEstado(estado);
  const hechas = await fichasHechas(ids, esquema);
  const faltan = pendientes(ids, new Set(hechas.keys()), estado);
  console.log(
    `válidas ${cuenta.validas} · a reintentar ${cuenta.reintentar}` +
      ` · a reenviar ${cuenta.reenviar}` +
      ` · a revisión ${cuenta.revision}`,
  );
  console.log(`pendientes: ${faltan.join(" ") || "ninguna"}`);
}

/** Azar con semilla: la misma muestra cada vez que lo corres. */
function azar(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface ParaRevisar {
  id: string;
  motivo: string;
}

/**
 * Qué fichas mira una persona: todas las de riesgo, por regla, y
 * unas pocas de las demás al azar, para medir lo que parece seguro.
 */
export function elegirParaRevision(
  fichas: Map<string, Ficha>,
  alAzar = 2,
  semilla = 12,
): ParaRevisar[] {
  const elegidas: ParaRevisar[] = [];
  const resto: string[] = [];
  for (const [id, f] of [...fichas].sort()) {
    if (f.premios !== null || f.editorial_previa !== null) {
      elegidas.push({ id, motivo: "dato sobre quien firma" });
    } else if (f.confianza === "baja") {
      elegidas.push({ id, motivo: "confianza baja" });
    } else if (f.genero === "otro") {
      elegidas.push({ id, motivo: "género fuera de la lista" });
    } else {
      resto.push(id);
    }
  }
  const r = azar(semilla);
  const barajado = resto
    .map((id) => ({ id, k: r() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, alAzar);
  for (const { id } of barajado) {
    const f = fichas.get(id);
    elegidas.push({
      id,
      motivo: `al azar (confianza ${f?.confianza})`,
    });
  }
  return elegidas;
}

async function muestra(): Promise<void> {
  const ids = await idsDeEntrada();
  const hechas = await fichasHechas(ids, await cargarEsquema());
  for (const { id, motivo } of elegirParaRevision(hechas)) {
    console.log(`${id} ${motivo}`);
  }
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  try {
    const orden = process.argv[2] ?? "correr";
    if (orden === "muestra") await muestra();
    else await correrLote(crearClienteLotes({ grabacion: "lote" }));
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 2;
  }
}
