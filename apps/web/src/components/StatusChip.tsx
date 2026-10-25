import type { DocumentStatus, Verdict } from '../api/types';
import { STATUS_LABEL, STATUS_TONE, VERDICT_LABEL, VERDICT_TONE } from '../lib/format';
import { Badge } from './ui';

export function StatusChip({ status }: { status: DocumentStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot pulse={status === 'PROCESSING'}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <Badge tone={VERDICT_TONE[verdict]} {...(className ? { className } : {})} title="Veredicto">
      {VERDICT_LABEL[verdict]}
    </Badge>
  );
}
