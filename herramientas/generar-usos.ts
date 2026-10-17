import { mkdir, writeFile } from "node:fs/promises";
import type { Uso } from "../paquetes/cliente/src/costos.js";
import { MINIMO_CACHE } from "../paquetes/cliente/src/precios.js";
import { estimar } from "../paquetes/cliente/src/presupuesto.js";
import {
  armarPeticionConCache,
  cargarPlantilla,
  prefijoDe,
  type OpcionesCache,
  type Plantilla,
} from "../paquetes/cliente/src/armar-peticion.js";
import { armarPeticionIngenua } from "./armar-peticion-ingenua.js";

/**
 * Herramienta del editor, fuera del recorrido del lector: escribe
 * las tres grabaciones de `usage` que la herencia trae en
 * `fixtures/` para el capítulo 4. Ninguna salió de la API y los
 * números de salida son inventados. Lo que sí sale del código del
 * libro es el caché: la herramienta arma cada petición con las
 * funciones del capítulo y aplica sobre su prefijo la regla que la
 * documentación describe (un prefijo igual se lee, uno distinto se
 * escribe, por debajo de 512 tokens no se guarda nada y cada entrada
 * vence a los 5 minutos). Es la regla repetida, no una observación.
 *
 * Uso: npx tsx herramientas/generar-usos.ts
 */
const CARPETA = new URL("../fixtures/", import.meta.url);
const VIDA_MS = 5 * 60 * 1000;

interface Pedido {
  enviada: string;
  /** Largo del manuscrito sintético, en caracteres. */
  caracteres: number;
  visible: number;
  razonamiento: number;
}

const PEDIDOS: Pedido[] = [
  {
    enviada: "2026-10-16T10:02:11Z",
    caracteres: 1500,
    visible: 108,
    razonamiento: 880,
  },
  {
    enviada: "2026-10-16T10:02:52Z",
    caracteres: 3600,
    visible: 117,
    razonamiento: 1010,
  },
  {
    enviada: "2026-10-16T10:03:30Z",
    caracteres: 2400,
    visible: 112,
    razonamiento: 940,
  },
];

type Armar = (
  plantilla: Plantilla,
  manuscrito: string,
  opciones: OpcionesCache,
) => ReturnType<typeof armarPeticionConCache>;

async function escribir(nombre: string, contenido: object) {
  await writeFile(
    new URL(nombre, CARPETA),
    JSON.stringify(contenido, null, 2) + "\n",
  );
}

async function grabarCache(nombre: string, armar: Armar, que: string) {
  const plantilla = await cargarPlantilla("clasificar.v3");
  const vencimientos = new Map<string, number>();
  const peticiones = PEDIDOS.map((p) => {
    const ahora = new Date(p.enviada);
    const peticion = armar(plantilla, "x".repeat(p.caracteres), {
      ahora,
      esfuerzo: "medium",
    });
    const prefijo = prefijoDe(peticion);
    const delPrefijo = estimar(prefijo).estimacion;
    const delMensaje = estimar(
      String(peticion.messages[0]?.content),
    ).estimacion;
    const vence = vencimientos.get(prefijo);
    const guarda = delPrefijo >= MINIMO_CACHE;
    const lee =
      guarda && vence !== undefined && vence >= ahora.getTime();
    const usage: Uso = {
      input_tokens: guarda ? delMensaje : delPrefijo + delMensaje,
      cache_creation_input_tokens: guarda && !lee ? delPrefijo : 0,
      cache_read_input_tokens: lee ? delPrefijo : 0,
      output_tokens: p.visible + p.razonamiento,
      output_tokens_details: { thinking_tokens: p.razonamiento },
    };
    // Cada uso renueva la vida de la entrada.
    if (guarda) vencimientos.set(prefijo, ahora.getTime() + VIDA_MS);
    return { enviada: p.enviada, esfuerzo: "medium", usage };
  });
  await escribir(nombre, {
    _sintetico: true,
    descripcion: que,
    modelo: "claude-opus-5-5",
    vida: "5m",
    lote: false,
    peticiones,
  });
}

/** La factura de prueba de la fundadora: diez manuscritos. */
async function grabarFactura() {
  const entrada = [
    1210, 2450, 3980, 1520, 2890, 760, 5120, 2210, 3340, 1870,
  ];
  const visible = [112, 98, 125, 104, 118, 96, 131, 109, 121, 102];
  const razonamiento = [
    1020, 1380, 1710, 1140, 1490, 860, 2050, 1230, 1580, 1170,
  ];
  const peticiones = entrada.map((n, i) => ({
    enviada: `2026-10-15T16:${String(10 + i * 3).padStart(2, "0")}:00Z`,
    esfuerzo: "medium",
    usage: {
      input_tokens: n,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: (visible[i] ?? 0) + (razonamiento[i] ?? 0),
      output_tokens_details: { thinking_tokens: razonamiento[i] ?? 0 },
    },
  }));
  await escribir("uso-factura.json", {
    _sintetico: true,
    descripcion: "Prueba de la fundadora: diez manuscritos, uno a uno.",
    modelo: "claude-opus-5-5",
    vida: "5m",
    lote: false,
    peticiones,
  });
}

await mkdir(CARPETA, { recursive: true });
await grabarFactura();
await grabarCache(
  "uso-ingenua.json",
  armarPeticionIngenua,
  "Tres peticiones con la hora al principio de la instrucción.",
);
await grabarCache(
  "uso-reparada.json",
  armarPeticionConCache,
  "Las mismas tres peticiones con la hora tras el punto de corte.",
);
