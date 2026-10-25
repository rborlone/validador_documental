import type { ExtractedField, FieldSource } from '../../api/types';
import { formatValue, humanize, SOURCE_LABEL, type Tone } from '../../lib/format';
import { Badge, ConfidenceBar, EmptyState, Section } from '../ui';
import { InboxIcon } from '../icons';
import type { TableField } from '../../lib/result';

const SOURCE_TONE: Record<FieldSource, Tone> = { text: 'neutral', ocr: 'info', llm: 'warning' };

export function SourceBadge({ source }: { source: FieldSource }) {
  return (
    <Badge tone={SOURCE_TONE[source]} title={`Origen: ${SOURCE_LABEL[source]}`}>
      {SOURCE_LABEL[source]}
    </Badge>
  );
}

export function ExtractedFields({ fields }: { fields: [string, ExtractedField][] }) {
  return (
    <Section title="Campos extraídos" description="Valor, origen de la extracción y confianza de cada campo del template.">
      {fields.length === 0 ? (
        <EmptyState icon={<InboxIcon className="size-6" />} title="Sin campos extraídos" />
      ) : (
        <div className="-mx-4 -my-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2">Campo</th>
                <th scope="col" className="px-4 py-2">Valor</th>
                <th scope="col" className="px-4 py-2">Origen</th>
                <th scope="col" className="px-4 py-2">Confianza</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {fields.map(([name, field]) => (
                <tr key={name}>
                  <th scope="row" className="px-4 py-2 text-left font-medium whitespace-nowrap text-slate-700 dark:text-slate-300">
                    {humanize(name)}
                    <span className="block font-mono text-[11px] font-normal text-slate-400">{name}</span>
                  </th>
                  <td className="tabular px-4 py-2 break-words text-slate-900 dark:text-slate-100">{formatValue(field.value)}</td>
                  <td className="px-4 py-2">
                    <SourceBadge source={field.source} />
                  </td>
                  <td className="px-4 py-2">
                    <ConfidenceBar value={field.confidence} label={`Confianza de ${humanize(name)}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function LineItems({ name, field }: { name: string; field: TableField }) {
  const columns = Array.from(new Set(field.value.flatMap((row) => Object.keys(row))));
  return (
    <Section
      title={humanize(name)}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          {field.value.length} {field.value.length === 1 ? 'fila' : 'filas'} · <SourceBadge source={field.source} />
          <ConfidenceBar value={field.confidence} label={`Confianza de ${humanize(name)}`} />
        </span>
      }
    >
      <div className="-mx-4 -my-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th scope="col" className="w-10 px-4 py-2">#</th>
              {columns.map((c) => (
                <th key={c} scope="col" className="px-4 py-2 whitespace-nowrap">
                  {humanize(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {field.value.map((row, i) => (
              <tr key={i}>
                <td className="tabular px-4 py-2 text-slate-400">{i + 1}</td>
                {columns.map((c) => {
                  const v = row[c];
                  return (
                    <td key={c} className={`tabular px-4 py-2 text-slate-900 dark:text-slate-100 ${typeof v === 'number' ? 'text-right' : ''}`}>
                      {formatValue(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
