import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Hook de PostToolUse, sin filtro de herramienta: agrega una línea
 * JSON a `registro/herramientas.jsonl` por cada herramienta que
 * terminó bien. No decide nada: cuando corre, la herramienta ya se
 * ejecutó. Guarda qué se usó y dónde, nunca el contenido: un registro
 * no debe volverse otra copia de los manuscritos.
 *
 * Uso: npx tsx .claude/hooks/registrar-herramienta.ts < entrada.json
 */

export interface EntradaPost {
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_use_id?: string;
  duration_ms?: number;
  cwd?: string;
  tool_input?: Record<string, unknown>;
}

export interface LineaRegistro {
  hora: string;
  sesion: string | null;
  herramienta: string | null;
  llamada: string | null;
  /** La ruta del archivo o el comando, recortado; nada más. */
  objetivo: string | null;
  ms: number | null;
}

const MAXIMO = 80;

/** Qué tocó la herramienta, sin copiar lo que escribió. */
export function objetivoDe(
  entrada: Record<string, unknown> | undefined,
  raiz: string,
): string | null {
  const archivo = entrada?.["file_path"];
  if (typeof archivo === "string") {
    const normal = archivo.replaceAll("\\", "/");
    return path.relative(raiz, path.resolve(raiz, normal)) || ".";
  }
  const comando = entrada?.["command"];
  if (typeof comando === "string") {
    return comando.length <= MAXIMO
      ? comando
      : `${comando.slice(0, MAXIMO - 1)}…`;
  }
  return null;
}

export function armarLinea(
  e: EntradaPost,
  raiz: string,
  hora: Date = new Date(),
): LineaRegistro {
  return {
    hora: hora.toISOString(),
    sesion: e.session_id ?? null,
    herramienta: e.tool_name ?? null,
    llamada: e.tool_use_id ?? null,
    objetivo: objetivoDe(e.tool_input, raiz),
    ms: typeof e.duration_ms === "number" ? e.duration_ms : null,
  };
}

async function leerStdin(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  return Buffer.concat(trozos).toString("utf8");
}

export async function principal(texto: string): Promise<number> {
  let entrada: EntradaPost;
  try {
    entrada = JSON.parse(texto) as EntradaPost;
  } catch {
    // En PostToolUse no hay nada que bloquear: avisa y sigue.
    console.error("registrar-herramienta: la entrada no es JSON");
    return 1;
  }
  const raiz = path.resolve(
    process.env["CLAUDE_PROJECT_DIR"] ?? entrada.cwd ?? ".",
  );
  const carpeta = path.join(raiz, "registro");
  await mkdir(carpeta, { recursive: true });
  const linea = armarLinea(entrada, raiz);
  await appendFile(
    path.join(carpeta, "herramientas.jsonl"),
    `${JSON.stringify(linea)}\n`,
  );
  return 0;
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  process.exitCode = await principal(await leerStdin());
}
