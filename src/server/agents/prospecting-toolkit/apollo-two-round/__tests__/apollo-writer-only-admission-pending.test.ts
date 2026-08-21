/**
 * apollo-writer-only-admission-pending.test.ts
 *
 * AGENT1-APOLLO-FINALIZATION-HARDENING-1 · WRITER-ONLY-ADMISSION-PENDING
 * §§ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 y 11.
 *
 * El defecto que esta suite congela, y que sobrevivió a STABLE-TARGET-WRITER-PARITY:
 *
 *   `active_duplicate_guard` y `novelty_index` son comprobaciones de ADMISIÓN que
 *   sólo el writer resuelve. Pueden DESCARTAR, después del evaluador pre-writer, a
 *   un candidato que `evaluateCandidateTargetEligibility` consideraba elegible. Su
 *   ausencia se estaba leyendo como un PASE, así que la cuenta que detiene el gasto
 *   —`stableFinalizableCandidateCount`— todavía podía sobreestimar el objetivo y
 *   emitir `target_already_reached` sobre candidatos que el writer iba a rechazar.
 *
 * Y la auditoría del § 1 encontró que no eran dos: el cooldown de identidad, la
 * dedupe intra-lote y el cupo del lote hacen exactamente lo mismo y nadie los había
 * declarado.
 *
 * Cada `describe` de aquí abajo FALLA contra el código anterior a este addendum.
 *
 * Sin red, sin Apollo, sin Supabase, sin créditos, sin reloj.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundCandidateTargetConditions,
  type ApolloTwoRoundDeps,
  type ApolloTwoRoundRunResult,
  type EnrichmentResult,
} from '../orchestrator';
import { toRunMetricsMetadata } from '../observability';
import { evaluateCandidateTargetEligibility } from '../../candidate-completeness-contract';
import {
  buildApolloPersistenceReconciliation,
  reconcileApolloTwoRoundPersistedTruth,
} from '../../apollo-persisted-candidate-truth';
import {
  APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS,
  APOLLO_UNRESOLVED_PRE_WRITER_ADMISSION_CHECKS,
  APOLLO_WRITER_ONLY_ADMISSION_CHECKS,
  APOLLO_WRITER_ONLY_ADMISSION_CHECK_REGISTRY,
} from '../../apollo-pre-writer-target-conditions';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  simulatedEffectiveRequestBuilder,
  org,
  passingAssessment,
} from './fixtures';

/** Condiciones del contrato, todas satisfechas. Base de las variaciones. */
function allSatisfied() {
  return {
    persistenceSuccess: true,
    subindustryMatch: 'confirmed' as const,
    employeeCountStatus: 'confirmed' as const,
    linkedinStatus: 'confirmed' as const,
    duplicateStatus: 'no_match',
    ownershipGate: 'pass' as const,
    qualityGate: 'pass' as const,
  };
}

// ─── § 1 · la auditoría es un dato, no una suposición ─────────────────────────

describe('§ 1 · las admisiones writer-only están auditadas y declaradas', () => {
  test('la familia writer-only son CINCO, cada una con su causa y su decisor', () => {
    assert.deepEqual([...APOLLO_WRITER_ONLY_ADMISSION_CHECKS], [
      'active_duplicate_guard',
      'novelty_index',
      'recent_identity_cooldown',
      'intra_batch_identity_dedupe',
      'target_cap',
    ]);

    // Tres exigen una lectura de base y dos el lote completo ya rankeado. Ninguna
    // es una propiedad del candidato: por eso ninguna cabe en las siete condiciones
    // del contrato sin forzar el significado de una de ellas.
    assert.deepEqual(
      APOLLO_WRITER_ONLY_ADMISSION_CHECK_REGISTRY.map((entry) => entry.cause),
      [
        'requires_db_prefetch',
        'requires_db_prefetch',
        'requires_db_prefetch',
        'requires_full_batch_context',
        'requires_full_batch_context',
      ],
    );
    for (const entry of APOLLO_WRITER_ONLY_ADMISSION_CHECK_REGISTRY) {
      assert.ok(
        entry.writerDecidedBy.length > 0,
        `${entry.check} debe declarar QUIÉN lo decide en el writer`,
      );
    }
  });

  test('la segunda familia es pura pero NO está cableada, y se nombra aparte', () => {
    // No son writer-only: son deterministas y no tocan la base. Llamarlas
    // «writer-only» sería falso, y darlas por pasadas sería el defecto de siempre.
    for (const entry of APOLLO_UNRESOLVED_PRE_WRITER_ADMISSION_CHECKS) {
      assert.equal(entry.cause, 'pure_but_not_wired_pre_writer');
    }
    assert.equal(APOLLO_UNRESOLVED_PRE_WRITER_ADMISSION_CHECKS.length, 8);
    // Y no se solapa con la primera: son conjuntos disjuntos.
    for (const entry of APOLLO_UNRESOLVED_PRE_WRITER_ADMISSION_CHECKS) {
      assert.ok(!APOLLO_WRITER_ONLY_ADMISSION_CHECKS.includes(entry.check));
    }
  });

  test('lo que producción declara pendiente es la UNIÓN de las dos familias', () => {
    assert.equal(APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS.length, 13);
    assert.equal(
      new Set(APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS).size,
      13,
      'sin repetidos: cada motivo se cuenta una sola vez',
    );
    for (const check of APOLLO_WRITER_ONLY_ADMISSION_CHECKS) {
      assert.ok(APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS.includes(check));
    }
  });
});

// ─── § 2 · PENDING nunca es PASS ──────────────────────────────────────────────

describe('§ 2 · una admisión writer-only sin resolver NO cuenta', () => {
  test('todo el contrato satisfecho + una admisión pendiente ⇒ no elegible', () => {
    const result = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      unresolvedWriterOnlyAdmissionChecks: ['active_duplicate_guard'],
    });

    // Ésta es LA aserción del addendum: sin ella, el candidato contaba.
    assert.equal(result.countsTowardTargetIfPersisted, false, 'no saber NO es cumplir');
    assert.equal(result.eligibleForTarget, false);
    assert.equal(result.completeValidIfPersisted, false);

    // Y el motivo es legible: no se disfraza de condición fallida del contrato.
    assert.deepEqual(result.writerOnlyPendingChecks, ['active_duplicate_guard']);
    assert.deepEqual(result.pendingConditions, ['active_duplicate_guard']);
    assert.deepEqual(result.strictlyFailedConditions, []);
    // Las siete condiciones del contrato siguen satisfechas: la admisión es otra cosa.
    for (const state of Object.values(result.conditionStates)) {
      assert.equal(state, 'satisfied');
    }
  });

  test('el contrato literal se sostiene: `pendingConditions.length > 0` ⇒ no elegible', () => {
    for (const check of APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS) {
      const result = evaluateCandidateTargetEligibility({
        ...allSatisfied(),
        unresolvedWriterOnlyAdmissionChecks: [check],
      });
      assert.ok(result.pendingConditions.length > 0, check);
      assert.equal(result.countsTowardTargetIfPersisted, false, check);
    }
  });

  test('la lista vacía y la ausencia son lo mismo: el writer las resuelve todas', () => {
    const absent = evaluateCandidateTargetEligibility(allSatisfied());
    const empty = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      unresolvedWriterOnlyAdmissionChecks: [],
    });
    assert.equal(absent.countsTowardTargetIfPersisted, true);
    assert.equal(empty.countsTowardTargetIfPersisted, true);
    assert.deepEqual(absent.writerOnlyPendingChecks, []);
    assert.deepEqual(empty.writerOnlyPendingChecks, []);
  });

  test('un mismo check declarado dos veces es UN motivo, no dos', () => {
    const result = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      unresolvedWriterOnlyAdmissionChecks: ['novelty_index', 'novelty_index'],
    });
    assert.deepEqual(result.writerOnlyPendingChecks, ['novelty_index']);
  });

  test('§ 10 — la semántica POST-writer no cambia: sin declaración, nada pendiente', () => {
    // El writer no pasa admisiones pendientes porque las resuelve todas. Su
    // veredicto tiene que ser byte a byte el de antes de este addendum.
    const persistenceFailed = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      persistenceSuccess: false,
    });
    assert.equal(persistenceFailed.countsTowardTargetIfPersisted, true);
    assert.equal(persistenceFailed.eligibleForTarget, false);
    assert.deepEqual(persistenceFailed.strictlyFailedConditions, ['persistence_success']);
    assert.deepEqual(persistenceFailed.writerOnlyPendingChecks, []);
  });
});

// ─── Fixture de corrida ───────────────────────────────────────────────────────

/**
 * Cinco candidatas SINTÉTICAS, todas completas según el contrato. La única
 * variable del escenario es cuáles llevan admisiones writer-only sin resolver.
 */
const CANDIDATE_IDS = ['s1', 's2', 's3', 's4', 's5'] as const;

type Scenario = {
  /**
   * Claves de candidato cuyas admisiones writer-only quedan SIN resolver. El
   * resto las declara resueltas, como haría un adaptador que sí pudiera verlas.
   */
  pendingFor: readonly string[];
  pendingChecks?: readonly string[];
};

type RunProbe = {
  result: ApolloTwoRoundRunResult;
  enrichCalls: string[];
  searchCalls: number;
  /** § 9 — cualquier I/O que el orquestador intentara aparecería aquí. */
  targetConditionReads: number;
};

async function run(scenario: Scenario): Promise<RunProbe> {
  const enrichCalls: string[] = [];
  let searchCalls = 0;
  let targetConditionReads = 0;
  const pendingKeys = new Set(scenario.pendingFor.map((id) => `apollo:${id}`));
  const checks = scenario.pendingChecks ?? APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS;

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber }) => {
      searchCalls++;
      return {
        organizations:
          roundNumber === 1
            ? CANDIDATE_IDS.map((id, index) => org(id, { providerRank: index + 1 }))
            : [],
        providerRequestCount: 1,
        internalRecordedCredits: CANDIDATE_IDS.length,
        providerTotalPages: 1,
      };
    },
    assessCandidate: () => passingAssessment(),
    enrichCandidate: async ({ candidateKey }): Promise<EnrichmentResult> => {
      enrichCalls.push(candidateKey);
      return {
        executed: true,
        internalRecordedCredits: 1,
        sectorEvidenceState: 'sector_evidence_confirmed',
        providerCompanyFields: { employeeCountStatus: 'confirmed', linkedinStatus: 'confirmed' },
      };
    },
    applyFinalGates: () => ({ rejection: null }),
    readCandidateTargetConditions: ({
      candidateKey,
    }): ApolloTwoRoundCandidateTargetConditions => {
      targetConditionReads++;
      return {
        subindustryMatch: 'confirmed',
        employeeCountStatus: 'confirmed',
        linkedinStatus: 'confirmed',
        duplicateStatus: 'no_match',
        ownershipGate: 'pass',
        qualityGate: 'pass',
        ...(pendingKeys.has(candidateKey)
          ? { unresolvedWriterOnlyAdmissionChecks: checks }
          : {}),
      };
    },
  };

  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig({
        targetEligibleCompanies: 5,
        maxRounds: 2,
        maxResultsPerRound: 5,
        maxRawResultsPerRun: 10,
        maxEnrichmentsPerRun: 5,
      }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
      resume: null,
    },
    deps,
  );

  return { result, enrichCalls, searchCalls, targetConditionReads };
}

/** Los topes ABSOLUTOS del hito. Se comprueban en cada corrida de esta suite. */
function assertCapsHold(probe: RunProbe): void {
  assert.ok(probe.searchCalls <= 2, `búsquedas = ${probe.searchCalls}`);
  assert.ok(probe.enrichCalls.length <= 5, `enrichments = ${probe.enrichCalls.length}`);
  const credits =
    probe.result.runMetrics.totalSearchCredits + probe.result.runMetrics.totalEnrichmentCredits;
  assert.ok(credits <= 25, `créditos = ${credits}`);
}

// ─── § 5 · cinco pendientes no pueden detener la corrida ──────────────────────

describe('§ 5 · target 5 con las cinco en admisión pendiente', () => {
  test('estable = 0, objetivo NO alcanzado, y ningún `target_already_reached`', async () => {
    const probe = await run({ pendingFor: [...CANDIDATE_IDS] });

    // Las cinco cumplen las SIETE condiciones del contrato…
    assert.equal(probe.result.eligibleCompaniesFound, 5);
    assert.equal(probe.result.projectedFinalizableCandidateCount, 5);
    // …y ninguna es estable, porque sus admisiones no están resueltas.
    assert.equal(probe.result.stableFinalizableCandidateCount, 0);
    assert.equal(probe.result.writerOnlyPendingCount, 5);
    assert.equal(probe.result.projectedTargetGap, 5);
    assert.equal(probe.result.targetReached, false);
    assert.equal(probe.result.resultStatus, 'partial_target_not_reached');

    // § 4 — la parada temprana queda desactivada de hecho. Nadie recibe
    // `target_already_reached`: ése era el desenlace que dejaba sin enrichment a
    // candidatas que el writer iba a rechazar.
    assert.deepEqual(
      probe.result.enrichmentSkips.filter((skip) => skip.skippedReason === 'target_already_reached'),
      [],
    );

    // Y siguen compitiendo por su enrichment «según necesidad» (§ 5): el sector ya
    // está confirmado gratis, así que ninguna necesita comprar nada.
    assert.deepEqual(probe.enrichCalls, []);
    assertCapsHold(probe);
  });
});

// ─── § 6 · caso mixto ─────────────────────────────────────────────────────────

describe('§ 6 · tres resueltas y dos pendientes', () => {
  test('estable = 3, hueco = 2, objetivo NO alcanzado', async () => {
    const probe = await run({ pendingFor: ['s4', 's5'] });

    assert.equal(probe.result.stableFinalizableCandidateCount, 3, 'sólo las resueltas');
    assert.equal(probe.result.projectedFinalizableCandidateCount, 5);
    assert.equal(probe.result.writerOnlyPendingCount, 2);
    assert.equal(probe.result.projectedTargetGap, 2);
    assert.equal(probe.result.targetReached, false);
    assertCapsHold(probe);
  });

  test('la proyección NO puede detener el gasto ni con el objetivo cubierto', async () => {
    // `projected === target === 5` y `stable === 3`. Si la proyección decidiera,
    // esta corrida se declararía cerrada: es exactamente el defecto del addendum.
    const probe = await run({ pendingFor: ['s4', 's5'] });
    assert.equal(probe.result.projectedFinalizableCandidateCount, 5);
    assert.equal(probe.result.targetReached, false, 'la proyección no cierra la corrida');
    assert.deepEqual(
      probe.result.enrichmentSkips.filter((skip) => skip.skippedReason === 'target_already_reached'),
      [],
    );
  });

  test('con las cinco resueltas el objetivo SÍ se alcanza antes del writer', async () => {
    // El control del caso mixto: sin admisiones pendientes la parada funciona
    // igual que antes de este addendum. Nada se rompió; sólo dejó de mentir.
    const probe = await run({ pendingFor: [] });
    assert.equal(probe.result.stableFinalizableCandidateCount, 5);
    assert.equal(probe.result.projectedFinalizableCandidateCount, 5);
    assert.equal(probe.result.writerOnlyPendingCount, 0);
    assert.equal(probe.result.projectedTargetGap, 0);
    assert.equal(probe.result.targetReached, true);
    assert.equal(probe.searchCalls, 1, 'la ronda 2 no se emite: el objetivo ya está');
    assertCapsHold(probe);
  });
});

// ─── § 8 · observabilidad separada ────────────────────────────────────────────

describe('§ 8 · las cifras se emiten SEPARADAS y con su propio nombre', () => {
  test('projected, stable, pending y sus motivos viajan cada uno por su clave', async () => {
    const probe = await run({ pendingFor: ['s4', 's5'], pendingChecks: ['novelty_index'] });
    const metadata = toRunMetricsMetadata(probe.result.runMetrics);

    assert.equal(metadata['projected_finalizable_count'], 5);
    assert.equal(metadata['stable_finalizable_count'], 3);
    assert.equal(metadata['writer_only_pending_count'], 2);
    assert.deepEqual(metadata['writer_only_pending_reasons'], ['novelty_index']);

    // La cifra que decide el gasto sigue publicándose con su nombre largo, y las
    // dos no pueden divergir: son el mismo número.
    assert.equal(
      metadata['stable_finalizable_candidate_count'],
      metadata['stable_finalizable_count'],
    );
    assert.equal(metadata['target_gap'], 2);
  });

  test('la proyección nunca se publica por DEBAJO de la estable', async () => {
    const probe = await run({ pendingFor: [] });
    const metadata = toRunMetricsMetadata(probe.result.runMetrics);
    assert.ok(
      (metadata['projected_finalizable_count'] as number) >=
        (metadata['stable_finalizable_count'] as number),
    );
  });
});

// ─── § 7 · después del writer, la reconciliación es autoritativa ──────────────

describe('§ 7 · la reconciliación POST-writer sí puede alcanzar el objetivo', () => {
  test('cinco filas completas ⇒ target_count 5, target_gap 0, target_reached', () => {
    const reconciliation = buildApolloPersistenceReconciliation(
      {
        eligibleBeforePersistence: 5,
        persistedCandidates: 5,
        completeValidCandidates: 5,
        gapCauses: {},
        targetEligibleCompanies: 5,
      },
      25,
    );

    assert.equal(reconciliation.target_count, 5);
    assert.equal(reconciliation.final_persisted_target_count, 5);
    assert.equal(reconciliation.target_gap, 0);
    assert.equal(reconciliation.target_reached, true);
    // El contrato del § 7, comprobado como identidad y no como coincidencia.
    assert.equal(
      reconciliation.target_reached,
      (reconciliation.target_count ?? -1) >= reconciliation.target_eligible_companies,
    );
    assert.equal(
      reconciliation.target_gap,
      Math.max(0, reconciliation.target_eligible_companies - (reconciliation.target_count ?? 0)),
    );
  });

  test('un rechazo del writer BAJA el objetivo, y el hueco lo dice', () => {
    // El writer admitió tres de las cinco: el duplicate guard y la novedad
    // descartaron dos. Es el escenario que el pre-writer no podía prever.
    const reconciliation = buildApolloPersistenceReconciliation(
      {
        eligibleBeforePersistence: 5,
        persistedCandidates: 3,
        completeValidCandidates: 3,
        gapCauses: { novelty_rejected: 1, cooldown_or_prior_suggestion: 1 },
        targetEligibleCompanies: 5,
      },
      25,
    );

    assert.equal(reconciliation.target_count, 3);
    assert.equal(reconciliation.target_gap, 2);
    assert.equal(reconciliation.target_reached, false);
    assert.equal(reconciliation.persistence_gap, 2);
    assert.equal(reconciliation.unexplained_gap, 0, 'las dos bajas tienen causa');
  });

  test('sin medición de completitud el hueco es `null`, nunca un número inventado', () => {
    const reconciliation = buildApolloPersistenceReconciliation(
      {
        eligibleBeforePersistence: 3,
        persistedCandidates: 3,
        completeValidCandidates: null,
        gapCauses: {},
        targetEligibleCompanies: 5,
      },
      10,
    );
    assert.equal(reconciliation.target_count, null);
    assert.equal(reconciliation.final_persisted_target_count, null);
    assert.equal(reconciliation.target_gap, null, 'no se afirma «cero completos»');
    assert.equal(reconciliation.target_reached, false, 'fail-closed');
  });

  test('la reconciliación toma el nombre canónico y la proyección queda marcada', () => {
    const reconciled = reconcileApolloTwoRoundPersistedTruth(
      {
        target_reached: false,
        run_metrics: {
          total_search_credits: 10,
          total_enrichment_credits: 5,
          persisted_candidates: 5,
          // Las cifras PRE-writer de esta misma corrida.
          target_gap: 5,
          stable_finalizable_count: 0,
          projected_finalizable_count: 5,
          writer_only_pending_count: 5,
        },
      },
      {
        eligibleBeforePersistence: 5,
        persistedCandidates: 5,
        completeValidCandidates: 5,
        gapCauses: {},
        targetEligibleCompanies: 5,
      },
    );

    assert.ok(reconciled !== null);
    const runMetrics = reconciled.observability['run_metrics'] as Record<string, unknown>;

    // El nombre canónico pasa a la cifra AUTORITATIVA…
    assert.equal(runMetrics['target_gap'], 0);
    assert.equal(runMetrics['final_persisted_target_count'], 5);
    assert.equal(reconciled.observability['target_reached'], true);
    // …y la proyección se conserva, marcada como proyección.
    assert.equal(runMetrics['projected_target_gap'], 5);
    assert.equal(reconciled.observability['projected_target_reached'], false);

    // Las cifras PRE-writer NO se reescriben: describen honestamente su momento.
    assert.equal(runMetrics['stable_finalizable_count'], 0);
    assert.equal(runMetrics['projected_finalizable_count'], 5);
    assert.equal(runMetrics['writer_only_pending_count'], 5);
  });
});

// ─── § 9 · ni una lectura de base ni una llamada de proveedor nuevas ──────────

describe('§ 9 · el addendum no cambia el perfil de I/O', () => {
  test('declarar pendiente no añade lecturas: sólo deja de suponer un pase', async () => {
    const resolved = await run({ pendingFor: [] });
    const pending = await run({ pendingFor: [...CANDIDATE_IDS] });

    // La corrida con admisiones pendientes hace MÁS búsquedas —la ronda 2 ya no se
    // salta— pero eso es la § 4, no I/O nueva: el tope de dos sigue intacto y el
    // orquestador no adquirió ninguna capacidad de leer la base.
    assert.equal(resolved.searchCalls, 1);
    assert.equal(pending.searchCalls, 2);
    assert.ok(pending.searchCalls <= 2, 'el tope absoluto de búsquedas no se movió');

    // `readCandidateTargetConditions` es el ÚNICO camino por el que el orquestador
    // se informa de las condiciones, y sigue siendo puro: lo que devuelve sale de
    // lo que la corrida ya construyó. Que se invoque más veces no es I/O nueva.
    assert.ok(pending.targetConditionReads > 0);
    assert.deepEqual(pending.enrichCalls, [], 'cero enrichments: cero créditos nuevos');
    assertCapsHold(pending);
    assertCapsHold(resolved);
  });
});
