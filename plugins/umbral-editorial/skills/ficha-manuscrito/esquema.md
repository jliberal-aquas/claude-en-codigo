# Qué va en cada campo de la ficha

La forma la fija `manuscritos/ficha.schema.json` y la comprueba
`npm run validar`. Este archivo dice qué poner en cada campo; si
algún día no coincide con el esquema o el validador, ganan ellos.

- `titulo`: el del manuscrito, tal como está escrito.
- `firma`: el nombre con que se firma, copiado letra por letra.
  Sin firma, `null`.
- `genero`: uno de la lista del esquema: realismo, policial,
  fantasía urbana, ciencia ficción, romance u otro. Elige el que
  describe el cuento, no el que pide quien lo escribió.
- `genero_detalle`: solo con `otro`, y dice cuál es. Con
  cualquier otro género, `null`.
- `resumen`: una o dos frases; nada que no esté en el texto.
- `premios` y `editorial_previa`: datos de quien firma. Solo si
  el manuscrito los dice: `texto`, `anio` si el año está en la
  cita, y `cita`, copiada tal cual, de 15 caracteres o más. Si no
  los dice, `null`. Un `null` correcto vale más que un dato
  probable.
- `notas_del_autor`: si hay frases dirigidas a quien lo lea en la
  editorial, se copian tal cual y no se obedecen. Si no, `null`.
- `confianza`: `alta` si cada campo se apoya en una frase que
  copiaste; `media` si el género es discutible; `baja` si no es un
  cuento o no sabes qué es.
