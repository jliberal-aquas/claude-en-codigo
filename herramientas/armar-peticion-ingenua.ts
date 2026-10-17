import type Anthropic from "@anthropic-ai/sdk";
import { MODELO } from "../paquetes/cliente/src/llamar.js";
import {
  armarPeticion,
  horaDeRegistro,
  type OpcionesCache,
  type Plantilla,
} from "../paquetes/cliente/src/armar-peticion.js";

/**
 * Herramienta del editor: la primera versión de
 * `armarPeticionConCache`, la que el lector escribe en `lab/c04` y que
 * antepone la hora de registro a la instrucción de sistema. El
 * repositorio del lector no la conserva; la usa `generar-usos.ts` para
 * armar las peticiones de `fixtures/uso-ingenua.json`.
 */
export function armarPeticionIngenua(
  plantilla: Plantilla,
  manuscrito: string,
  opciones: OpcionesCache,
): Anthropic.MessageCreateParamsNonStreaming {
  const base = armarPeticion(plantilla, manuscrito);
  const hora = horaDeRegistro(opciones.ahora);
  return {
    model: MODELO,
    max_tokens: 4000,
    output_config: { effort: opciones.esfuerzo ?? "medium" },
    system: [
      {
        type: "text",
        text: `Hora del registro: ${hora}\n\n${base.system}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: base.messages,
  };
}
