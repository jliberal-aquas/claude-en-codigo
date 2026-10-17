import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Busca, en los ajustes de este repositorio, reglas de permiso que
 * Claude Code acepta sin error y que no se aplican como parece, y
 * huecos entre los permisos y el sandbox. Cada comprobación copia una
 * regla de la documentación de Claude Code; no es Claude Code. Lo que
 * una sesión cargó de verdad lo dicen `/permissions` y `/status`.
 *
 * Uso: npm run permisos -- [archivo de ajustes]
 * Sin argumento lee `.claude/settings.json` y, si existe,
 * `.claude/settings.local.json`; sus listas se combinan.
 * Sale con 1 si hay algún error; los avisos no detienen.
 */

const RAIZ = process.cwd();

type Lista = "deny" | "ask" | "allow";
const ORDEN: Lista[] = ["deny", "ask", "allow"];

export interface Ajustes {
  permissions?: {
    defaultMode?: string;
    allow?: string[];
    ask?: string[];
    deny?: string[];
  };
  sandbox?: {
    enabled?: boolean;
    filesystem?: { denyRead?: string[] };
  };
}

export interface Regla {
  lista: Lista;
  texto: string;
  herramienta: string;
  /** `null`: la regla nombra la herramienta entera. */
  patron: string | null;
}

export interface Hallazgo {
  nivel: "error" | "aviso";
  regla: string;
  motivo: string;
}

/** `Herramienta` o `Herramienta(patrón)`; `Bash(*)` es `Bash`. */
export function leerRegla(lista: Lista, texto: string): Regla {
  const m = /^([\w*]+)(?:\((.*)\))?$/.exec(texto.trim());
  const herramienta = m?.[1] ?? texto;
  const patron = m?.[2] ?? null;
  return {
    lista,
    texto,
    herramienta,
    patron: patron === "*" ? null : patron,
  };
}

/** Un comando contra un patrón de Bash, según la documentación. */
export function coincideBash(patron: string, comando: string): boolean {
  // `:*` solo cuenta al final, y ahí equivale a ` *`.
  const p = patron.endsWith(":*") ? `${patron.slice(0, -2)} *` : patron;
  const base = p.slice(0, -2);
  if (p.endsWith(" *") && !base.includes("*")) {
    // Con espacio antes del `*`: `ls *` no coincide con `lsof`.
    return comando === base || comando.startsWith(`${base} `);
  }
  const partes = p
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${partes.join(".*")}$`).test(comando);
}

/**
 * Un patrón de ruta relativo a la carpeta donde arranca Claude Code,
 * como glob desde la raíz. Un nombre sin barra vale a cualquier
 * profundidad, como en `.gitignore`. Devuelve `null` si el patrón se
 * ancla en otra parte (`//`, `~/` o `/`).
 */
export function globRelativo(patron: string): string | null {
  if (patron.startsWith("/") || patron.startsWith("~/")) return null;
  if (patron.startsWith("./")) return patron.slice(2);
  return patron.includes("/") ? patron : `**/${patron}`;
}

/** ¿La regla `otra` decide sobre lo que permite `r`? */
function cubre(otra: Regla, r: Regla): boolean {
  if (otra.herramienta === "*") return true;
  // Un `Read` negado también cierra `Edit` en la misma ruta.
  const misma =
    otra.herramienta === r.herramienta ||
    (otra.lista === "deny" &&
      otra.herramienta === "Read" &&
      r.herramienta === "Edit");
  if (!misma) return false;
  if (otra.patron === null) return true;
  if (r.patron === null) return false;
  if (otra.patron === r.patron) return true;
  if (r.herramienta === "Bash") {
    // El comando más corto que la regla permite.
    const ejemplo = r.patron.replace(/[ :]?\*$/, "");
    return coincideBash(otra.patron, ejemplo);
  }
  const a = globRelativo(r.patron);
  const b = globRelativo(otra.patron);
  if (a === null || b === null) return false;
  return path.matchesGlob(a.replace(/\*+/g, "x"), b);
}

/** La regla que decide antes que `r`, en el orden deny, ask, allow. */
function laTapa(r: Regla, reglas: Regla[]): Regla | undefined {
  for (const lista of ORDEN) {
    if (lista === r.lista) return undefined;
    const t = reglas.find((o) => o.lista === lista && cubre(o, r));
    if (t !== undefined) return t;
  }
  return undefined;
}

/** Herramientas cuyas reglas de ruta Claude Code nunca consulta. */
const SIN_CONSULTA = ["Write", "NotebookEdit", "Glob", "MultiEdit"];
const DE_ARCHIVOS = ["Read", "Edit", ...SIN_CONSULTA];

export function revisar(capas: Ajustes[]): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const error = (regla: string, motivo: string) =>
    hallazgos.push({ nivel: "error", regla, motivo });
  const aviso = (regla: string, motivo: string) =>
    hallazgos.push({ nivel: "aviso", regla, motivo });

  // Entre archivos, las listas se combinan: una regla negada en
  // cualquiera de ellos gana a una permitida en otro.
  const reglas = ORDEN.flatMap((lista) =>
    capas.flatMap((c) =>
      (c.permissions?.[lista] ?? []).map((t) => leerRegla(lista, t)),
    ),
  );

  for (const c of capas) {
    const modo = c.permissions?.defaultMode;
    if (modo === "auto" || modo === "bypassPermissions") {
      error(
        `defaultMode "${modo}"`,
        "desde los ajustes del repositorio no surte efecto",
      );
    }
  }

  for (const r of reglas) {
    const p = r.patron;
    if (SIN_CONSULTA.includes(r.herramienta) && p !== null) {
      error(r.texto, `se acepta y nunca se consulta; usa Edit(${p})`);
    }
    if (DE_ARCHIVOS.includes(r.herramienta) && p !== null) {
      if (/^\/(home|Users|etc|tmp|var|srv|opt)\//.test(p)) {
        error(r.texto, "una barra ancla en los ajustes; absoluta: //");
      }
      const resto = p.startsWith("~/") ? p.slice(2) : "";
      const primera = resto.split("/")[0] ?? "";
      if (
        primera &&
        existsSync(path.join(RAIZ, primera)) &&
        !existsSync(path.join(homedir(), primera))
      ) {
        error(r.texto, `~ es tu carpeta personal: ¿era ./${resto}?`);
      }
    }
    const dosPuntos = p?.includes(":*") && !p.endsWith(":*");
    if (r.herramienta === "Bash" && dosPuntos) {
      aviso(r.texto, '":*" solo se reconoce al final del patrón');
    }
    if (r.lista === "allow") {
      const t = laTapa(r, reglas);
      if (t !== undefined) {
        error(r.texto, `nunca se aplica: antes decide ${t.texto}`);
      }
    }
  }

  // El sandbox encendido y apagado: el último archivo manda.
  const sandbox = capas.map((c) => c.sandbox?.enabled).filter(
    (v) => v !== undefined,
  );
  if (sandbox.at(-1) !== true) {
    aviso("sandbox", "apagado: Bash escribe donde pueda tu usuario");
  }
  const denyRead = capas.flatMap(
    (c) => c.sandbox?.filesystem?.denyRead ?? [],
  );
  for (const ruta of denyRead) {
    // Fuera de la carpeta de trabajo, Read ya pregunta (capítulo 6);
    // dentro, solo un `deny` de Read la frena.
    if (globRelativo(ruta) === null) continue;
    const comoLectura = leerRegla("allow", `Read(${ruta})`);
    if (laTapa(comoLectura, reglas)?.lista !== "deny") {
      aviso(`denyRead ${ruta}`, `no frena a Read; niega Read(${ruta})`);
    }
  }
  const env = laTapa(leerRegla("allow", "Read(.env)"), reglas);
  if (env?.lista !== "deny") {
    aviso("Read(.env)", "nada lo niega: Claude puede leer tus claves");
  }
  if (existsSync(path.join(RAIZ, ".claudeignore"))) {
    aviso(".claudeignore", "no tiene efecto; pasa sus líneas a deny");
  }
  return hallazgos;
}

/** JSON estricto: un comentario o una coma final son un error. */
function leerAjustes(archivo: string): Ajustes {
  try {
    return JSON.parse(readFileSync(archivo, "utf8")) as Ajustes;
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.log(`[error] ${archivo}`);
    console.log(`        no es JSON estricto: ${motivo}`);
    process.exit(1);
  }
}

// Solo corre como programa si lo invocas directamente.
const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  const pedidos = process.argv.slice(2);
  const archivos =
    pedidos.length > 0
      ? pedidos
      : [".claude/settings.json", ".claude/settings.local.json"].filter(
          (a) => existsSync(path.join(RAIZ, a)),
        );
  if (archivos.length === 0) {
    console.log("[error] no hay .claude/settings.json");
    process.exit(1);
  }
  const capas = archivos.map(leerAjustes);
  const hallazgos = revisar(capas);
  for (const h of hallazgos) {
    console.log(`[${h.nivel}] ${h.regla}\n        ${h.motivo}`);
  }
  const reglas = capas
    .flatMap((c) => ORDEN.flatMap((l) => c.permissions?.[l] ?? []))
    .length;
  const errores = hallazgos.filter((h) => h.nivel === "error").length;
  console.log(
    `archivos=${archivos.length} reglas=${reglas} ` +
      `errores=${errores} avisos=${hallazgos.length - errores}`,
  );
  process.exitCode = errores > 0 ? 1 : 0;
}
