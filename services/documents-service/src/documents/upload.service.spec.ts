import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { buildMultipart, fakeRequest, PDF_BYTES, PNG_BYTES } from '../testing/multipart';
import { UploadService } from './upload.service';

function setup(maxMb = 1) {
  const uploaded = new Map<string, { data: Buffer; contentType: string }>();
  const blob = {
    containerName: 'documents',
    upload: jest.fn(async (name: string, body: Readable, contentType: string) => {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(c as Buffer);
      uploaded.set(name, { data: Buffer.concat(chunks), contentType });
    }),
    deleteQuietly: jest.fn(async (name: string) => {
      uploaded.delete(name);
    }),
  };
  const tx = {
    document: { create: jest.fn(async ({ data }: any) => ({ ...data, result: null, error: null, verdict: null, documentType: null, attempts: 0, createdAt: new Date(), updatedAt: new Date() })) },
    outboxMessage: { createMany: jest.fn(async () => ({ count: 0 })) },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const relay = { kick: jest.fn() };
  const config = {
    get: (k: string) => ({ MAX_FILES: 3 })[k],
    maxFileSizeBytes: Math.floor(maxMb * 1024 * 1024),
  };
  const service = new UploadService(prisma as any, blob as any, relay as any, config as any);
  return { service, blob, uploaded, tx, prisma, relay };
}

describe('UploadService', () => {
  it('sube cada archivo con el MIME detectado por magic bytes e inserta documentos + outbox en una transacción', async () => {
    const { service, uploaded, tx, prisma, relay } = setup();
    // El cliente miente sobre los content-types: se ignoran.
    const { body, contentType } = buildMultipart([
      { name: 'files', filename: 'Factura Ñuñoa.pdf', contentType: 'text/plain', data: PDF_BYTES },
      { name: 'files', filename: '../../imagen.png', contentType: 'application/pdf', data: PNG_BYTES },
      { name: 'expectedType', data: 'factura_sii' },
    ]);

    const docs = await service.upload(fakeRequest(body, contentType), 'corr-1');

    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.contentType)).toEqual(['application/pdf', 'image/png']);
    expect(docs.map((d) => d.sizeBytes)).toEqual([PDF_BYTES.length, PNG_BYTES.length]);
    expect(docs.every((d) => d.status === 'QUEUED' && d.expectedType === 'factura_sii')).toBe(true);
    expect(docs[1].filename).toBe('imagen.png');

    // Contenido íntegro en Blob, con nombre yyyy/mm/dd/<uuid>/<saneado>.
    const names = [...uploaded.keys()];
    expect(names[0]).toMatch(/^\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\/Factura_Nunoa\.pdf$/);
    expect(uploaded.get(names[0])!.data.equals(PDF_BYTES)).toBe(true);
    expect(uploaded.get(names[1])!.contentType).toBe('image/png');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const outbox = (tx.outboxMessage.createMany.mock.calls[0] as any)[0].data;
    const requested = outbox.filter((r: any) => r.type === 'doc.validation.requested');
    expect(requested).toHaveLength(2);
    expect(requested[0]).toMatchObject({ exchange: 'documents', routingKey: 'doc.validation.requested', correlationId: 'corr-1' });
    expect(requested[0].payload).toMatchObject({
      specversion: '1.0',
      source: '/documents-service',
      datacontenttype: 'application/json',
      correlationid: 'corr-1',
      data: { documentId: docs[0].id, container: 'documents', contentType: 'application/pdf', expectedType: 'factura_sii', attempt: 1 },
    });
    expect(outbox.filter((r: any) => r.exchange === 'notifications')).toHaveLength(2);
    expect(relay.kick).toHaveBeenCalled();
  });

  it('rechaza con 415 un archivo cuyo contenido no es PDF/imagen aunque diga application/pdf, y limpia los blobs', async () => {
    const { service, uploaded, prisma, blob } = setup();
    const { body, contentType } = buildMultipart([
      { name: 'files', filename: 'ok.pdf', contentType: 'application/pdf', data: PDF_BYTES },
      { name: 'files', filename: 'malo.pdf', contentType: 'application/pdf', data: 'MZ esto es un ejecutable' },
    ]);
    await expect(service.upload(fakeRequest(body, contentType), 'c')).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(blob.deleteQuietly).toHaveBeenCalled();
    expect(uploaded.size).toBe(0);
  });

  it('rechaza con 413 un archivo que supera MAX_FILE_SIZE_MB y borra el blob parcial', async () => {
    const { service, uploaded, prisma } = setup(0.01); // ~10 KB
    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(20_000, 0x41)]);
    const { body, contentType } = buildMultipart([{ name: 'files', filename: 'grande.pdf', data: big }]);
    await expect(service.upload(fakeRequest(body, contentType), 'c')).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(uploaded.size).toBe(0);
  });

  it('rechaza un expectedType desconocido y limpia lo subido', async () => {
    const { service, uploaded } = setup();
    const { body, contentType } = buildMultipart([
      { name: 'files', filename: 'a.pdf', data: PDF_BYTES },
      { name: 'expectedType', data: 'pasaporte' },
    ]);
    await expect(service.upload(fakeRequest(body, contentType), 'c')).rejects.toBeInstanceOf(BadRequestException);
    expect(uploaded.size).toBe(0);
  });

  it('exige al menos un archivo', async () => {
    const { service } = setup();
    const { body, contentType } = buildMultipart([{ name: 'expectedType', data: 'contrato' }]);
    await expect(service.upload(fakeRequest(body, contentType), 'c')).rejects.toThrow('al menos un archivo');
  });

  it('rechaza más archivos que MAX_FILES', async () => {
    const { service, uploaded } = setup();
    const parts = Array.from({ length: 4 }, (_, i) => ({ name: 'files', filename: `f${i}.png`, data: PNG_BYTES }));
    const { body, contentType } = buildMultipart(parts);
    await expect(service.upload(fakeRequest(body, contentType), 'c')).rejects.toThrow('como máximo 3 archivos');
    expect(uploaded.size).toBe(0);
  });

  it('rechaza con 415 si el cuerpo no es multipart', async () => {
    const { service } = setup();
    await expect(service.upload(fakeRequest(Buffer.from('{}'), 'application/json'), 'c')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('si falla la transacción borra los blobs subidos', async () => {
    const { service, uploaded, prisma } = setup();
    prisma.$transaction.mockRejectedValueOnce(new Error('BD caída'));
    const { body, contentType } = buildMultipart([{ name: 'files', filename: 'a.pdf', data: PDF_BYTES }]);
    await expect(service.upload(fakeRequest(body, contentType), 'c')).rejects.toThrow('BD caída');
    expect(uploaded.size).toBe(0);
  });
});
