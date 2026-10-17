---
paths:
  - "landing/**/*"
  - "**/*.astro"
---

# La landing

- Estilos con clases de Tailwind; no agregues `style="..."`.
- Los enlaces internos llevan el camino base: `${base}/libro/`, nunca
  `/libro` a secas.
- Toda imagen que no sea decoración lleva un `alt` que dice qué
  muestra.
- Antes de dar algo por terminado, dentro de `landing/`:
  `npm run build` y `npm test`.
