/**
 * Sanea un nombre de archivo para usarlo en el nombre del blob:
 * quita tildes y rutas, reemplaza caracteres no seguros y limita el largo.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+/, '')
    .slice(-120);
  return clean.length > 0 ? clean : 'archivo';
}

/** Nombre original para mostrar: sin rutas, sin caracteres de control y con largo acotado. */
export function displayFilename(name: string): string {
  const base = [...(name.split(/[\\/]/).pop() ?? '')]
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('')
    .trim();
  return (base.length > 0 ? base : 'archivo').slice(0, 255);
}

/** `yyyy/mm/dd/<uuid>/<filename-saneado>` (fecha UTC). */
export function buildBlobName(id: string, filename: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}/${id}/${sanitizeFilename(filename)}`;
}
