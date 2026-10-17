# Mapa de la landing

Escrito con Claude Code a partir de `landing/src/`; las rutas son
relativas a esa carpeta.

## Páginas

### `pages/index.astro`

Portada: presentación, lo que publicamos, el libro y su autora.
Contiene: `<Encabezado />`, `<ResumenLibro />`, `${base}/libro/`

### `pages/libro.astro`

Página del libro, con los mismos componentes que las demás.
Contiene: `<Encabezado />`, `<ResumenLibro`, `<Pie />`

### `pages/sofia.astro`

Página de la autora.
Contiene: `<BloqueAutora />`, `<Boton`

### `pages/404.astro`

Página de error.
Contiene: `No encontramos esa página`

## Plantillas

### `layouts/Base.astro`

Contiene: `<html lang="es">`, `<slot />`
Lo usan: `pages/index.astro`, `pages/libro.astro`
Lo usan: `pages/sofia.astro`, `pages/404.astro`

## Componentes

### `components/Encabezado.astro`

Contiene: `<nav`, `"El libro"`
Lo usan: `pages/index.astro`, `pages/libro.astro`
Lo usan: `pages/sofia.astro`, `pages/404.astro`

### `components/Pie.astro`

Contiene: `<footer`
Lo usan: `pages/index.astro`, `pages/libro.astro`
Lo usan: `pages/sofia.astro`, `pages/404.astro`

### `components/Boton.astro`

Contiene: `<a href={href}`
Lo usan: `pages/index.astro`, `pages/libro.astro`
Lo usan: `pages/sofia.astro`, `pages/404.astro`

### `components/Titulo.astro`

Contiene: `<h2`
Lo usan: `pages/index.astro`, `pages/libro.astro`, `pages/sofia.astro`

### `components/ResumenLibro.astro`

Ficha del libro: pequeña en la portada, grande (`grande`) en la
página del libro.
Contiene: `<article`, `libro.titulo`
Lo usan: `pages/index.astro`, `pages/libro.astro`

### `components/BloqueAutora.astro`

Contiene: `autora.nombre`
Lo usan: `pages/index.astro`, `pages/sofia.astro`

### `components/Aviso.astro`

Contiene: `<slot />`
Lo usan: `pages/index.astro`

## Pares que hacían lo mismo

Unificados en el capítulo 7, en la rama `herencia-saneada`: quedan
`Encabezado`, `Pie`, `Boton`, `Titulo`, `ResumenLibro` y `Base`.
