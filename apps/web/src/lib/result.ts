import type { ExtractedField, ValidationResult } from '../api/types';

export type TableField = ExtractedField & { value: Record<string, unknown>[] };

/** Campos cuyo valor es un arreglo de objetos (p. ej. `lineas`): se muestran como tabla aparte. */
export function isTableField(field: ExtractedField): field is TableField {
  return (
    Array.isArray(field.value) &&
    field.value.length > 0 &&
    field.value.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))
  );
}

/** Separa los campos escalares de los tabulares (líneas). */
export function splitExtracted(extracted: ValidationResult['extracted']): {
  scalars: [string, ExtractedField][];
  tables: [string, TableField][];
} {
  const scalars: [string, ExtractedField][] = [];
  const tables: [string, TableField][] = [];
  for (const [name, field] of Object.entries(extracted)) {
    if (isTableField(field)) tables.push([name, field]);
    else scalars.push([name, field]);
  }
  return { scalars, tables };
}
