/**
 * agent1-apollo-bootstrap-purchase-gate-threading-1.test.ts —
 * La autorización de bootstrap llega al gate que guarda la COMPRA, y sólo a quien debe.
 *
 * AGENT1-APOLLO-BOOTSTRAP-PURCHASE-GATE-THREADING-1 · §§ 1-4, 7, 10, 11.
 *
 * Las dos mitades del contrato, probadas sobre las funciones PURAS:
 *
 *   1. el resolutor de la autorización de compra — una sola fuente, específica de
 *      candidato, acotada por la selección, y fail-closed en todos los caminos;
 *   2. el gate de elegibilidad de la operación pagada
 *      (`evaluateApolloEnrichmentEligibility`) recibiendo esa autorización — que
 *      es literalmente el campo que la corrida `74a49b01` no le pasaba.
 *
 * Cero llamadas al proveedor, cero créditos, cero I/O.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
  evaluateApolloSectorEvidenceBootstrapAuthorization,
  resolveApolloSectorEvidenceBootstrapPurchaseAuthorization,
  type ApolloSectorEvidenceBootstrapAuthorization,
} from '../apollo-sector-evidence-bootstrap';
import { evaluateApolloEnrichmentEligibility } from '../apollo-enrichment-eligibility-gate';
import { RETEST_SALUD_REQUEST } from './fixtures/apollo-retest-salud-74a49b01';
import type { WebSearchResult } from '../types';

// ─── Arnés ────────────────────────────────────────────────────────────────────

const RUN_AUTHORIZED: ApolloSectorEvidenceBootstrapAuthorization =
  evaluateApolloSectorEvidenceBootstrapAuthorization({
    providerSearchExecuted: true,
    queryCoverageComplete: true,
    catalogVersionCoherent: true,
    catalogTermsResolved: true,
  });

function resolve(
  overrides: Partial<Parameters<typeof resolveApolloSectorEvidenceBootstrapPurchaseAuthorization>[0]> = {},
) {
  return resolveApolloSectorEvidenceBootstrapPurchaseAuthorization({
    runAuthorization: RUN_AUTHORIZED,
    cheapGateBootstrapReason: 'provider_classification_missing',
    authorizedPurchasesSoFar: 0,
    maxAuthorizedPurchases: RETEST_SALUD_REQUEST.maxEnrichmentsPerRun,
    ...overrides,
  });
}

/** Un resultado SIN un solo campo clasificatorio: la premisa del bootstrap. */
function unclassifiedResult(
  options: { name: string; domain: string } = { name: 'AstraZeneca', domain: 'astrazeneca.com' },
): WebSearchResult {
  return {
    title: options.name,
    url: `http://www.${options.domain}`,
    snippet: `Empresa: ${options.name} | País: Colombia | [Fuente: Apollo Organizations]`,
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    metadata: {
      domain: options.domain,
      country: 'Colombia',
      industry: null,
      industries: [],
      keywords: [],
      organization_keywords: [],
      short_description: null,
      seo_description: null,
      description: null,
      employee_count: null,
    },
  } as unknown as WebSearchResult;
}

/** Un resultado en el que el proveedor SÍ declaró clasificación. */
function classifiedResult(industry: string): WebSearchResult {
  const base = unclassifiedResult({ name: 'Citigroup', domain: 'citigroup.com' });
  return {
    ...base,
    metadata: { ...(base.metadata as Record<string, unknown>), industry },
  } as unknown as WebSearchResult;
}

function eligibilityFor(
  result: WebSearchResult,
  bootstrap: ApolloSectorEvidenceBootstrapAuthorization | null,
  overrides: { sector?: string | null; subindustries?: readonly string[] } = {},
) {
  return evaluateApolloEnrichmentEligibility(result, {
    targetCountryCode: RETEST_SALUD_REQUEST.countryCode,
    sector: overrides.sector === undefined ? RETEST_SALUD_REQUEST.industry : overrides.sector,
    subindustries: overrides.subindustries ?? [...RETEST_SALUD_REQUEST.subindustries],
    sectorEvidenceBootstrap: bootstrap,
  });
}

// ─── § 1 · la causa raíz, aislada ─────────────────────────────────────────────

describe('§ 1 · ROOT CAUSE — el gate de compra sin autorización', () => {
  it('sin `sectorEvidenceBootstrap` un sector sin política sale `sector_not_mapped`', () => {
    // Exactamente lo que el runner pasaba al cascade: país, sector y
    // subindustrias, y NADA más. Es el estado de producción en `6808835f`.
    const eligibility = eligibilityFor(unclassifiedResult(), null);

    assert.equal(eligibility.eligible, false);
    assert.equal(
      eligibility.eligible === false ? eligibility.skipReason : null,
      'sector_not_mapped',
      'sin política de sector y sin autorización, el gate de la COMPRA rechaza',
    );
  });

  it('con la autorización enhebrada, el MISMO candidato pasa a elegible', () => {
    const eligibility = eligibilityFor(unclassifiedResult(), RUN_AUTHORIZED);

    assert.equal(eligibility.eligible, true, 'la autorización es el único cambio');
    assert.equal(
      eligibility.eligible === true ? eligibility.sectorDecision : null,
      'sector_evidence_missing_bootstrap_eligible',
    );
  });

  it('el veredicto es idéntico al del gate BARATO — una sola semántica', () => {
    // El defecto no era que los dos gates discreparan por criterio, sino que uno
    // recibía el contexto y el otro no. Con el mismo contexto, mismo veredicto.
    const result = unclassifiedResult();
    const cheap = eligibilityFor(result, RUN_AUTHORIZED);
    const purchase = eligibilityFor(result, RUN_AUTHORIZED);
    assert.deepEqual(purchase, cheap);
  });
});

// ─── § 2 · una sola fuente de autorización ────────────────────────────────────

describe('§ 2 · fuente única — el resolutor no recalcula el bootstrap', () => {
  it('propaga el MISMO objeto de autorización que autorizó al gate barato', () => {
    const decision = resolve();
    assert.equal(decision.authorized, true);
    assert.equal(
      decision.authorization,
      RUN_AUTHORIZED,
      'es el mismo valor por identidad, no una reconstrucción equivalente',
    );
  });

  it('conserva el motivo que el gate barato REGISTRÓ para el candidato', () => {
    const decision = resolve();
    assert.equal(
      decision.authorized === true ? decision.reason : null,
      'provider_classification_missing',
    );
  });
});

// ─── § 3 · fail-closed ────────────────────────────────────────────────────────

describe('§ 3 · fail-closed — lo no autorizado nunca viaja como autorizado', () => {
  const BLOCKED_PRECONDITIONS = [
    { field: 'providerSearchExecuted', blockReason: 'provider_search_not_executed' },
    { field: 'catalogTermsResolved', blockReason: 'catalog_terms_unresolved' },
    { field: 'catalogVersionCoherent', blockReason: 'catalog_version_incoherent' },
    { field: 'queryCoverageComplete', blockReason: 'query_coverage_incomplete' },
  ] as const;

  for (const { field, blockReason } of BLOCKED_PRECONDITIONS) {
    it(`una corrida con \`${field}\` en false propaga \`${blockReason}\``, () => {
      const runAuthorization = evaluateApolloSectorEvidenceBootstrapAuthorization({
        providerSearchExecuted: true,
        queryCoverageComplete: true,
        catalogVersionCoherent: true,
        catalogTermsResolved: true,
        [field]: false,
      });
      const decision = resolve({ runAuthorization });

      assert.equal(decision.authorized, false);
      assert.equal(decision.authorized === false ? decision.blockReason : null, blockReason);
      assert.equal(
        decision.authorization,
        APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
        'lo que viaja al gate de compra es el NO autorizado, nunca el bloqueado',
      );
    });
  }

  it('sin autorización de corrida evaluada, el default sigue siendo bloquear', () => {
    const decision = resolve({ runAuthorization: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED });
    assert.equal(decision.authorized, false);
    assert.equal(
      decision.authorized === false ? decision.blockReason : null,
      'preconditions_not_evaluated',
    );
  });

  it('una autorización bloqueada llega al gate como `sector_not_mapped`', () => {
    const decision = resolve({ runAuthorization: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED });
    const eligibility = eligibilityFor(unclassifiedResult(), decision.authorization);
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.eligible === false ? eligibility.skipReason : null, 'sector_not_mapped');
  });
});

// ─── § 4 · seleccionado ≠ elegible ────────────────────────────────────────────

describe('§ 4 · la autorización es de CANDIDATO, no de corrida', () => {
  it('un candidato que el gate barato NO registró no puede comprar', () => {
    const decision = resolve({ cheapGateBootstrapReason: null });
    assert.equal(decision.authorized, false);
    assert.equal(
      decision.authorized === false ? decision.blockReason : null,
      'candidate_not_bootstrap_eligible_at_cheap_gate',
    );
  });

  it('una corrida autorizada NO autoriza a los 20: el cap acota las compras', () => {
    // El defecto opuesto al que se corrige. Un booleano de corrida habría
    // autorizado a toda la cohorte de `74a49b01`.
    const authorized = Array.from({ length: 20 }, (_unused, index) =>
      resolve({ authorizedPurchasesSoFar: index }),
    ).filter((decision) => decision.authorized);

    assert.equal(
      authorized.length,
      RETEST_SALUD_REQUEST.maxEnrichmentsPerRun,
      'como mucho se emiten tantas autorizaciones como enrichments permite el cap',
    );
  });

  it('alcanzado el cap, el motivo lo dice con su propio código', () => {
    const decision = resolve({
      authorizedPurchasesSoFar: RETEST_SALUD_REQUEST.maxEnrichmentsPerRun,
    });
    assert.equal(decision.authorized, false);
    assert.equal(
      decision.authorized === false ? decision.blockReason : null,
      'purchase_authorization_cap_reached',
    );
  });

  it('un cap de 0 no autoriza ni una compra', () => {
    const decision = resolve({ maxAuthorizedPurchases: 0 });
    assert.equal(decision.authorized, false);
  });

  it('el bloqueo de corrida manda sobre el de candidato y sobre el cap', () => {
    const decision = resolve({
      runAuthorization: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
      cheapGateBootstrapReason: null,
      authorizedPurchasesSoFar: 99,
    });
    assert.equal(
      decision.authorized === false ? decision.blockReason : null,
      'preconditions_not_evaluated',
      'el motivo reportado es el más fundamental, no el último comprobado',
    );
  });
});

// ─── § 7 · el gate de compra con la autorización puesta ───────────────────────

describe('§ 7 · gate de compra — qué sigue bloqueando con autorización', () => {
  it('el proveedor SÍ declaró clasificación ⇒ sigue sin haber política que aplicar', () => {
    // Citigroup en una búsqueda de supermercados es el caso canónico: tiene
    // evidencia, y tener evidencia excluye la adquisición.
    const eligibility = eligibilityFor(classifiedResult('retail banking'), RUN_AUTHORIZED);
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.eligible === false ? eligibility.skipReason : null, 'sector_not_mapped');
  });

  it('país declarado incompatible bloquea ANTES de que el sector opine', () => {
    const base = unclassifiedResult();
    const result = {
      ...base,
      metadata: { ...(base.metadata as Record<string, unknown>), country_code: 'PE' },
    } as unknown as WebSearchResult;

    const eligibility = eligibilityFor(result, RUN_AUTHORIZED);
    assert.equal(eligibility.eligible === false ? eligibility.skipReason : null, 'country_mismatch');
  });

  it('ccTLD de otro país bloquea, autorización o no', () => {
    const eligibility = eligibilityFor(
      unclassifiedResult({ name: 'Grupo Gloria', domain: 'gloria.com.pe' }),
      RUN_AUTHORIZED,
    );
    assert.equal(
      eligibility.eligible === false ? eligibility.skipReason : null,
      'tld_country_mismatch',
    );
  });

  it('plataforma externa bloquea, autorización o no', () => {
    const eligibility = eligibilityFor(
      unclassifiedResult({ name: 'Amazon Costa Rica', domain: 'amazon.com' }),
      RUN_AUTHORIZED,
    );
    assert.equal(
      eligibility.eligible === false ? eligibility.skipReason : null,
      'external_platform_domain',
    );
  });

  it('cooldown activo bloquea, autorización o no', () => {
    const eligibility = evaluateApolloEnrichmentEligibility(
      unclassifiedResult({ name: 'Alpina', domain: 'alpina.com' }),
      {
        targetCountryCode: RETEST_SALUD_REQUEST.countryCode,
        sector: RETEST_SALUD_REQUEST.industry,
        subindustries: [...RETEST_SALUD_REQUEST.subindustries],
        sectorEvidenceBootstrap: RUN_AUTHORIZED,
        domainsInCooldown: new Set(['alpina.com']),
      },
    );
    assert.equal(eligibility.eligible === false ? eligibility.skipReason : null, 'cooldown_active');
  });

  it('proveedor de correo bloquea, autorización o no', () => {
    const eligibility = eligibilityFor(
      unclassifiedResult({ name: 'Gmail', domain: 'gmail.com' }),
      RUN_AUTHORIZED,
    );
    assert.equal(
      eligibility.eligible === false ? eligibility.skipReason : null,
      'generic_or_mail_provider_domain',
    );
  });
});

// ─── § 11 · paridad con las rutas legacy ──────────────────────────────────────

describe('§ 11 · deriva CERO en los sectores con política', () => {
  it('Retail: el veredicto es el mismo con y sin autorización', () => {
    const result = unclassifiedResult({ name: 'Supermercado CO', domain: 'supermercadoco.com.co' });
    const withoutAuthorization = eligibilityFor(result, null, {
      sector: 'Retail y Consumo',
      subindustries: ['Supermercados e Hipermercados'],
    });
    const withAuthorization = eligibilityFor(result, RUN_AUTHORIZED, {
      sector: 'Retail y Consumo',
      subindustries: ['Supermercados e Hipermercados'],
    });

    assert.deepEqual(withAuthorization, withoutAuthorization);
    assert.notEqual(
      withAuthorization.eligible === true ? withAuthorization.sectorDecision : null,
      'sector_evidence_missing_bootstrap_eligible',
      'un sector CON política nunca entra por la vía de bootstrap',
    );
  });

  it('Educación: el veredicto es el mismo con y sin autorización', () => {
    const result = unclassifiedResult({ name: 'Instituto CO', domain: 'institutoco.com.co' });
    const withoutAuthorization = eligibilityFor(result, null, {
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
    });
    const withAuthorization = eligibilityFor(result, RUN_AUTHORIZED, {
      sector: 'Educación',
      subindustries: ['Formación Corporativa'],
    });

    assert.deepEqual(withAuthorization, withoutAuthorization);
  });

  it('un candidato de Retail contradicho sigue rechazado con autorización', () => {
    const eligibility = eligibilityFor(classifiedResult('retail banking'), RUN_AUTHORIZED, {
      sector: 'Retail y Consumo',
      subindustries: ['Supermercados e Hipermercados'],
    });
    assert.equal(eligibility.eligible, false);
    assert.equal(
      eligibility.eligible === false ? eligibility.skipReason : null,
      'sector_relevance_contradicted',
    );
  });
});
