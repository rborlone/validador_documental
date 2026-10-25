/** Tipos de documento soportados (ids de contracts/README.md) con su etiqueta para la UI. */
export const DOCUMENT_TYPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'factura_sii', label: 'Factura electrónica SII' },
  { id: 'orden_compra', label: 'Orden de compra' },
  { id: 'certificado_vigencia', label: 'Certificado con vigencia' },
  { id: 'cedula_identidad', label: 'Cédula de identidad' },
  { id: 'contrato', label: 'Contrato' },
  { id: 'certificado_accidentabilidad', label: 'Certificado de accidentabilidad' },
  { id: 'carpeta_tributaria', label: 'Carpeta tributaria SII' },
  { id: 'certificado_f30', label: 'Certificado F30 / F30-1' },
];
