/**
 * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 — el gate de subindustria
 * deja de dejar contar candidatos ambiguos, sin mapeo o sin evaluar hacia el
 * objetivo.
 *
 * El defecto de origen, medido en la corrida real `wizard_run_id=551fd2c2…` /
 * `batch_id=8c86eb06…` (Colombia · Retail y Consumo · Tiendas por Departamento,
 * Moda y Calzado):
 *
 *   subindustry_confirmed        0
 *   subindustry_ambiguous        4
 *   complete_valid_candidates    3   ← LA14, Olímpica y Quala contaron sin
 *   target_count                 3     tener la subindustria confirmada.
 *
 * `candidate-writer.ts` decidía `subindustryMatch` con
 * `toSubindustryMatchVerdict(candidate.sectorEvidenceState)` —el veredicto de
 * relevancia sectorial/de INDUSTRIA, subindustria-ciego— e ignoraba
 * `providerEnrichmentCapture.precision`, que YA tenía el veredicto correcto
 * (`subindustry_match: 'ambiguous'`, `subindustry_mapped: false`) para los cuatro.
 *
 * Esta suite cubre además los cuatro bloqueadores que la auditoría del PR
 * encontró sobre esa corrección:
 *
 *   § 1  el matcher de anclas casaba por SUBSTRING: `moda` dentro de «cómodas»,
 *        «acomodación», «Accommodation» ⇒ `confirmed` + cuenta.
 *   § 2  la precisión sólo evaluaba `subindustries[0]`: la segunda a quinta
 *        selección del usuario se descartaban sin mirarlas.
 *   § 3  pedir subindustria sin obtener precisión caía a `sectorEvidenceState`
 *        —el veredicto de INDUSTRIA— y contaba.
 *   § 5  la ficha mostraba «Subindustria ambigua» sobre una RECHAZADA.
 *
 * Todo offline: sin Apollo real, sin Tavily real, sin Supabase real, sin
 * escrituras en Producción, sin HubSpot, sin gasto. Ninguna empresa real está
 * codificada — los patrones son sintéticos y reproducen el PATRÓN de industria
 * observado, no los datos reales de una compañía.
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessApolloSubindustryPrecision,
  assessApolloSubindustryPrecisionForRequest,
  matchesCatalogTerm,
} from '../apollo-subindustry-precision';
import {
  captureApolloEnrichmentForPersistence,
  PROSPECT_CANDIDATE_CLASSIFICATION_SOURCES,
} from '../apollo-enrichment-persistence-capture';
import {
  resolveCandidateSubindustryRequirement,
  evaluateCandidateSubindustryTargetEligibility,
  buildCandidateCompletenessCounters,
  type CandidateCanonicalTargetEligibility,
} from '../candidate-completeness-contract';
import { foldSubindustryPrecisionIntoSectorState } from '../apollo-two-round/production-runner.server';
import { resolveCandidateSubindustryStatus } from '@/modules/prospect-batches/candidate-subindustry-status-display';
import { writeProspectingCandidates } from '../candidate-writer';
import type { CandidateWriterInput, CatalogContextResult } from '../types';
import type { WebSearchResult } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Subindustria compuesta CON catálogo de anclas (tres familias). */
const REQUESTED_SUBINDUSTRY = 'Tiendas por Departamento, Moda y Calzado';
/** Otra subindustria CON catálogo, para los casos ANY-OF de varias mapeadas. */
const MAPPED_SUPERMARKETS = 'Supermercados e Hipermercados';
/** Subindustrias SIN catálogo de anclas — el estado «sin mapeo» del § 3. */
const UNMAPPED_SOFTWARE = 'Software Empresarial (SaaS / ERP / CRM)';
const UNMAPPED_OTHERS = [
  'Servicios Financieros y Banca',
  'Salud y Farmaceutica',
  'Educacion y Formacion',
  'Logistica y Transporte de Carga',
];

function providerResult(
  title: string,
  metadata: Record<string, unknown>,
): WebSearchResult {
  return {
    title,
    url: 'https://example.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata,
  } as unknown as WebSearchResult;
}

// ─── § 1 · matching seguro de anclas ─────────────────────────────────────────

describe('§ 1 · las anclas casan por palabra o frase completa, nunca por substring', () => {
  /**
   * Las cinco cadenas que el matcher por substring declaraba `confirmed`.
   *
   * Ninguna nombra una tienda por departamento, ni moda, ni calzado: las cinco
   * contenían las LETRAS de `moda` (o de `fashion`) dentro de otra palabra, y
   * con eso bastaba para contar hacia el objetivo.
   */
  const FALSE_POSITIVES: readonly string[] = [
    'venta de cómodas y camas',
    'servicios de acomodación',
    'Accommodation services',
    'experiencia incómoda',
    'empresa acomodada',
  ];

  /** Las cadenas que SÍ nombran la operación y deben seguir confirmando. */
  const TRUE_POSITIVES: readonly string[] = [
    'moda femenina',
    'retail de moda',
    'fashion retail',
    'clothing store',
    'footwear retail',
    'department store',
  ];

  for (const text of FALSE_POSITIVES) {
    test(`«${text}» NO confirma la subindustria`, () => {
      const assessment = assessApolloSubindustryPrecision(
        providerResult('Empresa', { keywords: [text] }),
        REQUESTED_SUBINDUSTRY,
      );
      assert.notEqual(assessment.subindustryMatch, 'confirmed');
      assert.equal(assessment.subindustryMatchFamily, 'none');
      assert.deepEqual(assessment.subindustryEvidence, []);
    });
  }

  for (const text of TRUE_POSITIVES) {
    test(`«${text}» SÍ confirma la subindustria`, () => {
      const assessment = assessApolloSubindustryPrecision(
        providerResult('Empresa', { keywords: [text] }),
        REQUESTED_SUBINDUSTRY,
      );
      assert.equal(assessment.subindustryMatch, 'confirmed');
      assert.notEqual(assessment.subindustryMatchFamily, 'none');
    });
  }

  test('el matcher es Unicode-safe: `\\b` de JavaScript NO lo sería', () => {
    // Premisa medida, no supuesta: `\w` de JavaScript es ASCII, así que una letra
    // acentuada cuenta como NO-palabra y `\b` ve una frontera donde no la hay.
    // Sobre el texto en crudo, `/\bmoda\b/u` casa dentro de «incómoda» — una de
    // las cinco cadenas que el § 1 obliga a NO confirmar.
    assert.equal(/\bmoda\b/u.test('incómoda'), true, 'premisa: \\b es inseguro sobre texto crudo');

    // La tokenización explícita con \p{L}/\p{N} no depende de eso, y da el
    // resultado correcto con y sin tildes.
    for (const text of ['incomoda', 'incómoda', 'acomodacion', 'comodas', 'accommodation services']) {
      assert.equal(matchesCatalogTerm(text, 'moda'), false, `«${text}» no contiene la palabra moda`);
    }
  });

  test('la tilde no impide la coincidencia legítima: «Moda» y «modá» son la misma palabra', () => {
    assert.equal(matchesCatalogTerm('moda femenina', 'moda'), true);
    assert.equal(
      assessApolloSubindustryPrecision(
        providerResult('Empresa', { keywords: ['MODA FEMENINA'] }),
        REQUESTED_SUBINDUSTRY,
      ).subindustryMatch,
      'confirmed',
      'el matcher es insensible a la caja',
    );
  });

  test('un ancla de varias palabras exige la SECUENCIA completa, no sus palabras sueltas', () => {
    assert.equal(matchesCatalogTerm('department store', 'department store'), true);
    assert.equal(matchesCatalogTerm('store department', 'department store'), false);
    assert.equal(
      matchesCatalogTerm('department of energy and hardware store', 'department store'),
      false,
    );
  });

  test('el campo `industry` usa el MISMO matcher seguro (§ 1)', () => {
    // Una industria declarada «Accommodation and Food Services» activaba el
    // ancla `moda` por substring y devolvía `confirmed`.
    const assessment = assessApolloSubindustryPrecision(
      providerResult('Hotel X', { industry: 'Accommodation and Food Services' }),
      REQUESTED_SUBINDUSTRY,
    );
    assert.notEqual(assessment.subindustryMatch, 'confirmed');
  });

  test('el NOMBRE comercial también: «Comodas del Norte» no es una tienda de moda', () => {
    const assessment = assessApolloSubindustryPrecision(
      providerResult('Comodas del Norte', {}),
      REQUESTED_SUBINDUSTRY,
    );
    assert.notEqual(assessment.subindustryMatch, 'confirmed');
    assert.deepEqual(assessment.subindustryEvidence, []);
  });

  test('los RECHAZOS no se debilitaron: el plural de un modelo excluyente sigue rechazando', () => {
    // Con matcher por substring, `food distributor` casaba dentro de «food
    // distributors» de regalo. Con tokens hay que declarar el plural, y si
    // alguien lo quita este test lo dice.
    const assessment = assessApolloSubindustryPrecision(
      providerResult('Distribuidora', {
        industry: 'wholesale',
        keywords: ['food distributors', 'supermercado'],
      }),
      MAPPED_SUPERMARKETS,
    );
    assert.equal(assessment.subindustryMatch, 'rejected');
    assert.equal(assessment.verdictReason, 'excluded_business_model');
  });

  test('«Almacenes La 14» sigue siendo evidencia AMPLIA, nunca confirmación', () => {
    const assessment = assessApolloSubindustryPrecision(
      providerResult('Almacenes La 14', { industry: 'almacenes' }),
      REQUESTED_SUBINDUSTRY,
    );
    assert.equal(assessment.industryMatch, 'broad_compatible');
    assert.notEqual(assessment.subindustryMatch, 'confirmed');
  });
});

// ─── § 2 · ANY-OF sobre las subindustrias pedidas ────────────────────────────

describe('§ 2 · multi-subindustria ANY-OF — ninguna selección se descarta', () => {
  /** Confirma Moda/Calzado; para Supermercados sólo es `retail` amplio. */
  const FASHION_CANDIDATE = providerResult('Tienda X', {
    industry: 'retail',
    keywords: ['fashion retail'],
  });

  test('A — requested = [Moda/Calzado, otra]; el candidato confirma Moda/Calzado ⇒ cuenta', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(FASHION_CANDIDATE, [
      REQUESTED_SUBINDUSTRY,
      MAPPED_SUPERMARKETS,
    ]);
    assert.equal(precision.subindustryMatch, 'confirmed');
    assert.equal(precision.matchedRequestedSubindustry, REQUESTED_SUBINDUSTRY);
    assert.equal(precision.perRequestedSubindustryEvaluations.length, 2);
  });

  test('B — el ORDEN no importa: requested = [otra, Moda/Calzado] ⇒ cuenta igual', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(FASHION_CANDIDATE, [
      MAPPED_SUPERMARKETS,
      REQUESTED_SUBINDUSTRY,
    ]);
    assert.equal(precision.subindustryMatch, 'confirmed');
    assert.equal(precision.matchedRequestedSubindustry, REQUESTED_SUBINDUSTRY);
  });

  test('C — [mapeada, sin mapeo] con la mapeada confirmada ⇒ cuenta', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(FASHION_CANDIDATE, [
      REQUESTED_SUBINDUSTRY,
      UNMAPPED_SOFTWARE,
    ]);
    assert.equal(precision.subindustryMatch, 'confirmed');
    assert.equal(precision.subindustryMapped, true);
    assert.equal(precision.matchedRequestedSubindustry, REQUESTED_SUBINDUSTRY);
  });

  test('D — [mapeada, sin mapeo] con NINGUNA confirmada ⇒ no cuenta', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(
      providerResult('Comercial Generica', { industry: 'retail' }),
      [REQUESTED_SUBINDUSTRY, UNMAPPED_SOFTWARE],
    );
    assert.notEqual(precision.subindustryMatch, 'confirmed');
    assert.equal(precision.matchedRequestedSubindustry, null);
    // Ante [ambigua mapeada, sin mapeo] gana la MAPEADA: su ambigüedad es un
    // hecho medido, no la ausencia de reglas.
    assert.equal(precision.subindustryMapped, true);
    assert.equal(precision.subindustryMatch, 'ambiguous');
  });

  test('E — [rechazada, confirmada] ⇒ gana `confirmed` por ANY-OF', () => {
    // Industria declarada `supermarkets`: CONTRADICE Moda/Calzado y CONFIRMA
    // Supermercados. Una rechazada no dice nada sobre las demás.
    const precision = assessApolloSubindustryPrecisionForRequest(
      providerResult('Cadena X', { industry: 'supermarkets' }),
      [REQUESTED_SUBINDUSTRY, MAPPED_SUPERMARKETS],
    );
    const perRequested = new Map(
      precision.perRequestedSubindustryEvaluations.map((e) => [
        e.requestedSubindustry,
        e.subindustryMatch,
      ]),
    );
    assert.equal(perRequested.get(REQUESTED_SUBINDUSTRY), 'rejected');
    assert.equal(perRequested.get(MAPPED_SUPERMARKETS), 'confirmed');
    assert.equal(precision.subindustryMatch, 'confirmed');
    assert.equal(precision.matchedRequestedSubindustry, MAPPED_SUPERMARKETS);
  });

  test('F — TODAS rechazadas ⇒ `rejected`, y el candidato no llega a persistirse', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(
      providerResult('Banco X', { industry: 'banking' }),
      [REQUESTED_SUBINDUSTRY, MAPPED_SUPERMARKETS],
    );
    assert.ok(
      precision.perRequestedSubindustryEvaluations.every((e) => e.subindustryMatch === 'rejected'),
    );
    assert.equal(precision.subindustryMatch, 'rejected');
    // El runner traduce `rejected` a evidencia sectorial CONTRADICTORIA, que es
    // lo que descarta al candidato antes de la escritura.
    assert.equal(
      foldSubindustryPrecisionIntoSectorState('sector_evidence_confirmed', precision),
      'sector_evidence_contradictory',
    );
  });

  test('G — cinco subindustrias con la confirmación en la QUINTA ⇒ cuenta', () => {
    const requested = [...UNMAPPED_OTHERS, REQUESTED_SUBINDUSTRY];
    assert.equal(requested.length, 5);

    const precision = assessApolloSubindustryPrecisionForRequest(FASHION_CANDIDATE, requested);
    assert.equal(precision.subindustryMatch, 'confirmed');
    assert.equal(precision.matchedRequestedSubindustry, REQUESTED_SUBINDUSTRY);
    assert.equal(precision.perRequestedSubindustryEvaluations.length, 5);
    assert.deepEqual(precision.requestedSubindustries, requested);
  });

  test('la subindustria que confirmó viaja al resultado, no sólo el desenlace', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(FASHION_CANDIDATE, [
      MAPPED_SUPERMARKETS,
      REQUESTED_SUBINDUSTRY,
    ]);
    assert.equal(precision.matchedRequestedSubindustry, REQUESTED_SUBINDUSTRY);
    assert.equal(precision.subindustryMatchFamily, 'fashion_apparel');
  });

  test('sin subindustrias pedidas, el resultado es el de siempre', () => {
    const none = assessApolloSubindustryPrecisionForRequest(FASHION_CANDIDATE, []);
    assert.equal(none.requestedSubindustry, null);
    assert.equal(none.subindustryMapped, false);
    assert.equal(none.subindustryMatch, 'ambiguous');
    assert.equal(none.verdictReason, 'subindustry_not_mapped');
    assert.deepEqual(none.requestedSubindustries, []);
    // Idéntico a pasar `null` por la firma histórica de una subindustria.
    assert.deepEqual(none, assessApolloSubindustryPrecision(FASHION_CANDIDATE, null));
  });

  test('etiquetas vacías o repetidas no crean evaluaciones fantasma', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(FASHION_CANDIDATE, [
      REQUESTED_SUBINDUSTRY,
      '   ',
      null,
      REQUESTED_SUBINDUSTRY,
    ]);
    assert.deepEqual(precision.requestedSubindustries, [REQUESTED_SUBINDUSTRY]);
    assert.equal(precision.perRequestedSubindustryEvaluations.length, 1);
  });
});

// ─── § 3 · fail-closed explícito sin precisión ───────────────────────────────

describe('§ 3 · se pidió subindustria y no hay veredicto ⇒ fail-closed', () => {
  const CONTRACT_BASE = {
    persistenceSuccess: true,
    employeeCountStatus: 'confirmed' as const,
    linkedinStatus: 'confirmed' as const,
    duplicateStatus: 'no_match',
    ownershipGate: 'pass' as const,
    qualityGate: 'pass' as const,
  };

  test('Tavily/legacy: subindustria pedida y NINGUNA precisión ⇒ no cuenta', () => {
    const eligibility = evaluateCandidateSubindustryTargetEligibility({
      ...CONTRACT_BASE,
      // El gate sectorial amplio SÍ confirmó: es exactamente la vía por la que
      // el veredicto de INDUSTRIA se colaba como si demostrara la subindustria.
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [REQUESTED_SUBINDUSTRY],
      subindustryPrecision: null,
    });

    assert.equal(eligibility.subindustryRequirementApplied, true);
    assert.equal(eligibility.subindustryMatch, 'evaluation_unavailable');
    assert.equal(eligibility.countsTowardTarget, false);
    assert.equal(eligibility.completeValid, false);
    assert.equal(eligibility.reviewOnly, true);
    assert.ok(eligibility.reviewOnlyReasons.includes('subindustry_evaluation_unavailable'));
    assert.equal(eligibility.subindustryBlockingReason, 'subindustry_evaluation_unavailable');
  });

  test('Apollo con subindustria y `precision` calculada SIN subindustria ⇒ no cuenta', () => {
    // El capture existe, pero su precisión se evaluó con `null`: no puede
    // responder por la subindustria que la búsqueda pidió.
    const blindPrecision = assessApolloSubindustryPrecision(
      providerResult('Empresa', { industry: 'retail' }),
      null,
    );
    assert.equal(blindPrecision.requestedSubindustry, null);

    const eligibility = evaluateCandidateSubindustryTargetEligibility({
      ...CONTRACT_BASE,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [REQUESTED_SUBINDUSTRY],
      subindustryPrecision: blindPrecision,
    });
    assert.equal(eligibility.subindustryMatch, 'evaluation_unavailable');
    assert.equal(eligibility.countsTowardTarget, false);
  });

  test('el veredicto de INDUSTRIA nunca se usa como sustituto (cero fallback al padre)', () => {
    for (const state of [
      'sector_evidence_confirmed',
      'sector_evidence_missing_needs_enrichment',
      'sector_evidence_contradictory',
      null,
      undefined,
    ]) {
      const eligibility = evaluateCandidateSubindustryTargetEligibility({
        ...CONTRACT_BASE,
        sectorEvidenceState: state,
        requestedSubindustries: [REQUESTED_SUBINDUSTRY],
        subindustryPrecision: null,
      });
      assert.equal(
        eligibility.countsTowardTarget,
        false,
        `sectorEvidenceState=${String(state)} no puede hacer contar a nadie`,
      );
    }
  });

  test('búsqueda SIN subindustria y sin precisión: comportamiento PRESERVADO', () => {
    const counts = evaluateCandidateSubindustryTargetEligibility({
      ...CONTRACT_BASE,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [],
      subindustryPrecision: null,
    });
    assert.equal(counts.subindustryRequirementApplied, false);
    assert.equal(counts.subindustryMatch, 'not_requested');
    assert.equal(counts.subindustryBlockingReason, null);
    assert.equal(counts.countsTowardTarget, true);

    const doesNotCount = evaluateCandidateSubindustryTargetEligibility({
      ...CONTRACT_BASE,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      requestedSubindustries: [],
      subindustryPrecision: null,
    });
    assert.equal(doesNotCount.countsTowardTarget, false);
    assert.deepEqual(doesNotCount.failedConditions, ['subindustry_match']);
  });

  test('una confirmación de una subindustria NO pedida no cuenta (desajuste de cableado)', () => {
    const confirmedElsewhere = assessApolloSubindustryPrecision(
      providerResult('Cadena X', { industry: 'supermarkets' }),
      MAPPED_SUPERMARKETS,
    );
    assert.equal(confirmedElsewhere.subindustryMatch, 'confirmed');

    const eligibility = evaluateCandidateSubindustryTargetEligibility({
      ...CONTRACT_BASE,
      sectorEvidenceState: 'sector_evidence_confirmed',
      // La búsqueda pidió Moda/Calzado; la precisión responde por Supermercados.
      requestedSubindustries: [REQUESTED_SUBINDUSTRY],
      subindustryPrecision: confirmedElsewhere,
    });
    assert.equal(eligibility.subindustryMatch, 'evaluation_unavailable');
    assert.equal(eligibility.countsTowardTarget, false);
  });
});

// ─── § A–H · resolveCandidateSubindustryRequirement ──────────────────────────

describe('§ A–H · resolveCandidateSubindustryRequirement — invariantes', () => {
  test('A/D — subindustry_mapped=false con sectorEvidenceState=confirmed NO cuenta (el defecto exacto de la corrida real)', () => {
    const precision = assessApolloSubindustryPrecision(
      providerResult('LA14', { industry: 'retail', city: 'Cali' }),
      UNMAPPED_SOFTWARE,
    );
    assert.equal(precision.subindustryMapped, false);
    assert.equal(precision.subindustryMatch, 'ambiguous');

    const requirement = resolveCandidateSubindustryRequirement({
      // El gate sectorial amplio SÍ confirmó — es exactamente lo que pasó en
      // la corrida real para LA14, Olímpica y Quala.
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [UNMAPPED_SOFTWARE],
      subindustryPrecision: precision,
    });

    assert.equal(requirement.subindustryRequirementApplied, true);
    assert.equal(requirement.subindustryMapped, false);
    // § 3 — «sin mapeo» es un estado propio, no un matiz de «ambigua».
    assert.equal(requirement.subindustryMatch, 'unmapped');
    assert.equal(requirement.subindustryBlockingReason, 'subindustry_not_mapped');
    // La corrección: el veredicto de industria NUNCA sustituye al de subindustria.
    assert.equal(requirement.eligibilityVerdict, 'not_confirmed');
  });

  test('A — subindustry_match=confirmed es obligatorio para contar', () => {
    const precision = assessApolloSubindustryPrecision(
      providerResult('Moda Norte', { industry: 'retail', keywords: ['fashion retail'] }),
      REQUESTED_SUBINDUSTRY,
    );
    assert.equal(precision.subindustryMatch, 'confirmed');

    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [REQUESTED_SUBINDUSTRY],
      subindustryPrecision: precision,
    });
    assert.equal(requirement.eligibilityVerdict, 'confirmed');
    assert.equal(requirement.subindustryMapped, true);
    assert.equal(requirement.matchedRequestedSubindustry, REQUESTED_SUBINDUSTRY);
    assert.equal(requirement.matchedSubindustryFamily, 'fashion_apparel');
    assert.equal(requirement.subindustryBlockingReason, null);
  });

  test('B — ambiguous (mapeada) no cuenta, aun con sectorEvidenceState confirmado', () => {
    const precision = assessApolloSubindustryPrecision(
      providerResult('Comercial Genérica', { industry: 'retail' }),
      REQUESTED_SUBINDUSTRY,
    );
    assert.equal(precision.subindustryMapped, true);
    assert.equal(precision.subindustryMatch, 'ambiguous');

    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [REQUESTED_SUBINDUSTRY],
      subindustryPrecision: precision,
    });
    assert.equal(requirement.eligibilityVerdict, 'not_confirmed');
    assert.equal(requirement.subindustryMatch, 'ambiguous');
    assert.equal(requirement.subindustryBlockingReason, 'subindustry_ambiguous');
  });

  test('C — rejected se reporta como rejected, con su propio motivo', () => {
    const precision = assessApolloSubindustryPrecision(
      providerResult('Banco X', { industry: 'banking' }),
      REQUESTED_SUBINDUSTRY,
    );
    assert.equal(precision.subindustryMatch, 'rejected');

    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [REQUESTED_SUBINDUSTRY],
      subindustryPrecision: precision,
    });
    assert.equal(requirement.subindustryMatch, 'rejected');
    assert.equal(requirement.subindustryBlockingReason, 'subindustry_rejected');
    assert.equal(requirement.eligibilityVerdict, 'not_confirmed');
  });

  test('E — industryMatch=confirmed NUNCA convierte un veredicto ambiguo o sin mapeo en confirmado', () => {
    // industry declarado coincide con un ancla (industryMatch='confirmed'),
    // pero SIN evidencia positiva en ningún otro campo la subindustria sigue
    // sin demostrarse: el módulo exige evidencia, no basta con no contradecir.
    const precision = assessApolloSubindustryPrecision(
      providerResult('Empresa X', { industry: 'department store' }),
      REQUESTED_SUBINDUSTRY,
    );
    // La industria declarada ES un ancla ⇒ evidencia de industria también
    // cuenta como evidencia (el módulo la incluye vía CLASSIFYING_FIELDS), así
    // que este caso SÍ confirma — lo que importa es que confirma por
    // EVIDENCIA, no porque `industryMatch` se lea como sustituto.
    assert.equal(precision.subindustryMatch, 'confirmed');

    // El caso que de verdad ejercita la invariante: industria de sector
    // amplio compatible, pero SIN ningún ancla de familia.
    const broadOnly = assessApolloSubindustryPrecision(
      providerResult('Empresa Y', { industry: 'retail' }),
      REQUESTED_SUBINDUSTRY,
    );
    assert.equal(broadOnly.industryMatch, 'broad_compatible');
    assert.notEqual(broadOnly.subindustryMatch, 'confirmed');
    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [REQUESTED_SUBINDUSTRY],
      subindustryPrecision: broadOnly,
    });
    assert.equal(requirement.eligibilityVerdict, 'not_confirmed');
  });

  test('sin subindustria pedida, la pregunta no aplica: decide sectorEvidenceState como siempre', () => {
    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [],
      subindustryPrecision: null,
    });
    assert.equal(requirement.subindustryRequirementApplied, false);
    assert.equal(requirement.subindustryMatch, 'not_requested');
    assert.equal(requirement.eligibilityVerdict, 'confirmed');

    const notConfirmed = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      requestedSubindustries: [],
      subindustryPrecision: null,
    });
    assert.equal(notConfirmed.eligibilityVerdict, 'not_confirmed');
  });
});

// ─── § 4 · función canónica, sin cálculos paralelos ──────────────────────────

describe('§ 4 · evaluateCandidateSubindustryTargetEligibility es la única fuente', () => {
  const CANONICAL_FIELDS: readonly string[] = [
    'countsTowardTarget',
    'completeValid',
    'reviewOnly',
    'reviewOnlyReasons',
    'blockingReasons',
    'failedConditions',
    'subindustryRequirementApplied',
    'requestedSubindustries',
    'perRequestedSubindustryEvaluations',
    'matchedRequestedSubindustry',
    'matchedSubindustryFamily',
    'subindustryMapped',
    'subindustryMatch',
    'subindustryBlockingReason',
  ];

  test('el resultado publica TODO lo que el § 4 exige', () => {
    const eligibility = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [REQUESTED_SUBINDUSTRY],
      subindustryPrecision: assessApolloSubindustryPrecision(
        providerResult('Moda Norte', { keywords: ['fashion retail'] }),
        REQUESTED_SUBINDUSTRY,
      ),
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    for (const field of CANONICAL_FIELDS) {
      assert.ok(field in eligibility, `falta el campo canónico ${field}`);
    }
  });

  test('`completeValid` y `countsTowardTarget` son el MISMO booleano', () => {
    for (const industry of ['fashion retail', 'retail', 'banking']) {
      const eligibility = evaluateCandidateSubindustryTargetEligibility({
        persistenceSuccess: true,
        sectorEvidenceState: 'sector_evidence_confirmed',
        requestedSubindustries: [REQUESTED_SUBINDUSTRY],
        subindustryPrecision: assessApolloSubindustryPrecision(
          providerResult('Empresa', { industry }),
          REQUESTED_SUBINDUSTRY,
        ),
        employeeCountStatus: 'confirmed',
        linkedinStatus: 'confirmed',
        duplicateStatus: 'no_match',
        ownershipGate: 'pass',
        qualityGate: 'pass',
      });
      assert.equal(eligibility.completeValid, eligibility.countsTowardTarget);
      assert.equal(eligibility.reviewOnly, !eligibility.countsTowardTarget);
    }
  });

  test('`reviewOnlyReasons` sustituye la condición genérica por su causa concreta', () => {
    const eligibility = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [REQUESTED_SUBINDUSTRY],
      subindustryPrecision: assessApolloSubindustryPrecision(
        providerResult('Empresa', { industry: 'retail' }),
        REQUESTED_SUBINDUSTRY,
      ),
      employeeCountStatus: 'mapping_failed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    // El vocabulario del CONTRATO se conserva donde lo consumen los contadores…
    assert.deepEqual(eligibility.failedConditions, [
      'subindustry_match',
      'employee_count_status',
    ]);
    // …y el ACCIONABLE es el que ve la usuaria.
    assert.deepEqual(eligibility.reviewOnlyReasons, [
      'subindustry_ambiguous',
      'employee_count_status',
    ]);
  });

  test('los contadores derivan del MISMO resultado, sin recontar nada', () => {
    const eligibilities = ['fashion retail', 'retail', 'retail'].map((industry) =>
      evaluateCandidateSubindustryTargetEligibility({
        persistenceSuccess: true,
        sectorEvidenceState: 'sector_evidence_confirmed',
        requestedSubindustries: [REQUESTED_SUBINDUSTRY],
        subindustryPrecision: assessApolloSubindustryPrecision(
          providerResult('Empresa', { industry }),
          REQUESTED_SUBINDUSTRY,
        ),
        employeeCountStatus: 'confirmed',
        linkedinStatus: 'confirmed',
        duplicateStatus: 'no_match',
        ownershipGate: 'pass',
        qualityGate: 'pass',
      }),
    );

    const counters = buildCandidateCompletenessCounters(eligibilities);
    assert.equal(counters.persisted_candidates, 3);
    assert.equal(counters.complete_valid_candidates, 1);
    assert.equal(counters.review_only_candidates, 2);
    assert.equal(counters.target_count, 1);
    assert.equal(
      counters.complete_valid_candidates,
      eligibilities.filter((e) => e.countsTowardTarget).length,
    );
  });
});

// ─── § 6 · fixture de referencia — la corrida 8c86eb06… ──────────────────────

describe('§ 6 · fixture de referencia de la corrida 8c86eb06…', () => {
  const CONTRACT_BASE = {
    persistenceSuccess: true,
    employeeCountStatus: 'confirmed' as const,
    linkedinStatus: 'confirmed' as const,
    duplicateStatus: 'no_match',
    ownershipGate: 'pass' as const,
    qualityGate: 'pass' as const,
  };

  /**
   * Los cuatro patrones de industria observados, en el orden de la corrida real.
   *
   * El gate sectorial amplio confirmó a tres de los cuatro; el cuarto quedó
   * fuera por la redacción de su industria declarada, no por regla.
   */
  const LEGACY_SECTOR_STATES = [
    'sector_evidence_confirmed', // Quala
    'sector_evidence_confirmed', // Olímpica
    'sector_evidence_missing_needs_enrichment', // Arturo Calle
    'sector_evidence_confirmed', // LA14
  ] as const;

  const OBSERVED_INDUSTRIES = ['food production', 'retail', 'textiles', 'retail'] as const;

  test('ANTES (defecto): 3 de 4 contaban por el veredicto de INDUSTRIA', () => {
    const legacyCountsTowardTarget = LEGACY_SECTOR_STATES.map(
      (state) => state === 'sector_evidence_confirmed',
    );
    assert.equal(legacyCountsTowardTarget.filter(Boolean).length, 3);
  });

  /**
   * La corrida pidió una subindustria que en ese momento NO tenía catálogo de
   * anclas: su metadata registró `subindustry_mapped: false` y
   * `subindustry_match: 'ambiguous'` para los CUATRO. Éste es el estado tal como
   * quedó guardado, y las seis cifras del § 6 se miden sobre él.
   */
  test('AHORA, sobre el estado REGISTRADO: 4 persistidos, 0 confirmados, 0 cuentan', () => {
    const patterns = OBSERVED_INDUSTRIES.map((industry) =>
      assessApolloSubindustryPrecision(
        providerResult('Patron', { industry }),
        UNMAPPED_SOFTWARE,
      ),
    );

    const confirmed = patterns.filter((p) => p.subindustryMatch === 'confirmed').length;
    const ambiguousOrUnmapped = patterns.filter(
      (p) => p.subindustryMatch === 'ambiguous' || p.subindustryMapped === false,
    ).length;

    const eligibilities: CandidateCanonicalTargetEligibility[] = patterns.map(
      (precision, index) =>
        evaluateCandidateSubindustryTargetEligibility({
          ...CONTRACT_BASE,
          sectorEvidenceState: LEGACY_SECTOR_STATES[index],
          requestedSubindustries: [UNMAPPED_SOFTWARE],
          subindustryPrecision: precision,
        }),
    );
    const counters = buildCandidateCompletenessCounters(eligibilities);
    const targetEligibleCompanies = 5;

    assert.equal(counters.persisted_candidates, 4);
    assert.equal(confirmed, 0);
    assert.equal(ambiguousOrUnmapped, 4);
    assert.equal(counters.complete_valid_candidates, 0);
    assert.equal(counters.review_only_candidates, 4);
    assert.equal(counters.target_count, 0);
    assert.equal(counters.target_count >= targetEligibleCompanies, false);
  });

  test('ninguno de los cuatro cuenta ÚNICAMENTE por Retail y Consumo', () => {
    // La industria padre de la corrida era «Retail y Consumo», y `retail` es un
    // término AMPLIO del catálogo: presencia y nada más ⇒ nunca `confirmed`.
    const retailOnly = assessApolloSubindustryPrecision(
      providerResult('Patron', { industry: 'retail' }),
      REQUESTED_SUBINDUSTRY,
    );
    assert.equal(retailOnly.industryMatch, 'broad_compatible');
    assert.notEqual(retailOnly.subindustryMatch, 'confirmed');

    const eligibility = evaluateCandidateSubindustryTargetEligibility({
      ...CONTRACT_BASE,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [REQUESTED_SUBINDUSTRY],
      subindustryPrecision: retailOnly,
    });
    assert.equal(eligibility.countsTowardTarget, false);
  });

  test('con el catálogo de HOY los cuatro siguen sin contar, y el contradicho se rechaza', () => {
    // La misma corrida, reevaluada ahora que «Tiendas por Departamento, Moda y
    // Calzado» SÍ tiene catálogo: el desglose cambia —«food production»
    // contradice y pasa a `rejected`— pero `target_count` sigue siendo 0.
    const patterns = OBSERVED_INDUSTRIES.map((industry) =>
      assessApolloSubindustryPrecision(
        providerResult('Patron', { industry }),
        REQUESTED_SUBINDUSTRY,
      ),
    );

    assert.equal(patterns.filter((p) => p.subindustryMatch === 'confirmed').length, 0);
    assert.equal(patterns[0].subindustryMatch, 'rejected', 'food production contradice');
    assert.equal(patterns[0].verdictReason, 'declared_industry_contradicts');
    assert.ok(
      patterns.slice(1).every((p) => p.subindustryMatch === 'ambiguous'),
      'los otros tres siguen ambiguos',
    );

    const eligibilities = patterns.map((precision, index) =>
      evaluateCandidateSubindustryTargetEligibility({
        ...CONTRACT_BASE,
        sectorEvidenceState: LEGACY_SECTOR_STATES[index],
        requestedSubindustries: [REQUESTED_SUBINDUSTRY],
        subindustryPrecision: precision,
      }),
    );
    assert.equal(buildCandidateCompletenessCounters(eligibilities).target_count, 0);
  });
});

// ─── Integración real del writer ─────────────────────────────────────────────

const FAKE_CATALOG_CONTEXT: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail y Consumo',
  searchDepth: 'standard',
  fiscalIdentifierLabel: null,
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

class ChainResult {
  constructor(private readonly _val: unknown) {}
  eq(): ChainResult { return this; }
  neq(): ChainResult { return this; }
  in(): ChainResult { return this; }
  not(): ChainResult { return this; }
  gte(): ChainResult { return this; }
  limit(): ChainResult { return this; }
  select(): ChainResult { return this; }
  then<T>(
    onFulfilled: (v: unknown) => T | PromiseLike<T>,
    onRejected?: (r: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    return Promise.resolve(this._val).then(onFulfilled, onRejected);
  }
  single(): Promise<unknown> { return Promise.resolve(this._val); }
}

type FakeAdminStats = { candidateInsertCalls: Record<string, unknown>[] };

function makeFakeAdmin(stats: FakeAdminStats): SupabaseClient {
  let candidateSeq = 0;
  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select() {
            return {
              eq(col: string) {
                if (col === 'source') return new ChainResult({ data: [], error: null });
                return { single: () => Promise.resolve({ data: null, error: { message: 'Not found' } }) };
              },
            };
          },
          update() {
            return new ChainResult({ error: null });
          },
          insert() {
            return {
              select() {
                return {
                  single: () =>
                    Promise.resolve({ data: { id: 'batch-subindustry-fail-closed-1' }, error: null }),
                };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidates') {
        return {
          select() {
            return new ChainResult({ data: [], error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.candidateInsertCalls.push({ ...data });
            const id = `cand-subindustry-fail-closed-${++candidateSeq}`;
            return { select() { return { single: () => Promise.resolve({ data: { id }, error: null }) }; } };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === 'provider_usage_logs') {
        return { select: () => new ChainResult({ data: [], error: null }) };
      }
      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

/**
 * Candidato mínimo, real en forma, para ejercitar `writeProspectingCandidates`
 * de punta a punta con un `providerEnrichmentCapture.precision` real —no un
 * doble que reimplemente la regla.
 *
 * `capturePrecision: false` reproduce la ruta Tavily/legacy: candidato SIN
 * `providerEnrichmentCapture`, que es el caso fail-closed del § 3.
 */
function makeCandidateFixture(options: {
  name: string;
  industry: string;
  sectorEvidenceState: string;
  requestedSubindustries?: readonly string[];
  capturePrecision?: boolean;
}) {
  const requestedSubindustries = options.requestedSubindustries ?? [REQUESTED_SUBINDUSTRY];
  const result = providerResult(options.name, { industry: options.industry });
  const precision = assessApolloSubindustryPrecisionForRequest(result, requestedSubindustries);
  const capture =
    options.capturePrecision === false
      ? null
      : captureApolloEnrichmentForPersistence({
          result,
          precision,
          provenance: {
            sourceProvider: 'apollo',
            sourceOperation: 'organization_enrichment',
            sourceRequestId: 'organization_enrichment:test-batch:test-request',
            observedAt: '2026-08-06T14:26:42.000Z',
          },
        });

  // `.com.co` — dominio con TLD reconocido por el ownership gate y evidencia de
  // país fuerte, igual que las cuatro empresas reales de la corrida `8c86eb06…`.
  const slug = options.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const domain = `${slug}.com.co`;
  const candidate = {
    name: options.name,
    website: `https://www.${domain}`,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    sourceUrl: `https://www.${domain}`,
    sourceTitle: options.name,
    sourceSnippet: `Empresa: ${options.name} | País: Colombia`,
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: {
      domain,
      status: 'verified' as const,
      skipped: false,
      confidence: 88,
      redirected: false,
      httpStatus: 200,
      skipReason: null,
    },
    sectorEvidenceState: options.sectorEvidenceState,
    providerEnrichmentCapture: capture,
    companyLinkedInUrl: 'https://www.linkedin.com/company/test',
    // El ICP size gate lee este campo TOP-LEVEL (`extractCandidateCompanySize`),
    // no `providerCompanyFields.employeeCount`: sin él, tamaño desconocido
    // bloquea al candidato antes de llegar al contrato de completitud.
    employeeCount: 1500,
    providerCompanyFields: {
      linkedin: {
        companyLinkedInUrl: 'https://www.linkedin.com/company/test',
        status: 'confirmed' as const,
        sourceProvider: 'apollo' as const,
        sourceOperation: 'organization_enrichment' as const,
        observedAt: '2026-08-06T14:26:42.000Z',
        rawValue: 'https://www.linkedin.com/company/test',
        reason: null,
      },
      employeeCount: {
        employeeCount: 1500,
        status: 'confirmed' as const,
        sourceProvider: 'apollo' as const,
        sourceOperation: 'organization_enrichment' as const,
        observedAt: '2026-08-06T14:26:42.000Z',
        rawValue: 1500,
        reason: null,
      },
    },
    duplicateCheck: {
      status: 'new_candidate' as const,
      confidence: 1,
      input: { name: options.name, website: null, domain: null },
      checkedSources: ['sellup' as const],
      summary: 'No match',
      matches: [],
    },
    scoring: {
      qualityLabel: 'needs_review' as const,
      confidenceScore: 0.75,
      fitScore: 0.45,
      dataCompletenessScore: 0.6,
      recommendedAction: 'review_manually' as const,
      breakdown: {
        existenceSignals: 1,
        websiteSignals: 1,
        duplicateSignals: 1,
        sourceSignals: 1,
        fitSignals: 1,
        completenessSignals: 1,
        penalties: 0,
      },
      reasons: [],
      warnings: [],
      blockers: [],
    },
  };

  return { candidate, precision };
}

async function runWriterWithCandidates(
  candidates: ReturnType<typeof makeCandidateFixture>['candidate'][],
  requestedSubindustries: readonly string[] = [REQUESTED_SUBINDUSTRY],
): Promise<{ rows: Record<string, unknown>[] }> {
  const stats: FakeAdminStats = { candidateInsertCalls: [] };
  const pipelineOutput = {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Retail y Consumo',
      webSearchProvider: 'apollo_organizations',
      mode: 'multi_query' as const,
      subindustries: [...requestedSubindustries],
    },
    catalogContext: FAKE_CATALOG_CONTEXT,
    searchQuery: requestedSubindustries[0] ?? 'Retail y Consumo',
    webSearch: {
      provider: 'apollo_organizations',
      query: 'test',
      results: [],
      resultsCount: candidates.length,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates,
    summary: {
      requested: candidates.length,
      searched: candidates.length,
      returned: candidates.length,
      highQualityNew: 0,
      needsReview: candidates.length,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: {
      provider: 'apollo_organizations',
      pipelineVersion: 'apollo-two-round-1',
      executedAt: '2026-08-06T14:26:42.000Z',
      total_raw_evaluated: candidates.length,
      subindustries: [...requestedSubindustries],
    },
  };

  const input = {
    pipelineOutput: pipelineOutput as unknown as CandidateWriterInput['pipelineOutput'],
    triggeredByUserId: 'aaaaaaaa-0000-0000-0000-000000000001',
    ownerId: 'aaaaaaaa-0000-0000-0000-000000000001',
    source: 'agent_1' as const,
    dryRun: false,
    extraBatchMetadata: { subindustries: [...requestedSubindustries] },
  } as unknown as CandidateWriterInput;

  await writeProspectingCandidates(input, makeFakeAdmin(stats));
  return { rows: stats.candidateInsertCalls };
}

function readTargetCompleteness(row: Record<string, unknown>): Record<string, unknown> {
  const metadata = row.metadata as Record<string, unknown>;
  return metadata.target_completeness as Record<string, unknown>;
}

describe('Integración real del writer — providerEnrichmentCapture decide, no sectorEvidenceState', () => {
  it('un candidato con sectorEvidenceState=confirmed pero subindustria sin mapear NO cuenta hacia el objetivo', async () => {
    const { candidate } = makeCandidateFixture({
      // ASCII a propósito: el slug del fixture no transliteral tildes igual
      // que `company-ownership-gate.ts`, y un acento en el nombre desalinea el
      // dominio sintético con el nombre — nada que ver con la regla que este
      // test ejercita.
      name: 'Bazar Uno',
      industry: 'retail',
      sectorEvidenceState: 'sector_evidence_confirmed',
      // Subindustria genuinamente SIN catálogo (distinta de la ya mapeada por
      // este PR), para ejercitar el caso `subindustry_mapped: false` de punta
      // a punta a través del writer real.
      requestedSubindustries: [UNMAPPED_SOFTWARE],
    });

    const { rows } = await runWriterWithCandidates([candidate], [UNMAPPED_SOFTWARE]);
    assert.equal(rows.length, 1);
    const targetCompleteness = readTargetCompleteness(rows[0]);

    assert.equal(targetCompleteness.counts_toward_target, false);
    assert.deepEqual(targetCompleteness.failed_conditions, ['subindustry_match']);
    assert.deepEqual(targetCompleteness.review_only_reasons, ['subindustry_not_mapped']);
    assert.equal(targetCompleteness.subindustry_requirement_applied, true);
    assert.equal(targetCompleteness.subindustry_mapped, false);
    assert.equal(targetCompleteness.subindustry_match, 'unmapped');
    assert.equal(targetCompleteness.subindustry_blocking_reason, 'subindustry_not_mapped');
    assert.deepEqual(targetCompleteness.requested_subindustries, [UNMAPPED_SOFTWARE]);
    assert.equal(targetCompleteness.matched_requested_subindustry, null);
    assert.equal(rows[0].status, 'needs_review');

    // La columna de clasificación se queda intacta: sin subindustria
    // confirmada no hay nada que clasificar. Cero riesgo de 23514.
    assert.equal('classification_source' in rows[0], false);
  });

  it('un candidato con evidencia positiva de la subindustria SÍ cuenta, y classification_source es compatible con la CHECK 093', async () => {
    const { candidate } = makeCandidateFixture({
      name: 'Moda Confirmada',
      industry: 'fashion retail',
      sectorEvidenceState: 'sector_evidence_confirmed',
    });

    const { rows } = await runWriterWithCandidates([candidate]);
    const targetCompleteness = readTargetCompleteness(rows[0]);

    assert.equal(targetCompleteness.counts_toward_target, true);
    assert.deepEqual(targetCompleteness.failed_conditions, []);
    assert.deepEqual(targetCompleteness.review_only_reasons, []);
    assert.equal(targetCompleteness.subindustry_mapped, true);
    assert.equal(targetCompleteness.subindustry_match, 'confirmed');
    assert.equal(targetCompleteness.subindustry_blocking_reason, null);
    assert.equal(targetCompleteness.matched_requested_subindustry, REQUESTED_SUBINDUSTRY);
    assert.equal(targetCompleteness.matched_subindustry_family, 'fashion_apparel');

    // FORENSICS-1 / PR #238 — la columna lleva el vocabulario de QUIÉN
    // clasificó ('writer'), nunca el de la EVIDENCIA. Ese es el defecto que
    // producía el error 23514 contra la CHECK de la migración 093.
    assert.equal(rows[0].classification_source, 'writer');
    assert.ok(
      PROSPECT_CANDIDATE_CLASSIFICATION_SOURCES.includes(
        rows[0].classification_source as never,
      ),
      'classification_source debe estar en el dominio de la CHECK 093',
    );
  });

  it('§ 3 · un candidato SIN capture pero con subindustria pedida no cuenta (fail-closed en el writer real)', async () => {
    const { candidate } = makeCandidateFixture({
      name: 'Bazar Sin Capture',
      industry: 'retail',
      sectorEvidenceState: 'sector_evidence_confirmed',
      capturePrecision: false,
    });

    const { rows } = await runWriterWithCandidates([candidate]);
    const targetCompleteness = readTargetCompleteness(rows[0]);

    assert.equal(targetCompleteness.counts_toward_target, false);
    assert.equal(targetCompleteness.subindustry_requirement_applied, true);
    assert.equal(targetCompleteness.subindustry_match, 'evaluation_unavailable');
    assert.deepEqual(targetCompleteness.review_only_reasons, [
      'subindustry_evaluation_unavailable',
    ]);
    assert.equal(rows[0].status, 'needs_review');
  });

  it('§ 2 · el writer cuenta una confirmación en la SEGUNDA subindustria pedida', async () => {
    const requested = [MAPPED_SUPERMARKETS, REQUESTED_SUBINDUSTRY];
    const { candidate } = makeCandidateFixture({
      name: 'Moda Segunda',
      industry: 'fashion retail',
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: requested,
    });

    const { rows } = await runWriterWithCandidates([candidate], requested);
    const targetCompleteness = readTargetCompleteness(rows[0]);

    assert.equal(targetCompleteness.counts_toward_target, true);
    assert.equal(targetCompleteness.matched_requested_subindustry, REQUESTED_SUBINDUSTRY);
    assert.deepEqual(targetCompleteness.requested_subindustries, requested);
  });

  it('cuatro candidatos con el patrón real de la corrida 8c86eb06…: ninguno cuenta, target_count=0', async () => {
    // ASCII a propósito — ver nota en el primer test de este describe.
    const patterns = [
      { name: 'Bazar Uno', industry: 'food production' },
      { name: 'Bazar Dos', industry: 'retail' },
      { name: 'Bazar Tres', industry: 'textiles' },
      { name: 'Bazar Cuatro', industry: 'retail' },
    ];

    const candidates = patterns.map(({ name, industry }) =>
      makeCandidateFixture({ name, industry, sectorEvidenceState: 'sector_evidence_confirmed' })
        .candidate,
    );

    const { rows } = await runWriterWithCandidates(candidates);
    assert.equal(rows.length, 4);

    const countsTowardTarget = rows.map((row) => readTargetCompleteness(row).counts_toward_target);

    // El resultado obligatorio del § 6: cero, no tres.
    assert.deepEqual(countsTowardTarget, [false, false, false, false]);
    assert.ok(rows.every((row) => row.status === 'needs_review'));
  });

  it('§ 7 · la evidencia del proveedor vive SÓLO en metadata, nunca en la columna de clasificación', async () => {
    const { candidate } = makeCandidateFixture({
      name: 'Moda Confirmada',
      industry: 'fashion retail',
      sectorEvidenceState: 'sector_evidence_confirmed',
    });

    const { rows } = await runWriterWithCandidates([candidate]);
    const metadata = rows[0].metadata as Record<string, unknown>;
    const capture = metadata.apollo_enrichment_capture as Record<string, unknown>;
    const precision = capture.precision as Record<string, unknown>;

    // El vocabulario de EVIDENCIA (`provider_industry`, `provider_keywords`, …)
    // sigue existiendo… en metadata.
    assert.equal(precision.classification_source, 'provider_industry');
    // …y NUNCA en la columna, cuyo dominio es la CHECK 093.
    assert.equal(rows[0].classification_source, 'writer');
    assert.equal(
      PROSPECT_CANDIDATE_CLASSIFICATION_SOURCES.includes('provider_industry' as never),
      false,
      'el vocabulario de evidencia no está en el dominio de la CHECK 093',
    );
  });
});

// ─── § 5 · UI — cuatro estados, cuatro frases, cero contradicciones ──────────

describe('§ 5 · UI — «sin confirmar», «rechazada» y «sin evaluar» no se confunden', () => {
  function metadataFor(options: {
    subindustryMatch: string;
    subindustryMapped?: boolean;
    reviewOnlyReasons?: string[];
    withPrecision?: boolean;
    contractMatch?: string;
  }): Record<string, unknown> {
    return {
      ...(options.withPrecision === false
        ? {}
        : {
            apollo_enrichment_capture: {
              precision: {
                requested_subindustry: REQUESTED_SUBINDUSTRY,
                subindustry_mapped: options.subindustryMapped ?? true,
                subindustry_match: options.subindustryMatch,
                subindustry_evidence: [],
                classification_source: 'none',
              },
            },
          }),
      target_completeness: {
        counts_toward_target: false,
        failed_conditions: ['subindustry_match'],
        review_only_reasons: options.reviewOnlyReasons ?? ['subindustry_ambiguous'],
        requested_subindustries: [REQUESTED_SUBINDUSTRY],
        ...(options.contractMatch ? { subindustry_match: options.contractMatch } : {}),
      },
    };
  }

  it('ambigua ⇒ «Subindustria ambigua»', () => {
    const status = resolveCandidateSubindustryStatus(
      metadataFor({ subindustryMatch: 'ambiguous', reviewOnlyReasons: ['subindustry_ambiguous'] }),
    );
    assert.equal(status.verdict, 'ambiguous');
    assert.deepEqual(
      status.reviewReasons.map((r) => r.label),
      ['Subindustria ambigua'],
    );
  });

  it('sin mapeo ⇒ «No se pudo confirmar automáticamente la subindustria solicitada»', () => {
    const status = resolveCandidateSubindustryStatus(
      metadataFor({
        subindustryMatch: 'ambiguous',
        subindustryMapped: false,
        reviewOnlyReasons: ['subindustry_not_mapped'],
      }),
    );
    assert.equal(status.verdict, 'unmapped');
    assert.deepEqual(
      status.reviewReasons.map((r) => r.label),
      ['No se pudo confirmar automáticamente la subindustria solicitada'],
    );
    assert.match(String(status.notConfirmedMessage), /todavía no tiene reglas suficientes/);
  });

  it('rechazada ⇒ «La evidencia disponible no coincide con la subindustria solicitada»', () => {
    const status = resolveCandidateSubindustryStatus(
      metadataFor({ subindustryMatch: 'rejected', reviewOnlyReasons: ['subindustry_rejected'] }),
    );
    assert.equal(status.verdict, 'rejected');
    assert.deepEqual(
      status.reviewReasons.map((r) => r.label),
      ['La evidencia disponible no coincide con la subindustria solicitada'],
    );
    // La prohibición explícita del § 5.
    assert.ok(
      !status.reviewReasons.some((r) => r.label === 'Subindustria ambigua'),
      'Rechazada NUNCA puede mostrarse con «Subindustria ambigua»',
    );
  });

  it('no evaluable ⇒ «No fue posible evaluar automáticamente la subindustria solicitada»', () => {
    const status = resolveCandidateSubindustryStatus(
      metadataFor({
        subindustryMatch: 'ambiguous',
        withPrecision: false,
        contractMatch: 'evaluation_unavailable',
        reviewOnlyReasons: ['subindustry_evaluation_unavailable'],
      }),
    );
    assert.equal(status.verdict, 'evaluation_unavailable');
    assert.equal(status.verdictLabel, 'Sin evaluar');
    assert.deepEqual(
      status.reviewReasons.map((r) => r.label),
      ['No fue posible evaluar automáticamente la subindustria solicitada'],
    );
    assert.match(String(status.notConfirmedMessage), /no fue posible evaluar/i);
    // Aun sin precisión, la ficha puede nombrar lo que se pidió.
    assert.equal(status.requestedSubindustry, REQUESTED_SUBINDUSTRY);
  });

  it('las filas antiguas (sin review_only_reasons) siguen resolviéndose', () => {
    const legacy = resolveCandidateSubindustryStatus({
      apollo_enrichment_capture: {
        precision: {
          requested_subindustry: REQUESTED_SUBINDUSTRY,
          subindustry_mapped: false,
          subindustry_match: 'ambiguous',
        },
      },
      target_completeness: {
        counts_toward_target: false,
        failed_conditions: ['subindustry_match'],
      },
    });
    assert.equal(legacy.verdict, 'unmapped');
    assert.deepEqual(
      legacy.reviewReasons.map((r) => r.key),
      ['subindustry_not_mapped'],
    );
  });

  it('contrato de imposibilidad: ningún veredicto no-confirmado puede mostrar «Cuenta = Sí»', () => {
    // No es una aserción sobre datos: es estructural. `resolveCandidateSubindustryStatus`
    // sólo puede devolver `countsTowardTarget: true` leyendo `counts_toward_target`
    // de la metadata, y el writer sólo lo persiste como `true` cuando el
    // veredicto canónico es `confirmed` (§ A del contrato).
    for (const match of ['ambiguous', 'rejected']) {
      for (const mapped of [true, false]) {
        const status = resolveCandidateSubindustryStatus(
          metadataFor({ subindustryMatch: match, subindustryMapped: mapped }),
        );
        assert.notEqual(status.verdict, 'confirmed');
        assert.equal(status.countsTowardTarget, false);
        assert.equal(status.countsTowardTargetLabel, 'No');
      }
    }
  });

  it('lo que no se midió se muestra «Sin medir», nunca «No»', () => {
    const status = resolveCandidateSubindustryStatus({
      apollo_enrichment_capture: {
        precision: { requested_subindustry: REQUESTED_SUBINDUSTRY, subindustry_match: 'ambiguous' },
      },
    });
    assert.equal(status.countsTowardTarget, null);
    assert.equal(status.countsTowardTargetLabel, 'Sin medir');
  });
});
