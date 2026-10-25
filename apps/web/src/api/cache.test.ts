import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { applyStatusEvent, handleStatusEvent, mergeUploaded, queryKeys } from './cache';
import type { DocumentListResponse, DocumentStatusChangedData, DocumentSummary } from './types';

const doc = (overrides: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id: 'd1',
  filename: 'Factura.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1000,
  status: 'QUEUED',
  expectedType: null,
  documentType: null,
  verdict: null,
  createdAt: '2026-10-24T10:00:00.000Z',
  updatedAt: '2026-10-24T10:00:00.000Z',
  ...overrides,
});

const event = (overrides: Partial<DocumentStatusChangedData> = {}): DocumentStatusChangedData => ({
  documentId: 'd1',
  filename: 'Factura.pdf',
  status: 'PROCESSING',
  updatedAt: '2026-10-24T10:00:05.000Z',
  ...overrides,
});

describe('applyStatusEvent', () => {
  const list: DocumentListResponse = { items: [doc({ id: 'd0' }), doc()] };

  it('actualiza estado, veredicto y tipo del documento sin mutar la lista original', () => {
    const r = applyStatusEvent(
      list,
      event({ status: 'COMPLETED', verdict: 'VALID', documentType: 'factura_sii', updatedAt: '2026-10-24T10:00:09.000Z' }),
    );
    expect(r).toMatchObject({ found: true, applied: true, previousStatus: 'QUEUED' });
    expect(r.list?.items[1]).toMatchObject({
      status: 'COMPLETED',
      verdict: 'VALID',
      documentType: 'factura_sii',
      updatedAt: '2026-10-24T10:00:09.000Z',
    });
    expect(r.list?.items[0]).toBe(list.items[0]);
    expect(list.items[1]?.status).toBe('QUEUED');
  });

  it('conserva veredicto y tipo si el evento no los trae', () => {
    const base = { items: [doc({ status: 'PROCESSING', verdict: null, documentType: 'contrato' })] };
    const r = applyStatusEvent(base, event({ status: 'PROCESSING', updatedAt: '2026-10-24T10:00:06.000Z' }));
    expect(r.list?.items[0]?.documentType).toBe('contrato');
  });

  it('ignora eventos que hacen retroceder el estado', () => {
    const done = { items: [doc({ status: 'COMPLETED', updatedAt: '2026-10-24T10:00:10.000Z' })] };
    const r = applyStatusEvent(done, event({ status: 'PROCESSING' }));
    expect(r).toMatchObject({ found: true, applied: false, previousStatus: 'COMPLETED' });
    expect(r.list).toBe(done);
  });

  it('informa cuando el documento no está en la lista', () => {
    const r = applyStatusEvent(list, event({ documentId: 'otro' }));
    expect(r).toMatchObject({ found: false, applied: false, previousStatus: null });
    expect(applyStatusEvent(undefined, event()).found).toBe(false);
  });
});

describe('handleStatusEvent', () => {
  const setup = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData<DocumentListResponse>(queryKeys.list(), { items: [doc()] });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    return { qc, invalidate };
  };

  it('aplica setQueryData sobre la lista e invalida el detalle', () => {
    const { qc, invalidate } = setup();
    const out = handleStatusEvent(qc, event({ status: 'PROCESSING' }));
    expect(qc.getQueryData<DocumentListResponse>(queryKeys.list())?.items[0]?.status).toBe('PROCESSING');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.detail('d1') });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.list() });
    expect(out.becameTerminal).toBe(false);
  });

  it('marca becameTerminal solo la primera vez que llega a COMPLETED', () => {
    const { qc } = setup();
    const completed = event({ status: 'COMPLETED', verdict: 'VALID', updatedAt: '2026-10-24T10:00:09.000Z' });
    expect(handleStatusEvent(qc, completed).becameTerminal).toBe(true);
    expect(handleStatusEvent(qc, completed).becameTerminal).toBe(false);
  });

  it('invalida la lista si el documento es desconocido', () => {
    const { qc, invalidate } = setup();
    const out = handleStatusEvent(qc, event({ documentId: 'nuevo', status: 'FAILED' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.list() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.detail('nuevo') });
    expect(out.becameTerminal).toBe(true);
  });
});

describe('mergeUploaded', () => {
  it('antepone los subidos sin duplicar', () => {
    const merged = mergeUploaded({ items: [doc({ id: 'a' }), doc({ id: 'b' })] }, [doc({ id: 'b' }), doc({ id: 'c' })]);
    expect(merged.items.map((d) => d.id)).toEqual(['b', 'c', 'a']);
    expect(mergeUploaded(undefined, [doc()]).items).toHaveLength(1);
  });
});
