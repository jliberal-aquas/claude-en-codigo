# Landing de Ediciones del Patio (sintética)

Sitio estático hecho con Astro y Tailwind. Presenta la editorial, a su autora (Sofía) y su primer libro («La puerta azul»). Todo el contenido es sintético: personas, libros y textos son inventados.

No pide datos a nadie, no vende nada y no tiene pruebas automáticas.

## Cómo construirla

Necesitas Node 22.22 o posterior (Astro 7.4.0 lo exige).

```bash
cd landing
npm ci
npm run build      # genera la carpeta dist/
npm run dev        # servidor local en http://localhost:4321/editorial-web/
```

El sitio vive bajo el camino base `/editorial-web`, el nombre del repositorio donde se publicaba. `astro.config.mjs` trae una dirección de ejemplo en `site`; cámbiala por la tuya si algún día lo publicas.

## Qué hay

- `src/pages/`: portada (`index.astro`), libro, Sofía y la página 404.
- `src/components/`, `src/layouts/`: las piezas de las páginas.
- `src/data/`: los datos del libro y de la autora.
- `public/`: el ícono y la portada del libro, ambos dibujos en SVG.
- `.github/workflows/deploy.yml`: la publicación en GitHub Pages que usaba el repositorio `editorial-web`. Aquí no se ejecuta.

## Licencia

Código: MIT. Textos: CC BY 4.0. Véase `../LICENSE`.
