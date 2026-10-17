import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DESCRIPCION_BUSCAR } from "./descripciones.js";
import { leerCatalogo, type Catalogo, type Ficha } from "./fichas.js";

/**
 * Convención de esta casa, no de la especificación: el error viaja
 * como JSON dentro del texto del resultado, con su categoría y si vale
 * la pena reintentar. Lo oficial es `isError: true` y un mensaje que
 * diga qué hacer.
 */
type Categoria = "validacion" | "transitorio";

function fallo(
  categoria: Categoria,
  reintentable: boolean,
  mensaje: string,
) {
  const cuerpo = { categoria, reintentable, mensaje };
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(cuerpo) },
    ],
    isError: true,
  };
}

/** Lee el catálogo o devuelve el motivo por el que no pudo. */
async function intentarLeer(dir: string): Promise<Catalogo | string> {
  try {
    return await leerCatalogo(dir);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** ¿Algún campo de texto de la ficha contiene `texto`? */
function contiene(ficha: Ficha, texto: string): boolean {
  const buscado = texto.toLowerCase();
  return Object.values(ficha).some(
    (v) => typeof v === "string" && v.toLowerCase().includes(buscado),
  );
}

/**
 * Una fábrica: cada conexión recibe su propio servidor, y todos leen
 * la misma carpeta.
 */
export function crearServidor(dir: string): McpServer {
  const servidor = new McpServer({
    name: "catalogo",
    version: "1.0.0",
  });

  // Herramienta: la elige el modelo.
  servidor.registerTool(
    "buscar_ficha",
    {
      title: "Buscar en el catálogo de fichas",
      description: DESCRIPCION_BUSCAR,
      inputSchema: z.object({
        id: z
          .string()
          .regex(/^ms-\d{3}$/)
          .optional()
          .describe("Id del manuscrito, por ejemplo ms-004"),
        genero: z
          .string()
          .min(3)
          .optional()
          .describe("Género, por ejemplo policial"),
        texto: z
          .string()
          .min(3)
          .optional()
          .describe("Palabra del título, la firma o el resumen"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, genero, texto }) => {
      if (id === undefined && genero === undefined && !texto) {
        return fallo(
          "validacion",
          false,
          'Falta un criterio: id, genero o texto. Ejemplo: ' +
            '{"id": "ms-004"}.',
        );
      }
      const catalogo = await intentarLeer(dir);
      if (typeof catalogo === "string") {
        return fallo(
          "transitorio",
          true,
          `No se pudo leer el catálogo (${catalogo}). ` +
            "Reintenta en unos segundos.",
        );
      }
      const g = genero?.toLowerCase();
      const fichas = catalogo.fichas.filter(
        (f) =>
          (id === undefined || f.id === id) &&
          (g === undefined || f.genero?.toLowerCase() === g) &&
          (texto === undefined || contiene(f, texto)),
      );
      // Cero coincidencias es una respuesta, no un error: la
      // búsqueda funcionó y no encontró nada.
      const salida = { total: fichas.length, fichas };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(salida) },
        ],
      };
    },
  );

  // Recurso: lo elige la aplicación. Una plantilla de URI da una
  // dirección por ficha, y `list` las anuncia todas.
  servidor.registerResource(
    "ficha",
    new ResourceTemplate("ficha://{id}", {
      list: async () => {
        const catalogo = await leerCatalogo(dir);
        return {
          resources: catalogo.fichas.map((f) => ({
            uri: `ficha://${f.id}`,
            name: f.id,
            title: f.titulo,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Ficha de un manuscrito",
      description: "La ficha validada de un manuscrito, en JSON.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const catalogo = await leerCatalogo(dir);
      const ficha = catalogo.fichas.find(
        (f) => f.id === variables["id"],
      );
      if (ficha === undefined) {
        throw new Error(`No hay ficha en ${uri.href}.`);
      }
      return {
        contents: [
          { uri: uri.href, text: JSON.stringify(ficha, null, 2) },
        ],
      };
    },
  );

  return servidor;
}
