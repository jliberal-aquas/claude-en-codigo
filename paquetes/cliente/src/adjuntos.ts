import type Anthropic from "@anthropic-ai/sdk";
import { MODELO } from "./llamar.js";

/**
 * Tamaño máximo de una petición: 32 MB `[VERIFICAR AL CIERRE]`. Cuenta
 * el cuerpo ya codificado, no el archivo, y el base64 pesa un tercio
 * más que los bytes originales.
 */
export const LIMITE_PETICION_BYTES = 32 * 1024 * 1024;

/** Un PDF como bloque `document`, con sus bytes en base64. */
export function bloqueDocumento(
  pdf: Buffer,
): Anthropic.DocumentBlockParam {
  const data = pdf.toString("base64");
  if (data.length > LIMITE_PETICION_BYTES) {
    throw new Error(
      `El PDF codificado pesa ${data.length} bytes y la petición ` +
        `admite ${LIMITE_PETICION_BYTES}.`,
    );
  }
  return {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data },
  };
}

/** Una imagen como bloque `image`; el tipo se declara a mano. */
export function bloqueImagen(
  bytes: Buffer,
  tipo: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: tipo,
      data: bytes.toString("base64"),
    },
  };
}

/** Tokens de una imagen: parches de 28 x 28 px, hacia arriba. */
export function tokensDeImagen(ancho: number, alto: number): number {
  return Math.ceil(ancho / 28) * Math.ceil(alto / 28);
}

/** La petición completa: el documento primero, la pregunta después. */
export function peticionConPdf(
  pdf: Buffer,
  pregunta: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODELO,
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: [
          bloqueDocumento(pdf),
          { type: "text", text: pregunta },
        ],
      },
    ],
  };
}
