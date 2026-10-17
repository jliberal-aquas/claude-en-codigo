import { isAbsolute, relative, resolve } from "node:path";
import type {
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * El callback de permisos del asistente. El SDK lo llama antes de
 * ejecutar una herramienta que nadie aprobó antes: ni una regla, ni
 * el modo de permiso, ni `allowedTools`. Lo que devuelve decide.
 *
 * Política: mínimo privilegio por ruta. Leer, solo en `manuscritos/`;
 * escribir, solo fichas JSON en `manuscritos/fichas/`; cualquier otra
 * herramienta, negada. Negar no corta el trabajo: el mensaje le llega
 * al modelo, que puede cambiar de camino.
 */

/** Carpeta de trabajo del asistente, y lo único que puede leer. */
export const TRABAJO = "manuscritos";
/** Lo único donde puede escribir. */
export const ESCRITURA = "manuscritos/fichas";

const negar = (message: string): PermissionResult => ({
  behavior: "deny",
  message,
});

const permitir = (
  entrada: Record<string, unknown>,
): PermissionResult => ({ behavior: "allow", updatedInput: entrada });

/**
 * ¿`ruta` cae dentro de `carpeta`? Una ruta relativa se resuelve desde
 * la carpeta de trabajo, como la resolvería la herramienta, y `..` se
 * resuelve antes de comparar: `fichas/../../.env` no está dentro,
 * aunque lo parezca. (No sigue enlaces simbólicos: no debe haberlos.)
 */
export function dentroDe(
  raiz: string,
  carpeta: string,
  ruta: string,
): boolean {
  const base = resolve(raiz, carpeta);
  const destino = resolve(raiz, TRABAJO, ruta);
  const camino = relative(base, destino);
  return (
    camino !== "" && !camino.startsWith("..") && !isAbsolute(camino)
  );
}

/** El campo `file_path` de Read, Write y Edit, si es un texto. */
function rutaDe(entrada: Record<string, unknown>): string | null {
  const ruta = entrada["file_path"];
  return typeof ruta === "string" && ruta !== "" ? ruta : null;
}

/** Crea el callback para el repositorio que empieza en `raiz`. */
export function crearPermisos(raiz: string): CanUseTool {
  return async (herramienta, entrada) => {
    const ruta = rutaDe(entrada);

    if (herramienta === "Read") {
      if (ruta !== null && dentroDe(raiz, TRABAJO, ruta)) {
        return permitir(entrada);
      }
      return negar(
        `Solo puedes leer dentro de ${TRABAJO}/. Para un dato de ` +
          "un manuscrito, usa buscar_ficha o buscar_manuscrito.",
      );
    }

    if (herramienta === "Write" || herramienta === "Edit") {
      if (
        ruta !== null &&
        dentroDe(raiz, ESCRITURA, ruta) &&
        ruta.endsWith(".json")
      ) {
        return permitir(entrada);
      }
      // El mensaje dice qué hacer, no solo qué no: el modelo lo lee.
      return negar(
        `No puedes escribir en ${ruta ?? "esa ruta"}. Solo se ` +
          `escriben fichas JSON en ${ESCRITURA}/, por ejemplo ` +
          `${ESCRITURA}/ms-004.json.`,
      );
    }

    return negar(
      `${herramienta} no es una herramienta del asistente. Usa ` +
        "buscar_ficha, buscar_manuscrito, Read o Write.",
    );
  };
}
