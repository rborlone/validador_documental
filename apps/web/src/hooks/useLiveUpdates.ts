import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { handleStatusEvent, queryKeys } from '../api/cache';
import { api } from '../api/client';
import type { DocumentStatusChangedData } from '../api/types';
import { completionMessage } from '../lib/format';

export type LiveStatus = 'connecting' | 'open' | 'reconnecting';

const MAX_BACKOFF_MS = 30_000;

export function parseStatusEvent(raw: string): DocumentStatusChangedData | null {
  try {
    const data = JSON.parse(raw) as Partial<DocumentStatusChangedData> | null;
    if (!data || typeof data.documentId !== 'string' || typeof data.status !== 'string') return null;
    return data as DocumentStatusChangedData;
  } catch {
    return null;
  }
}

/**
 * Se suscribe a `GET /api/events` (SSE). Ante `document.updated` actualiza el caché
 * y muestra un toast cuando el documento termina. Si la conexión se cierra,
 * reintenta con backoff exponencial; mientras tanto las queries hacen polling.
 */
export function useLiveUpdates(url: string = api.eventsUrl()): LiveStatus {
  const queryClient = useQueryClient();
  const supported = typeof EventSource !== 'undefined';
  const [status, setStatus] = useState<LiveStatus>(supported ? 'connecting' : 'reconnecting');
  const wasDisconnected = useRef(false);

  useEffect(() => {
    // Sin EventSource (navegadores muy antiguos) se queda en polling de respaldo.
    if (!supported) return;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;

    const onUpdate = (message: MessageEvent<string>) => {
      const event = parseStatusEvent(message.data);
      if (!event) return;
      const { becameTerminal } = handleStatusEvent(queryClient, event);
      if (!becameTerminal) return;
      const text = completionMessage(event.filename, event.status, event.verdict);
      if (!text) return;
      if (event.status === 'FAILED') toast.error(text);
      else if (event.verdict === 'INVALID') toast.error(text);
      else if (event.verdict === 'REVIEW') toast.warning(text);
      else toast.success(text);
    };

    const connect = () => {
      if (disposed) return;
      source = new EventSource(url);
      source.addEventListener('document.updated', onUpdate as EventListener);
      source.onopen = () => {
        attempt = 0;
        setStatus('open');
        if (wasDisconnected.current) {
          // Pudimos perder eventos mientras estábamos desconectados.
          void queryClient.invalidateQueries({ queryKey: queryKeys.documents });
          wasDisconnected.current = false;
        }
      };
      source.onerror = () => {
        wasDisconnected.current = true;
        setStatus('reconnecting');
        if (source && source.readyState === EventSource.CLOSED) {
          // El navegador no reintentará por sí solo: reconexión manual con backoff.
          source.close();
          const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
          attempt += 1;
          retryTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [queryClient, url, supported]);

  return status;
}
