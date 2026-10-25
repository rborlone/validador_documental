import { buildBlobName, displayFilename, sanitizeFilename } from './filename';
import { detectMime } from './mime';

describe('detectMime', () => {
  it.each([
    [Buffer.from('%PDF-1.4 ...'), 'application/pdf'],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png'],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]), 'image/jpeg'],
    [Buffer.from([0x49, 0x49, 0x2a, 0x00, 0]), 'image/tiff'],
    [Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0]), 'image/tiff'],
    [Buffer.from('GIF89a'), null],
    [Buffer.from('PK\u0003\u0004'), null],
  ])('detecta %p como %p', (buf, expected) => {
    expect(detectMime(buf)).toBe(expected);
  });
});

describe('nombres de archivo', () => {
  it('sanea para el blob', () => {
    expect(sanitizeFilename('C:\\docs\\Cédula  de identidad (1).PDF')).toBe('Cedula_de_identidad_1_.PDF');
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('...')).toBe('archivo');
  });

  it('arma yyyy/mm/dd/<uuid>/<nombre>', () => {
    const name = buildBlobName('0b0b0b0b-0000-4000-8000-000000000000', 'factura.pdf', new Date('2026-03-07T23:00:00Z'));
    expect(name).toBe('2026/03/07/0b0b0b0b-0000-4000-8000-000000000000/factura.pdf');
  });

  it('limpia el nombre para mostrar', () => {
    expect(displayFilename('a/b/Factura\u0000 1.pdf')).toBe('Factura 1.pdf');
  });
});

describe('contentDisposition', () => {
  it('incluye nombre ASCII y UTF-8', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { contentDisposition } = require('./documents.controller') as typeof import('./documents.controller');
    expect(contentDisposition('Cédula "1".pdf')).toBe(`inline; filename="Cedula _1_.pdf"; filename*=UTF-8''C%C3%A9dula%20%221%22.pdf`);
  });
});
