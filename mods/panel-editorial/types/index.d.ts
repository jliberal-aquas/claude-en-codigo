// Contrato de los valores que el mod guarda en $.state. Claude Code lo
// lee desde "types" del manifiesto; `claude plugin validate` exige que
// cada clave que el módulo nombra esté declarada aquí.
export type EstadoFichas = {
  validas: number;
  invalidas: string[];
  pendientes: string[];
};

declare module "claude-code" {
  interface PluginState {
    "panel-editorial": { estado: EstadoFichas | null };
  }
}
