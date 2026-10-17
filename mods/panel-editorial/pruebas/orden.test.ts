import { expect, test } from "claude-code/testing";
import type { Register } from "claude-code";

/**
 * Orden de carga: un segundo mod bloquea lo mismo que panel-editorial
 * con otro mensaje. Se carga en línea, en dos lugares de la cadena:
 * `prepend` (antes de los mods instalados, como un mod de la
 * organización) y `append` (después).
 */

// El entorno de las pruebas no tiene Node, pero sí un console cuya
// salida imprime claude plugin test; los tipos no lo declaran.
declare const console: { log(texto: string): void };

const politica: Register = (on) => {
  on("tool.call", { tool: "Edit" }, ($, e, next) =>
    e.file_path.includes("manuscritos/")
      ? { deny: "politica-patio: manuscritos en solo lectura." }
      : next(e),
  );
};

const EDITAR = {
  tool: "Edit",
  file_path: "/repo/manuscritos/entrada/ms-004.md",
  old_string: "Mateo",
  new_string: "Matías",
} as const;

for (const tier of ["prepend", "append"] as const) {
  test(
    `política en ${tier}`,
    { plugins: [{ name: "politica-patio", tier, register: politica }] },
    async ($) => {
      const r = await $.tool.call(EDITAR);
      expect(r.deny).toMatch(/./);
      console.log(`${tier}: ${r.deny}`);
    },
  );
}
