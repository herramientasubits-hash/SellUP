/**
 * apollo-two-round-finalization-hardening-1.test.ts
 *
 * AGENT1-APOLLO-FINALIZATION-HARDENING-1 · §§ A, B, C, D, E, F, G, H, I, J.
 *
 * Reconstruye OFFLINE la forma de la corrida `bdc51c49-82b8-4b8f-8ae4-16bc95e9a392`
 * (wizard_run `643dce60bb4b33951741df51be44d7f9`, runtime `21835e48…`): 17 únicas,
 * target 5, 3 persistidas, 1 enrichment de sector, y — el hallazgo real de esta
 * corrida contra Producción — `final_state_consistency.unclassified_unique_
 * results = 8` y `candidates_persisted = false` con `candidates_persisted_count
 * = 3` en el MISMO documento.
 *
 * Sin red, sin Apollo, sin Supabase, sin créditos reales.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type CheapAssessment,
  type EnrichmentResult,
  type RawDiscoveredOrganization,
  type ApolloTwoRoundRunResult,
} from '../orchestrator';
import {
  evaluateApolloEnrichmentNeed,
  selectCandidatesForEnrichment,
} from '../enrichment-ranking';
import {
  evaluateApolloTwoRoundFinalStateConsistency,
} from '../run-final-state-consistency';
import {
  evaluateApolloCandidateFinalDispositions,
  countUnclassifiedFinalDispositions,
} from '../candidate-final-disposition';
import { reconcileApolloTwoRoundPersistedTruth } from '../../apollo-persisted-candidate-truth';
import { toRunMetricsMetadata } from '../observability';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  simulatedEffectiveRequestBuilder,
  org,
  passingAssessment,
  ambiguousAssessment,
} from './fixtures';

// ─── § B/C — evaluateApolloEnrichmentNeed, en aislamiento ─────────────────────

describe('§ B · un sector confirmado GRATIS ya no descalifica por sí solo', () => {
  test('sector confirmado + employee_count ausente ⇒ SIGUE compitiendo', () => {
    const need = evaluateApolloEnrichmentNeed({
      candidateKey: 'apollo:la-canasta',
      roundNumber: 1,
      providerRank: 1,
      countryCompatible: true,
      domainConfident: true,
      ownershipConfident: true,
      sectorKeywordMatchCount: 2,
      novel: true,
      hasCompanySizeSignal: false,
      hasLocationSignal: true,
      hasLinkedInUrl: true,
      freeOfContradictoryEvidence: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      knownDuplicate: false,
      cooldownActive: false,
    });

    assert.equal(need.eligibleForEnrichment, true);
    assert.deepEqual(need.missingRequiredEvidence, ['employee_count']);
    assert.deepEqual(need.providerResolvableEvidence, ['employee_count']);
    assert.deepEqual(need.enrichmentReasons, ['resolves_missing_employee_count']);
    assert.equal(need.expectedTargetValue, 'contributes_to_target');
    assert.equal(need.disqualifiedReason, null);
  });

  test('sector confirmado + TODO presente ⇒ nada que comprar', () => {
    const need = evaluateApolloEnrichmentNeed({
      candidateKey: 'apollo:megatiendas-complete',
      roundNumber: 1,
      providerRank: 1,
      countryCompatible: true,
      domainConfident: true,
      ownershipConfident: true,
      sectorKeywordMatchCount: 2,
      novel: true,
      hasCompanySizeSignal: true,
      hasLocationSignal: true,
      hasLinkedInUrl: true,
      freeOfContradictoryEvidence: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      knownDuplicate: false,
      cooldownActive: false,
    });

    assert.equal(need.eligibleForEnrichment, false);
    assert.equal(need.disqualifiedReason, 'sector_evidence_already_confirmed');
    assert.equal(need.expectedTargetValue, 'no_target_value');
  });

  test('sector faltante ⇒ compite (comportamiento preexistente, sin regresión)', () => {
    const need = evaluateApolloEnrichmentNeed({
      candidateKey: 'apollo:megatiendas',
      roundNumber: 1,
      providerRank: 1,
      countryCompatible: true,
      domainConfident: true,
      ownershipConfident: true,
      sectorKeywordMatchCount: 0,
      novel: true,
      hasCompanySizeSignal: false,
      hasLocationSignal: false,
      hasLinkedInUrl: false,
      freeOfContradictoryEvidence: true,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      knownDuplicate: false,
      cooldownActive: false,
    });

    assert.equal(need.eligibleForEnrichment, true);
    assert.ok(need.enrichmentReasons.includes('resolves_missing_sector_evidence'));
  });

  test('descalificadores categóricos siguen ganando sobre el campo faltante', () => {
    const need = evaluateApolloEnrichmentNeed({
      candidateKey: 'apollo:duplicate',
      roundNumber: 1,
      providerRank: 1,
      countryCompatible: true,
      domainConfident: true,
      ownershipConfident: true,
      sectorKeywordMatchCount: 0,
      novel: false,
      hasCompanySizeSignal: false,
      hasLocationSignal: false,
      hasLinkedInUrl: false,
      freeOfContradictoryEvidence: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      knownDuplicate: true,
      cooldownActive: false,
    });

    assert.equal(need.eligibleForEnrichment, false);
    assert.equal(need.disqualifiedReason, 'known_duplicate');
  });
});

describe('§ C · el ranking de enrichment sigue respetando el cap global', () => {
  test('con 5 contendientes y cap 2, sólo 2 compiten; el resto cae en enrichment_cap_reached', () => {
    const candidates = Array.from({ length: 5 }, (_v, i) => ({
      candidateKey: `apollo:c${i}`,
      roundNumber: 1,
      providerRank: i + 1,
      countryCompatible: true,
      domainConfident: true,
      ownershipConfident: true,
      sectorKeywordMatchCount: 0,
      novel: true,
      hasCompanySizeSignal: false,
      hasLocationSignal: false,
      hasLinkedInUrl: false,
      freeOfContradictoryEvidence: true,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment' as const,
      knownDuplicate: false,
      cooldownActive: false,
    }));

    const result = selectCandidatesForEnrichment({
      candidates,
      remainingEnrichmentBudget: 2,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.equal(result.selected.length, 2, 'nunca más de 5 enrichments/corrida — aquí, más de 2');
    assert.equal(
      result.skipped.filter((s) => s.skippedReason === 'enrichment_cap_reached').length,
      3,
    );
    for (const selection of result.selected) {
      assert.ok(selection.enrichmentReasons.length > 0, 'toda selección declara POR QUÉ');
    }
  });
});

// ─── § A / § D — la corrida completa: 17 únicas, target 5 ─────────────────────

type Role =
  | 'megatiendas'
  | 'la_canasta'
  | 'surtifamiliar'
  | 'euro'
  | 'la_vaquita'
  | 'hubspot'
  | 'cooldown'
  | 'country'
  | 'pending';

const ROLES: readonly { id: string; role: Role }[] = [
  { id: 'megatiendas', role: 'megatiendas' },
  { id: 'la_canasta', role: 'la_canasta' },
  { id: 'surtifamiliar', role: 'surtifamiliar' },
  { id: 'euro', role: 'euro' },
  { id: 'la_vaquita', role: 'la_vaquita' },
  { id: 'hs1', role: 'hubspot' },
  { id: 'hs2', role: 'hubspot' },
  { id: 'cool1', role: 'cooldown' },
  { id: 'ctry1', role: 'country' },
  { id: 'p1', role: 'pending' },
  { id: 'p2', role: 'pending' },
  { id: 'p3', role: 'pending' },
  { id: 'p4', role: 'pending' },
  { id: 'p5', role: 'pending' },
  { id: 'p6', role: 'pending' },
  { id: 'p7', role: 'pending' },
  { id: 'p8', role: 'pending' },
];

const ROLE_BY_ID = new Map(ROLES.map((entry) => [entry.id, entry.role] as const));
/** Ownership final-gate rechaza a estas dos — con causa real, nunca null (§ F). */
const FINAL_GATE_REJECTED_KEYS = new Set(['apollo:euro', 'apollo:la_vaquita']);

function organizations(): RawDiscoveredOrganization[] {
  return ROLES.map((entry, index) => org(entry.id, { providerRank: index + 1 }));
}

/** Señales fuertes: rankean por encima de los ambiguos débiles del cap. */
const STRONG_SIGNALS = {
  countryCompatible: true,
  domainConfident: true,
  ownershipConfident: true,
  novel: true,
  freeOfContradictoryEvidence: true,
  knownDuplicate: false,
  cooldownActive: false,
};
/** Señales débiles: pasan los gates baratos y compiten peor por el enrichment. */
const WEAK_SIGNALS = {
  countryCompatible: true,
  domainConfident: true,
  ownershipConfident: false,
  novel: false,
  freeOfContradictoryEvidence: true,
  knownDuplicate: false,
  cooldownActive: false,
};

function assessmentFor(id: string): CheapAssessment {
  const role = ROLE_BY_ID.get(id);
  switch (role) {
    case 'megatiendas':
      return ambiguousAssessment({
        signals: {
          ...STRONG_SIGNALS,
          sectorKeywordMatchCount: 3,
          hasCompanySizeSignal: false,
          hasLocationSignal: true,
          hasLinkedInUrl: false,
        },
      });
    case 'la_canasta':
    case 'surtifamiliar':
      // § I — confirmado GRATIS por nombre comercial, como en la corrida real;
      // `employee_count` ausente, LinkedIn presente.
      return passingAssessment({
        signals: {
          ...STRONG_SIGNALS,
          sectorKeywordMatchCount: 2,
          hasCompanySizeSignal: false,
          hasLocationSignal: true,
          hasLinkedInUrl: true,
        },
      });
    case 'euro':
    case 'la_vaquita':
      // Confirmado GRATIS y COMPLETO: nada que un enrichment resuelva. Su único
      // problema es ownership, y eso sólo lo sabe el gate final.
      return passingAssessment({
        signals: {
          ...STRONG_SIGNALS,
          sectorKeywordMatchCount: 2,
          hasCompanySizeSignal: true,
          hasLocationSignal: true,
          hasLinkedInUrl: true,
        },
      });
    case 'hubspot':
      return {
        rejection: 'duplicate_in_hubspot',
        sectorEvidenceState: 'sector_evidence_confirmed',
        noPriorSuggestion: true,
        signals: { ...STRONG_SIGNALS, sectorKeywordMatchCount: 1, hasCompanySizeSignal: false, hasLocationSignal: false, hasLinkedInUrl: false, knownDuplicate: true, cooldownActive: false },
      };
    case 'cooldown':
      return {
        rejection: 'cooldown_or_prior_suggestion',
        sectorEvidenceState: 'sector_evidence_confirmed',
        noPriorSuggestion: false,
        signals: { ...STRONG_SIGNALS, sectorKeywordMatchCount: 1, hasCompanySizeSignal: false, hasLocationSignal: false, hasLinkedInUrl: false, knownDuplicate: false, cooldownActive: true },
      };
    case 'country':
      return {
        rejection: 'country_incompatible',
        sectorEvidenceState: 'sector_evidence_confirmed',
        noPriorSuggestion: true,
        signals: { ...STRONG_SIGNALS, countryCompatible: false, sectorKeywordMatchCount: 1, hasCompanySizeSignal: false, hasLocationSignal: false, hasLinkedInUrl: false, knownDuplicate: false, cooldownActive: false },
      };
    case 'pending':
    default:
      return ambiguousAssessment({
        signals: {
          ...WEAK_SIGNALS,
          sectorKeywordMatchCount: 0,
          hasCompanySizeSignal: false,
          hasLocationSignal: false,
          hasLinkedInUrl: false,
        },
      });
  }
}

function fixtureConfig() {
  return testConfig({
    targetEligibleCompanies: 5,
    maxRounds: 1,
    maxResultsPerRound: 20,
    maxRawResultsPerRun: 20,
    maxEnrichmentsPerRun: 3,
  });
}

function buildDeps(): { deps: ApolloTwoRoundDeps; enrichCalls: string[]; finalGateCalls: string[] } {
  const enrichCalls: string[] = [];
  const finalGateCalls: string[] = [];

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async () => ({
      organizations: organizations(),
      providerRequestCount: 1,
      internalRecordedCredits: ROLES.length,
      providerTotalPages: 1,
    }),
    assessCandidate: ({ organization }) =>
      assessmentFor(organization.providerOrganizationId ?? ''),
    enrichCandidate: async ({ candidateKey }): Promise<EnrichmentResult> => {
      enrichCalls.push(candidateKey);
      // STABLE-TARGET-WRITER-PARITY § 5 — `organization_enrichment` devuelve el
      // perfil COMPLETO de la organización, así que un enrichment que se cobra
      // resuelve a la vez el sector, `employee_count` y el LinkedIn. Antes de
      // ese § el orquestador no se enteraba: las señales gratuitas venían de la
      // búsqueda y nadie las volvía a tocar, de modo que un campo comprado
      // seguía figurando como ausente. Ahora el desenlace viaja con el
      // resultado, leído de la MISMA captura que persistirá el writer.
      return {
        executed: true,
        internalRecordedCredits: 1,
        sectorEvidenceState: 'sector_evidence_confirmed',
        providerCompanyFields: {
          employeeCountStatus: 'confirmed',
          linkedinStatus: 'confirmed',
        },
      };
    },
    applyFinalGates: ({ candidateKey }) => {
      finalGateCalls.push(candidateKey);
      return {
        rejection: FINAL_GATE_REJECTED_KEYS.has(candidateKey)
          ? ('ownership_mismatch' as const)
          : null,
      };
    },
  };

  return { deps, enrichCalls, finalGateCalls };
}

async function runFixture(): Promise<{
  result: ApolloTwoRoundRunResult;
  enrichCalls: string[];
  finalGateCalls: string[];
}> {
  const { deps, enrichCalls, finalGateCalls } = buildDeps();
  const result = await runApolloTwoRoundDiscovery(
    { config: fixtureConfig(), queryContext: testQueryContext(), correlation: testCorrelation() },
    deps,
  );
  return { result, enrichCalls, finalGateCalls };
}

describe('§ I · fixture de 17 resultados de la corrida bdc51c49', () => {
  test('17 únicas, 5 de objetivo, 3 estables — Euro y La Vaquita caen por ownership', async () => {
    const { result } = await runFixture();

    assert.equal(result.runMetrics.totalUniqueOrganizations, 17);
    assert.equal(result.targetEligibleCompanies, 5);
    assert.equal(result.eligibleCompaniesFound, 3, 'Megatiendas + La Canasta + Surtifamiliar');
    assert.equal(result.persisted.length, 3);
    assert.equal(result.targetReached, false);

    const keys = result.persisted.map((p) => p.candidateKey).sort();
    assert.deepEqual(keys, ['apollo:la_canasta', 'apollo:megatiendas', 'apollo:surtifamiliar']);
  });

  test('§ A — el conteo PROVISIONAL nunca fue el que decidió: Euro/La Vaquita se resolvieron ANTES del cap de enrichment', async () => {
    const { result, enrichCalls } = await runFixture();

    // Los 3 que necesitaban algo resoluble SÍ se enriquecieron.
    assert.deepEqual(
      [...enrichCalls].sort(),
      ['apollo:la_canasta', 'apollo:megatiendas', 'apollo:surtifamiliar'],
    );
    // § D — el hueco contra el objetivo es real y queda declarado, no escondido
    // detrás de una cuenta que "ya llegaba".
    assert.equal(result.runMetrics.stableFinalizableCandidateCount, 3);
    assert.equal(result.runMetrics.targetGap, 2, 'target(5) - estable(3) = 2');
  });

  test('§ B/C — La Canasta y Surtifamiliar compitieron por el campo que faltaba, no por el sector', async () => {
    const { result } = await runFixture();

    const laCanasta = result.enrichmentSelections.find((s) => s.candidateKey === 'apollo:la_canasta');
    const surtifamiliar = result.enrichmentSelections.find(
      (s) => s.candidateKey === 'apollo:surtifamiliar',
    );
    assert.ok(laCanasta, 'antes de este hito, sector_evidence_already_confirmed la habría excluido');
    assert.ok(surtifamiliar);
    assert.equal(laCanasta?.selectionReason, 'resolves_missing_required_field_highest_free_signal_rank');
    assert.deepEqual(laCanasta?.missingBefore, ['employee_count']);
    assert.deepEqual(laCanasta?.enrichmentReasons, ['resolves_missing_employee_count']);
  });

  test('§ J — los caps absolutos se respetan: <=3 enrichments (cupo del fixture) y <=25 créditos equivalentes', async () => {
    const { result } = await runFixture();
    assert.ok(result.runMetrics.enrichmentsExecuted <= 3);
    assert.ok(result.runMetrics.totalSearchCredits + result.runMetrics.totalEnrichmentCredits <= 25);
  });

  test('§ E — TODOS los 17 resultados únicos tienen una disposición final, y ninguno queda sin clasificar', async () => {
    const { result } = await runFixture();
    const dispositions = evaluateApolloCandidateFinalDispositions(result);

    assert.equal(dispositions.length, 17);
    assert.equal(countUnclassifiedFinalDispositions(dispositions), 0, 'unclassified_unique_results = 0');

    const byKey = new Map(dispositions.map((d) => [d.candidateKey, d]));
    assert.equal(byKey.get('apollo:megatiendas')?.finalDisposition, 'provisionally_persisted_pending_writer_final');
    assert.equal(byKey.get('apollo:la_canasta')?.finalDisposition, 'provisionally_persisted_pending_writer_final');
    assert.equal(byKey.get('apollo:surtifamiliar')?.finalDisposition, 'provisionally_persisted_pending_writer_final');
    assert.equal(byKey.get('apollo:euro')?.finalDisposition, 'ownership_rejected_final');
    assert.equal(byKey.get('apollo:la_vaquita')?.finalDisposition, 'ownership_rejected_final');
    assert.equal(byKey.get('apollo:hs1')?.finalDisposition, 'hubspot_duplicate_final');
    assert.equal(byKey.get('apollo:hs2')?.finalDisposition, 'hubspot_duplicate_final');
    assert.equal(byKey.get('apollo:cool1')?.finalDisposition, 'cooldown_final');
    assert.equal(byKey.get('apollo:ctry1')?.finalDisposition, 'country_rejected_final');

    // § E — los 8 pendientes: exactamente los que costaban 8 sin_clasificar en
    // la corrida real ahora tienen nombre — enrichment_budget_exhausted_final,
    // porque el cap (3) se lo llevaron Megatiendas/La Canasta/Surtifamiliar.
    const pendingDispositions = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(
      (id) => byKey.get(`apollo:${id}`)?.finalDisposition,
    );
    assert.ok(
      pendingDispositions.every((d) => d === 'enrichment_budget_exhausted_final'),
      `todos los 8 pendientes deben ser enrichment_budget_exhausted_final, fueron: ${pendingDispositions.join(',')}`,
    );
  });

  test('§ F — La Vaquita / Euro: rechazadas con una CAUSA REAL, nunca null', async () => {
    const { result } = await runFixture();
    const dispositions = evaluateApolloCandidateFinalDispositions(result);
    const byKey = new Map(dispositions.map((d) => [d.candidateKey, d]));

    const euro = byKey.get('apollo:euro');
    const laVaquita = byKey.get('apollo:la_vaquita');
    assert.equal(euro?.finalReason, 'ownership_mismatch');
    assert.equal(laVaquita?.finalReason, 'ownership_mismatch');

    // Invariante general (§ F): TODA disposición de rechazo lleva una causa.
    const REJECTION_DISPOSITIONS = new Set([
      'hubspot_duplicate_final',
      'sellup_duplicate_final',
      'cooldown_final',
      'country_rejected_final',
      'ownership_rejected_final',
      'sector_subindustry_rejected_final',
    ]);
    for (const entry of dispositions) {
      if (REJECTION_DISPOSITIONS.has(entry.finalDisposition)) {
        assert.notEqual(
          entry.finalReason,
          null,
          `${entry.candidateKey} está en ${entry.finalDisposition} sin motivo`,
        );
      }
    }
  });

  test('§ E (aggregate) — final_state_consistency cierra en 0 sin_clasificar', async () => {
    const { result } = await runFixture();
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: result.rounds,
      candidates: result.evaluatedCandidates.map((c) => ({
        candidate_key: c.candidateKey,
        eligible: c.eligible,
        finally_rejected_or_duplicated: c.finallyRejectedOrDuplicated,
      })),
      runMetrics: {
        totalUniqueOrganizations: result.runMetrics.totalUniqueOrganizations,
        totalEligibleCompanies: result.runMetrics.totalEligibleCompanies,
        persistedCandidates: result.runMetrics.persistedCandidates,
      },
      targetEligibleCompanies: result.targetEligibleCompanies,
      targetReached: result.targetReached,
    });

    assert.equal(
      consistency.unclassifiedUniqueResults,
      0,
      'antes de § E esto era 8 en la corrida bdc51c49; ahora cierra en 0',
    );
    assert.equal(consistency.ok, true);
  });

  test('§ H — candidates_persisted (booleano) coincide con candidates_persisted_count', async () => {
    const { result } = await runFixture();

    const preWriterObservability = {
      modality: 'two_round_adaptive',
      target_reached: result.targetReached,
      run_metrics: toRunMetricsMetadata(result.runMetrics),
      // § H — el defecto real: este campo llega en `false` porque se calculó
      // ANTES de que el writer corriera.
      candidates_persisted: false,
    };

    const reconciled = reconcileApolloTwoRoundPersistedTruth(preWriterObservability, {
      eligibleBeforePersistence: 3,
      persistedCandidates: 3,
      completeValidCandidates: 1,
      gapCauses: {},
      targetEligibleCompanies: 5,
    });

    assert.ok(reconciled !== null);
    assert.equal(
      reconciled.observability['candidates_persisted'],
      true,
      'candidates_persisted_count = 3 ⇒ candidates_persisted = true, nunca false',
    );
    assert.equal(
      (reconciled.observability['run_metrics'] as Record<string, unknown>)[
        'persisted_candidates'
      ],
      3,
    );
  });

  test('§ H — con 0 filas reales, candidates_persisted es false, no true por accidente', async () => {
    const observability = {
      modality: 'two_round_adaptive',
      target_reached: false,
      run_metrics: { total_search_credits: 20, total_enrichment_credits: 0 },
      candidates_persisted: true, // deliberadamente incoherente: el fix no debe confiar en el input
    };

    const reconciled = reconcileApolloTwoRoundPersistedTruth(observability, {
      eligibleBeforePersistence: 0,
      persistedCandidates: 0,
      completeValidCandidates: 0,
      gapCauses: {},
      targetEligibleCompanies: 5,
    });

    assert.ok(reconciled !== null);
    assert.equal(reconciled.observability['candidates_persisted'], false);
  });
});
