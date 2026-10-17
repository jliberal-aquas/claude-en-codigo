import { readFile } from "node:fs/promises";
import {
  armarPeticionConCache,
  cargarPlantilla,
} from "./armar-peticion.js";
import { crearCliente } from "./crear-cliente.js";

/**
 * Solo con la API real: tres peticiones seguidas con el mismo prefijo.
 * Lo que cuenta es `leyó`: debería pasar de 0 desde la segunda.
 * Uso: npm run cache:real
 */
if (process.env["CLAUDE_MODO"] !== "real") {
  console.error("error: este script pide CLAUDE_MODO=real.");
  process.exit(1);
}

const cliente = crearCliente();
const plantilla = await cargarPlantilla("clasificar.v3");
const ruta = "manuscritos/entrada/ms-004.md";
const manuscrito = await readFile(ruta, "utf8");

for (let i = 1; i <= 3; i++) {
  const peticion = armarPeticionConCache(plantilla, manuscrito, {
    ahora: new Date(),
  });
  // Una tras otra: la segunda lee lo que dejó la primera.
  const { usage: u } = await cliente.messages.create(peticion);
  console.log(
    `${i}: entrada ${u.input_tokens}, ` +
      `escribió ${u.cache_creation_input_tokens ?? 0}, ` +
      `leyó ${u.cache_read_input_tokens ?? 0}, ` +
      `salida ${u.output_tokens} ` +
      `(razonando ${u.output_tokens_details?.thinking_tokens ?? 0})`,
  );
}
