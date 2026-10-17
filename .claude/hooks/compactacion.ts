import {
  appendFile,
  copyFile,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Hook de los dos eventos de compactación. Antes (PreCompact) copia la
 * conversación tal como está en disco; después (PostCompact) guarda el
 * resumen que hizo la compactación. No decide nada y nunca sale con 2:
 * bloquear una compactación automática puede hacer fallar la petición.
 * Todo queda en .claude/compactaciones/, fuera de Git, porque la
 * conversación trae texto de manuscritos de terceros.
 */

interface Entrada {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  trigger?: string;
  custom_instructions?: string | null;
  compact_summary?: string;
}

async function leerEntrada(): Promise<Entrada> {
  let texto = "";
  for await (const trozo of process.stdin) texto += String(trozo);
  return JSON.parse(texto) as Entrada;
}

const entrada = await leerEntrada();
const raiz =
  process.env["CLAUDE_PROJECT_DIR"] ?? entrada.cwd ?? process.cwd();
const carpeta = join(raiz, ".claude", "compactaciones");
await mkdir(carpeta, { recursive: true });

const ahora = new Date().toISOString();
// Un nombre por sesión y momento: dos compactaciones no se pisan.
const base = `${entrada.session_id ?? "sin-sesion"}-${
  ahora.replace(/[:.]/g, "-")
}`;
const disparo = entrada.trigger ?? "?";
let archivo: string;

if (entrada.hook_event_name === "PreCompact") {
  if (entrada.transcript_path === undefined) {
    throw new Error("PreCompact sin transcript_path");
  }
  archivo = `${base}-antes.jsonl`;
  // La transcripción se escribe con retraso: la copia puede no traer
  // el último mensaje. Es un respaldo, no un acta.
  await copyFile(
    resolve(raiz, entrada.transcript_path),
    join(carpeta, archivo),
  );
} else if (entrada.hook_event_name === "PostCompact") {
  archivo = `${base}-resumen.md`;
  await writeFile(
    join(carpeta, archivo),
    `${entrada.compact_summary ?? ""}\n`,
  );
} else {
  throw new Error(`evento inesperado: ${entrada.hook_event_name}`);
}

const pedido = entrada.custom_instructions ?? "ninguna";
await appendFile(
  join(carpeta, "indice.md"),
  `- ${ahora} · ${entrada.hook_event_name} · ${disparo}\n` +
    `  ${archivo}\n  instrucciones: ${pedido}\n`,
);
