import type { ConsumeMessage } from 'amqplib';
import { DocumentStateService } from './document-state.service';
import { ResultsConsumer } from './results.consumer';

const DOC_ID = '22222222-2222-4222-8222-222222222222';

function message(type: string, data: unknown, extra: Record<string, unknown> = {}): ConsumeMessage {
  const body = { specversion: '1.0', id: 'evt-' + Math.random(), source: '/doc-validator', type, time: new Date().toISOString(), datacontenttype: 'application/json', correlationid: 'corr-x', data, ...extra };
  return {
    content: Buffer.from(JSON.stringify(body)),
    fields: { routingKey: type, deliveryTag: 1, redelivered: false, exchange: 'documents', consumerTag: 't' },
    properties: { messageId: body.id, correlationId: 'corr-x', headers: {} },
  } as unknown as ConsumeMessage;
}

/** Base de datos en memoria que imita el SELECT … FOR UPDATE + UPDATE + INSERT en outbox. */
function fakeDb(initial: { status: string; attempts: number }) {
  const doc: any = {
    id: DOC_ID,
    filename: 'f.pdf',
    contentType: 'application/pdf',
    sizeBytes: 10n,
    container: 'documents',
    blobName: 'b',
    expectedType: null,
    documentType: null,
    verdict: null,
    result: null,
    error: null,
    correlationId: 'corr-origen',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...initial,
  };
  const outbox: any[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => [{ status: doc.status, attempts: doc.attempts, correlation_id: doc.correlationId }]),
    document: {
      update: jest.fn(async ({ data }: any) => {
        for (const [k, v] of Object.entries(data)) if (v !== undefined) doc[k] = v;
        doc.updatedAt = new Date();
        return { ...doc };
      }),
    },
    outboxMessage: { create: jest.fn(async ({ data }: any) => outbox.push(data)) },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { doc, outbox, prisma, tx };
}

function consumerWith(db: ReturnType<typeof fakeDb>) {
  const state = new DocumentStateService(db.prisma as any);
  const relay = { kick: jest.fn() };
  const consumer = new ResultsConsumer({} as any, state, relay as any, { get: () => 10 } as any);
  return { consumer, relay };
}

const validResult = {
  documentId: DOC_ID,
  documentType: { value: 'factura_sii', confidence: 0.9, method: 'rules' },
  templateVersion: '1.0.0',
  extracted: {},
  checks: [],
  authenticity: { score: 0.1, level: 'LOW', signals: [] },
  signature: { status: 'NOT_IMPLEMENTED' },
  verdict: 'VALID',
  pages: 1,
  textSource: 'text',
  processingMs: 120,
};

describe('ResultsConsumer', () => {
  it('aplica started → completed, guarda el resultado y publica doc.status.changed vía outbox', async () => {
    const db = fakeDb({ status: 'QUEUED', attempts: 0 });
    const { consumer, relay } = consumerWith(db);

    expect(await consumer.handle(message('doc.validation.started', { documentId: DOC_ID, attempt: 1 }))).toBe('ack');
    expect(db.doc.status).toBe('PROCESSING');
    expect(await consumer.handle(message('doc.validation.completed', { documentId: DOC_ID, result: validResult }))).toBe('ack');

    expect(db.doc).toMatchObject({ status: 'COMPLETED', verdict: 'VALID', documentType: 'factura_sii', attempts: 1 });
    expect(db.doc.result).toEqual(validResult);
    expect(db.outbox).toHaveLength(2);
    expect(db.outbox[1]).toMatchObject({ exchange: 'notifications', type: 'doc.status.changed', correlationId: 'corr-x' });
    expect(db.outbox[1].payload.data).toEqual({
      documentId: DOC_ID,
      filename: 'f.pdf',
      status: 'COMPLETED',
      verdict: 'VALID',
      documentType: 'factura_sii',
      updatedAt: expect.any(String),
    });
    expect(relay.kick).toHaveBeenCalledTimes(2);
  });

  it('no retrocede: un started que llega después de completed se ignora (ack, sin notificación)', async () => {
    const db = fakeDb({ status: 'COMPLETED', attempts: 1 });
    const { consumer } = consumerWith(db);

    expect(await consumer.handle(message('doc.validation.started', { documentId: DOC_ID, attempt: 1 }))).toBe('ack');
    expect(db.doc.status).toBe('COMPLETED');
    expect(db.tx.document.update).not.toHaveBeenCalled();
    expect(db.outbox).toHaveLength(0);
  });

  it('es idempotente ante la reentrega del mismo completed', async () => {
    const db = fakeDb({ status: 'PROCESSING', attempts: 1 });
    const { consumer } = consumerWith(db);
    const msg = message('doc.validation.completed', { documentId: DOC_ID, result: validResult });

    expect(await consumer.handle(msg)).toBe('ack');
    expect(await consumer.handle(msg)).toBe('ack');
    expect(db.tx.document.update).toHaveBeenCalledTimes(1);
    expect(db.outbox).toHaveLength(1);
  });

  it('failed guarda el error y el intento', async () => {
    const db = fakeDb({ status: 'PROCESSING', attempts: 2 });
    const { consumer } = consumerWith(db);
    const error = { code: 'PROCESSING_ERROR', message: 'Tesseract falló' };
    expect(await consumer.handle(message('doc.validation.failed', { documentId: DOC_ID, attempt: 3, error }))).toBe('ack');
    expect(db.doc).toMatchObject({ status: 'FAILED', attempts: 3, error });
  });

  it('descarta (reject) mensajes inválidos', async () => {
    const db = fakeDb({ status: 'QUEUED', attempts: 0 });
    const { consumer } = consumerWith(db);
    expect(await consumer.handle(message('doc.validation.started', { documentId: 'no-uuid', attempt: 1 }))).toBe('reject');
    expect(await consumer.handle({ ...message('x', {}), content: Buffer.from('no json') })).toBe('reject');
    expect(await consumer.handle(message('doc.otro', { documentId: DOC_ID }))).toBe('reject');
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('hace ack si el documento no existe', async () => {
    const db = fakeDb({ status: 'QUEUED', attempts: 0 });
    db.tx.$queryRaw.mockResolvedValueOnce([]);
    const { consumer } = consumerWith(db);
    expect(await consumer.handle(message('doc.validation.started', { documentId: DOC_ID, attempt: 1 }))).toBe('ack');
  });

  it('reencola si la base de datos falla', async () => {
    const db = fakeDb({ status: 'QUEUED', attempts: 0 });
    db.prisma.$transaction.mockRejectedValueOnce(new Error('conexión rechazada'));
    const { consumer } = consumerWith(db);
    expect(await consumer.handle(message('doc.validation.started', { documentId: DOC_ID, attempt: 1 }))).toBe('requeue');
  });
});
