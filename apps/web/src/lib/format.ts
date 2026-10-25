import type { CheckSeverity, ClassificationMethod, DocumentStatus, FieldSource, LlmPurpose, RiskLevel, TextSource, Verdict } from '../api/types';

export type Tone = 'neutral' | 'info' | 'success' | 'danger' | 'warning';

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  QUEUED: 'En cola',
  PROCESSING: 'Procesando',
  COMPLETED: 'Completado',
  FAILED: 'Error',
};

export const STATUS_TONE: Record<DocumentStatus, Tone> = {
  QUEUED: 'neutral',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  VALID: 'Válido',
  INVALID: 'Inválido',
  REVIEW: 'Revisar',
};

export const VERDICT_TONE: Record<Verdict, Tone> = {
  VALID: 'success',
  INVALID: 'danger',
  REVIEW: 'warning',
};

export const VERDICT_DESCRIPTION: Record<Verdict, string> = {
  VALID: 'El documento cumple todas las validaciones.',
  INVALID: 'Al menos una validación de severidad error no se cumple.',
  REVIEW: 'Requiere revisión manual: riesgo de autenticidad, tipo desconocido o baja confianza.',
};

export const METHOD_LABEL: Record<ClassificationMethod, string> = {
  rules: 'Reglas',
  llm: 'IA',
  expected: 'Esperado',
};

export const LLM_PURPOSE_LABEL: Record<LlmPurpose, string> = {
  classify: 'Clasificar el tipo de documento',
  extract: 'Completar campos que las reglas no leyeron',
  visual_review: 'Revisión visual de autenticidad',
};

export const SOURCE_LABEL: Record<FieldSource, string> = {
  text: 'Texto',
  ocr: 'OCR',
  llm: 'IA',
};

export const TEXT_SOURCE_LABEL: Record<TextSource, string> = {
  text: 'Texto embebido',
  ocr: 'OCR',
  mixed: 'Mixto',
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: 'Bajo',
  MEDIUM: 'Medio',
  HIGH: 'Alto',
};

export const RISK_TONE: Record<RiskLevel, Tone> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
};

export const SEVERITY_LABEL: Record<CheckSeverity, string> = {
  error: 'Error',
  warning: 'Advertencia',
};

export const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  factura_sii: 'Factura electrónica SII',
  orden_compra: 'Orden de compra',
  certificado_vigencia: 'Certificado de vigencia',
  cedula_identidad: 'Cédula de identidad',
  contrato: 'Contrato',
  certificado_accidentabilidad: 'Certificado de accidentabilidad',
  carpeta_tributaria: 'Carpeta tributaria SII',
  certificado_f30: 'Certificado F30 / F30-1',
  desconocido: 'Desconocido',
};

export const formatStatus = (status: DocumentStatus): string => STATUS_LABEL[status] ?? status;

export const formatVerdict = (verdict: Verdict | null | undefined): string | null =>
  verdict ? (VERDICT_LABEL[verdict] ?? verdict) : null;

export function formatDocumentType(id: string | null | undefined, labels?: Record<string, string>): string {
  if (!id) return '—';
  return labels?.[id] ?? DOCUMENT_TYPE_LABEL[id] ?? humanize(id);
}

export const isTerminal = (status: DocumentStatus): boolean => status === 'COMPLETED' || status === 'FAILED';

/** Mensaje del toast cuando un documento termina; `null` si el estado no es terminal. */
export function completionMessage(filename: string, status: DocumentStatus, verdict?: Verdict | null): string | null {
  if (status === 'COMPLETED') {
    const label = formatVerdict(verdict);
    return label ? `${filename}: validación completada — ${label}` : `${filename}: validación completada`;
  }
  if (status === 'FAILED') return `${filename}: la validación falló`;
  return null;
}

const percentFormatter = new Intl.NumberFormat('es-CL', { style: 'percent', maximumFractionDigits: 0 });
export const formatPercent = (fraction: number): string => percentFormatter.format(clamp01(fraction));

const numberFormatter = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
export const formatNumber = (n: number): string => numberFormatter.format(n);

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(ms / 1000)} s`;
}

const dateTimeFormatter = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' });
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormatter.format(date);
}

const relativeFormatter = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
export function formatRelative(iso: string, now: number = Date.now()): string {
  const date = new Date(iso).getTime();
  if (Number.isNaN(date)) return iso;
  const seconds = Math.round((date - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'hace un momento';
  if (abs < 3600) return relativeFormatter.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relativeFormatter.format(Math.round(seconds / 3600), 'hour');
  return formatDateTime(iso);
}

/** `rut_emisor` → `Rut emisor`. */
export function humanize(key: string): string {
  const text = key.replace(/[_.-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Representación legible de un valor extraído arbitrario. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
