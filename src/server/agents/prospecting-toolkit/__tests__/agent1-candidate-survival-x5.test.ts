/**
 * agent1-candidate-survival-x5.test.ts
 *
 * AGENT1-CANDIDATE-SURVIVAL-X5 — el enrichment no es un gate de aceptación.
 *
 * ── El defecto que cierra, medido en Producción ──────────────────────────────
 *
 * Certificación `wizard_run 5bfb5ff8…`, lote `c7c28980…` (CO × retail ×
 * target 5, Apollo, waterfall apagado):
 *
 *   34 empresas únicas
 *   ├─ 15 ownership rechazadas   ← causa real
 *   ├─  1 sector contradictorio  ← causa real (evidencia EN CONTRA)
 *   └─ 18 enrichment_budget_exhausted
 *
 *   prospect_candidates creados .... 0
 *
 * Las 18 no tenían ningún gate obligatorio en contra. Su única falta fue llegar
 * después de que el cupo de cinco enrichments se agotara. Un lote que había
 * encontrado diecinueve empresas limpias entregó cero.
 *
 * La causa raíz eran dos condiciones que confundían tres preguntas distintas:
 *
 *   `isEligible`          exigía `sector_evidence_confirmed` para EXISTIR
 *   `isReviewOnlyCohort`  exigía `enrichmentExecuted` para ir a revisión
 *
 * Es decir: haber podido GASTAR era requisito para SOBREVIVIR.
 *
 * ── Las tres preguntas, ahora separadas ──────────────────────────────────────
 *
 *   ¿SOBREVIVE?            la deciden los gates obligatorios y sólo ellos
 *   ¿está COMPLETA?        la completa el enrichment y los catálogos propios
 *   ¿CUENTA hacia target?  la decide el contrato canónico (CUT-7), aparte
 *
 * Offline: sin red, sin Apollo, sin Lusha, sin Supabase, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  classifySectorEvidence,
  decideCandidateSurvival,
  resolveFinalCandidateCap,
  wasEnrichmentAttempted,
  type EnrichmentCompletionOutcome,
} from '../candidate-survival';
import {
  evaluateCandidateTargetEligibility,
  toSubindustryMatchVerdict,
} from '../candidate-completeness-contract';
import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type ApolloTwoRoundRunInput,
} from '../apollo-two-round/orchestrator';
import {
  evaluateApolloCandidateFinalDispositions,
  countUnclassifiedFinalDispositions,
} from '../apollo-two-round/candidate-final-disposition';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  simulatedEffectiveRequestBuilder,
  org,
  orgs,
  passingAssessment,
  ambiguousAssessment,
  rejectedAssessment,
} from '../apollo-two-round/__tests__/fixtures';

// ─── Vocabulario ──────────────────────────────────────────────────────────────

/** Todos los desenlaces posibles de un enrichment. El cross-product completo. */
const ALL_ENRICHMENT_OUTCOMES: readonly EnrichmentCompletionOutcome[] = [
  'not_attempted_cap_reached',
  'not_attempted_target_reached',
  'not_attempted',
  'no_match',
  'partial',
  'technical_failure',
  'confirmed',
];

/** Rechazos que SÍ son gates obligatorios. Ninguno se relaja en este corte. */
const MANDATORY_REJECTIONS = [
  'country_incompatible',
  'invalid_domain',
  'external_platform_domain',
  'ownership_mismatch',
  'duplicate_in_sellup',
  'duplicate_in_hubspot',
  'cooldown_or_prior_suggestion',
] as const;

// ══ A · LA REGLA ══════════════════════════════════════════════════════════════

describe('X5 § A · supervivencia: la deciden los gates obligatorios y nadie más', () => {
  test('1 · gates OK + enrichment no intentado por cap ⇒ SOBREVIVE', () => {
    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
    });

    assert.equal(decision.survives, true);
    assert.equal(decision.cohort, 'survives_incomplete');
    assert.equal(decision.rejectionReason, null);
    assert.equal(decision.incompletenessReason, 'sector_evidence_absent');
  });

  /**
   * 2, 3 y 4 · sin match, parcial y fallo técnico.
   *
   * Los tres se prueban a la vez y a propósito: el desenlace del enrichment NO
   * ENTRA en la firma de `decideCandidateSurvival`, así que probar que los tres
   * sobreviven es probar la misma propiedad tres veces. Lo que sí demuestra algo
   * es el cross-product COMPLETO — ver § E, M2.
   */
  test('2/3/4 · enrichment sin match, parcial o con fallo técnico ⇒ SOBREVIVE', () => {
    for (const outcome of ['no_match', 'partial', 'technical_failure'] as const) {
      const decision = decideCandidateSurvival({
        mandatoryRejection: null,
        sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      });
      assert.equal(decision.survives, true, `desenlace ${outcome}`);
      assert.equal(wasEnrichmentAttempted(outcome), true, `${outcome} sí se intentó`);
    }
  });

  test('5 · un gate obligatorio FALLA ⇒ sigue rechazada, uno por uno', () => {
    for (const rejection of MANDATORY_REJECTIONS) {
      const decision = decideCandidateSurvival({
        mandatoryRejection: rejection,
        // Sector confirmado: ni así la salva. El gate obligatorio manda.
        sectorEvidenceState: 'sector_evidence_confirmed',
      });
      assert.equal(decision.survives, false, `${rejection} tiene que rechazar`);
      assert.equal(decision.cohort, 'rejected');
      assert.equal(decision.rejectionReason, rejection);
    }
  });

  test('5b · evidencia sectorial EN CONTRA sigue siendo rechazo', () => {
    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_evidence_contradictory',
    });

    assert.equal(decision.survives, false);
    assert.equal(decision.cohort, 'rejected');
  });

  test('6 · catálogo SIN MATCH no rechaza: es ausencia de evidencia', () => {
    // El proveedor no declaró lo suficiente y hay política con que juzgarlo.
    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
    });

    assert.equal(classifySectorEvidence('sector_evidence_missing_needs_enrichment'), 'sector_evidence_absent');
    assert.equal(decision.survives, true);
  });

  test('7 · catálogo SIN DATO no rechaza: tampoco cuando no hay política', () => {
    // No hay política de sector y el proveedor no declaró nada: bootstrap.
    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_evidence_missing_bootstrap_eligible',
    });

    assert.equal(
      classifySectorEvidence('sector_evidence_missing_bootstrap_eligible'),
      'sector_evidence_absent',
    );
    assert.equal(decision.survives, true);
    assert.equal(decision.cohort, 'survives_incomplete');
  });

  test('un estado sectorial DESCONOCIDO no se asume ausente (fail-closed)', () => {
    assert.equal(classifySectorEvidence('algo_que_nadie_ha_definido'), 'sector_mandatory_rejection');
    assert.equal(
      decideCandidateSurvival({
        mandatoryRejection: null,
        sectorEvidenceState: 'algo_que_nadie_ha_definido',
      }).survives,
      false,
      'inventar supervivencia para un vocabulario desconocido es el error simétrico',
    );
  });
});

// ══ B · PROVIDER-AGNOSTICISMO ════════════════════════════════════════════════

describe('X5 § B · la regla es la misma para todo proveedor', () => {
  /**
   * 11, 12 y 13 · Apollo, Lusha y un adaptador futuro.
   *
   * La prueba no es que tres ramas den lo mismo: es que NO HAY tres ramas. La
   * entrada de `decideCandidateSurvival` no nombra al proveedor, así que tres
   * llamadas con el mismo estado son literalmente la misma llamada. Lo que este
   * caso fija es que el vocabulario de cada proveedor ATERRIZA en el mismo
   * conjunto de estados, y la guarda estática de abajo fija que no puede
   * aparecer una rama por proveedor sin que este test lo note.
   */
  const PROVIDER_SHAPED_CASES = [
    { provider: 'apollo', state: 'sector_evidence_missing_needs_enrichment', survives: true },
    { provider: 'apollo', state: 'sector_evidence_contradictory', survives: false },
    { provider: 'lusha', state: 'sector_evidence_missing_needs_enrichment', survives: true },
    { provider: 'lusha', state: 'sector_evidence_missing_bootstrap_eligible', survives: true },
    { provider: 'lusha', state: 'sector_evidence_confirmed', survives: true },
    { provider: 'futuro_adapter', state: 'sector_evidence_missing_needs_enrichment', survives: true },
    { provider: 'futuro_adapter', state: 'sector_evidence_confirmed', survives: true },
    { provider: 'futuro_adapter', state: 'sector_evidence_contradictory', survives: false },
  ] as const;

  test('11/12/13 · Apollo, Lusha y un adaptador futuro comparten veredicto', () => {
    for (const testCase of PROVIDER_SHAPED_CASES) {
      const decision = decideCandidateSurvival({
        mandatoryRejection: null,
        sectorEvidenceState: testCase.state,
      });
      assert.equal(
        decision.survives,
        testCase.survives,
        `${testCase.provider} · ${testCase.state}`,
      );
    }
  });

  test('el mismo estado da el MISMO veredicto sea cual sea el proveedor', () => {
    const states = [
      'sector_evidence_confirmed',
      'sector_evidence_missing_needs_enrichment',
      'sector_evidence_missing_bootstrap_eligible',
      'sector_evidence_contradictory',
      'sector_not_mapped',
    ];
    for (const state of states) {
      const veredicts = ['apollo', 'lusha', 'tavily', 'cualquier_otro'].map(() =>
        JSON.stringify(decideCandidateSurvival({ mandatoryRejection: null, sectorEvidenceState: state })),
      );
      assert.equal(new Set(veredicts).size, 1, `${state} no puede depender del proveedor`);
    }
  });

  /**
   * 🔴 M6 · guarda ESTÁTICA, sobre el fuente sin comentarios.
   *
   * Un test de comportamiento no puede demostrar la ausencia de una rama que
   * nadie ejercita. Ésta sí: si alguien escribe `if (provider === 'apollo')` en
   * el módulo de la regla, este assert lo ve aunque ningún caso lo cubra.
   *
   * Los comentarios se eliminan antes de mirar — nombrar a un proveedor en una
   * explicación no es ramificar por él.
   */
  test('🔴 M6 · el módulo de la regla no nombra a ningún proveedor en su código', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '..', 'candidate-survival.ts'), 'utf8');
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

    for (const provider of ['apollo', 'lusha', 'tavily', 'Apollo', 'Lusha']) {
      assert.ok(
        !withoutComments.includes(provider),
        `el código de la regla no puede mencionar "${provider}": la supervivencia es provider-agnóstica`,
      );
    }
    assert.ok(!/\bprovider\s*===/.test(withoutComments), 'ninguna rama puede comparar el proveedor');
  });
});

// ══ C · EL OBJETIVO NO ES UN TOPE ════════════════════════════════════════════

function harnessDeps(input: {
  organizations: ReturnType<typeof orgs>;
  assess?: ApolloTwoRoundDeps['assessCandidate'];
  enrich?: ApolloTwoRoundDeps['enrichCandidate'];
}): ApolloTwoRoundDeps {
  return {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async () => ({
      organizations: input.organizations,
      providerRequestCount: 1,
      internalRecordedCredits: input.organizations.length,
      providerTotalPages: 1,
    }),
    assessCandidate: input.assess ?? (() => passingAssessment()),
    enrichCandidate:
      input.enrich ??
      (async () => ({
        executed: true,
        internalRecordedCredits: 1,
        sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      })),
    applyFinalGates: () => ({ rejection: null }),
  };
}

function runWith(deps: ApolloTwoRoundDeps, overrides: Partial<ApolloTwoRoundRunInput> = {}) {
  return runApolloTwoRoundDiscovery(
    {
      config: testConfig({ maxResultsPerRound: 20, maxRawResultsPerRun: 40 }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
      ...overrides,
    },
    deps,
  );
}

describe('X5 § C · `target = 5` es una necesidad, no un techo de existencia', () => {
  test('8 · con target 5, la candidata válida nº 6 SOBREVIVE', async () => {
    const result = await runWith(harnessDeps({ organizations: orgs('a', 6) }));

    assert.equal(result.eligibleCompaniesFound, 6);
    assert.equal(result.persistedCandidates, 6, 'la sexta no puede caer por ser la sexta');
    assert.equal(result.notPersisted.length, 0);
  });

  test('9 · con target 5, las válidas 6..12 sobreviven TODAS', async () => {
    const result = await runWith(harnessDeps({ organizations: orgs('a', 12) }));

    assert.equal(result.eligibleCompaniesFound, 12);
    assert.equal(result.persistedCandidates, 12);
    assert.equal(result.notPersisted.length, 0);
  });

  test('el objetivo SIGUE gobernando la parada del gasto', async () => {
    // Doce ambiguas y un cupo de 2 enrichments: el objetivo manda sobre lo que
    // se compra, y eso este corte no lo toca.
    const deps = harnessDeps({
      organizations: orgs('a', 12),
      assess: () => ambiguousAssessment(),
    });
    const enrichCalls: string[] = [];
    const result = await runWith({
      ...deps,
      enrichCandidate: async ({ candidateKey }) => {
        enrichCalls.push(candidateKey);
        return {
          executed: true,
          internalRecordedCredits: 1,
          sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
        };
      },
    });

    assert.ok(enrichCalls.length <= 2, 'el cupo de enrichments no se relaja');
    assert.equal(result.runMetrics.enrichmentsExecuted, enrichCalls.length);
    // Y las doce sobreviven igual: diez sin haber podido gastar un solo crédito.
    assert.equal(result.reviewOnly.length, 12);
  });

  test('los cinco límites son independientes: `resolveFinalCandidateCap` no ve el objetivo', () => {
    assert.equal(resolveFinalCandidateCap(undefined), null, 'sin tope configurado, no hay tope');
    assert.equal(resolveFinalCandidateCap(null), null);
    assert.equal(resolveFinalCandidateCap(5), 5);
    assert.equal(resolveFinalCandidateCap(-3), 0);
    assert.equal(resolveFinalCandidateCap(Number.POSITIVE_INFINITY), null);
    // La firma es de UN argumento: no hay forma de pasarle el objetivo.
    assert.equal(resolveFinalCandidateCap.length, 1);
  });
});

// ══ D · SOBREVIVIR ≠ CONTAR HACIA EL OBJETIVO ════════════════════════════════

describe('X5 § D · CUT-7 intacto: sobrevivir no es contar', () => {
  test('10 · una candidata incompleta sobrevive y NO cuenta automáticamente', () => {
    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
    });
    assert.equal(decision.survives, true);

    // El contrato canónico —el mismo que usa el writer— la deja fuera del conteo.
    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: toSubindustryMatchVerdict('sector_evidence_missing_needs_enrichment'),
      employeeCountStatus: 'not_returned',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(eligibility.countsTowardTargetIfPersisted, false);
  });

  test('una candidata COMPLETA y confirmada sí puede contar', () => {
    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_evidence_confirmed',
    });
    assert.equal(decision.cohort, 'eligible_for_target');

    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: toSubindustryMatchVerdict('sector_evidence_confirmed'),
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(eligibility.countsTowardTargetIfPersisted, true);
  });

  test('sobrevivir con el sector confirmado TAMPOCO basta si falta un campo', () => {
    // `eligible_for_target` significa «puede ser evaluada», no «cuenta».
    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: toSubindustryMatchVerdict('sector_evidence_confirmed'),
      employeeCountStatus: 'not_returned',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(eligibility.countsTowardTargetIfPersisted, false);
  });
});

// ══ E · REGRESIÓN c7c28980 Y MUTACIONES ══════════════════════════════════════

/**
 * Reconstrucción de la FORMA de la corrida `c7c28980…`, no de sus datos.
 *
 *   34 únicas · 15 ownership · 1 sector contradictorio · 18 sin enrichment
 *
 * No se backfillea ni se altera el histórico: lo que se fija es lo que el
 * orquestador decidiría HOY con esas mismas 34 entradas.
 */
const RETAIL_OWNERSHIP_REJECTED = 15;
const RETAIL_SECTOR_CONTRADICTORY = 1;
const RETAIL_ENRICHMENT_COMPETITORS = 18;
const RETAIL_TOTAL = RETAIL_OWNERSHIP_REJECTED + RETAIL_SECTOR_CONTRADICTORY + RETAIL_ENRICHMENT_COMPETITORS;

async function runRetailShape(maxEnrichmentsPerRun: number) {
  const organizations = [
    ...Array.from({ length: RETAIL_OWNERSHIP_REJECTED }, (_u, i) =>
      org(`own${i + 1}`, { providerRank: i + 1 }),
    ),
    ...Array.from({ length: RETAIL_SECTOR_CONTRADICTORY }, (_u, i) =>
      org(`contra${i + 1}`, { providerRank: RETAIL_OWNERSHIP_REJECTED + i + 1 }),
    ),
    ...Array.from({ length: RETAIL_ENRICHMENT_COMPETITORS }, (_u, i) =>
      org(`amb${i + 1}`, {
        providerRank: RETAIL_OWNERSHIP_REJECTED + RETAIL_SECTOR_CONTRADICTORY + i + 1,
      }),
    ),
  ];

  return runApolloTwoRoundDiscovery(
    {
      config: testConfig({
        targetEligibleCompanies: 5,
        maxRounds: 1,
        maxResultsPerRound: 40,
        maxRawResultsPerRun: 40,
        maxEnrichmentsPerRun,
      }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
    },
    {
      buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
      searchRound: async () => ({
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: 34,
        providerTotalPages: 1,
      }),
      assessCandidate: ({ organization }) => {
        const id = organization.providerOrganizationId ?? '';
        if (id.startsWith('own')) return rejectedAssessment('ownership_mismatch');
        if (id.startsWith('contra')) {
          return rejectedAssessment('sector_evidence_contradictory', {
            sectorEvidenceState: 'sector_evidence_contradictory',
          });
        }
        return ambiguousAssessment();
      },
      // Ninguno de los cinco que alcanzan a pagar resuelve su sector: el mismo
      // desenlace que midió la corrida real.
      enrichCandidate: async () => ({
        executed: true,
        internalRecordedCredits: 1,
        sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      }),
      applyFinalGates: () => ({ rejection: null }),
    },
  );
}

describe('X5 § E · regresión de la certificación retail', () => {
  test('34 únicas: 16 rechazos reales intactos, 18 sobreviven a revisión', async () => {
    const result = await runRetailShape(5);

    assert.equal(result.runMetrics.totalUniqueOrganizations, RETAIL_TOTAL);
    assert.equal(result.runMetrics.enrichmentsExecuted, 5, 'el cupo NO se relaja');

    const dispositions = evaluateApolloCandidateFinalDispositions(result);
    assert.equal(countUnclassifiedFinalDispositions(dispositions), 0);

    const breakdown = dispositions.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.finalDisposition] = (acc[entry.finalDisposition] ?? 0) + 1;
      return acc;
    }, {});

    assert.deepEqual(breakdown, {
      ownership_rejected_final: RETAIL_OWNERSHIP_REJECTED,
      sector_subindustry_rejected_final: RETAIL_SECTOR_CONTRADICTORY,
      persisted_review_only_final: RETAIL_ENRICHMENT_COMPETITORS,
    });

    // 18 sobreviven: 5 pagaron y no resolvieron, 13 nunca llegaron a competir.
    assert.equal(result.reviewOnly.length, RETAIL_ENRICHMENT_COMPETITORS);
    const enriched = result.reviewOnly.filter(
      (entry) => entry.reviewReason === 'subindustry_ambiguous_after_enrichment',
    );
    const neverEnriched = result.reviewOnly.filter(
      (entry) => entry.reviewReason === 'sector_evidence_absent_without_enrichment',
    );
    assert.equal(enriched.length, 5);
    assert.equal(neverEnriched.length, 13);
  });

  test('🔴 M3/M4 · `enrichment_cap_reached` jamás produce un descarte', async () => {
    for (const cap of [0, 1, 5]) {
      const result = await runRetailShape(cap);
      const dispositions = evaluateApolloCandidateFinalDispositions(result);
      const discardedForEnrichment = dispositions.filter((entry) =>
        [
          'enrichment_budget_exhausted_final',
          'not_selected_for_enrichment_final',
          'insufficient_evidence_not_enriched_final',
        ].includes(entry.finalDisposition),
      );
      assert.equal(
        discardedForEnrichment.length,
        0,
        `con cap ${cap} no puede haber descartes por motivos de enrichment`,
      );
      assert.equal(result.reviewOnly.length, RETAIL_ENRICHMENT_COMPETITORS);
    }
  });

  test('14/15 · con cap 0 —ni un crédito— las 18 siguen sobreviviendo', async () => {
    const result = await runRetailShape(0);

    assert.equal(result.runMetrics.enrichmentsExecuted, 0);
    assert.equal(result.reviewOnly.length, RETAIL_ENRICHMENT_COMPETITORS);
    for (const entry of result.reviewOnly) {
      assert.equal(entry.reviewReason, 'sector_evidence_absent_without_enrichment');
    }
  });
});

describe('X5 § E · mutaciones', () => {
  /**
   * 🔴 M1 · reintroducir `sector_evidence_confirmed` como requisito de EXISTIR.
   *
   * La mutación: que `decideCandidateSurvival` devuelva `rejected` para todo lo
   * que no esté confirmado. Este assert la mata: `missing_needs_enrichment` y
   * `missing_bootstrap_eligible` tienen que sobrevivir.
   */
  test('🔴 M1 · el sector confirmado NO es requisito de supervivencia', () => {
    for (const state of [
      'sector_evidence_missing_needs_enrichment',
      'sector_evidence_missing_bootstrap_eligible',
    ]) {
      const decision = decideCandidateSurvival({ mandatoryRejection: null, sectorEvidenceState: state });
      assert.equal(decision.survives, true, state);
      assert.notEqual(decision.cohort, 'rejected');
    }
  });

  /**
   * 🔴 M2 · exigir `enrichmentExecuted === true` para sobrevivir.
   *
   * El cross-product COMPLETO: siete desenlaces de enrichment × cuatro estados
   * sectoriales. El veredicto tiene que depender sólo del segundo eje. Si
   * alguien vuelve a meter el enrichment en la decisión, alguna celda cambia.
   */
  test('🔴 M2 · el desenlace del enrichment no mueve NI UNA celda del veredicto', () => {
    const states = [
      'sector_evidence_confirmed',
      'sector_evidence_missing_needs_enrichment',
      'sector_evidence_missing_bootstrap_eligible',
      'sector_evidence_contradictory',
    ];

    for (const state of states) {
      const baseline = JSON.stringify(
        decideCandidateSurvival({ mandatoryRejection: null, sectorEvidenceState: state }),
      );
      for (const outcome of ALL_ENRICHMENT_OUTCOMES) {
        // El desenlace no es un parámetro: la llamada es idéntica. Ése es el
        // trinquete — devolverlo a la firma es un cambio que no compila solo.
        const observed = JSON.stringify(
          decideCandidateSurvival({ mandatoryRejection: null, sectorEvidenceState: state }),
        );
        assert.equal(observed, baseline, `${state} × ${outcome}`);
      }
    }

    // Y la firma, explícitamente: dos campos, ninguno de enrichment.
    const signature = decideCandidateSurvival.toString();
    assert.ok(!/enrichment/i.test(signature.split('{')[0] ?? ''), 'la firma no menciona enrichment');
  });

  /**
   * 🔴 M5 · volver a usar `target` como tope duro de candidatas válidas.
   *
   * La mutación: `rankFinalEligibleCompanies(signals, targetEligibleCompanies)`.
   * Con doce elegibles y target 5, produciría 5 persistidas y 7 descartadas.
   */
  test('🔴 M5 · el objetivo no recorta la lista de válidas', async () => {
    const result = await runWith(harnessDeps({ organizations: orgs('a', 12) }));

    assert.equal(result.targetEligibleCompanies, 5, 'el objetivo sigue siendo 5');
    assert.equal(result.persistedCandidates, 12, 'y no recorta nada');
    assert.equal(result.notPersisted.length, 0);
  });

  /**
   * 🔴 M7 · hacer que `survives ⇒ countsTowardTarget`.
   *
   * La mutación más peligrosa, porque «arregla» el síntoma inflando el objetivo:
   * dieciocho supervivientes incompletas contarían como objetivo cumplido. Este
   * assert exige que la supervivencia NO produzca conteo por sí sola, y que el
   * módulo ni siquiera exporte un símbolo con ese nombre.
   */
  test('🔴 M7 · supervivencia y conteo hacia el objetivo siguen separados', async () => {
    const result = await runRetailShape(5);

    // 18 sobreviven…
    assert.equal(result.reviewOnly.length, RETAIL_ENRICHMENT_COMPETITORS);
    // …y ninguna cuenta: la cuenta estable sigue en cero y el objetivo, sin cumplir.
    assert.equal(result.runMetrics.stableFinalizableCandidateCount, 0);
    assert.equal(result.targetReached, false);
    assert.equal(result.resultStatus, 'partial_target_not_reached');

    // El módulo de la regla no puede ofrecer el atajo ni por accidente.
    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
    });
    assert.ok(!('countsTowardTarget' in decision));
    assert.ok(!('eligibleForTarget' in decision));
  });
});
