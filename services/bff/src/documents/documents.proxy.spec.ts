import { once } from 'node:events';
import { createServer, IncomingMessage, request as httpRequest, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { request } from 'undici';
import { createTestApp } from '../testing/test-app';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** documents-service falso: registra lo que recibe y responde según `handler`. */
async function fakeUpstream(handler: Handler): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const DOC_ID = '33333333-3333-4333-8333-333333333333';

describe('BFF → documents-service (proxy)', () => {
  let handler: Handler;
  let upstream: { server: Server; url: string };
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    upstream = await fakeUpstream((req, res) => handler(req, res));
    ctx = await createTestApp(upstream.url);
  });

  afterAll(async () => {
    await ctx.app.close();
    upstream.server.close();
  });

  it('reenvía el multipart en streaming (el upstream recibe bytes antes de que el cliente termine)', async () => {
    const boundary = '----bffprueba';
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\n`);
    const tail = Buffer.from(`${'x'.repeat(5000)}\r\n--${boundary}--\r\n`);
    const full = Buffer.concat([head, tail]);

    let firstChunk!: () => void;
    const upstreamGotFirstChunk = new Promise<void>((r) => (firstChunk = r));
    let received: Buffer = Buffer.alloc(0);
    let seenHeaders: IncomingMessage['headers'] = {};
    handler = (req, res) => {
      seenHeaders = req.headers;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        if (chunks.length === 0) firstChunk();
        chunks.push(c);
      });
      req.on('end', () => {
        received = Buffer.concat(chunks);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ documents: [{ id: DOC_ID, status: 'QUEUED' }] }));
      });
    };

    const body = new PassThrough();
    const pending = request(`${ctx.baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(full.length), 'x-correlation-id': 'corr-123' },
      body,
    });
    body.write(head);
    // Solo se envía el resto cuando el upstream ya recibió la primera parte: prueba que no se acumula.
    await upstreamGotFirstChunk;
    body.end(tail);
    const res = await pending;

    expect(res.statusCode).toBe(202);
    expect(await res.body.json()).toEqual({ documents: [{ id: DOC_ID, status: 'QUEUED' }] });
    expect(received.equals(full)).toBe(true);
    expect(seenHeaders['content-type']).toBe(`multipart/form-data; boundary=${boundary}`);
    expect(seenHeaders['x-correlation-id']).toBe('corr-123');
    expect(res.headers['x-correlation-id']).toBe('corr-123');
  });

  it('genera x-correlation-id si no viene y lo propaga', async () => {
    let seen: string | undefined;
    handler = (req, res) => {
      seen = req.headers['x-correlation-id'] as string;
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"items":[]}');
    };
    const res = await request(`${ctx.baseUrl}/api/documents?limit=5`);
    expect(res.statusCode).toBe(200);
    await res.body.dump();
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-correlation-id']).toBe(seen);
  });

  it('rechaza con 413 por content-length sin contactar al upstream', async () => {
    let called = false;
    handler = (_req, res) => {
      called = true;
      res.end();
    };
    // Cliente HTTP crudo: declara 10 MB pero solo envía unos bytes; el BFF debe responder sin esperar el cuerpo.
    const { status, contentType } = await new Promise<{ status?: number; contentType?: string }>((resolve, reject) => {
      const req = httpRequest(`${ctx.baseUrl}/api/documents`, {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(10 * 1024 * 1024) },
      });
      req.on('response', (r) => {
        r.resume();
        resolve({ status: r.statusCode, contentType: r.headers['content-type'] });
        req.destroy();
      });
      req.on('error', reject);
      req.write('--x\r\n');
    });
    expect(status).toBe(413);
    expect(contentType).toContain('application/problem+json');
    expect(called).toBe(false);
  });

  it('corta con 413 una subida sin content-length que supera el máximo (chunked)', async () => {
    let upstreamBytes = 0;
    handler = (req, res) => {
      req.on('data', (c: Buffer) => (upstreamBytes += c.length));
      req.on('error', () => res.destroy());
      req.on('end', () => res.writeHead(202).end('{}'));
    };
    const body = new PassThrough();
    const pending = request(`${ctx.baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body,
    });
    const chunk = Buffer.alloc(256 * 1024, 0x61);
    let sent = 0;
    // Límite de la prueba: 2 archivos × 1 MB + 1 MB.
    while (sent < 4 * 1024 * 1024) {
      if (!body.write(chunk)) await once(body, 'drain').catch(() => undefined);
      sent += chunk.length;
      if (body.destroyed) break;
    }
    body.end();
    const res = await pending.catch((e: Error) => e);
    // El BFF responde 413 y cierra la conexión; según el momento, el cliente ve el 413 o un EPIPE/ECONNRESET.
    if ('statusCode' in res) {
      expect(res.statusCode).toBe(413);
      await res.body.dump();
    } else {
      expect(['EPIPE', 'ECONNRESET', 'UND_ERR_SOCKET']).toContain((res as NodeJS.ErrnoException).code);
    }
    // Lo importante: el upstream nunca recibió el cuerpo completo.
    expect(upstreamBytes).toBeLessThan(sent);
  });

  it('rechaza con 415 un cuerpo que no es multipart', async () => {
    const res = await request(`${ctx.baseUrl}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.statusCode).toBe(415);
    expect(await res.body.json()).toMatchObject({ status: 415, title: 'Tipo de contenido no soportado' });
  });

  it('reintenta los GET ante 503 y devuelve el 404 del upstream tal cual (problem+json)', async () => {
    let calls = 0;
    handler = (_req, res) => {
      calls++;
      if (calls === 1) return void res.writeHead(503).end();
      res.writeHead(404, { 'content-type': 'application/problem+json' }).end(JSON.stringify({ type: 'about:blank', title: 'No encontrado', status: 404, detail: 'No existe' }));
    };
    const res = await request(`${ctx.baseUrl}/api/documents/${DOC_ID}`);
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(await res.body.json()).toMatchObject({ status: 404 });
    expect(calls).toBe(2);
  });

  it('no reintenta el POST', async () => {
    let calls = 0;
    handler = (req, res) => {
      calls++;
      req.resume();
      req.on('end', () => res.writeHead(503, { 'content-type': 'application/problem+json' }).end('{"status":503}'));
    };
    const res = await request(`${ctx.baseUrl}/api/documents`, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: '--x--\r\n' });
    expect(res.statusCode).toBe(503);
    await res.body.dump();
    expect(calls).toBe(1);
  });

  it('responde 502 si documents-service no está disponible', async () => {
    const down = await createTestApp('http://127.0.0.1:1', { UPSTREAM_RETRIES: '0' });
    try {
      const res = await request(`${down.baseUrl}/api/documents`);
      expect(res.statusCode).toBe(502);
      expect(await res.body.json()).toMatchObject({ status: 502 });
    } finally {
      await down.app.close();
    }
  });

  it('/content se puede embeber en iframe desde CORS_ORIGIN y se sirve inline con su content-type', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': '9', 'content-disposition': `inline; filename="factura.pdf"` });
      res.end('%PDF-1.7\n');
    };
    const res = await request(`${ctx.baseUrl}/api/documents/${DOC_ID}/content`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline; filename="factura.pdf"');
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self' http://localhost:5173");
    expect(await res.body.text()).toBe('%PDF-1.7\n');

    // El resto de las rutas conserva la protección de helmet.
    const other = await request(`${ctx.baseUrl}/api/document-types`);
    expect(other.headers['x-frame-options']).toBe('SAMEORIGIN');
    await other.body.dump();
  });

  it('lista los tipos de documento con etiquetas en español', async () => {
    const res = await request(`${ctx.baseUrl}/api/document-types`);
    const body = (await res.body.json()) as { items: { id: string; label: string }[] };
    expect(body.items.map((i) => i.id)).toEqual([
      'factura_sii', 'orden_compra', 'certificado_vigencia', 'cedula_identidad', 'contrato',
      'certificado_accidentabilidad', 'carpeta_tributaria', 'certificado_f30',
    ]);
    expect(body.items[0].label).toBe('Factura electrónica SII');
  });

  it('las probes viven fuera del prefijo /api', async () => {
    const res = await request(`${ctx.baseUrl}/health/ready`);
    expect(res.statusCode).toBe(200);
    expect(await res.body.json()).toMatchObject({ status: 'ok' });
  });
});
