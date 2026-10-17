import {
  armarPeticion,
  type Peticion,
  type Plantilla,
} from "./armar-peticion.js";
import type { ClienteClaude } from "./crear-cliente.js";
import { MODELO } from "./llamar.js";

export interface Clasificacion {
  /** En minúsculas, para comparar sin pelear con las mayúsculas. */
  genero: string;
  /** Solo la v2 lo pide; la v1 responde una línea. */
  motivo: string | undefined;
  notas: string | undefined;
  texto: string;
  peticion: Peticion;
}

/**
 * Lee la respuesta de cualquiera de las dos versiones: la v1 contesta
 * una línea ("Realismo."); la v2, un objeto JSON. Lo que se pidió no
 * está garantizado: si el JSON no trae `genero` o viene con texto
 * alrededor, falla en voz alta.
 */
export function leerRespuesta(
  texto: string,
): Pick<Clasificacion, "genero" | "motivo" | "notas"> {
  const limpio = texto.trim();
  if (!limpio.startsWith("{")) {
    if (limpio.includes('"genero"')) {
      throw new Error("El JSON viene con texto alrededor.");
    }
    const linea = limpio.split("\n")[0] ?? "";
    return {
      genero: linea.replace(/[.\s]+$/, "").toLowerCase(),
      motivo: undefined,
      notas: undefined,
    };
  }
  const objeto: unknown = JSON.parse(limpio);
  const o = (objeto ?? {}) as Record<string, unknown>;
  if (typeof o["genero"] !== "string") {
    throw new Error('La respuesta no trae el campo "genero".');
  }
  const comoTexto = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    genero: o["genero"].toLowerCase(),
    motivo: comoTexto(o["motivo"]),
    notas: comoTexto(o["notas_del_autor"]),
  };
}

/** Clasifica un manuscrito con la plantilla que elijas. */
export async function clasificar(
  cliente: ClienteClaude,
  plantilla: Plantilla,
  manuscrito: string,
): Promise<Clasificacion> {
  const peticion = armarPeticion(plantilla, manuscrito);
  const respuesta = await cliente.messages.create({
    model: MODELO,
    // Tope de corte, con holgura: `thinking` también cuenta.
    max_tokens: 2000,
    system: peticion.system,
    messages: peticion.messages,
  });
  const texto = respuesta.content
    .filter((bloque) => bloque.type === "text")
    .map((bloque) => bloque.text)
    .join("\n");
  return { ...leerRespuesta(texto), texto, peticion };
}
