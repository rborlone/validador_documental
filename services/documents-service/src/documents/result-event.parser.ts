import { z } from 'zod';
import { RK_VALIDATION_COMPLETED, RK_VALIDATION_FAILED, RK_VALIDATION_STARTED } from '../messaging/topology';
import type { ResultEvent } from './status-transition';

const envelope = z.object({
  specversion: z.literal('1.0'),
  id: z.string().min(1),
  type: z.string(),
  correlationid: z.string().optional(),
  data: z.unknown(),
});

const startedData = z.object({ documentId: z.uuid(), attempt: z.number().int().min(1) });
const completedData = z.object({
  documentId: z.uuid(),
  result: z
    .object({
      documentType: z.object({ value: z.string() }).loose().optional(),
      verdict: z.enum(['VALID', 'INVALID', 'REVIEW']).optional(),
    })
    .loose(),
});
const failedData = z.object({
  documentId: z.uuid(),
  attempt: z.number().int().min(1),
  error: z.object({ code: z.string(), message: z.string() }),
});

export interface ParsedResultMessage {
  eventId: string;
  correlationId: string | null;
  event: ResultEvent;
}

export class InvalidMessageError extends Error {}

/** Valida y normaliza un CloudEvent de resultado del doc-validator (contracts/events). */
export function parseResultMessage(content: Buffer, fallbackCorrelationId?: string): ParsedResultMessage {
  let json: unknown;
  try {
    json = JSON.parse(content.toString('utf8'));
  } catch {
    throw new InvalidMessageError('El mensaje no es JSON válido');
  }
  const env = envelope.safeParse(json);
  if (!env.success) throw new InvalidMessageError(`Sobre CloudEvent inválido: ${env.error.message}`);
  const { id, type, data } = env.data;
  const correlationId = env.data.correlationid ?? fallbackCorrelationId ?? null;

  const fail = (err: z.ZodError): never => {
    throw new InvalidMessageError(`data inválida para ${type}: ${err.message}`);
  };

  switch (type) {
    case RK_VALIDATION_STARTED: {
      const d = startedData.safeParse(data);
      if (!d.success) return fail(d.error);
      return { eventId: id, correlationId, event: { kind: 'started', ...d.data } };
    }
    case RK_VALIDATION_COMPLETED: {
      const d = completedData.safeParse(data);
      if (!d.success) return fail(d.error);
      const result = d.data.result as Record<string, unknown>;
      return {
        eventId: id,
        correlationId,
        event: {
          kind: 'completed',
          documentId: d.data.documentId,
          result,
          verdict: d.data.result.verdict ?? null,
          documentType: d.data.result.documentType?.value ?? null,
        },
      };
    }
    case RK_VALIDATION_FAILED: {
      const d = failedData.safeParse(data);
      if (!d.success) return fail(d.error);
      return { eventId: id, correlationId, event: { kind: 'failed', ...d.data } };
    }
    default:
      throw new InvalidMessageError(`Tipo de evento no soportado: ${type}`);
  }
}
