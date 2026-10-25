import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const CORRELATION_HEADER = 'x-correlation-id';

const VALID_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Obtiene el correlationId del request (o genera uno) y lo devuelve en la respuesta.
 * Se usa como `genReqId` de pino-http, así cada línea de log lo incluye.
 */
export function resolveCorrelationId(req: IncomingMessage, res: ServerResponse): string {
  const header = req.headers[CORRELATION_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  const id = value && VALID_ID.test(value) ? value : randomUUID();
  res.setHeader(CORRELATION_HEADER, id);
  return id;
}

/** Lee el correlationId que pino-http dejó en `req.id`. */
export function correlationIdOf(req: { id?: unknown }): string {
  return typeof req.id === 'string' ? req.id : randomUUID();
}
