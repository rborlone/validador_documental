import type { DocumentSummary } from '../api/types';
import { formatBytes, formatDocumentType, formatRelative, formatDateTime } from '../lib/format';
import { FileIcon, ImageIcon, InboxIcon, AlertIcon } from './icons';
import { StatusChip, VerdictBadge } from './StatusChip';
import { EmptyState, Skeleton } from './ui';
import { buttonClass } from '../lib/tone';

interface DocumentListProps {
  documents: DocumentSummary[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  typeLabels: Record<string, string>;
}

export function DocumentList({ documents, isLoading, error, onRetry, selectedId, onSelect, typeLabels }: DocumentListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" aria-label="Cargando documentos">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg p-2">
            <Skeleton className="size-9" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error && !documents) {
    return (
      <EmptyState icon={<AlertIcon className="size-6" />} title="No se pudo cargar la lista">
        <p>{error.message}</p>
        <button type="button" onClick={onRetry} className={`${buttonClass.secondary} mt-3`}>
          Reintentar
        </button>
      </EmptyState>
    );
  }

  if (!documents || documents.length === 0) {
    return (
      <EmptyState icon={<InboxIcon className="size-6" />} title="Aún no hay documentos">
        Sube uno o varios archivos para ver aquí su estado de validación en tiempo real.
      </EmptyState>
    );
  }

  return (
    <ul className="space-y-1 p-2" aria-label="Documentos">
      {documents.map((doc) => {
        const selected = doc.id === selectedId;
        const Icon = doc.contentType.startsWith('image/') ? ImageIcon : FileIcon;
        return (
          <li key={doc.id}>
            <button
              type="button"
              onClick={() => onSelect(doc.id)}
              aria-current={selected ? 'true' : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-indigo-600 ${
                selected
                  ? 'bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-950/50 dark:ring-indigo-800'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                  selected ? 'bg-white text-indigo-600 dark:bg-slate-900 dark:text-indigo-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                <Icon className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={doc.filename}>
                  {doc.filename}
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                  {doc.documentType ? formatDocumentType(doc.documentType, typeLabels) : formatBytes(doc.sizeBytes)} ·{' '}
                  <time dateTime={doc.createdAt} title={formatDateTime(doc.createdAt)}>
                    {formatRelative(doc.createdAt)}
                  </time>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <StatusChip status={doc.status} />
                {doc.verdict && doc.status === 'COMPLETED' && <VerdictBadge verdict={doc.verdict} />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
