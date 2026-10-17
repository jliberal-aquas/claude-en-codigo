import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { leerModo } from "../../../cliente/src/crear-cliente.js";
import {
  investigar,
  type EncargoDeInvestigacion,
} from "./coordinador.js";
import { dobleGrabado, type GuionGrabado } from "./doble-grabado.js";
import { armarInforme, verificarProcedencia } from "./informe.js";

/**
 * La investigación de la fundadora sobre ms-006, de punta a punta:
 * coordinador, subagentes, informe con fuentes y verificación.
 * Uso: npm run investigar [-- libre]
 * En modo grabado usa el doble; `libre` elige la grabación en que el
 * subagente del largo contesta en texto libre.
 */

const RAIZ = fileURLToPath(new URL("../../../../", import.meta.url));

/** La pregunta de la fundadora (sintética). */
export const PEDIDO: EncargoDeInvestigacion = {
  pregunta:
    "Antes de aceptar ms-006 quiero saber tres cosas: si hay otros " +
    "cuentos parecidos en el catálogo, qué tan largo es frente a los " +
    "demás y si el tema ya salió en la landing.",
  exigir: ["ms-006"],
  maxSubagentes: 4,
};

export function guion(libre: boolean): GuionGrabado {
  return {
    coordinador: "inv-coord",
    subagentes: {
      "Parecidos en el catálogo": "inv-catalogo",
      "Largo frente a los demás": libre
        ? "inv-largo-libre"
        : "inv-largo",
      "Tema en la landing": "inv-landing",
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const libre = process.argv[2] === "libre";
  const consultar =
    leerModo() === "real" ? query : dobleGrabado(guion(libre));
  const inv = await investigar({ ...PEDIDO, raiz: RAIZ }, consultar);
  const informe = armarInforme(PEDIDO.pregunta, inv);
  console.log(informe.texto);

  const v = await verificarProcedencia(informe.hallazgos, RAIZ);
  console.log("\n# Verificación de procedencia");
  console.log(
    `afirmaciones=${informe.hallazgos.length} ` +
      `problemas=${v.problemas.length} ` +
      `declaradas=${v.declaradas.join(",") || "ninguna"}`,
  );
  for (const p of v.problemas) console.log(`[${p.n}] ${p.problema}`);

  console.log("\n# Síntesis del coordinador (sin fuentes, no se usa)");
  console.log(inv.sintesis ?? "(no hubo)");

  console.log("\n# Costo");
  for (const [quien, t] of Object.entries(inv.tokens)) {
    const d = inv.delegaciones.find((x) => x.id === quien);
    console.log(
      `${d?.descripcion ?? quien}: ` +
        `entrada=${t.entrada} salida=${t.salida}`,
    );
  }
  console.log(`estado=${inv.estado} costo_usd=${inv.costoUsd}`);
  // Parcial no es fracaso: sale con 0 si las fuentes se sostienen.
  process.exitCode = v.problemas.length === 0 ? 0 : 1;
}
