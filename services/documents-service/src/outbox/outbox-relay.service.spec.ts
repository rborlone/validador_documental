import { UnroutableMessageError } from '../messaging/amqp.service';
import { OutboxRelayService } from './outbox-relay.service';
import type { PendingOutboxRow } from './outbox';

function row(id: string, exchange = 'documents', attempts = 0): PendingOutboxRow {
  return {
    id,
    type: exchange === 'documents' ? 'doc.validation.requested' : 'doc.status.changed',
    exchange,
    routing_key: exchange === 'documents' ? 'doc.validation.requested' : 'doc.status.changed',
    payload: { id, specversion: '1.0' },
    correlation_id: `corr-${id}`,
    attempts,
  };
}

function setup(rows: PendingOutboxRow[], connected = true) {
  const tx = {
    $queryRaw: jest.fn(async () => rows),
    outboxMessage: { updateMany: jest.fn(async () => ({ count: 0 })), update: jest.fn(async () => ({})) },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const amqp = { isConnected: jest.fn(() => connected), publish: jest.fn(async () => undefined) };
  const config = { get: (k: string) => ({ OUTBOX_BATCH_SIZE: 50, OUTBOX_INTERVAL_MS: 500 })[k] };
  const relay = new OutboxRelayService(prisma as any, amqp as any, config as any);
  return { relay, tx, prisma, amqp };
}

describe('OutboxRelayService', () => {
  it('toma el lote con FOR UPDATE SKIP LOCKED (seguro con varias réplicas)', async () => {
    const { relay, tx } = setup([]);
    await relay.relayBatch();
    const sql = (tx.$queryRaw.mock.calls[0] as any)[0];
    const text: string = sql.sql ?? sql.strings.join('?');
    expect(text).toMatch(/published_at IS NULL/);
    expect(text).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(text).toMatch(/LIMIT/);
    expect(sql.values).toContain(50);
  });

  it('publica cada fila con confirm y marca published_at', async () => {
    const { relay, tx, amqp } = setup([row('a'), row('b', 'notifications')]);
    const n = await relay.relayBatch();

    expect(n).toBe(2);
    expect(amqp.publish).toHaveBeenCalledWith('documents', 'doc.validation.requested', { id: 'a', specversion: '1.0' }, {
      messageId: 'a',
      correlationId: 'corr-a',
      type: 'doc.validation.requested',
      mandatory: true,
    });
    // En el fanout de notificaciones no se exige cola de destino (puede no haber BFF conectado).
    expect((amqp.publish.mock.calls[1] as any)[3].mandatory).toBe(false);
    const update = (tx.outboxMessage.updateMany.mock.calls[0] as any)[0];
    expect(update.where).toEqual({ id: { in: ['a', 'b'] } });
    expect(update.data.publishedAt).toBeInstanceOf(Date);
    expect(tx.outboxMessage.update).not.toHaveBeenCalled();
  });

  it('si una publicación falla deja la fila pendiente, incrementa attempts y aplica backoff', async () => {
    const { relay, tx, amqp } = setup([row('a'), row('b', 'documents', 2)]);
    amqp.publish.mockImplementation((async (_ex: string, _rk: string, _p: unknown, opts: { messageId: string }) => {
      if (opts.messageId === 'b') throw new UnroutableMessageError('documents', 'doc.validation.requested');
    }) as any);

    const before = Date.now();
    const n = await relay.relayBatch();

    expect(n).toBe(1);
    expect((tx.outboxMessage.updateMany.mock.calls[0] as any)[0].where).toEqual({ id: { in: ['a'] } });
    const failed = (tx.outboxMessage.update.mock.calls[0] as any)[0];
    expect(failed.where).toEqual({ id: 'b' });
    expect(failed.data.attempts).toEqual({ increment: 1 });
    expect(failed.data.lastError).toMatch(/sin cola de destino/);
    expect(failed.data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 8000); // 2^3 s
    expect(failed.data).not.toHaveProperty('publishedAt');
  });

  it('no abre transacción si RabbitMQ está desconectado', async () => {
    const { relay, prisma } = setup([row('a')], false);
    expect(await relay.relayBatch()).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
