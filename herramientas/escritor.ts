import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as esperar } from "node:timers/promises";

/**
 * Imita a una sesión que edita un archivo sin saber de las demás: lee
 * el archivo entero, se demora (como quien piensa antes de escribir) y
 * escribe el archivo entero con su cambio. No llama a Claude ni a
 * ningún modelo: reproduce solo el patrón leer, esperar y escribir.
 *
 * Uso: npx tsx herramientas/escritor.ts <nombre> <archivo> <ms>
 *        <texto-viejo> <texto-nuevo>
 */
const [nombre, archivo, ms, viejo, nuevo] = process.argv.slice(2);

if (!nombre || !archivo || !ms || !viejo || nuevo === undefined) {
  console.error("uso: escritor.ts nombre archivo ms viejo nuevo");
  process.exit(1);
}

const leido = await readFile(archivo, "utf8");
if (!leido.includes(viejo)) {
  console.error(`${nombre}: no encuentro «${viejo}» en ${archivo}`);
  process.exit(1);
}
console.log(`${nombre}: leí ${archivo}`);

// Mientras espera, otro escritor puede cambiar el archivo en disco.
// Este no se entera: trabaja con la copia que leyó.
await esperar(Number(ms));

await writeFile(archivo, leido.replace(viejo, nuevo));
console.log(`${nombre}: escribí ${archivo}`);
