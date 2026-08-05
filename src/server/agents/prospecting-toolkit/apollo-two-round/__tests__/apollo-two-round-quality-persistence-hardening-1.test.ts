/**
 * apollo-two-round-quality-persistence-hardening-1.test.ts
 *
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 · §§ 1, 5 y 8.
 *
 * Reconstruye OFFLINE la forma de la corrida `be181d2d…` / lote `e1622574…` con
 * los volúmenes del § 8, y demuestra las dos cosas que allí fallaron:
 *
 *   1. el orquestador publicaba como persistidos a candidatos que un gate
 *      posterior todavía podía rechazar;
 *   2. ese gate —ownership— vivía en el writer, fuera del alcance de la métrica.
 *
 * Sin red, sin Apollo, sin Supabase, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type CheapAssessment,
  type EnrichmentResult,
  type RawDiscoveredOrganization,
} from '../orchestrator';
import { toRunMetricsMetadata, APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '../observability';
import {
  reconcileApolloTwoRoundPersistedTruth,
} from '../../apollo-persisted-candidate-truth';
import { buildCandidateSkipBreakdown } from '../../candidate-skip-reason-taxonomy';
import { decideBatchCompletionSeal } from '../../batch-completion-seal';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  simulatedEffectiveRequestBuilder,
  org,
  passingAssessment,
  ambiguousAssessment,
  rejectedAssessment,
} from './fixtures';

// ─── § 8 · composición del fixture ────────────────────────────────────────────

/**
 * Los topes autorizados de la modalidad: 5 / 2 / 10 / 20 / 5.
 *
 * Son los que la corrida live resolvió, y los que hacen que 20 organizaciones
 * únicas y 5 enrichments quepan sin tocar ningún cap.
 */
function fixtureConfig() {
  return testConfig({
    targetEligibleCompanies: 5,
    maxRounds: 2,
    maxResultsPerRound: 10,
    maxRawResultsPerRun: 20,
    maxEnrichmentsPerRun: 5,
  });
}

/**
 * Reparto de las 20 organizaciones únicas, por rol.
 *
 * `ownership` es la pieza central: pasa TODOS los gates baratos y su sector queda
 * confirmado gratis —igual que «Supermercado La Vaquita», cuyo propio nombre
 * contiene la señal—, así que el orquestador la contaba como elegible. Su dominio,
 * en cambio, no acredita pertenecerle, y eso sólo se veía en el writer.
 */
const ROUND_1: readonly { id: string; role: string }[] = [
  { id: 'hs1', role: 'duplicate_in_hubspot' },
  { id: 'hs2', role: 'duplicate_in_hubspot' },
  { id: 'hs3', role: 'duplicate_in_hubspot' },
  { id: 'hs4', role: 'duplicate_in_hubspot' },
  { id: 'cool1', role: 'cooldown_or_prior_suggestion' },
  { id: 'ctry1', role: 'country_incompatible' },
  { id: 'enr1', role: 'enrichment_candidate' },
  { id: 'enr2', role: 'enrichment_candidate' },
  { id: 'contra1', role: 'sector_evidence_contradictory' },
  { id: 'contra2', role: 'sector_evidence_contradictory' },
];

const ROUND_2: readonly { id: string; role: string }[] = [
  { id: 'hs5', role: 'duplicate_in_hubspot' },
  { id: 'hs6', role: 'duplicate_in_hubspot' },
  { id: 'hs7', role: 'duplicate_in_hubspot' },
  { id: 'hs8', role: 'duplicate_in_hubspot' },
  { id: 'enr3', role: 'enrichment_candidate' },
  { id: 'enr4', role: 'enrichment_candidate' },
  { id: 'enr5', role: 'enrichment_candidate' },
  { id: 'ownership', role: 'ownership_rejected_by_final_gate' },
  { id: 'contra3', role: 'sector_evidence_contradictory' },
  { id: 'contra4', role: 'sector_evidence_contradictory' },
];

/** Los dos enrichments que SÍ confirman la subindustria. */
const CONFIRMED_BY_ENRICHMENT = new Set(['enr1', 'enr2']);

const ROLE_BY_ID = new Map(
  [...ROUND_1, ...ROUND_2].map((entry) => [entry.id, entry.role] as const),
);

function organizationsFor(round: readonly { id: string }[]): RawDiscoveredOrganization[] {
  return round.map((entry, index) => org(entry.id, { providerRank: index + 1 }));
}

function assessmentFor(id: string): CheapAssessment {
  switch (ROLE_BY_ID.get(id)) {
    case 'duplicate_in_hubspot':
      return rejectedAssessment('duplicate_in_hubspot', {
        signals: { ...passingAssessment().signals, knownDuplicate: true },
      });
    case 'cooldown_or_prior_suggestion':
      return rejectedAssessment('cooldown_or_prior_suggestion', {
        noPriorSuggestion: false,
        signals: { ...passingAssessment().signals, cooldownActive: true },
      });
    case 'country_incompatible':
      return rejectedAssessment('country_incompatible', {
        signals: { ...passingAssessment().signals, countryCompatible: false },
      });
    case 'sector_evidence_contradictory':
      return rejectedAssessment('sector_evidence_contradictory', {
        sectorEvidenceState: 'sector_evidence_contradictory',
        signals: {
          ...passingAssessment().signals,
          freeOfContradictoryEvidence: false,
          declaredSectorContradiction: true,
        },
      });
    case 'enrichment_candidate':
      return ambiguousAssessment();
    // El sector se confirma GRATIS: nada barato lo rechaza y su nombre lleva la
    // señal. Es exactamente el estado en que el orquestador lo daba por bueno.
    case 'ownership_rejected_by_final_gate':
      return passingAssessment();
    default:
      return rejectedAssessment('sector_not_mapped');
  }
}

/**
 * Cinco enrichments, todos cobrados: dos confirman la subindustria y tres la
 * dejan igual de ambigua que antes. Ninguno falla ni queda indeterminado, que es
 * lo que exige «cero fallos de persistencia» del § 8.
 */
function enrichmentFor(candidateKey: string): EnrichmentResult {
  const id = candidateKey.replace('apollo:', '');
  return {
    executed: true,
    internalRecordedCredits: 1,
    sectorEvidenceState: CONFIRMED_BY_ENRICHMENT.has(id)
      ? 'sector_evidence_confirmed'
      : 'sector_evidence_missing_needs_enrichment',
  };
}

function buildFixtureDeps(options: { applyFinalGates: boolean }): {
  deps: ApolloTwoRoundDeps;
  enrichCalls: string[];
  finalGateCalls: string[];
} {
  const enrichCalls: string[] = [];
  const finalGateCalls: string[] = [];

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber }) => {
      const organizations = organizationsFor(roundNumber === 1 ? ROUND_1 : ROUND_2);
      return {
        organizations,
        providerRequestCount: 1,
        // Diez resultados por ronda, un crédito por resultado: 20 de búsqueda.
        internalRecordedCredits: organizations.length,
        providerTotalPages: 5,
      };
    },
    assessCandidate: ({ organization }) =>
      assessmentFor(organization.providerOrganizationId ?? ''),
    enrichCandidate: async ({ candidateKey }) => {
      enrichCalls.push(candidateKey);
      return enrichmentFor(candidateKey);
    },
    ...(options.applyFinalGates
      ? {
          applyFinalGates: ({ candidateKey }) => {
            finalGateCalls.push(candidateKey);
            return {
              rejection:
                candidateKey === 'apollo:ownership' ? ('ownership_mismatch' as const) : null,
            };
          },
        }
      : {}),
  };

  return { deps, enrichCalls, finalGateCalls };
}

function runFixture(options: { applyFinalGates: boolean }) {
  const { deps, enrichCalls, finalGateCalls } = buildFixtureDeps(options);
  return runApolloTwoRoundDiscovery(
    {
      config: fixtureConfig(),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
    },
    deps,
  ).then((result) => ({ result, enrichCalls, finalGateCalls }));
}

// ─── § 8 · el fixture produce las cifras del contrato ─────────────────────────

describe('§ 8 · fixture completo de la corrida', () => {
  test('20 únicas, 8 HubSpot, 1 cooldown, 1 país, 5 enrichments, 25 créditos', async () => {
    const { result, enrichCalls } = await runFixture({ applyFinalGates: true });
    const metrics = result.runMetrics;

    assert.equal(metrics.totalUniqueOrganizations, 20, 'unique_results = 20');
    assert.equal(metrics.roundsExecuted, 2);

    const hubspot = result.rounds.reduce((sum, r) => sum + r.duplicateInHubSpot, 0);
    const cooldown = result.rounds.reduce((sum, r) => sum + r.cooldownOrPriorSuggestion, 0);
    const country = result.rounds.reduce((sum, r) => sum + r.countryRejected, 0);
    const ownership = result.rounds.reduce((sum, r) => sum + r.ownershipRejected, 0);

    assert.equal(hubspot, 8);
    assert.equal(cooldown, 1);
    assert.equal(country, 1);
    assert.equal(ownership, 1, 'el rechazo de ownership queda contado como ownership');

    assert.equal(enrichCalls.length, 5, '5 enrichments');
    assert.equal(metrics.enrichmentsExecuted, 5);
    assert.equal(metrics.totalSearchCredits, 20);
    assert.equal(metrics.totalEnrichmentCredits, 5);
    assert.equal(metrics.totalSearchCredits + metrics.totalEnrichmentCredits, 25, '25 créditos');
  });

  test('2 subindustrias confirmadas, 3 aún ambiguas, y las cubetas suman', async () => {
    const { result } = await runFixture({ applyFinalGates: true });
    const metrics = result.runMetrics;

    assert.equal(metrics.sectorConfirmedByEnrichment, 2);
    assert.equal(metrics.sectorStillUnconfirmedAfterEnrichment, 3);
    assert.equal(metrics.sectorRejectedAfterEnrichment, 0);
    assert.equal(metrics.enrichmentFailedCount, 0);

    // § 5 — la suma de las cuatro cubetas coincide con los enrichments
    // clasificados, y aquí —donde toda llamada determinada se cobró— eso es
    // exactamente `enrichments_executed`.
    assert.equal(metrics.enrichmentsClassified, 5);
    assert.equal(metrics.enrichmentsClassified, metrics.enrichmentsExecuted);
  });

  test('2 candidatos persistidos y target_reached = false', async () => {
    const { result } = await runFixture({ applyFinalGates: true });

    assert.equal(result.eligibleCompaniesFound, 2);
    assert.equal(result.persisted.length, 2, 'persisted_candidates = 2');
    assert.equal(result.targetReached, false, 'target_reached para objetivo 5 = false');
    assert.equal(result.resultStatus, 'partial_target_not_reached');

    // Los dos persistidos son los que el enrichment confirmó, y ninguno es el
    // rechazado por ownership.
    const keys = result.persisted.map((entry) => entry.candidateKey).sort();
    assert.deepEqual(keys, ['apollo:enr1', 'apollo:enr2']);
  });

  test('identity_keys_present = 2/2 — los dos persistidos tienen identidad', async () => {
    const { result } = await runFixture({ applyFinalGates: true });

    const withIdentity = result.persisted.filter(
      (entry) => entry.identity.normalizedDomain !== null,
    );
    assert.equal(withIdentity.length, 2);
    assert.equal(withIdentity.length, result.persisted.length);
  });

  test('cero fallos de persistencia y credits_per_persisted_company = 12.5', async () => {
    const { result } = await runFixture({ applyFinalGates: true });

    // El writer recibe los 2 elegibles, escribe 2 y no descarta ninguno.
    const skipped: { reason: string }[] = [];
    const breakdown = buildCandidateSkipBreakdown(skipped);
    const persistedCandidateIds = ['candidate-1', 'candidate-2'];

    const observability = {
      [APOLLO_TWO_ROUND_OBSERVABILITY_KEY]: {
        modality: 'two_round_adaptive',
        target_reached: result.targetReached,
        run_metrics: toRunMetricsMetadata(result.runMetrics),
      },
    };

    const reconciled = reconcileApolloTwoRoundPersistedTruth(
      observability[APOLLO_TWO_ROUND_OBSERVABILITY_KEY],
      {
        eligibleBeforePersistence: result.persisted.length,
        persistedCandidates: persistedCandidateIds.length,
        gapCauses: { ownership_rejected: breakdown.ownership_rejected },
        targetEligibleCompanies: fixtureConfig().targetEligibleCompanies,
      },
    );

    assert.ok(reconciled !== null);
    const metrics = reconciled.observability['run_metrics'] as Record<string, unknown>;

    assert.equal(metrics['persisted_candidates'], 2);
    assert.equal(metrics['credits_per_persisted_company'], 12.5, '25 / 2 = 12.5');
    assert.equal(reconciled.reconciliation.persistence_gap, 0, 'cero fallos de persistencia');
    assert.equal(reconciled.reconciliation.unexplained_gap, 0);
    assert.equal(reconciled.observability['target_reached'], false);
  });

  test('completed_at != null al cerrar el lote', async () => {
    const { result } = await runFixture({ applyFinalGates: true });
    const status = result.persisted.length > 0 ? 'ready_for_review' : 'completed';

    const seal = decideBatchCompletionSeal({
      status,
      currentCompletedAt: null,
      now: new Date('2026-08-05T22:20:08.933Z'),
    });

    assert.equal(seal.shouldWrite, true);
    assert.notEqual(seal.completedAt, null);
  });
});

// ─── § 5 · el gate final es lo que cierra el hueco ────────────────────────────

describe('§ 5 · ownership antes de contar, no después de publicar', () => {
  test('sin gate final, la proyección dice 3 y el writer escribe 2', async () => {
    const { result, finalGateCalls } = await runFixture({ applyFinalGates: false });

    assert.equal(finalGateCalls.length, 0);
    // Éste es EXACTAMENTE el defecto de la corrida live: tres elegibles
    // proyectados, y el gate de ownership del writer descartando al tercero.
    assert.equal(result.eligibleCompaniesFound, 3);
    assert.equal(result.persisted.length, 3);
    assert.equal(result.runMetrics.persistedCandidates, 3);

    // La reconciliación del § 1 lo detecta y lo explica con su causa real.
    const reconciled = reconcileApolloTwoRoundPersistedTruth(
      {
        modality: 'two_round_adaptive',
        target_reached: result.targetReached,
        run_metrics: toRunMetricsMetadata(result.runMetrics),
      },
      {
        eligibleBeforePersistence: 3,
        persistedCandidates: 2,
        gapCauses: { ownership_rejected: 1 },
        targetEligibleCompanies: 5,
      },
    );

    assert.ok(reconciled !== null);
    const metrics = reconciled.observability['run_metrics'] as Record<string, unknown>;
    assert.equal(metrics['persisted_candidates'], 2, 'nunca tres cuando hay dos filas');
    assert.equal(metrics['projected_persistable_candidates'], 3);
    assert.equal(metrics['persistence_gap'], 1);
    assert.equal(metrics['credits_per_persisted_company'], 12.5);
    assert.equal(reconciled.reconciliation.gap_causes.ownership_rejected, 1);
    assert.equal(reconciled.reconciliation.unexplained_gap, 0);
  });

  test('con gate final, proyección y filas coinciden desde el principio', async () => {
    const { result, finalGateCalls } = await runFixture({ applyFinalGates: true });

    // Sólo se evalúa a quien seguía siendo elegible: dos confirmados por
    // enrichment más el que el sector confirmó gratis.
    assert.equal(finalGateCalls.length, 3);
    assert.equal(result.runMetrics.persistedCandidates, 2);
    assert.equal(result.persisted.length, 2);
    assert.ok(result.observedRejectionReasons.includes('ownership_mismatch'));
  });

  test('el gate final no toca a quien ya estaba descartado', async () => {
    const { finalGateCalls } = await runFixture({ applyFinalGates: true });

    // Re-evaluar a un descartado lo contaría dos veces en el desglose de la ronda.
    for (const key of finalGateCalls) {
      assert.ok(
        ['apollo:enr1', 'apollo:enr2', 'apollo:ownership'].includes(key),
        `no debería evaluarse ${key}`,
      );
    }
    assert.equal(new Set(finalGateCalls).size, finalGateCalls.length, 'sin repeticiones');
  });
});
