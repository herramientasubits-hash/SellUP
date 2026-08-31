/**
 * AGENT1-LUSHA-PROVIDER-USAGE-OBSERVABILITY-1 — la corrida Lusha deja UNA fila
 * canónica en `provider_usage_logs`.
 *
 * Lo que este hito cierra: la primera corrida REAL de Lusha (19-08) facturó de
 * forma veraz en `wizard_budget_reservations`, en `prospect_batches.metadata` y en
 * la telemetría multi-rama, pero NO dejó ninguna fila en el ledger canónico que
 * Apollo y Tavily sí alimentan. El alcance legacy lo prohibía a propósito.
 *
 * Lo que estas pruebas fijan, y que NINGUNA suite anterior podía ver:
 *
 *   · UNA fila agregada por corrida — nunca una por rama ni una por página, que
 *     multiplicaría el mismo gasto por el número de páginas;
 *   · el importe registrado es el LIQUIDADO, no el reservado, y un sobrepaso se
 *     publica sin recorte;
 *   · `results_returned` son las filas CRUDAS que la petición pagó, no los
 *     candidatos persistidos;
 *   · la idempotencia se apoya en el ÚNICO índice único que Producción tiene para
 *     esto (`usage_key`), y por tanto una reentrada no puede crear una 2ª fila;
 *   · un costo desconocido queda en SQL NULL, jamás en 0;
 *   · el registro no puede pedir otra vez al proveedor, no puede volver a
 *     liquidar, y no puede tumbar una corrida que ya se cobró.
 *
 * Determinista y offline: sin Apollo, sin Tavily, sin Lusha, sin HubSpot y sin
 * Supabase. Ninguna prueba de aquí abre una conexión ni gasta un crédito.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  buildLushaProviderUsageLogInput,
  buildLushaRunRequestSignature,
  buildLushaRunUsageKey,
  decideLushaUsageCredits,
  resolveLushaUsageBillingState,
  resolveLushaUsageEstimatedCostUsd,
  resolveLushaUsageResultsReturned,
  shouldRecordLushaProviderUsage,
  LUSHA_COMPANY_DISCOVERY_OPERATION_KEY,
  LUSHA_COMPANY_DISCOVERY_PROVIDER_KEY,
  LUSHA_COMPANY_DISCOVERY_PRICING_VERSION,
  LUSHA_USAGE_OBSERVABILITY_METADATA_KEY,
} from '../lusha-provider-usage-observability';
import {
  recordLushaRunProviderUsage,
  type RecordLushaProviderUsageInput,
} from '../lusha-provider-usage-recorder';
import {
  decideLushaCreditsToConfirm,
  shouldReleaseLushaReservation,
  type LushaBudgetSettlementOutcome,
} from '../../../modules/prospect-batches/lusha-budget-gate';
import {
  buildWizardRunCorrelation,
  withResolvedIds,
  PROVIDER_USAGE_CORRELATION_COLUMN_NAMES,
} from '../../../modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import { PROVIDER_USAGE_CORRELATION_COLUMNS_FLAG } from '../../../lib/feature-flags.server';
import type { LushaRunTelemetry } from '../lusha-multibranch-execution';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../..');

/**
 * Lee el CÓDIGO de un módulo, sin comentarios.
 *
 * 🔑 Esta distinción no es cosmética: una guarda que grepea el cuerpo CRUDO
 * confunde «nombrarlo en código» con «citarlo en prosa», y estos módulos
 * DOCUMENTAN a propósito lo que no hacen (`Math.random`, `Date.now`,
 * `try_reserve_wizard_credits`, `prospect_candidates`). Sin despojar los
 * comentarios, cada una de esas explicaciones se leería como una violación —y,
 * al revés, borrar la explicación «arreglaría» la guarda sin arreglar nada.
 */
function readCode(rel: string): string {
  return readFileSync(resolve(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ─── Fixture con la FORMA de la primera QA real (§ 17) ────────────────────────
//
// targetGap 5 · health_pharma · 3 peticiones · 30 filas crudas · 3 créditos
// reportados · 6 reservados · 5 aceptadas · rechazos de precisión y duplicados
// presentes. Sin NINGÚN nombre de empresa real y sin ningún dato copiado de
// Producción: sólo la forma numérica.

const PRICING_UNIT_COST_USD = 0.08823529;
const PRICING_CONFIG_ID = 'pricing-cfg-0000-0000-0000-000000000001';

function fixturePricing() {
  return {
    pricingConfigId: PRICING_CONFIG_ID,
    providerKey: 'lusha',
    operationKey: LUSHA_COMPANY_DISCOVERY_OPERATION_KEY,
    unit: 'per_credit' as const,
    unitCostUsd: PRICING_UNIT_COST_USD,
  };
}

function fixtureTelemetry(overrides: Partial<LushaRunTelemetry> = {}): LushaRunTelemetry {
  return {
    macroKey: 'health_pharma',
    targetGap: 5,
    branchCountPlanned: 3,
    branchCountAttempted: 3,
    providerRequestsAllowed: 6,
    providerRequestsUsed: 3,
    pagesSkippedZeroNovelty: 0,
    maxRawResults: 60,
    rawResultsTotal: 30,
    crossBranchDuplicatesRemoved: 4,
    // 🔴 CUT-L1 §§ 4, 5 — la supresión CLIENTE de conocidos se cuenta aparte de
    // los duplicados de corrida, y su siembra también.
    localKnownSuppressedTotal: 0,
    localKnownSeedCount: 0,
    duplicateReasonCounts: {} as LushaRunTelemetry['duplicateReasonCounts'],
    uniqueResultsTotal: 26,
    usefulResultsTotal: 5,
    reviewableFoundTotal: 7,
    acceptedForTargetTotal: 5,
    targetOverflowDiscarded: 2,
    precisionRejectedTotal: 6,
    precisionReasonCounts: { industry_mismatch: 6 },
    remainingGapFinal: 0,
    creditsReserved: 6,
    creditsReportedActual: 3,
    stopReason: 'target_reached',
    branches: [
      {
        branchIndex: 0,
        mainIndustryId: 11,
        subIndustryId: null,
        pagesAttempted: 1,
        providerRequests: 1,
        rawResults: 10,
        duplicatesRemoved: 1,
        uniqueResults: 9,
        usefulResults: 2,
        remainingGapBefore: 5,
        remainingGapAfter: 3,
        providerCreditsReported: 1,
        precisionRejected: 2,
        targetOverflowDiscarded: 0,
        outcome: 'completed' as LushaRunTelemetry['branches'][number]['outcome'],
      },
      {
        branchIndex: 1,
        mainIndustryId: 12,
        subIndustryId: 71,
        pagesAttempted: 1,
        providerRequests: 1,
        rawResults: 10,
        duplicatesRemoved: 2,
        uniqueResults: 8,
        usefulResults: 2,
        remainingGapBefore: 3,
        remainingGapAfter: 1,
        providerCreditsReported: 1,
        precisionRejected: 2,
        targetOverflowDiscarded: 0,
        outcome: 'completed' as LushaRunTelemetry['branches'][number]['outcome'],
      },
      {
        branchIndex: 2,
        mainIndustryId: 12,
        subIndustryId: 80,
        pagesAttempted: 1,
        providerRequests: 1,
        rawResults: 10,
        duplicatesRemoved: 1,
        uniqueResults: 9,
        usefulResults: 1,
        remainingGapBefore: 1,
        remainingGapAfter: 0,
        providerCreditsReported: 1,
        precisionRejected: 2,
        targetOverflowDiscarded: 2,
        outcome: 'completed' as LushaRunTelemetry['branches'][number]['outcome'],
      },
    ],
    ...overrides,
  };
}

const RESERVATION_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const CLIENT_REQUEST_ID = '44444444-4444-4444-8444-444444444444';

function fixtureCorrelation(overrides?: { reservationId?: string | null; batchId?: string | null }) {
  const base = buildWizardRunCorrelation({
    userId: USER_ID,
    clientRequestId: CLIENT_REQUEST_ID,
    providerKey: 'lusha',
    requestSignature: buildLushaRunRequestSignature({
      countryCode: 'co',
      macroIndustryKey: 'health_pharma',
      subIndustryId: null,
      sizeBandKey: null,
      branchCountPlanned: 3,
      requiredCredits: 6,
    }),
  });
  return withResolvedIds(base, {
    reservationId: overrides?.reservationId !== undefined ? overrides.reservationId : RESERVATION_ID,
    batchId: overrides?.batchId !== undefined ? overrides.batchId : BATCH_ID,
  });
}

function fixtureRun(
  overrides: Partial<RecordLushaProviderUsageInput['run']> = {},
): RecordLushaProviderUsageInput['run'] {
  return {
    status: 'success',
    creditsChargedTotal: 3,
    resultsReturned: 30,
    rawResultsTotal: 30,
    pagesRequested: 3,
    providerRequestsUsed: 3,
    stopReason: 'target_reached',
    reviewableFoundTotal: 7,
    acceptedForTargetTotal: 5,
    targetOverflowDiscarded: 2,
    precisionRejectedTotal: 6,
    historicalActiveSkips: 3,
    exactDuplicates: 2,
    possibleDuplicates: 1,
    telemetry: fixtureTelemetry(),
    ...overrides,
  };
}

function fixtureInput(
  overrides: Partial<RecordLushaProviderUsageInput> = {},
): RecordLushaProviderUsageInput {
  return {
    correlation: fixtureCorrelation(),
    triggeredByUserId: USER_ID,
    countryCode: 'co',
    macroIndustryKey: 'health_pharma',
    creditsReserved: 6,
    settlement: { status: 'confirmed' },
    durationMs: 4210,
    run: fixtureRun(),
    ...overrides,
  };
}

// ─── Cliente de inserción falso ───────────────────────────────────────────────

type CapturedInsert = { table: string; row: Record<string, unknown> };

function makeClient(
  behaviour: (call: number, row: Record<string, unknown>) => { message: string; code?: string } | null = () => null,
) {
  const inserts: CapturedInsert[] = [];
  let calls = 0;
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls += 1;
          inserts.push({ table, row });
          return Promise.resolve({ error: behaviour(calls, row) });
        },
      };
    },
  };
  return { client, inserts, get calls() { return calls; } };
}

/** Un almacén con la unicidad de `usage_key` que Producción SÍ tiene. */
function makeUsageKeyUniqueClient() {
  const seen = new Set<string>();
  const inserts: CapturedInsert[] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          const key = row['usage_key'];
          if (typeof key === 'string' && seen.has(key)) {
            return Promise.resolve({
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "idx_provider_usage_usage_key_unique"',
              },
            });
          }
          if (typeof key === 'string') seen.add(key);
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, inserts };
}

const loadPricing = () => Promise.resolve(fixturePricing());
const loadNoPricing = () => Promise.resolve(null);

// El flag de columnas de correlación está ENCENDIDO en Producción (las filas
// Apollo de Agente 1 llevan las seis columnas pobladas), así que las pruebas de
// correlación lo encienden explícitamente en vez de asumir un default.
let previousFlag: string | undefined;
beforeEach(() => {
  previousFlag = process.env[PROVIDER_USAGE_CORRELATION_COLUMNS_FLAG];
  process.env[PROVIDER_USAGE_CORRELATION_COLUMNS_FLAG] = 'true';
});
afterEach(() => {
  if (previousFlag === undefined) delete process.env[PROVIDER_USAGE_CORRELATION_COLUMNS_FLAG];
  else process.env[PROVIDER_USAGE_CORRELATION_COLUMNS_FLAG] = previousFlag;
});

// ══════════════════════════════════════════════════════════════════════════════
// A. ÉXITO — la forma literal de la primera QA real
// ══════════════════════════════════════════════════════════════════════════════

describe('A. SUCCESS — 3 peticiones · 30 crudas · 3 créditos ⇒ UNA fila', () => {
  it('emite EXACTAMENTE una fila, con el proveedor y la operación canónicos', async () => {
    const { client, inserts } = makeClient();
    const out = await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });

    assert.equal(out.kind, 'logged');
    assert.equal(inserts.length, 1, 'UNA fila por corrida, nunca una por rama ni por página');
    assert.equal(inserts[0].table, 'provider_usage_logs');
    assert.equal(inserts[0].row['provider_key'], LUSHA_COMPANY_DISCOVERY_PROVIDER_KEY);
    assert.equal(inserts[0].row['operation_key'], LUSHA_COMPANY_DISCOVERY_OPERATION_KEY);
  });

  it('credits_used = 3 (lo liquidado), NO 6 (lo reservado)', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });
    assert.equal(inserts[0].row['credits_used'], 3);
    assert.notEqual(inserts[0].row['credits_used'], 6);
  });

  it('results_returned = 30 (filas CRUDAS pagadas), no 5 persistidas', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });
    assert.equal(inserts[0].row['results_returned'], 30);
  });

  it('lleva la correlación DIRECTA de lote, reserva y petición de cliente', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });
    const row = inserts[0].row;

    assert.equal(row['batch_id'], BATCH_ID);
    assert.equal(row['reservation_id'], RESERVATION_ID);
    assert.equal(row['client_request_id'], CLIENT_REQUEST_ID);
    assert.equal(typeof row['wizard_run_id'], 'string');
    assert.equal(typeof row['request_fingerprint'], 'string');
    assert.equal(typeof row['idempotency_key'], 'string');

    // Y la misma correlación viaja en metadata, que es lo que hace que la fila
    // siga siendo conciliable con las columnas apagadas.
    const meta = row['metadata'] as Record<string, unknown>;
    const corr = meta['run_correlation'] as Record<string, unknown>;
    assert.equal(corr['reservation_id'], RESERVATION_ID);
    assert.equal(corr['client_request_id'], CLIENT_REQUEST_ID);
    assert.equal(corr['batch_id'], BATCH_ID);
  });

  it('billing_state usa el vocabulario CANÓNICO que la constraint admite', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });
    // provider_usage_logs_billing_state_check: unknown | estimated | recorded |
    // provider_confirmed. Un `actual_settled` inventado sería RECHAZADO por la DB.
    assert.equal(inserts[0].row['billing_state'], 'recorded');
    assert.ok(
      ['unknown', 'estimated', 'recorded', 'provider_confirmed'].includes(
        inserts[0].row['billing_state'] as string,
      ),
    );
  });

  it('el costo USD sale de la tarifa VIVA, sin literal en runtime', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });
    assert.equal(inserts[0].row['estimated_cost_usd'], 3 * PRICING_UNIT_COST_USD);
    // Y ese producto es el esperado por el hito: 3 × 0.08823529 ≈ 0.26470587.
    assert.ok(Math.abs((inserts[0].row['estimated_cost_usd'] as number) - 0.26470587) < 1e-8);

    const pricing = (inserts[0].row['metadata'] as Record<string, unknown>)['pricing'] as Record<string, unknown>;
    assert.equal(pricing['pricing_version'], LUSHA_COMPANY_DISCOVERY_PRICING_VERSION);
    assert.equal(pricing['pricing_config_id'], PRICING_CONFIG_ID);
    assert.equal(pricing['unit_cost_usd'], PRICING_UNIT_COST_USD);
  });

  it('real_cost_usd queda NULL — se concilia post-factura, igual que Apollo', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });
    assert.equal(inserts[0].row['real_cost_usd'], null);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B. PARADA TEMPRANA POR OBJETIVO
// ══════════════════════════════════════════════════════════════════════════════

describe('B. EARLY GAP STOP — 1 petición · 10 crudas · 1 crédito', () => {
  it('registra 1 crédito, NO el máximo de 6', async () => {
    const { client, inserts } = makeClient();
    const out = await recordLushaRunProviderUsage(
      fixtureInput({
        run: fixtureRun({
          creditsChargedTotal: 1,
          rawResultsTotal: 10,
          resultsReturned: 10,
          pagesRequested: 1,
          providerRequestsUsed: 1,
          telemetry: fixtureTelemetry({
            providerRequestsUsed: 1,
            rawResultsTotal: 10,
            creditsReportedActual: 1,
            branchCountAttempted: 1,
          }),
        }),
      }),
      { client, loadPricing },
    );

    assert.equal(out.kind, 'logged');
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].row['credits_used'], 1);
    assert.equal(inserts[0].row['results_returned'], 10);
    assert.notEqual(inserts[0].row['credits_used'], 6);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C. MULTI-RAMA — una sola fila AGREGADA
// ══════════════════════════════════════════════════════════════════════════════

describe('C. MULTIBRANCH — varias ramas y páginas ⇒ UNA fila agregada', () => {
  it('el detalle por rama vive SÓLO en la metadata segura', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });

    assert.equal(inserts.length, 1, 'tres ramas, una sola fila');

    const obs = (inserts[0].row['metadata'] as Record<string, unknown>)[
      LUSHA_USAGE_OBSERVABILITY_METADATA_KEY
    ] as Record<string, unknown>;
    const run = obs['run'] as Record<string, unknown>;
    const branches = run['branches'] as Array<Record<string, unknown>>;

    assert.equal(branches.length, 3);
    assert.equal(run['provider_requests_used'], 3);
    assert.equal(run['provider_requests_allowed'], 6);
    assert.equal(branches[1]['main_industry_id'], 12);
    assert.equal(branches[1]['sub_industry_id'], 71);
    assert.equal(branches[2]['target_overflow_discarded'], 2);

    // Y la suma de créditos por rama NO se convierte en tres filas de 3.
    const perBranch = branches.reduce(
      (acc, b) => acc + ((b['provider_credits_reported'] as number) ?? 0),
      0,
    );
    assert.equal(perBranch, 3);
    assert.equal(inserts[0].row['credits_used'], 3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D. EXACTITUD DE OBJETIVO
// ══════════════════════════════════════════════════════════════════════════════

describe('D. TARGET EXACTNESS — 30 crudas · 5 persistidas', () => {
  it('results_returned describe al PROVEEDOR; la calidad va en metadata', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });

    assert.equal(inserts[0].row['results_returned'], 30);

    const obs = (inserts[0].row['metadata'] as Record<string, unknown>)[
      LUSHA_USAGE_OBSERVABILITY_METADATA_KEY
    ] as Record<string, unknown>;
    assert.equal(obs['accepted_for_target_total'], 5);
    assert.equal(obs['reviewable_found_total'], 7);
    assert.equal(obs['target_overflow_discarded'], 2);
    assert.equal(obs['precision_rejected'], 6);
    assert.equal(obs['historical_active_skips'], 3);
    assert.equal(obs['exact_duplicates'], 2);
    assert.equal(obs['possible_duplicates'], 1);
    assert.equal(obs['credits_reserved'], 6);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// E. EL PROVEEDOR NO REPORTÓ CRÉDITOS
// ══════════════════════════════════════════════════════════════════════════════

describe('E. PROVIDER REPORTED NULL — el importe conservador, declarado', () => {
  it('registra la reserva ENTERA y marca la fuente; nunca 0 por omisión', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(
      fixtureInput({ run: fixtureRun({ creditsChargedTotal: null }) }),
      { client, loadPricing },
    );

    assert.equal(inserts[0].row['credits_used'], 6, 'reserva entera: gasto no verificable');
    assert.notEqual(inserts[0].row['credits_used'], 0);

    const obs = (inserts[0].row['metadata'] as Record<string, unknown>)[
      LUSHA_USAGE_OBSERVABILITY_METADATA_KEY
    ] as Record<string, unknown>;
    assert.equal(obs['credits_source'], 'conservative_fallback');
    assert.equal(obs['provider_reported_credits'], null);
    assert.equal(obs['credits_settled'], 6);
  });

  it('el número sale de la MISMA función que usó la liquidación', () => {
    const decision = decideLushaUsageCredits({
      creditsReserved: 6,
      creditsChargedTotal: null,
      settlement: { status: 'confirmed' },
      decideCreditsToConfirm: decideLushaCreditsToConfirm,
    });
    assert.equal(
      decision.creditsUsed,
      decideLushaCreditsToConfirm({ creditsReserved: 6, creditsChargedTotal: null }),
    );
  });

  it('un 0 REPORTADO es distinto de «no reportó»: se respeta como cobro conocido', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(
      fixtureInput({ run: fixtureRun({ creditsChargedTotal: 0 }) }),
      { client, loadPricing },
    );
    assert.equal(inserts[0].row['credits_used'], 0);
    const obs = (inserts[0].row['metadata'] as Record<string, unknown>)[
      LUSHA_USAGE_OBSERVABILITY_METADATA_KEY
    ] as Record<string, unknown>;
    assert.equal(obs['credits_source'], 'provider_reported');
  });

  it('sin tarifa activa el costo queda SQL NULL, jamás 0', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing: loadNoPricing });
    assert.equal(inserts[0].row['estimated_cost_usd'], null);
    assert.notEqual(inserts[0].row['estimated_cost_usd'], 0);
  });

  it('resolveLushaUsageEstimatedCostUsd nunca fabrica un cero', () => {
    assert.equal(
      resolveLushaUsageEstimatedCostUsd(3, { pricingConfigId: null, unitCostUsd: null }),
      null,
    );
  });

  it('resolveLushaUsageResultsReturned prefiere las crudas y nunca inventa', () => {
    // Las crudas mandan: son las que la petición pagó.
    assert.equal(resolveLushaUsageResultsReturned({ rawResultsTotal: 30, resultsReturned: 5 }), 30);
    // Sin crudas cae en lo reportado por el preview (ruta de una sola rama).
    assert.equal(resolveLushaUsageResultsReturned({ rawResultsTotal: null, resultsReturned: 10 }), 10);
    // Sin ninguna de las dos: 0 declarado, no un número inventado.
    assert.equal(resolveLushaUsageResultsReturned({ rawResultsTotal: null, resultsReturned: null }), 0);
    // Un 0 CRUDO es un dato, no una ausencia: una página pagada sin resultados.
    assert.equal(resolveLushaUsageResultsReturned({ rawResultsTotal: 0, resultsReturned: 7 }), 0);
  });

  it('el constructor puro produce la fila sin tocar red ni reloj', () => {
    const input = buildLushaProviderUsageLogInput({
      correlation: fixtureCorrelation(),
      billingState: 'recorded',
      pricing: { pricingConfigId: PRICING_CONFIG_ID, unitCostUsd: PRICING_UNIT_COST_USD },
      resultsReturned: 30,
      triggeredByUserId: USER_ID,
      durationMs: 1000,
      status: 'success',
      errorCode: null,
      countryCode: 'co',
      macroIndustryKey: 'health_pharma',
      creditsReserved: 6,
      credits: {
        creditsUsed: 3,
        creditsSource: 'provider_reported',
        providerReportedCredits: 3,
      },
      settlement: { status: 'confirmed' },
      telemetry: fixtureTelemetry(),
      admission: {
        reviewableFoundTotal: 7,
        acceptedForTargetTotal: 5,
        targetOverflowDiscarded: 2,
        precisionRejectedTotal: 6,
        historicalActiveSkips: 3,
        exactDuplicates: 2,
        possibleDuplicates: 1,
      },
    });

    assert.equal(input.provider_key, LUSHA_COMPANY_DISCOVERY_PROVIDER_KEY);
    assert.equal(input.operation_key, LUSHA_COMPANY_DISCOVERY_OPERATION_KEY);
    assert.equal(input.credits_used, 3);
    assert.equal(input.results_returned, 30);
    assert.equal(input.real_cost_usd, null);
    // Determinismo: dos construcciones idénticas dan la MISMA clave.
    assert.equal(input.usage_key, buildLushaRunUsageKey(fixtureCorrelation().idempotencyKey));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// F. SOBREPASO — sin recorte
// ══════════════════════════════════════════════════════════════════════════════

describe('F. OVERAGE — lo reportado supera lo reservado', () => {
  const overage: LushaBudgetSettlementOutcome = {
    status: 'confirmed_with_overage',
    creditsReserved: 6,
    creditsActual: 8,
    overageCredits: 2,
  };

  it('preserva el importe de M121 y NO lo clampa a la reserva', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(
      fixtureInput({ settlement: overage, run: fixtureRun({ creditsChargedTotal: 8 }) }),
      { client, loadPricing },
    );

    assert.equal(inserts[0].row['credits_used'], 8, 'sin recorte: un sobrepaso se publica');
    assert.notEqual(inserts[0].row['credits_used'], 6);

    const obs = (inserts[0].row['metadata'] as Record<string, unknown>)[
      LUSHA_USAGE_OBSERVABILITY_METADATA_KEY
    ] as Record<string, unknown>;
    assert.equal(obs['credits_source'], 'overage_reported');
    assert.equal(obs['credits_reserved'], 6);
    assert.equal(obs['credits_settled'], 8);
    assert.equal(obs['settlement_status'], 'confirmed_with_overage');
  });

  it('el importe es el que la RPC confirmó, no un recálculo propio', () => {
    const decision = decideLushaUsageCredits({
      creditsReserved: 6,
      // Aunque el core hubiera reportado otra cosa, manda la RPC: es quien tiene
      // la fila bloqueada y quien decide que hubo sobrepaso.
      creditsChargedTotal: 7,
      settlement: overage,
      decideCreditsToConfirm: decideLushaCreditsToConfirm,
    });
    assert.equal(decision.creditsUsed, 8);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G/H. EL PROVEEDOR NO FUE LLAMADO ⇒ NINGUNA FILA PAGADA
// ══════════════════════════════════════════════════════════════════════════════

describe('G/H. sin llamada al proveedor no hay fila pagada (§ 13)', () => {
  it('presupuesto bloqueado / reserva liberada ⇒ 0 filas', async () => {
    const { client, inserts } = makeClient();
    const out = await recordLushaRunProviderUsage(
      fixtureInput({
        settlement: { status: 'released' },
        run: fixtureRun({
          status: 'error',
          creditsChargedTotal: null,
          pagesRequested: 0,
          providerRequestsUsed: 0,
          rawResultsTotal: 0,
          resultsReturned: null,
          telemetry: null,
        }),
      }),
      { client, loadPricing },
    );

    assert.equal(out.kind, 'skipped_provider_not_called');
    assert.equal(inserts.length, 0, 'ninguna fila de company_prospecting_v3 fabricada');
  });

  it('credencial ausente ANTES de la llamada ⇒ 0 peticiones ⇒ 0 filas', async () => {
    const { client, inserts } = makeClient();
    const out = await recordLushaRunProviderUsage(
      fixtureInput({
        settlement: { status: 'released' },
        run: fixtureRun({
          status: 'error',
          creditsChargedTotal: null,
          pagesRequested: 0,
          providerRequestsUsed: 0,
          stopReason: null,
          telemetry: null,
        }),
      }),
      { client, loadPricing },
    );
    assert.equal(out.kind, 'skipped_provider_not_called');
    assert.equal(inserts.length, 0);
  });

  it('la señal de «no gastó» es la MISMA que libera la reserva', () => {
    // Si estas dos decisiones leyeran señales distintas, podría existir una fila
    // pagada cuya reserva se liberó por no haber gastado.
    const zero = { pagesRequested: 0, creditsChargedTotal: null };
    assert.equal(shouldReleaseLushaReservation(zero), true);
    assert.equal(
      shouldRecordLushaProviderUsage({ ...zero, settlementStatus: 'released' }),
      false,
    );

    const one = { pagesRequested: 1, creditsChargedTotal: 1 };
    assert.equal(shouldReleaseLushaReservation(one), false);
    assert.equal(
      shouldRecordLushaProviderUsage({ ...one, settlementStatus: 'confirmed' }),
      true,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// I. ERROR DEL PROVEEDOR DESPUÉS DE LA LLAMADA
// ══════════════════════════════════════════════════════════════════════════════

describe('I. PROVIDER ERROR AFTER CALL — estado terminal veraz, sin replay', () => {
  it('un fallo tras la primera petición SÍ deja fila, con status error', async () => {
    const { client, inserts } = makeClient();
    const out = await recordLushaRunProviderUsage(
      fixtureInput({
        run: fixtureRun({
          status: 'error',
          stopReason: 'provider_failure',
          creditsChargedTotal: 1,
          rawResultsTotal: 10,
          pagesRequested: 2,
          providerRequestsUsed: 2,
        }),
      }),
      { client, loadPricing },
    );

    assert.equal(out.kind, 'logged');
    assert.equal(inserts[0].row['status'], 'error');
    assert.equal(inserts[0].row['error_code'], 'provider_failure');
    assert.equal(inserts[0].row['credits_used'], 1);
    // El mensaje crudo NUNCA entra: podría arrastrar texto del proveedor.
    assert.equal(inserts[0].row['error_message'], null);
  });

  it('una corrida que lanzó (sin resultado) se registra conservadora y como `unknown`', async () => {
    const { client, inserts } = makeClient();
    const out = await recordLushaRunProviderUsage(
      fixtureInput({
        settlement: { status: 'failed', code: 'settlement_threw', creditsReportedActual: null },
        run: fixtureRun({
          status: 'error',
          creditsChargedTotal: null,
          rawResultsTotal: null,
          resultsReturned: null,
          pagesRequested: null,
          providerRequestsUsed: null,
          stopReason: null,
          telemetry: null,
        }),
      }),
      { client, loadPricing },
    );

    assert.equal(out.kind, 'logged', 'el presupuesto cobró conservador; callar sería mentir');
    assert.equal(inserts[0].row['credits_used'], 6);
    assert.equal(inserts[0].row['billing_state'], 'unknown', 'sin evidencia utilizable');
    assert.equal(inserts[0].row['status'], 'error');
  });

  it('liquidación fallida CON número reportado sigue siendo evidencia (`recorded`)', () => {
    assert.equal(
      resolveLushaUsageBillingState({
        settlement: { status: 'failed', code: 'rpc_down', creditsReportedActual: 3 },
        providerReportedCredits: 3,
      }),
      'recorded',
    );
    assert.equal(
      resolveLushaUsageBillingState({
        settlement: { status: 'failed', code: 'rpc_down', creditsReportedActual: null },
        providerReportedCredits: null,
      }),
      'unknown',
    );
  });

  it('nunca promueve a `provider_confirmed` por su cuenta', () => {
    for (const status of ['confirmed', 'already_terminal', 'released'] as const) {
      const state = resolveLushaUsageBillingState({
        settlement: { status } as LushaBudgetSettlementOutcome,
        providerReportedCredits: 3,
      });
      assert.notEqual(state, 'provider_confirmed');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J. FALLO DEL INSERT — sin replay de proveedor ni de liquidación
// ══════════════════════════════════════════════════════════════════════════════

describe('J. LOG INSERT FAILURE — nada se reintenta', () => {
  it('devuelve el fallo sin lanzar y sin reintentar el insert', async () => {
    // `calls` es un getter: NO se puede desestructurar con spread (congelaría el
    // valor en 0 y la guarda pasaría siempre). Se lee del objeto.
    const capture = makeClient(() => ({
      code: '42501',
      message: 'permission denied for table provider_usage_logs',
    }));
    const out = await recordLushaRunProviderUsage(fixtureInput(), {
      client: capture.client,
      loadPricing,
    });

    assert.equal(out.kind, 'failed');
    assert.equal(capture.calls, 1, 'un solo intento: no hay bucle de reintento');
    assert.equal(capture.inserts.length, 1);
  });

  it('un cliente que LANZA no propaga: el recolector es total', async () => {
    const throwingClient = {
      from() {
        return {
          insert(): PromiseLike<{ error: null }> {
            throw new Error('socket hang up');
          },
        };
      },
    };
    const out = await recordLushaRunProviderUsage(fixtureInput(), {
      client: throwingClient as never,
      loadPricing,
    });
    assert.equal(out.kind, 'failed');
  });

  it('una tarifa que LANZA tampoco propaga', async () => {
    const { client } = makeClient();
    const out = await recordLushaRunProviderUsage(fixtureInput(), {
      client,
      loadPricing: () => Promise.reject(new Error('pricing table unreachable')),
    });
    // Degrada a costo desconocido, no a excepción.
    assert.equal(out.kind, 'logged');
  });

  it('sin cliente admin no inventa nada: se salta y lo dice', async () => {
    const out = await recordLushaRunProviderUsage(fixtureInput(), {
      client: null,
      loadPricing,
    });
    assert.equal(out.kind, 'skipped_no_supabase');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K. REENTRADA IDEMPOTENTE
// ══════════════════════════════════════════════════════════════════════════════

describe('K. IDEMPOTENT REENTRY — la misma corrida terminal, dos veces', () => {
  it('la segunda vez NO crea una segunda fila económica', async () => {
    const { client, inserts } = makeUsageKeyUniqueClient();

    const first = await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });
    const second = await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });

    assert.equal(first.kind, 'logged');
    assert.equal(second.kind, 'already_logged', 'un 23505 es idempotencia, no un error');
    assert.equal(inserts.length, 1, 'EXACTAMENTE una fila para la misma corrida');
  });

  it('la clave es determinística: nada de random, timestamps ni UUID nuevos', () => {
    const a = fixtureCorrelation();
    const b = fixtureCorrelation();
    assert.equal(buildLushaRunUsageKey(a.idempotencyKey), buildLushaRunUsageKey(b.idempotencyKey));
    assert.match(buildLushaRunUsageKey(a.idempotencyKey), /^lusha_company_prospecting:[0-9a-f]{32}$/);
  });

  it('el `batchId` que se resuelve DESPUÉS no altera la clave', () => {
    const withoutBatch = fixtureCorrelation({ batchId: null });
    const withBatch = withResolvedIds(withoutBatch, { batchId: BATCH_ID });
    assert.equal(
      buildLushaRunUsageKey(withoutBatch.idempotencyKey),
      buildLushaRunUsageKey(withBatch.idempotencyKey),
      'si el lote cambiara la clave, el mismo gasto se registraría dos veces',
    );
  });

  it('una reserva DISTINTA es una corrida distinta y se registra aparte', () => {
    const first = fixtureCorrelation();
    const retry = fixtureCorrelation({ reservationId: '55555555-5555-4555-8555-555555555555' });
    assert.notEqual(
      buildLushaRunUsageKey(first.idempotencyKey),
      buildLushaRunUsageKey(retry.idempotencyKey),
    );
  });

  it('la idempotencia se apoya en `usage_key`, el ÚNICO índice único de Producción', () => {
    // `idempotency_key` es una columna INDEXADA pero NO única: confiar en ella no
    // impediría una segunda fila. La columna se escribe igual, para consultar.
    const source = readCode('server/prospect-batches/lusha-provider-usage-observability.ts');
    assert.match(source, /usage_key: buildLushaRunUsageKey\(/);
    assert.doesNotMatch(source, /Math\.random/);
    assert.doesNotMatch(source, /Date\.now/);
    assert.doesNotMatch(source, /randomUUID/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// L. METADATA SEGURA
// ══════════════════════════════════════════════════════════════════════════════

describe('L. SAFE METADATA — sin payload crudo, sin claves, sin PII', () => {
  const FORBIDDEN_KEY_RE =
    /(api[_-]?key|apikey|authorization|bearer|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|email|phone|mobile|linkedin|raw_response|raw_request|response_body|request_body|payload|contact_name|first_name|last_name|company_name|domain)/i;

  /**
   * `input_tokens` / `output_tokens` son CONTADORES de tokens de LLM y columnas
   * canónicas de la tabla desde su creación — no credenciales. Se declaran aquí
   * en vez de aflojar el patrón, que seguiría atrapando un `access_token`.
   */
  const TOKEN_COUNTER_COLUMNS = new Set(['input_tokens', 'output_tokens']);

  function walk(value: unknown, path: string, visit: (path: string, key: string, value: unknown) => void) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        visit(path, k, v);
        walk(v, `${path}.${k}`, visit);
      }
    }
  }

  it('ninguna clave de la metadata nombra un secreto, un payload ni PII', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });

    const offenders: string[] = [];
    walk(inserts[0].row['metadata'], 'metadata', (path, key) => {
      if (FORBIDDEN_KEY_RE.test(key)) offenders.push(`${path}.${key}`);
    });
    assert.deepEqual(offenders, [], `claves prohibidas en metadata: ${offenders.join(', ')}`);
  });

  it('tampoco los hay en la fila entera fuera de metadata', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });

    const rowKeys = Object.keys(inserts[0].row).filter(
      (k) => k !== 'metadata' && !TOKEN_COUNTER_COLUMNS.has(k),
    );
    const offenders = rowKeys.filter((k) => FORBIDDEN_KEY_RE.test(k));
    assert.deepEqual(offenders, []);

    // Prueba negativa: el patrón sigue atrapando una credencial de verdad.
    assert.ok(FORBIDDEN_KEY_RE.test('access_token'));
    assert.ok(FORBIDDEN_KEY_RE.test('api_key'));
    assert.equal(FORBIDDEN_KEY_RE.test('input_tokens'), false);
  });

  it('la metadata sólo transporta cifras, claves de catálogo, ids internos y motivos', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });

    const serialized = JSON.stringify(inserts[0].row['metadata']);
    // Nada que se parezca a un correo, a un teléfono E.164 o a una clave larga.
    assert.doesNotMatch(serialized, /[\w.+-]+@[\w-]+\.[\w.]+/, 'no puede haber un correo');
    assert.doesNotMatch(serialized, /\+\d{10,15}/, 'no puede haber un teléfono');

    const obs = (inserts[0].row['metadata'] as Record<string, unknown>)[
      LUSHA_USAGE_OBSERVABILITY_METADATA_KEY
    ] as Record<string, unknown>;
    assert.equal(obs['country_code'], 'CO');
    assert.equal(obs['macro_industry_key'], 'health_pharma');
  });

  it('el módulo puro no importa el cliente del proveedor ni nada de HubSpot', () => {
    const source = readCode('server/prospect-batches/lusha-provider-usage-observability.ts');
    assert.doesNotMatch(source, /lusha-client|searchLushaCompanies|hubspot/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// M. APOLLO NO CAMBIA
// ══════════════════════════════════════════════════════════════════════════════

describe('M. APOLLO REGRESSION — el motor compartido no cambia sus filas', () => {
  it('sigue exportando los mismos nombres con las mismas firmas', async () => {
    const apollo = await import(
      '../../agents/prospecting-toolkit/apollo-organizations-usage-logging'
    );
    for (const name of [
      'buildApolloOrgsUsageKey',
      'buildCorrelationColumns',
      'buildProviderUsageLogRow',
      'realLogApolloOrgsUsage',
      'resolveProviderUsageBillingState',
      'CORRELATION_COLUMNS_FALLBACK_SIGNAL',
    ]) {
      assert.ok(name in apollo, `Apollo debe seguir exportando ${name}`);
    }
  });

  /**
   * 🔴 RATCHET INVERTIDO, NO BORRADO (AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1 · P1-1).
   *
   * Antes: «la fila de Apollo conserva su colapso histórico de
   * estimated_cost_usd a 0». Ese ratchet decía, con razón, que alinear Apollo era
   * una decisión de la dueña y no un efecto colateral de dar observabilidad a
   * Lusha. La decisión llegó —P1-1 de este corte la autoriza explícitamente— así
   * que el ratchet cambia de lado porque la verdad cambió.
   *
   * La superficie protegida NO se mueve: sigue siendo que la fila de Apollo diga
   * la verdad sobre el costo. Lo que se invierte es cuál es esa verdad.
   *
   * 🔴 Y el peligro se invierte con ella. El defecto que se corrige era una fila
   * que declaraba `estimated_cost_usd = 0` llevando `pricing_missing_warning:
   * true` al lado: un panel de gasto sumaba cero dólares por operaciones que sí
   * se cobraron. Lo que hay que impedir ahora es que alguien «restaure» el
   * colapso creyendo que preserva el comportamiento histórico.
   */
  it('la fila de Apollo preserva el costo DESCONOCIDO, igual que la de Lusha', async () => {
    const { buildProviderUsageLogRow } = await import(
      '../../agents/prospecting-toolkit/apollo-organizations-usage-logging'
    );

    const unknown = buildProviderUsageLogRow({
      provider_key: 'apollo',
      operation_key: 'organizations_search',
      estimated_cost_usd: null,
    });
    assert.equal(unknown['estimated_cost_usd'], null, 'null explícito ⇒ SQL NULL');
    assert.notEqual(unknown['estimated_cost_usd'], 0, 'jamás un 0 fabricado');
    assert.equal(unknown['real_cost_usd'], null, 'se sigue conciliando post-factura');

    // 🔴 El resto del contrato NO se movió, y por eso ninguna fila existente
    // cambia de valor: un cero CONOCIDO sigue siendo 0, y omitirlo conserva la
    // semántica histórica.
    const knownZero = buildProviderUsageLogRow({
      provider_key: 'apollo',
      operation_key: 'organizations_search',
      estimated_cost_usd: 0,
    });
    assert.equal(knownZero['estimated_cost_usd'], 0);

    const omitted = buildProviderUsageLogRow({
      provider_key: 'apollo',
      operation_key: 'organizations_search',
    });
    assert.equal(omitted['estimated_cost_usd'], 0, 'undefined no cambia de significado');
  });

  it('las DOS rutas comparten ya un solo contrato de costo desconocido', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing: loadNoPricing });
    assert.equal(inserts[0].row['estimated_cost_usd'], null);

    // 🔴 Que coincidan es el punto: mientras divergían, comparar el gasto de los
    // dos proveedores exigía saber cuál de las dos convenciones aplicaba cada fila.
    const { buildProviderUsageLogRow } = await import(
      '../../agents/prospecting-toolkit/apollo-organizations-usage-logging'
    );
    assert.equal(
      buildProviderUsageLogRow({
        provider_key: 'apollo',
        operation_key: 'organizations_search',
        estimated_cost_usd: null,
      })['estimated_cost_usd'],
      inserts[0].row['estimated_cost_usd'],
    );
  });

  it('Apollo conserva su precedencia de billing_state entre correlación y gasto', async () => {
    const { resolveProviderUsageBillingState } = await import(
      '../../agents/prospecting-toolkit/apollo-organizations-usage-logging'
    );
    assert.equal(
      resolveProviderUsageBillingState({ run_correlation: { billing_state: 'recorded' } }),
      'recorded',
    );
    assert.equal(
      resolveProviderUsageBillingState({ spend_observability: { billing_state: 'estimated' } }),
      'estimated',
      'el fallback de spend_observability sigue vivo',
    );
    assert.equal(resolveProviderUsageBillingState({}), null);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// N. EL LOGGER NO ES UNA AUTORIDAD DE PRESUPUESTO
// ══════════════════════════════════════════════════════════════════════════════

describe('N. BUDGET REGRESSION — la observabilidad no puede gastar', () => {
  const USAGE_MODULES = [
    'server/prospect-batches/lusha-provider-usage-observability.ts',
    'server/prospect-batches/lusha-provider-usage-recorder.ts',
    'modules/usage-tracking/correlated-provider-usage-log.ts',
  ];

  it('ningún módulo de uso puede reservar, confirmar ni liberar créditos', () => {
    for (const rel of USAGE_MODULES) {
      const source = readCode(rel);
      for (const forbidden of [
        'reserveWizardPilotCredits',
        'confirmWizardPilotCredits',
        'releaseWizardPilotCredits',
        'try_reserve_wizard_credits',
        'confirm_wizard_credits',
        'release_wizard_credits',
        'wizard_monthly_budget_periods',
        'wizard_budget_reservations',
      ]) {
        assert.ok(
          !source.includes(forbidden),
          `${rel} no puede referenciar la autoridad de presupuesto: ${forbidden}`,
        );
      }
    }
  });

  it('ningún módulo de uso puede llamar al proveedor', () => {
    for (const rel of USAGE_MODULES) {
      const source = readCode(rel);
      for (const forbidden of ['lusha-client', 'searchLushaCompaniesV3', 'executeLushaPreview', 'getLushaApiKey']) {
        assert.ok(!source.includes(forbidden), `${rel} no puede llamar al proveedor: ${forbidden}`);
      }
    }
  });

  it('la ÚNICA tabla que el motor escribe es provider_usage_logs', () => {
    const engine = readCode('modules/usage-tracking/correlated-provider-usage-log.ts');
    const tables = [...engine.matchAll(/\.from\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(tables)], ['provider_usage_logs']);
  });

  it('§ 15 — NINGÚN módulo de este hito escribe agent_runs ni agent_run_steps', () => {
    const files = [
      ...USAGE_MODULES,
      'modules/prospect-batches/lusha-pending-review-actions.ts',
      'server/prospect-batches/lusha-pending-review.ts',
    ];
    for (const rel of files) {
      const source = readCode(rel);
      assert.doesNotMatch(source, /\.from\(\s*['"]agent_runs['"]\s*\)/, `${rel}`);
      assert.doesNotMatch(source, /\.from\(\s*['"]agent_run_steps['"]\s*\)/, `${rel}`);
      assert.doesNotMatch(source, /createAgentRun|insertAgentRun|recordAgentRun|createAgentRunStep/i, `${rel}`);
    }
  });

  it('la fila no escribe agent_run_id inventado', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });
    assert.equal(inserts[0].row['agent_run_id'], null);
    assert.equal(inserts[0].row['agent_run_step_id'], null);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// § 3 — NINGUNA MIGRACIÓN: la fila cabe en el esquema que YA existe
// ══════════════════════════════════════════════════════════════════════════════

describe('§ 3 — la fila cabe en el esquema vivo, sin migración', () => {
  // Columnas REALES de `provider_usage_logs` en Producción, verificadas por
  // lectura de `information_schema`. 🔴 `pricing_version`, `provider_role`,
  // `routing_group_id`, `operation_category`, `run_id` y `orchestrator_run_id`
  // NO EXISTEN, aunque el enunciado del hito los diera por presentes: escribir
  // cualquiera de ellos haría fallar el insert entero y perder el log de gasto.
  const LIVE_COLUMNS = new Set([
    'id', 'agent_run_id', 'agent_run_step_id', 'provider_key', 'operation_key', 'model',
    'input_tokens', 'output_tokens', 'credits_used', 'results_returned', 'estimated_cost_usd',
    'real_cost_usd', 'status', 'error_code', 'error_message', 'duration_ms', 'triggered_by',
    'metadata', 'created_at', 'batch_id', 'usage_key', 'triggered_by_role_key',
    'triggered_by_group_id', 'reservation_id', 'client_request_id', 'wizard_run_id',
    'request_fingerprint', 'idempotency_key', 'billing_state',
  ]);

  it('toda columna insertada existe en el esquema vivo', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });

    const unknown = Object.keys(inserts[0].row).filter((c) => !LIVE_COLUMNS.has(c));
    assert.deepEqual(unknown, [], `columnas inexistentes: ${unknown.join(', ')}`);
  });

  it('`pricing_version` viaja en metadata porque NO es una columna', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });
    assert.equal('pricing_version' in inserts[0].row, false);
    const pricing = (inserts[0].row['metadata'] as Record<string, unknown>)['pricing'] as Record<string, unknown>;
    assert.equal(pricing['pricing_version'], LUSHA_COMPANY_DISCOVERY_PRICING_VERSION);
  });

  it('las seis columnas de correlación son exactamente las de la migración 100', async () => {
    const { client, inserts } = makeClient();
    await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });
    for (const column of PROVIDER_USAGE_CORRELATION_COLUMN_NAMES) {
      assert.ok(column in inserts[0].row, `falta la columna de correlación ${column}`);
    }
  });

  it('con el flag de columnas APAGADO la fila sigue siendo insertable y conciliable', async () => {
    process.env[PROVIDER_USAGE_CORRELATION_COLUMNS_FLAG] = 'false';
    const { client, inserts } = makeClient();
    const out = await recordLushaRunProviderUsage(fixtureInput(), { client, loadPricing });

    assert.equal(out.kind, 'logged');
    for (const column of PROVIDER_USAGE_CORRELATION_COLUMN_NAMES) {
      assert.equal(column in inserts[0].row, false, `${column} no debe escribirse con el flag off`);
    }
    // Y la correlación NO se pierde: sigue en metadata.
    const corr = (inserts[0].row['metadata'] as Record<string, unknown>)['run_correlation'] as Record<string, unknown>;
    assert.equal(corr['reservation_id'], RESERVATION_ID);
    assert.equal(corr['billing_state'], 'recorded');
  });

  it('este hito no añade ninguna migración', () => {
    for (const rel of [
      'server/prospect-batches/lusha-provider-usage-observability.ts',
      'server/prospect-batches/lusha-provider-usage-recorder.ts',
      'modules/usage-tracking/correlated-provider-usage-log.ts',
    ]) {
      const source = readCode(rel);
      assert.doesNotMatch(source, /ALTER TABLE|CREATE TABLE|CREATE INDEX/i, rel);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// § 12 — ORDEN Y SEGURIDAD ANTE FALLOS, EN EL CABLEADO REAL
// ══════════════════════════════════════════════════════════════════════════════

describe('§ 12 — la acción liquida ANTES de registrar, y el registro no replay-ea', () => {
  function actionCode(): string {
    return readCode('modules/prospect-batches/lusha-pending-review-actions.ts');
  }

  it('el registro ocurre DESPUÉS de la liquidación en los dos caminos de salida', () => {
    const code = actionCode();
    // Camino de éxito.
    const success = code.indexOf('const settlement = await settleReservationObservably(result)');
    const successLog = code.indexOf('await recordRunUsageObservably(result, settlement)');
    assert.ok(success > -1, 'la liquidación debe devolver su desenlace');
    assert.ok(successLog > success, 'la observabilidad va después de la liquidación');

    // Camino de fallo.
    const failure = code.indexOf('const settlement = await settleReservationObservably(null)');
    const failureLog = code.indexOf('await recordRunUsageObservably(null, settlement)');
    assert.ok(failure > -1);
    assert.ok(failureLog > failure);
  });

  it('el registro está envuelto para que un fallo no vuelva a liquidar', () => {
    // Si el registro lanzara, el `catch` de la acción liquidaría por SEGUNDA vez
    // y devolvería un error por una corrida ya cobrada, invitando a un reintento
    // que gastaría otra vez.
    const code = actionCode();
    const helper = code.slice(
      code.indexOf('const recordRunUsageObservably'),
      code.indexOf('try {\n    const result = await persistLushaPendingReviewBatch'),
    );
    assert.match(helper, /try\s*\{/, 'el helper de registro debe capturar');
    assert.match(helper, /\}\s*catch/, 'y no dejar escapar nada');
  });

  it('la acción NO accede a provider_usage_logs por su cuenta', () => {
    // La frontera se ensancha por UNA tabla, pero el acceso pasa por el seam
    // canónico revisado — no por un `.from()` suelto en la acción.
    assert.doesNotMatch(actionCode(), /\.from\(\s*['"]provider_usage_logs['"]\s*\)/);
  });

  it('el writer puro sigue sin saber nada de observabilidad de uso', () => {
    const writer = readCode('server/prospect-batches/lusha-pending-review.ts');
    assert.doesNotMatch(writer, /\.from\(\s*['"]provider_usage_logs['"]\s*\)/);
    assert.doesNotMatch(writer, /recordLushaRunProviderUsage/);
  });

  it('§ 14 — el registro no toca ninguna decisión de #306', () => {
    for (const rel of [
      'server/prospect-batches/lusha-provider-usage-observability.ts',
      'server/prospect-batches/lusha-provider-usage-recorder.ts',
    ]) {
      const source = readCode(rel);
      // Observa el veredicto; nunca lo produce ni lo modifica.
      for (const forbidden of [
        'resolveLushaRemainingGap',
        'industryMatches',
        'buildLushaIcpSizeGate',
        'resolveLushaCandidateDuplicateState',
        'insertCandidates',
        'prospect_candidates',
      ]) {
        assert.ok(!source.includes(forbidden), `${rel} no puede intervenir en #306: ${forbidden}`);
      }
    }
  });
});
