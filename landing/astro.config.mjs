// Configuración de la landing de Ediciones del Patio.
// `site` es una dirección de ejemplo (sintética): quien publique la landing
// debe cambiarla por la suya. `base` es el nombre del repositorio donde se publica.
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://ediciones-del-patio.example.invalid",
  base: "/editorial-web",
  vite: {
    plugins: [tailwindcss()],
  },
});
