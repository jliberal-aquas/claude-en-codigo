import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Revisa los ajustes de Claude Code que se ven desde este repositorio:
 * el de usuario, el del repositorio y el local. Dice qué archivo
 * define cada clave y cuál gana, valida la forma de las claves que usa
 * este libro y comprueba que el archivo local no vaya a Git. Imita la
 * documentación; no es Claude Code. Qué archivos cargó una sesión lo
 * dice `/status`.
 *
 * Uso: npm run ajustes
 * Sale con 1 si un archivo no es JSON estricto, si una clave tiene mala
 * forma, si el archivo versionado trae algo que parece un secreto o si
 * `.gitignore` no excluye el archivo local.
 */

const RAIZ = process.cwd();
const LOCAL = ".claude/settings.local.json";

/** De menor a mayor precedencia. */
export type Nivel = "usuario" | "repositorio" | "local";

export interface Fuente {
  nivel: Nivel;
  ruta: string;
  /** `null`: el archivo no existe o no se pudo leer. */
  datos: Record<string, unknown> | null;
  error?: string;
}

/**
 * Claves que este programa conoce. Las dos últimas de la lista son del
 * capítulo 10; las demás pueden aparecer en tu archivo de usuario
 * (algunas las escriben `/config`, `/fast` o `/advisor`). Otra clave
 * solo da un aviso: la documentación crece más rápido que este
 * programa.
 */
const CONOCIDAS = new Set([
  "$schema", "model", "env", "statusLine", "permissions", "sandbox",
  "theme", "editorMode", "fastMode", "advisorModel", "effortLevel",
  "tui", "hooks",
]);

/** Nombres de variable que no deberían viajar por Git. */
const PARECE_SECRETO = /KEY|TOKEN|SECRET|PASSWORD/i;

/** Lista cuyo orden importa: se toma entera del nivel más alto. */
const LISTAS_ENTERAS = new Set(["fallbackModel"]);

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function leerFuente(
  nivel: Nivel,
  ruta: string,
  texto: string | null,
): Fuente {
  if (texto === null) return { nivel, ruta, datos: null };
  try {
    // JSON.parse es estricto, como Claude Code: sin comentarios `//`
    // ni coma final.
    const datos: unknown = JSON.parse(texto);
    if (esObjeto(datos)) return { nivel, ruta, datos };
    return { nivel, ruta, datos: null, error: "no es un objeto JSON" };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    return { nivel, ruta, datos: null, error: motivo };
  }
}

/** Revisa la forma de un archivo; anota fallas y avisos. */
export function validar(
  f: Fuente,
  fallas: string[],
  avisos: string[],
): void {
  const d = f.datos;
  if (d === null) return;
  const n = f.nivel;
  for (const clave of Object.keys(d)) {
    if (!CONOCIDAS.has(clave)) {
      avisos.push(`${n}: no conozco la clave ${clave}`);
    }
  }
  if ("model" in d && typeof d["model"] !== "string") {
    fallas.push(`${n}: model debe ser una cadena`);
  }
  if ("env" in d) {
    const env = d["env"];
    if (!esObjeto(env)) {
      fallas.push(`${n}: env debe ser un objeto`);
    } else {
      for (const [nombre, valor] of Object.entries(env)) {
        if (n === "repositorio" && PARECE_SECRETO.test(nombre)) {
          fallas.push(`${n}: env.${nombre} parece un secreto`);
        }
        if (n !== "usuario" && nombre === "CLAUDE_CONFIG_DIR") {
          fallas.push(`${n}: CLAUDE_CONFIG_DIR no vale aquí`);
        }
        // Claude Code copia el valor tal cual: ningún shell lo expande.
        if (typeof valor === "string" && /^~|\$/.test(valor)) {
          avisos.push(`${n}: env.${nombre} no se expande`);
        }
      }
    }
  }
  if ("statusLine" in d) {
    const s = d["statusLine"];
    if (!esObjeto(s)) {
      fallas.push(`${n}: statusLine debe ser un objeto`);
    } else {
      if (s["type"] !== "command") {
        fallas.push(`${n}: statusLine.type debe ser "command"`);
      }
      const cmd = s["command"];
      if (typeof cmd !== "string" || cmd.trim() === "") {
        fallas.push(`${n}: statusLine.command está vacío`);
      }
      const pad = s["padding"];
      if (pad !== undefined && typeof pad !== "number") {
        fallas.push(`${n}: statusLine.padding debe ser un número`);
      }
      const cada = s["refreshInterval"];
      if (
        cada !== undefined &&
        (typeof cada !== "number" || cada < 1)
      ) {
        fallas.push(`${n}: statusLine.refreshInterval mínimo 1`);
      }
    }
  }
}

/** Valor de una ruta de claves, como `["env", "X"]`. */
function valorEn(
  d: Record<string, unknown>,
  claves: string[],
): unknown {
  let actual: unknown = d;
  for (const c of claves) {
    if (!esObjeto(actual) || !(c in actual)) return undefined;
    actual = actual[c];
  }
  return actual;
}

interface Definicion {
  donde: string;
  valor: unknown;
}

/** Quién define una clave, de mayor a menor precedencia. */
export function quienes(
  fuentes: Fuente[],
  claves: string[],
): Definicion[] {
  const lista: Definicion[] = [];
  for (const f of [...fuentes].reverse()) {
    if (f.datos === null) continue;
    const valor = valorEn(f.datos, claves);
    if (valor !== undefined) lista.push({ donde: f.nivel, valor });
  }
  return lista;
}

/** `local "x" > repositorio "y"`: el de la izquierda es el que vale. */
function describir(defs: Definicion[], conValor: boolean): string {
  if (defs.length === 0) return "(nadie)";
  const una = (d: Definicion): string =>
    conValor ? `${d.donde} ${JSON.stringify(d.valor)}` : d.donde;
  return defs.map(una).join(" > ");
}

/** Las rutas de claves que vale la pena informar, en orden. */
function rutasEscalares(fuentes: Fuente[]): string[][] {
  const rutas = new Map<string, string[]>();
  for (const f of fuentes) {
    if (f.datos === null) continue;
    for (const [clave, valor] of Object.entries(f.datos)) {
      const conListas =
        esObjeto(valor) && Object.values(valor).some(Array.isArray);
      if (clave === "env" && esObjeto(valor)) {
        for (const nombre of Object.keys(valor)) {
          rutas.set(`env.${nombre}`, ["env", nombre]);
        }
      } else if (conListas) {
        // Un objeto con listas (permissions): sus listas van aparte y
        // sus otros valores se informan uno por uno.
        for (const [hija, v] of Object.entries(valor)) {
          if (Array.isArray(v)) continue;
          rutas.set(`${clave}.${hija}`, [clave, hija]);
        }
      } else if (!Array.isArray(valor) || LISTAS_ENTERAS.has(clave)) {
        // El resto, como statusLine, se informa como un solo valor.
        rutas.set(clave, [clave]);
      }
    }
  }
  return [...rutas.values()].sort((a, b) =>
    a.join(".").localeCompare(b.join(".")),
  );
}

/** Las listas que se combinan entre archivos: quién aporta cuánto. */
function listas(fuentes: Fuente[]): string[] {
  const aportes = new Map<string, string[]>();
  for (const f of fuentes) {
    if (f.datos === null) continue;
    for (const [clave, valor] of Object.entries(f.datos)) {
      const hijas: [string, unknown][] = esObjeto(valor)
        ? Object.entries(valor).map(([h, v]) => [`${clave}.${h}`, v])
        : [[clave, valor]];
      for (const [nombre, v] of hijas) {
        if (!Array.isArray(v) || LISTAS_ENTERAS.has(nombre)) continue;
        const previo = aportes.get(nombre) ?? [];
        previo.push(`${f.nivel} ${v.length}`);
        aportes.set(nombre, previo);
      }
    }
  }
  return [...aportes.entries()].map(
    ([nombre, de]) => `  ${nombre}: se combinan (${de.join(", ")})`,
  );
}

async function leerSiExiste(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8");
  } catch {
    return null;
  }
}

/** ¿`.gitignore` excluye el archivo local? */
export function ignoraLocal(gitignore: string): boolean {
  const validas = [LOCAL, `/${LOCAL}`, `**/${LOCAL}`];
  return gitignore
    .split("\n")
    .map((l) => l.trim())
    .some((l) => validas.includes(l));
}

export interface Informe {
  lineas: string[];
  fallas: string[];
  avisos: string[];
}

export async function revisar(): Promise<Informe> {
  // CLAUDE_CONFIG_DIR mueve los archivos de tu carpeta personal.
  const propia = process.env["CLAUDE_CONFIG_DIR"];
  const dirUsuario = propia ?? path.join(os.homedir(), ".claude");
  const rutaUsuario = path.join(dirUsuario, "settings.json");
  const verUsuario = propia ? rutaUsuario : "~/.claude/settings.json";

  const pedidos: [Nivel, string, string][] = [
    ["usuario", rutaUsuario, verUsuario],
    ["repositorio", path.join(RAIZ, ".claude/settings.json"),
      ".claude/settings.json"],
    ["local", path.join(RAIZ, LOCAL), LOCAL],
  ];
  const informe: Informe = {
    lineas: ["Archivos, de menor a mayor precedencia:"],
    fallas: [],
    avisos: [],
  };
  const fuentes: Fuente[] = [];
  for (const [nivel, ruta, ver] of pedidos) {
    const f = leerFuente(nivel, ver, await leerSiExiste(ruta));
    fuentes.push(f);
    let estado = "";
    if (f.error !== undefined) {
      estado = `: NO ES JSON (${f.error})`;
      informe.fallas.push(`${nivel}: JSON inválido`);
    } else if (f.datos === null) {
      estado = ": no existe";
    }
    informe.lineas.push(`  ${nivel.padEnd(11)} ${ver}${estado}`);
    validar(f, informe.fallas, informe.avisos);
  }

  informe.lineas.push("Quién define cada clave (la izquierda gana):");
  const rutas = rutasEscalares(fuentes);
  const enTerminal = process.env["ANTHROPIC_MODEL"];
  if (enTerminal && !rutas.some((r) => r.join(".") === "model")) {
    rutas.unshift(["model"]);
  }
  for (const ruta of rutas) {
    const defs = quienes(fuentes, ruta);
    const nombre = ruta.join(".");
    if (nombre === "model") {
      // ANTHROPIC_MODEL no es un nivel: para este par, la variable de
      // la terminal gana a la clave de cualquier archivo.
      if (enTerminal) {
        defs.unshift({ donde: "terminal", valor: enTerminal });
      }
    }
    // El valor se muestra si es corto: una cadena o un número.
    const simple =
      nombre !== "$schema" &&
      defs.every((d) => typeof d.valor !== "object");
    informe.lineas.push(`  ${nombre}: ${describir(defs, simple)}`);
  }
  const combinadas = listas(fuentes);
  if (combinadas.length > 0) {
    informe.lineas.push("Listas que se combinan:", ...combinadas);
  }

  const gitignore = (await leerSiExiste(".gitignore")) ?? "";
  if (ignoraLocal(gitignore)) {
    informe.lineas.push(`.gitignore: excluye ${LOCAL}`);
  } else {
    informe.lineas.push(`.gitignore: NO excluye ${LOCAL}`);
    informe.fallas.push(".gitignore sin el archivo local");
  }
  informe.lineas.push(
    "No se ve desde aquí: lo administrado, --settings, --model.",
  );
  return informe;
}

// Solo corre como programa si lo invocas directamente.
const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  const informe = await revisar();
  console.log(informe.lineas.join("\n"));
  for (const aviso of informe.avisos) console.log(`aviso: ${aviso}`);
  for (const falla of informe.fallas) console.log(`falla: ${falla}`);
  console.log(`fallas: ${informe.fallas.length}`);
  if (informe.fallas.length > 0) process.exitCode = 1;
}
