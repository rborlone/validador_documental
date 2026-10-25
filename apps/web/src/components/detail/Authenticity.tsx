import type { ValidationResult } from '../../api/types';
import { formatNumber, formatPercent, RISK_LABEL, RISK_TONE } from '../../lib/format';
import { TONE_DOT } from '../../lib/tone';
import { ShieldIcon } from '../icons';
import { Badge, Section } from '../ui';

export function Authenticity({ authenticity }: { authenticity: ValidationResult['authenticity'] }) {
  const { level, score, signals } = authenticity;
  const tone = RISK_TONE[level];
  return (
    <Section title="Autenticidad" description="Riesgo de falsificación estimado a partir de señales del archivo.">
      <div className="flex items-center gap-4">
        <div className="flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <ShieldIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-slate-400">Riesgo</span>
            <Badge tone={tone} dot>
              {RISK_LABEL[level]}
            </Badge>
            <span className="tabular ml-auto text-xs text-slate-500 dark:text-slate-400">Puntaje {formatPercent(score)}</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="meter"
            aria-label="Puntaje de riesgo"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(score * 100)}
          >
            <div className={`h-full rounded-full ${TONE_DOT[tone]}`} style={{ width: `${Math.max(2, score * 100)}%` }} />
          </div>
        </div>
      </div>
      {signals.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No se detectaron señales de manipulación.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {signals.map((s) => (
            <li key={s.id} className="flex items-start gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <code className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">{s.id}</code>
                <p className="text-sm text-slate-600 dark:text-slate-400">{s.detail}</p>
              </div>
              <span className="tabular shrink-0 text-xs text-slate-500 dark:text-slate-400" title="Peso de la señal">
                peso {formatNumber(s.weight)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
