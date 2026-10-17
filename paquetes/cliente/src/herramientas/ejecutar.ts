import type Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile } from "node:fs/promises";
import { GENEROS, type Genero } from "./definiciones.js";

/**
 * El despachador: recibe lo que el modelo pidió (bloques `tool_use`),
 * ejecuta cada herramienta en tu máquina y arma la respuesta con un
 * `tool_result` por pedido. Nunca deja escapar una excepción: un
 * fallo se devuelve al modelo como resultado con `is_error: true`,
 * para que la conversación siga y el modelo decida qué hacer.
 */

/**
 * Categorías de error. Son una convención de este libro, no campos de
 * la API: la API solo define `is_error` y el texto del resultado.
 */
export type Categoria =
  | "validacion" // la entrada está mal: corrígela y reintenta
  | "transitorio" // falló algo pasajero: reintentar puede servir
  | "permiso" // no está permitido: reintentar no sirve
  | "negocio" // una regla de la editorial lo impide
  | "interno"; // un error de este programa: avisa a una persona

export interface ErrorHerramienta {
  categoria: Categoria;
  reintentable: boolean;
  /** Qué falló, en una frase. */
  mensaje: string;
  /** Qué hacer ahora, en una frase. */
  sugerencia: string;
}

/** Lo que lanzan las herramientas cuando conocen el motivo. */
export class FalloHerramienta extends Error {
  readonly detalle: ErrorHerramienta;
  constructor(
    categoria: Categoria,
    reintentable: boolean,
    mensaje: string,
    sugerencia: string,
  ) {
    super(mensaje);
    this.detalle = { categoria, reintentable, mensaje, sugerencia };
  }
}

const validacion = (mensaje: string, sugerencia: string) =>
  new FalloHerramienta("validacion", true, mensaje, sugerencia);

/** El disco, separado para que las pruebas puedan simular fallos. */
export interface Disco {
  listar(carpeta: URL): Promise<string[]>;
  leer(archivo: URL): Promise<string>;
}

const DISCO_REAL: Disco = {
  listar: (carpeta) => readdir(carpeta),
  leer: (archivo) => readFile(archivo, "utf8"),
};

export interface Contexto {
  /** Carpeta de los manuscritos (`manuscritos/entrada/`). */
  carpeta: URL;
  /**
   * Géneros registrados en esta ejecución. Viven en memoria: las
   * fichas en disco, validadas, llegan en el capítulo 12.
   */
  generos: Map<string, Genero>;
  /** Si es `true`, ninguna herramienta puede escribir. */
  soloLectura: boolean;
  disco: Disco;
}

export function crearContexto(
  cambios: Partial<Contexto> = {},
): Contexto {
  return {
    carpeta: new URL(
      "../../../../manuscritos/entrada/",
      import.meta.url,
    ),
    generos: new Map(),
    soloLectura: false,
    disco: DISCO_REAL,
    ...cambios,
  };
}

interface Manuscrito {
  id: string;
  titulo: string;
  autoria: string;
  texto: string;
}

/**
 * Minúsculas y sin tildes: «Llave» y «llavé» buscan lo mismo. NFD
 * separa cada tilde en una marca aparte, y `\p{M}` las quita.
 */
const normalizar = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Traduce un fallo del disco a una categoría que el modelo lea. */
async function delDisco<T>(operacion: () => Promise<T>): Promise<T> {
  try {
    return await operacion();
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    if (codigo === "EACCES" || codigo === "EPERM") {
      throw new FalloHerramienta(
        "permiso",
        false,
        "No hay permiso para leer la carpeta de manuscritos.",
        "No reintentes: avisa a una persona.",
      );
    }
    if (codigo === "EBUSY" || codigo === "EMFILE" || codigo === "EIO") {
      throw new FalloHerramienta(
        "transitorio",
        true,
        `El disco no respondió (${codigo}).`,
        "Reintenta una vez; si vuelve a fallar, avisa a una persona.",
      );
    }
    // Cualquier otro es un error del programa: lo atrapa ejecutar().
    throw e;
  }
}

async function leerManuscritos(ctx: Contexto): Promise<Manuscrito[]> {
  const nombres = await delDisco(() => ctx.disco.listar(ctx.carpeta));
  const ids = nombres
    .filter((n) => /^ms-\d{3}\.md$/.test(n))
    .sort()
    .map((n) => n.replace(/\.md$/, ""));
  const manuscritos: Manuscrito[] = [];
  for (const id of ids) {
    const crudo = await delDisco(() =>
      ctx.disco.leer(new URL(`${id}.md`, ctx.carpeta)),
    );
    // La cabecera va entre dos líneas `---`; el cuento, después.
    const [, cabecera = "", texto = ""] = crudo.split(/^---\s*$/m);
    const campo = (clave: string) =>
      new RegExp(`^${clave}:\\s*(.+)$`, "m").exec(cabecera)?.[1] ?? "";
    manuscritos.push({
      id,
      titulo: campo("titulo"),
      autoria: campo("autora") || campo("autor"),
      texto,
    });
  }
  return manuscritos;
}

/** Lee un campo de texto o lanza un error de validación. */
function texto(
  entrada: unknown,
  campo: string,
  maximo: number,
): string {
  const valor = (entrada as Record<string, unknown> | null)?.[campo];
  if (typeof valor !== "string" || valor.trim() === "") {
    throw validacion(
      `Falta ${campo}, o no es un texto.`,
      `Envía ${campo} como texto no vacío.`,
    );
  }
  if (valor.length > maximo) {
    throw validacion(
      `${campo} pasa de ${maximo} caracteres.`,
      `Acórtalo a ${maximo} caracteres o menos.`,
    );
  }
  return valor.trim();
}

/** El esquema no sabe qué manuscritos existen; esto sí. */
async function manuscritoPorId(
  entrada: unknown,
  ctx: Contexto,
): Promise<Manuscrito> {
  const id = texto(entrada, "id", 10);
  if (!/^ms-\d{3}$/.test(id)) {
    throw validacion(
      `«${id}» no es un id de manuscrito.`,
      "Usa ms- y tres cifras, como ms-004.",
    );
  }
  const todos = await leerManuscritos(ctx);
  const hallado = todos.find((m) => m.id === id);
  if (hallado === undefined) {
    throw validacion(
      `${id} no existe; hay ${todos.length} manuscritos.`,
      "Si no conoces el id, usa buscar_manuscrito.",
    );
  }
  return hallado;
}

type Implementacion = (
  entrada: unknown,
  ctx: Contexto,
) => Promise<unknown>;

const IMPLEMENTACIONES: Record<string, Implementacion> = {
  async buscar_manuscrito(entrada, ctx) {
    const buscado = normalizar(texto(entrada, "texto", 80));
    const coincidencias = (await leerManuscritos(ctx))
      .filter((m) =>
        normalizar(`${m.titulo} ${m.autoria} ${m.texto}`).includes(
          buscado,
        ),
      )
      .map(({ id, titulo, autoria }) => ({ id, titulo, autoria }));
    // Cero coincidencias es una respuesta válida, no un error.
    return { coincidencias, total: coincidencias.length };
  },

  async leer_ficha(entrada, ctx) {
    const m = await manuscritoPorId(entrada, ctx);
    return {
      id: m.id,
      titulo: m.titulo,
      autoria: m.autoria,
      genero: ctx.generos.get(m.id) ?? null,
    };
  },

  async registrar_genero(entrada, ctx) {
    if (ctx.soloLectura) {
      throw new FalloHerramienta(
        "permiso",
        false,
        "Esta ejecución solo puede leer; registrar es escribir.",
        "No reintentes: di qué género propones y por qué.",
      );
    }
    const m = await manuscritoPorId(entrada, ctx);
    const genero = texto(entrada, "genero", 20);
    if (!(GENEROS as readonly string[]).includes(genero)) {
      throw validacion(
        `«${genero}» no es un género de la rúbrica.`,
        `Usa uno de: ${GENEROS.join(", ")}.`,
      );
    }
    const motivo = texto(entrada, "motivo", 300);
    const anterior = ctx.generos.get(m.id);
    if (anterior !== undefined && anterior !== genero) {
      throw new FalloHerramienta(
        "negocio",
        false,
        `${m.id} ya tiene género «${anterior}».`,
        "No reintentes: cambiarlo lo decide una persona.",
      );
    }
    ctx.generos.set(m.id, genero as Genero);
    return { id: m.id, genero, motivo, registrado: true };
  },
};

/** Lo que el despachador necesita de un bloque `tool_use`. */
export type Llamada = Pick<
  Anthropic.ToolUseBlock,
  "id" | "name" | "input"
>;

/** Ejecuta una llamada. Siempre devuelve un `tool_result`. */
export async function ejecutar(
  llamada: Llamada,
  ctx: Contexto,
): Promise<Anthropic.ToolResultBlockParam> {
  try {
    const implementacion = IMPLEMENTACIONES[llamada.name];
    if (implementacion === undefined) {
      throw validacion(
        `No existe la herramienta ${llamada.name}.`,
        `Usa una de: ${Object.keys(IMPLEMENTACIONES).join(", ")}.`,
      );
    }
    const resultado = await implementacion(llamada.input, ctx);
    return {
      type: "tool_result",
      tool_use_id: llamada.id,
      content: JSON.stringify(resultado),
    };
  } catch (e) {
    // Lo que nadie previó también vuelve como resultado: si lo
    // dejáramos escapar, cortaría la conversación entera.
    const detalle: ErrorHerramienta =
      e instanceof FalloHerramienta
        ? e.detalle
        : {
            categoria: "interno",
            reintentable: false,
            mensaje: `Error del programa: ${
              e instanceof Error ? e.message : String(e)
            }`,
            sugerencia: "No reintentes: avisa a una persona.",
          };
    return {
      type: "tool_result",
      tool_use_id: llamada.id,
      content: JSON.stringify(detalle),
      is_error: true,
    };
  }
}

/** Los nombres que el despachador sabe ejecutar. */
export const EJECUTABLES = Object.keys(IMPLEMENTACIONES);

/**
 * Ejecuta todos los `tool_use` de una respuesta y devuelve UN mensaje
 * `user` con un `tool_result` por pedido, en el mismo orden. Los
 * ejecuta uno tras otro: `registrar_genero` escribe, y lo que escribe
 * no debe competir con una lectura.
 */
export async function ejecutarTodas(
  content: readonly { type: string }[],
  ctx: Contexto,
): Promise<Anthropic.MessageParam> {
  const llamadas = content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (llamadas.length === 0) {
    throw new Error("La respuesta no pide ninguna herramienta.");
  }
  const resultados: Anthropic.ToolResultBlockParam[] = [];
  for (const llamada of llamadas) {
    resultados.push(await ejecutar(llamada, ctx));
  }
  return { role: "user", content: resultados };
}
