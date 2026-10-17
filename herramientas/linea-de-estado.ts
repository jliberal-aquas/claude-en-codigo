import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * La línea de estado de la editorial. Claude Code ejecuta este
 * programa, le pasa por stdin un JSON con datos de la sesión y muestra
 * lo que imprime. Corre en tu máquina: no gasta tokens.
 *
 * Prueba sin Claude Code, con el JSON de ejemplo:
 *   npx tsx herramientas/linea-de-estado.ts \
 *     < herramientas/estado-ejemplo.json
 */

/** Solo los campos que usamos, todos opcionales: pueden faltar. */
export interface DatosDeSesion {
  model?: { id?: string; display_name?: string } | null;
  workspace?: { current_dir?: string; project_dir?: string } | null;
  cost?: { total_cost_usd?: number | null } | null;
  context_window?: { used_percentage?: number | null } | null;
}

/**
 * Arma la línea. `delEquipo` es el `model` de `.claude/settings.json`;
 * si la sesión usa otro, una segunda fila lo dice: es la pregunta de
 * la fundadora, a la vista.
 */
export function lineaDeEstado(
  d: DatosDeSesion,
  delEquipo?: string,
): string {
  const partes: string[] = [];
  partes.push(d.model?.display_name ?? d.model?.id ?? "modelo ?");

  const carpeta = d.workspace?.current_dir;
  if (carpeta) partes.push(path.basename(carpeta));

  // Estimación del lado del cliente, a precio de lista: no es la
  // factura, pero muestra cuál sesión gasta más.
  const usd = d.cost?.total_cost_usd;
  if (typeof usd === "number") {
    partes.push(`USD ${usd.toFixed(2)} estimado`);
  }

  // Un campo puede faltar o venir en null: la documentación pide
  // prever los dos casos.
  const pct = d.context_window?.used_percentage;
  if (typeof pct === "number") {
    partes.push(`contexto ${Math.round(pct)}%`);
  }

  const linea = partes.join(" · ");
  // Solo comparamos IDs completos: un alias no se parece a su ID.
  const id = d.model?.id;
  const comparable = delEquipo?.startsWith("claude-") ?? false;
  if (comparable && id !== undefined && id !== delEquipo) {
    // Cada línea que imprimes es una fila de la barra.
    return `${linea}\naviso: el equipo usa ${delEquipo}`;
  }
  return linea;
}

/** El `model` del archivo del equipo, si existe y es una cadena. */
async function modeloDelEquipo(
  carpeta: string,
): Promise<string | undefined> {
  const ruta = path.join(carpeta, ".claude", "settings.json");
  try {
    const datos: unknown = JSON.parse(await readFile(ruta, "utf8"));
    if (typeof datos !== "object" || datos === null) return undefined;
    const modelo = (datos as Record<string, unknown>)["model"];
    return typeof modelo === "string" ? modelo : undefined;
  } catch {
    return undefined;
  }
}

async function leerEntrada(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const trozo of process.stdin) {
    trozos.push(Buffer.from(trozo as Uint8Array));
  }
  return Buffer.concat(trozos).toString("utf8");
}

// Solo corre como programa si lo invocas directamente.
const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  let datos: DatosDeSesion;
  try {
    datos = JSON.parse(await leerEntrada()) as DatosDeSesion;
  } catch {
    // Una línea de estado no debe romper la sesión: avisa y sigue.
    console.log("línea de estado: la entrada no es JSON");
    process.exit(0);
  }
  // Primero la carpeta donde se lanzó Claude Code; si no existe en
  // esta máquina (el JSON de ejemplo), la carpeta actual.
  const lanzada = datos.workspace?.project_dir;
  const delEquipo =
    (lanzada ? await modeloDelEquipo(lanzada) : undefined) ??
    (await modeloDelEquipo(process.cwd()));
  console.log(lineaDeEstado(datos, delEquipo));
}
