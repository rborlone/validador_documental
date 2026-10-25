// Servidor mock mínimo (sin dependencias) que implementa la API del BFF descrita en contracts/http.md.
// Simula la transición QUEUED → PROCESSING → COMPLETED/FAILED y la notifica por SSE (`document.updated`).
//
// Palabras en el nombre del archivo que cambian el resultado simulado:
//   "error" → FAILED · "alterada" → totales inválidos · "vencido" → certificado vencido
//   "editado" → riesgo de autenticidad MEDIUM · "certificado" → certificado vigente
//   "orden"/"oc" → orden de compra · cualquier otro nombre que no sea factura → tipo desconocido (IA)
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const MAX_FILES = 10;
const MAX_SIZE = 20 * 1024 * 1024;
const ACCEPTED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/tiff']);

const facturaFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/test/fixtures/result.factura.json', import.meta.url)), 'utf8'),
);

const DOCUMENT_TYPES = [
  { id: 'factura_sii', label: 'Factura electrónica SII' },
  { id: 'orden_compra', label: 'Orden de compra' },
  { id: 'certificado_vigencia', label: 'Certificado de vigencia' },
  { id: 'cedula_identidad', label: 'Cédula de identidad' },
  { id: 'contrato', label: 'Contrato' },
  { id: 'certificado_accidentabilidad', label: 'Certificado de accidentabilidad' },
  { id: 'carpeta_tributaria', label: 'Carpeta tributaria SII' },
  { id: 'certificado_f30', label: 'Certificado F30 / F30-1' },
];

/** @type {Map<string, any>} */
const documents = new Map();
/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();

const now = () => new Date().toISOString();
const clone = (v) => structuredClone(v);

function summary(doc) {
  const { id, filename, contentType, sizeBytes, status, expectedType, createdAt, updatedAt, result } = doc;
  return {
    id,
    filename,
    contentType,
    sizeBytes,
    status,
    expectedType,
    documentType: result?.documentType.value ?? null,
    verdict: result?.verdict ?? null,
    createdAt,
    updatedAt,
  };
}

function detail(doc) {
  return { ...summary(doc), attempts: doc.attempts, result: doc.result, error: doc.error };
}

function broadcast(doc) {
  const data = {
    documentId: doc.id,
    filename: doc.filename,
    status: doc.status,
    verdict: doc.result?.verdict ?? null,
    documentType: doc.result?.documentType.value ?? null,
    updatedAt: doc.updatedAt,
  };
  const payload = `event: document.updated\nid: ${randomUUID()}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

function buildResult(doc) {
  const name = doc.filename.toLowerCase();
  const r = clone(facturaFixture);
  r.documentId = doc.id;
  r.processingMs = 1500 + Math.floor(Math.random() * 4000);
  r.textSource = doc.contentType === 'application/pdf' ? 'text' : 'ocr';
  if (r.textSource === 'ocr') for (const f of Object.values(r.extracted)) if (f.source === 'text') f.source = 'ocr';

  if (name.includes('alterada')) {
    r.extracted.monto_total.value = 1587500;
    const total = r.checks.find((c) => c.id === 'totals.total');
    total.passed = false;
    total.detail = 'Neto + IVA + exento = 1.487.500 ≠ total 1.587.500.';
    r.verdict = 'INVALID';
  } else if (name.includes('certificado') || name.includes('vencido')) {
    const expired = name.includes('vencido');
    r.documentType = { value: 'certificado_vigencia', confidence: 0.89, method: 'rules', reason: null };
    r.extracted = {
      rut_titular: { value: '76.123.456-0', source: r.textSource, confidence: 0.95 },
      emisor: { value: 'Conservador de Bienes Raíces', source: r.textSource, confidence: 0.9 },
      fecha_emision: { value: expired ? '2025-06-01' : '2026-09-30', source: r.textSource, confidence: 0.93 },
      validez_dias: { value: 60, source: 'llm', confidence: 0.7 },
    };
    r.checks = [
      { id: 'rut.titular', passed: true, severity: 'error', detail: 'RUT válido.' },
      {
        id: 'vigencia',
        passed: !expired,
        severity: 'error',
        detail: expired ? 'Venció el 2025-07-31 (emisión + 60 días).' : 'Vigente hasta el 2026-11-29.',
      },
    ];
    r.verdict = expired ? 'INVALID' : 'VALID';
  } else if (name.includes('orden') || /\boc\b/.test(name)) {
    r.documentType = { value: 'orden_compra', confidence: 0.86, method: 'rules', reason: null };
  } else if (!name.includes('factura')) {
    r.documentType = {
      value: 'desconocido',
      confidence: 0.41,
      method: 'llm',
      reason: 'El documento no coincide con ningún template conocido.',
    };
    r.templateVersion = null;
    r.extracted = {};
    r.checks = [];
    r.verdict = 'REVIEW';
  }

  if (doc.expectedType && r.documentType.value === doc.expectedType) r.documentType.method = 'expected';

  if (name.includes('editado')) {
    r.authenticity = {
      score: 0.58,
      level: 'MEDIUM',
      signals: [
        { id: 'pdf.moddate_mismatch', weight: 0.25, detail: 'ModDate posterior a CreationDate en 3 días.' },
        { id: 'pdf.incremental_updates', weight: 0.2, detail: 'El PDF tiene 2 actualizaciones incrementales.' },
        { id: 'pdf.font_mix_amounts', weight: 0.13, detail: 'Mezcla de fuentes en la zona de montos.' },
      ],
    };
    if (r.verdict === 'VALID') r.verdict = 'REVIEW';
  }
  return r;
}

function setStatus(doc, status) {
  doc.status = status;
  doc.updatedAt = now();
  broadcast(doc);
}

function simulate(doc) {
  const jitter = () => Math.floor(Math.random() * 1500);
  setTimeout(() => {
    doc.attempts = 1;
    setStatus(doc, 'PROCESSING');
    setTimeout(() => {
      if (doc.filename.toLowerCase().includes('error')) {
        doc.attempts = 3;
        doc.error = { code: 'OCR_FAILED', message: 'No se pudo extraer texto del documento tras 3 intentos.' };
        setStatus(doc, 'FAILED');
        return;
      }
      doc.result = buildResult(doc);
      setStatus(doc, 'COMPLETED');
    }, 2500 + jitter());
  }, 1200 + jitter());
}

function send(res, status, body, headers = {}) {
  const isProblem = status >= 400;
  res.writeHead(status, {
    'content-type': isProblem ? 'application/problem+json' : 'application/json',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

const problem = (res, status, title, detail) =>
  send(res, status, { type: 'about:blank', title, status, detail });

async function handleUpload(req, res) {
  const request = new Request(`http://localhost${req.url}`, {
    method: 'POST',
    headers: req.headers,
    body: Readable.toWeb(req),
    duplex: 'half',
  });
  let form;
  try {
    form = await request.formData();
  } catch {
    return problem(res, 400, 'Solicitud inválida', 'Se esperaba multipart/form-data.');
  }
  const files = form.getAll('files').filter((f) => typeof f === 'object');
  const expectedType = form.get('expectedType') || null;
  if (files.length === 0) return problem(res, 400, 'Solicitud inválida', 'Debes adjuntar al menos un archivo.');
  if (files.length > MAX_FILES) return problem(res, 400, 'Demasiados archivos', `Máximo ${MAX_FILES} archivos.`);
  for (const f of files) {
    if (f.size > MAX_SIZE) return problem(res, 413, 'Archivo demasiado grande', `${f.name} supera 20 MB.`);
    if (!ACCEPTED.has(f.type)) return problem(res, 415, 'Formato no admitido', `${f.name}: ${f.type || 'desconocido'}.`);
  }
  const created = [];
  for (const f of files) {
    const ts = now();
    const doc = {
      id: randomUUID(),
      filename: f.name,
      contentType: f.type,
      sizeBytes: f.size,
      status: 'QUEUED',
      expectedType,
      createdAt: ts,
      updatedAt: ts,
      attempts: 0,
      result: null,
      error: null,
      content: Buffer.from(await f.arrayBuffer()),
    };
    documents.set(doc.id, doc);
    created.push(summary(doc));
    broadcast(doc);
    simulate(doc);
  }
  send(res, 202, { documents: created });
}

const server = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
  res.setHeader('access-control-allow-headers', 'content-type, accept, x-correlation-id');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('x-correlation-id', req.headers['x-correlation-id'] ?? randomUUID());
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();

  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const docMatch = /^\/api\/documents\/([\w-]+)(\/content)?$/.exec(path);

  if (req.method === 'GET' && (path === '/health/live' || path === '/health/ready')) return send(res, 200, { status: 'ok' });

  if (req.method === 'GET' && path === '/api/document-types') return send(res, 200, { items: DOCUMENT_TYPES });

  if (path === '/api/documents' && req.method === 'POST') {
    return void handleUpload(req, res).catch((err) => problem(res, 500, 'Error interno', String(err)));
  }

  if (path === '/api/documents' && req.method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200);
    const items = [...documents.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(summary);
    return send(res, 200, { items });
  }

  if (docMatch && req.method === 'GET') {
    const doc = documents.get(docMatch[1]);
    if (!doc) return problem(res, 404, 'No encontrado', 'El documento no existe.');
    if (docMatch[2]) {
      res.writeHead(200, {
        'content-type': doc.contentType,
        'content-length': doc.content.length,
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      });
      return void res.end(doc.content);
    }
    return send(res, 200, detail(doc));
  }

  if (req.method === 'GET' && path === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.write('retry: 3000\n: conectado\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  problem(res, 404, 'No encontrado', `${req.method} ${path}`);
});

server.listen(PORT, () => {
  console.log(`[mock] API del BFF simulada en http://localhost:${PORT}`);
});

export { server };
