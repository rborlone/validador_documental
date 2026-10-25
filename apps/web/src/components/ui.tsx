import type { ReactNode } from 'react';
import { clamp01, formatPercent, type Tone } from '../lib/format';
import { confidenceBarClass, TONE_BADGE, TONE_DOT } from '../lib/tone';

export function Badge({
  tone = 'neutral',
  dot = false,
  pulse = false,
  children,
  className = '',
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONE_BADGE[tone]} ${className}`}
    >
      {dot && (
        <span className="relative flex size-1.5" aria-hidden="true">
          {pulse && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${TONE_DOT[tone]}`} />}
          <span className={`relative inline-flex size-1.5 rounded-full ${TONE_DOT[tone]}`} />
        </span>
      )}
      {children}
    </span>
  );
}

export function Spinner({ className = 'size-4', label }: { className?: string; label?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ConfidenceBar({ value, label = 'Confianza' }: { value: number; label?: string }) {
  const v = clamp01(value);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
      >
        <div className={`h-full rounded-full ${confidenceBarClass(v)}`} style={{ width: `${v * 100}%` }} />
      </div>
      <span className="tabular w-9 text-right text-xs text-slate-600 dark:text-slate-400">{formatPercent(v)}</span>
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`;
  return (
    <section aria-labelledby={id} className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div>
          <h3 id={id} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h3>
          {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" aria-hidden="true">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800 ${className}`} aria-hidden="true" />;
}
