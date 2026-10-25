/**
 * Tipos derivados de los contratos del monorepo:
 * - contracts/http.md (DocumentSummary / DocumentDetail y endpoints del BFF)
 * - contracts/validation-result.schema.json (ValidationResult)
 * - contracts/events/doc.status.changed.schema.json (payload del evento SSE `document.updated`)
 */

export const DOCUMENT_STATUSES = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const VERDICTS = ['VALID', 'INVALID', 'REVIEW'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const DOCUMENT_TYPE_IDS = [
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
export type DocumentTypeId = (typeof DOCUMENT_TYPE_IDS)[number];

export type ClassificationMethod = 'rules' | 'llm' | 'expected';
export type FieldSource = 'text' | 'ocr' | 'llm';
export type CheckSeverity = 'error' | 'warning';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type TextSource = 'text' | 'ocr' | 'mixed';

export interface ExtractedField {
  value: unknown;
  source: FieldSource;
  confidence: number;
}

export interface ValidationCheck {
  id: string;
  passed: boolean;
  severity: CheckSeverity;
  detail: string;
}

export interface AuthenticitySignal {
  id: string;
  weight: number;
  detail: string;
}

export interface ValidationResult {
  documentId: string;
  documentType: {
    value: DocumentTypeId;
    confidence: number;
    method: ClassificationMethod;
    reason?: string | null;
  };
  templateVersion: string | null;
  extracted: Record<string, ExtractedField>;
  checks: ValidationCheck[];
  authenticity: {
    score: number;
    level: RiskLevel;
    signals: AuthenticitySignal[];
  };
  signature: { status: 'NOT_IMPLEMENTED' };
  verdict: Verdict;
  pages: number;
  textSource: TextSource;
  llmUsed?: boolean;
  llmCalls?: LlmCall[];
  processingMs: number;
}

export type LlmPurpose = 'classify' | 'extract' | 'visual_review';

export interface LlmCall {
  purpose: LlmPurpose;
  outcome: string;
  model: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  fields?: string[];
}

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
  result: ValidationResult | null;
  error: { code: string; message: string } | null;
}

export interface DocumentListResponse {
  items: DocumentSummary[];
}

export interface UploadResponse {
  documents: DocumentSummary[];
}

export interface DocumentTypeOption {
  id: string;
  label: string;
}

export interface DocumentTypesResponse {
  items: DocumentTypeOption[];
}

/** `data` del CloudEvent `doc.status.changed`, que el BFF emite como evento SSE `document.updated`. */
export interface DocumentStatusChangedData {
  documentId: string;
  filename: string;
  status: DocumentStatus;
  verdict?: Verdict | null;
  documentType?: string | null;
  updatedAt: string;
}

/** Error RFC 9457 (application/problem+json). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
}
