import type Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { MODELO } from "./llamar.js";

/**
 * Arma lo que se envía a la API a partir de un archivo de instrucción
 * versionado (`prompts/clasificar.v2.md`) y un manuscrito. Salvo la
 * lectura del archivo, es pura: la misma entrada da siempre la misma
 * petición, así que se prueba sin API.
 */

const CARPETA = new URL("../prompts/", import.meta.url);
const ETIQUETA = "manuscrito";
const MARCA = "{{manuscrito}}";

export interface Plantilla {
  /** `clasificar.v2`: sale de la cabecera del archivo. */
  version: string;
  /** Lo común a todas las peticiones; la v1 no lo tiene. */
  sistema: string | undefined;
  /** Lo que cambia en cada una; lleva `{{manuscrito}}`. */
  mensaje: string;
}

export interface Peticion {
  version: string;
  system: string | undefined;
  messages: Anthropic.MessageParam[];
}

/** Lee `prompts/<nombre>.md` y lo parte en sus dos secciones. */
export async function cargarPlantilla(
  nombre: string,
): Promise<Plantilla> {
  const ruta = new URL(`${nombre}.md`, CARPETA);
  const crudo = await readFile(ruta, "utf8");
  const version = /^version:\s*(\S+)\s*$/m.exec(crudo)?.[1];
  // Con un grupo de captura, `split` intercala títulos y textos.
  const partes = crudo.split(/^## (Sistema|Mensaje)\s*$/m);
  const secciones = new Map<string, string>();
  for (let i = 1; i < partes.length; i += 2) {
    secciones.set(partes[i] ?? "", (partes[i + 1] ?? "").trim());
  }
  const mensaje = secciones.get("Mensaje");
  if (version === undefined || mensaje === undefined) {
    throw new Error(`${nombre}.md: faltan "version:" o "## Mensaje".`);
  }
  return { version, sistema: secciones.get("Sistema"), mensaje };
}

/**
 * Impide que el texto de un tercero abra o cierre tu etiqueta: cambia
 * `<manuscrito` y `</manuscrito` por una forma que ya no es etiqueta.
 * No borra nada de lo que dice el texto: una nota del autor sigue ahí.
 */
export function neutralizar(texto: string, etiqueta: string): string {
  return texto.replace(new RegExp(`<(/?${etiqueta})`, "gi"), "&lt;$1");
}

export function armarPeticion(
  plantilla: Plantilla,
  manuscrito: string,
): Peticion {
  if (!plantilla.mensaje.includes(MARCA)) {
    throw new Error(`${plantilla.version}: falta ${MARCA}.`);
  }
  // Con una función, `replace` no interpreta `$&` ni `$1` si aparecen
  // dentro del manuscrito.
  const mensaje = plantilla.mensaje.replace(MARCA, () =>
    neutralizar(manuscrito.trim(), ETIQUETA),
  );
  return {
    version: plantilla.version,
    system: plantilla.sistema,
    messages: [{ role: "user", content: mensaje }],
  };
}

export type Esfuerzo = "low" | "medium" | "high" | "xhigh" | "max";

export interface OpcionesCache {
  /** Cuándo se clasifica. Se inyecta para poder probar sin reloj. */
  ahora: Date;
  /** Se fija a propósito: el valor por defecto cambia por modelo. */
  esfuerzo?: Esfuerzo;
}

/** `2026-10-16T10:02:11Z`: segundos, sin milésimas. */
export function horaDeRegistro(ahora: Date): string {
  return ahora.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Envuelve `armarPeticion` y la deja lista para enviar: la instrucción
 * de sistema lleva el punto de corte, y la hora de registro viaja en
 * el mensaje, que es lo que cambia en cada petición.
 */
export function armarPeticionConCache(
  plantilla: Plantilla,
  manuscrito: string,
  opciones: OpcionesCache,
): Anthropic.MessageCreateParamsNonStreaming {
  const base = armarPeticion(plantilla, manuscrito);
  if (base.system === undefined) {
    throw new Error(`${base.version}: sin instrucción de sistema.`);
  }
  const hora = horaDeRegistro(opciones.ahora);
  const mensaje = String(base.messages[0]?.content);
  return {
    model: MODELO,
    // `thinking` también cuenta contra este tope: va con holgura.
    max_tokens: 4000,
    output_config: { effort: opciones.esfuerzo ?? "medium" },
    system: [
      {
        type: "text",
        text: base.system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Hora del registro: ${hora}\n\n${mensaje}`,
      },
    ],
  };
}

/**
 * El texto que va desde el principio hasta el punto de corte,
 * incluido. Aquí solo hay `system`; si hubiera herramientas, irían
 * antes. Se imprime para compararlo entre dos peticiones.
 */
export function prefijoDe(
  peticion: Anthropic.MessageCreateParamsNonStreaming,
): string {
  const sistema = peticion.system;
  if (typeof sistema === "string" || sistema === undefined) return "";
  const partes: string[] = [];
  for (const bloque of sistema) {
    partes.push(bloque.text);
    if (bloque.cache_control) break;
  }
  return partes.join("\n");
}
