/**
 * AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 2B — MIXED-MODE ANY-OF PREFLIGHT.
 *
 * Qué prueba y qué NO.
 *
 * SÍ: que cuando una selección multi-subindustria mezcla los DOS modos —una regla
 * `full` y una `confirm_only`— el resultado ECONÓMICO es seguro. «Seguro» aquí son
 * cuatro afirmaciones concretas, y cada una tiene su prueba:
 *
 *   1. el modo se aplica POR SUBINDUSTRIA PEDIDA, no globalmente según quién gane;
 *   2. la agregación operativa ANY-OF es invariante al orden de la petición;
 *   3. una `confirm_only` NEGATIVA (`ambiguous`/`rejected`) tiene efecto económico
 *      CERO: el resultado es exactamente el que habría sin ella;
 *   4. una `confirm_only` CONFIRMADA sí satisface el ANY-OF, incluso si la otra
 *      subindustria pedida quedó rechazada por una regla `full`.
 *
 * Y que nada de eso se comprueba sólo sobre el objeto de assessment: cada
 * permutación se compara sobre la ECONOMÍA aguas abajo —pliegue sectorial,
 * elegibilidad, completitud y conteo al objetivo—, que es donde el defecto costaría
 * dinero.
 *
 * NO: Ola 1. Las dos reglas que se ejercitan aquí son TEST-ONLY y se inyectan; el
 * registro de producción sigue siendo EXACTAMENTE 2, ambas `full`, y la cobertura
 * sigue siendo 2 de 73. El § 15 de esta suite lo ratchetea.
 *
 * Cero red, cero base de datos, cero proveedor, cero crédito. Fixtures sintéticas.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  assessApolloSubindustryPrecisionForRequest,
  listSubindustryPrecisionRuleSets,
  projectOperationalSubindustryVerdict,
  type ApolloSubindustryPrecisionAssessment,
  type SubindustryPrecisionRuleSet,
} from '../apollo-subindustry-precision';
import {
  evaluateCandidateSubindustryTargetEligibility,
  resolveCandidateSubindustryRequirement,
} from '../candidate-completeness-contract';
import { foldSubindustryPrecisionIntoSectorState } from '../apollo-two-round/production-runner.server';
import type { WebSearchResult } from '../types';

// ─── Reglas TEST-ONLY (§ 3 del encargo) ───────────────────────────────────────
//
// Vocabularios DISJUNTOS a propósito: así el veredicto de cada regla se controla
// por separado sobre el MISMO resultado, y una permutación no puede pasar por
// casualidad porque las dos reglas leyeran el mismo término.
//
// No se declara `industry` en ninguna fixture: la industria declarada es el único
// campo compartido, y dejarlo fuera mantiene la independencia.

const FULL_A: SubindustryPrecisionRuleSet = {
  key: 'alfa modo completo',
  canonicalName: 'Alfa Modo Completo',
  subindustryId: null,
  precisionAliases: [],
  mode: 'full',
  catalogVersionId: null,
  anchors: ['ancla alfa'],
  anchorFamilies: null,
  exclusiveBusinessModels: ['excluyente alfa'],
  conflictingBusinessModels: ['conflicto alfa'],
  broadProviderIndustries: ['amplia alfa'],
  contradictoryProviderIndustries: ['contradice alfa'],
};

const CONFIRM_ONLY_B: SubindustryPrecisionRuleSet = {
  ...FULL_A,
  key: 'beta solo confirma',
  canonicalName: 'Beta Solo Confirma',
  mode: 'confirm_only',
  anchors: ['ancla beta'],
  exclusiveBusinessModels: ['excluyente beta'],
  conflictingBusinessModels: ['conflicto beta'],
  broadProviderIndustries: ['amplia beta'],
  contradictoryProviderIndustries: ['contradice beta'],
};

const A = FULL_A.canonicalName;
const B = CONFIRM_ONLY_B.canonicalName;
/** Etiqueta pedida SIN regla en el registro: «sin mapeo», que no es abstención. */
const UNMAPPED = 'Gamma Sin Registrar';

const withMixed = { ruleSets: [...listSubindustryPrecisionRuleSets(), FULL_A, CONFIRM_ONLY_B] };

type Verdict = 'confirmed' | 'ambiguous' | 'rejected';

/** Término que fuerza `verdict` en la regla dada, sobre los campos clasificadores. */
function term(ruleSet: SubindustryPrecisionRuleSet, verdict: Verdict): string[] {
  if (verdict === 'confirmed') return [ruleSet.anchors[0]];
  if (verdict === 'rejected') return [ruleSet.exclusiveBusinessModels[0]];
  return []; // `ambiguous`: ni ancla ni modelo excluyente — caso 5 del evaluador.
}

function resultFor(verdictA: Verdict, verdictB: Verdict): WebSearchResult {
  return {
    title: `Caso ${verdictA}/${verdictB}`,
    url: 'https://example.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata: { keywords: [...term(FULL_A, verdictA), ...term(CONFIRM_ONLY_B, verdictB)] },
  } as unknown as WebSearchResult;
}

function assess(
  verdictA: Verdict,
  verdictB: Verdict,
  requested: readonly string[],
): ApolloSubindustryPrecisionAssessment {
  return assessApolloSubindustryPrecisionForRequest(
    resultFor(verdictA, verdictB),
    requested,
    withMixed,
  );
}

// ─── La economía, no el assessment (§ 11 del encargo) ─────────────────────────

const BASE_SECTOR_STATES = [
  'sector_evidence_confirmed',
  'sector_not_mapped',
  'sector_evidence_contradictory',
  'sector_evidence_missing_needs_enrichment',
] as const;

/**
 * TODO lo que una subindustria puede mover aguas abajo, en un solo objeto.
 *
 * Deliberadamente NO incluye `precisionMode` ni `matchedRequestedSubindustry`: son
 * diagnóstico y su desempate sigue el orden pedido. Que estén fuera de esta tupla
 * es la afirmación de esta suite, no un olvido — los §§ 12 y 13 los prueban aparte.
 */
function economics(assessment: ApolloSubindustryPrecisionAssessment, requested: string[]) {
  const operational = projectOperationalSubindustryVerdict(assessment, withMixed);
  const requirement = resolveCandidateSubindustryRequirement({
    sectorEvidenceState: 'sector_evidence_confirmed',
    requestedSubindustries: requested,
    subindustryPrecision: assessment,
  });
  const eligibility = evaluateCandidateSubindustryTargetEligibility({
    persistenceSuccess: true,
    sectorEvidenceState: 'sector_evidence_confirmed',
    requestedSubindustries: requested,
    subindustryPrecision: assessment,
    employeeCountStatus: 'confirmed',
    linkedinStatus: 'confirmed',
    duplicateStatus: 'no_match',
    ownershipGate: 'pass',
    qualityGate: 'pass',
  });

  return {
    // Veredicto operativo: los DOS campos que deciden, sin el modo.
    subindustryOperationalMapped: operational.subindustryMapped,
    subindustryOperationalState: operational.subindustryMatch,
    // Pliegue sectorial desde cada estado base — es lo que decide rechazo
    // definitivo (`sector_evidence_contradictory`) y prioridad de enrichment
    // (`sector_evidence_missing_needs_enrichment`).
    sectorState: BASE_SECTOR_STATES.map(
      (base) => `${base}→${foldSubindustryPrecisionIntoSectorState(base, assessment, withMixed)}`,
    ),
    // Persistencia y objetivo.
    persistenceEligibility: requirement.eligibilityVerdict,
    subindustryRequirementApplied: requirement.subindustryRequirementApplied,
    completeValid: eligibility.completeValid,
    countsTowardTarget: eligibility.countsTowardTarget,
    reviewOnly: eligibility.reviewOnly,
    failedConditions: [...eligibility.failedConditions].sort(),
  };
}

/** Enrichment: el único estado que convoca un enrichment por precisión. */
function createsEnrichmentPriority(assessment: ApolloSubindustryPrecisionAssessment): boolean {
  return (
    foldSubindustryPrecisionIntoSectorState(
      'sector_evidence_confirmed',
      assessment,
      withMixed,
    ) === 'sector_evidence_missing_needs_enrichment'
  );
}

/** Rechazo definitivo: el candidato no se persiste. */
function causesDefinitiveRejection(assessment: ApolloSubindustryPrecisionAssessment): boolean {
  return BASE_SECTOR_STATES.some(
    (base) =>
      base !== 'sector_evidence_contradictory' &&
      foldSubindustryPrecisionIntoSectorState(base, assessment, withMixed) ===
        'sector_evidence_contradictory',
  );
}

// ─── § 0 · las fixtures hacen lo que dicen ────────────────────────────────────

describe('§ 0 · las reglas TEST-ONLY producen los nueve veredictos por separado', () => {
  test('cada regla responde SÓLO a su vocabulario', () => {
    const verdicts: Verdict[] = ['confirmed', 'ambiguous', 'rejected'];
    for (const va of verdicts) {
      for (const vb of verdicts) {
        const [evalA, evalB] = assess(va, vb, [A, B]).perRequestedSubindustryEvaluations;
        assert.equal(evalA.requestedSubindustry, A);
        assert.equal(evalA.subindustryMatch, va, `A en ${va}/${vb}`);
        assert.equal(evalA.subindustryMapped, true);
        assert.equal(evalB.requestedSubindustry, B);
        assert.equal(evalB.subindustryMatch, vb, `B en ${va}/${vb}`);
        assert.equal(evalB.subindustryMapped, true);
      }
    }
  });

  test('ninguna de las dos está en el registro de producción', () => {
    const production = listSubindustryPrecisionRuleSets();
    for (const ruleSet of [FULL_A, CONFIRM_ONLY_B]) {
      assert.equal(
        production.some((entry) => entry.key === ruleSet.key),
        false,
      );
    }
  });
});

// ─── § 2 · el modo se aplica POR SUBINDUSTRIA, no según el ganador ────────────

describe('§ 2 · el modo es POR PETICIÓN, no global del ganador', () => {
  test('el modo de la regla GANADORA no se aplica a las demás', () => {
    // A (`full`) rechaza; B (`confirm_only`) confirma. B gana el ANY-OF.
    //
    // Si el modo del ganador rigiera globalmente, el `rejected` de A se leería en
    // modo `confirm_only` —dejaría de contribuir— y el resultado sería `confirmed`
    // por vía distinta. Y al revés: con A ganando, el `ambiguous` de B se leería
    // en `full` y degradaría. Las dos lecturas se comprueban abajo por separado.
    const winnerIsConfirmOnly = assess('rejected', 'confirmed', [A, B]);
    assert.equal(
      projectOperationalSubindustryVerdict(winnerIsConfirmOnly, withMixed).precisionMode,
      'confirm_only',
    );

    // El caso que delata un modo global: A `full` ambigua gana, B `confirm_only`
    // rechazada pierde. Con modo global `full`, el `rejected` de B contribuiría y
    // el pliegue sería `sector_evidence_contradictory`. Es `ambiguous`.
    const winnerIsFull = assess('ambiguous', 'rejected', [A, B]);
    const operational = projectOperationalSubindustryVerdict(winnerIsFull, withMixed);
    assert.equal(operational.precisionMode, 'full');
    assert.equal(operational.subindustryMatch, 'ambiguous');
    assert.equal(causesDefinitiveRejection(winnerIsFull), false);
  });

  test('cada evaluación conserva su propia identidad, siempre', () => {
    for (const requested of [
      [A, B],
      [B, A],
    ]) {
      const evaluations = assess('confirmed', 'rejected', requested)
        .perRequestedSubindustryEvaluations.map(
          (item) => `${item.requestedSubindustry}=${item.subindustryMatch}`,
        )
        .sort();
      assert.deepEqual(evaluations, [`${A}=confirmed`, `${B}=rejected`]);
    }
  });
});

// ─── §§ 4–10 · las siete permutaciones, sobre la economía ─────────────────────

type Scenario = {
  section: string;
  name: string;
  a: Verdict;
  b: Verdict;
  labelA: string;
  labelB: string;
  /** Estado operativo esperado, idéntico en los dos órdenes. */
  operational: Verdict;
  operationalMapped: boolean;
  /** Con qué petición de UNA sola subindustria debe coincidir la economía. */
  equivalentTo: readonly string[] | null;
};

const SCENARIOS: Scenario[] = [
  {
    section: '§ 4',
    name: 'full confirmada + confirm_only ambigua',
    a: 'confirmed',
    b: 'ambiguous',
    labelA: A,
    labelB: B,
    operational: 'confirmed',
    operationalMapped: true,
    equivalentTo: [A],
  },
  {
    section: '§ 5',
    name: 'full rechazada + confirm_only confirmada',
    a: 'rejected',
    b: 'confirmed',
    labelA: A,
    labelB: B,
    operational: 'confirmed',
    operationalMapped: true,
    // NO equivale a ninguna sola: es el ANY-OF haciendo su trabajo. B satisface
    // el requisito pese al rechazo de A.
    equivalentTo: null,
  },
  {
    section: '§ 6',
    name: 'full ambigua + confirm_only rechazada',
    a: 'ambiguous',
    b: 'rejected',
    labelA: A,
    labelB: B,
    operational: 'ambiguous',
    operationalMapped: true,
    equivalentTo: [A],
  },
  {
    section: '§ 7',
    name: 'full rechazada + confirm_only ambigua',
    a: 'rejected',
    b: 'ambiguous',
    labelA: A,
    labelB: B,
    operational: 'rejected',
    operationalMapped: true,
    equivalentTo: [A],
  },
  {
    section: '§ 8',
    name: 'confirm_only ambigua + sin mapeo',
    a: 'ambiguous',
    b: 'ambiguous',
    labelA: B,
    labelB: UNMAPPED,
    operational: 'ambiguous',
    operationalMapped: false,
    equivalentTo: [UNMAPPED],
  },
  {
    section: '§ 9',
    name: 'confirm_only rechazada + sin mapeo',
    a: 'ambiguous',
    b: 'rejected',
    labelA: UNMAPPED,
    labelB: B,
    operational: 'ambiguous',
    operationalMapped: false,
    equivalentTo: [UNMAPPED],
  },
  {
    section: '§ 10',
    name: 'dos confirm_only negativas',
    a: 'ambiguous',
    b: 'rejected',
    labelA: B,
    labelB: B,
    operational: 'ambiguous',
    operationalMapped: false,
    equivalentTo: null,
  },
];

describe('§§ 4–10 · la economía de cada permutación es invariante al orden', () => {
  for (const scenario of SCENARIOS) {
    // El § 10 pide DOS `confirm_only`; con una sola regla sintética se piden dos
    // veredictos a la vez sobre la misma, así que se ejercita con el par
    // (`confirm_only` negativa, `confirm_only` negativa) que la normalización de
    // etiquetas deduplica. Se cubre en su propia prueba, abajo.
    if (scenario.labelA === scenario.labelB) continue;

    test(`${scenario.section} · ${scenario.name}`, () => {
      const forward = [scenario.labelA, scenario.labelB];
      const reverse = [scenario.labelB, scenario.labelA];
      const ab = assess(scenario.a, scenario.b, forward);
      const ba = assess(scenario.a, scenario.b, reverse);

      const economicsAB = economics(ab, forward);
      const economicsBA = economics(ba, reverse);

      // 1. ORDER-INVARIANT sobre toda la tupla económica, no sólo sobre el estado.
      assert.deepEqual(economicsAB, economicsBA, `${scenario.section} AB≠BA`);

      // 2. El estado operativo es el declarado.
      assert.equal(economicsAB.subindustryOperationalState, scenario.operational);
      assert.equal(economicsAB.subindustryOperationalMapped, scenario.operationalMapped);

      // 3. Y coincide con la petición de UNA sola, cuando el escenario lo exige:
      //    es la forma directa de decir «la otra regla tuvo efecto CERO».
      if (scenario.equivalentTo !== null) {
        const alone = [...scenario.equivalentTo];
        assert.deepEqual(
          economicsAB,
          economics(assess(scenario.a, scenario.b, alone), alone),
          `${scenario.section} ≠ ${alone.join('')} sola`,
        );
      }
    });
  }

  test('§ 10 · dos confirm_only negativas: efecto operativo nulo, diagnóstico vivo', () => {
    // Dos reglas `confirm_only` distintas, ambas negativas: una ambigua y otra
    // rechazada. Se construye una segunda regla sintética para no depender de la
    // deduplicación de etiquetas.
    const CONFIRM_ONLY_C: SubindustryPrecisionRuleSet = {
      ...CONFIRM_ONLY_B,
      key: 'delta solo confirma',
      canonicalName: 'Delta Solo Confirma',
      anchors: ['ancla delta'],
      exclusiveBusinessModels: ['excluyente delta'],
    };
    const C = CONFIRM_ONLY_C.canonicalName;
    const options = { ruleSets: [...withMixed.ruleSets, CONFIRM_ONLY_C] };
    const search = {
      title: 'Dos confirm_only negativas',
      url: 'https://example.test',
      snippet: null,
      rank: 1,
      source: 'apollo_organizations',
      // B ambigua (sin término suyo), C rechazada (su modelo excluyente).
      metadata: { keywords: [CONFIRM_ONLY_C.exclusiveBusinessModels[0]] },
    } as unknown as WebSearchResult;

    for (const requested of [
      [B, C],
      [C, B],
    ]) {
      const assessment = assessApolloSubindustryPrecisionForRequest(search, requested, options);

      // Diagnóstico: las DOS observaciones sobreviven.
      assert.deepEqual(
        assessment.perRequestedSubindustryEvaluations
          .map((item) => `${item.requestedSubindustry}=${item.subindustryMatch}`)
          .sort(),
        [`${B}=ambiguous`, `${C}=rejected`].sort(),
      );

      // Operativo: base/no-op, en los dos órdenes.
      assert.deepEqual(projectOperationalSubindustryVerdict(assessment, options), {
        subindustryMapped: false,
        subindustryMatch: 'ambiguous',
        precisionMode: null,
      });
      for (const base of BASE_SECTOR_STATES) {
        assert.equal(foldSubindustryPrecisionIntoSectorState(base, assessment, options), base);
      }
    }
  });
});

// ─── El defecto concreto que este preflight encontró ──────────────────────────

describe('§ 7 · una confirm_only negativa NO puede cancelar un rechazo `full`', () => {
  test('el rechazo definitivo de la regla `full` sobrevive a la compañía', () => {
    // Éste es el defecto real que el preflight destapó: la rama negativa de una
    // `confirm_only` devolvía «sin mapeo, ambigua», que es un PARTICIPANTE del
    // ANY-OF —y por precedencia una duda sin mapeo (20) gana a un rechazo mapeado
    // (11)—. Resultado medido antes del arreglo: `sector_evidence_contradictory`
    // (rechazo definitivo, candidato no persistido) se convertía en
    // `sector_evidence_confirmed` sólo por pedir la subindustria sin calibrar al
    // lado. Ahora la regla se ABSTIENE y no participa.
    const alone = assess('rejected', 'ambiguous', [A]);
    assert.equal(causesDefinitiveRejection(alone), true);

    for (const requested of [
      [A, B],
      [B, A],
    ]) {
      const together = assess('rejected', 'ambiguous', requested);
      assert.equal(
        causesDefinitiveRejection(together),
        true,
        `la confirm_only canceló el rechazo en [${requested.join(' | ')}]`,
      );
      assert.equal(
        foldSubindustryPrecisionIntoSectorState('sector_evidence_confirmed', together, withMixed),
        'sector_evidence_contradictory',
      );
    }
  });

  test('«sin mapeo» SÍ sigue participando: el ANY-OF histórico no cambia', () => {
    // La contracara. Una etiqueta pedida sin regla no es una abstención: es un
    // hecho sobre la petición, y rescatar del rechazo ANY-OF es el comportamiento
    // de siempre entre reglas `full`. Cambiarlo habría movido producción.
    const together = assess('rejected', 'ambiguous', [A, UNMAPPED]);
    assert.equal(causesDefinitiveRejection(together), false);
    assert.equal(
      projectOperationalSubindustryVerdict(together, withMixed).subindustryMapped,
      false,
    );
  });

  test('ninguna rama negativa de `confirm_only` crea prioridad de enrichment', () => {
    for (const negative of ['ambiguous', 'rejected'] as const) {
      for (const requested of [
        [B],
        [B, UNMAPPED],
        [UNMAPPED, B],
      ]) {
        const assessment = assess('ambiguous', negative, requested);
        assert.equal(
          createsEnrichmentPriority(assessment),
          false,
          `${negative} en [${requested.join(' | ')}]`,
        );
        assert.equal(causesDefinitiveRejection(assessment), false);
      }
    }
  });
});

describe('§ 5 · una confirm_only CONFIRMADA satisface el ANY-OF', () => {
  test('confirma aunque la regla `full` de al lado haya rechazado', () => {
    for (const requested of [
      [A, B],
      [B, A],
    ]) {
      const assessment = assess('rejected', 'confirmed', requested);
      const eligibility = evaluateCandidateSubindustryTargetEligibility({
        persistenceSuccess: true,
        sectorEvidenceState: 'sector_evidence_confirmed',
        requestedSubindustries: requested,
        subindustryPrecision: assessment,
        employeeCountStatus: 'confirmed',
        linkedinStatus: 'confirmed',
        duplicateStatus: 'no_match',
        ownershipGate: 'pass',
        qualityGate: 'pass',
      });
      assert.equal(eligibility.subindustryMatch, 'confirmed');
      assert.equal(eligibility.completeValid, true);
      assert.equal(eligibility.countsTowardTarget, true);
      assert.equal(eligibility.subindustryBlockingReason, null);
      // La atribución nombra a B: es la que confirmó.
      assert.equal(eligibility.matchedRequestedSubindustry, B);
    }
  });
});

// ─── § 12 y § 13 · lo diagnóstico, declarado y acotado ────────────────────────

describe('§ 12–13 · el diagnóstico puede depender del orden; la economía no', () => {
  test('ante EMPATE, `matchedRequestedSubindustry` sigue el orden — y nada más', () => {
    // Las dos confirman: empate de precedencia. La atribución sigue el orden
    // pedido, que es el contrato histórico desde #241/#251.
    const ab = assess('confirmed', 'confirmed', [A, B]);
    const ba = assess('confirmed', 'confirmed', [B, A]);
    assert.equal(ab.matchedRequestedSubindustry, A);
    assert.equal(ba.matchedRequestedSubindustry, B);
    assert.equal(projectOperationalSubindustryVerdict(ab, withMixed).precisionMode, 'full');
    assert.equal(
      projectOperationalSubindustryVerdict(ba, withMixed).precisionMode,
      'confirm_only',
    );

    // Y sin embargo la economía es idéntica, término por término.
    assert.deepEqual(economics(ab, [A, B]), economics(ba, [B, A]));
  });

  test('límite declarado: el MOTIVO de revisión sigue al diagnóstico, no al operativo', () => {
    // En `full` rechazada + `confirm_only` ambigua, el veredicto DIAGNÓSTICO del
    // ANY-OF es `ambiguous` (una duda gana a un rechazo), mientras que el operativo
    // es `rejected`. El motivo que la ficha muestra sale del diagnóstico, y por eso
    // dice `subindustry_ambiguous` donde la subindustria sola diría
    // `subindustry_rejected`.
    //
    // Es una ETIQUETA, no una decisión: la elegibilidad es `not_confirmed` en los
    // dos casos, el conteo al objetivo es el mismo, y la no-persistencia la decide
    // el pliegue sectorial —que sí es `sector_evidence_contradictory`—. Se declara
    // aquí en vez de esconderse, y se comprueba que es invariante al orden.
    const alone = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [A],
      subindustryPrecision: assess('rejected', 'ambiguous', [A]),
    });
    assert.equal(alone.subindustryBlockingReason, 'subindustry_rejected');

    for (const requested of [
      [A, B],
      [B, A],
    ]) {
      const together = resolveCandidateSubindustryRequirement({
        sectorEvidenceState: 'sector_evidence_confirmed',
        requestedSubindustries: requested,
        subindustryPrecision: assess('rejected', 'ambiguous', requested),
      });
      assert.equal(together.subindustryBlockingReason, 'subindustry_ambiguous');
      // Lo que decide, idéntico a la sola.
      assert.equal(together.eligibilityVerdict, alone.eligibilityVerdict);
      assert.equal(together.eligibilityVerdict, 'not_confirmed');
    }
  });

  test('§ 1 · NINGÚN consumidor económico lee `precisionMode`', () => {
    // Ratchet sobre el código fuente: `precisionMode` es diagnóstico y su desempate
    // sigue el orden pedido. Leerlo desde un consumidor con efecto económico ataría
    // una decisión de dinero a ese orden. El único módulo autorizado a nombrarlo es
    // el que lo produce.
    const root = path.resolve(import.meta.dirname, '../../../../..');
    const allowed = new Set([
      path.join('src', 'server', 'agents', 'prospecting-toolkit', 'apollo-subindustry-precision.ts'),
    ]);

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (!readFileSync(full, 'utf8').includes('precisionMode')) continue;
        const relative = path.relative(root, full);
        if (!allowed.has(relative)) offenders.push(relative);
      }
    };
    walk(path.join(root, 'src'));

    assert.deepEqual(offenders, [], `precisionMode leído fuera del productor: ${offenders}`);
  });
});

// ─── § 15 · producción intacta ────────────────────────────────────────────────

describe('§ 15 · el registro de producción no se movió', () => {
  test('exactamente 2 reglas, ambas `full`, cobertura 2 de 73', () => {
    const production = listSubindustryPrecisionRuleSets();
    assert.equal(production.length, 2);
    assert.deepEqual(
      production.map((ruleSet) => ruleSet.mode),
      ['full', 'full'],
    );
  });

  test('sin reglas inyectadas, la abstención no existe y nada cambia', () => {
    // Con sólo reglas `full` en juego, `projectOneOperationalVerdict` no puede
    // abstenerse nunca: el arreglo del § 7 es inalcanzable en producción, y por eso
    // la paridad golden se mantiene byte a byte.
    //
    // Se recorren las TRES ramas de cada regla vigente. `rejected` se alcanza por
    // modelo excluyente cuando la regla lo tiene, y por industria declarada
    // contradictoria cuando no —«Tiendas por Departamento» no declara excluyentes—.
    const production = listSubindustryPrecisionRuleSets();
    assert.ok(production.length > 0);

    for (const ruleSet of production) {
      const fixtures: [Verdict, Record<string, unknown>][] = [
        ['confirmed', { keywords: [ruleSet.anchors[0]] }],
        ['ambiguous', { keywords: [] }],
        [
          'rejected',
          ruleSet.exclusiveBusinessModels.length > 0
            ? { keywords: [ruleSet.exclusiveBusinessModels[0]] }
            : { industry: ruleSet.contradictoryProviderIndustries[0] },
        ],
      ];

      for (const [verdict, metadata] of fixtures) {
        const assessment = assessApolloSubindustryPrecisionForRequest(
          {
            title: 'Producción',
            url: 'https://example.test',
            snippet: null,
            rank: 1,
            source: 'apollo_organizations',
            metadata,
          } as unknown as WebSearchResult,
          [ruleSet.canonicalName],
        );
        assert.equal(assessment.subindustryMatch, verdict, `${ruleSet.key} · ${verdict}`);

        // Diagnóstico y operativo coinciden término por término.
        const operational = projectOperationalSubindustryVerdict(assessment);
        assert.equal(operational.subindustryMapped, assessment.subindustryMapped);
        assert.equal(operational.subindustryMatch, assessment.subindustryMatch);
        assert.equal(operational.precisionMode, 'full');
      }
    }
  });
});
