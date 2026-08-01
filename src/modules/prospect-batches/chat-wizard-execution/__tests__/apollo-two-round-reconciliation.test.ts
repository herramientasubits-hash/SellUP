/**
 * Reconciliación económica de una corrida de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 12 · casos 25–30.
 *
 * Offline: filas de `provider_usage_logs` como fixtures. Ni una consulta a
 * Supabase, ni una llamada a Apollo, ni un crédito.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileWizardRunSpend,
  type ReconcilableUsageRow,
} from '../wizard-run-reconciliation';
import {
  buildWizardRunCorrelation,
  toRunCorrelationMetadata,
  RUN_CORRELATION_METADATA_KEY,
  type WizardRunCorrelation,
} from '../wizard-run-correlation';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function correlation(overrides?: { clientRequestId?: string }): WizardRunCorrelation {
  return buildWizardRunCorrelation({
    userId: 'user-1',
    clientRequestId: overrides?.clientRequestId ?? 'client-request-1',
    reservationId: 'reservation-1',
    batchId: 'batch-1',
    providerKey: 'apollo_organizations',
    requestSignature: 'CO|v1|industry|sub|12|provider:apollo_organizations:none:global_default_provider',
  });
}

/**
 * Fila con las columnas de la migración 100 rellenas — el estado que
 * `ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS=true` produce.
 */
function columnRow(
  run: WizardRunCorrelation,
  input: {
    operation: 'organizations_search' | 'organization_enrichment';
    credits: number;
    roundNumber: number;
    usageKey: string;
  },
): ReconcilableUsageRow {
  return {
    provider_key: 'apollo',
    operation_key: input.operation,
    credits_used: input.credits,
    usage_key: input.usageKey,
    batch_id: run.batchId,
    reservation_id: run.reservationId,
    client_request_id: run.clientRequestId,
    wizard_run_id: run.wizardRunId,
    request_fingerprint: run.requestFingerprint,
    idempotency_key: run.idempotencyKey,
    billing_state: 'recorded',
    metadata: {
      [RUN_CORRELATION_METADATA_KEY]: toRunCorrelationMetadata(run),
      round_number: input.roundNumber,
    },
  };
}

function reconcile(rows: readonly ReconcilableUsageRow[], run = correlation()) {
  return reconcileWizardRunSpend({
    correlation: run,
    discoveryProvider: 'apollo_organizations',
    estimatedCredits: 12,
    reservedCredits: 12,
    rows,
  });
}

// ─── Casos 25–30 ──────────────────────────────────────────────────────────────

describe('§ 12 · reconciliación de dos rondas', () => {
  test('caso 25 — las búsquedas de ambas rondas se reconcilian contra la MISMA reserva', () => {
    const run = correlation();
    const result = reconcile(
      [
        columnRow(run, { operation: 'organizations_search', credits: 5, roundNumber: 1, usageKey: 'search-r1' }),
        columnRow(run, { operation: 'organizations_search', credits: 3, roundNumber: 2, usageKey: 'search-r2' }),
      ],
      run,
    );

    assert.equal(result.matchedRowCount, 2);
    assert.equal(result.foreignRowCount, 0);
    assert.equal(result.perOperationCredits['organizations_search'], 8);
    assert.equal(result.recordedUsageCredits, 8);
  });

  test('caso 26 — los enrichments de ambas rondas se suman UNA sola vez', () => {
    const run = correlation();
    const rows = [
      columnRow(run, { operation: 'organizations_search', credits: 5, roundNumber: 1, usageKey: 'search-r1' }),
      columnRow(run, { operation: 'organization_enrichment', credits: 1, roundNumber: 1, usageKey: 'enrich-r1' }),
      columnRow(run, { operation: 'organization_enrichment', credits: 1, roundNumber: 2, usageKey: 'enrich-r2' }),
    ];

    // La misma lectura entregada dos veces (un reintento que releyó la tabla).
    const result = reconcile([...rows, ...rows], run);

    assert.equal(result.perOperationCredits['organization_enrichment'], 2);
    assert.equal(result.recordedUsageCredits, 7);
    assert.equal(result.matchedRowCount, 3);
  });

  test('caso 27 — columnas y metadata coinciden: sin anomalía de discrepancia', () => {
    const run = correlation();
    const result = reconcile(
      [columnRow(run, { operation: 'organizations_search', credits: 5, roundNumber: 1, usageKey: 'search-r1' })],
      run,
    );

    assert.ok(!result.anomalies.includes('column_metadata_correlation_mismatch'));
  });

  test('caso 28 — con las columnas vivas, correlationSource es "columns"', () => {
    const run = correlation();
    const result = reconcile(
      [
        columnRow(run, { operation: 'organizations_search', credits: 5, roundNumber: 1, usageKey: 'search-r1' }),
        columnRow(run, { operation: 'organizations_search', credits: 5, roundNumber: 2, usageKey: 'search-r2' }),
      ],
      run,
    );

    assert.equal(result.correlationSources.columns, 2);
    assert.equal(result.correlationSources.metadata, 0);
    assert.equal(result.correlationSources.none, 0);
  });

  test('caso 29 — dos corridas concurrentes no se mezclan', () => {
    const runA = correlation({ clientRequestId: 'client-request-a' });
    const runB = correlation({ clientRequestId: 'client-request-b' });

    const result = reconcileWizardRunSpend({
      correlation: runA,
      discoveryProvider: 'apollo_organizations',
      estimatedCredits: 12,
      reservedCredits: 12,
      rows: [
        columnRow(runA, { operation: 'organizations_search', credits: 5, roundNumber: 1, usageKey: 'a-search-r1' }),
        columnRow(runA, { operation: 'organization_enrichment', credits: 1, roundNumber: 1, usageKey: 'a-enrich-r1' }),
        // Filas del MISMO lote pero de la otra corrida.
        columnRow(runB, { operation: 'organizations_search', credits: 5, roundNumber: 1, usageKey: 'b-search-r1' }),
      ],
    });

    assert.equal(result.matchedRowCount, 2);
    assert.equal(result.recordedUsageCredits, 6);
    assert.equal(result.foreignRowCount, 1);
    assert.ok(result.anomalies.includes('foreign_usage_rows_present'));
  });

  test('caso 30 — confirmedProviderCredits es null aunque el ledger interno tenga un número', () => {
    const run = correlation();
    const result = reconcile(
      [columnRow(run, { operation: 'organizations_search', credits: 8, roundNumber: 1, usageKey: 'search-r1' })],
      run,
    );

    assert.equal(result.recordedUsageCredits, 8);
    assert.equal(result.confirmedProviderCredits, null);
    assert.notEqual(result.billingState, 'provider_confirmed');
  });

  test('un consumo registrado por encima de la reserva se reporta, no se recorta', () => {
    const run = correlation();
    const result = reconcileWizardRunSpend({
      correlation: run,
      discoveryProvider: 'apollo_organizations',
      estimatedCredits: 12,
      reservedCredits: 12,
      rows: [
        columnRow(run, { operation: 'organizations_search', credits: 10, roundNumber: 1, usageKey: 'search-r1' }),
        columnRow(run, { operation: 'organizations_search', credits: 5, roundNumber: 2, usageKey: 'search-r2' }),
      ],
    });

    assert.equal(result.recordedUsageCredits, 15);
    assert.ok(result.anomalies.includes('recorded_usage_exceeds_reservation'));
    assert.equal(result.creditsToConfirm, 15);
  });

  test('sin filas se confirma la reserva entera: el sesgo es conservador', () => {
    const result = reconcile([]);

    assert.equal(result.creditsToConfirm, 12);
    assert.ok(result.anomalies.includes('no_usage_rows_found'));
  });

  test('la reconciliación es idempotente: repetirla da el mismo veredicto', () => {
    const run = correlation();
    const rows = [
      columnRow(run, { operation: 'organizations_search', credits: 5, roundNumber: 1, usageKey: 'search-r1' }),
      columnRow(run, { operation: 'organization_enrichment', credits: 1, roundNumber: 2, usageKey: 'enrich-r2' }),
    ];

    assert.deepEqual(reconcile(rows, run), reconcile(rows, run));
  });

  test('el número de ronda viaja en la metadata sin alterar la correlación económica', () => {
    const run = correlation();
    const row = columnRow(run, {
      operation: 'organization_enrichment',
      credits: 1,
      roundNumber: 2,
      usageKey: 'enrich-r2',
    });

    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata['round_number'], 2);
    // La correlación sigue siendo la de la corrida, no una por ronda.
    assert.deepEqual(metadata[RUN_CORRELATION_METADATA_KEY], toRunCorrelationMetadata(run));
  });
});
