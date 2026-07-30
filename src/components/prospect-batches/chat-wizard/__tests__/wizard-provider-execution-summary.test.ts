/**
 * A1-APOLLO-WIZARD-1 — Presentación del resultado de proveedor en el wizard.
 *
 * Puro, sin DOM. Cero llamadas reales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  presentProviderSkip,
  presentProviderRunSummary,
  type ProviderRunSummaryInput,
} from '../wizard-provider-execution-summary';
import { mapProviderSkip, mapExecutionError } from '../wizard-execution-error-map';
import type { WizardApolloSkipReason } from '@/modules/prospect-batches/chat-wizard-execution/wizard-apollo-availability';

const ALL_REASONS: WizardApolloSkipReason[] = [
  'feature_disabled',
  'capability_unavailable',
  'role_not_permitted',
  'budget_unavailable',
  'provider_not_configured',
  'credential_unavailable',
  'availability_check_failed',
];

const baseRun: ProviderRunSummaryInput = {
  provider: 'apollo_organizations',
  maxCandidates: 3,
  maxCredits: 3,
  pagesProcessed: 1,
  estimatedCredits: 3,
  actualCredits: null,
  resultsFound: 3,
  resultsDiscarded: 1,
  duplicatesRemoved: 0,
  errorCategory: null,
  rateLimited: false,
  indeterminatePages: [],
};

describe('A1-APOLLO-WIZARD-1 · presentación de proveedor omitido', () => {
  it('cubre todos los motivos de omisión', () => {
    for (const reason of ALL_REASONS) {
      const presentation = presentProviderSkip(reason);
      assert.ok(presentation.title.length > 0, `${reason} necesita título`);
      assert.ok(presentation.detail.length > 0, `${reason} necesita detalle`);
      assert.equal(presentation.creditsStatement, 'no_credits_used');
    }
  });

  it('un proveedor omitido siempre declara cero créditos: es un hecho comprobado', () => {
    for (const reason of ALL_REASONS) {
      assert.equal(presentProviderSkip(reason).creditsStatement, 'no_credits_used');
    }
  });

  it('sólo ofrece reintento donde el estado puede cambiar solo', () => {
    assert.equal(presentProviderSkip('capability_unavailable').canRetry, true);
    assert.equal(presentProviderSkip('availability_check_failed').canRetry, true);
    for (const reason of ['feature_disabled', 'role_not_permitted', 'credential_unavailable'] as const) {
      assert.equal(presentProviderSkip(reason).canRetry, false, `${reason} no debe ofrecer reintento`);
    }
  });

  it('ningún detalle revela flags, roles ni credenciales', () => {
    for (const reason of ALL_REASONS) {
      const detail = presentProviderSkip(reason).detail.toLowerCase();
      for (const term of ['enable_', 'flag', 'apollo', 'credencial', 'api key', 'admin', 'vault']) {
        assert.equal(detail.includes(term), false, `${reason} no debe mencionar "${term}"`);
      }
    }
  });

  it('el mapa de errores usa el motivo cuando existe', () => {
    const mapped = mapProviderSkip('budget_unavailable');
    assert.equal(mapped.message, presentProviderSkip('budget_unavailable').detail);
    assert.equal(mapped.retryable, false);
  });

  it('sin motivo cae al mensaje genérico previo, sin cambiar el comportamiento', () => {
    assert.deepEqual(mapProviderSkip(undefined), mapExecutionError('PROVIDER_UNAVAILABLE'));
  });
});

describe('A1-APOLLO-WIZARD-1 · resumen de ejecución', () => {
  it('comunica páginas, resultados, descartes, duplicados, créditos y topes', () => {
    const { rows } = presentProviderRunSummary(baseRun);
    const keys = rows.map((r) => r.key);
    for (const expected of [
      'pages_processed',
      'results_found',
      'results_discarded',
      'duplicates_removed',
      'credits_used',
      'max_credits',
      'max_candidates',
    ]) {
      assert.ok(keys.includes(expected), `falta la fila ${expected}`);
    }
  });

  it('marca el crédito estimado como estimado, no como hecho', () => {
    const { rows, creditsUncertain } = presentProviderRunSummary(baseRun);
    const credits = rows.find((r) => r.key === 'credits_used');
    assert.equal(credits?.value, '3 (estimado)');
    assert.equal(creditsUncertain, false);
  });

  it('prefiere el crédito verificado cuando existe', () => {
    const { rows } = presentProviderRunSummary({ ...baseRun, actualCredits: 2 });
    assert.equal(rows.find((r) => r.key === 'credits_used')?.value, '2');
  });

  // ── No afirmar 0 créditos antes de procesar la respuesta ───────────────────
  it('no afirma un consumo cuando nada se ha resuelto todavía', () => {
    const { rows, creditsUncertain } = presentProviderRunSummary({
      ...baseRun,
      estimatedCredits: null,
      actualCredits: null,
    });
    assert.equal(rows.find((r) => r.key === 'credits_used')?.value, 'Desconocido');
    assert.equal(creditsUncertain, true);
  });

  it('una página indeterminada vuelve incierto el consumo, aunque haya estimación', () => {
    const { rows, creditsUncertain, warning } = presentProviderRunSummary({
      ...baseRun,
      indeterminatePages: [2],
    });
    assert.equal(creditsUncertain, true);
    assert.equal(rows.find((r) => r.key === 'credits_used')?.value, 'Desconocido');
    assert.ok(warning?.includes('no pudo verificarse'));
  });

  it('distingue un cero conocido de un dato ausente', () => {
    const zeroKnown = presentProviderRunSummary({ ...baseRun, resultsFound: 0 });
    assert.equal(zeroKnown.rows.find((r) => r.key === 'results_found')?.value, '0');

    const unknown = presentProviderRunSummary({ ...baseRun, resultsFound: null });
    assert.equal(unknown.rows.find((r) => r.key === 'results_found')?.value, 'Desconocido');
  });

  it('avisa de rate limit y de error de proveedor', () => {
    assert.ok(
      presentProviderRunSummary({ ...baseRun, rateLimited: true }).warning?.includes('limitó'),
    );
    assert.ok(
      presentProviderRunSummary({ ...baseRun, errorCategory: 'provider_failure' }).warning?.includes('error del proveedor'),
    );
  });

  it('sin incidencias no inventa avisos', () => {
    assert.equal(presentProviderRunSummary(baseRun).warning, null);
  });

  it('el aviso de página indeterminada tiene prioridad sobre el de rate limit', () => {
    const { warning } = presentProviderRunSummary({
      ...baseRun,
      rateLimited: true,
      indeterminatePages: [1],
    });
    assert.ok(warning?.includes('no pudo verificarse'));
  });
});
