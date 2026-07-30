/**
 * Tests — correlación y contrato económico
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§2, §3, §4, §5, §6)
 *
 * Reproduce el descuadre real de A1-APOLLO-LIVE-QA-1 y comprueba que ya no puede
 * repetirse:
 *   batch 7a75df68-aaa2-4558-9118-0846486a3e97 → reserva 3, logs 3 + 1 = 4.
 *
 * Offline: sin red, sin Supabase, sin proveedores, sin créditos.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWizardRunCorrelation,
  buildRunCorrelationMetadata,
  buildRunScopedIdempotencyKey,
  extractUsageLogIdentity,
  isUsageLogAttributableToRun,
  toProviderUsageCorrelationColumns,
  MissingRunCorrelationError,
  RUN_CORRELATION_METADATA_KEY,
  type WizardRunCorrelation,
} from '../wizard-run-correlation';
import {
  buildRunEconomicSummary,
  inferBillingState,
  summarizeRecordedUsage,
  RECONCILABLE_APOLLO_OPERATION_KEYS,
  type RunUsageLogRecord,
} from '../wizard-economic-contract';
import { readRunUsageLogs, reconcileRunCredits } from '../wizard-run-reconciliation';
import { resolveReconcilableOperationKeys } from '../wizard-reconciliation-audit';
import {
  creditsForApolloOperation,
  resolveApolloRunReservationBreakdown,
} from '@/server/agents/prospecting-toolkit/apollo-operation-pricing';

// ── Guard de red ─────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error('network_access_forbidden_in_offline_test');
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

// ── Fixtures del QA real ─────────────────────────────────────────────────────

const QA_BATCH_ID = '7a75df68-aaa2-4558-9118-0846486a3e97';
const QA_RESERVATION_ID = '5dcc81fb-0000-0000-0000-000000000074';
const QA_CLIENT_REQUEST_ID = 'client-req-qa-live-1';

function makeCorrelation(overrides?: Partial<WizardRunCorrelation>): WizardRunCorrelation {
  return buildWizardRunCorrelation({
    clientRequestId: overrides?.clientRequestId ?? QA_CLIENT_REQUEST_ID,
    batchId: overrides?.batchId ?? QA_BATCH_ID,
    reservationId: overrides?.reservationId ?? QA_RESERVATION_ID,
    // El batch real tenía agent_run_id NULL: la reconciliación NO puede depender de él.
    agentRunId: overrides?.agentRunId ?? null,
    wizardRunId: overrides?.wizardRunId ?? null,
    provider: overrides?.provider ?? 'apollo_organizations',
  });
}

function log(overrides: Partial<RunUsageLogRecord> & Pick<RunUsageLogRecord, 'id'>): RunUsageLogRecord {
  return {
    usageKey: null,
    providerKey: 'apollo',
    operationKey: 'organizations_search',
    creditsUsed: 0,
    status: 'success',
    billingState: null,
    ...overrides,
  };
}

// ── §3 Correlación ───────────────────────────────────────────────────────────

describe('§3 correlación: los tres identificadores son obligatorios', () => {
  it('construye la correlación con clientRequestId + batchId + reservationId', () => {
    const correlation = makeCorrelation();
    assert.equal(correlation.batchId, QA_BATCH_ID);
    assert.equal(correlation.reservationId, QA_RESERVATION_ID);
    assert.equal(correlation.clientRequestId, QA_CLIENT_REQUEST_ID);
  });

  it('agentRunId nulo NO impide reconciliar (el batch real lo tenía NULL)', () => {
    const correlation = makeCorrelation({ agentRunId: null });
    assert.equal(correlation.agentRunId, null);
    const identity = extractUsageLogIdentity({ batch_id: QA_BATCH_ID });
    assert.equal(isUsageLogAttributableToRun(identity, correlation), true);
  });

  it('falla cerrado enumerando lo que falta', () => {
    for (const missing of ['clientRequestId', 'batchId', 'reservationId'] as const) {
      const input = {
        clientRequestId: QA_CLIENT_REQUEST_ID,
        batchId: QA_BATCH_ID,
        reservationId: QA_RESERVATION_ID,
        provider: 'apollo_organizations' as const,
      };
      assert.throws(
        () => buildWizardRunCorrelation({ ...input, [missing]: null }),
        (error: unknown) => {
          assert.ok(error instanceof MissingRunCorrelationError);
          assert.deepEqual(error.missingFields, [missing]);
          return true;
        },
      );
    }
  });

  it('un id que es sólo espacios cuenta como ausente', () => {
    assert.throws(
      () => buildWizardRunCorrelation({
        clientRequestId: '   ',
        batchId: QA_BATCH_ID,
        reservationId: QA_RESERVATION_ID,
        provider: 'apollo_organizations',
      }),
      MissingRunCorrelationError,
    );
  });
});

describe('§3 atribución: por identificadores, nunca por timestamp', () => {
  const correlation = makeCorrelation();

  it('lee la identidad desde metadata cuando no hay columnas (pre-migración 100)', () => {
    const identity = extractUsageLogIdentity({
      batch_id: null,
      metadata: {
        [RUN_CORRELATION_METADATA_KEY]: buildRunCorrelationMetadata(correlation),
      },
    });
    assert.equal(identity.reservationId, QA_RESERVATION_ID);
    assert.equal(isUsageLogAttributableToRun(identity, correlation), true);
  });

  it('rechaza una fila del mismo batch con OTRA reserva', () => {
    const identity = extractUsageLogIdentity({
      batch_id: QA_BATCH_ID,
      reservation_id: '00000000-0000-0000-0000-0000000000ff',
    });
    assert.equal(isUsageLogAttributableToRun(identity, correlation), false);
  });

  it('rechaza una fila de otro batch', () => {
    const identity = extractUsageLogIdentity({
      batch_id: '11111111-1111-1111-1111-111111111111',
    });
    assert.equal(isUsageLogAttributableToRun(identity, correlation), false);
  });

  it('la proyección a columnas no inventa claves', () => {
    const columns = toProviderUsageCorrelationColumns(correlation);
    assert.equal(columns.reservation_id, QA_RESERVATION_ID);
    assert.equal(columns.client_request_id, QA_CLIENT_REQUEST_ID);
    assert.equal(columns.wizard_run_id, null);
  });

  it('la clave de idempotencia es determinística por run + operación', () => {
    const a = buildRunScopedIdempotencyKey({
      operationKey: 'organization_enrichment',
      batchId: QA_BATCH_ID,
      discriminator: 'falabella.com.pe',
    });
    const b = buildRunScopedIdempotencyKey({
      operationKey: 'organization_enrichment',
      batchId: QA_BATCH_ID,
      discriminator: 'falabella.com.pe',
    });
    assert.equal(a, b);
    assert.notEqual(
      a,
      buildRunScopedIdempotencyKey({
        operationKey: 'organizations_search',
        batchId: QA_BATCH_ID,
        discriminator: 'falabella.com.pe',
      }),
    );
  });
});

// ── §5 Pricing único ─────────────────────────────────────────────────────────

describe('§5 fuente única de pricing', () => {
  it('la configuración del piloto controlado reserva 3 + 1 = 4, derivado de los caps', () => {
    const breakdown = resolveApolloRunReservationBreakdown({
      maxQueriesPerRun: 1,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 1,
      enrichmentCascadeEnabled: true,
    });
    assert.equal(breakdown.searchReservedCredits, 3);
    assert.equal(breakdown.enrichmentReservedCredits, 1);
    assert.equal(breakdown.totalReservedCredits, 4);
  });

  it('con la cascada apagada no se reserva enrichment', () => {
    const breakdown = resolveApolloRunReservationBreakdown({
      maxQueriesPerRun: 1,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 1,
      enrichmentCascadeEnabled: false,
    });
    assert.equal(breakdown.enrichmentReservedCredits, 0);
    assert.equal(breakdown.totalReservedCredits, 3);
  });

  it('un conteo malformado nunca fabrica gasto', () => {
    assert.equal(creditsForApolloOperation('organizations_search', Number.NaN), 0);
    assert.equal(creditsForApolloOperation('organizations_search', -5), 0);
    assert.equal(creditsForApolloOperation('organization_enrichment', 0), 0);
  });

  it('la procedencia viaja con el número (estimación ≠ factura)', () => {
    const breakdown = resolveApolloRunReservationBreakdown({
      maxQueriesPerRun: 1,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 1,
      enrichmentCascadeEnabled: true,
    });
    assert.equal(breakdown.pricingSource, 'internal_conservative_ceiling');
    assert.ok(breakdown.pricingVersion.length > 0);
  });
});

// ── §4 Los tres conceptos separados ──────────────────────────────────────────

describe('§4 estimated / recorded / confirmed son distintos', () => {
  it('confirmedProviderCredits queda null sin evidencia externa', () => {
    const recorded = summarizeRecordedUsage([
      log({ id: 'a', operationKey: 'organizations_search', creditsUsed: 3 }),
      log({ id: 'b', operationKey: 'organization_enrichment', creditsUsed: 1 }),
    ]);
    const summary = buildRunEconomicSummary({ estimatedCredits: 4, recorded });
    assert.equal(summary.recordedUsageCredits, 4);
    assert.equal(summary.confirmedProviderCredits, null);
    assert.equal(summary.confirmedProviderEvidenceSource, null);
  });

  it('un registro interno NUNCA se promueve a crédito confirmado', () => {
    const recorded = summarizeRecordedUsage([
      log({ id: 'a', operationKey: 'organizations_search', creditsUsed: 3 }),
    ]);
    const summary = buildRunEconomicSummary({ estimatedCredits: 3, recorded });
    assert.equal(summary.recordedUsageCredits, 3);
    assert.equal(summary.confirmedProviderCredits, null);
  });

  it('sólo evidencia externa explícita fija confirmedProviderCredits', () => {
    const recorded = summarizeRecordedUsage([
      log({ id: 'a', operationKey: 'organizations_search', creditsUsed: 3 }),
    ]);
    const summary = buildRunEconomicSummary({
      estimatedCredits: 3,
      recorded,
      confirmedProviderEvidence: {
        confirmedProviderCredits: 3,
        evidenceSource: 'apollo_invoice_2026_07',
      },
    });
    assert.equal(summary.confirmedProviderCredits, 3);
    assert.equal(summary.confirmedProviderEvidenceSource, 'apollo_invoice_2026_07');
  });

  it('credits_used null es indeterminado, no cero', () => {
    assert.equal(inferBillingState({ creditsUsed: null, status: 'success', billingState: null }), 'unknown');
    assert.equal(inferBillingState({ creditsUsed: 0, status: 'success', billingState: null }), 'not_charged');
    assert.equal(inferBillingState({ creditsUsed: 2, status: 'success', billingState: null }), 'charged');
  });
});

// ── §4 / §6 El descuadre real ────────────────────────────────────────────────

describe('§6 el descuadre 4-vs-3 del QA real queda visible', () => {
  it('search + enrichment reconcilian contra la MISMA reserva', () => {
    const recorded = summarizeRecordedUsage([
      log({ id: 'search', operationKey: 'organizations_search', creditsUsed: 3 }),
      log({ id: 'enrich', operationKey: 'organization_enrichment', creditsUsed: 1 }),
    ]);
    assert.equal(recorded.recordedUsageCredits, 4);
    assert.deepEqual(recorded.perOperationCredits, {
      organizations_search: 3,
      organization_enrichment: 1,
    });
  });

  it('con la reserva vieja (3) el exceso se conserva y se marca — no se recorta', () => {
    const recorded = summarizeRecordedUsage([
      log({ id: 'search', operationKey: 'organizations_search', creditsUsed: 3 }),
      log({ id: 'enrich', operationKey: 'organization_enrichment', creditsUsed: 1 }),
    ]);
    const summary = buildRunEconomicSummary({ estimatedCredits: 3, recorded });
    assert.equal(summary.creditsToConfirm, 4, 'confirma lo gastado, no lo reservado');
    assert.ok(summary.anomalies.includes('recorded_exceeds_reserved'));
    assert.equal(summary.reconciliationState, 'pending_reconciliation');
    assert.equal(summary.blockFurtherPaidOperations, true);
    assert.equal(summary.isExact, false);
  });

  it('con la reserva corregida (4) cuadra exacto y no hay anomalías', () => {
    const recorded = summarizeRecordedUsage([
      log({ id: 'search', operationKey: 'organizations_search', creditsUsed: 3 }),
      log({ id: 'enrich', operationKey: 'organization_enrichment', creditsUsed: 1 }),
    ]);
    const summary = buildRunEconomicSummary({ estimatedCredits: 4, recorded });
    assert.equal(summary.creditsToConfirm, 4);
    assert.deepEqual(summary.anomalies, []);
    assert.equal(summary.reconciliationState, 'confirmed');
    assert.equal(summary.isExact, true);
  });

  it('el allowlist de Apollo incluye AMBAS operaciones (no sólo la de Tavily)', () => {
    const keys = resolveReconcilableOperationKeys('apollo_organizations');
    assert.ok(keys.includes('organizations_search'));
    assert.ok(keys.includes('organization_enrichment'));
    assert.deepEqual([...keys], [...RECONCILABLE_APOLLO_OPERATION_KEYS]);

    const tavilyKeys = resolveReconcilableOperationKeys('tavily');
    assert.deepEqual([...tavilyKeys], ['multi_query_web_search']);
  });

  it('una operación fuera del allowlist no suma gasto', () => {
    const recorded = summarizeRecordedUsage([
      log({ id: 'a', operationKey: 'organizations_search', creditsUsed: 3 }),
      log({ id: 'b', operationKey: 'person_enrich', creditsUsed: 99 }),
    ]);
    assert.equal(recorded.recordedUsageCredits, 3);
    assert.equal(recorded.ignoredOperationCount, 1);
  });

  it('idempotente: un reintento con el mismo usage_key no duplica', () => {
    const rows = [
      log({ id: 'r1', usageKey: 'apollo_organizations:batch:q', creditsUsed: 3 }),
      log({ id: 'r2', usageKey: 'apollo_organizations:batch:q', creditsUsed: 3 }),
    ];
    const recorded = summarizeRecordedUsage(rows);
    assert.equal(recorded.recordedUsageCredits, 3);
    assert.equal(recorded.deduplicatedLogCount, 1);
    // Y ejecutarlo dos veces da lo mismo.
    assert.equal(summarizeRecordedUsage(rows).recordedUsageCredits, 3);
  });

  it('sin logs atribuibles se confirma la reserva y se marca billing_unknown', () => {
    const summary = buildRunEconomicSummary({
      estimatedCredits: 4,
      recorded: summarizeRecordedUsage([]),
    });
    assert.equal(summary.creditsToConfirm, 4);
    assert.ok(summary.anomalies.includes('no_attributable_usage_logs'));
    assert.equal(summary.reconciliationState, 'billing_unknown');
  });
});

// ── §6 Lector: por identificadores, con DB inyectada ─────────────────────────

type FakeRow = {
  id: string;
  usage_key?: string | null;
  provider_key?: string | null;
  operation_key?: string | null;
  credits_used?: number | string | null;
  status?: string | null;
  batch_id?: string | null;
  reservation_id?: string | null;
  metadata?: unknown;
};

function makeDb(rows: FakeRow[] | null, error: { message: string } | null = null) {
  const seen: { table?: string; select?: string; eqCol?: string; eqVal?: string; inCol?: string; inVals?: readonly string[] } = {};
  const db = {
    from(table: string) {
      seen.table = table;
      return {
        select(columns: string) {
          seen.select = columns;
          return {
            eq(eqCol: string, eqVal: string) {
              seen.eqCol = eqCol;
              seen.eqVal = eqVal;
              return {
                in(inCol: string, inVals: readonly string[]) {
                  seen.inCol = inCol;
                  seen.inVals = inVals;
                  return Promise.resolve({ data: rows, error });
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, seen };
}

describe('§6 readRunUsageLogs', () => {
  const correlation = makeCorrelation();

  it('consulta por batch_id y operation_key — nunca por created_at', async () => {
    const { db, seen } = makeDb([]);
    await readRunUsageLogs(correlation, db, {
      operationKeys: ['organizations_search', 'organization_enrichment'],
    });
    assert.equal(seen.table, 'provider_usage_logs');
    assert.equal(seen.eqCol, 'batch_id');
    assert.equal(seen.eqVal, QA_BATCH_ID);
    assert.equal(seen.inCol, 'operation_key');
    assert.ok(!(seen.select ?? '').includes('created_at'), 'el select no debe traer created_at');
  });

  it('suma las dos operaciones del run real', async () => {
    const { db } = makeDb([
      { id: 'search', operation_key: 'organizations_search', provider_key: 'apollo', credits_used: '3.0000', status: 'success', batch_id: QA_BATCH_ID },
      { id: 'enrich', operation_key: 'organization_enrichment', provider_key: 'apollo', credits_used: '1.0000', status: 'success', batch_id: QA_BATCH_ID },
    ]);
    const read = await readRunUsageLogs(correlation, db);
    assert.equal(read.status, 'ok');
    const reconciled = reconcileRunCredits({ estimatedCredits: 4, logsRead: read });
    assert.equal(reconciled.summary.recordedUsageCredits, 4);
    assert.equal(reconciled.summary.reconciliationState, 'confirmed');
  });

  it('descarta filas del mismo batch con otra reserva', async () => {
    const { db } = makeDb([
      { id: 'ours', operation_key: 'organizations_search', credits_used: 3, batch_id: QA_BATCH_ID, reservation_id: QA_RESERVATION_ID },
      { id: 'theirs', operation_key: 'organization_enrichment', credits_used: 50, batch_id: QA_BATCH_ID, reservation_id: '00000000-0000-0000-0000-0000000000ff' },
    ]);
    const read = await readRunUsageLogs(correlation, db);
    assert.equal(read.status, 'ok');
    if (read.status !== 'ok') return;
    assert.equal(read.rowsRejected, 1);
    assert.equal(reconcileRunCredits({ estimatedCredits: 4, logsRead: read }).summary.recordedUsageCredits, 3);
  });

  it('un error de lectura es "indeterminado", no "gasto cero"', async () => {
    const { db } = makeDb(null, { message: 'connection reset' });
    const read = await readRunUsageLogs(correlation, db);
    assert.equal(read.status, 'unavailable');

    const reconciled = reconcileRunCredits({ estimatedCredits: 4, logsRead: read });
    assert.equal(reconciled.usageLogsUnavailable, true);
    assert.equal(reconciled.summary.reconciliationState, 'billing_unknown');
    assert.equal(
      reconciled.summary.creditsToConfirm,
      4,
      'no se puede afirmar que no se gastó nada: se confirma el máximo conservador',
    );
  });

  it('cero candidatos creados no altera la reconciliación del gasto', async () => {
    // El batch real terminó con candidates_count = 0 y aun así había cobrado 4.
    const { db } = makeDb([
      { id: 'search', operation_key: 'organizations_search', credits_used: 3, batch_id: QA_BATCH_ID, status: 'success' },
      { id: 'enrich', operation_key: 'organization_enrichment', credits_used: 1, batch_id: QA_BATCH_ID, status: 'success' },
    ]);
    const read = await readRunUsageLogs(correlation, db);
    const reconciled = reconcileRunCredits({ estimatedCredits: 4, logsRead: read });
    assert.equal(reconciled.summary.recordedUsageCredits, 4);
  });
});
