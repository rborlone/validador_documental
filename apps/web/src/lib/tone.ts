import type { Tone } from './format';

export const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-400/30',
  success:
    'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-400/30',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-400/30',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-400/30',
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  danger: 'bg-rose-500',
  warning: 'bg-amber-500',
};

export const TONE_PANEL: Record<Tone, string> = {
  neutral: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900',
  info: 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40',
  success: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40',
  danger: 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40',
  warning: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
};

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-slate-700 dark:text-slate-200',
  info: 'text-sky-800 dark:text-sky-200',
  success: 'text-emerald-800 dark:text-emerald-200',
  danger: 'text-rose-800 dark:text-rose-200',
  warning: 'text-amber-900 dark:text-amber-200',
};

/** Color de barra según confianza (0..1). */
export function confidenceBarClass(value: number): string {
  if (value >= 0.85) return 'bg-emerald-500';
  if (value >= 0.6) return 'bg-amber-500';
  return 'bg-rose-500';
}

export const buttonClass = {
  primary:
    'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  ghost:
    'inline-flex items-center justify-center rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
} as const;
