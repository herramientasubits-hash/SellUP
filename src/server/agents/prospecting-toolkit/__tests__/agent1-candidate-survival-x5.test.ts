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
 * Reconstrucción de la FORMA REAL de la corrida `c7c28980…`, leída de
 * `prospect_discarded_dispositions` en Producción (read-only, 0 escrituras).
 * No se backfillea ni se altera el histórico: lo que se fija es lo que el
 * orquestador decidiría HOY con esas mismas 34 entradas.
 *
 * El desglose exacto, con `enrichment_attempted` incluido — importa, porque
 * distingue quién murió ANTES de competir de quién murió DESPUÉS de pagar:
 *
 *    8  invalid_domain          · sin enrichment  ← gate BARATO
 *    3  ownership_mismatch      · sin enrichment  ← gate BARATO
 *    4  ownership_mismatch      · ENRIQUECIDAS    ← gate FINAL, tras pagar
 *    1  sector_evidence_contradictory · ENRIQUECIDA ← evidencia EN CONTRA
 *   18  enrichment_cap_reached  · sin enrichment
 *   ──
 *   34  únicas · 5 enrichments ejecutados · 0 candidatas creadas
 *
 * De ahí sale la cifra que este corte tiene que cambiar y las que no:
 *
 *   · 16 rechazos con causa REAL (11 baratos + 4 ownership final + 1 sector)
 *   · 18 supervivientes, y las dieciocho SIN haber sido enriquecidas nunca
 *   · de las 5 que SÍ pagaron, ninguna sobrevive — las cinco tenían un gate
 *     obligatorio en contra, y eso no lo toca este corte
 *
 * Nótese que el desglose por DISPOSICIÓN agrupa los 8 + 3 + 4 en un solo cubo
 * `ownership_rejected_final` = 15, que es como la corrida real lo publicó.
 */
/** Gate BARATO: Apollo no devolvió dominio. Nunca compitieron. */
const RETAIL_CHEAP_INVALID_DOMAIN = 8;
/** Gate BARATO: el dominio no acredita a la empresa. Nunca compitieron. */
const RETAIL_CHEAP_OWNERSHIP = 3;
/** Compitieron, PAGARON, y el gate FINAL de ownership las rechazó. */
const RETAIL_ENRICHED_THEN_OWNERSHIP_REJECTED = 4;
/** Compitió, PAGÓ, y volvió con evidencia sectorial EN CONTRA. */
const RETAIL_ENRICHED_THEN_CONTRADICTORY = 1;
/** Pasaron los gates obligatorios y el cupo se agotó antes de que les tocara. */
const RETAIL_ENRICHMENT_COMPETITORS = 18;

const RETAIL_OWNERSHIP_REJECTED =
  RETAIL_CHEAP_INVALID_DOMAIN + RETAIL_CHEAP_OWNERSHIP + RETAIL_ENRICHED_THEN_OWNERSHIP_REJECTED;
const RETAIL_SECTOR_CONTRADICTORY = RETAIL_ENRICHED_THEN_CONTRADICTORY;
const RETAIL_ENRICHMENTS_EXECUTED =
  RETAIL_ENRICHED_THEN_OWNERSHIP_REJECTED + RETAIL_ENRICHED_THEN_CONTRADICTORY;
const RETAIL_TOTAL = RETAIL_OWNERSHIP_REJECTED + RETAIL_SECTOR_CONTRADICTORY + RETAIL_ENRICHMENT_COMPETITORS;

/**
 * Los cinco papeles de la corrida real. El id lleva el papel para que el arnés
 * no tenga que mantener una tabla aparte.
 */
function retailOrganizations() {
  const roles: string[] = [
    ...Array.from({ length: RETAIL_CHEAP_INVALID_DOMAIN }, () => 'cheap_invalid_domain'),
    ...Array.from({ length: RETAIL_CHEAP_OWNERSHIP }, () => 'cheap_ownership'),
    ...Array.from({ length: RETAIL_ENRICHED_THEN_OWNERSHIP_REJECTED }, () => 'paid_ownership'),
    ...Array.from({ length: RETAIL_ENRICHED_THEN_CONTRADICTORY }, () => 'paid_contradictory'),
    ...Array.from({ length: RETAIL_ENRICHMENT_COMPETITORS }, () => 'capped'),
  ];
  return roles.map((role, index) => org(`${role}_${index + 1}`, { providerRank: index + 1 }));
}

const roleOf = (candidateKeyOrId: string): string =>
  candidateKeyOrId.replace('apollo:', '').replace(/_\d+$/, '');

/**
 * Reproduce la corrida con `maxEnrichmentsPerRun` configurable.
 *
 * Las cinco que en la realidad pagaron llevan señal sectorial libre (`3`) para
 * ganar el ranking de enrichment; las dieciocho del cap llevan `0`, igual que
 * `ambiguousAssessment` por defecto. Así el cupo se lo llevan exactamente las
 * mismas cinco que se lo llevaron en Producción, y no un sorteo del fixture.
 */
async function runRetailShape(maxEnrichmentsPerRun: number) {
  const organizations = retailOrganizations();

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
        internalRecordedCredits: RETAIL_TOTAL,
        providerTotalPages: 1,
      }),
      assessCandidate: ({ organization }) => {
        switch (roleOf(organization.providerOrganizationId ?? '')) {
          case 'cheap_invalid_domain':
            return rejectedAssessment('invalid_domain');
          case 'cheap_ownership':
            return rejectedAssessment('ownership_mismatch');
          // Las que compitieron llegan LIMPIAS al gate barato: su ownership se
          // resolvió después, en el gate final, y su sector estaba sin demostrar.
          case 'paid_ownership':
          case 'paid_contradictory': {
            const base = ambiguousAssessment();
            return { ...base, signals: { ...base.signals, sectorKeywordMatchCount: 3 } };
          }
          default:
            return ambiguousAssessment();
        }
      },
      enrichCandidate: async ({ candidateKey }) => ({
        executed: true,
        internalRecordedCredits: 1,
        sectorEvidenceState:
          roleOf(candidateKey) === 'paid_contradictory'
            ? 'sector_evidence_contradictory'
            : 'sector_evidence_missing_needs_enrichment',
      }),
      // El gate FINAL de ownership, que en la corrida real rechazó a cuatro
      // DESPUÉS de que Apollo ya les hubiera cobrado el enrichment.
      applyFinalGates: ({ candidateKey }) => ({
        rejection: roleOf(candidateKey) === 'paid_ownership' ? ('ownership_mismatch' as const) : null,
      }),
    },
  );
}

describe('X5 § E · regresión de la certificación retail', () => {
  test('34 únicas: 16 rechazos reales intactos, 18 sobreviven a revisión', async () => {
    const result = await runRetailShape(5);

    assert.equal(result.runMetrics.totalUniqueOrganizations, RETAIL_TOTAL, '34 únicas');
    assert.equal(
      result.runMetrics.enrichmentsExecuted,
      RETAIL_ENRICHMENTS_EXECUTED,
      'cinco enrichments, los mismos cinco que pagó la corrida real',
    );

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

    // Las 18 supervivientes son EXACTAMENTE las del cap, y las dieciocho
    // llegan sin haber sido enriquecidas nunca: en la corrida real, de las cinco
    // que sí pagaron no sobrevivió ninguna —cuatro cayeron en el gate final de
    // ownership y una volvió con evidencia sectorial en contra— y este corte no
    // toca ni una de esas cinco.
    assert.equal(result.reviewOnly.length, RETAIL_ENRICHMENT_COMPETITORS);
    for (const entry of result.reviewOnly) {
      assert.equal(entry.reviewReason, 'sector_evidence_absent_without_enrichment');
    }

    // 🔴 Y el conteo hacia el objetivo NO se mueve: 18 sobreviven, 0 cuentan.
    assert.equal(result.runMetrics.stableFinalizableCandidateCount, 0);
    assert.equal(result.targetReached, false);
  });

  test('los 5 que PAGARON siguen rechazados: 4 por ownership final, 1 por sector', async () => {
    const result = await runRetailShape(5);
    const dispositions = evaluateApolloCandidateFinalDispositions(result);
    const byKey = new Map(dispositions.map((entry) => [entry.candidateKey, entry]));

    const paidOwnership = dispositions.filter(
      (entry) => roleOf(entry.candidateKey) === 'paid_ownership',
    );
    assert.equal(paidOwnership.length, RETAIL_ENRICHED_THEN_OWNERSHIP_REJECTED);
    for (const entry of paidOwnership) {
      assert.equal(entry.finalDisposition, 'ownership_rejected_final');
      assert.equal(entry.finalReason, 'ownership_mismatch');
    }

    const contradictory = dispositions.filter(
      (entry) => roleOf(entry.candidateKey) === 'paid_contradictory',
    );
    assert.equal(contradictory.length, RETAIL_ENRICHED_THEN_CONTRADICTORY);
    assert.equal(contradictory[0]?.finalDisposition, 'sector_subindustry_rejected_final');

    // Haber pagado no salva a nadie, igual que no haber pagado no condena.
    for (const entry of [...paidOwnership, ...contradictory]) {
      assert.ok(!byKey.get(entry.candidateKey) || entry.finalReason !== null);
    }
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
      // Con cap 5 sobreviven las 18 del cap. Con cap 0 o 1 sobreviven ADEMÁS
      // las que en la realidad pagaron y fueron rechazadas por lo que el
      // enrichment reveló: sin comprar esa evidencia, la contradicción no
      // existe todavía. Nunca MENOS de 18: el cupo no puede quitar
      // supervivientes.
      assert.ok(
        result.reviewOnly.length >= RETAIL_ENRICHMENT_COMPETITORS,
        `con cap ${cap} sobrevivieron ${result.reviewOnly.length}`,
      );
    }
  });

  test('14/15 · con cap 0 —ni un crédito— las 18 siguen sobreviviendo', async () => {
    const result = await runRetailShape(0);

    assert.equal(result.runMetrics.enrichmentsExecuted, 0, 'ni un crédito');
    // Las 18 del cap sobreviven sin que se gaste NADA: el arreglo es semántico,
    // no presupuestario.
    assert.ok(result.reviewOnly.length >= RETAIL_ENRICHMENT_COMPETITORS);
    for (const entry of result.reviewOnly) {
      assert.equal(entry.reviewReason, 'sector_evidence_absent_without_enrichment');
    }

    // Y los gates OBLIGATORIOS siguen rechazando sin necesidad de comprar nada:
    // los once baratos y los cuatro del gate final de ownership.
    const dispositions = evaluateApolloCandidateFinalDispositions(result);
    const ownershipRejected = dispositions.filter(
      (entry) => entry.finalDisposition === 'ownership_rejected_final',
    );
    assert.equal(ownershipRejected.length, RETAIL_OWNERSHIP_REJECTED);

    // 🔴 La única que cambia de desenlace sin enrichment es la contradictoria:
    // sin comprar la evidencia, la contradicción no se conoce. No se inventa un
    // rechazo por lo que el proveedor PODRÍA haber dicho.
    const contradictory = dispositions.filter(
      (entry) => roleOf(entry.candidateKey) === 'paid_contradictory',
    );
    assert.equal(contradictory[0]?.finalDisposition, 'persisted_review_only_final');
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
   * 🔴 M7 (ruta de producción) · guarda ESTÁTICA sobre `targetReached`.
   *
   * El defecto que este assert fija apareció AL HACER el corte, y es el mismo
   * error una capa más arriba: `production-runner.server.ts` decidía
   * `targetReached` comparando `candidatesCreated` —TODAS las filas, incluidas
   * las `needs_review`— contra el objetivo. Mientras la cohorte de revisión era
   * casi vacía la cuenta pasaba por buena; al dejar de descartar a quien nunca
   * pudo competir por un enrichment, una corrida con objetivo 6, cuatro
   * enrichments y CERO candidatas completas se declaraba cumplida.
   *
   * La autoridad tiene que ser `completeValidCandidates`, que el writer calcula
   * con el contrato canónico. Un test de comportamiento no basta: el arnés de
   * esa ruta usa un writer doble que no mide completitud, así que la comparación
   * defectuosa vuelve a pasar desapercibida. Ésta sí la ve.
   */
  test('🔴 M7-prod · `targetReached` no puede leerse de las filas creadas', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, '..', 'apollo-two-round', 'production-runner.server.ts'),
      'utf8',
    );
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

    assert.ok(
      withoutComments.includes('completeValidCandidates'),
      'la decisión del objetivo tiene que leer la cuenta de completas del writer',
    );
    assert.ok(
      !/targetReached:[\s\S]{0,200}?candidatesCreated\s*>=/.test(withoutComments),
      '`targetReached` no puede comparar `candidatesCreated` contra el objetivo: ' +
        'esas filas incluyen las needs_review',
    );
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
