import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSdkMcpServer,
  query,
  tool,
  type CanUseTool,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  crearContexto,
  ejecutar,
} from "../../cliente/src/herramientas/ejecutar.js";
import { hooksDelAsistente } from "./hooks.js";
import { TRABAJO, crearPermisos } from "./permisos.js";

/**
 * El asistente de la editorial, v1, sobre el Agent SDK. El bucle, la
 * ejecución de herramientas y la sesión los pone el SDK; aquí quedan
 * tus reglas: qué herramientas existen, cuáles pasan sin preguntar,
 * quién decide el resto, cuánto puede gastar y qué se informa.
 */

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Herramienta propia del SDK: `buscar_manuscrito` del capítulo 11,
 * con el mismo despachador. El SDK la sirve desde un servidor MCP
 * dentro de este proceso, sin otro programa que lanzar.
 */
const buscarManuscrito = tool(
  "buscar_manuscrito",
  "Busca manuscritos de la convocatoria cuyo título, autoría o " +
    "texto contengan una palabra o frase. Devuelve id, título y " +
    "autoría de cada coincidencia, no el texto ni la ficha. Úsala " +
    "cuando no conoces el id; con un id, usa buscar_ficha.",
  { texto: z.string().min(1).max(80).describe("Palabra o frase") },
  async ({ texto }) => {
    const r = await ejecutar(
      { id: "sdk", name: "buscar_manuscrito", input: { texto } },
      crearContexto({ soloLectura: true }),
    );
    const contenido = typeof r.content === "string" ? r.content : "";
    // Un fallo vuelve como resultado con isError: el bucle sigue y
    // el modelo lee el motivo, como en el capítulo 11.
    return {
      content: [{ type: "text", text: contenido }],
      isError: r.is_error === true,
    };
  },
  { annotations: { readOnlyHint: true } },
);

const editorial = createSdkMcpServer({
  name: "editorial",
  version: "1.0.0",
  tools: [buscarManuscrito],
});

/** Lo que pasa sin preguntar: solo herramientas que leen. */
export const APROBADAS = [
  "mcp__catalogo__buscar_ficha",
  "mcp__editorial__buscar_manuscrito",
];

/** Las integradas que existen en la sesión: ni Bash, ni Edit. */
export const INTEGRADAS = ["Read", "Write"];

export interface Encargo {
  /** Lo que se le pide al asistente, en una instrucción. */
  pedido: string;
  /** Raíz del repositorio. */
  raiz?: string;
  /** Id de una conversación anterior, para seguirla. */
  reanudar?: string;
  /** Con `reanudar`: seguir en una sesión nueva, sin tocar la vieja. */
  bifurcar?: boolean;
  /** Red de seguridad: turnos con herramientas. */
  maxTurnos?: number;
  /** Política de costo: dólares estimados por consulta. */
  presupuestoUsd?: number;
  /** Quién decide lo que no está aprobado; por defecto, la política. */
  permisos?: CanUseTool;
}

/** Arma las opciones del SDK. Aparte, para probarlas sin red. */
export function opcionesDelAsistente(encargo: Encargo): Options {
  const raiz = encargo.raiz ?? RAIZ;
  const opciones: Options = {
    // Primera frontera: leer dentro de la carpeta de trabajo no pide
    // permiso; fuera de ella, sí, y eso llega al callback.
    cwd: resolve(raiz, TRABAJO),
    systemPrompt:
      "Eres el asistente de una editorial pequeña. Respondes sobre " +
      "los manuscritos de la convocatoria con las fichas del " +
      "catálogo, y solo escribes fichas JSON en manuscritos/fichas/. " +
      "Si un permiso se niega, lee el motivo y cambia de camino.",
    tools: INTEGRADAS,
    allowedTools: APROBADAS,
    // Write no está en allowedTools: así llega al callback. Lo que se
    // aprueba antes (allowedTools, acceptEdits, una regla) no llega.
    permissionMode: "default",
    canUseTool: encargo.permisos ?? crearPermisos(raiz),
    // Sin ajustes de usuario ni de la carpeta: una regla allow suelta
    // en tu ~/.claude saltaría el callback.
    settingSources: [],
    mcpServers: {
      catalogo: {
        type: "stdio",
        command: "npx",
        args: [
          "tsx",
          resolve(raiz, "paquetes/catalogo-mcp/src/main.ts"),
        ],
      },
      editorial,
    },
    maxTurns: encargo.maxTurnos ?? 12,
    maxBudgetUsd: encargo.presupuestoUsd ?? 0.5,
    // Con settingSources: [] no se cargan los hooks de
    // .claude/settings.json: el control de las fichas va en el código.
    hooks: hooksDelAsistente(raiz),
  };
  if (encargo.reanudar !== undefined) {
    opciones.resume = encargo.reanudar;
    if (encargo.bifurcar === true) opciones.forkSession = true;
  }
  return opciones;
}

/** Tokens de un mensaje del modelo, para saber lo que costó. */
export interface UsoMensaje {
  id: string;
  entrada: number;
  salida: number;
}

export interface Informe {
  /** `success`, un subtipo de error del SDK o `sin resultado`. */
  estado: string;
  /** La sesión, para reanudarla o bifurcarla. */
  sesion?: string;
  texto?: string;
  turnos?: number;
  /** Estimación del SDK, no una factura. */
  costoUsd: number;
  /** Un registro por mensaje del modelo, sin repetir ids. */
  porMensaje: UsoMensaje[];
  /** Herramientas que el callback (o el modo) negó. */
  negadas: string[];
  /** El texto del error, si `query()` lanzó. */
  error?: string;
}

/** La firma de `query`: el asistente la recibe para poder probarlo. */
export type Consultar = (parametros: {
  prompt: string;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

/**
 * Corre un encargo y devuelve un informe. No decide nada sobre el
 * bucle: lee lo que el SDK emite y lo resume.
 */
export async function correrAsistente(
  encargo: Encargo,
  consultar: Consultar = query,
): Promise<Informe> {
  const informe: Informe = {
    estado: "sin resultado",
    costoUsd: 0,
    porMensaje: [],
    negadas: [],
  };
  const vistos = new Set<string>();
  try {
    for await (const m of consultar({
      prompt: encargo.pedido,
      options: opcionesDelAsistente(encargo),
    })) {
      if (m.type === "system" && m.subtype === "init") {
        informe.sesion = m.session_id;
      }
      if (m.type === "assistant") {
        // Una respuesta del modelo puede llegar en varios mensajes del
        // SDK con el mismo id y el mismo uso: se cuenta una vez.
        const { id, usage } = m.message;
        if (!vistos.has(id)) {
          vistos.add(id);
          informe.porMensaje.push({
            id,
            entrada: usage.input_tokens,
            salida: usage.output_tokens,
          });
        }
      }
      if (m.type === "result") {
        informe.estado = m.subtype;
        informe.turnos = m.num_turns;
        informe.costoUsd = m.total_cost_usd;
        informe.negadas = m.permission_denials.map((d) => d.tool_name);
        if (m.subtype === "success") informe.texto = m.result;
      }
    }
  } catch (e) {
    // Una consulta de una sola vez lanza después de entregar un
    // resultado de error: el estado ya quedó leído arriba.
    informe.error = e instanceof Error ? e.message : String(e);
  }
  return informe;
}

/** Uso: npm run asistente -- "instrucción" [id-de-sesión] */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [pedido, reanudar] = process.argv.slice(2);
  if (pedido === undefined) {
    console.error('Uso: npm run asistente -- "instrucción" [sesión]');
    process.exit(2);
  }
  const informe = await correrAsistente(
    reanudar === undefined ? { pedido } : { pedido, reanudar },
  );
  console.log(JSON.stringify(informe, null, 2));
  process.exitCode = informe.estado === "success" ? 0 : 1;
}
