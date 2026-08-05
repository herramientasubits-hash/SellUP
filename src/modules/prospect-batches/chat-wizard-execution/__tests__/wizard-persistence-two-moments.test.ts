/**
 * A1-APOLLO-PERSISTENCE-READINESS-4-FIX · § 6 — el fixture QA-2 en sus DOS
 * momentos, con copy que no se mezcla.
 *
 * `identity_key unavailable` describe dos corridas económicamente opuestas, y
 * antes de este hito ambas terminaban contando lo mismo:
 *
 *   MOMENTO A — el preflight lo detecta ANTES de gastar.
 *               0 proveedores, 0 créditos, 0 escrituras.
 *               Lo que el usuario debe leer: la base no está preparada, y NO se
 *               consumió nada.
 *
 *   MOMENTO B — el esquema estaba disponible y el writer falla DESPUÉS.
 *               El proveedor ya corrió; 1 elegible, 0 guardados.
 *               Lo que el usuario debe leer: encontramos una empresa pero no se
 *               pudo guardar, y NO repitas la búsqueda.
 *
 * Intercambiar esos textos es un daño concreto en las dos direcciones: decir «no
 * se consumieron créditos» cuando ya se pagaron 12 miente sobre el gasto, y decir
 * «no vuelvas a intentarlo, ya se cobró» cuando nada se cobró bloquea a alguien
 * que sólo tenía que esperar una migración. Esta prueba fija la separación.
 *
 * Ambos momentos corren por `executeProspectWizardGeneration` —la MISMA función
 * de producción—. Offline: sin Supabase, sin Apollo, sin Tavily, sin créditos.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeProspectWizardGeneration,
  type WizardExecutionDeps,
} from '../wizard-execution-actions';
import { resolveWizardResultCopy } from '../wizard-result-copy';
import {
  mapPersistenceNotReady,
  PERSISTENCE_NOT_READY_NO_SPEND,
} from '@/components/prospect-batches/chat-wizard/wizard-execution-error-map';
import {
  buildQa2NoNewCandidatesBreakdown,
  buildQa2TwoRoundObservability,
  QA2_ELIGIBLE_COMPANY,
} from '@/server/agents/prospecting-toolkit/__tests__/qa2-persistence-fixture';
import type { PersistenceReadinessProbe } from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';
import { IDENTITY_KEY_UNAVAILABLE_ERROR_CODE } from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';

const CLIENT_REQUEST_ID = '44444444-4444-4444-8444-444444444444';

const VALID_REQUEST = {
  countryCode: 'CO',
  industryId: '22222222-2222-4222-8222-222222222222',
  subindustryIds: [],
  additionalCriteriaRaw: null,
  catalogVersion: '33333333-3333-4333-8333-333333333333',
  clientRequestId: CLIENT_REQUEST_ID,
};

/** Cifras REALES de LIVE-QA-2 tal como el writer las devuelve (§ 7). */
const QA2_WRITER_OUTCOME = {
  eligibleBeforePersistence: 1,
  persistedCandidates: 0,
  persistenceFailureCount: 1,
  persistenceFailed: true,
  persistenceErrorCode: IDENTITY_KEY_UNAVAILABLE_ERROR_CODE,
} as const;

type Spy = { providerCalls: number; reserveBudgetCalls: number; confirmBudgetCalls: number };

function buildDeps(
  spy: Spy,
  probe: PersistenceReadinessProbe,
  pipelineResult: unknown,
): WizardExecutionDeps {
  return {
    getActiveUserId: async () => 'user_1',
    resolveCatalog: async () => ({
      country: { code: 'CO', name: 'Colombia' },
      catalog: { version: VALID_REQUEST.catalogVersion },
      industry: { id: VALID_REQUEST.industryId, slug: 'retail', name: 'Retail' },
      subindustries: [],
    }),
    checkTavilyAvailability: async () => true,
    checkApolloAvailability: async () => ({ available: true }) as never,
    checkPersistenceReadiness: async () => probe,
    reserveBudget: async () => {
      spy.reserveBudgetCalls++;
      return { status: 'reserved', reservationId: 'res_1', creditsReserved: 12 };
    },
    confirmBudget: async () => {
      spy.confirmBudgetCalls++;
      return { status: 'confirmed' } as never;
    },
    releaseBudget: async () => ({ status: 'released' }) as never,
    readConsumedCredits: async () => 0,
    reserveSlot: async () => ({ status: 'reserved', batchId: 'batch_qa2' }),
    runTavilyPipeline: async () => {
      spy.providerCalls++;
      return pipelineResult as never;
    },
    runApolloPipeline: async () => {
      spy.providerCalls++;
      return pipelineResult as never;
    },
    resolveProvider: () => 'apollo_organizations',
    markBatchFailed: async () => {},
  };
}

function freshSpy(): Spy {
  return { providerCalls: 0, reserveBudgetCalls: 0, confirmBudgetCalls: 0 };
}

/** Salida del pipeline del MOMENTO B: el proveedor corrió y el writer falló. */
function qa2PipelineResultWithWriterFailure(): unknown {
  return {
    batchId: 'batch_qa2',
    candidatesCreated: 0,
    targetPersistibleCandidates: 5,
    targetReached: false,
    persistenceOutcome: { ...QA2_WRITER_OUTCOME },
    metadata: buildQa2TwoRoundObservability(),
  };
}

before(() => {
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
});
after(() => {
  delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
});

// ─── MOMENTO A ────────────────────────────────────────────────────────────────

describe('§ 6.A — el preflight detecta la columna ausente: nada se gastó', () => {
  it('0 llamadas al proveedor, 0 reservas, 0 confirmaciones de crédito', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { status: 'identity_key_missing' }, qa2PipelineResultWithWriterFailure()),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'PERSISTENCE_NOT_READY');
    assert.equal(spy.providerCalls, 0, 'providerCalls = 0');
    assert.equal(spy.reserveBudgetCalls, 0, 'credits = 0');
    assert.equal(spy.confirmBudgetCalls, 0, 'credits = 0');
  });

  it('la UI dice «la base no está preparada» y afirma que no hubo consumo', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { status: 'identity_key_missing' }, qa2PipelineResultWithWriterFailure()),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;

    const copy = mapPersistenceNotReady(result.persistenceNotReady, result.retryable);
    assert.match(copy.message, /base de datos no está preparada para guardar los candidatos/);
    assert.match(copy.message, /no se ejecutó y no se consumieron créditos/);
    assert.equal(copy.retryable, false, 'la columna ausente no se arregla reintentando');
  });

  it('NUNCA sugiere que el gasto ya ocurrió: eso es el copy del otro momento', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { status: 'identity_key_missing' }, qa2PipelineResultWithWriterFailure()),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;

    const copy = mapPersistenceNotReady(result.persistenceNotReady, result.retryable);
    assert.doesNotMatch(copy.message, /pudo consumir créditos/i);
    assert.doesNotMatch(copy.message, /ya fue ejecutada/i);
    assert.doesNotMatch(copy.message, /No vuelvas a generar/i);
    // Tampoco puede hablar de empresas encontradas: no hubo búsqueda.
    assert.doesNotMatch(copy.message, /Encontramos/i);
    assert.doesNotMatch(copy.message, new RegExp(QA2_ELIGIBLE_COMPANY.name, 'i'));
  });
});

// ─── MOMENTO B ────────────────────────────────────────────────────────────────

describe('§ 6.B — el esquema estaba disponible y el writer falla después', () => {
  it('el proveedor SÍ corrió y la corrida termina en completed_with_errors', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { status: 'available' }, qa2PipelineResultWithWriterFailure()),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(spy.providerCalls, 1, 'providerCalls ya ocurrieron');
    assert.equal(result.status, 'completed_with_errors');
    assert.equal(result.batchStatus, 'failed');
    assert.equal(result.persistenceOutcome?.eligibleBeforePersistence, 1, 'eligible = 1');
    assert.equal(result.persistenceOutcome?.persistedCandidates, 0, 'persisted = 0');
  });

  it('la UI dice «encontramos una empresa pero no pudo guardarse» y advierte no repetir', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { status: 'available' }, qa2PipelineResultWithWriterFailure()),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const copy = resolveWizardResultCopy({
      persistence: result.persistenceOutcome ?? null,
      noNewCandidates: buildQa2NoNewCandidatesBreakdown(),
    });

    assert.equal(copy.source, 'persistence_failure');
    assert.equal(copy.cause, 'persistence_failed');
    assert.match(copy.body, /Encontramos 1 empresa candidata/);
    assert.match(copy.body, /no fue posible guardarla/);
    assert.match(copy.body, /No vuelvas a generar la búsqueda/);
    // § 8 — y sigue sin culpar al historial, que es el defecto original de QA-2.
    assert.equal(copy.claimsRecentlySuggested, false);
  });

  it('NUNCA afirma que no se consumieron créditos: ya se consumieron', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { status: 'available' }, qa2PipelineResultWithWriterFailure()),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const copy = resolveWizardResultCopy({
      persistence: result.persistenceOutcome ?? null,
      noNewCandidates: buildQa2NoNewCandidatesBreakdown(),
    });
    assert.doesNotMatch(copy.body, /no se consumieron créditos/i);
    assert.doesNotMatch(copy.body, /La búsqueda no se ejecutó/i);
    assert.notEqual(copy.body, PERSISTENCE_NOT_READY_NO_SPEND);
  });
});

// ─── La separación ────────────────────────────────────────────────────────────

describe('§ 6 — los dos copies no se mezclan', () => {
  it('ningún texto del momento A aparece en el momento B, ni al revés', async () => {
    const spyA = freshSpy();
    const blocked = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spyA, { status: 'identity_key_missing' }, qa2PipelineResultWithWriterFailure()),
    );
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;

    const spyB = freshSpy();
    const spent = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spyB, { status: 'available' }, qa2PipelineResultWithWriterFailure()),
    );
    assert.equal(spent.ok, true);
    if (!spent.ok) return;

    const copyA = mapPersistenceNotReady(blocked.persistenceNotReady, blocked.retryable).message;
    const copyB = resolveWizardResultCopy({
      persistence: spent.persistenceOutcome ?? null,
      noNewCandidates: buildQa2NoNewCandidatesBreakdown(),
    }).body;

    assert.notEqual(copyA, copyB);
    // La afirmación económica es la que NO puede cruzarse: es la única frase de
    // la que depende que el usuario decida repetir la búsqueda o esperar.
    assert.ok(copyA.includes(PERSISTENCE_NOT_READY_NO_SPEND));
    assert.ok(!copyB.includes(PERSISTENCE_NOT_READY_NO_SPEND));
  });

  it('el momento A no produce cifras de persistencia: no hubo escritura que medir', async () => {
    const spy = freshSpy();
    const result = await executeProspectWizardGeneration(
      VALID_REQUEST,
      buildDeps(spy, { status: 'identity_key_missing' }, qa2PipelineResultWithWriterFailure()),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    // Un fallo no lleva `persistenceOutcome` por contrato: reportar «0 de 1
    // guardados» aquí inventaría una búsqueda que nunca corrió.
    assert.ok(!('persistenceOutcome' in result));
    assert.equal(result.persistenceNotReady?.stage, 'schema_preflight');
  });
});
