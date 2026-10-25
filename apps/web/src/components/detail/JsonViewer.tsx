import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { buttonClass } from '../../lib/tone';
import { ChevronIcon, CopyIcon, DownloadIcon } from '../icons';

const TOKEN = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of json.matchAll(TOKEN)) {
    const [text] = match;
    const index = match.index;
    if (index > last) out.push(json.slice(last, index));
    let cls = 'text-amber-700 dark:text-amber-300'; // número
    if (text.startsWith('"')) cls = match[2] ? 'text-indigo-700 dark:text-indigo-300' : 'text-emerald-700 dark:text-emerald-300';
    else if (text === 'null') cls = 'text-slate-400';
    else if (text === 'true' || text === 'false') cls = 'text-sky-700 dark:text-sky-300';
    out.push(
      <span key={index} className={cls}>
        {text}
      </span>,
    );
    last = index + text.length;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}

export function JsonViewer({ value, filename }: { value: unknown; filename: string }) {
  const [open, setOpen] = useState(false);
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const highlighted = useMemo(() => (open ? highlight(json) : null), [json, open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast.success('JSON copiado al portapapeles');
    } catch {
      toast.error('No se pudo copiar el JSON');
    }
  };

  const download = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 0);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" aria-label="Resultado JSON">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="json-viewer-body"
          className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-slate-100"
        >
          <ChevronIcon className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          Resultado JSON
        </button>
        <div className="ml-auto flex gap-2">
          <button type="button" className={buttonClass.secondary} onClick={() => void copy()}>
            <CopyIcon className="size-3.5" /> Copiar
          </button>
          <button type="button" className={buttonClass.secondary} onClick={download}>
            <DownloadIcon className="size-3.5" /> Descargar .json
          </button>
        </div>
      </div>
      {open && (
        <pre
          id="json-viewer-body"
          className="max-h-[32rem] overflow-auto border-t border-slate-100 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
        >
          <code>{highlighted}</code>
        </pre>
      )}
    </section>
  );
}
