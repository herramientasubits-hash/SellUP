/**
 * Tests — AGENT1-APOLLO-SECTOR-EVIDENCE-BOOTSTRAP-1.
 *
 * El bloqueo que se cierra, con los datos de la corrida real `f4c8a60f` (Salud,
 * CO, 2026-08-12): `mixed_companies/search` no devolvió un solo campo
 * clasificatorio, `SECTOR_SIGNAL_TERMS` no tiene política para Salud, y el
 * veredicto `sector_not_mapped` era terminal ANTES del enrichment. Resultado: la
 * evidencia necesaria para juzgar el sector no se podía adquirir nunca.
 *
 * Lo que estos tests fijan, en las dos direcciones:
 *
 *   - un sector sin política PUEDE competir por los <= 5 enrichments cuando la
 *     corrida está autorizada y el proveedor no declaró nada;
 *   - y NO puede en cuanto falla una precondición, hay evidencia declarada, o
 *     nadie comprobó las precondiciones.
 *
 * Cero llamadas al proveedor: todo sale del checkpoint real y de módulos puros.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { WebSearchResult } from '../types';
import { fromCandidateEvidenceSnapshot } from '../apollo-two-round/checkpoint';
import {
  RUN1_SALUD_COOLDOWN_DOMAINS,
  RUN1_SALUD_LIVE_OUTCOME,
  RUN1_SALUD_REQUEST,
  RUN1_SALUD_SNAPSHOTS,
} from './fixtures/apollo-run1-salud-f4c8a60f';
import {
  APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_PRECONDITIONS_KEY,
  APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
  combineApolloSectorEvidenceBootstrapAuthorizations,
  decideApolloSectorEvidenceBootstrapForCandidate,
  evaluateApolloSectorEvidenceBootstrapAuthorization,
  readApolloSectorEvidenceBootstrapPreconditionsFromMetadata,
  toApolloSectorEvidenceBootstrapPreconditionsMetadata,
  type ApolloSectorEvidenceBootstrapAuthorization,
} from '../apollo-sector-evidence-bootstrap';
import {
  evaluateApolloSectorRelevanceForPaidOperationAnyOf,
  type ApolloPaidSectorRelevanceDecision,
} from '../apollo-sector-relevance-gate';
import { evaluateApolloEnrichmentEligibility } from '../apollo-enrichment-eligibility-gate';
import {
  evaluateApolloEnrichmentNeed,
  selectCandidatesForEnrichment,
  type FreeCandidateSignals,
} from '../apollo-two-round/enrichment-ranking';
import {
  assessApolloSubindustryPrecisionForRequest,
  projectOperationalSubindustryVerdict,
} from '../apollo-subindustry-precision';
import { toSectorEvidenceState } from '../apollo-two-round/production-runner.server';

// ─── Utilidades ───────────────────────────────────────────────────────────────

const AUTHORIZED: ApolloSectorEvidenceBootstrapAuthorization = {
  authorized: true,
  reason: 'valid_catalog_criteria_with_complete_query_coverage',
};

const RUN1_RESULTS: WebSearchResult[] = RUN1_SALUD_SNAPSHOTS.map((snapshot) =>
  fromCandidateEvidenceSnapshot(snapshot.evidence),
);

function paidDecision(
  result: WebSearchResult,
  options?: { bootstrap?: ApolloSectorEvidenceBootstrapAuthorization },
): ApolloPaidSectorRelevanceDecision {
  return evaluateApolloSectorRelevanceForPaidOperationAnyOf(
    result,
    RUN1_SALUD_REQUEST.industry,
    RUN1_SALUD_REQUEST.subindustries,
    { sectorEvidenceBootstrap: options?.bootstrap ?? null },
  ).decision;
}

function eligibility(
  result: WebSearchResult,
  bootstrap: ApolloSectorEvidenceBootstrapAuthorization | null,
) {
  return evaluateApolloEnrichmentEligibility(result, {
    targetCountryCode: RUN1_SALUD_REQUEST.countryCode,
    sector: RUN1_SALUD_REQUEST.industry,
    subindustries: RUN1_SALUD_REQUEST.subindustries,
    sectorEvidenceBootstrap: bootstrap,
    // Estado real de la corrida: sin él, el replay evaluaría 18 candidatos contra
    // el veredicto sectorial donde la corrida evaluó 17.
    domainsInCooldown: RUN1_SALUD_COOLDOWN_DOMAINS,
  });
}

/** Candidato sintético con la clasificación que un enrichment habría comprado. */
function enrichedProfile(over: {
  title: string;
  domain: string;
  industry?: string | null;
  keywords?: string[];
  description?: string | null;
}): WebSearchResult {
  return {
    title: over.title,
    url: `https://${over.domain}`,
    snippet: '',
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    metadata: {
      domain: over.domain,
      industry: over.industry ?? null,
      keywords: over.keywords ?? [],
      short_description: over.description ?? null,
      apollo_profile: {
        industry: over.industry ?? null,
        industries: over.industry ? [over.industry] : [],
        keywords: over.keywords ?? [],
        organization_keywords: [],
        short_description: over.description ?? null,
        primary_domain: over.domain,
      },
    },
  } as unknown as WebSearchResult;
}

function freeSignals(over: Partial<FreeCandidateSignals> = {}): FreeCandidateSignals {
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
    hasLocationSignal: true,
    hasLinkedInUrl: true,
    freeOfContradictoryEvidence: true,
    sectorEvidenceState: 'sector_evidence_missing_bootstrap_eligible',
    knownDuplicate: false,
    cooldownActive: false,
    ...over,
  };
}

// ─── § 1 · La premisa: la búsqueda no trajo clasificación ─────────────────────

describe('RUN 1 Salud — la búsqueda no devolvió evidencia clasificatoria', () => {
  it('los 20 resultados reales llegan sin industria, keywords, descripción ni tamaño', () => {
    assert.equal(RUN1_SALUD_SNAPSHOTS.length, 20);
    for (const snapshot of RUN1_SALUD_SNAPSHOTS) {
      assert.equal(snapshot.evidence.industry, null);
      assert.deepEqual(snapshot.evidence.industries, []);
      assert.deepEqual(snapshot.evidence.keywords, []);
      assert.deepEqual(snapshot.evidence.organization_keywords, []);
      assert.equal(snapshot.evidence.short_description, null);
      assert.equal(snapshot.evidence.seo_description, null);
      assert.equal(snapshot.evidence.description, null);
      assert.equal(snapshot.evidence.employee_count, null);
    }
  });

  it('la corrida live gastó 20 créditos y no ejecutó ni un enrichment', () => {
    assert.equal(RUN1_SALUD_LIVE_OUTCOME.creditsSpent, 20);
    assert.equal(RUN1_SALUD_LIVE_OUTCOME.enrichmentsExecuted, 0);
    assert.equal(RUN1_SALUD_LIVE_OUTCOME.candidatesPersisted, 0);
  });
});

// ─── § 3 · El contrato ANTERIOR, reproducido ──────────────────────────────────

describe('RUN 1 Salud — contrato anterior (sin autorización)', () => {
  it('sin autorización, los 20 siguen siendo `sector_not_mapped`', () => {
    for (const result of RUN1_RESULTS) {
      assert.equal(paidDecision(result), 'sector_not_mapped');
    }
  });

  it('sin autorización, el gate de gasto reproduce los 17 rechazos sectoriales', () => {
    const sectorRejections = RUN1_RESULTS.filter(
      (result) => {
        const verdict = eligibility(result, null);
        return !verdict.eligible && verdict.skipReason === 'sector_not_mapped';
      },
    ).length;
    assert.equal(sectorRejections, RUN1_SALUD_LIVE_OUTCOME.sectorNotMappedRejections);
  });

  it('una autorización ausente equivale a una no autorizada', () => {
    assert.equal(APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED.authorized, false);
    for (const result of RUN1_RESULTS.slice(0, 3)) {
      assert.equal(
        paidDecision(result, { bootstrap: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED }),
        'sector_not_mapped',
      );
    }
  });
});

// ─── § 9 · El replay con el contrato NUEVO ────────────────────────────────────

describe('RUN 1 Salud — replay con adquisición autorizada', () => {
  it('los candidatos que superaron los gates baratos quedan bootstrap-eligible', () => {
    const bootstrapEligible = RUN1_RESULTS.filter(
      (result) =>
        paidDecision(result, { bootstrap: AUTHORIZED }) ===
        'sector_evidence_missing_bootstrap_eligible',
    ).length;
    // Los veinte carecen de clasificación, así que el veredicto sectorial es el
    // mismo para todos. Quién puede GASTAR lo deciden después los gates baratos.
    assert.equal(bootstrapEligible, 20);
  });

  it('el gate de gasto los declara elegibles, salvo los rechazados por país/dominio/cooldown', () => {
    const eligibleKeys: string[] = [];
    RUN1_RESULTS.forEach((result, index) => {
      const verdict = eligibility(result, AUTHORIZED);
      if (verdict.eligible) eligibleKeys.push(RUN1_SALUD_SNAPSHOTS[index]!.candidateKey);
    });

    // Los 17 que la corrida rechazó por `sector_not_mapped` ahora pueden competir.
    assert.equal(eligibleKeys.length, RUN1_SALUD_LIVE_OUTCOME.sectorNotMappedRejections);

    // Y los tres que cayeron por OTRA causa siguen fuera, con su causa intacta.
    const gloria = RUN1_SALUD_SNAPSHOTS.findIndex((s) => s.evidence.domain === 'gloria.com.pe');
    const amazon = RUN1_SALUD_SNAPSHOTS.findIndex((s) => s.evidence.domain === 'amazon.com');
    const gloriaVerdict = eligibility(RUN1_RESULTS[gloria]!, AUTHORIZED);
    const amazonVerdict = eligibility(RUN1_RESULTS[amazon]!, AUTHORIZED);
    assert.equal(gloriaVerdict.eligible, false);
    assert.equal(
      gloriaVerdict.eligible === false ? gloriaVerdict.skipReason : null,
      'tld_country_mismatch',
    );
    assert.equal(amazonVerdict.eligible, false);
    assert.equal(
      amazonVerdict.eligible === false ? amazonVerdict.skipReason : null,
      'external_platform_domain',
    );
  });

  it('la decisión de gasto declara el motivo: la búsqueda no trajo clasificación', () => {
    const verdict = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
      RUN1_RESULTS[0]!,
      RUN1_SALUD_REQUEST.industry,
      RUN1_SALUD_REQUEST.subindustries,
      { sectorEvidenceBootstrap: AUTHORIZED },
    );
    assert.equal(verdict.bootstrap?.bootstrapEligible, true);
    assert.equal(
      verdict.bootstrap?.bootstrapEligible === true ? verdict.bootstrap.reason : null,
      'provider_classification_missing',
    );
  });
});

// ─── § 7 y § 15 · Selección, cap y determinismo ───────────────────────────────

describe('Selección para los <= 5 enrichments', () => {
  const contenders: FreeCandidateSignals[] = RUN1_SALUD_SNAPSHOTS.filter(
    (snapshot) => snapshot.rejectionReason === 'sector_not_mapped',
  ).map((snapshot) =>
    freeSignals({
      candidateKey: snapshot.candidateKey,
      roundNumber: snapshot.roundNumber,
      providerRank: snapshot.providerRank,
    }),
  );

  it('nunca selecciona más de 5, aunque compitan 17', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: contenders,
      remainingEnrichmentBudget: 5,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });
    assert.equal(contenders.length, 17);
    assert.equal(selection.selected.length, 5);
    assert.equal(selection.remainingEnrichmentBudget, 0);
    assert.equal(
      selection.skipped.filter((skip) => skip.skippedReason === 'enrichment_cap_reached').length,
      12,
    );
  });

  it('la selección es determinística e invariante al orden de entrada', () => {
    const forward = selectCandidatesForEnrichment({
      candidates: contenders,
      remainingEnrichmentBudget: 5,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });
    const reversed = selectCandidatesForEnrichment({
      candidates: [...contenders].reverse(),
      remainingEnrichmentBudget: 5,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });
    assert.deepEqual(
      forward.selected.map((entry) => entry.candidateKey),
      reversed.selected.map((entry) => entry.candidateKey),
    );
  });

  it('a igualdad de puntaje, una duda MEDIBLE se resuelve antes que una sin política', () => {
    const measured = freeSignals({
      candidateKey: 'apollo:measured',
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
    });
    const bootstrapped = freeSignals({ candidateKey: 'apollo:bootstrapped' });
    const selection = selectCandidatesForEnrichment({
      candidates: [bootstrapped, measured],
      remainingEnrichmentBudget: 1,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });
    assert.deepEqual(
      selection.selected.map((entry) => entry.candidateKey),
      ['apollo:measured'],
    );
  });

  it('el motivo del gasto es resolver la evidencia sectorial que falta', () => {
    const need = evaluateApolloEnrichmentNeed(freeSignals());
    assert.equal(need.eligibleForEnrichment, true);
    assert.ok(need.missingRequiredEvidence.includes('sector_evidence'));
    assert.ok(need.enrichmentReasons.includes('resolves_missing_sector_evidence'));
  });

  it('`sector_not_mapped` sigue descalificando: sin autorización no se gasta', () => {
    const need = evaluateApolloEnrichmentNeed(
      freeSignals({ sectorEvidenceState: 'sector_not_mapped' }),
    );
    assert.equal(need.eligibleForEnrichment, false);
    assert.equal(need.disqualifiedReason, 'sector_not_mapped');
  });
});

// ─── § 5 y § 18 · Precondiciones: cuándo NO se autoriza ───────────────────────

describe('Precondiciones de la corrida', () => {
  const complete = {
    providerSearchExecuted: true,
    queryCoverageComplete: true,
    catalogVersionCoherent: true,
    catalogTermsResolved: true,
  };

  it('con las cuatro precondiciones, autoriza', () => {
    const authorization = evaluateApolloSectorEvidenceBootstrapAuthorization(complete);
    assert.equal(authorization.authorized, true);
  });

  it('cobertura de consulta incompleta ⇒ no autoriza', () => {
    const authorization = evaluateApolloSectorEvidenceBootstrapAuthorization({
      ...complete,
      queryCoverageComplete: false,
    });
    assert.equal(authorization.authorized, false);
    assert.equal(
      authorization.authorized === false ? authorization.blockReason : null,
      'query_coverage_incomplete',
    );
  });

  it('versión de catálogo incoherente ⇒ no autoriza', () => {
    const authorization = evaluateApolloSectorEvidenceBootstrapAuthorization({
      ...complete,
      catalogVersionCoherent: false,
    });
    assert.equal(authorization.authorized, false);
    assert.equal(
      authorization.authorized === false ? authorization.blockReason : null,
      'catalog_version_incoherent',
    );
  });

  it('términos sin resolver contra el catálogo activo ⇒ no autoriza', () => {
    const authorization = evaluateApolloSectorEvidenceBootstrapAuthorization({
      ...complete,
      catalogTermsResolved: false,
    });
    assert.equal(authorization.authorized, false);
    assert.equal(
      authorization.authorized === false ? authorization.blockReason : null,
      'catalog_terms_unresolved',
    );
  });

  it('sin búsqueda emitida ⇒ no autoriza', () => {
    const authorization = evaluateApolloSectorEvidenceBootstrapAuthorization({
      ...complete,
      providerSearchExecuted: false,
    });
    assert.equal(authorization.authorized, false);
    assert.equal(
      authorization.authorized === false ? authorization.blockReason : null,
      'provider_search_not_executed',
    );
  });

  it('una sola ronda bloqueada bloquea la corrida entera', () => {
    const combined = combineApolloSectorEvidenceBootstrapAuthorizations([
      evaluateApolloSectorEvidenceBootstrapAuthorization(complete),
      evaluateApolloSectorEvidenceBootstrapAuthorization({
        ...complete,
        queryCoverageComplete: false,
      }),
    ]);
    assert.equal(combined.authorized, false);
  });

  it('sin rondas, no autorizada', () => {
    assert.equal(combineApolloSectorEvidenceBootstrapAuthorizations([]).authorized, false);
  });

  it('una precondición que falta en la metadata NO se interpreta como cumplida', () => {
    const metadata = {
      [APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_PRECONDITIONS_KEY]: {
        provider_search_executed: true,
        query_coverage_complete: true,
        catalog_version_coherent: true,
        // `catalog_terms_resolved` ausente a propósito.
      },
    };
    assert.equal(readApolloSectorEvidenceBootstrapPreconditionsFromMetadata(metadata), null);
    assert.equal(readApolloSectorEvidenceBootstrapPreconditionsFromMetadata({}), null);
    assert.equal(readApolloSectorEvidenceBootstrapPreconditionsFromMetadata(null), null);
  });

  it('la metadata del provider viaja y se relee sin pérdida', () => {
    const metadata = {
      [APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_PRECONDITIONS_KEY]:
        toApolloSectorEvidenceBootstrapPreconditionsMetadata(complete),
    };
    assert.deepEqual(readApolloSectorEvidenceBootstrapPreconditionsFromMetadata(metadata), complete);
  });

  it('con precondiciones incompletas, el replay de RUN 1 vuelve al bloqueo anterior', () => {
    const blocked = evaluateApolloSectorEvidenceBootstrapAuthorization({
      ...complete,
      queryCoverageComplete: false,
    });
    for (const result of RUN1_RESULTS.slice(0, 5)) {
      assert.equal(paidDecision(result, { bootstrap: blocked }), 'sector_not_mapped');
    }
  });
});

// ─── § 5 · Evidencia declarada ⇒ no hay adquisición que autorizar ─────────────

describe('Evidencia declarada por el proveedor', () => {
  it('un candidato con industria declarada NO es bootstrap-eligible', () => {
    const declared = enrichedProfile({
      title: 'Banco X',
      domain: 'bancox.com',
      industry: 'banking',
    });
    assert.equal(paidDecision(declared, { bootstrap: AUTHORIZED }), 'sector_not_mapped');
  });

  it('el motivo del bloqueo nombra la evidencia presente, no la autorización', () => {
    const decision = decideApolloSectorEvidenceBootstrapForCandidate({
      authorization: AUTHORIZED,
      providerSectorEvidenceFields: ['industry'],
    });
    assert.equal(decision.bootstrapEligible, false);
    assert.equal(
      decision.bootstrapEligible === false ? decision.blockReason : null,
      'provider_classification_present_without_sector_policy',
    );
  });

  it('una descripción basta como evidencia declarada', () => {
    const declared = enrichedProfile({
      title: 'Compañía Y',
      domain: 'companiay.com',
      description: 'Distribuidora de alimentos',
    });
    assert.equal(paidDecision(declared, { bootstrap: AUTHORIZED }), 'sector_not_mapped');
  });
});

// ─── § 11 · El bootstrap NO confirma ──────────────────────────────────────────

describe('El bootstrap no confirma nada', () => {
  it('el estado sectorial que produce no es el confirmado', () => {
    assert.equal(
      toSectorEvidenceState('sector_evidence_missing_bootstrap_eligible'),
      'sector_evidence_missing_bootstrap_eligible',
    );
    assert.notEqual(
      toSectorEvidenceState('sector_evidence_missing_bootstrap_eligible'),
      'sector_evidence_confirmed',
    );
  });

  it('pedir la industria Salud no confirma ninguna subindustria de Salud', () => {
    for (const result of RUN1_RESULTS) {
      const precision = assessApolloSubindustryPrecisionForRequest(
        result,
        RUN1_SALUD_REQUEST.subindustries,
      );
      assert.notEqual(precision.subindustryMatch, 'confirmed');
      assert.equal(precision.matchedRequestedSubindustry, null);
    }
  });
});

// ─── § 10 y § 8 · Reevaluación posterior al enrichment ────────────────────────

describe('Post-enrichment — el perfil comprado decide, no la industria pedida', () => {
  const confirmedFor = (result: WebSearchResult): string | null =>
    assessApolloSubindustryPrecisionForRequest(result, RUN1_SALUD_REQUEST.subindustries)
      .matchedRequestedSubindustry;

  it('A · red hospitalaria real ⇒ confirma Redes Hospitalarias', () => {
    const result = enrichedProfile({
      title: 'Grupo Salud CO',
      domain: 'gruposaludco.com',
      industry: 'hospital & health care',
      keywords: ['red hospitalaria', 'grupo hospitalario'],
    });
    assert.equal(confirmedFor(result), 'Redes Hospitalarias y Clínicas');
  });

  it('B · laboratorio real ⇒ confirma Laboratorios Clínicos', () => {
    const result = enrichedProfile({
      title: 'Laboratorio CO',
      domain: 'laboratorioco.com',
      industry: 'hospital & health care',
      keywords: ['laboratorio clinico', 'diagnostico clinico'],
    });
    assert.equal(confirmedFor(result), 'Laboratorios Clínicos y Diagnóstico');
  });

  it('C · EPS real ⇒ confirma Medicina Prepagada y EPS', () => {
    const result = enrichedProfile({
      title: 'EPS CO',
      domain: 'epsco.com',
      industry: 'hospital & health care',
      keywords: ['entidad promotora de salud', 'medicina prepagada'],
    });
    assert.equal(confirmedFor(result), 'Medicina Prepagada y EPS');
  });

  it('D · sólo la industria PADRE ⇒ ninguna subindustria confirma', () => {
    const result = enrichedProfile({
      title: 'Salud Genérica',
      domain: 'saludgenerica.com',
      industry: 'hospital & health care',
      keywords: [],
    });
    assert.equal(confirmedFor(result), null);
  });

  it('E · un laboratorio NO confirma redes hospitalarias ni EPS', () => {
    const result = enrichedProfile({
      title: 'Laboratorio CO',
      domain: 'laboratorioco.com',
      industry: 'hospital & health care',
      keywords: ['laboratorio clinico'],
    });
    const precision = assessApolloSubindustryPrecisionForRequest(result, [
      'Redes Hospitalarias y Clínicas',
      'Medicina Prepagada y EPS',
    ]);
    assert.notEqual(precision.subindustryMatch, 'confirmed');
  });

  it('las ramas negativas de una regla `confirm_only` siguen ABSTENIÉNDOSE', () => {
    const result = enrichedProfile({
      title: 'Salud Genérica',
      domain: 'saludgenerica.com',
      industry: 'hospital & health care',
    });
    const precision = assessApolloSubindustryPrecisionForRequest(
      result,
      RUN1_SALUD_REQUEST.subindustries,
    );
    const operational = projectOperationalSubindustryVerdict(precision);
    assert.equal(operational.subindustryMapped, false);
    assert.equal(operational.precisionMode, null);
  });

  it('una rama negativa `confirm_only` NO es lo que autoriza el gasto', () => {
    // El motivo económico es la AUSENCIA de clasificación del proveedor, no un
    // diagnóstico `ambiguous` de precisión: sin autorización, el mismo candidato
    // ambiguo no puede gastar.
    const result = RUN1_RESULTS[0]!;
    const precision = assessApolloSubindustryPrecisionForRequest(
      result,
      RUN1_SALUD_REQUEST.subindustries,
    );
    assert.equal(precision.subindustryMatch, 'ambiguous');
    assert.equal(paidDecision(result, { bootstrap: null ?? undefined }), 'sector_not_mapped');
  });
});

// ─── § 12 · Retail: cero deriva ───────────────────────────────────────────────

describe('Paridad de Retail — las rutas con política no cambian', () => {
  const RETAIL = {
    sector: 'Retail y Consumo',
    subindustries: ['Supermercados e Hipermercados'],
  };

  const decide = (
    result: WebSearchResult,
    bootstrap: ApolloSectorEvidenceBootstrapAuthorization | null,
  ): ApolloPaidSectorRelevanceDecision =>
    evaluateApolloSectorRelevanceForPaidOperationAnyOf(
      result,
      RETAIL.sector,
      RETAIL.subindustries,
      { sectorEvidenceBootstrap: bootstrap },
    ).decision;

  const CASES: Array<{ name: string; result: WebSearchResult; expected: ApolloPaidSectorRelevanceDecision }> = [
    {
      name: 'supermercado declarado ⇒ relevante',
      result: enrichedProfile({
        title: 'Cadena de Supermercados CO',
        domain: 'supermercadosco.com',
        industry: 'retail',
        keywords: ['supermercado'],
      }),
      expected: 'relevant',
    },
    {
      name: 'sin evidencia ⇒ falta evidencia, con política',
      result: enrichedProfile({ title: 'Almacenes CO', domain: 'almacenesco.com' }),
      expected: 'sector_evidence_missing_needs_enrichment',
    },
    {
      name: 'banca minorista ⇒ contradicho',
      result: enrichedProfile({
        title: 'Citigroup',
        domain: 'citigroup.com',
        industry: 'retail banking',
      }),
      expected: 'sector_relevance_contradicted',
    },
  ];

  for (const testCase of CASES) {
    it(`${testCase.name} — idéntico con y sin autorización`, () => {
      assert.equal(decide(testCase.result, null), testCase.expected);
      assert.equal(decide(testCase.result, AUTHORIZED), testCase.expected);
    });
  }

  it('un candidato Retail sin evidencia NO se convierte en bootstrap', () => {
    const result = enrichedProfile({ title: 'Almacenes CO', domain: 'almacenesco.com' });
    const verdict = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
      result,
      RETAIL.sector,
      RETAIL.subindustries,
      { sectorEvidenceBootstrap: AUTHORIZED },
    );
    assert.equal(verdict.decision, 'sector_evidence_missing_needs_enrichment');
    assert.equal(verdict.bootstrap, undefined);
  });
});

// ─── § 13 · Genérico entre industrias ─────────────────────────────────────────

describe('Genérico — cualquier industria válida del catálogo, sin entradas a mano', () => {
  // Ninguna de estas tres tiene entrada en `SECTOR_SIGNAL_TERMS`, y este hito no
  // les añade una: lo que cambia es el mecanismo, no el catálogo.
  const WITHOUT_SECTOR_POLICY: Array<{ sector: string; subindustries: string[] }> = [
    { sector: 'Salud', subindustries: ['Redes Hospitalarias y Clínicas'] },
    { sector: 'Servicios Financieros', subindustries: ['Banca Tradicional'] },
    { sector: 'Tecnología', subindustries: ['Ciberseguridad'] },
  ];

  const undisclosed = enrichedProfile({ title: 'Empresa CO', domain: 'empresaco.com' });

  for (const search of WITHOUT_SECTOR_POLICY) {
    it(`${search.sector} — sin autorización se bloquea, con autorización compite`, () => {
      const blocked = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
        undisclosed,
        search.sector,
        search.subindustries,
        { sectorEvidenceBootstrap: null },
      ).decision;
      const authorized = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
        undisclosed,
        search.sector,
        search.subindustries,
        { sectorEvidenceBootstrap: AUTHORIZED },
      ).decision;
      assert.equal(blocked, 'sector_not_mapped');
      assert.equal(authorized, 'sector_evidence_missing_bootstrap_eligible');
    });
  }

  it('Educación SÍ tiene política de sector, y por eso el bootstrap no la toca', () => {
    // El control de la simetría: donde ya hay política, la ausencia de evidencia
    // ya tenía nombre (`…needs_enrichment`) y el hito no la renombra ni la mueve.
    const search = { sector: 'Educación', subindustries: ['Universidades e Institutos Privados'] };
    const withoutAuthorization = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
      undisclosed,
      search.sector,
      search.subindustries,
      { sectorEvidenceBootstrap: null },
    );
    const withAuthorization = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
      undisclosed,
      search.sector,
      search.subindustries,
      { sectorEvidenceBootstrap: AUTHORIZED },
    );
    assert.equal(withoutAuthorization.decision, 'sector_evidence_missing_needs_enrichment');
    assert.equal(withAuthorization.decision, 'sector_evidence_missing_needs_enrichment');
    assert.equal(withAuthorization.bootstrap, undefined);
  });
});

// ─── § 16 · Reconciliación terminal ───────────────────────────────────────────

describe('Reconciliación terminal', () => {
  it('el estado de bootstrap es INTERMEDIO: tras el enrichment ya no existe', () => {
    // Post-enrichment el runner evalúa SIN autorización, así que el mismo
    // candidato —con o sin evidencia comprada— termina en un estado del
    // vocabulario anterior, nunca en el de bootstrap.
    const stillUndisclosed = paidDecision(RUN1_RESULTS[0]!, {
      bootstrap: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
    });
    const nowDisclosed = paidDecision(
      enrichedProfile({
        title: 'Grupo Salud CO',
        domain: 'gruposaludco.com',
        industry: 'hospital & health care',
        keywords: ['red hospitalaria'],
      }),
      { bootstrap: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED },
    );
    assert.equal(stillUndisclosed, 'sector_not_mapped');
    assert.equal(nowDisclosed, 'sector_not_mapped');
  });

  it('cada candidato termina en exactamente un estado sectorial', () => {
    const KNOWN = new Set([
      'sector_evidence_confirmed',
      'sector_evidence_missing_needs_enrichment',
      'sector_evidence_contradictory',
      'sector_not_mapped',
      'sector_evidence_missing_bootstrap_eligible',
    ]);
    for (const result of RUN1_RESULTS) {
      const state = toSectorEvidenceState(paidDecision(result, { bootstrap: AUTHORIZED }));
      assert.ok(KNOWN.has(state));
    }
  });
});
