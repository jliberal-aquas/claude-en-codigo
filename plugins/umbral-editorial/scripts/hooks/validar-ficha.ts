import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  cargarEsquema,
  validarFicha,
} from "../../paquetes/extractor/src/validar.js";

/**
 * Hook de PreToolUse para Write y Edit. Si la escritura deja en
 * `manuscritos/fichas/` una ficha que no cumple el esquema o cuyas
 * citas no están en el manuscrito, escribe el motivo en stderr y sale
 * con 2: Claude Code no ejecuta la herramienta. En cualquier otro caso
 * sale con 0 sin imprimir nada, y la decisión sigue el flujo normal de
 * permisos. Corre fuera del modelo: no depende de que Claude obedezca.
 *
 * Uso: npx tsx .claude/hooks/validar-ficha.ts < entrada.json
 */

/** Lo que este hook lee del JSON que Claude Code manda por stdin. */
export interface EntradaHook {
  hook_event_name?: string;
  tool_name?: string;
  cwd?: string;
  tool_input?: {
    file_path?: unknown;
    content?: unknown; // Write: el archivo entero
    old_string?: unknown; // Edit: el texto que se reemplaza
    new_string?: unknown;
    replace_all?: unknown;
  };
}

const CARPETA = "manuscritos/fichas/";

/**
 * La ruta relativa a la raíz si cae en la carpeta de fichas; `null`
 * si no. La documentación entrega `file_path` siempre absoluta y, en
 * Windows, con barras invertidas: se normalizan antes de comparar.
 */
export function rutaDeFicha(
  raiz: string,
  archivo: string,
): string | null {
  const normal = archivo.replaceAll("\\", "/");
  const absoluta = path.resolve(raiz, normal);
  const rel = path.relative(raiz, absoluta).split(path.sep).join("/");
  const esFicha = rel.startsWith(CARPETA) && rel.endsWith(".json");
  return esFicha ? rel : null;
}

/**
 * El texto que tendría la ficha después de la llamada, sin escribirla.
 * Write trae el archivo entero; Edit trae solo el reemplazo, así que se
 * lee el archivo actual y se aplica. `null`: no hay nada que juzgar
 * (Edit no encuentra el texto y la herramienta fallará sola).
 */
export async function textoResultante(
  entrada: EntradaHook,
  absoluta: string,
): Promise<string | null> {
  const t = entrada.tool_input ?? {};
  if (entrada.tool_name === "Write") {
    return typeof t.content === "string" ? t.content : "";
  }
  if (entrada.tool_name !== "Edit") return null;
  const viejo = t.old_string;
  const nuevo = t.new_string;
  if (typeof viejo !== "string" || typeof nuevo !== "string") {
    return null;
  }
  let actual: string;
  try {
    actual = await readFile(absoluta, "utf8");
  } catch {
    return null;
  }
  if (!actual.includes(viejo)) return null;
  return t.replace_all === true
    ? actual.split(viejo).join(nuevo)
    : actual.replace(viejo, () => nuevo);
}

/** Los motivos para bloquear; una lista vacía deja pasar. */
export async function revisarEscritura(
  entrada: EntradaHook,
  raiz: string,
): Promise<string[]> {
  const archivo = entrada.tool_input?.file_path;
  if (typeof archivo !== "string") return [];
  const rel = rutaDeFicha(raiz, archivo);
  if (rel === null) return []; // fuera de las fichas: no es asunto mío
  const texto = await textoResultante(
    entrada,
    path.resolve(raiz, rel),
  );
  if (texto === null) return [];

  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return [`${rel}: no es JSON`];
  }
  if (typeof valor !== "object" || valor === null) {
    return [`${rel}: una ficha es un objeto JSON`];
  }
  // El id lo pone tu programa, no el modelo: no está en el esquema.
  const { id, ...ficha } = valor as Record<string, unknown>;
  const esperado = path.basename(rel, ".json");
  if (id !== esperado) {
    return [`${rel}: id ${JSON.stringify(id)}; debe ser "${esperado}"`];
  }
  let manuscrito: string;
  try {
    manuscrito = await readFile(
      path.join(raiz, "manuscritos/entrada", `${esperado}.md`),
      "utf8",
    );
  } catch {
    return [`${rel}: no hay manuscrito ${esperado}.md para citar`];
  }
  const esquema = await cargarEsquema(
    path.join(raiz, "manuscritos/ficha.schema.json"),
  );
  const r = validarFicha(ficha, esquema, manuscrito);
  if (r.ok) return [];
  return r.errores.map((e) => `${rel}: ${e.campo}: ${e.mensaje}`);
}

async function leerStdin(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  return Buffer.concat(trozos).toString("utf8");
}

/** El código de salida es la respuesta: 0 deja pasar, 2 bloquea. */
export async function principal(texto: string): Promise<number> {
  let entrada: EntradaHook;
  try {
    entrada = JSON.parse(texto) as EntradaHook;
  } catch {
    // Si no sé qué se quiere escribir, no lo dejo pasar.
    console.error("validar-ficha: la entrada no es JSON; se bloquea");
    return 2;
  }
  // CLAUDE_PROJECT_DIR es la raíz donde empezó la sesión; `cwd`
  // cambia si Claude hace `cd`.
  const raiz = path.resolve(
    process.env["CLAUDE_PROJECT_DIR"] ?? entrada.cwd ?? ".",
  );
  const motivos = await revisarEscritura(entrada, raiz);
  if (motivos.length === 0) return 0;
  console.error(
    "Ficha rechazada por validar-ficha:\n- " + motivos.join("\n- "),
  );
  // Por qué 2 y no otro código: lo pruebas más abajo.
  return 2;
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  process.exitCode = await principal(await leerStdin());
}
