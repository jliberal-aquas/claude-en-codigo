import { cp, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { separar } from "./verificar-skills.js";

/**
 * Revisa el marketplace de la raíz y cada plugin que lista. Imita
 * reglas que documenta Claude Code y suma las de la casa; no es
 * Claude Code ni reemplaza a `claude plugin validate`, que revisa el
 * esquema. Este mira lo que aquel no ve: código que apunta fuera del
 * plugin, copias que ya no son iguales a su origen, dependencias que
 * nadie va a instalar.
 *
 * Uso: npm run plugin          revisa
 *      npm run plugin:armar    copia lo que entra al plugin y revisa
 * Sale con 1 si hay alguna falla.
 */

const RAIZ = process.cwd();
const MARKETPLACE = path.join(".claude-plugin", "marketplace.json");

/** Un archivo o carpeta del repositorio y su lugar en el plugin. */
export interface Pieza {
  origen: string;
  destino: string;
}

/**
 * Qué entra a cada plugin y de dónde sale. El repositorio es la
 * única fuente: el plugin es su copia, y una copia distinta es una
 * falla. Lo que estos archivos importan entra solo (`cierre`).
 */
export const CONTENIDO: Record<string, Pieza[]> = {
  "umbral-editorial": [
    {
      origen: ".claude/skills/ficha-manuscrito",
      destino: "skills/ficha-manuscrito",
    },
    {
      origen: ".claude/agents/revisor-ficha.md",
      destino: "agents/revisor-ficha.md",
    },
    {
      origen: ".claude/hooks/validar-ficha.ts",
      destino: "scripts/hooks/validar-ficha.ts",
    },
    {
      origen: "paquetes/catalogo-mcp/src/main.ts",
      destino: "paquetes/catalogo-mcp/src/main.ts",
    },
  ],
};

/** Prefijos reservados [VERIFICAR AL CIERRE]. */
const RESERVADOS = [
  "claude-", "anthropic-", "anthropics-", "cc-plugin-",
];
const OFICIALES = new Set(["claude-plugins-official"]);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Campos de agente que un plugin ignora [VERIFICAR AL CIERRE]. */
const IGNORADOS = [
  "permissionMode", "hooks", "mcpServers", "initialPrompt",
];
/** Frontmatter admitido en `prompt.md` [VERIFICAR AL CIERRE]. */
const CLAVES_PROMPT = new Set([
  "max_turns", "timeout_seconds", "runs", "model", "tags",
  "plugins", "allowed_tools", "env",
]);
/** Tipo de comprobación y la opción que no puede faltar. */
const COMPROBACIONES: Record<string, string> = {
  regex: "pattern",
  tool_used: "tool",
  tool_order: "before",
  file_exists: "path",
  llm: "",
  baseline: "baseline_file",
};

type Objeto = Record<string, unknown>;

export interface Informe {
  lineas: string[];
  fallas: number;
  avisos: number;
}

function fallar(i: Informe, motivo: string): void {
  i.lineas.push(`  FALLA: ${motivo}`);
  i.fallas++;
}

function avisar(i: Informe, motivo: string): void {
  i.lineas.push(`  aviso: ${motivo}`);
  i.avisos++;
}

type Tipo = "carpeta" | "archivo" | null;

async function tipo(ruta: string): Promise<Tipo> {
  try {
    return (await stat(ruta)).isDirectory() ? "carpeta" : "archivo";
  } catch {
    return null;
  }
}

async function listar(carpeta: string): Promise<string[]> {
  try {
    return (await readdir(carpeta)).sort();
  } catch {
    return [];
  }
}

/** El objeto JSON del archivo, o `null` si falta o no se lee. */
async function leerJson(ruta: string): Promise<Objeto | null> {
  try {
    const v: unknown = JSON.parse(await readFile(ruta, "utf8"));
    return typeof v === "object" && v !== null ? (v as Objeto) : null;
  } catch {
    return null;
  }
}

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** ¿Queda `ruta` dentro de `carpeta`? */
export function dentro(carpeta: string, ruta: string): boolean {
  const rel = path.relative(carpeta, ruta);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Lo que importa un archivo: rutas relativas y paquetes de npm. */
export function importaciones(codigo: string): {
  relativas: string[];
  paquetes: string[];
} {
  const relativas: string[] = [];
  const paquetes = new Set<string>();
  for (const m of codigo.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
    const spec = m[1] ?? "";
    if (spec.startsWith(".")) {
      relativas.push(spec);
    } else if (!spec.startsWith("node:")) {
      // `zod/v4` viene del paquete `zod`; `@a/b/c`, de `@a/b`.
      const n = spec.startsWith("@") ? 2 : 1;
      paquetes.add(spec.split("/").slice(0, n).join("/"));
    }
  }
  return { relativas, paquetes: [...paquetes] };
}

/**
 * Las piezas y todo lo que importan, en cadena. Cada importación se
 * resuelve dos veces: desde el origen, en el repositorio, y desde el
 * destino, en el plugin. Si el destino cae fuera del plugin, la
 * copia no podrá cargarla.
 */
export async function cierre(piezas: Pieza[]): Promise<Pieza[]> {
  const vistas = new Map<string, Pieza>();
  const pendientes = [...piezas];
  for (let p = pendientes.shift(); p; p = pendientes.shift()) {
    if (vistas.has(p.destino)) continue;
    vistas.set(p.destino, p);
    const ruta = path.join(RAIZ, p.origen);
    if (!p.origen.endsWith(".ts") || !(await tipo(ruta))) continue;
    const { relativas } = importaciones(await readFile(ruta, "utf8"));
    for (const spec of relativas) {
      const ts = spec.replace(/\.js$/, ".ts");
      pendientes.push({
        origen: path.join(path.dirname(p.origen), ts),
        destino: path.join(path.dirname(p.destino), ts),
      });
    }
  }
  return [...vistas.values()];
}

/** Copia cada pieza del repositorio a su lugar en el plugin. */
export async function armar(plugin: string, piezas: Pieza[]) {
  for (const p of piezas) {
    const destino = path.join(plugin, p.destino);
    if (!dentro(plugin, destino)) continue; // la revisión lo dirá
    await mkdir(path.dirname(destino), { recursive: true });
    await cp(path.join(RAIZ, p.origen), destino, { recursive: true });
  }
}

/** Los archivos bajo una carpeta, con su ruta relativa a ella. */
async function archivos(carpeta: string, base = ""): Promise<string[]> {
  const salida: string[] = [];
  for (const n of await listar(path.join(carpeta, base))) {
    const rel = path.join(base, n);
    if (rel === "node_modules") continue;
    if ((await tipo(path.join(carpeta, rel))) === "carpeta") {
      salida.push(...(await archivos(carpeta, rel)));
    } else {
      salida.push(rel);
    }
  }
  return salida;
}

/** Cada copia existe, cae dentro del plugin y es igual a su origen. */
async function revisarCopias(plugin: string, piezas: Pieza[],
  i: Informe) {
  for (const p of piezas) {
    const destino = path.join(plugin, p.destino);
    if (!dentro(plugin, destino)) {
      fallar(i, `${p.origen} caería fuera del plugin`);
      continue;
    }
    const origen = path.join(RAIZ, p.origen);
    const sueltos = (await tipo(origen)) === "carpeta"
      ? (await archivos(origen)).map((f) => path.join(p.origen, f))
      : [p.origen];
    for (const f of sueltos) {
      const copia = path.join(destino, path.relative(p.origen, f));
      const rel = path.relative(plugin, copia);
      const de = rel === f ? "" : ` (de ${f})`;
      if (!(await tipo(copia))) {
        fallar(i, `falta ${rel}${de}`);
      } else if ((await readFile(path.join(RAIZ, f), "utf8")) !==
        (await readFile(copia, "utf8"))) {
        fallar(i, `${rel} difiere de su origen${de}`);
      }
    }
  }
}

/** Los paquetes que declara el package.json del plugin. */
async function dependencias(plugin: string): Promise<string[]> {
  const json = await leerJson(path.join(plugin, "package.json"));
  return Object.keys((json?.["dependencies"] ?? {}) as Objeto);
}

/**
 * Una ruta de un hook o de un servidor MCP. El código que corre va
 * dentro del plugin; los datos de quien lo instala, no.
 */
async function revisarRuta(plugin: string, valor: string,
  donde: string, i: Informe) {
  if (valor.includes("${CLAUDE_PROJECT_DIR}")) {
    fallar(i, `${donde}: ${valor} se busca en el repositorio de ` +
      "quien instala, no en el plugin");
  } else if (path.isAbsolute(valor)) {
    fallar(i, `${donde}: ${valor} solo existe en tu máquina`);
  } else if (valor.includes("${CLAUDE_PLUGIN_ROOT}")) {
    // `node_modules` no viaja con el plugin: Claude Code lo instala
    // desde su package.json. Basta con que el paquete esté declarado.
    const bin = /\/node_modules\/\.bin\/([^/]+)$/.exec(valor)?.[1];
    const real = valor.replaceAll("${CLAUDE_PLUGIN_ROOT}", plugin);
    if (bin !== undefined) {
      if (!(await dependencias(plugin)).includes(bin)) {
        fallar(i, `${donde}: ${bin} no está en package.json`);
      }
    } else if (!(await tipo(real))) {
      fallar(i, `${donde}: ${valor} no existe en el plugin`);
    }
  } else if (valor.includes("/")) {
    avisar(i, `${donde}: ${valor} es relativa; usa ` +
      "${CLAUDE_PLUGIN_ROOT}");
  }
}

/** Revisa `command` y `args` de un manejador o de un servidor. */
async function revisarComando(plugin: string, m: Objeto,
  donde: string, i: Informe) {
  await revisarRuta(plugin, texto(m["command"]), donde, i);
  for (const a of lista(m["args"])) {
    await revisarRuta(plugin, texto(a), donde, i);
  }
}

async function revisarHooks(plugin: string, i: Informe) {
  const json = await leerJson(path.join(plugin, "hooks/hooks.json"));
  if (json === null) return;
  const eventos = json["hooks"];
  if (typeof eventos !== "object" || eventos === null) {
    fallar(i, "hooks/hooks.json sin la clave \"hooks\"");
    return;
  }
  const manejadores: [string, Objeto][] = [];
  for (const [evento, grupos] of Object.entries(eventos)) {
    for (const g of lista(grupos)) {
      for (const h of lista((g as Objeto)["hooks"])) {
        manejadores.push([evento, h as Objeto]);
      }
    }
  }
  i.lineas.push(`  hooks: ${manejadores.length}`);
  for (const [evento, m] of manejadores) {
    await revisarComando(plugin, m, `hook ${evento}`, i);
  }
}

async function revisarMcp(plugin: string, i: Informe) {
  const json = await leerJson(path.join(plugin, ".mcp.json"));
  if (json === null) return;
  // La clave `mcpServers` puede faltar: el archivo es el mapa.
  const servidores = Object.entries(
    (json["mcpServers"] ?? json) as Objeto,
  );
  i.lineas.push(`  servidores MCP: ${servidores.length}`);
  for (const [nombre, s] of servidores) {
    await revisarComando(plugin, s as Objeto, `MCP ${nombre}`, i);
  }
}

/**
 * Claude Code instala las dependencias de npm del plugin solo si hay
 * package.json y archivo de bloqueo, y solo las que ahí figuran.
 */
async function revisarPaquetes(plugin: string, i: Informe) {
  const ts = (await archivos(plugin)).filter((f) => f.endsWith(".ts"));
  if (ts.length === 0) return;
  if (!(await tipo(path.join(plugin, "package-lock.json")))) {
    fallar(i, "hay código y falta package-lock.json");
  }
  const deps = await dependencias(plugin);
  for (const f of ts) {
    const codigo = await readFile(path.join(plugin, f), "utf8");
    for (const p of importaciones(codigo).paquetes) {
      if (!deps.includes(p)) {
        fallar(i, `${f}: falta ${p} en package.json`);
      }
    }
  }
}

async function revisarAgentes(plugin: string, i: Informe) {
  const carpeta = path.join(plugin, "agents");
  const md = (await listar(carpeta)).filter((n) => n.endsWith(".md"));
  i.lineas.push(`  agentes: ${md.length}`);
  for (const n of md) {
    const doc = separar(await readFile(path.join(carpeta, n), "utf8"));
    for (const campo of IGNORADOS) {
      if (campo in doc.datos) {
        fallar(i, `agents/${n}: ${campo} se ignora en un plugin`);
      }
    }
  }
}

/** Cada caso de `evals/`: su pedido y sus comprobaciones. */
async function revisarEvals(plugin: string, i: Informe) {
  const carpeta = path.join(plugin, "evals");
  const casos = (await listar(carpeta)).filter((n) => n !== "results");
  if (casos.length === 0) {
    avisar(i, "falta evals/: que cargue no dice si sirve");
  }
  for (const c of casos) {
    const dir = path.join(carpeta, c);
    if (!(await tipo(path.join(dir, "prompt.md")))) {
      if (!(await tipo(path.join(dir, "case.yaml")))) {
        fallar(i, `eval ${c}: sin prompt.md ni case.yaml`);
      }
      continue;
    }
    const doc = separar(await readFile(path.join(dir, "prompt.md"),
      "utf8"));
    for (const k of Object.keys(doc.datos)) {
      if (!CLAVES_PROMPT.has(k)) fallar(i, `eval ${c}: clave ${k}`);
    }
    if (doc.cuerpo.trim() === "") fallar(i, `eval ${c}: sin pedido`);
    const notas = (await listar(path.join(dir, "graders")))
      .filter((n) => n.endsWith(".md"));
    if (notas.length === 0) fallar(i, `eval ${c}: sin comprobaciones`);
    for (const n of notas) {
      const g = separar(
        await readFile(path.join(dir, "graders", n), "utf8"),
      );
      const t = texto(g.datos["type"]);
      const falta = COMPROBACIONES[t];
      if (falta === undefined) {
        fallar(i, `eval ${c}/${n}: type ${t || "(vacío)"}`);
      } else if (falta !== "" && !(falta in g.datos)) {
        fallar(i, `eval ${c}/${n}: ${t} sin ${falta}`);
      } else if (t === "llm" && g.cuerpo.trim() === "") {
        fallar(i, `eval ${c}/${n}: llm sin criterio`);
      }
    }
    i.lineas.push(`  eval ${c}: ${notas.length} comprobaciones`);
  }
}

/** Manifiesto, componentes y copias de un plugin del marketplace. */
async function revisarPlugin(entrada: Objeto, listados: Set<string>,
  i: Informe) {
  const nombre = texto(entrada["name"]);
  const fuente = texto(entrada["source"]);
  i.lineas.push(`${nombre || "(sin nombre)"} (${fuente})`);
  if (nombre === "" || !fuente.startsWith("./")) {
    fallar(i, "la entrada necesita name y un source local ./");
    return;
  }
  const plugin = path.join(RAIZ, fuente);
  if ((await tipo(plugin)) !== "carpeta") {
    fallar(i, `source ${fuente} no existe`);
    return;
  }
  const dir = path.join(plugin, ".claude-plugin");
  const m = await leerJson(path.join(dir, "plugin.json"));
  const propio = texto(m?.["name"]) || nombre;
  if (propio !== nombre) {
    fallar(i, `el marketplace dice ${nombre}; plugin.json, ${propio}`);
  }
  if (!KEBAB.test(propio) || RESERVADOS.some((r) =>
    propio.startsWith(r))) {
    fallar(i, `${propio}: nombre no admitido`);
  }
  const version = texto(m?.["version"]) || "(ninguna: sigue commits)";
  i.lineas.push(`  version: ${version}`);
  for (const f of await listar(dir)) {
    if (f !== "plugin.json") fallar(i, `.claude-plugin/${f} no carga`);
  }
  if (await tipo(path.join(plugin, "CLAUDE.md"))) {
    avisar(i, "CLAUDE.md en la raíz del plugin no se carga");
  }
  // Una dependencia que ningún marketplace agregado lista deja al
  // plugin instalado pero sin cargar.
  for (const d of lista(m?.["dependencies"])) {
    const dep = typeof d === "string"
      ? d
      : texto((d as Objeto)["name"]);
    if (!dep.includes("@") && !listados.has(dep)) {
      fallar(i, `depende de ${dep} y el marketplace no lo lista`);
    }
  }
  const skills = await listar(path.join(plugin, "skills"));
  i.lineas.push(`  skills: ${skills.length}`);
  await revisarAgentes(plugin, i);
  await revisarHooks(plugin, i);
  await revisarMcp(plugin, i);
  const piezas = await cierre(CONTENIDO[propio] ?? []);
  i.lineas.push(`  copias del repositorio: ${piezas.length}`);
  await revisarCopias(plugin, piezas, i);
  await revisarPaquetes(plugin, i);
  await revisarEvals(plugin, i);
}

export async function revisarMarketplace(i: Informe): Promise<number> {
  const m = await leerJson(path.join(RAIZ, MARKETPLACE));
  if (m === null) {
    fallar(i, `${MARKETPLACE} falta o no es JSON`);
    return 0;
  }
  for (const k of ["name", "owner", "plugins"]) {
    if (!(k in m)) fallar(i, `${MARKETPLACE} sin ${k}`);
  }
  const nombre = texto(m["name"]);
  i.lineas.push(`marketplace ${nombre}`);
  if (OFICIALES.has(nombre)) fallar(i, `${nombre}: nombre reservado`);
  const entradas = lista(m["plugins"]).map((e) => e as Objeto);
  const listados = new Set(entradas.map((e) => texto(e["name"])));
  for (const e of entradas) await revisarPlugin(e, listados, i);
  return entradas.length;
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  if (process.argv.includes("--armar")) {
    for (const [nombre, piezas] of Object.entries(CONTENIDO)) {
      await armar(path.join(RAIZ, "plugins", nombre),
        await cierre(piezas));
      console.log(`armado: plugins/${nombre}`);
    }
  }
  const informe: Informe = { lineas: [], fallas: 0, avisos: 0 };
  const plugins = await revisarMarketplace(informe);
  console.log(informe.lineas.join("\n"));
  console.log(`plugins=${plugins} fallas=${informe.fallas} ` +
    `avisos=${informe.avisos}`);
  process.exitCode = informe.fallas > 0 ? 1 : 0;
}
