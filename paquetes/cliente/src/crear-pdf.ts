import { mkdir, writeFile } from "node:fs/promises";

/**
 * Escribe un PDF mínimo y SINTÉTICO de una página: sirve para probar
 * cómo se arma el bloque de documento, no es un manuscrito real. Un
 * PDF es una lista de objetos numerados más una tabla (`xref`) con la
 * posición de cada uno; por eso se calculan las posiciones al armarlo.
 */
function armarPdf(lineas: string[]): Buffer {
  const texto = lineas
    .map((l, i) => `${i === 0 ? "" : "0 -22 Td "}(${l}) Tj`)
    .join("\n");
  const contenido = `BT /F1 14 Tf 24 150 Td\n${texto}\nET`;
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 200] " +
      "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${contenido.length} >>\nstream\n` +
      `${contenido}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const posiciones: number[] = [];
  objetos.forEach((o, i) => {
    posiciones.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const pos of posiciones) {
    pdf += `${String(pos).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export const RUTA_PDF = "manuscritos/entrada/ms-011.pdf";

if (process.argv[1]?.endsWith("crear-pdf.ts")) {
  await mkdir("manuscritos/entrada", { recursive: true });
  const pdf = armarPdf([
    "Manuscrito sintetico ms-011",
    "Una pagina de prueba para la convocatoria.",
    "Todo lo que dice este PDF es inventado.",
  ]);
  await writeFile(RUTA_PDF, pdf);
  console.log(`${RUTA_PDF}: ${pdf.length} bytes`);
}
