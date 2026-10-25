import { Readable } from 'node:stream';

export interface Part {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer | string;
}

/** Construye un cuerpo multipart/form-data para pruebas. */
export function buildMultipart(parts: Part[], boundary = '----prueba' + Math.random().toString(16).slice(2)) {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) head += `; filename="${p.filename}"`;
    head += '\r\n';
    if (p.contentType) head += `Content-Type: ${p.contentType}\r\n`;
    head += '\r\n';
    chunks.push(Buffer.from(head), Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Request falso (stream legible con cabeceras), entregado en trozos pequeños para simular la red. */
export function fakeRequest(body: Buffer, contentType: string, chunkSize = 7000) {
  const pieces: Buffer[] = [];
  for (let i = 0; i < body.length; i += chunkSize) pieces.push(body.subarray(i, i + chunkSize));
  const req = Readable.from(pieces) as Readable & { headers: Record<string, string> };
  req.headers = { 'content-type': contentType, 'content-length': String(body.length) };
  return req;
}

export const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n'), Buffer.alloc(3000, 0x20), Buffer.from('\n%%EOF\n')]);
export const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 1)]);
