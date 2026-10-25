import { decideTransition, ResultEvent } from './status-transition';

const id = '11111111-1111-4111-8111-111111111111';
const started = (attempt: number): ResultEvent => ({ kind: 'started', documentId: id, attempt });
const completed: ResultEvent = { kind: 'completed', documentId: id, result: { verdict: 'VALID' }, verdict: 'VALID', documentType: 'factura_sii' };
const failed: ResultEvent = { kind: 'failed', documentId: id, attempt: 3, error: { code: 'PROCESSING_ERROR', message: 'x' } };

describe('decideTransition', () => {
  it('QUEUED → PROCESSING con started', () => {
    expect(decideTransition({ status: 'QUEUED', attempts: 0 }, started(1))).toEqual({ status: 'PROCESSING', attempts: 1 });
  });

  it('ignora un started duplicado del mismo intento (idempotente por documentId + attempt)', () => {
    expect(decideTransition({ status: 'PROCESSING', attempts: 1 }, started(1))).toBeNull();
  });

  it('acepta el started de un reintento posterior', () => {
    expect(decideTransition({ status: 'PROCESSING', attempts: 1 }, started(2))).toEqual({ status: 'PROCESSING', attempts: 2 });
  });

  it('nunca retrocede: started después de COMPLETED o FAILED se ignora', () => {
    expect(decideTransition({ status: 'COMPLETED', attempts: 1 }, started(2))).toBeNull();
    expect(decideTransition({ status: 'FAILED', attempts: 3 }, started(4))).toBeNull();
  });

  it('PROCESSING → COMPLETED guarda resultado, veredicto y tipo', () => {
    expect(decideTransition({ status: 'PROCESSING', attempts: 1 }, completed)).toMatchObject({
      status: 'COMPLETED',
      verdict: 'VALID',
      documentType: 'factura_sii',
      error: null,
    });
  });

  it('acepta completed aunque el started se haya perdido o llegue después', () => {
    expect(decideTransition({ status: 'QUEUED', attempts: 0 }, completed)).toMatchObject({ status: 'COMPLETED', attempts: 1 });
  });

  it('los estados terminales son finales', () => {
    expect(decideTransition({ status: 'COMPLETED', attempts: 1 }, completed)).toBeNull();
    expect(decideTransition({ status: 'COMPLETED', attempts: 1 }, failed)).toBeNull();
    expect(decideTransition({ status: 'FAILED', attempts: 3 }, completed)).toBeNull();
  });

  it('PROCESSING → FAILED guarda el error y el intento', () => {
    expect(decideTransition({ status: 'PROCESSING', attempts: 2 }, failed)).toEqual({
      status: 'FAILED',
      attempts: 3,
      error: { code: 'PROCESSING_ERROR', message: 'x' },
    });
  });
});
