import { isAbsolute, relative, resolve } from "node:path";

/**
 * Hook de PermissionRequest. Claude Code lo corre cuando está por
 * pedirte permiso para una herramienta; el bloque lo limita a Write y
 * Edit. Si la escritura cae dentro de landing/, contesta por ti: niega,
 * con un mensaje que Claude lee. Fuera de landing/ no imprime nada y el
 * diálogo de permiso sigue como siempre.
 *
 * En este evento, salir con 2 no niega nada: la decisión va en JSON,
 * con salida 0. Si el script falla, onFailure "block" niega igual.
 */

interface Entrada {
  hook_event_name?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

async function leerEntrada(): Promise<Entrada> {
  let texto = "";
  for await (const trozo of process.stdin) texto += String(trozo);
  // Una entrada rota lanza: el script sale con 1, sin decidir nada.
  return JSON.parse(texto) as Entrada;
}

/** ¿`ruta` cae dentro de `landing/`? Resuelve `..` antes de mirar. */
function dentroDeLanding(raiz: string, ruta: string): boolean {
  const base = resolve(raiz, "landing");
  const camino = relative(base, resolve(raiz, ruta));
  return (
    camino !== "" && !camino.startsWith("..") && !isAbsolute(camino)
  );
}

const entrada = await leerEntrada();
// Claude Code exporta CLAUDE_PROJECT_DIR; a mano, vale el cwd.
const raiz =
  process.env["CLAUDE_PROJECT_DIR"] ?? entrada.cwd ?? process.cwd();
const ruta = entrada.tool_input?.["file_path"];

if (typeof ruta === "string" && dentroDeLanding(raiz, ruta)) {
  const salida = {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "deny",
        // Lo lee Claude: dice qué hacer, no solo qué no.
        message:
          "landing/ pasa por revisión: no la escribas. Describe " +
          "el cambio en tu respuesta y una persona lo aplicará.",
      },
    },
  };
  // Un objeto JSON en varias líneas también vale; nada más en stdout.
  console.log(JSON.stringify(salida, null, 2));
}
// Sin JSON y con salida 0: el permiso se pide como siempre.
