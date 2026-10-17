import type Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  armarPeticion,
  type Plantilla,
} from "../../cliente/src/armar-peticion.js";
import {
  crearCliente,
  leerModo,
  type ClienteClaude,
  type RespuestaMensaje,
} from "../../cliente/src/crear-cliente.js";
import { MODELO } from "../../cliente/src/llamar.js";
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
 * Pide la ficha de un manuscrito con salida estructurada, la analiza
 * sin dar nada por hecho, la valida y, si falla, reintenta una vez.
 */

const CARPETA = new URL("../prompts/", import.meta.url);

/** Lee `prompts/<nombre>.md` con el formato del capítulo 2. */
export async function cargarInstruccion(
  nombre = "ficha.v1",
): Promise<Plantilla> {
  const crudo = await readFile(
    new URL(`${nombre}.md`, CARPETA),
    "utf8",
  );
  const version = /^version:\s*(\S+)\s*$/m.exec(crudo)?.[1];
  const [, sistema, mensaje] = crudo.split(
    /^## (?:Sistema|Mensaje)\s*$/m,
  );
  if (!version || sistema === undefined || mensaje === undefined) {
    throw new Error(`${nombre}.md: faltan la versión o una sección.`);
  }
  return { version, sistema: sistema.trim(), mensaje: mensaje.trim() };
}

/** Lo que el lote acepta como `custom_id`, según la documentación. */
export const PATRON_CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validación de la entrada: antes de gastar una petición, lo que tú
 * controlas tiene que estar bien. Un id raro no llega al lote.
 */
export function validarEntrada(id: string, texto: string): void {
  if (!/^ms-\d{3}$/.test(id) || !PATRON_CUSTOM_ID.test(id)) {
    throw new Error(`"${id}" no es un id de manuscrito (ms-000).`);
  }
  if (texto.trim() === "") {
    throw new Error(`${id}: el manuscrito está vacío.`);
  }
}

/** La petición: la del capítulo 2 más el esquema de la respuesta. */
export function armarPeticionFicha(
  plantilla: Plantilla,
  manuscrito: string,
  esquema: Esquema,
): Anthropic.MessageCreateParamsNonStreaming {
  const p = armarPeticion(plantilla, manuscrito);
  return {
    model: MODELO,
    // Con holgura: si la ficha se corta, deja de cumplir el esquema.
    max_tokens: 4000,
    system: p.system,
    messages: p.messages,
    output_config: {
      format: { type: "json_schema", schema: { ...esquema } },
    },
  };
}

export type ModoReintento = "con-errores" | "ingenuo";

/** El mensaje del reintento. El ingenuo es el del laboratorio. */
export function mensajeReintento(
  errores: ErrorFicha[],
  modo: ModoReintento,
): string {
  if (modo === "ingenuo") {
    return "La ficha está incompleta. Completa todos los campos.";
  }
  const lista = errores.map((e) => `- ${e.campo}: ${e.mensaje}`);
  return [
    "Tu ficha no pasó la validación:",
    ...lista,
    "",
    "Devuelve la ficha entera, corregida. Cambia solo esos campos.",
    "Si un dato no está en el manuscrito, el valor correcto es null.",
  ].join("\n");
}

/**
 * El reintento lleva el manuscrito, la ficha que falló y los errores.
 * La ficha va como mensaje de `assistant` en medio de la historia, no
 * al final: no es empezar la respuesta por Claude.
 */
export function armarReintento(
  base: Anthropic.MessageCreateParamsNonStreaming,
  fichaFallida: string,
  errores: ErrorFicha[],
  modo: ModoReintento,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    ...base,
    messages: [
      ...base.messages,
      { role: "assistant", content: fichaFallida },
      { role: "user", content: mensajeReintento(errores, modo) },
    ],
  };
}

export type Analisis =
  | { ok: true; texto: string; valor: unknown }
  | { ok: false; texto: string; motivo: string };

/**
 * Análisis defensivo: nada de `JSON.parse` a ciegas. Primero por qué
 * se detuvo; después, si el texto es JSON. Lo que no se pudo leer se
 * nombra, no se adivina.
 */
export function analizarRespuesta(r: RespuestaMensaje): Analisis {
  const texto = r.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  switch (r.stop_reason) {
    case "end_turn":
      break;
    case "max_tokens":
      return {
        ok: false,
        texto,
        motivo: "se cortó en max_tokens: la ficha puede estar a medias",
      };
    case "refusal":
      return {
        ok: false,
        texto,
        motivo: "rechazo: la salida puede no cumplir el esquema",
      };
    case "stop_sequence":
      return {
        ok: false,
        texto,
        motivo: `se detuvo en «${r.stop_sequence}»: ficha a medias`,
      };
    default:
      return {
        ok: false,
        texto,
        motivo: `stop_reason ${r.stop_reason}`,
      };
  }
  try {
    return { ok: true, texto, valor: JSON.parse(texto) };
  } catch {
    return { ok: false, texto, motivo: "el texto no es JSON" };
  }
}

export interface Intento {
  numero: number;
  stopReason: string | null;
  /** El valor leído, si el texto era JSON. */
  valor: unknown;
  /** Por qué no se pudo leer, si no se pudo. */
  motivo: string | null;
  errores: ErrorFicha[];
}

export interface Extraccion {
  id: string;
  ficha: Ficha | null;
  intentos: Intento[];
}

/**
 * Un cliente por intento: en modo grabado, cada uno lee su grabación;
 * con la API real, es el mismo cliente repetido. Hay un solo
 * reintento: si el segundo también falla, decide una persona.
 */
export async function extraerFicha(
  clientes: ClienteClaude[],
  id: string,
  manuscrito: string,
  esquema: Esquema,
  plantilla: Plantilla,
  modo: ModoReintento = "con-errores",
): Promise<Extraccion> {
  validarEntrada(id, manuscrito);
  const base = armarPeticionFicha(plantilla, manuscrito, esquema);
  let peticion = base;
  const intentos: Intento[] = [];
  for (const [i, cliente] of clientes.slice(0, 2).entries()) {
    const r = await cliente.messages.create(peticion);
    const a = analizarRespuesta(r);
    const intento: Intento = {
      numero: i + 1,
      stopReason: r.stop_reason,
      valor: a.ok ? a.valor : null,
      motivo: a.ok ? null : a.motivo,
      errores: [],
    };
    intentos.push(intento);
    if (!a.ok) {
      // Un corte o un rechazo no lo arregla este reintento.
      break;
    }
    const v = validarFicha(a.valor, esquema, manuscrito);
    if (v.ok) return { id, ficha: v.ficha, intentos };
    intento.errores = v.errores;
    peticion = armarReintento(base, a.texto, v.errores, modo);
  }
  return { id, ficha: null, intentos };
}

/** Los datos de quien firma, para ver qué escribió el modelo. */
function datos(valor: unknown): string {
  const o = (valor ?? {}) as Record<string, unknown>;
  const corto = (v: unknown) => {
    const s = JSON.stringify(v) ?? "undefined";
    return s.length > 52 ? `${s.slice(0, 51)}…` : s;
  };
  return ["premios", "editorial_previa"]
    .map((c) => `  ${c} = ${corto(o[c])}`)
    .join("\n");
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  try {
    const args = process.argv.slice(2);
    const opcion = (n: string) =>
      args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
    const id = args.find((a) => !a.startsWith("--"));
    if (id === undefined) {
      throw new Error(
        "uso: extraer.ts <ms-000> [--grabaciones=ab] " +
          "[--reintento=ingenuo] [--guardar]",
      );
    }
    const modo: ModoReintento =
      opcion("reintento") === "ingenuo" ? "ingenuo" : "con-errores";
    // En modo grabado, una letra por intento: "ab" lee la `a` y,
    // si hace falta reintentar, la `b`.
    const letras = [...(opcion("grabaciones") ?? "a")];
    const clientes =
      leerModo() === "real"
        ? [crearCliente(), crearCliente()]
        : letras.map((variante) =>
            crearCliente({ grabacion: `ficha-${id}`, variante }),
          );
    const texto = await readFile(`${CARPETA_ENTRADA}/${id}.md`, "utf8");
    const x = await extraerFicha(
      clientes,
      id,
      texto,
      await cargarEsquema(),
      await cargarInstruccion(),
      modo,
    );
    for (const [i, it] of x.intentos.entries()) {
      const previo = x.intentos[i - 1];
      if (previo !== undefined) {
        console.log(`${id} · reintento enviado:`);
        const enviado = mensajeReintento(previo.errores, modo);
        for (const linea of enviado.split("\n")) {
          const [primera = "", ...resto] = envolver(linea, 62);
          console.log(`  > ${primera}`.trimEnd());
          for (const l of resto) console.log(`  >   ${l}`);
        }
      }
      console.log(`${id} · intento ${it.numero} · ${it.stopReason}`);
      if (it.motivo !== null) {
        console.log(`  NO SE PUEDE LEER ${it.motivo}`);
      } else {
        console.log(datos(it.valor));
      }
      for (const e of it.errores) {
        console.log(`  FALLA ${e.campo}`);
        for (const l of envolver(e.mensaje)) console.log(`    ${l}`);
      }
    }
    if (x.ficha === null) {
      console.log(`resultado: a revisión humana`);
      process.exitCode = 1;
    } else {
      console.log(`resultado: ficha válida`);
      if (args.includes("--guardar")) {
        await mkdir(CARPETA_FICHAS, { recursive: true });
        const ruta = `${CARPETA_FICHAS}/${id}.json`;
        // El id lo pone tu programa: el modelo no lo escribe.
        const guardada = { id, ...x.ficha };
        await writeFile(ruta, `${JSON.stringify(guardada, null, 2)}\n`);
        console.log(`guardada en ${ruta}`);
      }
    }
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 2;
  }
}
