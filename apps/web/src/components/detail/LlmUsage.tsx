import type { LlmCall } from '../../api/types';
import { LLM_PURPOSE_LABEL } from '../../lib/format';
import { Badge, Section } from '../ui';

const numberFormat = new Intl.NumberFormat('es-CL');

function summary(calls: LlmCall[] | undefined, llmUsed: boolean | undefined): string {
  // Los resultados anteriores a llmCalls solo traen llmUsed.
  if (calls === undefined) return llmUsed ? 'Usó IA (sin detalle: el documento se validó con una versión anterior).' : 'Sin datos de uso de IA.';
  if (calls.length === 0) return 'Resuelto solo con reglas y OCR, sin llamadas a la IA.';
  const tokens = calls.reduce((sum, c) => sum + c.inputTokens + c.outputTokens, 0);
  return `${calls.length} ${calls.length === 1 ? 'llamada' : 'llamadas'} · ${numberFormat.format(tokens)} tokens`;
}

export function LlmUsage({ calls, llmUsed }: { calls: LlmCall[] | undefined; llmUsed: boolean | undefined }) {
  const list = calls ?? [];
  return (
    <Section title="Uso de IA" description={summary(calls, llmUsed)}>
      {list.length > 0 && (
        <ul className="space-y-2">
          {list.map((call, i) => (
            <li key={`${call.purpose}-${i}`} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800 dark:text-slate-200">{LLM_PURPOSE_LABEL[call.purpose] ?? call.purpose}</span>
                {call.outcome !== 'ok' && <Badge tone="warning">{call.outcome}</Badge>}
              </div>
              {call.fields && call.fields.length > 0 && (
                <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                  Campos pedidos: <span className="font-mono text-xs">{call.fields.join(', ')}</span>
                </p>
              )}
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {call.model} · {(call.ms / 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} s ·{' '}
                {numberFormat.format(call.inputTokens)} tokens de entrada · {numberFormat.format(call.outputTokens)} de salida
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
