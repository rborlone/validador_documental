import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../api/cache';
import type { DocumentListResponse } from '../api/types';
import { useLiveUpdates } from './useLiveUpdates';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

describe('useLiveUpdates', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('actualiza el caché y muestra un toast al completar', () => {
    const qc = new QueryClient();
    qc.setQueryData<DocumentListResponse>(queryKeys.list(), {
      items: [
        {
          id: 'd1',
          filename: 'Factura.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1,
          status: 'PROCESSING',
          expectedType: null,
          documentType: null,
          verdict: null,
          createdAt: '2026-10-24T10:00:00.000Z',
          updatedAt: '2026-10-24T10:00:01.000Z',
        },
      ],
    });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useLiveUpdates('http://api/events'), { wrapper });

    expect(result.current).toBe('connecting');
    const es = FakeEventSource.instances[0] as FakeEventSource;
    act(() => es.open());
    expect(result.current).toBe('open');

    act(() =>
      es.emit('document.updated', {
        documentId: 'd1',
        filename: 'Factura.pdf',
        status: 'COMPLETED',
        verdict: 'VALID',
        documentType: 'factura_sii',
        updatedAt: '2026-10-24T10:00:05.000Z',
      }),
    );
    expect(qc.getQueryData<DocumentListResponse>(queryKeys.list())?.items[0]).toMatchObject({
      status: 'COMPLETED',
      verdict: 'VALID',
    });
    expect(toastMock.success).toHaveBeenCalledWith('Factura.pdf: validación completada — Válido');
  });

  it('reconecta con backoff si la conexión se cierra', () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useLiveUpdates('http://api/events'), { wrapper });
    const es = FakeEventSource.instances[0] as FakeEventSource;
    act(() => {
      es.readyState = FakeEventSource.CLOSED;
      es.onerror?.();
    });
    expect(result.current).toBe('reconnecting');
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.useRealTimers();
  });
});
