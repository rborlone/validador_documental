import type { ValidationCheck } from '../../api/types';
import { SEVERITY_LABEL } from '../../lib/format';
import { CheckIcon, XIcon } from '../icons';
import { Badge, Section } from '../ui';

export function Checks({ checks }: { checks: ValidationCheck[] }) {
  const passed = checks.filter((c) => c.passed).length;
  // Primero los fallidos (errores antes que advertencias), luego los aprobados.
  const sorted = [...checks].sort(
    (a, b) => Number(a.passed) - Number(b.passed) || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1),
  );
  return (
    <Section title="Validaciones" description={`${passed} de ${checks.length} aprobadas`}>
      {checks.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">El template no define validaciones para este tipo.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((check) => (
            <li key={check.id} className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
                  check.passed
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : check.severity === 'error'
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                }`}
              >
                {check.passed ? <CheckIcon className="size-3.5" strokeWidth={2.5} /> : <XIcon className="size-3.5" strokeWidth={2.5} />}
                <span className="sr-only">{check.passed ? 'Aprobada' : 'No aprobada'}</span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">{check.id}</code>
                  {!check.passed && (
                    <Badge tone={check.severity === 'error' ? 'danger' : 'warning'}>{SEVERITY_LABEL[check.severity]}</Badge>
                  )}
                </div>
                {check.detail && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{check.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
