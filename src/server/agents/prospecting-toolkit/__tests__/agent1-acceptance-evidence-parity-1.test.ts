/**
 * agent1-acceptance-evidence-parity-1.test.ts — los TRES defectos de aceptación
 * que el lote `52b22335` dejó medidos.
 *
 * AGENT1-MACRO-EVIDENCE-CONJUNCTION-1 · AGENT1-SIZE-EVIDENCE-PARITY-1 ·
 * AGENT1-ENRICHMENT-SELECTION-TARGET-VALUE-1.
 *
 * Contexto medido (no hipotético): de 60 candidatas persistidas, CERO contaron
 * hacia el objetivo. El desglose por condición del propio lote —
 * `failed_condition_counts` — decía `subindustry_match: 60`,
 * `employee_count_status: 55`, `quality_gate: 31`, `duplicate_status: 6`. Y de
 * los 5 créditos de enrichment, 3 se gastaron en candidatas que ese mismo
 * `quality_gate` ya había bloqueado ANTES de pagar.
 *
 * Lo que NO se toca, y tiene su propia prueba de no-regresión abajo: el filtro
 * de `quality_gate` en sí, que bloquea por evidencia de país DÉBIL (X6.2-A) y es
 * legítimo. Lo que cambia es que su veredicto, ya calculado y gratis, deja de
 * ignorarse a la hora de decidir a quién se le compra un perfil — distinguiendo
 * el bloqueo irrecuperable de la evidencia pendiente que la compra sí resuelve.
 *
 * LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assessMacroIndustryEvidence } from '../apollo-macro-industry-evidence';
import { evaluateCandidateSubindustryTargetEligibility } from '../candidate-completeness-contract';
import { normalizeMacroIndustryLabel } from '@/modules/macro-industry-catalog/macro-industries';
import {
  evaluateApolloEnrichmentNeed,
  isQualityBlockRecoverableByEnrichment,
  selectCandidatesForEnrichment,
  type FreeCandidateSignals,
} from '../apollo-two-round/enrichment-ranking';
import type { WebSearchResult } from '../types';
import type { CompanyFieldMappingStatus } from '../apollo-company-fields-mapping';

// ─── Utilidades ───────────────────────────────────────────────────────────────

/** Resultado con SÓLO evidencia declarada por el proveedor. Sin nombre ni dominio parlantes. */
function providerResult(profile: {
  industry?: string;
  industries?: string[];
  keywords?: string[];
  short_description?: string;
}): WebSearchResult {
  return {
    title: 'Empresa X',
    snippet: '',
    url: 'http://empresa-x.com.co',
    metadata: { domain: 'empresa-x.com.co', apollo_profile: profile },
  } as unknown as WebSearchResult;
}

// ═══ AGENT1-MACRO-EVIDENCE-CONJUNCTION-1 ══════════════════════════════════════

describe('§ 1 — `&` y `and` son la misma conjunción', () => {
  it('🔴 la industria REAL de Apollo (`information technology & services`) CONFIRMA Tecnología', () => {
    // Ésta es la regresión exacta: en el lote, la única candidata cuya industria
    // declarada era este término salió `ambiguous`/`parent_industry_only`.
    const assessment = assessMacroIndustryEvidence({
      result: providerResult({ industry: 'information technology & services' }),
      macroIndustryDisplayName: 'Tecnología',
    });
    assert.equal(assessment.verdict, 'confirmed');
    assert.equal(assessment.reason, 'confirming_term_in_declared_evidence');
    assert.ok(assessment.matchedConfirmingTerms.length > 0);
  });

  it('la forma con `and` sigue confirmando: el cambio no sustituye, une', () => {
    const assessment = assessMacroIndustryEvidence({
      result: providerResult({ industry: 'information technology and services' }),
      macroIndustryDisplayName: 'Tecnología',
    });
    assert.equal(assessment.verdict, 'confirmed');
  });

  it('🔴 corta también hacia el RECHAZO: una exclusión escrita con `and` rechaza la forma con `&`', () => {
    // `health_pharma.excludingIndustries` incluye `marketing and advertising`.
    // Apollo la declara `marketing & advertising`. Antes no coincidía y el
    // candidato se escapaba del rechazo.
    const assessment = assessMacroIndustryEvidence({
      result: providerResult({ industry: 'marketing & advertising' }),
      macroIndustryDisplayName: 'Salud & Farmacéuticos',
    });
    assert.equal(assessment.verdict, 'rejected');
    assert.equal(assessment.reason, 'excluding_industry_declared');
  });

  it('la normalización es simétrica y no pega palabras', () => {
    assert.equal(
      normalizeMacroIndustryLabel('Information Technology & Services'),
      normalizeMacroIndustryLabel('information technology and services'),
    );
    // Sin espacios alrededor del `&`, la conjunción sigue siendo una palabra.
    assert.equal(normalizeMacroIndustryLabel('A&B'), 'a and b');
  });

  it('🔴 la macro PEDIDA sigue sin ser evidencia: sin datos del proveedor no confirma', () => {
    const assessment = assessMacroIndustryEvidence({
      result: providerResult({}),
      macroIndustryDisplayName: 'Tecnología',
    });
    assert.equal(assessment.verdict, 'ambiguous');
    assert.equal(assessment.reason, 'no_provider_evidence');
  });

  it('🔴 la industria padre sola SIGUE siendo ambigua: `technology` a secas no acredita', () => {
    const assessment = assessMacroIndustryEvidence({
      result: providerResult({ industry: 'technology' }),
      macroIndustryDisplayName: 'Tecnología',
    });
    assert.equal(assessment.verdict, 'ambiguous');
    assert.equal(assessment.reason, 'parent_industry_only');
  });
});

// ═══ AGENT1-SIZE-EVIDENCE-PARITY-1 ════════════════════════════════════════════

/** Entrada mínima con todo lo demás satisfecho, para aislar la condición de tamaño. */
function sizeCase(input: {
  employeeCountStatus: CompanyFieldMappingStatus;
  icpSizeConfirmedAboveThreshold?: boolean;
}) {
  return evaluateCandidateSubindustryTargetEligibility({
    persistenceSuccess: true,
    sectorEvidenceState: 'sector_evidence_confirmed',
    requestedSubindustries: [],
    subindustryPrecision: null,
    employeeCountStatus: input.employeeCountStatus,
    ...(input.icpSizeConfirmedAboveThreshold !== undefined
      ? { icpSizeConfirmedAboveThreshold: input.icpSizeConfirmedAboveThreshold }
      : {}),
    linkedinStatus: 'confirmed',
    duplicateStatus: 'no_match',
    ownershipGate: 'pass',
    qualityGate: 'pass',
  });
}

describe('§ 2 — el tamaño acreditado por una fuente admitida cuenta', () => {
  it('🔴 tamaño confirmado por el gate ICP (p. ej. HubSpot) satisface la condición', () => {
    // Las cinco del lote con 500/1000/1477/2000/100000 empleados vía HubSpot:
    // `icp_size_gate` las declaró `confirmed_above_threshold` y el contrato las
    // bloqueaba porque Apollo no había devuelto el campo.
    const result = sizeCase({
      employeeCountStatus: 'not_returned',
      icpSizeConfirmedAboveThreshold: true,
    });
    assert.ok(!result.blockingReasons.includes('employee_count_status'));
    assert.equal(result.completeValid, true);
  });

  it('la vía del proveedor sigue valiendo por sí sola', () => {
    const result = sizeCase({ employeeCountStatus: 'confirmed' });
    assert.ok(!result.blockingReasons.includes('employee_count_status'));
  });

  it('🔴 sin acreditación, el comportamiento histórico es EXACTO: bloquea', () => {
    const omitted = sizeCase({ employeeCountStatus: 'not_returned' });
    assert.ok(omitted.blockingReasons.includes('employee_count_status'));
    assert.equal(omitted.completeValid, false);

    const explicitlyFalse = sizeCase({
      employeeCountStatus: 'not_returned',
      icpSizeConfirmedAboveThreshold: false,
    });
    assert.ok(explicitlyFalse.blockingReasons.includes('employee_count_status'));
  });

  it('🔴 desconocido NO completa y un tamaño por DEBAJO del umbral tampoco', () => {
    // Las dos llegan aquí como `false` porque el productor (el writer) sólo pasa
    // `true` con `action === 'pass'` y `size_status` por ENCIMA del umbral.
    for (const status of ['not_returned', 'invalid', 'mapping_failed'] as const) {
      const result = sizeCase({ employeeCountStatus: status, icpSizeConfirmedAboveThreshold: false });
      assert.ok(
        result.blockingReasons.includes('employee_count_status'),
        `${status} no puede completar`,
      );
    }
  });
});

// ═══ No-regresión de lo que NO es un defecto ══════════════════════════════════

describe('§ 3 — lo que se conserva intacto', () => {
  it('🔴 `quality_gate` sigue bloqueando: evidencia de país débil es un filtro legítimo', () => {
    // 31 de las 60 del lote. `business_fit` NO participa: la política de
    // evidencia sólo lee `countryEvidence`.
    const result = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [],
      subindustryPrecision: null,
      employeeCountStatus: 'confirmed',
      icpSizeConfirmedAboveThreshold: true,
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'fail',
    });
    assert.ok(result.blockingReasons.includes('quality_gate'));
    assert.equal(result.completeValid, false);
  });

  it('🔴 con subindustria pedida, su exigencia sigue siendo independiente', () => {
    // La macro confirmada NO sustituye a la subindustria pedida: sin precisión
    // que la confirme, sigue fail-closed.
    const result = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: ['Ciberseguridad'],
      subindustryPrecision: null,
      employeeCountStatus: 'confirmed',
      icpSizeConfirmedAboveThreshold: true,
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.ok(result.blockingReasons.includes('subindustry_match'));
    assert.equal(result.subindustryMatch, 'evaluation_unavailable');
    assert.equal(result.completeValid, false);
  });

  it('sin subindustria pedida no se exige confirmar ninguna subindustria', () => {
    const result = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [],
      subindustryPrecision: null,
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(result.subindustryRequirementApplied, false);
    assert.equal(result.subindustryMatch, 'not_requested');
    assert.equal(result.completeValid, true);
  });

  it('🔴 y la macro SÍ debe acreditarse: sin acreditación no cuenta, aunque no haya subindustria', () => {
    const result = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_not_mapped',
      requestedSubindustries: [],
      subindustryPrecision: null,
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.ok(result.blockingReasons.includes('subindustry_match'));
    assert.equal(result.completeValid, false);
  });
});

// ═══ AGENT1-ENRICHMENT-SELECTION-TARGET-VALUE-1 ═══════════════════════════════
//
// El tercer defecto del mismo lote: 3 de los 5 créditos fueron a candidatas cuya
// evidencia de país ya era débil — `quality_gate: fail` — y ningún perfil
// comprado podía cambiarlo. El veredicto lo calculaba el propio runner, gratis,
// unas líneas más arriba; la selección no lo miraba.

/** Candidato con TODO en orden salvo lo que cada prueba cambie. */
function poolCandidate(overrides: Partial<FreeCandidateSignals> = {}): FreeCandidateSignals {
  return {
    candidateKey: 'apollo:x',
    roundNumber: 1,
    providerRank: 1,
    countryCompatible: true,
    domainConfident: true,
    ownershipConfident: true,
    sectorKeywordMatchCount: 0,
    novel: true,
    hasCompanySizeSignal: false,
    hasLocationSignal: false,
    hasLinkedInUrl: true,
    freeOfContradictoryEvidence: true,
    sectorEvidenceState: 'sector_evidence_missing_bootstrap_eligible',
    knownDuplicate: false,
    cooldownActive: false,
    declaredSectorContradiction: false,
    ...overrides,
  };
}

describe('§ 4 — recuperable vs no recuperable', () => {
  it('🔴 la evidencia de país NO la puede cambiar la compra', () => {
    // `evaluateCountryEvidence` lee website/domain/snippet/title/query, todos de
    // la BÚSQUEDA, y `mergeEnrichmentIntoResult` sólo rellena claves vacías.
    assert.equal(isQualityBlockRecoverableByEnrichment('evidence_policy:country_evidence_weak'), false);
    assert.equal(isQualityBlockRecoverableByEnrichment('evidence_policy:cualquier_otra_causa'), false);
  });

  it('🔴 el tamaño bajo umbral SÍ es recuperable: el perfil comprado tiene prioridad máxima', () => {
    // `richProfileSize` va por delante de `candidate_company_size` y de HubSpot
    // en `resolveEmployeeSizeForIcpGate`. El fail previo al writer es la
    // proyección conservadora, no la última palabra.
    assert.equal(isQualityBlockRecoverableByEnrichment('icp_size_below_threshold'), true);
  });

  it('🔴 fail-open: un motivo nuevo o ausente no cancela la compra en silencio', () => {
    for (const reason of [null, undefined, '', '   ', 'motivo_que_todavia_no_existe']) {
      assert.equal(isQualityBlockRecoverableByEnrichment(reason), true, `${String(reason)}`);
    }
  });

  it('un bloqueo IRRECUPERABLE descalifica el gasto, y lo dice con su nombre', () => {
    const need = evaluateApolloEnrichmentNeed(
      poolCandidate({
        qualityGateVerdict: 'fail',
        qualityGateBlockingReason: 'evidence_policy:country_evidence_weak',
      }),
    );
    assert.equal(need.eligibleForEnrichment, false);
    assert.equal(need.disqualifiedReason, 'target_acceptance_irrecoverable');
    // Es el campo que ya prometía responder esta pregunta.
    assert.equal(need.expectedTargetValue, 'no_target_value');
  });

  it('🔴 un bloqueo RECUPERABLE sigue compitiendo: es evidencia pendiente, no un rechazo', () => {
    const need = evaluateApolloEnrichmentNeed(
      poolCandidate({
        qualityGateVerdict: 'fail',
        qualityGateBlockingReason: 'icp_size_below_threshold',
      }),
    );
    assert.equal(need.eligibleForEnrichment, true);
    assert.equal(need.expectedTargetValue, 'contributes_to_target');
  });

  it('🔴 sin veredicto, el comportamiento es EXACTO al anterior', () => {
    for (const verdict of [undefined, 'pass', 'unknown'] as const) {
      const need = evaluateApolloEnrichmentNeed(
        poolCandidate(verdict === undefined ? {} : { qualityGateVerdict: verdict }),
      );
      assert.equal(need.eligibleForEnrichment, true, `${String(verdict)}`);
    }
  });

  it('🔴 sin dominio manda `domain_not_confident`: la irrecuperabilidad se apoya en tenerlo', () => {
    // El orden importa. La evidencia de país es irrecuperable PORQUE el dominio
    // ya existe y la mezcla no reescribe claves llenas; delante de esa
    // comprobación la premisa no estaría garantizada.
    const need = evaluateApolloEnrichmentNeed(
      poolCandidate({
        domainConfident: false,
        qualityGateVerdict: 'fail',
        qualityGateBlockingReason: 'evidence_policy:country_evidence_weak',
      }),
    );
    assert.equal(need.disqualifiedReason, 'domain_not_confident');
  });
});

describe('§ 5 — la selección bajo cupo, con el selector real', () => {
  /** Reproduce la forma del lote: mismas señales, desempate por rango. */
  const pool = (quality: readonly ('pass' | 'fail')[]): FreeCandidateSignals[] =>
    quality.map((q, index) =>
      poolCandidate({
        candidateKey: `apollo:${index}`,
        providerRank: index + 1,
        qualityGateVerdict: q,
        ...(q === 'fail' ? { qualityGateBlockingReason: 'evidence_policy:country_evidence_weak' } : {}),
      }),
    );

  const select = (candidates: FreeCandidateSignals[], budget: number) =>
    selectCandidatesForEnrichment({
      candidates,
      remainingEnrichmentBudget: budget,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

  it('🔴 el cupo se gasta en quien puede contar, no en los primeros del ranking', () => {
    // Forma exacta del lote medido: los bloqueados ocupan las primeras
    // posiciones y desplazan a candidatas que sí podían llegar.
    const result = select(pool(['fail', 'fail', 'pass', 'fail', 'pass', 'pass', 'pass']), 3);
    assert.deepEqual(
      result.selected.map((s) => s.candidateKey),
      ['apollo:2', 'apollo:4', 'apollo:5'],
    );
    assert.equal(
      result.skipped.filter((s) => s.skippedReason === 'target_acceptance_irrecoverable').length,
      3,
    );
  });

  it('🔴 sin veredicto de calidad, la selección es la de siempre', () => {
    const sinVeredicto = pool(['fail', 'fail', 'pass']).map((signals) => {
      const copy = { ...signals };
      delete copy.qualityGateVerdict;
      delete copy.qualityGateBlockingReason;
      return copy;
    });
    const result = select(sinVeredicto, 2);
    assert.deepEqual(
      result.selected.map((s) => s.candidateKey),
      ['apollo:0', 'apollo:1'],
    );
  });

  it('no se inventan candidatas: si todas están bloqueadas, no se gasta nada', () => {
    const result = select(pool(['fail', 'fail', 'fail']), 3);
    assert.equal(result.selected.length, 0);
    assert.equal(result.remainingEnrichmentBudget, 3);
  });
});
