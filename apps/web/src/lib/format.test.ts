import { describe, expect, it } from 'vitest';
import {
  completionMessage,
  formatBytes,
  formatDocumentType,
  formatStatus,
  formatValue,
  formatVerdict,
  humanize,
  isTerminal,
} from './format';

describe('formatStatus', () => {
  it.each([
    ['QUEUED', 'En cola'],
    ['PROCESSING', 'Procesando'],
    ['COMPLETED', 'Completado'],
    ['FAILED', 'Error'],
  ] as const)('%s → %s', (status, label) => {
    expect(formatStatus(status)).toBe(label);
  });
});

describe('formatVerdict', () => {
  it.each([
    ['VALID', 'Válido'],
    ['INVALID', 'Inválido'],
    ['REVIEW', 'Revisar'],
  ] as const)('%s → %s', (verdict, label) => {
    expect(formatVerdict(verdict)).toBe(label);
  });

  it('devuelve null sin veredicto', () => {
    expect(formatVerdict(null)).toBeNull();
    expect(formatVerdict(undefined)).toBeNull();
  });
});

describe('completionMessage', () => {
  it('COMPLETED con veredicto', () => {
    expect(completionMessage('Factura.pdf', 'COMPLETED', 'VALID')).toBe('Factura.pdf: validación completada — Válido');
  });
  it('COMPLETED sin veredicto', () => {
    expect(completionMessage('a.pdf', 'COMPLETED', null)).toBe('a.pdf: validación completada');
  });
  it('FAILED', () => {
    expect(completionMessage('a.pdf', 'FAILED')).toBe('a.pdf: la validación falló');
  });
  it('estados no terminales no generan mensaje', () => {
    expect(completionMessage('a.pdf', 'QUEUED')).toBeNull();
    expect(completionMessage('a.pdf', 'PROCESSING')).toBeNull();
  });
});

describe('otros formatos', () => {
  it('isTerminal', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(true);
    expect(isTerminal('PROCESSING')).toBe(false);
  });
  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
  });
  it('humanize', () => {
    expect(humanize('rut_emisor')).toBe('Rut emisor');
    expect(humanize('precioUnitario')).toBe('Precio unitario');
  });
  it('formatDocumentType usa etiquetas del API y luego las conocidas', () => {
    expect(formatDocumentType('factura_sii')).toBe('Factura electrónica SII');
    expect(formatDocumentType('factura_sii', { factura_sii: 'Factura' })).toBe('Factura');
    expect(formatDocumentType('nuevo_tipo')).toBe('Nuevo tipo');
    expect(formatDocumentType(null)).toBe('—');
  });
  it('formatValue', () => {
    expect(formatValue(1487500)).toBe('1.487.500');
    expect(formatValue(null)).toBe('—');
    expect(formatValue(true)).toBe('Sí');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});
