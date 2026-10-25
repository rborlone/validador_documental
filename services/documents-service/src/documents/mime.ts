import type { AllowedContentType } from './document.types';

/** Bytes necesarios para identificar los formatos soportados. */
export const SNIFF_BYTES = 1024;

/**
 * Detecta el MIME real por magic bytes. No se confía en el content-type que envía el cliente.
 * Solo reconoce los formatos permitidos (PDF, PNG, JPEG, TIFF); cualquier otro devuelve null.
 * Se implementa aquí (sin `file-type`) porque ese paquete es solo ESM y el servicio compila a CommonJS.
 */
export function detectMime(head: Buffer): AllowedContentType | null {
  // PDF: "%PDF-". Como los lectores de PDF, se tolera basura antes del encabezado dentro del primer KB.
  if (head.subarray(0, SNIFF_BYTES).indexOf('%PDF-') >= 0) return 'application/pdf';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 4) {
    const le = head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00; // "II*\0"
    const be = head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a; // "MM\0*"
    if (le || be) return 'image/tiff';
  }
  return null;
}
