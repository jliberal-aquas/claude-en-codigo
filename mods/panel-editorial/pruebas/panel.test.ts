import { expect, test } from "claude-code/testing";
import type { On } from "claude-code";

/**
 * Pruebas de `panel-editorial` con `claude plugin test`: sin sesión,
 * sin inicio de sesión y sin red. Cada `on` de la prueba es un doble
 * que responde en lugar de Claude Code, debajo del mod.
 */

const BUENA = JSON.stringify({
  titulo: "Ficha sintética",
  firma: null,
  genero: "realismo",
  genero_detalle: null,
  resumen: "Resumen sintético.",
  premios: null,
  editorial_previa: null,
  notas_del_autor: null,
  confianza: "media",
});

/** Un repositorio de mentira: ruta del archivo a su texto. */
type Disco = Map<string, string>;

function disco(fichas: Record<string, string>): Disco {
  const d: Disco = new Map();
  for (const n of ["001", "002", "003", "004"]) {
    d.set(`manuscritos/entrada/ms-${n}.md`, "# manuscrito sintético");
  }
  d.set("manuscritos/entrada/ms-005.pdf", "%PDF sintético");
  for (const [id, texto] of Object.entries(fichas)) {
    d.set(`manuscritos/fichas/${id}.json`, texto);
  }
  return d;
}

/**
 * Claude Code entrega a los dobles la ruta absoluta, resuelta desde la
 * carpeta de trabajo; el disco de mentira guarda rutas relativas.
 */
function relativa(ruta: string): string {
  const i = ruta.indexOf("manuscritos/");
  return i < 0 ? ruta : ruta.slice(i);
}

/** Dobles de la API de mods y de las herramientas, sobre el disco. */
function dobles(on: On, d: Disco): void {
  on("fs.list", async (_$, e) => {
    const carpeta = `${relativa(e.path)}/`;
    const nombres = [...d.keys()]
      .filter((r) => r.startsWith(carpeta))
      .map((r) => r.slice(carpeta.length));
    return {
      value: nombres.map((name) => ({
        name,
        kind: "file" as const,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on("fs.read", async (_$, e) => {
    const texto = d.get(relativa(e.path));
    return texto === undefined
      ? { deny: `no existe ${e.path}` }
      : { value: texto };
  });
  // La herramienta «corre» aquí: escribe en el disco de mentira.
  on("tool.call", async (_$, e) => {
    if (e.tool === "Write") d.set(relativa(e.file_path), e.content);
    return { result: { ok: true } };
  });
  on("session.start", async (_$, e) => ({ cwd: e.cwd }));
  on("command.register", async (_$, e) => ({
    value: { command: e.name },
  }));
  on("ui.open", async () => ({ value: { isPlaced: true } }));
}

const INICIO = {
  cwd: "/repo",
  surface: "terminal",
  isInteractive: true,
} as const;

const PANEL = {
  plugin: "panel-editorial",
  surface: "terminal",
  component: "Pane",
  requestId: "panel-editorial",
  props: {
    title: "Fichas",
    isFocused: false,
    bodyColumns: 40,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const;

test("cuenta válidas, inválidas y pendientes", async ($, on) => {
  dobles(on, disco({ "ms-001": BUENA, "ms-002": "{ roto" }));
  await $.session.start(INICIO);
  const ui = await $.ui.mount(PANEL);
  const filas = await ui.findAll({ type: "Text" });
  expect(filas.map((f) => f.text)).toEqual([
    "1 válidas",
    "1 inválidas",
    "3 pendientes",
    "  ms-002",
  ]);
  await ui.unmount();
});

test("niega editar un manuscrito de entrada", async ($, on) => {
  dobles(on, disco({}));
  const r = await $.tool.call({
    tool: "Edit",
    file_path: "/repo/manuscritos/entrada/ms-004.md",
    old_string: "Mateo",
    new_string: "Matías",
  });
  expect(r.deny).toMatch(/no se edita/);
});

test("el panel ve una ficha escrita en la sesión", async ($, on) => {
  dobles(on, disco({ "ms-001": BUENA }));
  await $.session.start(INICIO);
  await $.tool.call({
    tool: "Write",
    file_path: "/repo/manuscritos/fichas/ms-003.json",
    content: BUENA,
  });
  const ui = await $.ui.mount(PANEL);
  const filas = await ui.findAll({ type: "Text" });
  expect(filas[0]?.text).toBe("2 válidas");
  await ui.unmount();
});
