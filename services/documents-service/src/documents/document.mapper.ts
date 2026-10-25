import type { Document } from '@prisma/client';
import type { DocumentDetail, DocumentSummary, StatusChangedData, Verdict } from './document.types';

const VERDICTS = new Set(['VALID', 'INVALID', 'REVIEW']);

function asVerdict(v: string | null): Verdict | null {
  return v && VERDICTS.has(v) ? (v as Verdict) : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function toSummary(d: Omit<Document, 'result' | 'error'>): DocumentSummary {
  return {
    id: d.id,
    filename: d.filename,
    contentType: d.contentType,
    sizeBytes: Number(d.sizeBytes),
    status: d.status,
    expectedType: d.expectedType,
    documentType: d.documentType,
    verdict: asVerdict(d.verdict),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toDetail(d: Document): DocumentDetail {
  const error = isObject(d.error) ? d.error : null;
  return {
    ...toSummary(d),
    attempts: d.attempts,
    result: isObject(d.result) ? d.result : null,
    error: error
      ? {
          code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
          message: typeof error.message === 'string' ? error.message : '',
        }
      : null,
  };
}

export function toStatusChanged(d: Document): StatusChangedData {
  return {
    documentId: d.id,
    filename: d.filename,
    status: d.status,
    verdict: asVerdict(d.verdict),
    documentType: d.documentType,
    updatedAt: d.updatedAt.toISOString(),
  };
}
