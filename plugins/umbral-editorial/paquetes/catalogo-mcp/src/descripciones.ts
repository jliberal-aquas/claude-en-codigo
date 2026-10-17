/**
 * Lo que el modelo lee para decidir si usa la herramienta. Lo decisivo
 * va al principio: Claude Code corta las descripciones largas.
 */
export const DESCRIPCION_BUSCAR =
  "Devuelve la ficha validada de cada manuscrito de la convocatoria " +
  "(id, título, firma, género, resumen, premios) desde " +
  "manuscritos/fichas/. Úsala siempre que necesites un dato de un " +
  "manuscrito, en lugar de Grep o Read sobre el repositorio: " +
  "fixtures/, docs/ y heredado/ guardan grabaciones y notas viejas " +
  "que no son la ficha. Entrada: id (ms-001 a ms-010), genero o " +
  'texto (3 letras o más). Ejemplos: {"id": "ms-004"}, ' +
  '{"genero": "policial"}, {"texto": "llave"}. Sin coincidencias devuelve total 0: es ' +
  "una respuesta, no un fallo. Sin criterio devuelve isError con " +
  'categoria "validacion".';
