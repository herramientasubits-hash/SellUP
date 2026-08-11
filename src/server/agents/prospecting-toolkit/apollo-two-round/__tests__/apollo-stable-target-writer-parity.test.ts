/**
 * apollo-stable-target-writer-parity.test.ts
 *
 * AGENT1-APOLLO-FINALIZATION-HARDENING-1 · STABLE-TARGET-WRITER-PARITY
 * §§ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 y 14.
 *
 * El defecto que esta suite congela: había DOS semánticas de objetivo. El
 * orquestador contaba «elegibles» —gates baratos limpios y sector confirmado— y
 * el writer contaba `complete_valid` —además: subindustria demostrada,
 * `employee_count`, LinkedIn, duplicidad y calidad—. La laxa decidía el gasto:
 * bastaba que cinco candidatas quedaran «elegibles» para que la corrida
 * declarara `target_already_reached` y dejara sin enrichment a candidatas que el
 * writer iba a persistir como `needs_review`.
 *
 * Cada `describe` de aquí abajo FALLA contra el código anterior a este addendum.
 *
 * Sin red, sin Apollo, sin Supabase, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundCandidateTargetConditions,
  type ApolloTwoRoundDeps,
  type ApolloTwoRoundRunResult,
  type CheapAssessment,
  type EnrichmentResult,
} from '../orchestrator';
import { toRunMetricsMetadata } from '../observability';
import {
  CANDIDATE_TARGET_CONDITIONS,
  evaluateCandidateTargetEligibility,
  evaluateCandidateSubindustryTargetEligibility,
} from '../../candidate-completeness-contract';
import { reconcileApolloTwoRoundPersistedTruth } from '../../apollo-persisted-candidate-truth';
import {
  APOLLO_WRITER_ONLY_ADMISSION_CHECKS,
  evaluateApolloPreWriterQualityGate,
} from '../../apollo-pre-writer-target-conditions';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  simulatedEffectiveRequestBuilder,
  org,
  passingAssessment,
} from './fixtures';

// ─── § 1/§ 2 · la función canónica, en aislamiento ────────────────────────────

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

describe('§ 1 · una sola semántica canónica de objetivo', () => {
  test('las condiciones del contrato son SIETE y están declaradas como dato', () => {
    assert.deepEqual([...CANDIDATE_TARGET_CONDITIONS], [
      'persistence_success',
      'subindustry_match',
      'employee_count_status',
      'linkedin_status',
      'duplicate_status',
      'ownership_gate',
      'quality_gate',
    ]);
  });

  test('todo satisfecho ⇒ elegible, sin fallidas ni pendientes', () => {
    const result = evaluateCandidateTargetEligibility(allSatisfied());
    assert.equal(result.eligibleForTarget, true);
    assert.equal(result.countsTowardTarget, true);
    assert.equal(result.countsTowardTargetIfPersisted, true);
    assert.equal(result.completeValidIfPersisted, true);
    assert.deepEqual(result.failedConditions, []);
    assert.deepEqual(result.strictlyFailedConditions, []);
    assert.deepEqual(result.pendingConditions, []);
  });

  test('§ 2 — una condición PENDIENTE impide contar, y no se confunde con fallida', () => {
    const result = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      pendingConditions: ['quality_gate'],
    });
    assert.equal(result.eligibleForTarget, false, 'no saber NO es cumplir');
    assert.equal(result.countsTowardTargetIfPersisted, false);
    assert.deepEqual(result.pendingConditions, ['quality_gate']);
    assert.deepEqual(result.strictlyFailedConditions, []);
    assert.equal(result.conditionStates.quality_gate, 'pending');
  });

  test('§ 10 — la ÚNICA diferencia pre/post writer es `persistence_success`', () => {
    const preWriter = evaluateCandidateTargetEligibility(allSatisfied());
    const persistenceFailed = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      persistenceSuccess: false,
    });

    // La verdad PRE-persistencia es idéntica en ambos: nada más cambió.
    assert.equal(preWriter.countsTowardTargetIfPersisted, true);
    assert.equal(persistenceFailed.countsTowardTargetIfPersisted, true);
    // Y sólo la elegibilidad final —la que exige la fila escrita— difiere.
    assert.equal(preWriter.eligibleForTarget, true);
    assert.equal(persistenceFailed.eligibleForTarget, false);
    assert.deepEqual(persistenceFailed.strictlyFailedConditions, ['persistence_success']);
  });

  test('el orden del contrato se conserva en `failedConditions`', () => {
    const result = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      subindustryMatch: 'not_confirmed',
      linkedinStatus: 'not_returned',
      qualityGate: 'fail',
    });
    assert.deepEqual(result.failedConditions, [
      'subindustry_match',
      'linkedin_status',
      'quality_gate',
    ]);
  });

  test('el writer y el orquestador comparten función: mismos insumos, mismo veredicto', () => {
    // El writer entra por la composición con subindustria; el orquestador por la
    // base. Con los mismos insumos, las dos tienen que decir lo mismo.
    const viaWriter = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [],
      subindustryPrecision: null,
      employeeCountStatus: 'not_returned',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    const viaOrchestrator = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      employeeCountStatus: 'not_returned',
    });

    assert.equal(viaWriter.countsTowardTarget, viaOrchestrator.countsTowardTarget);
    assert.deepEqual(viaWriter.failedConditions, viaOrchestrator.failedConditions);
    assert.equal(
      viaWriter.countsTowardTargetIfPersisted,
      viaOrchestrator.countsTowardTargetIfPersisted,
    );
  });
});

// ─── § 8 · precisión de subindustria (preserva #241) ──────────────────────────

describe('§ 8 · sector confirmado NO rescata a una subindustria ambigua o sin mapear', () => {
  const precision = (overrides: Record<string, unknown>) =>
    ({
      requestedSubindustry: 'Tiendas por Departamento',
      requestedSubindustries: ['Tiendas por Departamento'],
      perRequestedSubindustryEvaluations: [],
      matchedRequestedSubindustry: null,
      subindustryMatchFamily: 'none',
      subindustryMapped: true,
      subindustryMatch: 'ambiguous',
      industryMatch: 'confirmed',
      ...overrides,
    }) as never;

  test('ambiguous ⇒ no cuenta, con causa nombrada', () => {
    const result = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: ['Tiendas por Departamento'],
      subindustryPrecision: precision({ subindustryMatch: 'ambiguous' }),
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(result.countsTowardTarget, false);
    assert.equal(result.countsTowardTargetIfPersisted, false);
    assert.equal(result.subindustryBlockingReason, 'subindustry_ambiguous');
  });

  test('unmapped ⇒ no cuenta, aunque la INDUSTRIA esté confirmada', () => {
    const result = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: ['Tiendas por Departamento'],
      subindustryPrecision: precision({ subindustryMapped: false, industryMatch: 'confirmed' }),
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(result.countsTowardTarget, false);
    assert.equal(result.subindustryBlockingReason, 'subindustry_not_mapped');
  });
});

// ─── § 7 · el gate de calidad PRE-writer, en aislamiento ─────────────────────

describe('§ 7 · el gate de calidad invoca los gates propios del writer', () => {
  const supermarket = (overrides: Record<string, unknown> = {}) => ({
    name: 'Cadena de Supermercados Andina',
    website: 'https://supermercadosandina.com.co',
    domain: 'supermercadosandina.com.co',
    sourceSnippet: 'cadena de supermercados y autoservicio en Bogotá, Colombia',
    sourceTitle: 'Supermercados Andina | Colombia',
    queryText: 'supermercados colombia',
    targetCountryCode: 'CO',
    subindustries: ['Supermercados e Hipermercados'],
    additionalCriteria: null,
    candidate: { company_size: '500' },
    ...overrides,
  });

  test('una empresa por encima del umbral ICP pasa', () => {
    const result = evaluateApolloPreWriterQualityGate(supermarket());
    assert.equal(result.verdict, 'pass');
    assert.equal(result.blockingReason, null);
  });

  test('por DEBAJO del umbral ICP el gate falla, con la causa del writer', () => {
    const result = evaluateApolloPreWriterQualityGate(
      supermarket({ candidate: { company_size: '12' } }),
    );
    assert.equal(result.verdict, 'fail');
    assert.equal(result.blockingReason, 'icp_size_below_threshold');
  });

  test('el veredicto de calidad viaja al contrato y bloquea el conteo', () => {
    const blocked = evaluateApolloPreWriterQualityGate(
      supermarket({ candidate: { company_size: '12' } }),
    );
    const eligibility = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      qualityGate: blocked.verdict,
    });
    assert.equal(eligibility.eligibleForTarget, false);
    assert.deepEqual(eligibility.strictlyFailedConditions, ['quality_gate']);
  });

  test('§ 10 — el límite del evaluador PRE-writer está DECLARADO, no implícito', () => {
    // Estas comprobaciones dependen de estado que sólo el writer tiene en el
    // momento de escribir. Sólo pueden descartar a un candidato que aquí pasa —
    // nunca rescatar a uno que aquí cae— y por eso la cifra PRE-writer es una
    // proyección y la reconciliación posterior es la autoritativa.
    //
    // WRITER-ONLY-ADMISSION-PENDING § 1 — eran DOS porque nadie había barrido el
    // cooldown de identidad (`buildRecentIdentityKeySet`), la dedupe intra-lote
    // (Pass 2.5) ni el cupo del lote (Pass 3). La lista es la auditoría, así que
    // esta aserción es lo que impide volver a declararla incompleta.
    assert.deepEqual([...APOLLO_WRITER_ONLY_ADMISSION_CHECKS], [
      'active_duplicate_guard',
      'novelty_index',
      'recent_identity_cooldown',
      'intra_batch_identity_dedupe',
      'target_cap',
    ]);
  });
});

// ─── § 9 · duplicado ──────────────────────────────────────────────────────────

describe('§ 9 · el duplicado se lee del vocabulario que se persiste', () => {
  test('`possible_duplicate` no cuenta', () => {
    const result = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      duplicateStatus: 'possible_duplicate',
    });
    assert.equal(result.eligibleForTarget, false);
    assert.deepEqual(result.strictlyFailedConditions, ['duplicate_status']);
  });

  test('`unchecked` NO se lee como «sin duplicado»', () => {
    const result = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      duplicateStatus: 'unchecked',
    });
    assert.equal(result.eligibleForTarget, false);
  });

  test('duplicado PENDIENTE tampoco cuenta', () => {
    const result = evaluateCandidateTargetEligibility({
      ...allSatisfied(),
      pendingConditions: ['duplicate_status'],
    });
    assert.equal(result.eligibleForTarget, false);
    assert.deepEqual(result.pendingConditions, ['duplicate_status']);
  });
});

// ─── Fixture de corrida: 5 candidatas, target 5 ───────────────────────────────

/**
 * § 5 — el probe convertido en regresión. Nombres SINTÉTICOS: este fixture no
 * reproduce una corrida real, así que no puede llevar los nombres de una.
 */
type Shape = 'complete' | 'employee_missing' | 'linkedin_missing' | 'quality_review';

function assessmentFor(shape: Shape): CheapAssessment {
  const base = passingAssessment();
  switch (shape) {
    case 'employee_missing':
      return { ...base, signals: { ...base.signals, hasCompanySizeSignal: false } };
    case 'linkedin_missing':
      return { ...base, signals: { ...base.signals, hasLinkedInUrl: false } };
    case 'complete':
    case 'quality_review':
      return base;
  }
}

type Scenario = {
  shapes: readonly { id: string; shape: Shape }[];
  /** Campos que el enrichment resuelve, por clave de candidato. */
  enrichmentResolves?: Record<string, Partial<{ employee: boolean; linkedin: boolean }>>;
  /** § 7 — candidatos que el gate de calidad del writer deja en revisión. */
  qualityNeedsReview?: readonly string[];
  maxEnrichmentsPerRun?: number;
};

function buildScenario(scenario: Scenario): {
  deps: ApolloTwoRoundDeps;
  enrichCalls: string[];
} {
  const enrichCalls: string[] = [];
  const shapeByKey = new Map<string, Shape>(
    scenario.shapes.map((entry) => [`apollo:${entry.id}`, entry.shape] as const),
  );
  /** Lo que un enrichment ya resolvió, por candidato. */
  const resolved = new Map<string, { employee: boolean; linkedin: boolean }>();

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber }) => ({
      organizations:
        roundNumber === 1
          ? scenario.shapes.map((entry, index) =>
              org(entry.id, { providerRank: index + 1 }),
            )
          : [],
      providerRequestCount: 1,
      internalRecordedCredits: scenario.shapes.length,
      providerTotalPages: 1,
    }),
    assessCandidate: ({ organization }) =>
      assessmentFor(shapeByKey.get(`apollo:${organization.providerOrganizationId}`) ?? 'complete'),
    enrichCandidate: async ({ candidateKey }): Promise<EnrichmentResult> => {
      enrichCalls.push(candidateKey);
      const resolves = scenario.enrichmentResolves?.[candidateKey] ?? {};
      const shape = shapeByKey.get(candidateKey) ?? 'complete';
      const employee =
        resolves.employee === true || shape !== 'employee_missing';
      const linkedin = resolves.linkedin === true || shape !== 'linkedin_missing';
      resolved.set(candidateKey, { employee, linkedin });
      return {
        executed: true,
        internalRecordedCredits: 1,
        sectorEvidenceState: 'sector_evidence_confirmed',
        providerCompanyFields: {
          employeeCountStatus: employee ? 'confirmed' : 'not_returned',
          linkedinStatus: linkedin ? 'confirmed' : 'not_returned',
        },
      };
    },
    applyFinalGates: () => ({ rejection: null }),
    // § 1 — el adaptador aporta la vista del WRITER. Aquí se simula: es lo que
    // producción rellena leyendo `providerCompanyFields`, la precisión de
    // subindustria y los gates puros del writer.
    readCandidateTargetConditions: ({
      candidateKey,
    }): ApolloTwoRoundCandidateTargetConditions => {
      const shape = shapeByKey.get(candidateKey) ?? 'complete';
      const afterEnrichment = resolved.get(candidateKey) ?? null;
      const employeeOk =
        afterEnrichment?.employee ?? shape !== 'employee_missing';
      const linkedinOk = afterEnrichment?.linkedin ?? shape !== 'linkedin_missing';
      return {
        subindustryMatch: 'confirmed',
        employeeCountStatus: employeeOk ? 'confirmed' : 'not_returned',
        linkedinStatus: linkedinOk ? 'confirmed' : 'not_returned',
        duplicateStatus: 'no_match',
        ownershipGate: 'pass',
        qualityGate: (scenario.qualityNeedsReview ?? []).includes(candidateKey)
          ? 'fail'
          : 'pass',
      };
    },
  };

  return { deps, enrichCalls };
}

async function run(scenario: Scenario): Promise<{
  result: ApolloTwoRoundRunResult;
  enrichCalls: string[];
}> {
  const { deps, enrichCalls } = buildScenario(scenario);
  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig({
        targetEligibleCompanies: 5,
        maxRounds: 1,
        maxResultsPerRound: 10,
        maxRawResultsPerRun: 10,
        maxEnrichmentsPerRun: scenario.maxEnrichmentsPerRun ?? 5,
      }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
    },
    deps,
  );
  return { result, enrichCalls };
}

const FIVE_WITH_TWO_MISSING_EMPLOYEE: Scenario['shapes'] = [
  { id: 'alfa', shape: 'complete' },
  { id: 'beta', shape: 'complete' },
  { id: 'gamma', shape: 'complete' },
  { id: 'delta', shape: 'employee_missing' },
  { id: 'epsilon', shape: 'employee_missing' },
];

// ─── § 5 · el caso obligatorio ────────────────────────────────────────────────

describe('§ 5 · 5 candidatas, 3 completas y 2 sin employee_count', () => {
  test('ANTES del enrichment: estables = 3, hueco = 2, objetivo NO alcanzado', async () => {
    // Sin presupuesto de enrichment, el estado inicial queda congelado y visible.
    const { result } = await run({
      shapes: FIVE_WITH_TWO_MISSING_EMPLOYEE,
      maxEnrichmentsPerRun: 0,
    });

    assert.equal(result.eligibleCompaniesFound, 5, 'las cinco pasan los gates baratos');
    assert.equal(
      result.stableFinalizableCandidateCount,
      3,
      'sólo tres cumplen el contrato completo',
    );
    assert.equal(result.projectedTargetGap, 2);
    assert.equal(result.targetReached, false);
  });

  test('las 2 con employee_count ausente COMPITEN: nunca `target_already_reached`', async () => {
    const { result, enrichCalls } = await run({
      shapes: FIVE_WITH_TWO_MISSING_EMPLOYEE,
      enrichmentResolves: {
        'apollo:delta': { employee: true },
        'apollo:epsilon': { employee: true },
      },
    });

    assert.deepEqual(
      [...enrichCalls].sort(),
      ['apollo:delta', 'apollo:epsilon'],
      'sólo las dos incompletas tenían algo que comprar',
    );
    assert.equal(
      result.enrichmentSkips.filter((s) => s.skippedReason === 'target_already_reached').length,
      0,
      'la cuenta provisional ya no puede detener el gasto',
    );
  });

  test('DESPUÉS del enrichment: estables = 5, hueco = 0, objetivo alcanzado', async () => {
    const { result } = await run({
      shapes: FIVE_WITH_TWO_MISSING_EMPLOYEE,
      enrichmentResolves: {
        'apollo:delta': { employee: true },
        'apollo:epsilon': { employee: true },
      },
    });

    assert.equal(result.stableFinalizableCandidateCount, 5);
    assert.equal(result.projectedTargetGap, 0);
    assert.equal(result.targetReached, true);
  });

  test('un enrichment que NO resuelve el campo no infla la cuenta', async () => {
    const { result } = await run({
      shapes: FIVE_WITH_TWO_MISSING_EMPLOYEE,
      enrichmentResolves: {},
    });

    assert.equal(
      result.stableFinalizableCandidateCount,
      3,
      'pagar no es resolver: el campo sigue ausente',
    );
    assert.equal(result.targetReached, false);
  });
});

// ─── § 6 · LinkedIn ───────────────────────────────────────────────────────────

describe('§ 6 · LinkedIn ausente con todo lo demás confirmado', () => {
  const shapes: Scenario['shapes'] = [
    { id: 'alfa', shape: 'complete' },
    { id: 'beta', shape: 'complete' },
    { id: 'gamma', shape: 'complete' },
    { id: 'delta', shape: 'complete' },
    { id: 'epsilon', shape: 'linkedin_missing' },
  ];

  test('no cuenta como estable y NO produce `target_already_reached`', async () => {
    const { result, enrichCalls } = await run({ shapes, maxEnrichmentsPerRun: 0 });
    assert.equal(result.stableFinalizableCandidateCount, 4);
    assert.equal(result.projectedTargetGap, 1);
    assert.equal(result.targetReached, false);
    assert.deepEqual(enrichCalls, [], 'sin presupuesto no se compra nada');
  });

  test('compite por el enrichment que puede resolver el LinkedIn', async () => {
    const { result, enrichCalls } = await run({
      shapes,
      enrichmentResolves: { 'apollo:epsilon': { linkedin: true } },
    });
    assert.deepEqual(enrichCalls, ['apollo:epsilon']);
    assert.equal(result.stableFinalizableCandidateCount, 5);
    assert.equal(result.targetReached, true);
  });
});

// ─── § 7 · calidad / política de evidencia ────────────────────────────────────

describe('§ 7 · calidad en revisión no cuenta hacia el objetivo', () => {
  test('5 pasan país/ownership/sector y 2 quedan en revisión ⇒ estables = 3', async () => {
    const { result } = await run({
      shapes: [
        { id: 'alfa', shape: 'complete' },
        { id: 'beta', shape: 'complete' },
        { id: 'gamma', shape: 'complete' },
        { id: 'delta', shape: 'quality_review' },
        { id: 'epsilon', shape: 'quality_review' },
      ],
      qualityNeedsReview: ['apollo:delta', 'apollo:epsilon'],
      maxEnrichmentsPerRun: 0,
    });

    assert.equal(result.eligibleCompaniesFound, 5);
    assert.equal(result.stableFinalizableCandidateCount, 3);
    assert.equal(result.projectedTargetGap, 2);
    assert.equal(result.targetReached, false);
  });
});

// ─── § 4 · la parada, y sólo la parada, usa la cuenta estable ─────────────────

describe('§ 4 · sólo `stable >= target` puede detener el gasto', () => {
  test('con 5 estables de verdad, la corrida SÍ se detiene', async () => {
    const { result, enrichCalls } = await run({
      shapes: [
        { id: 'alfa', shape: 'complete' },
        { id: 'beta', shape: 'complete' },
        { id: 'gamma', shape: 'complete' },
        { id: 'delta', shape: 'complete' },
        { id: 'epsilon', shape: 'complete' },
      ],
    });
    assert.equal(result.stableFinalizableCandidateCount, 5);
    assert.equal(result.targetReached, true);
    assert.deepEqual(enrichCalls, [], 'nada que comprar: el contrato ya está completo');
  });

  test('§ 11 — el invariante `target_reached == (target_gap == 0)` se sostiene', async () => {
    for (const scenario of [
      { shapes: FIVE_WITH_TWO_MISSING_EMPLOYEE, maxEnrichmentsPerRun: 0 },
      {
        shapes: FIVE_WITH_TWO_MISSING_EMPLOYEE,
        enrichmentResolves: {
          'apollo:delta': { employee: true },
          'apollo:epsilon': { employee: true },
        },
      },
    ] satisfies Scenario[]) {
      const { result } = await run(scenario);
      assert.equal(
        result.targetReached,
        result.projectedTargetGap === 0,
        'el hueco cero y el objetivo alcanzado no pueden discrepar',
      );
    }
  });
});

// ─── § 3/§ 14 · métricas y caps ───────────────────────────────────────────────

describe('§ 3 · `stable_finalizable_candidate_count` deja de ser un alias', () => {
  test('la métrica publicada NO es `total_eligible_companies`', async () => {
    const { result } = await run({
      shapes: FIVE_WITH_TWO_MISSING_EMPLOYEE,
      maxEnrichmentsPerRun: 0,
    });
    const metadata = toRunMetricsMetadata(result.runMetrics);

    assert.equal(metadata['total_eligible_companies'], 5);
    assert.equal(metadata['stable_finalizable_candidate_count'], 3);
    assert.equal(metadata['target_gap'], 2);
    assert.notEqual(
      metadata['stable_finalizable_candidate_count'],
      metadata['total_eligible_companies'],
      'si vuelven a coincidir por construcción, el alias regresó',
    );
  });
});

describe('§ 14 · los topes absolutos no se mueven', () => {
  test('<= 2 búsquedas, <= 5 enrichments y <= 25 créditos equivalentes', async () => {
    const { result, enrichCalls } = await run({
      shapes: [
        { id: 'alfa', shape: 'employee_missing' },
        { id: 'beta', shape: 'employee_missing' },
        { id: 'gamma', shape: 'employee_missing' },
        { id: 'delta', shape: 'employee_missing' },
        { id: 'epsilon', shape: 'employee_missing' },
        { id: 'zeta', shape: 'employee_missing' },
        { id: 'eta', shape: 'employee_missing' },
      ],
      maxEnrichmentsPerRun: 5,
    });

    assert.ok(result.rounds.length <= 2, 'nunca una tercera ronda');
    assert.ok(enrichCalls.length <= 5, `cap de enrichments: ${enrichCalls.length}`);
    assert.equal(result.runMetrics.enrichmentsExecuted, enrichCalls.length);
    assert.ok(
      result.runMetrics.totalSearchCredits + result.runMetrics.totalEnrichmentCredits <= 25,
      'el techo de 25 créditos por corrida se conserva',
    );
  });
});

// ─── § 10/§ 13 · reconciliación posterior al writer ───────────────────────────

describe('§ 10 · la métrica estable y la persistida NO comparten nombre', () => {
  test('un fallo de persistencia baja la cifra FINAL sin invalidar la parada', async () => {
    const { result } = await run({
      shapes: [
        { id: 'alfa', shape: 'complete' },
        { id: 'beta', shape: 'complete' },
        { id: 'gamma', shape: 'complete' },
        { id: 'delta', shape: 'complete' },
        { id: 'epsilon', shape: 'complete' },
      ],
    });

    assert.equal(result.stableFinalizableCandidateCount, 5, 'la verdad PRE-writer');

    // El writer recibió las 5 y escribió 4: una fila se perdió.
    const reconciled = reconcileApolloTwoRoundPersistedTruth(
      { run_metrics: { persisted_candidates: 5 }, target_reached: true },
      {
        eligibleBeforePersistence: 5,
        persistedCandidates: 4,
        completeValidCandidates: 4,
        gapCauses: { persistence_failed: 1 },
        targetEligibleCompanies: 5,
      },
    );
    assert.ok(reconciled !== null);

    assert.equal(
      reconciled.reconciliation.persisted_candidates,
      4,
      'la cifra autoritativa es la de filas reales',
    );
    assert.equal(
      reconciled.reconciliation.target_reached,
      false,
      '§ 11 — el objetivo FINAL se decide contra las filas, no contra la proyección',
    );
    assert.notEqual(
      result.stableFinalizableCandidateCount,
      reconciled.reconciliation.persisted_candidates,
      'estable y persistida son cifras distintas, con nombres distintos',
    );
    // § 13 — la proyección PRE-writer se conserva con su propio nombre en vez de
    // sobrescribir la métrica final.
    const finalRunMetrics = reconciled.observability['run_metrics'] as Record<string, unknown>;
    assert.equal(finalRunMetrics['persisted_candidates'], 4);
    assert.equal(finalRunMetrics['orchestrator_ranked_persisted_projection'], 5);
  });
});
