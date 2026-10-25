import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NotificationsHub } from '../notifications/notifications.hub';

/** AmqpService falso: guarda el handler para simular mensajes del fanout. */
export class FakeAmqp {
  handler: ((msg: { content: Buffer }) => void) | null = null;
  isConnected = (): boolean => true;
  consume(_name: string, _prefetch: number, _declare: unknown, handler: (msg: { content: Buffer }) => void): void {
    this.handler = handler;
  }
  deliver(payload: unknown): void {
    this.handler?.({ content: Buffer.from(JSON.stringify(payload)) });
  }
}

/** Levanta el BFF real (sin RabbitMQ) apuntando a `documentsUrl`. */
export async function createTestApp(documentsUrl: string, extraEnv: Record<string, string> = {}) {
  Object.assign(process.env, {
    LOG_LEVEL: 'silent',
    DOCUMENTS_SERVICE_URL: documentsUrl,
    RABBITMQ_URL: 'amqp://invalido:5672',
    CORS_ORIGIN: 'http://localhost:5173',
    MAX_FILE_SIZE_MB: '1',
    MAX_FILES: '2',
    UPSTREAM_RETRIES: '2',
    ...extraEnv,
  });
  // Import dinámico y módulos frescos: ConfigModule valida el entorno al importar AppModule.
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { AppModule } = require('../app.module') as typeof import('../app.module');
  const { AmqpService } = require('../messaging/amqp.service') as typeof import('../messaging/amqp.service');
  const { setupApp } = require('../setup-app') as typeof import('../setup-app');
  const { Test } = require('@nestjs/testing') as typeof import('@nestjs/testing');
  const hubModule = require('../notifications/notifications.hub') as typeof import('../notifications/notifications.hub');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const amqp = new FakeAmqp();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AmqpService)
    .useValue(amqp)
    .compile();
  const app: INestApplication = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as Server;
  const port = (server.address() as AddressInfo).port;
  const hub: NotificationsHub = app.get(hubModule.NotificationsHub);
  return { app, amqp, hub, baseUrl: `http://127.0.0.1:${port}` };
}
