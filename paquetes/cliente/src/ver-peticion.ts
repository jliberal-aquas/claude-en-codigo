import { readFile } from "node:fs/promises";
import { armarPeticion, cargarPlantilla } from "./armar-peticion.js";

/**
 * Muestra la petición final, tal como saldría hacia la API, sin
 * llamar a nadie. Uso: npm run peticion -- v2 [--corto|--resumen]
 */

/** Deja las primeras `cabeza` líneas y las últimas `cola`. */
function recortar(texto: string, cabeza: number, cola: number): string {
  const lineas = texto.split("\n");
  if (lineas.length <= cabeza + cola) return texto;
  const omitidas = lineas.length - cabeza - cola;
  return [
    ...lineas.slice(0, cabeza),
    `[… ${omitidas} líneas …]`,
    ...lineas.slice(-cola),
  ].join("\n");
}

/**
 * Cuenta los géneros que enseñan los ejemplos de la instrucción, ya
 * sean un JSON (v2) o una ficha con su línea `Género:` (v3).
 */
function contarEjemplos(sistema: string): string {
  const bloque = /<ejemplos>([\s\S]*)<\/ejemplos>/.exec(sistema)?.[1];
  const cuenta = new Map<string, number>();
  const forma = /"genero":\s*"([^"]+)"|^Género:\s*(.+)$/gm;
  for (const m of (bloque ?? "").matchAll(forma)) {
    const genero = m[1] ?? m[2] ?? "";
    cuenta.set(genero, (cuenta.get(genero) ?? 0) + 1);
  }
  if (cuenta.size === 0) return "ninguno";
  return [...cuenta]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([genero, n]) => `${genero} x${n}`)
    .join(", ");
}

const [version = "v2", ...banderas] = process.argv.slice(2);
const plantilla = await cargarPlantilla(`clasificar.${version}`);
const ruta = "manuscritos/entrada/ms-007.md";
const manuscrito = await readFile(ruta, "utf8");
const peticion = armarPeticion(plantilla, manuscrito);
const usuario = String(peticion.messages[0]?.content ?? "");
const corto = banderas.includes("--corto");

if (!banderas.includes("--resumen")) {
  if (peticion.system !== undefined) {
    console.log("=== instrucción de sistema ===");
    const s = peticion.system;
    console.log(corto ? recortar(s, 4, 4) : s);
  }
  console.log("=== mensaje del usuario ===");
  console.log(corto ? recortar(usuario, 4, 5) : usuario);
}
console.log("=== resumen ===");
console.log(`versión: ${peticion.version}`);
console.log(
  `instrucción de sistema: ${
    peticion.system === undefined
      ? "no tiene"
      : `${peticion.system.length} caracteres`
  }`,
);
console.log(`mensaje del usuario: ${usuario.length} caracteres`);
if (peticion.system !== undefined) {
  const generos = contarEjemplos(peticion.system);
  console.log(`géneros en los ejemplos: ${generos}`);
}
