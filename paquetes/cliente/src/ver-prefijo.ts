import { readFile } from "node:fs/promises";
import {
  armarPeticionConCache,
  cargarPlantilla,
  prefijoDe,
} from "./armar-peticion.js";

const ahora = new Date(process.argv[2] ?? "");
if (Number.isNaN(ahora.getTime())) {
  console.error("uso: npm run prefijo -- 2026-10-16T10:02:11Z");
  process.exit(1);
}

const plantilla = await cargarPlantilla("clasificar.v3");
const ruta = "manuscritos/entrada/ms-004.md";
const manuscrito = await readFile(ruta, "utf8");
console.log(
  prefijoDe(armarPeticionConCache(plantilla, manuscrito, { ahora })),
);
