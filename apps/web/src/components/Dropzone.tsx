import { useId, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import type { DocumentSummary, DocumentTypeOption } from '../api/types';
import { useUploadDocuments } from '../hooks/useDocuments';
import { ACCEPT_ATTRIBUTE, MAX_FILES, validateFiles, type RejectedFile } from '../lib/files';
import { formatBytes, formatPercent } from '../lib/format';
import { buttonClass } from '../lib/tone';
import { FileIcon, ImageIcon, UploadIcon, XIcon } from './icons';
import { Spinner } from './ui';

interface DropzoneProps {
  documentTypes: DocumentTypeOption[];
  documentTypesLoading: boolean;
  onUploaded?: (documents: DocumentSummary[]) => void;
}

const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export function Dropzone({ documentTypes, documentTypesLoading, onUploaded }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [expectedType, setExpectedType] = useState('');
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const upload = useUploadDocuments();
  const ids = { hint: useId(), select: useId(), errors: useId() };
  const uploading = upload.isPending;

  const addFiles = (incoming: FileList | File[]) => {
    const known = new Set(files.map(fileKey));
    const fresh = Array.from(incoming).filter((f) => !known.has(fileKey(f)));
    const { accepted, rejected: bad } = validateFiles(fresh, files.length);
    setFiles((prev) => [...prev, ...accepted]);
    setRejected(bad);
  };

  const removeFile = (key: string) => setFiles((prev) => prev.filter((f) => fileKey(f) !== key));

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!uploading && e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const submit = () => {
    if (files.length === 0 || uploading) return;
    setProgress(0);
    upload.mutate(
      { files, expectedType: expectedType || null, onProgress: setProgress },
      {
        onSuccess: ({ documents }) => {
          const n = documents.length;
          toast.success(n === 1 ? '1 documento enviado a validación' : `${n} documentos enviados a validación`);
          setFiles([]);
          setRejected([]);
          onUploaded?.(documents);
        },
        onError: (err) => toast.error(`No se pudo subir: ${err.message}`),
      },
    );
  };

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-disabled={uploading}
        aria-describedby={ids.hint}
        aria-label="Seleccionar documentos o arrastrarlos aquí"
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
          dragging
            ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40'
            : 'border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-500 dark:hover:bg-slate-900/60'
        } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300">
          <UploadIcon className="size-5" />
        </div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {dragging ? 'Suelta los archivos aquí' : (
            <>
              Arrastra documentos o <span className="text-indigo-600 dark:text-indigo-400">selecciónalos</span>
            </>
          )}
        </p>
        <p id={ids.hint} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          PDF, PNG, JPEG o TIFF · hasta {MAX_FILES} archivos · máx. 20 MB c/u
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          data-testid="file-input"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {rejected.length > 0 && (
        <ul id={ids.errors} role="alert" className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {rejected.map(({ file, reason }) => (
            <li key={fileKey(file)}>
              <span className="font-medium">{file.name}</span>: {reason}
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900" aria-label="Archivos seleccionados">
          {files.map((file) => {
            const key = fileKey(file);
            const Icon = file.type.startsWith('image/') ? ImageIcon : FileIcon;
            return (
              <li key={key} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Icon className="size-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="tabular text-xs text-slate-500 dark:text-slate-400">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  className={buttonClass.ghost}
                  onClick={() => removeFile(key)}
                  disabled={uploading}
                  aria-label={`Quitar ${file.name}`}
                >
                  <XIcon className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor={ids.select} className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
            Tipo esperado <span className="font-normal text-slate-500">(opcional)</span>
          </label>
          <select
            id={ids.select}
            value={expectedType}
            onChange={(e) => setExpectedType(e.target.value)}
            disabled={uploading}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">{documentTypesLoading ? 'Cargando tipos…' : 'Detectar automáticamente'}</option>
            {documentTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={buttonClass.primary} onClick={submit} disabled={files.length === 0 || uploading}>
          {uploading ? <Spinner /> : <UploadIcon className="size-4" />}
          {uploading
            ? 'Subiendo…'
            : files.length > 0
              ? `Validar ${files.length} ${files.length === 1 ? 'documento' : 'documentos'}`
              : 'Validar documentos'}
        </button>
      </div>

      {uploading && (
        <div aria-live="polite">
          <div className="mb-1 flex justify-between text-xs text-slate-600 dark:text-slate-400">
            <span>{progress >= 1 ? 'Procesando envío…' : 'Subiendo archivos…'}</span>
            <span className="tabular">{formatPercent(progress)}</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
            role="progressbar"
            aria-label="Progreso de subida"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-200 dark:bg-indigo-400" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
