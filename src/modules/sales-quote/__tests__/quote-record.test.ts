/** Lo que se guarda de una cotización: validado y recalculado en el servidor. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeQuoteDecision, quoteDecisionButtons, QUOTE_APPROVE_ACTION_ID, QUOTE_REJECT_ACTION_ID } from '@/modules/notifications/quote-approval-slack';
import { defaultQuote2026Input } from '../engine-2026';
import { defaultQuote2027Input } from '../engine-2027';
import { buildQuoteRecord, initialQuoteStatus, isQuoteSendable } from '../quote-record';
import { applySalesRules2027 } from '../sales-rules';

const base2027 = {
  version: '2027' as const,
  clientName: '  Acme  ',
  accountId: null,
  accountType: 'ventas' as const,
  input: { ...defaultQuote2027Input(), employees: 500, licenses: 480, years: 2, content: true, performanceCulture: true },
};

describe('guardar una cotización 2027', () => {
  it('recalcula en el servidor: mismas cifras que el sitio original', () => {
    const outcome = buildQuoteRecord(base2027);
    assert.ok(outcome.ok);
    if (!outcome.ok) return;
    assert.equal(outcome.record.clientName, 'Acme');
    assert.equal(outcome.record.perYearTotal, 11358);
    assert.equal(outcome.record.contractTotal, 22716);
    assert.equal(outcome.record.needsApproval, false);
    assert.equal(initialQuoteStatus(outcome.record), 'ready');
    assert.equal(outcome.record.result.approval, null);
  });

  it('🔴 las cifras que mande el navegador no cuentan: se descartan', () => {
    const outcome = buildQuoteRecord({ ...base2027, totals: { contract: 1 }, input: { ...base2027.input, contract: 1 } });
    assert.ok(outcome.ok);
    if (outcome.ok) assert.equal(outcome.record.contractTotal, 22716);
  });

  it('una línea bajo el mínimo queda pendiente de aprobación, con el texto para el aprobador', () => {
    const outcome = buildQuoteRecord({ ...base2027, input: { ...base2027.input, manualDiscounts: { creator: 0.2 } } });
    assert.ok(outcome.ok);
    if (!outcome.ok) return;
    assert.equal(outcome.record.needsApproval, true);
    assert.equal(initialQuoteStatus(outcome.record), 'pending_approval');
    assert.deepEqual(outcome.record.result.lines.filter((line) => line.belowMinimum).map((line) => line.id), ['creator']);
    assert.match(outcome.record.result.approval?.subject ?? '', /Acme · Colombia/);
  });

  it('descuentos manuales de líneas que no existen se ignoran', () => {
    const outcome = buildQuoteRecord({ ...base2027, input: { ...base2027.input, manualDiscounts: { inventada: 0.9 } } });
    assert.ok(outcome.ok);
    if (outcome.ok) assert.deepEqual(Object.keys((outcome.record.input as { manualDiscounts: object }).manualDiscounts), []);
  });

  it('🔴 más de 10.000 licencias no se guarda (Aprendizaje se cotiza con Operaciones)', () => {
    const outcome = buildQuoteRecord({
      ...base2027,
      input: { ...base2027.input, licenses: 15_000, selection: { tier: 'basic', packs: 0 } },
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(outcome.error, /Operaciones/);
  });

  it('sin productos no se guarda', () => {
    const outcome = buildQuoteRecord({ ...base2027, input: defaultQuote2027Input() });
    assert.equal(outcome.ok, false);
  });

  it('🔴 datos fuera de forma no se guardan', () => {
    for (const bad of [
      null,
      { ...base2027, version: '2030' },
      { ...base2027, accountType: 'otro' },
      // El cotizador es solo de Ventas: Customer Success ya no se acepta.
      { ...base2027, accountType: 'cs' },
      { ...base2027, accountId: 'no-es-un-uuid' },
      { ...base2027, input: { ...base2027.input, payments: 7 } },
      { ...base2027, input: { ...base2027.input, years: 5 } },
      { ...base2027, input: { ...base2027.input, lmsAi: { tier: 'mega', packs: 0 } } },
    ]) {
      assert.equal(buildQuoteRecord(bad).ok, false, JSON.stringify(bad)?.slice(0, 80));
    }
  });
});

describe('reglas de Ventas (Rubén Candia, 24-11)', () => {
  const selectionOnly = {
    ...base2027.input,
    includeLearning: false,
    performanceCulture: false,
    selection: { tier: 'basic' as const, packs: 0 },
    lmsAi: { tier: 'pro' as const, packs: 2 },
  };

  it('LMS AI es parte de Aprendizaje: al quitar Aprendizaje se quita LMS AI', () => {
    const input = applySalesRules2027(selectionOnly);
    assert.equal(input.includeLearning, false);
    assert.deepEqual(input.lmsAi, { tier: null, packs: 0 });
  });

  it('🔴 el servidor no guarda LMS AI sin Aprendizaje', () => {
    const outcome = buildQuoteRecord({ ...base2027, input: selectionOnly });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(outcome.error, /LMS AI es parte de Aprendizaje/);
  });

  it('con Aprendizaje, LMS AI se guarda normal', () => {
    const outcome = buildQuoteRecord({ ...base2027, input: { ...base2027.input, lmsAi: { tier: 'basic', packs: 0 } } });
    assert.ok(outcome.ok);
    if (outcome.ok) assert.ok(outcome.record.result.lines.some((line) => line.id === 'lmsai'));
  });

  it('guarda la empresa de HubSpot a la que se cotiza; un id que no es de HubSpot no pasa', () => {
    const outcome = buildQuoteRecord({ ...base2027, hubspotCompanyId: '18493822001' });
    assert.ok(outcome.ok);
    if (outcome.ok) assert.equal(outcome.record.result.hubspotCompanyId, '18493822001');
    assert.equal(buildQuoteRecord({ ...base2027, hubspotCompanyId: 'abc' }).ok, false);
    const withoutId = buildQuoteRecord(base2027);
    assert.ok(withoutId.ok);
    if (withoutId.ok) assert.equal(withoutId.record.result.hubspotCompanyId, null);
  });
});

describe('guardar una cotización 2026', () => {
  const base2026 = {
    version: '2026' as const,
    clientName: '',
    accountId: null,
    accountType: 'ventas' as const,
    input: { ...defaultQuote2026Input(), licenses: 480, years: 5, modules: { assessments: true, desempeno: true, planes: true, encuestas: true } },
  };

  it('nunca pide aprobación: el precio se queda en el mínimo', () => {
    const outcome = buildQuoteRecord(base2026);
    assert.ok(outcome.ok);
    if (!outcome.ok) return;
    assert.equal(outcome.record.needsApproval, false);
    assert.equal(outcome.record.clientName, null);
    assert.ok(outcome.record.result.lines.every((line) => line.priceUnit >= line.minUnit));
  });

  it('más de 25.000 licencias no se guarda', () => {
    assert.equal(buildQuoteRecord({ ...base2026, input: { ...base2026.input, licenses: 30_000 } }).ok, false);
  });
});

describe('estados', () => {
  it('solo lista o aprobada se puede usar con el cliente', () => {
    assert.equal(isQuoteSendable('ready'), true);
    assert.equal(isQuoteSendable('approved'), true);
    assert.equal(isQuoteSendable('pending_approval'), false);
    assert.equal(isQuoteSendable('rejected'), false);
  });
});

describe('botones de Slack', () => {
  const id = '0f5c1f0e-6a8d-4d5e-9a40-1c2b3d4e5f60';

  it('ida y vuelta: aprobar y rechazar', () => {
    const [approve, reject] = quoteDecisionButtons(id);
    assert.deepEqual(decodeQuoteDecision(approve.action_id, approve.value), { quoteId: id, decision: 'approve' });
    assert.deepEqual(decodeQuoteDecision(reject.action_id, reject.value), { quoteId: id, decision: 'reject' });
  });

  it('🔴 un botón que no es del cotizador o viene alterado no decide nada', () => {
    assert.equal(decodeQuoteDecision('sellup_credit_approve', JSON.stringify({ q: id })), null);
    assert.equal(decodeQuoteDecision(QUOTE_APPROVE_ACTION_ID, JSON.stringify({ q: 'abc' })), null);
    assert.equal(decodeQuoteDecision(QUOTE_REJECT_ACTION_ID, 'no-es-json'), null);
    assert.equal(decodeQuoteDecision(QUOTE_APPROVE_ACTION_ID, 'x'.repeat(500)), null);
  });
});
