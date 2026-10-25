import { useState } from 'react';
import { ExternalIcon, FileIcon } from '../icons';

export function Preview({ url, contentType, filename }: { url: string; contentType: string; filename: string }) {
  const [failed, setFailed] = useState(false);
  const isPdf = contentType === 'application/pdf';
  const isImage = contentType.startsWith('image/');

  const fallback = (message: string) => (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
      <FileIcon className="size-8" />
      <p>{message}</p>
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400">
        Abrir archivo <ExternalIcon className="size-3.5" />
      </a>
    </div>
  );

  return (
    <div className="self-start overflow-hidden rounded-xl border border-slate-200 bg-slate-100 2xl:sticky 2xl:top-20 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <span>Vista previa</span>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Abrir en pestaña nueva <ExternalIcon className="size-3.5" />
        </a>
      </div>
      <div className="h-[28rem] lg:h-[34rem]">
        {isPdf ? (
          <iframe src={url} title={`Vista previa de ${filename}`} className="size-full border-0 bg-white" />
        ) : isImage && !failed ? (
          <div className="flex size-full items-center justify-center overflow-auto p-3">
            <img src={url} alt={`Vista previa de ${filename}`} className="max-h-full max-w-full rounded shadow-sm" onError={() => setFailed(true)} />
          </div>
        ) : (
          fallback(
            contentType === 'image/tiff'
              ? 'Este navegador no puede mostrar imágenes TIFF.'
              : 'No hay vista previa disponible para este archivo.',
          )
        )}
      </div>
    </div>
  );
}
