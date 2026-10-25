import type { DocumentStatus } from './document.types';

/** Evento de resultado ya validado. */
export type ResultEvent =
  | { kind: 'started'; documentId: string; attempt: number }
  | {
      kind: 'completed';
      documentId: string;
      result: Record<string, unknown>;
      verdict: string | null;
      documentType: string | null;
    }
  | { kind: 'failed'; documentId: string; attempt: number; error: { code: string; message: string } };

export interface CurrentState {
  status: DocumentStatus;
  attempts: number;
}

/** Cambios a aplicar; `null` significa que el evento se ignora (duplicado o atrasado). */
export interface TransitionPatch {
  status: DocumentStatus;
  attempts?: number;
  result?: Record<string, unknown>;
  verdict?: string | null;
  documentType?: string | null;
  error?: { code: string; message: string } | null;
}

const TERMINAL: ReadonlySet<DocumentStatus> = new Set(['COMPLETED', 'FAILED']);

/**
 * Máquina de estados QUEUED → PROCESSING → COMPLETED | FAILED.
 * - Un estado nunca retrocede: started después de completed/failed se ignora.
 * - Idempotente por documentId + attempt: un started repetido (mismo intento) se ignora;
 *   uno de un intento posterior (reintento) se acepta y actualiza `attempts`.
 * - Los estados terminales son finales: un segundo completed/failed se ignora.
 */
export function decideTransition(current: CurrentState, event: ResultEvent): TransitionPatch | null {
  if (TERMINAL.has(current.status)) return null;

  switch (event.kind) {
    case 'started':
      if (event.attempt <= current.attempts) return null;
      return { status: 'PROCESSING', attempts: event.attempt };
    case 'completed':
      return {
        status: 'COMPLETED',
        attempts: Math.max(current.attempts, 1),
        result: event.result,
        verdict: event.verdict,
        documentType: event.documentType,
        error: null,
      };
    case 'failed':
      return { status: 'FAILED', attempts: Math.max(current.attempts, event.attempt), error: event.error };
  }
}
