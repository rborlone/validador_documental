export const MAX_FILES = 10;
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'] as const;
const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff'];

/** Valor para el atributo `accept` del input. */
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_MIME_TYPES, ...ACCEPTED_EXTENSIONS].join(',');

export interface RejectedFile {
  file: File;
  reason: string;
}

export interface FileSelection {
  accepted: File[];
  rejected: RejectedFile[];
}

function isAcceptedType(file: File): boolean {
  if ((ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) return true;
  // Algunos navegadores no informan el MIME (p. ej. TIFF): se recurre a la extensión.
  const name = file.name.toLowerCase();
  return file.type === '' && ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Valida en el cliente la selección contra los límites del contrato
 * (1..10 archivos, 20 MB c/u, PDF/PNG/JPEG/TIFF). `alreadySelected` cuenta los ya elegidos.
 */
export function validateFiles(files: readonly File[], alreadySelected = 0): FileSelection {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    if (!isAcceptedType(file)) {
      rejected.push({ file, reason: 'Formato no admitido (solo PDF, PNG, JPEG o TIFF).' });
    } else if (file.size > MAX_FILE_SIZE_BYTES) {
      rejected.push({ file, reason: 'Supera el máximo de 20 MB.' });
    } else if (file.size === 0) {
      rejected.push({ file, reason: 'El archivo está vacío.' });
    } else if (alreadySelected + accepted.length >= MAX_FILES) {
      rejected.push({ file, reason: `Máximo ${MAX_FILES} archivos por envío.` });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}
