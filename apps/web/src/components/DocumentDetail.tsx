import { api } from '../api/client';
import type { DocumentDetail as DocumentDetailModel, ValidationResult } from '../api/types';
import {
  formatBytes,
  formatDateTime,
  formatDocumentType,
  formatDuration,
  METHOD_LABEL,
  STATUS_LABEL,
  TEXT_SOURCE_LABEL,
  VERDICT_DESCRIPTION,
  VERDICT_LABEL,
  VERDICT_TONE,
} from '../lib/format';
import { splitExtracted } from '../lib/result';
import { buttonClass, TONE_PANEL, TONE_TEXT } from '../lib/tone';
import { Authenticity } from './detail/Authenticity';
import { Checks } from './detail/Checks';
import { ExtractedFields, LineItems } from './detail/ExtractedFields';
import { JsonViewer } from './detail/JsonViewer';
import { LlmUsage } from './detail/LlmUsage';
import { Preview } from './detail/Preview';
import { AlertIcon, CheckIcon, FileIcon, XIcon } from './icons';
import { StatusChip } from './StatusChip';
import { Badge, ConfidenceBar, EmptyState, Section, Skeleton, Spinner } from './ui';

interface DocumentDetailProps {
  document: DocumentDetailModel | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  typeLabels: Record<string, string>;
}

export function DocumentDetail({ document: doc, isLoading, error, onRetry, typeLabels }: DocumentDetailProps) {
  if (isLoading && !doc) return <DetailSkeleton />;

  if (error && !doc) {
    return (
      <EmptyState icon={<AlertIcon className="size-6" />} title="No se pudo cargar el documento">
        <p>{error.message}</p>
        <button type="button" onClick={onRetry} className={`${buttonClass.secondary} mt-3`}>
          Reintentar
        </button>
      </EmptyState>
    );
  }

  if (!doc) return null;

  const result = doc.status === 'COMPLETED' ? doc.result : null;
  const jsonFilename = `${doc.filename.replace(/\.[^.]+$/, '')}.resultado.json`;

  return (
    <article className="space-y-4" aria-labelledby="detail-title">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="detail-title" className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100" title={doc.filename}>
            {doc.filename}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {formatBytes(doc.sizeBytes)} · {doc.contentType} · subido {formatDateTime(doc.createdAt)}
            {doc.attempts > 1 && ` · ${doc.attempts} intentos`}
            {doc.expectedType && ` · esperado: ${formatDocumentType(doc.expectedType, typeLabels)}`}
          </p>
        </div>
        <StatusChip status={doc.status} />
      </header>

      {result ? (
        <VerdictPanel result={result} typeLabels={typeLabels} />
      ) : doc.status === 'FAILED' ? (
        <FailedPanel error={doc.error} />
      ) : (
        <PendingPanel status={doc.status} />
      )}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Preview url={api.contentUrl(doc.id)} contentType={doc.contentType} filename={doc.filename} />
        {result && <ResultSections result={result} />}
      </div>

      {doc.result && <JsonViewer value={doc.result} filename={jsonFilename} />}
    </article>
  );
}

function VerdictPanel({ result, typeLabels }: { result: ValidationResult; typeLabels: Record<string, string> }) {
  const tone = VERDICT_TONE[result.verdict];
  const Icon = result.verdict === 'VALID' ? CheckIcon : result.verdict === 'INVALID' ? XIcon : AlertIcon;
  const { documentType } = result;
  return (
    <div className={`rounded-xl border p-4 ${TONE_PANEL[tone]}`}>
      <div className="flex flex-wrap items-center gap-4">
        <div className={`flex items-center gap-3 ${TONE_TEXT[tone]}`}>
          <span className="flex size-10 items-center justify-center rounded-full bg-white/70 dark:bg-black/20" aria-hidden="true">
            <Icon className="size-5" strokeWidth={2.4} />
          </span>
          <div>
            <p className="text-xs font-medium tracking-wide uppercase opacity-80">Veredicto</p>
            <p className="text-2xl leading-tight font-bold" data-testid="verdict">
              {VERDICT_LABEL[result.verdict]}
            </p>
          </div>
        </div>
        <p className={`min-w-48 flex-1 text-sm ${TONE_TEXT[tone]} opacity-90`}>{VERDICT_DESCRIPTION[result.verdict]}</p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-black/5 pt-3 text-sm sm:grid-cols-4 dark:border-white/10">
        <div className="col-span-2">
          <dt className="text-xs text-slate-500 dark:text-slate-400">Tipo detectado</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
            {formatDocumentType(documentType.value, typeLabels)}
            <Badge tone={documentType.method === 'llm' ? 'warning' : 'neutral'} title="Método de clasificación">
              {METHOD_LABEL[documentType.method]}
            </Badge>
          </dd>
          <dd className="mt-1">
            <ConfidenceBar value={documentType.confidence} label="Confianza de la clasificación" />
          </dd>
          {documentType.reason && <dd className="mt-1 text-xs text-slate-500 dark:text-slate-400">{documentType.reason}</dd>}
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Fuente del texto</dt>
          <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
            {TEXT_SOURCE_LABEL[result.textSource]} · {result.pages} {result.pages === 1 ? 'pág.' : 'págs.'}
          </dd>
          {result.llmUsed && <dd className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Con apoyo de IA</dd>}
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Procesamiento</dt>
          <dd className="tabular mt-0.5 font-medium text-slate-900 dark:text-slate-100">{formatDuration(result.processingMs)}</dd>
          {result.templateVersion && (
            <dd className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Template v{result.templateVersion}</dd>
          )}
        </div>
      </dl>
    </div>
  );
}

function ResultSections({ result }: { result: ValidationResult }) {
  const { scalars, tables } = splitExtracted(result.extracted);
  return (
    <div className="space-y-4">
      <ExtractedFields fields={scalars} />
      {tables.map(([name, field]) => (
        <LineItems key={name} name={name} field={field} />
      ))}
      <Checks checks={result.checks} />
      <Authenticity authenticity={result.authenticity} />
      <LlmUsage calls={result.llmCalls} llmUsed={result.llmUsed} />
      <Section title="Firma">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Validación de firma: <span className="font-medium">próximamente</span>.
        </p>
      </Section>
    </div>
  );
}

function FailedPanel({ error }: { error: DocumentDetailModel['error'] }) {
  return (
    <div role="alert" className={`rounded-xl border p-4 ${TONE_PANEL.danger}`}>
      <div className={`flex items-start gap-3 ${TONE_TEXT.danger}`}>
        <AlertIcon className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">La validación falló</p>
          <p className="mt-1 text-sm">{error?.message ?? 'El documento no pudo procesarse.'}</p>
          {error?.code && <code className="mt-2 inline-block font-mono text-xs opacity-80">{error.code}</code>}
        </div>
      </div>
    </div>
  );
}

function PendingPanel({ status }: { status: DocumentDetailModel['status'] }) {
  const processing = status === 'PROCESSING';
  return (
    <div className={`rounded-xl border p-4 ${TONE_PANEL[processing ? 'info' : 'neutral']}`} aria-live="polite">
      <div className={`flex items-center gap-3 ${TONE_TEXT[processing ? 'info' : 'neutral']}`}>
        <Spinner className="size-5" />
        <div>
          <p className="font-semibold">{STATUS_LABEL[status]}</p>
          <p className="text-sm opacity-90">
            {processing
              ? 'Clasificando, extrayendo campos y verificando el documento…'
              : 'El documento espera su turno para ser validado.'}{' '}
            Puedes seguir trabajando: te avisaremos al terminar.
          </p>
        </div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando documento">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-4 2xl:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

export function NoSelection() {
  return (
    <EmptyState icon={<FileIcon className="size-6" />} title="Selecciona un documento">
      Elige un documento de la lista para ver su vista previa, los campos extraídos, las validaciones y el resultado JSON.
    </EmptyState>
  );
}

