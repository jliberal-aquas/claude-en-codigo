import { readFile } from "node:fs/promises";
import { peticionConPdf } from "./adjuntos.js";
import { crearCliente } from "./crear-cliente.js";
import { RUTA_PDF } from "./crear-pdf.js";
import { eco, iniciarServidorFalso } from "./servidor-falso.js";

/**
 * Arma la petición con el PDF sintético y la manda al servidor falso,
 * que solo cuenta lo que recibió. Nada de esto es una respuesta de
 * Claude: sirve para comprobar que el bloque viaja entero.
 */
const pdf = await readFile(RUTA_PDF);
const params = peticionConPdf(pdf, "Resume este manuscrito.");

// Para mostrar el bloque sin imprimir el archivo codificado entero.
const bloque = params.messages[0]?.content;
if (Array.isArray(bloque) && bloque[0]?.type === "document") {
  const origen = bloque[0].source;
  if (origen.type === "base64") {
    const resumen = {
      type: bloque[0].type,
      source: {
        type: origen.type,
        media_type: origen.media_type,
        data: origen.data.slice(0, 16) + "…",
      },
    };
    console.log(JSON.stringify(resumen, null, 2));
    console.log(`bytes del PDF: ${pdf.length}`);
    console.log(`caracteres en base64: ${origen.data.length}`);
  }
}

const servidor = await iniciarServidorFalso([eco()]);
const cliente = crearCliente({ baseURL: servidor.url });
const respuesta = await cliente.messages.create(params);
for (const b of respuesta.content) {
  if (b.type === "text") {
    console.log("texto del servidor falso:");
    console.log(b.text);
  }
}
await servidor.cerrar();
