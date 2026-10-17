# Defectos sembrados (sintético)

Esta lista dice qué defectos trae la herencia a propósito y qué capítulo del libro los usa. **No la abras antes de que un capítulo te lo pida:** leerla antes arruina el diagnóstico.

## Los tres defectos

| Defecto | Dónde | Capítulo que lo provoca o lo descubre |
|--|--|--|
| 1. Componentes duplicados y estilos en línea mezclados con Tailwind | `landing/src/` | 6 (mapa), 7 (refactor de unos 20 archivos) |
| 2. Un enlace roto y una imagen con texto alternativo vacío | `landing/src/pages/index.astro` | 7 (prueba de caracterización), 25 (CI) |
| 3. Fechas en tres formatos y autores con dos grafías | `heredado/catalogo-antiguo/` | 30 |

## Detalle del defecto 1

Pares de componentes y de plantillas que hacen casi lo mismo, escritos por separado:

| Una versión | La otra | Se usa en |
|--|--|--|
| `components/Encabezado.astro` | `components/Header.astro` | portada y Sofía / libro |
| `components/Pie.astro` | `components/Footer.astro` | portada y Sofía / libro |
| `components/Boton.astro` | `components/BotonEnlace.astro` | portada, Sofía y 404 / libro |
| `components/Titulo.astro` | `components/TituloSeccion.astro` | portada y Sofía / libro |
| `components/ResumenLibro.astro` | `components/LibroCard.astro` | portada / libro |
| `layouts/Base.astro` | `layouts/BaseLibro.astro` | portada, Sofía y 404 / libro |

Los estilos en línea (`style="..."`) conviven con las clases de Tailwind en casi todos los componentes y en las tres páginas. Además, `styles/global.css` repite con clases propias (`.boton-patio`, `.titulo-seccion`) lo que otros componentes hacen con Tailwind.

## Detalle del defecto 2

En `landing/src/pages/index.astro`:

- **Enlace roto.** Línea 22: `<a href="/libro">` no lleva el camino base (`/editorial-web`) que el sitio tiene configurado en `astro.config.mjs`. Publicado, o visto en la vista previa, apunta fuera del sitio y da «página no encontrada». Es el único enlace interno que no usa el camino base; los demás sí.
- **Texto alternativo vacío.** Línea 25: la imagen de la portada del libro tiene `alt=""`, pero no es decorativa. Es la única imagen del sitio con el `alt` vacío.

`npm run build` termina bien con los dos defectos puestos: la construcción no comprueba enlaces ni textos alternativos.

## Detalle del defecto 3

En `heredado/catalogo-antiguo/catalogo.csv` (25 filas, separador `;`):

- **Fechas en tres formatos:** `2026-03-02` (año-mes-día, 9 filas), `09/03/2026` (día/mes/año, 8 filas) y `14 de marzo de 2026` (con palabras, 8 filas). Varias fechas con barras son ambiguas entre día y mes (por ejemplo `09/03/2026` y `02/05/2026`).
- **Autores con dos grafías:** cuatro autores aparecen escritos de dos maneras. Teresa Albarracín / Teresa Albarracin; Gaspar Linares / Gaspar Linarez; Ofelia Navarrete / Ofelia Navarete; Sofía / Sofia.

## Lo que no es un defecto

- La landing no tiene pruebas. Es así a propósito.
- `ideas/` de Sofía no viene en la herencia: la fundadora la dejó fuera de Git.
- Las rutas con barra invertida (`textos\presentacion.md`) de los documentos de la fundadora son de Windows, donde ella trabajaba.
- Las dos *skills* están en `heredado/skills/` y no en `.claude/skills/`, donde las tenía la fundadora, para que no se activen en tu copia antes de que un capítulo las use.
- `landing/.github/workflows/deploy.yml` es el archivo de publicación de `editorial-web`; dentro de `landing/` GitHub no lo ejecuta.
- Las versiones de la landing exigen Node 22.22 o posterior.
