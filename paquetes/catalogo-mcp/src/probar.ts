import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";

/**
 * Cliente de prueba: lanza el servidor como subproceso, igual que lo
 * hará Claude Code, y le hace preguntas sin modelo y sin API.
 * Uso: npm run catalogo:probar
 */
const transporte = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "paquetes/catalogo-mcp/src/main.ts"],
});
const cliente = new Client({
  name: "probar-catalogo",
  version: "1.0.0",
});
await cliente.connect(transporte);

const { tools } = await cliente.listTools();
for (const t of tools) {
  const largo = t.description?.length ?? 0;
  console.log(`herramienta: ${t.name} (descripción: ${largo} car.)`);
}
const { resourceTemplates } = await cliente.listResourceTemplates();
for (const p of resourceTemplates) {
  console.log(`plantilla de recurso: ${p.uriTemplate}`);
}
const { resources } = await cliente.listResources();
const uris = resources.map((r) => r.uri);
console.log(
  `recursos: ${uris.length} (${uris[0]} … ${uris.at(-1)})`,
);

/**
 * Una línea por resultado: si salió bien, cuántas fichas y cuáles; si
 * no, la categoría del error o, si no la trae, su texto recortado.
 */
function resumir(
  contenido: readonly unknown[],
  error: boolean,
): string {
  const todo = contenido
    .map((c) => (c as { text?: string }).text ?? "")
    .join("");
  if (!error) {
    const r = JSON.parse(todo) as {
      total: number;
      fichas: { id: string; genero: string | null }[];
    };
    const lista = r.fichas.map((f) => `${f.id} · ${f.genero}`);
    return `total=${r.total} [${lista.join(", ")}]`;
  }
  try {
    // ¿Es nuestro error con categoría?
    const f = JSON.parse(todo) as Record<string, unknown>;
    return `categoria=${f["categoria"]} ` +
      `reintentable=${f["reintentable"]}`;
  } catch {
    // No: lo escribió otro (el SDK, por ejemplo).
    return todo.length > 60 ? `${todo.slice(0, 60)}…` : todo;
  }
}

const consultas: Record<string, unknown>[] = [
  { id: "ms-004" },
  { genero: "policial" },
  { texto: "dragón" },
  {},
  { id: "ms-4" },
];
for (const args of consultas) {
  const r = await cliente.callTool({
    name: "buscar_ficha",
    arguments: args,
  });
  const error = r.isError === true;
  console.log(`buscar_ficha ${JSON.stringify(args)}`);
  console.log(`  isError=${error} ${resumir(r.content, error)}`);
}

// Una herramienta que no existe no es un resultado: es un error del
// protocolo, y aquí sí salta el catch.
try {
  await cliente.callTool({ name: "buscar_fichas", arguments: {} });
  console.log("buscar_fichas\n  respondió");
} catch (e) {
  const mensaje = e instanceof Error ? e.message : String(e);
  const codigo = (e as { code?: number }).code;
  console.log(`buscar_fichas\n  excepción ${codigo}: ${mensaje}`);
}

const leida = await cliente.readResource({ uri: "ficha://ms-004" });
const primero = leida.contents[0] as { text?: string } | undefined;
const genero = JSON.parse(primero?.text ?? "{}").genero;
console.log(`ficha://ms-004\n  genero=${genero}`);

await cliente.close();
