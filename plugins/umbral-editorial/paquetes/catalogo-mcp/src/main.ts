import { relative } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { carpetaFichas } from "./fichas.js";
import { crearServidor } from "./servidor.js";

// stdout es el canal del protocolo: lo que es para personas va por
// stderr. Un solo console.log aquí rompería la conversación.
const dir = carpetaFichas();
void serveStdio(() => crearServidor(dir));
console.error(
  `catalogo-mcp en stdio · fichas=${relative(process.cwd(), dir)}`,
);
