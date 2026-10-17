import { test, expect } from "@playwright/test";

/**
 * Lo que vive quien visita la landing: entra, hace clic y llega. La
 * prueba de caracterización del capítulo 7 compara el texto de cada
 * enlace con una lista; esta sigue cada enlace interno y exige que
 * del otro lado haya una página.
 */
const PAGINAS = ["", "libro/", "sofia/"];
const BASE = "/editorial-web/";

for (const pagina of PAGINAS) {
  test(`enlaces internos de /${pagina} llegan a una página`, async ({
    page,
    request,
  }) => {
    await page.goto(pagina);
    const destinos = await page
      .locator("a[href^='/']")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    expect(destinos.length).toBeGreaterThan(0);

    for (const destino of new Set(destinos)) {
      expect(destino, "enlace sin camino base").toMatch(
        new RegExp(`^${BASE}`),
      );
      const respuesta = await request.get(destino);
      const de = `${destino} desde /${pagina}`;
      expect(respuesta.status(), de).toBe(200);
    }
  });
}

test("el botón de la portada abre el libro", async ({ page }) => {
  await page.goto("");
  const boton = { name: "Leer el primer cuento" };
  await page.getByRole("link", boton).click();
  await expect(
    page.getByRole("heading", { name: "La puerta azul", level: 1 }),
  ).toBeVisible();
});
