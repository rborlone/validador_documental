import { Prisma } from '@prisma/client';
import type { CloudEvent } from '../messaging/cloud-event';

/** Fila nueva del outbox a partir de un CloudEvent. Se inserta en la misma transacción que el cambio de datos. */
export function outboxRow<T>(event: CloudEvent<T>, exchange: string, routingKey: string): Prisma.OutboxMessageCreateManyInput {
  return {
    id: event.id,
    type: event.type,
    exchange,
    routingKey,
    payload: event as unknown as Prisma.InputJsonValue,
    correlationId: event.correlationid,
  };
}

/** Fila pendiente tal como la devuelve el SELECT … FOR UPDATE SKIP LOCKED. */
export interface PendingOutboxRow {
  id: string;
  type: string;
  exchange: string;
  routing_key: string;
  payload: unknown;
  correlation_id: string | null;
  attempts: number;
}

/** Espera exponencial antes de reintentar una publicación fallida (máx. 30 s). */
export function backoffSeconds(attempts: number): number {
  return Math.min(30, 2 ** Math.min(attempts, 5));
}
