/**
 * wizard-budget-overage-reconciliation.test.ts — el sobrepaso del proveedor se
 * liquida, se cuenta ENTERO y deja rastro (AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ VIGILA, Y POR QUÉ NO LO CUBRE LA SUITE DE PostgreSQL
 * ═══════════════════════════════════════════════════════════════════
 *
 * La suite de PostgreSQL (`wizard-budget-overage-postgres.test.ts`) demuestra que la
 * BASE liquida el sobrepaso entero y que la reserva queda terminal. No puede demostrar
 * nada sobre el lado TypeScript, y ahí vivía la mitad silenciosa del defecto:
 *
 *   * el wrapper traducía cualquier código desconocido a `{ status: 'error' }`, así que
 *     `confirmed_with_overage` —una liquidación EXITOSA— habría entrado por el
 *     `default` y se habría leído como fallo de reconciliación. Eso reintroduciría el
 *     defecto desde el llamador: la reserva estaría cerrada y el producto diría que no;
 *   * la ruta Lusha liquidaba con `settleReservation(): Promise<void>` y
 *     `.catch(() => undefined)`. Tres hechos distintos —liquidada, liquidada con
 *     sobrepaso, no liquidada— dejaban exactamente la misma huella: ninguna;
 *   * la ruta compartida Apollo/Tavily descartaba el valor devuelto por
 *     `confirmBudget`, y el wrapper NO lanza. Un `invalid_actual_credits` era
 *     indistinguible de un éxito.
 *
 * Determinista y offline: módulos puros, dobles inyectados y lectura de fuente. Sin
 * red, sin Supabase, sin Apollo, sin Lusha, sin Tavily, 0 créditos y 0 escrituras.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  confirmWizardPilotCredits,
  type BudgetReservationsRpcClient,
} from '../wizard-budget-reservations';
import type { ConfirmWizardCreditsOutput } from '../wizard-pilot-types';
import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type {
  WizardExecutionDeps,
  ReserveBudgetDepResult,
} from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import {
  buildLushaBudgetSettlementTelemetry,
  decideLushaCreditsToConfirm,
  shouldReleaseLushaReservation,
  LUSHA_BUDGET_OVERAGE_LOG_CODE,
  LUSHA_BUDGET_SETTLEMENT_FAILED_LOG_CODE,
  LUSHA_BUDGET_SETTLEMENT_THREW_CODE,
  type LushaBudgetSettlementOutcome,
} from '@/modules/prospect-batches/lusha-budget-gate';
import { estimateLushaRunCredits } from '@/server/prospect-batches/lusha-run-liability';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RESERVATION_ID = 'reservation-overage-0001';
const BATCH_ID = 'batch-overage-0001';

// ── Doble de la RPC ───────────────────────────────────────────────────────────

type RpcCall = { fn: string; params: Record<string, unknown> };

function makeRpc(
  answer: string | null,
  error: { message: string; code?: string } | null = null,
): { rpc: BudgetReservationsRpcClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const rpc = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      return { data: answer, error };
    },
  } as unknown as BudgetReservationsRpcClient;
  return { rpc, calls };
}

// ═══════════════════════════════════════════════════════════════
// § A — El wrapper: confirmed_with_overage es ÉXITO
// ═══════════════════════════════════════════════════════════════

describe('§ A — confirmWizardPilotCredits y el código nuevo', () => {
  it('`confirmed` sigue devolviendo { status: confirmed }', async () => {
    const { rpc } = makeRpc('confirmed');
    const out = await confirmWizardPilotCredits(
      { reservationId: RESERVATION_ID, actualCreditsConsumed: 4, creditsReserved: 6 },
      rpc,
    );
    assert.deepEqual(out, { status: 'confirmed' });
  });

  it('`confirmed_with_overage` es ÉXITO y NO cae en el `default` de error', async () => {
    const { rpc } = makeRpc('confirmed_with_overage');
    const out = await confirmWizardPilotCredits(
      { reservationId: RESERVATION_ID, actualCreditsConsumed: 7, creditsReserved: 6 },
      rpc,
    );
    assert.equal(out.status, 'confirmed_with_overage');
    assert.notEqual(out.status, 'error');
  });

  it('lleva las cifras del sobrepaso: reservado 6, real 7, exceso 1', async () => {
    const { rpc } = makeRpc('confirmed_with_overage');
    const out = await confirmWizardPilotCredits(
      { reservationId: RESERVATION_ID, actualCreditsConsumed: 7, creditsReserved: 6 },
      rpc,
    );
    assert.deepEqual(out, {
      status: 'confirmed_with_overage',
      creditsReserved: 6,
      creditsActual: 7,
      overageCredits: 1,
    });
  });

  it('sin `creditsReserved` el sobrepaso sigue siendo un hecho, con magnitud `null`', async () => {
    const { rpc } = makeRpc('confirmed_with_overage');
    const out = await confirmWizardPilotCredits(
      { reservationId: RESERVATION_ID, actualCreditsConsumed: 7 },
      rpc,
    );
    assert.deepEqual(out, {
      status: 'confirmed_with_overage',
      creditsReserved: null,
      creditsActual: 7,
      // Se declara desconocida en lugar de inventarse contra un número ausente.
      overageCredits: null,
    });
  });

  it('el actual que viaja a la RPC es el REAL, nunca recortado a la reserva', async () => {
    const { rpc, calls } = makeRpc('confirmed_with_overage');
    await confirmWizardPilotCredits(
      { reservationId: RESERVATION_ID, actualCreditsConsumed: 7, creditsReserved: 6 },
      rpc,
    );
    assert.equal(calls[0]!.params.p_actual_credits_consumed, 7);
    assert.notEqual(calls[0]!.params.p_actual_credits_consumed, 6);
  });

  it('`already_confirmed` no cambia', async () => {
    const { rpc } = makeRpc('already_confirmed');
    const out = await confirmWizardPilotCredits(
      { reservationId: RESERVATION_ID, actualCreditsConsumed: 7 },
      rpc,
    );
    assert.deepEqual(out, { status: 'already_confirmed' });
  });

  it('`invalid_actual_credits` sigue siendo error (un actual negativo es un bug del llamador)', async () => {
    const { rpc } = makeRpc('invalid_actual_credits');
    const out = await confirmWizardPilotCredits(
      { reservationId: RESERVATION_ID, actualCreditsConsumed: -1 },
      rpc,
    );
    assert.equal(out.status, 'error');
    assert.equal((out as { code: string }).code, 'invalid_actual_credits');
  });

  it('`reservation_not_found` sigue siendo error', async () => {
    const { rpc } = makeRpc('reservation_not_found');
    const out = await confirmWizardPilotCredits(
      { reservationId: RESERVATION_ID, actualCreditsConsumed: 2 },
      rpc,
    );
    assert.equal(out.status, 'error');
    assert.equal((out as { code: string }).code, 'reservation_not_found');
  });

  it('un error de transporte de la RPC sigue siendo error', async () => {
    const { rpc } = makeRpc(null, { message: 'connection refused' });
    const out = await confirmWizardPilotCredits(
      { reservationId: RESERVATION_ID, actualCreditsConsumed: 2 },
      rpc,
    );
    assert.equal(out.status, 'error');
  });

  it('`creditsReserved` es sólo descriptivo: NO viaja a la RPC', async () => {
    // Quien decide si hubo sobrepaso es la RPC, que tiene la fila bloqueada. Si este
    // número viajara, un llamador podría influir en la decisión económica.
    const { rpc, calls } = makeRpc('confirmed');
    await confirmWizardPilotCredits(
      { reservationId: RESERVATION_ID, actualCreditsConsumed: 4, creditsReserved: 6 },
      rpc,
    );
    assert.deepEqual(Object.keys(calls[0]!.params).sort(), [
      'p_actual_credits_consumed',
      'p_batch_id',
      'p_reservation_id',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// § B — Decisión de créditos de Lusha: sin recorte, conservadora ante la duda
// ═══════════════════════════════════════════════════════════════

describe('§ B — decideLushaCreditsToConfirm', () => {
  it('gasto verificado por debajo de la reserva se confirma tal cual', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: 1 }),
      1,
    );
  });

  it('gasto POR ENCIMA de la reserva se confirma ENTERO, no recortado', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: 5 }),
      5,
    );
    assert.notEqual(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: 5 }),
      2,
    );
  });

  it('gasto no verificable (`null`) confirma la reserva ENTERA (sesgo conservador)', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: null }),
      2,
    );
  });

  it('un 0 reportado se respeta; un negativo no se cree', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: 0 }),
      0,
    );
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: -3 }),
      2,
    );
  });

  it('el camino de liberación no cambia: sólo 0 páginas y 0 cobro liberan', () => {
    assert.equal(
      shouldReleaseLushaReservation({ pagesRequested: 0, creditsChargedTotal: null }),
      true,
    );
    assert.equal(
      shouldReleaseLushaReservation({ pagesRequested: 1, creditsChargedTotal: null }),
      false,
    );
    assert.equal(
      shouldReleaseLushaReservation({ pagesRequested: 0, creditsChargedTotal: 1 }),
      false,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// § C — Telemetría de liquidación: el sobrepaso y el fallo dejan rastro
// ═══════════════════════════════════════════════════════════════

describe('§ C — buildLushaBudgetSettlementTelemetry', () => {
  const context = {
    reservationId: RESERVATION_ID,
    creditsReserved: 2,
    batchId: BATCH_ID,
  };

  it('un sobrepaso produce el log `lusha_budget_overage_confirmed` con las tres cifras', () => {
    const telemetry = buildLushaBudgetSettlementTelemetry(
      {
        status: 'confirmed_with_overage',
        creditsReserved: 2,
        creditsActual: 3,
        overageCredits: 1,
      },
      context,
    );
    assert.ok(telemetry);
    assert.equal(telemetry!.code, LUSHA_BUDGET_OVERAGE_LOG_CODE);
    assert.deepEqual(telemetry!.payload, {
      provider: 'lusha',
      reservationId: RESERVATION_ID,
      creditsReserved: 2,
      creditsReportedActual: 3,
      overageCredits: 1,
      batchId: BATCH_ID,
    });
  });

  it('una liquidación fallida produce `lusha_budget_settlement_failed` con la clasificación', () => {
    const telemetry = buildLushaBudgetSettlementTelemetry(
      { status: 'failed', code: 'invalid_actual_credits', creditsReportedActual: 3 },
      context,
    );
    assert.ok(telemetry);
    assert.equal(telemetry!.code, LUSHA_BUDGET_SETTLEMENT_FAILED_LOG_CODE);
    assert.deepEqual(telemetry!.payload, {
      provider: 'lusha',
      reservationId: RESERVATION_ID,
      creditsReserved: 2,
      creditsReportedActual: 3,
      rpcCode: 'invalid_actual_credits',
      batchId: BATCH_ID,
    });
  });

  it('una liquidación que LANZÓ se clasifica y también deja rastro', () => {
    const telemetry = buildLushaBudgetSettlementTelemetry(
      {
        status: 'failed',
        code: LUSHA_BUDGET_SETTLEMENT_THREW_CODE,
        creditsReportedActual: null,
      },
      context,
    );
    assert.ok(telemetry);
    assert.equal(telemetry!.payload.rpcCode, LUSHA_BUDGET_SETTLEMENT_THREW_CODE);
  });

  it('el curso normal NO genera ruido: confirmed, released y already_terminal → null', () => {
    const quiet: LushaBudgetSettlementOutcome[] = [
      { status: 'confirmed' },
      { status: 'released' },
      { status: 'already_terminal' },
    ];
    for (const outcome of quiet) {
      assert.equal(
        buildLushaBudgetSettlementTelemetry(outcome, context),
        null,
        `${outcome.status} no debería registrarse`,
      );
    }
  });

  it('el payload NO contiene secretos ni PII: sólo cifras e IDs internos', () => {
    const telemetry = buildLushaBudgetSettlementTelemetry(
      {
        status: 'confirmed_with_overage',
        creditsReserved: 2,
        creditsActual: 3,
        overageCredits: 1,
      },
      context,
    );
    const serialized = JSON.stringify(telemetry!.payload).toLowerCase();
    for (const forbidden of [
      'apikey',
      'api_key',
      'authorization',
      'email',
      'phone',
      'linkedin',
      'domain',
      'companyname',
      'contact',
    ]) {
      assert.doesNotMatch(
        serialized,
        new RegExp(forbidden),
        `el log de contabilidad no debe llevar ${forbidden}`,
      );
    }
  });

  it('sin batchId el campo es `null`, no se omite ni se inventa', () => {
    const telemetry = buildLushaBudgetSettlementTelemetry(
      { status: 'failed', code: 'x', creditsReportedActual: null },
      { reservationId: RESERVATION_ID, creditsReserved: 2, batchId: null },
    );
    assert.equal(telemetry!.payload.batchId, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// § D — La ACCIÓN de Lusha usa todo eso (ratchets de fuente)
// ═══════════════════════════════════════════════════════════════
//
// El seam puede ser perfecto y no estar cableado: así fue el defecto original de la
// puerta de presupuesto —toda la maquinaria existía y la ruta Lusha no la llamaba—.
// Estas aserciones fallan si alguien devuelve `settleReservation` a `Promise<void>`,
// vuelve a poner `.catch(() => undefined)` o quita el log.

describe('§ D — cableado en lusha-pending-review-actions.ts', () => {
  const ACTION_PATH = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';
  const action = read(ACTION_PATH);

  /** Quita comentarios: estas fuentes DOCUMENTAN lo que no hacen. */
  const code = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const actionCode = code(action);

  it('la liquidación devuelve un resultado DISCRIMINADO, no `Promise<void>`', () => {
    assert.match(actionCode, /Promise<LushaBudgetSettlementOutcome>/);
    // El límite del identificador importa: `settleReservationObservably` SÍ devuelve
    // `Promise<void>` a propósito (es el envoltorio que registra y no propaga).
    assert.doesNotMatch(
      actionCode,
      /const settleReservation = async \([\s\S]{0,200}?\): Promise<void>/,
      'volver a `Promise<void>` borraría el resultado otra vez',
    );
  });

  it('NINGUNA liquidación se descarta con `.catch(() => undefined)`', () => {
    assert.doesNotMatch(
      actionCode,
      /settleReservation\w*\([^)]*\)\s*\.catch\(\s*\(\s*\)\s*=>\s*undefined\s*\)/,
    );
  });

  it('los DOS caminos de salida (éxito y catch) liquidan observablemente', () => {
    const matches = actionCode.match(/await settleReservationObservably\(/g) ?? [];
    assert.equal(matches.length, 2, 'éxito y fallo, ambos');
    assert.match(actionCode, /await settleReservationObservably\(result\)/);
    assert.match(actionCode, /await settleReservationObservably\(null\)/);
  });

  it('la acción importa y USA el constructor de telemetría', () => {
    assert.match(action, /import\s*\{[\s\S]*?buildLushaBudgetSettlementTelemetry/);
    assert.match(actionCode, /buildLushaBudgetSettlementTelemetry\(outcome,/);
    assert.match(actionCode, /console\.warn\(`\[\$\{telemetry\.code\}\]`/);
  });

  it('pasa `creditsReserved` al wrapper para poder nombrar la magnitud del sobrepaso', () => {
    assert.match(actionCode, /creditsReserved: reservation\.creditsReserved,/);
  });

  it('el resultado de `confirmWizardPilotCredits` se INSPECCIONA, no se descarta', () => {
    assert.match(actionCode, /const confirmed = await confirmWizardPilotCredits\(/);
    assert.match(actionCode, /case 'confirmed_with_overage':/);
  });

  it('una liquidación fallida NO convierte la corrida exitosa en fallo de proveedor', () => {
    // `settleReservationObservably` devuelve `Promise<void>` y captura: el resultado
    // de la búsqueda se devuelve igual. Lo que cambia es que el fallo se registra.
    assert.match(
      actionCode,
      /const settleReservationObservably[\s\S]{0,400}?Promise<void>/,
    );
    assert.match(
      actionCode,
      /try \{\s*outcome = await settleReservation\(result\);\s*\} catch/,
    );
  });

  it('el techo de la corrida Lusha sigue siendo 2: este PR no toca el runtime', () => {
    assert.equal(estimateLushaRunCredits(), 2);
  });
});

// ═══════════════════════════════════════════════════════════════
// § E — La ruta COMPARTIDA Apollo/Tavily
// ═══════════════════════════════════════════════════════════════

const VALID_REQUEST = {
  countryCode: 'CO',
  industryId: '223e4567-e89b-12d3-a456-426614174001',
  subindustryIds: ['323e4567-e89b-12d3-a456-426614174002'],
  additionalCriteriaRaw: null,
  catalogVersion: 'v2024-01',
  clientRequestId: '423e4567-e89b-12d3-a456-426614174003',
};

const BATCH_SHARED = 'batch-shared-overage-0001';
const RESERVATION_SHARED = 'reservation-shared-overage-0001';

const SHARED_USER_ID = 'user-shared-overage-0001';

const FAKE_CATALOG: CatalogResolutionOutput = {
  country: { code: 'CO', name: 'Colombia' },
  catalog: { version: 'v2024-01' },
  industry: {
    id: '223e4567-e89b-12d3-a456-426614174001',
    slug: 'tecnologia',
    name: 'Tecnología',
  },
  subindustries: [
    {
      id: '323e4567-e89b-12d3-a456-426614174002',
      slug: 'saas',
      name: 'SaaS',
      applicableCountries: ['CO'],
    },
  ],
};

function makePipelineOutput(batchId: string): IncrementalSearchOutput {
  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'tavily',
      targetInternal: 25,
      existingBatchId: batchId,
      triggeredByUserId: SHARED_USER_ID,
      ownerId: SHARED_USER_ID,
      dryRun: false,
    },
    candidates: [],
    candidatesCount: 0,
    usefulCandidatesCount: 5,
    candidatesCreated: 5,
    metadata: {
      rounds_executed: 1,
      stopped_reason: 'min_useful_reached',
      total_raw_evaluated: 10,
      total_candidates_accumulated: 5,
      useful_candidates_count: 5,
      min_useful_candidates: 7,
      target_internal: 25,
      max_rounds: 2,
      max_total_raw_to_evaluate: 50,
      dry_run: false,
      rounds: [],
    },
    warnings: [],
    batchId,
  } as unknown as IncrementalSearchOutput;
}

type SharedHarness = {
  deps: WizardExecutionDeps;
  confirmCalls: {
    reservationId: string;
    actualCreditsConsumed: number;
    creditsReserved?: number | null;
  }[];
};

function makeSharedDeps(
  confirmAnswer: ConfirmWizardCreditsOutput,
  overrides: Partial<WizardExecutionDeps> = {},
): SharedHarness {
  const confirmCalls: SharedHarness['confirmCalls'] = [];
  const deps: WizardExecutionDeps = {
    getActiveUserId: async () => SHARED_USER_ID,
    resolveCatalog: async () => FAKE_CATALOG,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true }) as const,
    reserveBudget: async () =>
      ({
        status: 'reserved',
        reservationId: RESERVATION_SHARED,
        creditsReserved: 6,
      }) satisfies ReserveBudgetDepResult,
    confirmBudget: async (input: SharedHarness['confirmCalls'][number]) => {
      confirmCalls.push(input);
      return confirmAnswer;
    },
    releaseBudget: async () => ({ status: 'released' }),
    // 7 > 6 reservados: el sobrepaso llega hasta la RPC sin recortarse.
    readConsumedCredits: async () => 7,
    reserveSlot: async () => ({ status: 'reserved', batchId: BATCH_SHARED }),
    runTavilyPipeline: async () => makePipelineOutput(BATCH_SHARED),
    markBatchFailed: async () => undefined,
    ...overrides,
  } as unknown as WizardExecutionDeps;
  return { deps, confirmCalls };
}

async function withWizardFlag<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
  try {
    return await fn();
  } finally {
    if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
    else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  }
}

describe('§ E — la ruta compartida Apollo/Tavily acepta el sobrepaso', () => {
  it('`confirmed_with_overage` NO enciende `reconciliationWarning`', async () => {
    await withWizardFlag(async () => {
      const { deps } = makeSharedDeps({
        status: 'confirmed_with_overage',
        creditsReserved: 6,
        creditsActual: 7,
        overageCredits: 1,
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, true);
      assert.equal(
        (result as { reconciliationWarning?: string }).reconciliationWarning,
        undefined,
        'una liquidación con sobrepaso es EXITOSA: avisar de fallo sería mentir',
      );
    });
  });

  it('`confirmed` sigue sin aviso', async () => {
    await withWizardFlag(async () => {
      const { deps } = makeSharedDeps({ status: 'confirmed' });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, true);
      assert.equal(
        (result as { reconciliationWarning?: string }).reconciliationWarning,
        undefined,
      );
    });
  });

  it('un `{ status: error }` de la RPC ahora SÍ se ve (antes se descartaba)', async () => {
    await withWizardFlag(async () => {
      const { deps } = makeSharedDeps({
        status: 'error',
        code: 'invalid_actual_credits',
        message: 'invalid_actual_credits',
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, true, 'la generación NO se convierte en fallo');
      assert.equal(
        (result as { reconciliationWarning?: string }).reconciliationWarning,
        'BUDGET_RECONCILIATION_FAILED',
        'pero la contabilidad fallida deja de ser invisible',
      );
    });
  });

  it('una liquidación que LANZA sigue produciendo el aviso, no un fallo', async () => {
    await withWizardFlag(async () => {
      const { deps } = makeSharedDeps({ status: 'confirmed' }, {
        confirmBudget: async () => {
          throw new Error('rpc down');
        },
      });
      const result = await executeProspectWizardGeneration(VALID_REQUEST, deps);
      assert.equal(result.ok, true);
      assert.equal(
        (result as { reconciliationWarning?: string }).reconciliationWarning,
        'BUDGET_RECONCILIATION_FAILED',
      );
    });
  });

  it('el actual que se envía es 7 (lo consumido), no 6 (lo reservado)', async () => {
    await withWizardFlag(async () => {
      const { deps, confirmCalls } = makeSharedDeps({
        status: 'confirmed_with_overage',
        creditsReserved: 6,
        creditsActual: 7,
        overageCredits: 1,
      });
      await executeProspectWizardGeneration(VALID_REQUEST, deps);
      const settle = confirmCalls.at(-1)!;
      assert.equal(settle.actualCreditsConsumed, 7);
      assert.notEqual(settle.actualCreditsConsumed, 6);
      assert.equal(settle.creditsReserved, 6, 'la reserva viaja sólo como descripción');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// § F — Ratchets sobre la migración 121
// ═══════════════════════════════════════════════════════════════
//
// La suite de PostgreSQL prueba el comportamiento; estas aserciones son un candado
// de INTENCIÓN sobre el archivo, para que un cambio futuro no reintroduzca el rechazo
// o meta un recorte sin que nadie lo note en la revisión.

describe('§ F — la migración 121 no clampa ni rechaza el sobrepaso', () => {
  const MIGRATION_PATH = 'supabase/migrations/121_wizard_budget_overage_reconciliation.sql';
  const sql = read(MIGRATION_PATH);

  it('existe, es la 121 y no toca la 120', () => {
    assert.match(sql, /^-- Migration 121:/);
    assert.doesNotMatch(sql, /provider_suppressions/);
  });

  it('declara APPLIED IN PRODUCTION: NO', () => {
    assert.match(sql, /APPLIED IN PRODUCTION: NO/);
  });

  it('reemplaza la constraint incondicional de la 064 por la condicional', () => {
    assert.match(
      sql,
      /DROP CONSTRAINT IF EXISTS wizard_budget_reservations_consumed_le_reserved/,
    );
    assert.match(
      sql,
      /CHECK \(credits_consumed <= credits_reserved OR status = 'confirmed'\)/,
    );
  });

  it('el rechazo por exceso está FUERA: sólo el negativo se rechaza', () => {
    const body = sql.replace(/^\s*--.*$/gm, '');
    assert.doesNotMatch(
      body,
      /p_actual_credits_consumed\s*>\s*v_res\.credits_reserved\s*THEN\s*RETURN 'invalid_actual_credits'/,
    );
    assert.match(
      body,
      /IF p_actual_credits_consumed < 0 THEN\s*RETURN 'invalid_actual_credits'/,
    );
  });

  it('devuelve `confirmed_with_overage` y suma el actual CRUDO al período', () => {
    assert.match(sql, /RETURN 'confirmed_with_overage'/);
    assert.match(
      sql,
      /credits_consumed = credits_consumed \+ p_actual_credits_consumed/,
    );
  });

  it('NO hay ningún recorte del gasto real', () => {
    const body = sql.replace(/^\s*--.*$/gm, '');
    assert.doesNotMatch(body, /LEAST\s*\(/i);
    assert.doesNotMatch(body, /GREATEST\s*\(\s*0\s*,\s*p_actual_credits_consumed/i);
  });

  it('NO añade tope de gasto al período (el sobregiro real debe ser guardable)', () => {
    assert.doesNotMatch(sql.replace(/^\s*--.*$/gm, ''), /credits_consumed\s*<=\s*budget_credits/);
  });

  it('preserva el contrato de seguridad de la 064', () => {
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = pg_temp/);
    assert.match(sql, /FOR UPDATE/);
    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION public\.confirm_wizard_credits\(UUID, INTEGER, UUID\)\s*\n\s*FROM PUBLIC, anon, authenticated;/,
    );
    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION public\.confirm_wizard_credits\(UUID, INTEGER, UUID\)\s*\n\s*TO postgres, service_role;/,
    );
  });

  it('conserva la idempotencia y los estados terminales', () => {
    assert.match(sql, /IF v_res\.status = 'confirmed' THEN\s*\n\s*RETURN 'already_confirmed'/);
    assert.match(sql, /IF v_res\.status IN \('released', 'failed'\) THEN/);
  });

  it('NO toca `try_reserve_wizard_credits` ni `release_wizard_credits`', () => {
    assert.doesNotMatch(
      sql,
      /CREATE OR REPLACE FUNCTION public\.try_reserve_wizard_credits/,
    );
    assert.doesNotMatch(
      sql,
      /CREATE OR REPLACE FUNCTION public\.release_wizard_credits/,
    );
  });

  it('no inserta, actualiza ni borra ninguna fila de datos', () => {
    const body = sql.replace(/^\s*--.*$/gm, '');
    assert.doesNotMatch(body, /^\s*INSERT INTO/m);
    assert.doesNotMatch(body, /^\s*DELETE FROM/m);
    assert.doesNotMatch(body, /^\s*UPDATE public\.wizard_pilot_settings/m);
  });
});

// ═══════════════════════════════════════════════════════════════
// § G — El tipo compartido
// ═══════════════════════════════════════════════════════════════

describe('§ G — ConfirmCreditsResult incluye el código nuevo', () => {
  const TYPES_PATH =
    'src/modules/prospect-batches/chat-wizard-execution/wizard-pilot-types.ts';
  const types = read(TYPES_PATH);

  it('`confirmed_with_overage` está en la unión de resultados de la RPC', () => {
    assert.match(types, /export type ConfirmCreditsResult =[\s\S]*?'confirmed_with_overage'/);
  });

  it('y en la salida del wrapper, con las cifras del sobrepaso', () => {
    assert.match(
      types,
      /status: 'confirmed_with_overage';\s*\n\s*creditsReserved: number \| null;\s*\n\s*creditsActual: number;\s*\n\s*overageCredits: number \| null;/,
    );
  });

  it('el compilador acepta la rama nueva como salida válida (prueba de tipos en runtime)', () => {
    const overage: ConfirmWizardCreditsOutput = {
      status: 'confirmed_with_overage',
      creditsReserved: 6,
      creditsActual: 7,
      overageCredits: 1,
    };
    assert.equal(overage.status, 'confirmed_with_overage');
  });
});
