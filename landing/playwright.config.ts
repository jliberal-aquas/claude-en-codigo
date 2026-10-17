import { defineConfig } from "@playwright/test";

/**
 * Pruebas de punta a punta de la landing: un navegador de verdad
 * contra la build de producción servida por `astro preview`. La guía
 * de pruebas de Astro recomienda probar ese código, no el de
 * desarrollo, y la de Playwright da las opciones para CI.
 */
const CI = !!process.env["CI"];

export default defineConfig({
  testDir: "e2e",
  // Un `test.only` olvidado haría pasar solo una prueba: en CI, falla.
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  // Tope total: si algo cuelga, el informe igual se escribe.
  globalTimeout: 5 * 60 * 1000,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4321/editorial-web/",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // `npm run build` va antes, en su propio paso: aquí solo se sirve.
    command: "npm run preview",
    url: "http://localhost:4321/editorial-web/",
    timeout: 120 * 1000,
    reuseExistingServer: !CI,
  },
});
