import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

/**
 * Revisa `.github/workflows/*.yml` sin GitHub: que cada archivo
 * parsee como YAML, que cada `npm run` y `npm test` nombre un script
 * que existe en el `package.json` que le toca, y cinco reglas que la
 * documentación de GitHub convierte en trampas. No ejecuta Actions:
 * lo que GitHub haga con el archivo lo dice la pestaña Actions.
 *
 * Uso: npm run workflows. Sale con 1 si algo falla.
 */

const RAIZ = process.cwd();
const CARPETA = path.join(RAIZ, ".github", "workflows");

interface Paso {
  name?: string;
  id?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Job {
  if?: unknown;
  env?: Record<string, string>;
  steps?: Paso[];
}

export interface Workflow {
  archivo: string;
  on: Record<string, unknown>;
  jobs: Record<string, Job>;
}

/** Lee y parsea un workflow; falla con nombre si no es YAML. */
export async function leerWorkflow(archivo: string): Promise<Workflow> {
  const crudo: unknown = parse(await readFile(archivo, "utf8"));
  const w = crudo as Partial<Workflow> | null;
  if (!w || typeof w.on !== "object" || typeof w.jobs !== "object") {
    throw new Error(`${archivo}: sin "on" o sin "jobs"`);
  }
  return { archivo, on: w.on, jobs: w.jobs };
}

async function scripts(carpeta: string): Promise<Set<string>> {
  const p = JSON.parse(
    await readFile(path.join(carpeta, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  return new Set(Object.keys(p.scripts ?? {}));
}

/** Los scripts de npm que nombra un bloque `run`, con su carpeta. */
export function comandosNpm(
  run: string,
): { script: string; landing: boolean }[] {
  const enLanding = /(^|\n)\s*cd landing\b/.test(run);
  const salida: { script: string; landing: boolean }[] = [];
  for (const linea of run.split("\n")) {
    const landing = enLanding || linea.includes("--prefix landing");
    for (const m of linea.matchAll(/npm (run|test)\b([^\n;|)]*)/g)) {
      const resto = (m[2] ?? "").trim().split(/\s+/);
      const script =
        m[1] === "test"
          ? "test"
          : resto.find((t) => t !== "" && !t.startsWith("-"));
      if (script) salida.push({ script, landing });
    }
  }
  return salida;
}

export async function revisar(): Promise<string[]> {
  const fallas: string[] = [];
  const raiz = await scripts(RAIZ);
  const landing = await scripts(path.join(RAIZ, "landing"));
  const nombres = new Map<string, string>();
  const archivos = (await readdir(CARPETA))
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();

  for (const f of archivos) {
    let w: Workflow;
    try {
      w = await leerWorkflow(path.join(CARPETA, f));
    } catch (e) {
      fallas.push(`${f}: no parsea (${(e as Error).message})`);
      continue;
    }
    // Con un PR ajeno y el checkout de su código, compromete el repo.
    if ("pull_request_target" in w.on) {
      fallas.push(`${f}: usa pull_request_target`);
    }
    let comandos = 0;
    for (const [nombre, job] of Object.entries(w.jobs)) {
      // El check requerido se elige por nombre de job: si se repite
      // entre workflows, el check es ambiguo.
      const otro = nombres.get(nombre);
      if (otro) fallas.push(`${f}: job "${nombre}" repetido (${otro})`);
      nombres.set(nombre, f);
      // Un job saltado informa éxito y no bloquea aunque sea requerido.
      if (job.if !== undefined) {
        fallas.push(`${f}: job "${nombre}" con if:`);
      }
      if (JSON.stringify(job.env ?? {}).includes("secrets.")) {
        fallas.push(`${f}: secreto en el env del job "${nombre}"`);
      }
      for (const paso of job.steps ?? []) {
        const run = paso.run ?? "";
        const etiqueta = paso.name ?? paso.id ?? "(paso)";
        // Un ${{ }} dentro de run se pega en el script antes de correr.
        if (run.includes("${{")) {
          fallas.push(`${f}: \${{ }} dentro de run en "${etiqueta}"`);
        }
        for (const c of comandosNpm(run)) {
          comandos += 1;
          const existe = (c.landing ? landing : raiz).has(c.script);
          if (!existe) {
            const donde = c.landing ? "landing/" : "la raíz";
            fallas.push(
              `${f}: "${etiqueta}" llama npm ${c.script}, ` +
                `que no existe en ${donde}`,
            );
          }
        }
      }
    }
    const jobs = Object.keys(w.jobs).join(", ");
    console.log(`${f}: jobs ${jobs} · ${comandos} comandos npm`);
  }
  return fallas;
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  const fallas = await revisar();
  for (const f of fallas) console.log(`  FALLA ${f}`);
  console.log(`fallas: ${fallas.length}`);
  process.exitCode = fallas.length > 0 ? 1 : 0;
}
