# Costos de clasificar la convocatoria

Estimación con precios a la fecha (2026-10-14)
`[VERIFICAR AL CIERRE]`. Escenario sintético, no una factura.

## Supuestos (sintéticos: reemplázalos por medidas)

- 500 manuscritos de 1500 palabras (~2703 tokens).
- Instrucción fija medida: ~1104 tokens.
- Salida por manuscrito: 300 tokens visibles y
  900 de razonamiento.
- El caché acierta en todas las peticiones menos la primera,
  salvo donde se dice que el prefijo cambia.

## Tabla de costos.ts

| Configuración | USD | Frente a la base |
|:--|--:|--:|
| base: Opus 5.5, sin caché, de uno en uno | 19.61 | = |
| (a) Sonnet 5.5, sin caché | 9.81 | -50 % |
| (a) Haiku 5.5, sin caché | 0.49 | -97 % |
| (b) Opus 5.5, caché de 5 min | 17.52 | -11 % |
| (b) caché, prefijo que cambia | 20.17 | +3 % |
| (c) Opus 5.5 en lote, sin caché | 9.81 | -50 % |
| lote + caché 1 h, mejor caso | 8.76 | -55 % |
| lote + caché 1 h, peor caso | 10.91 | -44 % |
| Haiku 5.5, lote + caché 1 h, mejor | 0.22 | -99 % |

## Las situaciones en juego

- Una autora espera la decisión: Opus 5.5, una petición por vez,
  sin caché, 19.61 USD por los 500. Riesgo: es lo más caro; el
  caché de 5 min solo ahorra si llegan más peticiones antes de que
  venza.
- Ráfaga, a menos de 5 min una de otra: Opus 5.5, caché de 5 min,
  17.52 USD. Riesgo: si el prefijo cambia, cuesta más que sin
  caché.
- La convocatoria, de noche: Opus 5.5, lote y caché de 1 h,
  8.76 a 10.91 USD. Riesgo: los aciertos de caché en lote no
  están garantizados.
- Económica: Haiku 5.5, lote y caché de 1 h, 0.22 USD.
  Riesgo: calidad sin medir.

## Decisión (propuesta sintética del libro: cámbiala y fírmala)

- Convocatoria: nocturna, en lote. Un lote expira si no termina en
  24 horas; la mayoría termina en menos de una. Hasta que exista el
  lote, corre como peticiones directas.
- Rechazo a una autora que espera: una petición por vez, sin caché.
- Haiku 5.5 queda en evaluación hasta que sus fichas pasen los
  casos guardados.

Firma: ______________  Fecha: ______________

## Versión fija y migración

- ID fijado: `claude-opus-5-5`, en una sola constante (`MODELO`).
- Retiro: no antes de 2027-09-22
  `[VERIFICAR AL CIERRE]`. La documentación promete al menos 60
  días de aviso.
- Margen propio: empezar a migrar 120 días antes de
  cualquier fecha de retiro (`npm run version-fija`).
- Antes de cambiar el ID: volver a contar tokens con el modelo
  nuevo, leer sus cambios incompatibles, repetir `npm run costos`
  y pasar los casos guardados.
