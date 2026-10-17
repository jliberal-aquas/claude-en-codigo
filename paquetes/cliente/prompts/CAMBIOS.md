# Cambios de la instrucción de clasificar

## clasificar.v3

- Por qué: con ms-009, una ficha que pedía "datos de la autora" trajo
  un premio que el cuento no menciona (grabación a).
- Qué cambia: la salida es una ficha, no un JSON; cada hecho lleva una
  cita copiada del manuscrito; "no consta" es una respuesta válida; los
  tres ejemplos pasan a ser fichas con cita.
- Cómo se comprueba: npm run verificar -- manuscritos/entrada/ms-009.md
  y npm test.

## clasificar.v2

- Por qué: con ms-007, la v1 devolvía el género que decía la nota del
  autor (casos/ms-007.json).
- Qué cambia: instrucción de sistema con criterios de éxito, regla del
  dato y restricción de salida; tres ejemplos de géneros distintos; el
  manuscrito entre etiquetas; el campo notas_del_autor.
- Cómo se comprueba: npm run caso -- v2, y la v1 debe fallar.

## clasificar.v1

- La instrucción de la fundadora, con el manuscrito pegado a
  continuación.
