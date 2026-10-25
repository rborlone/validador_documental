import type { QueryClient } from '@tanstack/react-query';
import type { DocumentListResponse, DocumentStatus, DocumentStatusChangedData, DocumentSummary } from './types';

export const queryKeys = {
  documents: ['documents'] as const,
  list: () => ['documents', 'list'] as const,
  detail: (id: string) => ['documents', 'detail', id] as const,
  documentTypes: ['document-types'] as const,
};

const STATUS_RANK: Record<DocumentStatus, number> = { QUEUED: 0, PROCESSING: 1, COMPLETED: 2, FAILED: 2 };

export interface ApplyEventResult {
  /** Lista resultante (misma referencia si no hubo cambios). */
  list: DocumentListResponse | undefined;
  /** El documento existía en la lista. */
  found: boolean;
  /** Se aplicó el evento (no era obsoleto). */
  applied: boolean;
  /** Estado previo en caché, si existía. */
  previousStatus: DocumentStatus | null;
}

/**
 * Reductor puro: aplica un `document.updated` sobre la lista cacheada.
 * Ignora eventos obsoletos (estado que retrocede o `updatedAt` anterior al conocido),
 * siguiendo la regla de contracts/README.md: "un estado nunca retrocede".
 */
export function applyStatusEvent(
  list: DocumentListResponse | undefined,
  event: DocumentStatusChangedData,
): ApplyEventResult {
  const index = list?.items.findIndex((d) => d.id === event.documentId) ?? -1;
  if (!list || index < 0) return { list, found: false, applied: false, previousStatus: null };

  const current = list.items[index] as DocumentSummary;
  const regresses = STATUS_RANK[event.status] < STATUS_RANK[current.status];
  const older = Date.parse(event.updatedAt) < Date.parse(current.updatedAt);
  if (regresses || (older && event.status === current.status)) {
    return { list, found: true, applied: false, previousStatus: current.status };
  }

  const updated: DocumentSummary = {
    ...current,
    filename: event.filename || current.filename,
    status: event.status,
    updatedAt: event.updatedAt,
    verdict: event.verdict !== undefined ? event.verdict : current.verdict,
    documentType: event.documentType !== undefined ? event.documentType : current.documentType,
  };
  const items = list.items.slice();
  items[index] = updated;
  return { list: { ...list, items }, found: true, applied: true, previousStatus: current.status };
}

/** Inserta documentos recién subidos al inicio de la lista (sin duplicar). */
export function mergeUploaded(list: DocumentListResponse | undefined, uploaded: DocumentSummary[]): DocumentListResponse {
  const ids = new Set(uploaded.map((d) => d.id));
  const rest = (list?.items ?? []).filter((d) => !ids.has(d.id));
  return { ...(list ?? {}), items: [...uploaded, ...rest] };
}

export interface HandleEventOutcome {
  /** El documento acaba de pasar a un estado terminal (para mostrar el toast). */
  becameTerminal: boolean;
}

/**
 * Aplica el evento al caché de TanStack Query: `setQueryData` sobre la lista
 * (o invalidación si el documento aún no está en ella) e invalidación del detalle.
 */
export function handleStatusEvent(queryClient: QueryClient, event: DocumentStatusChangedData): HandleEventOutcome {
  const result = applyStatusEvent(queryClient.getQueryData<DocumentListResponse>(queryKeys.list()), event);

  if (result.found) {
    if (result.applied) queryClient.setQueryData(queryKeys.list(), result.list);
  } else {
    void queryClient.invalidateQueries({ queryKey: queryKeys.list() });
  }
  if (!result.found || result.applied) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.detail(event.documentId) });
  }

  const terminal = event.status === 'COMPLETED' || event.status === 'FAILED';
  const wasTerminal = result.previousStatus === 'COMPLETED' || result.previousStatus === 'FAILED';
  return { becameTerminal: terminal && !wasTerminal && (result.applied || !result.found) };
}
