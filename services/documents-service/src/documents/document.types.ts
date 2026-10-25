/** Modelos de la API (contracts/http.md). */
export type DocumentStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type Verdict = 'VALID' | 'INVALID' | 'REVIEW';

export const DOCUMENT_TYPES = [
  'factura_sii',
  'orden_compra',
  'certificado_vigencia',
  'cedula_identidad',
  'contrato',
  'certificado_accidentabilidad',
  'carpeta_tributaria',
  'certificado_f30',
  'desconocido',
] as const;
export type DocumentTypeId = (typeof DOCUMENT_TYPES)[number];

export const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export interface DocumentSummary {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: DocumentStatus;
  expectedType: string | null;
  documentType: string | null;
  verdict: Verdict | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  attempts: number;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
}

/** data del evento doc.status.changed. */
export interface StatusChangedData {
  documentId: string;
  filename: string;
  status: DocumentStatus;
  verdict: Verdict | null;
  documentType: string | null;
  updatedAt: string;
}
