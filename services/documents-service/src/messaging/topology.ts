import type { Channel } from 'amqplib';

/** Nombres de la topología RabbitMQ (ver contracts/README.md). */
export const EXCHANGE_DOCUMENTS = 'documents';
export const EXCHANGE_NOTIFICATIONS = 'notifications';
export const QUEUE_RESULTS = 'documents-service.results';

export const RK_VALIDATION_REQUESTED = 'doc.validation.requested';
export const RK_VALIDATION_STARTED = 'doc.validation.started';
export const RK_VALIDATION_COMPLETED = 'doc.validation.completed';
export const RK_VALIDATION_FAILED = 'doc.validation.failed';
export const TYPE_STATUS_CHANGED = 'doc.status.changed';

export const RESULT_ROUTING_KEYS = [RK_VALIDATION_STARTED, RK_VALIDATION_COMPLETED, RK_VALIDATION_FAILED] as const;

/** Declara exchanges (idempotente). Se ejecuta en cada (re)conexión del canal. */
export async function assertExchanges(ch: Channel): Promise<void> {
  await ch.assertExchange(EXCHANGE_DOCUMENTS, 'topic', { durable: true });
  await ch.assertExchange(EXCHANGE_NOTIFICATIONS, 'fanout', { durable: true });
}

/** Declara la cola quorum de resultados y sus bindings (idempotente). */
export async function assertResultsQueue(ch: Channel): Promise<void> {
  await assertExchanges(ch);
  await ch.assertQueue(QUEUE_RESULTS, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  for (const rk of RESULT_ROUTING_KEYS) {
    await ch.bindQueue(QUEUE_RESULTS, EXCHANGE_DOCUMENTS, rk);
  }
}
