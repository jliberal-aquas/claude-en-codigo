/**
 * Tarifas de la Claude API en USD por millón de tokens y fechas de
 * retiro de cada modelo. Todo cambia: se copió de las páginas de
 * precios y de modelos de la documentación el 2026-10-14
 * [VERIFICAR AL CIERRE]. Si una cifra no coincide con la página de
 * hoy, manda la página.
 */

export type IdModelo =
  | "claude-fable-5-1"
  | "claude-opus-5-5"
  | "claude-sonnet-5-5"
  | "claude-haiku-5-5";

export interface Tarifa {
  entrada: number;
  escritura5m: number;
  escritura1h: number;
  lectura: number;
  salida: number;
}

export const FECHA_PRECIOS = "2026-10-14";

// Haiku 5.5 vale así para prompts de hasta 100.000 tokens; sobre eso
// paga más, y este programa no lo modela: el escenario no llega.
export const TARIFAS: Record<IdModelo, Tarifa> = {
  "claude-fable-5-1": {
    entrada: 10,
    escritura5m: 12.5,
    escritura1h: 20,
    lectura: 0.25,
    salida: 50,
  },
  "claude-opus-5-5": {
    entrada: 4,
    escritura5m: 5,
    escritura1h: 8,
    lectura: 0.2,
    salida: 20,
  },
  "claude-sonnet-5-5": {
    entrada: 2,
    escritura5m: 2.5,
    escritura1h: 4,
    lectura: 0.1,
    salida: 10,
  },
  "claude-haiku-5-5": {
    entrada: 0.1,
    escritura5m: 0.125,
    escritura1h: 0.2,
    lectura: 0.01,
    salida: 0.5,
  },
};

/** El lote de mensajes descuenta la mitad de entrada y de salida. */
export const FACTOR_LOTE = 0.5;

/** Con menos tokens que esto, el prefijo no se guarda. */
export const MINIMO_CACHE = 512;

export interface Retiro {
  fecha: string;
  /** "fija": ya anunciada. "no antes de": piso, sin fecha cierta. */
  tipo: "fija" | "no antes de";
  /** El modelo que la documentación recomienda como reemplazo. */
  reemplazo?: string;
}

export const RETIROS: Record<string, Retiro> = {
  "claude-sonnet-4-5-20250929": {
    fecha: "2026-11-30",
    tipo: "fija",
    reemplazo: "claude-sonnet-5-5",
  },
  "claude-fable-5-1": { fecha: "2027-09-01", tipo: "no antes de" },
  "claude-opus-5-5": { fecha: "2027-09-22", tipo: "no antes de" },
  "claude-sonnet-5-5": { fecha: "2027-09-28", tipo: "no antes de" },
  "claude-haiku-5-5": { fecha: "2027-10-07", tipo: "no antes de" },
};
