import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DocumentDetail as DocumentDetailModel, ValidationResult } from '../api/types';
import fixture from '../test/fixtures/result.factura.json';
import { DocumentDetail } from './DocumentDetail';

const result = fixture as ValidationResult;

const makeDoc = (overrides: Partial<DocumentDetailModel> = {}): DocumentDetailModel => ({
  id: result.documentId,
  filename: 'Factura.pdf',
  contentType: 'application/pdf',
  sizeBytes: 120_000,
  status: 'COMPLETED',
  expectedType: null,
  documentType: 'factura_sii',
  verdict: 'VALID',
  createdAt: '2026-10-24T10:00:00.000Z',
  updatedAt: '2026-10-24T10:00:05.000Z',
  attempts: 1,
  result,
  error: null,
  ...overrides,
});

const renderDetail = (doc: DocumentDetailModel) =>
  render(<DocumentDetail document={doc} isLoading={false} error={null} onRetry={() => {}} typeLabels={{}} />);

describe('DocumentDetail', () => {
  it('muestra veredicto, tipo detectado, campos, líneas, checks, autenticidad y firma', async () => {
    renderDetail(makeDoc());

    expect(screen.getByRole('heading', { name: 'Factura.pdf' })).toBeInTheDocument();
    expect(screen.getByTestId('verdict')).toHaveTextContent('Válido');
    expect(screen.getByText('Factura electrónica SII')).toBeInTheDocument();
    expect(screen.getByTitle('Método de clasificación')).toHaveTextContent('Reglas');

    // Campos extraídos
    const fields = screen.getByRole('region', { name: 'Campos extraídos' });
    const rutRow = within(fields).getByRole('row', { name: /Rut emisor/ });
    expect(within(rutRow).getByText('76.123.456-0')).toBeInTheDocument();
    expect(within(rutRow).getByText('Texto')).toBeInTheDocument();
    expect(within(rutRow).getByRole('meter')).toHaveAttribute('aria-valuenow', '98');
    expect(within(fields).getByRole('row', { name: /Monto total/ })).toHaveTextContent('1.487.500');
    expect(within(within(fields).getByRole('row', { name: /Forma pago/ })).getByText('IA')).toBeInTheDocument();
    expect(within(fields).queryByText('Lineas')).not.toBeInTheDocument();

    // Líneas
    const lines = screen.getByRole('region', { name: 'Lineas' });
    expect(within(lines).getAllByRole('row')).toHaveLength(3);
    expect(within(lines).getByText('Licencia software anual')).toBeInTheDocument();

    // Checks
    const checks = screen.getByRole('region', { name: 'Validaciones' });
    expect(within(checks).getByText('7 de 7 aprobadas')).toBeInTheDocument();
    expect(within(checks).getByText('totals.iva')).toBeInTheDocument();

    // Autenticidad
    const auth = screen.getByRole('region', { name: 'Autenticidad' });
    expect(within(auth).getByText('Bajo')).toBeInTheDocument();
    expect(within(auth).getByText('pdf.producer')).toBeInTheDocument();

    // Uso de IA: para qué se llamó y qué campos se pidieron
    const ia = screen.getByRole('region', { name: 'Uso de IA' });
    expect(within(ia).getByText(/1 llamada · 7\.089 tokens/)).toBeInTheDocument();
    expect(within(ia).getByText('Completar campos que las reglas no leyeron')).toBeInTheDocument();
    expect(within(ia).getByText('forma_pago')).toBeInTheDocument();

    // Firma
    expect(screen.getByText(/Validación de firma/)).toHaveTextContent('Validación de firma: próximamente.');

    // Visor JSON colapsable
    const toggle = screen.getByRole('button', { name: 'Resultado JSON' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('json-viewer-body')).toHaveTextContent('"verdict": "VALID"');
    expect(screen.getByRole('button', { name: /Copiar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Descargar \.json/ })).toBeInTheDocument();
  });

  it('marca checks fallidos con su severidad', () => {
    const failing: ValidationResult = {
      ...result,
      verdict: 'INVALID',
      checks: [{ id: 'totals.total', passed: false, severity: 'error', detail: 'No cuadra.' }],
    };
    renderDetail(makeDoc({ verdict: 'INVALID', result: failing }));
    expect(screen.getByTestId('verdict')).toHaveTextContent('Inválido');
    const checks = screen.getByRole('region', { name: 'Validaciones' });
    expect(within(checks).getByText('No aprobada')).toBeInTheDocument();
    expect(within(checks).getByText('Error')).toBeInTheDocument();
  });

  it('muestra el error cuando el documento falló', () => {
    renderDetail(
      makeDoc({
        status: 'FAILED',
        verdict: null,
        result: null,
        error: { code: 'OCR_FAILED', message: 'No se pudo extraer texto.' },
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('La validación falló');
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo extraer texto.');
    expect(screen.queryByTestId('verdict')).not.toBeInTheDocument();
  });

  it('indica que está en proceso', () => {
    renderDetail(makeDoc({ status: 'PROCESSING', verdict: null, result: null }));
    expect(screen.getAllByText('Procesando').length).toBeGreaterThan(0);
    expect(screen.getByText(/te avisaremos al terminar/)).toBeInTheDocument();
  });

  it('distingue resultados sin IA de resultados antiguos sin detalle', () => {
    const { unmount } = renderDetail(makeDoc({ result: { ...result, llmCalls: [] } }));
    expect(screen.getByText('Resuelto solo con reglas y OCR, sin llamadas a la IA.')).toBeInTheDocument();
    unmount();
    const legacy: ValidationResult = { ...result, llmUsed: true };
    delete legacy.llmCalls;
    renderDetail(makeDoc({ result: legacy }));
    expect(screen.getByText(/Usó IA \(sin detalle/)).toBeInTheDocument();
  });
});
