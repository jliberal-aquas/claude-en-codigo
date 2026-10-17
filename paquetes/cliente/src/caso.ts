import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { cargarPlantilla } from "./armar-peticion.js";
import { clasificar } from "./clasificar.js";
import { crearCliente } from "./crear-cliente.js";

/**
 * Corre un caso guardado (`casos/ms-007.json`) contra una versión de
 * la instrucción. Uso: npm run caso -- v2 [--sin-nota]
 * Con grabaciones, la respuesta es la foto que elegiste con
 * CLAUDE_GRABACION: el caso prueba al corredor, no a Claude. Con
 * CLAUDE_MODO=real, cada ejecución es una muestra nueva.
 */
interface Caso {
  manuscrito: string;
  marca_de_la_nota: string;
  fragmento_de_la_nota: string;
  genero_esperado: string;
  por_que: string;
}

/** Espacios y saltos de línea cuentan igual al buscar un fragmento. */
const plano = (s: string) => s.replace(/\s+/g, " ").trim();

/** Quita el párrafo que empieza con la marca de la nota del autor. */
function quitarNota(texto: string, marca: string): string {
  return texto
    .split(/\n\s*\n/)
    .filter((parrafo) => !parrafo.trimStart().startsWith(marca))
    .join("\n\n");
}

const corta = (s: string) => (s.length > 48 ? `${s.slice(0, 48)}…` : s);

/** Corre el caso y devuelve las líneas a imprimir y si pasó. */
export async function correrCaso(
  id: string,
  version: string,
  sinNota: boolean,
): Promise<{ lineas: string[]; paso: boolean }> {
  const caso = JSON.parse(
    await readFile(`paquetes/cliente/casos/${id}.json`, "utf8"),
  ) as Caso;
  let manuscrito = await readFile(caso.manuscrito, "utf8");
  if (sinNota) {
    manuscrito = quitarNota(manuscrito, caso.marca_de_la_nota);
  }

  const plantilla = await cargarPlantilla(`clasificar.${version}`);
  const cliente = crearCliente({ grabacion: id });
  const r = await clasificar(cliente, plantilla, manuscrito);

  const enviado = plano(String(r.peticion.messages[0]?.content));
  const hayNota = enviado.includes(plano(caso.fragmento_de_la_nota));
  const lineas = [
    `caso ${id} · ${plantilla.version} · nota en la petición: ` +
      (hayNota ? "sí" : "no"),
    `género devuelto: ${r.genero}`,
  ];
  if (r.notas !== undefined) {
    lineas.push(`notas_del_autor: ${corta(r.notas)}`);
  }

  const fallas: string[] = [];
  if (r.genero !== caso.genero_esperado) {
    fallas.push(`esperaba «${caso.genero_esperado}»`);
  }
  // Si respondió un JSON y la nota viajó, debe quedar registrada.
  if (hayNota && r.notas !== undefined) {
    const buscada = plano(caso.fragmento_de_la_nota);
    if (!plano(r.notas).includes(buscada)) {
      fallas.push("la nota no quedó en notas_del_autor");
    }
  }
  const paso = fallas.length === 0;
  lineas.push(paso ? "ok" : `FALLA ${fallas.join("; ")}`);
  return { lineas, paso };
}

const directo =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (directo) {
  try {
    const [version = "v2", ...banderas] = process.argv.slice(2);
    const r = await correrCaso(
      "ms-007",
      version,
      banderas.includes("--sin-nota"),
    );
    console.log(r.lineas.join("\n"));
    process.exitCode = r.paso ? 0 : 1;
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
