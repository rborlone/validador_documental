import { get, IncomingMessage } from 'node:http';
import { NotificationsHub } from './notifications.hub';
import { createTestApp } from '../testing/test-app';

/** Cliente SSE mínimo que acumula el texto recibido. */
function connect(url: string, origin?: string): Promise<{ res: IncomingMessage; text: () => string; close: () => void; waitFor: (s: string) => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: origin ? { origin, accept: 'text/event-stream' } : { accept: 'text/event-stream' } }, (res) => {
      let buf = '';
      const waiters: { s: string; r: () => void }[] = [];
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        buf += c;
        for (const w of [...waiters]) if (buf.includes(w.s)) w.r();
      });
      resolve({
        res,
        text: () => buf,
        close: () => req.destroy(),
        waitFor: (s) => (buf.includes(s) ? Promise.resolve() : new Promise((r) => waiters.push({ s, r }))),
      });
    });
    req.on('error', reject);
  });
}

const event = {
  specversion: '1.0',
  id: '44444444-4444-4444-8444-444444444444',
  source: '/documents-service',
  type: 'doc.status.changed',
  time: '2026-10-24T12:00:00.000Z',
  datacontenttype: 'application/json',
  correlationid: 'corr-sse',
  data: {
    documentId: '55555555-5555-4555-8555-555555555555',
    filename: 'factura.pdf',
    status: 'COMPLETED',
    verdict: 'VALID',
    documentType: 'factura_sii',
    updatedAt: '2026-10-24T12:00:00.000Z',
  },
};

describe('SSE /api/events', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let hub: NotificationsHub;

  beforeAll(async () => {
    ctx = await createTestApp('http://127.0.0.1:1');
    hub = ctx.hub;
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('reenvía doc.status.changed como document.updated (solo `data`) a todos los clientes conectados', async () => {
    const a = await connect(`${ctx.baseUrl}/api/events`, 'http://localhost:5173');
    const b = await connect(`${ctx.baseUrl}/api/events`);
    expect(a.res.statusCode).toBe(200);
    expect(a.res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    // CORS sin credenciales para EventSource.
    expect(a.res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(a.res.headers['access-control-allow-credentials']).toBeUndefined();
    await a.waitFor('retry:');
    await b.waitFor('retry:');
    expect(hub.size).toBe(2);

    ctx.amqp.deliver(event);
    const frame = `id: ${event.id}\nevent: document.updated\ndata: ${JSON.stringify(event.data)}\n\n`;
    await a.waitFor(frame);
    await b.waitFor(frame);

    // Mensajes inválidos se descartan sin romper el stream.
    ctx.amqp.deliver({ type: 'otro', data: {} });
    hub.ping();
    await a.waitFor(': ping\n\n');
    expect(a.text().split('event: document.updated').length - 1).toBe(1);

    a.close();
    b.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(hub.size).toBe(0);
  });
});

describe('NotificationsHub', () => {
  it('envía ping a los clientes y desconecta a los lentos', () => {
    const hub = new NotificationsHub({ get: () => 25000 } as any);
    const fast = { write: jest.fn(() => true), end: jest.fn(), writableLength: 0 };
    const slow = { write: jest.fn(() => false), end: jest.fn(), writableLength: 5 * 1024 * 1024 };
    hub.subscribe(fast);
    hub.subscribe(slow);
    hub.ping();
    expect(fast.write).toHaveBeenCalledWith(': ping\n\n');
    expect(slow.end).toHaveBeenCalled();
    expect(hub.size).toBe(1);
  });
});
