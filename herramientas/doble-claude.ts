import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";

/**
 * Un doble de `claude -p` para probar `revision.yml` sin red y sin
 * credencial. No piensa: comprueba la forma de la llamada, consume la
 * entrada estándar y devuelve un archivo de `fixtures/revision/`.
 *
 *   DOBLE_PASE1  salida para el primer pase (esquema de hallazgos)
 *   DOBLE_PASE2  salida para el segundo (esquema de confirmaciones)
 *   DOBLE_CODIGO código de salida (0 por defecto)
 *
 * Las salidas son sintéticas salvo las que su archivo dice reales.
 */

const args = process.argv.slice(2);

function valor(bandera: string): string | undefined {
  const i = args.indexOf(bandera);
  return i >= 0 ? args[i + 1] : undefined;
}

function fallar(mensaje: string): never {
  // Como el CLI: una bandera mal puesta va a stderr antes de correr.
  console.error(`doble-claude: ${mensaje}`);
  process.exit(1);
}

if (!args.includes("-p")) fallar("falta -p");
if (!args.includes("--bare")) fallar("falta --bare");
if (valor("--output-format") !== "json") {
  fallar("falta --output-format json");
}
const esquema = valor("--json-schema");
if (esquema === undefined) fallar("falta --json-schema");
try {
  JSON.parse(esquema);
} catch {
  fallar("--json-schema no es JSON");
}

const entrada = await text(process.stdin);
if (entrada.trim() === "") fallar("la entrada estándar llegó vacía");

const pase2 = esquema.includes('"confirmaciones"');
const archivo = process.env[pase2 ? "DOBLE_PASE2" : "DOBLE_PASE1"];
if (!archivo) fallar(`falta DOBLE_PASE${pase2 ? 2 : 1}`);

process.stdout.write(await readFile(archivo, "utf8"));
process.exitCode = Number(process.env["DOBLE_CODIGO"] ?? "0");
