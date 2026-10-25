import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE_BYTES, validateFiles } from './files';

const makeFile = (name: string, type: string, size = 100) => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('validateFiles', () => {
  it('acepta PDF, PNG, JPEG y TIFF', () => {
    const files = [
      makeFile('a.pdf', 'application/pdf'),
      makeFile('b.png', 'image/png'),
      makeFile('c.jpg', 'image/jpeg'),
      makeFile('d.tif', 'image/tiff'),
      makeFile('e.tiff', ''),
    ];
    expect(validateFiles(files).accepted).toHaveLength(5);
  });

  it('rechaza otros formatos y archivos sobre 20 MB', () => {
    const { accepted, rejected } = validateFiles([
      makeFile('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      makeFile('big.pdf', 'application/pdf', MAX_FILE_SIZE_BYTES + 1),
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected.map((r) => r.reason)).toEqual([
      'Formato no admitido (solo PDF, PNG, JPEG o TIFF).',
      'Supera el máximo de 20 MB.',
    ]);
  });

  it('limita a 10 archivos contando los ya seleccionados', () => {
    const files = Array.from({ length: 5 }, (_, i) => makeFile(`f${i}.pdf`, 'application/pdf'));
    const { accepted, rejected } = validateFiles(files, 7);
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.reason).toBe('Máximo 10 archivos por envío.');
  });
});
