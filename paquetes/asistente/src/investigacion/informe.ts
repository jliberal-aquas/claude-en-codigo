import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { Delegacion, Investigacion } from "./coordinador.js";
import type { Hallazgo } from "./vuelta.js";

/**
 * El informe lo arma el programa con lo que trajo cada subagente, no
 * con el resumen del coordinador: un resumen bien escrito puede perder
 * de dónde salió cada dato. Aquí cada afirmación va con su fuente, y
 * lo que no se pudo averiguar va con su motivo.
 */

/** Palabras separadas por espacios, como las cuenta `wc -w`. */
export function contarPalabras(texto: string): number {
  return texto.split(/\s+/).filter((p) => p !== "").length;
}

/** Por pregunta, la última delegación: la reescrita gana. */
export function porPregunta(delegaciones: Delegacion[]): Delegacion[] {
  const ultima = new Map<string, Delegacion>();
  for (const d of delegaciones) ultima.set(d.descripcion, d);
  return [...ultima.values()];
}

export interface InformeArmado {
  texto: string;
  hallazgos: Hallazgo[];
  /** Preguntas sin respuesta: el informe es parcial si hay alguna. */
  faltantes: string[];
  /** Datos con dos versiones: se muestran las dos, no se elige. */
  conflictos: string[];
}

/**
 * Hallazgos que responden el mismo dato (misma clave). El programa
 * no elige entre ellos: lista sus números para que decida una
 * persona, que ve cada versión con su fuente y su fecha.
 */
export function buscarConflictos(hallazgos: Hallazgo[]): string[] {
  const porClave = new Map<string, number[]>();
  hallazgos.forEach((h, i) => {
    if (h.clave === undefined) return;
    porClave.set(h.clave, [...(porClave.get(h.clave) ?? []), i + 1]);
  });
  return [...porClave]
    .filter(([, ns]) => ns.length > 1)
    .map(([clave, ns]) => {
      const numeros = ns.map((n) => `[${n}]`).join(" y ");
      return `${clave}: ${numeros}`;
    });
}

export function armarInforme(
  pregunta: string,
  inv: Investigacion,
): InformeArmado {
  const hallazgos: Hallazgo[] = [];
  const faltantes: string[] = [];
  const fuentes: string[] = [];
  const lineas = ["# Investigación", `Pregunta: ${pregunta}`, ""];

  for (const d of porPregunta(inv.delegaciones)) {
    lineas.push(`## ${d.descripcion}`);
    const v = d.vuelta;
    if (v?.estado === "ok") {
      for (const h of v.hallazgos) {
        hallazgos.push(h);
        const n = hallazgos.length;
        const { ruta, cita, metodo, fecha } = h.fuente;
        const cuando = fecha ? ` (${fecha})` : "";
        lineas.push(`- ${h.afirmacion} [${n}]`);
        fuentes.push(
          `[${n}] ${ruta}${cuando}: ${cita ? `«${cita}»` : metodo}`,
        );
      }
    } else {
      const e = v?.estado === "error" ? v.error : undefined;
      faltantes.push(d.descripcion);
      lineas.push(
        `- NO COMPROBADO. ${e ? `${e.tipo}: ${e.motivo}` : ""}`.trim(),
      );
      if (e?.sugerencia) {
        lineas.push(`  Siguiente paso: ${e.sugerencia}`);
      }
    }
    lineas.push("");
  }

  const conflictos = buscarConflictos(hallazgos);
  if (conflictos.length > 0) {
    lineas.push("## Conflictos (no se elige)");
    lineas.push(...conflictos.map((c) => `- ${c}`), "");
  }
  lineas.push(
    faltantes.length === 0
      ? "Informe completo."
      : `Informe parcial: falta ${faltantes.join("; ")}.`,
    "",
    "## Fuentes",
    ...fuentes,
  );
  return {
    texto: lineas.join("\n"),
    hallazgos,
    faltantes,
    conflictos,
  };
}

/** Un problema de procedencia, con el número de la afirmación. */
export interface Problema {
  n: number;
  problema: string;
}

/**
 * Comprueba cada fuente contra el repositorio, sin modelo: la ruta
 * existe y está dentro de la raíz; la cita está, letra por letra, en
 * el archivo; y un conteo de palabras coincide con el que hace este
 * programa. Una afirmación sin cita ni medida queda «declarada».
 */
export async function verificarProcedencia(
  hallazgos: Hallazgo[],
  raiz: string,
): Promise<{ problemas: Problema[]; declaradas: number[] }> {
  const problemas: Problema[] = [];
  const declaradas: number[] = [];
  for (const [i, h] of hallazgos.entries()) {
    const n = i + 1;
    const ruta = resolve(raiz, h.fuente.ruta);
    if (relative(raiz, ruta).startsWith("..")) {
      problemas.push({ n, problema: "la fuente sale del repositorio" });
      continue;
    }
    const info = await stat(ruta).catch(() => null);
    if (info === null) {
      problemas.push({ n, problema: `no existe ${h.fuente.ruta}` });
      continue;
    }
    const { cita, metodo, valor } = h.fuente;
    if (cita !== undefined) {
      const texto = info.isFile() ? await readFile(ruta, "utf8") : "";
      if (!texto.includes(cita)) {
        problemas.push({
          n,
          problema: "la cita no está en el archivo",
        });
      }
    } else if (metodo === "contar_palabras" && info.isFile()) {
      const real = contarPalabras(await readFile(ruta, "utf8"));
      if (real !== valor) {
        problemas.push({
          n,
          problema: `dice ${String(valor)} palabras; son ${real}`,
        });
      }
    } else {
      declaradas.push(n);
    }
  }
  return { problemas, declaradas };
}
