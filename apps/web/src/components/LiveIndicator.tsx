import type { LiveStatus } from '../hooks/useLiveUpdates';

const CONFIG: Record<LiveStatus, { label: string; dot: string; hint: string }> = {
  open: { label: 'En vivo', dot: 'bg-emerald-500', hint: 'Recibiendo actualizaciones en tiempo real.' },
  connecting: { label: 'Conectando…', dot: 'bg-slate-400', hint: 'Estableciendo conexión en vivo.' },
  reconnecting: {
    label: 'Reconectando…',
    dot: 'bg-amber-500',
    hint: 'Sin conexión en vivo: actualizando cada 5 segundos mientras se reconecta.',
  },
};

export function LiveIndicator({ status }: { status: LiveStatus }) {
  const cfg = CONFIG[status];
  return (
    <div
      role="status"
      title={cfg.hint}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    >
      <span className="relative flex size-2" aria-hidden="true">
        {status === 'open' && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${cfg.dot}`} />}
        <span className={`relative inline-flex size-2 rounded-full ${cfg.dot}`} />
      </span>
      {cfg.label}
      <span className="sr-only">. {cfg.hint}</span>
    </div>
  );
}
