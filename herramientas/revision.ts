import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  leerPase,
  Revision,
  SalidaInvalida,
  SegundoPase,
  veredicto,
} from "./hallazgos.js";

/**
 * Los tres pasos de `revision.yml` que no son el modelo.
 *
 *   npm run --silent revision -- esquema hallazgos|confirmaciones
 *   npm run --silent revision -- segundo-pase <diff> <pase1.json>
 *   npm run --silent revision -- veredicto <pase1.json> <pase2.json>
 *
 * Códigos de salida: 0 pasa; 1 hay hallazgos críticos confirmados;
 * 2 una salida no se entiende (la revisión falló). Para el check
 * requerido, 1 y 2 son rojo: ninguno aprueba.
 */

const ESQUEMAS = { hallazgos: Revision, confirmaciones: SegundoPase };

async function principal(argv: string[]): Promise<number> {
  const [orden, a, b] = argv;

  const nombre = a === "hallazgos" || a === "confirmaciones" ? a : null;
  if (orden === "esquema" && nombre) {
    // Una sola fuente: el JSON Schema que recibe `--json-schema` sale
    // del mismo esquema con que se valida la respuesta. En draft-07:
    // el CLI 2.1.301 rechazó el draft 2020-12 (observado en local).
    const esquema = z.toJSONSchema(ESQUEMAS[nombre], {
      target: "draft-7",
    });
    console.log(JSON.stringify(esquema));
    return 0;
  }

  if (orden === "segundo-pase" && a && b) {
    // El segundo pase recibe el diff y los hallazgos, no el
    // razonamiento del primero: así no hereda su sesgo.
    const revision = leerPase(
      "primer pase",
      await readFile(b, "utf8"),
      Revision,
    );
    console.log(await readFile(a, "utf8"));
    console.log("<hallazgos>");
    console.log(JSON.stringify(revision.hallazgos, null, 2));
    console.log("</hallazgos>");
    return 0;
  }

  if (orden === "veredicto" && a && b) {
    const revision = leerPase(
      "primer pase",
      await readFile(a, "utf8"),
      Revision,
    );
    const segundo = leerPase(
      "segundo pase",
      await readFile(b, "utf8"),
      SegundoPase,
    );
    const v = veredicto(revision, segundo);
    for (const l of v.lineas) console.log(l);
    return v.codigo;
  }

  console.error(
    "uso: revision esquema hallazgos|confirmaciones\n" +
      "     revision segundo-pase <diff> <pase1.json>\n" +
      "     revision veredicto <pase1.json> <pase2.json>",
  );
  return 2;
}

try {
  process.exitCode = await principal(process.argv.slice(2));
} catch (e) {
  if (e instanceof SalidaInvalida) {
    // Por stderr: en el paso del segundo pase, stdout va a un archivo.
    console.error(`REVISIÓN INVÁLIDA · ${e.message}`);
    process.exitCode = 2;
  } else {
    throw e;
  }
}
