import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";
import { idDe, resumir } from "./fichas.ts";

/**
 * El módulo de hooks de `panel-editorial`. Claude Code llama a
 * `register` al cargar el mod; cada `on` deja un manejador del mod en
 * un evento. Corre dentro del proceso de Claude Code, con tus
 * permisos: nada de lo que hace pasa por las reglas de permiso.
 */

const ENTRADA = "manuscritos/entrada";
const FICHAS = "manuscritos/fichas";
const PANEL = "panel-editorial";

// El valor vive en $.state y no en una variable del módulo: una
// recarga del módulo vuelve a correr register y borraría la variable.
const estado = atom(
  { plugin: "panel-editorial", key: "estado" } as const,
  null,
);

/** Lee las dos carpetas con la API de mods y guarda el resumen. */
async function contar($: EngineInterface): Promise<void> {
  const entrada = await $.fs.list(ENTRADA);
  // Un manuscrito llega en .md o en .pdf: los dos esperan su ficha.
  const manuscritos = entrada
    .map((a) => idDe(a.name, "md") ?? idDe(a.name, "pdf"))
    .filter((id): id is string => id !== null);
  const fichas = new Map<string, string>();
  for (const archivo of await $.fs.list(FICHAS)) {
    const id = idDe(archivo.name, "json");
    if (id === null) continue;
    fichas.set(id, await $.fs.read(`${FICHAS}/${archivo.name}`));
  }
  await update($, estado, () => resumir(manuscritos, fichas));
}

/** ¿La ruta cae dentro de esa carpeta del repositorio? */
function dentroDe(ruta: string, carpeta: string): boolean {
  return ruta.replaceAll("\\", "/").includes(`${carpeta}/`);
}

export const register: Register = (on) => {
  // Una vez por mod cargado, antes de la primera instrucción.
  on("session.start", async ($, e, next) => {
    await contar($);
    await $.command.register({
      name: PANEL,
      description: "Muestra el estado de las fichas en un panel",
    });
    return next(e);
  });

  // /panel-editorial abre el panel; el usuario lo pidió.
  on("command.run", { command: PANEL }, async ($) => {
    await $.ui.open({ id: PANEL, title: "Fichas" });
    return { text: "Panel de fichas abierto." };
  });

  // El bloqueo: los manuscritos de entrada son de terceros y nadie
  // los edita. Juzga antes de llamar a next: si niega, nada corre.
  // Si la llamada tocó una ficha, vuelve a contar después de que la
  // herramienta corrió: session.start no se repite en la sesión.
  on("tool.call", { tool: ["Write", "Edit"] }, async ($, e, next) => {
    if (dentroDe(e.file_path, ENTRADA)) {
      return { deny: `${PANEL}: ${ENTRADA}/ no se edita.` };
    }
    const resultado = await next(e);
    if (dentroDe(e.file_path, FICHAS)) await contar($);
    return resultado;
  }).catch(($, e, next) =>
    // Si el manejador falla, el bloqueo falla cerrado.
    next.called ? next(e) : { deny: `${PANEL}: falló el control.` },
  );

  // El panel: Claude Code lo dibuja cada vez que hace falta.
  on(
    "ui.render",
    { component: "Pane", requestId: PANEL },
    async ($, e) => {
      const { Box, Text } = $.ui.resolve(e);
      const r = await read($, estado);
      if (r === null) {
        return Text({ dimColor: true, children: ["Contando..."] });
      }
      const filas = [
        Text({ children: [`${r.validas} válidas`] }),
        Text({ children: [`${r.invalidas.length} inválidas`] }),
        Text({ children: [`${r.pendientes.length} pendientes`] }),
      ];
      for (const id of r.invalidas) {
        filas.push(Text({ dimColor: true, children: [`  ${id}`] }));
      }
      return Box({ flexDirection: "column", children: filas });
    },
  );
};
