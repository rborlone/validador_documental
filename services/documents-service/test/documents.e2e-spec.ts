/**
 * e2e de documents-service con infraestructura real (Testcontainers):
 * Postgres + RabbitMQ + Azurite. Requiere Docker. Se ejecuta aparte: `pnpm test:e2e`.
 */
import type { INestApplication } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer, StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import amqplib from 'amqplib';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import request from 'supertest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PDF_BYTES } from '../src/testing/multipart';

const AZURITE_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Tiempo de espera agotado');
}

describe('documents-service (e2e)', () => {
  let pg: StartedPostgreSqlContainer;
  let rabbit: StartedRabbitMQContainer;
  let azurite: StartedTestContainer;
  let app: INestApplication;
  let conn: amqplib.ChannelModel;
  let ch: amqplib.Channel;
  const requestsQueue = `e2e.requests.${randomUUID()}`;
  const notificationsQueue = `e2e.notifications.${randomUUID()}`;

  beforeAll(async () => {
    [pg, rabbit, azurite] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      new RabbitMQContainer('rabbitmq:4.1-management-alpine').start(),
      new GenericContainer('mcr.microsoft.com/azure-storage/azurite:3.34.0')
        .withCommand(['azurite-blob', '--blobHost', '0.0.0.0', '--skipApiVersionCheck', '--loose'])
        .withExposedPorts(10000)
        .withWaitStrategy(Wait.forListeningPorts())
        .start(),
    ]);
    const databaseUrl = pg.getConnectionUri();
    const rabbitUrl = rabbit.getAmqpUrl();

    execFileSync(join(__dirname, '../node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'ignore',
    });

    // Cola del "validador" de prueba y escucha del fanout de notificaciones.
    conn = await amqplib.connect(rabbitUrl);
    ch = await conn.createChannel();
    await ch.assertExchange('documents', 'topic', { durable: true });
    await ch.assertExchange('notifications', 'fanout', { durable: true });
    await ch.assertQueue(requestsQueue, { durable: false, autoDelete: true });
    await ch.bindQueue(requestsQueue, 'documents', 'doc.validation.requested');
    await ch.assertQueue(notificationsQueue, { exclusive: true });
    await ch.bindQueue(notificationsQueue, 'notifications', '');

    Object.assign(process.env, {
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      RABBITMQ_URL: rabbitUrl,
      AZURE_STORAGE_CONNECTION_STRING: `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${AZURITE_KEY};BlobEndpoint=http://${azurite.getHost()}:${azurite.getMappedPort(10000)}/devstoreaccount1;`,
      BLOB_CONTAINER: 'documents',
      OUTBOX_INTERVAL_MS: '100',
    });
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const { setupApp } = require('../src/setup-app') as typeof import('../src/setup-app');
    const { Test } = require('@nestjs/testing') as typeof import('@nestjs/testing');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await Promise.all([pg?.stop(), rabbit?.stop(), azurite?.stop()]);
  });

  it('sube → encola (outbox) → recibe completed → COMPLETED y notifica', async () => {
    const http = request(app.getHttpServer() as Parameters<typeof request>[0]);
    const upload = await http
      .post('/documents')
      .set('x-correlation-id', 'e2e-corr')
      .field('expectedType', 'factura_sii')
      .attach('files', PDF_BYTES, { filename: 'factura.pdf', contentType: 'text/plain' })
      .expect(202);
    const doc = (upload.body as { documents: { id: string; status: string; contentType: string }[] }).documents[0];
    expect(doc).toMatchObject({ status: 'QUEUED', contentType: 'application/pdf' });

    // El relay publica doc.validation.requested con el contrato esperado.
    const msg = await waitFor(async () => (await ch.get(requestsQueue, { noAck: true })) || undefined);
    const requested = JSON.parse(msg.content.toString()) as { type: string; correlationid: string; data: Record<string, unknown> };
    expect(msg.properties.contentType).toBe('application/cloudevents+json');
    expect(msg.properties.correlationId).toBe('e2e-corr');
    expect(requested).toMatchObject({ type: 'doc.validation.requested', correlationid: 'e2e-corr' });
    expect(requested.data).toMatchObject({ documentId: doc.id, container: 'documents', contentType: 'application/pdf', attempt: 1 });

    // El contenido se puede descargar desde Blob.
    const content = await http.get(`/documents/${doc.id}/content`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(content.status).toBe(200);
    expect((content.body as Buffer).equals(PDF_BYTES)).toBe(true);

    // El validador responde: started y completed (el started repetido después se ignora).
    const publish = (type: string, data: unknown) =>
      ch.publish(
        'documents',
        type,
        Buffer.from(JSON.stringify({ specversion: '1.0', id: randomUUID(), source: '/doc-validator', type, time: new Date().toISOString(), datacontenttype: 'application/json', correlationid: 'e2e-corr', data })),
        { contentType: 'application/cloudevents+json', persistent: true },
      );
    publish('doc.validation.started', { documentId: doc.id, attempt: 1 });
    publish('doc.validation.completed', {
      documentId: doc.id,
      result: { documentId: doc.id, documentType: { value: 'factura_sii', confidence: 0.95, method: 'rules' }, verdict: 'VALID', checks: [] },
    });
    publish('doc.validation.started', { documentId: doc.id, attempt: 1 });

    const detail = await waitFor(async () => {
      const r = await http.get(`/documents/${doc.id}`);
      return (r.body as { status: string }).status === 'COMPLETED' ? (r.body as Record<string, unknown>) : undefined;
    });
    expect(detail).toMatchObject({ verdict: 'VALID', documentType: 'factura_sii', attempts: 1 });

    const statuses: string[] = [];
    await waitFor(async () => {
      const m = await ch.get(notificationsQueue, { noAck: true });
      if (m) statuses.push((JSON.parse(m.content.toString()) as { data: { status: string } }).data.status);
      return statuses.includes('COMPLETED') ? true : undefined;
    });
    // Con prefetch > 1 el completed puede aplicarse antes que el started; en ese caso el started se
    // ignora (el estado nunca retrocede), así que PROCESSING es opcional, pero COMPLETED es el último.
    expect(statuses[0]).toBe('QUEUED');
    expect(statuses.at(-1)).toBe('COMPLETED');
    expect(statuses.filter((s) => s === 'COMPLETED')).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 500));
    const final = await http.get(`/documents/${doc.id}`);
    expect((final.body as { status: string }).status).toBe('COMPLETED');

    const list = await http.get('/documents?limit=5').expect(200);
    expect((list.body as { items: { id: string }[] }).items[0].id).toBe(doc.id);
  });

  it('responde problem+json en errores', async () => {
    const http = request(app.getHttpServer() as Parameters<typeof request>[0]);
    const r = await http.get(`/documents/${randomUUID()}`).expect(404);
    expect(r.headers['content-type']).toContain('application/problem+json');
    await http.post('/documents').attach('files', Buffer.from('hola'), 'a.pdf').expect(415);
    await http.get('/health/ready').expect(200);
  });
});
