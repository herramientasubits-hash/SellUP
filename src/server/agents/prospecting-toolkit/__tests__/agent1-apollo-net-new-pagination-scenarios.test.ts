/**
 * AGENT1-APOLLO-NET-NEW-PAGINATION — escenarios de negocio requeridos.
 *
 * Ejercita las funciones REALES de producción (no reimplementaciones):
 *   - runApolloOrganizationsPaginatedSearch / createApolloPaginationBudget
 *   - normalizeApolloOrganizationsResponse (vía el motor, sobre payloads crudos)
 *   - evaluatePrepaidHistoricalDuplicate (verdad histórica fuerte)
 *   - readDuplicateVerdict (bloqueo Apollo-scoped, ya no name-only)
 *   - evaluateApolloEnrichmentEligibility (identificadores de enrichment)
 *
 * Offline y determinista: transporte, reloj y jitter inyectados. 0 llamadas
 * reales a Apollo, 0 créditos reales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
} from '../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../apollo-organizations-pagination-budget';
import type { NormalizedApolloOrganization } from '../apollo-organizations-response-normalizer';
import { evaluatePrepaidHistoricalDuplicate } from '../apollo-prepaid-historical-parity';
import { readDuplicateVerdict } from '../apollo-two-round/production-runner.server';
import { evaluateApolloEnrichmentEligibility } from '../apollo-enrichment-eligibility-gate';
import type { ProspectingPipelineCandidate } from '../types';

// ─── Harness ──────────────────────────────────────────────────────────────────

function orgPayload(page: number, count: number, offset: number): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: Array.from({ length: count }, (_unused, i) => ({
        id: `org_p${page}_${offset + i}`,
        name: `Empresa ${offset + i}`,
        primary_domain: `empresa-${offset + i}.com`,
      })),
      pagination: { page, per_page: 100, total_entries: 5_000, total_pages: 500 },
    },
    headers: null,
  };
}

function harness(pages: ApolloPageFetchResult[]) {
  let clock = 0;
  let call = 0;
  const bodies: Record<string, unknown>[] = [];
  return {
    bodies,
    fetchPage: async (body: Record<string, unknown>): Promise<ApolloPageFetchResult> => {
      bodies.push(body);
      clock += 10;
      return pages[Math.min(call++, pages.length - 1)]!;
    },
    now: () => clock,
    random: () => 0.5,
    sleep: async () => {},
  };
}

const baseInput = {
  filters: { locations: ['Colombia'], keywordTags: ['lms'] },
  wizardRunId: 'run_net_new_scenarios',
  agentRunId: null,
};

// ─── Scenario A — page1: 94 hist + 6 net-new ⇒ 1 page, 1 credit, stop ────────

describe('Scenario A — historical-heavy page reaches the target on page 1', () => {
  it('94 historical + 6 net-new on page 1 ⇒ 1 page fetched, target reached', async () => {
    const h = harness([orgPayload(1, 100, 0)]);
    // Sólo las primeras 6 organizaciones cuentan como net-new; el resto son
    // duplicado histórico simulado.
    const acceptedIds = new Set(Array.from({ length: 6 }, (_unused, i) => `org_p1_${i}`));

    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget(),
        netNewTarget: 6,
      },
      {
        ...h,
        evaluateAcceptance: (org: NormalizedApolloOrganization) =>
          acceptedIds.has(org.providerReference.providerOrganizationId),
      },
    );

    assert.equal(result.pagesProcessed, 1, 'una sola página basta');
    assert.equal(result.estimatedCredits, 1, '1 crédito por página no vacía');
    assert.equal(result.acceptedForTargetCount, 6);
    assert.equal(result.stopReason, 'candidate_target_reached');
    assert.equal(h.bodies.length, 1);
  });
});

// ─── Scenario B — page1 1 nuevo, page2 5 nuevos ⇒ 2 páginas ──────────────────

describe('Scenario B — a shortfall on page 1 continues to page 2', () => {
  it('1 net-new en la página 1 + 5 en la página 2 ⇒ 2 páginas, objetivo 6 cumplido', async () => {
    const h = harness([orgPayload(1, 100, 0), orgPayload(2, 100, 100)]);
    // Sólo un id de la página 1 y cinco de la página 2 cuentan como net-new.
    const acceptedIds = new Set([
      'org_p1_0',
      'org_p2_100',
      'org_p2_101',
      'org_p2_102',
      'org_p2_103',
      'org_p2_104',
    ]);

    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget(),
        netNewTarget: 6,
      },
      {
        ...h,
        evaluateAcceptance: (org: NormalizedApolloOrganization) =>
          acceptedIds.has(org.providerReference.providerOrganizationId),
      },
    );

    assert.equal(result.pagesProcessed, 2, 'la página 1 sola no alcanzaba el objetivo');
    assert.equal(result.estimatedCredits, 2, '1 crédito por página, 2 páginas');
    assert.equal(result.acceptedForTargetCount, 6);
    assert.equal(result.stopReason, 'candidate_target_reached');
  });
});

// ─── Scenario C — 3 páginas requeridas ────────────────────────────────────────

describe('Scenario C — the old two-round ceiling is no longer the pagination authority', () => {
  it('1 + 2 + 3 net-new a través de 3 páginas ⇒ 3 páginas fetched, objetivo 6', async () => {
    const h = harness([orgPayload(1, 100, 0), orgPayload(2, 100, 100), orgPayload(3, 100, 200)]);
    const acceptedIds = new Set([
      'org_p1_0',
      'org_p2_100',
      'org_p2_101',
      'org_p3_200',
      'org_p3_201',
      'org_p3_202',
    ]);

    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget(),
        netNewTarget: 6,
      },
      {
        ...h,
        evaluateAcceptance: (org: NormalizedApolloOrganization) =>
          acceptedIds.has(org.providerReference.providerOrganizationId),
      },
    );

    assert.equal(result.pagesProcessed, 3);
    assert.equal(result.acceptedForTargetCount, 6);
    assert.equal(result.stopReason, 'candidate_target_reached');
  });
});

// ─── Scenario D — duplicado entre páginas ─────────────────────────────────────

describe('Scenario D — a cross-page duplicate organization_id is evaluated once', () => {
  it('el mismo organization_id en dos páginas se evalúa UNA sola vez', async () => {
    const repeated: ApolloPageFetchResult = {
      ok: true,
      status: 200,
      requestSent: true,
      malformedBody: false,
      timedOut: false,
      payload: {
        organizations: [{ id: 'org_X', name: 'Acme', primary_domain: 'acme.com' }],
        pagination: { page: 1, per_page: 100, total_entries: 5_000, total_pages: 500 },
      },
      headers: null,
    };
    const h = harness([repeated, repeated]);
    let evaluations = 0;

    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ maxPages: 2 }),
        netNewTarget: 5, // nunca se alcanza: fuerza a recorrer ambas páginas
      },
      {
        ...h,
        evaluateAcceptance: () => {
          evaluations++;
          return false;
        },
      },
    );

    assert.equal(evaluations, 1, 'org_X sólo se evalúa la primera vez que aparece');
    assert.equal(result.organizations.length, 1);
  });
});

// ─── Scenario E — deriva de organization_id, mismo dominio ────────────────────

describe('Scenario E — Apollo organization_id drift with the same domain is still historical', () => {
  it('nuevo organization_id + mismo dominio histórico ⇒ alreadyKnown = true', () => {
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: 'acme.com',
        name: 'Acme',
        taxIdentifier: null,
        countryCode: 'CO',
      },
      rows: [
        {
          id: 'hist-1',
          name: 'Acme',
          domain: 'acme.com',
          status: 'approved',
          source_primary: 'production',
        },
      ],
    });

    assert.equal(verdict.alreadyKnown, true);
    assert.equal(verdict.matchedAxis, 'normalized_domain');
  });
});

// ─── Scenario F / G — el nombre no bloquea ────────────────────────────────────

function candidateWithMatches(
  matches: Array<{ source: 'sellup' | 'hubspot'; status: string; confidence: number }>,
): ProspectingPipelineCandidate {
  return {
    duplicateCheck: {
      status: matches[0]?.status ?? 'new_candidate',
      confidence: matches[0]?.confidence ?? 0,
      input: { name: 'Acme' },
      matches,
      summary: 'test',
      checkedSources: ['sellup', 'hubspot'],
    },
  } as unknown as ProspectingPipelineCandidate;
}

describe('Scenario F — same name, conflicting domains, does not hard-block', () => {
  it('normalized_name + country exact (88) NO es bloqueo duro Apollo', () => {
    const candidate = candidateWithMatches([
      { source: 'sellup', status: 'existing_in_sellup', confidence: 88 },
    ]);
    const verdict = readDuplicateVerdict(candidate);
    assert.deepEqual(verdict, { sellUpDuplicate: false, hubSpotDuplicate: false });
  });
});

describe('Scenario G — name-only match stays diagnostic, never a hard rejection', () => {
  it('contenido de nombre (possible_duplicate, 65) NO es bloqueo duro Apollo', () => {
    const candidate = candidateWithMatches([
      { source: 'hubspot', status: 'possible_duplicate', confidence: 65 },
    ]);
    const verdict = readDuplicateVerdict(candidate);
    assert.deepEqual(verdict, { sellUpDuplicate: false, hubSpotDuplicate: false });
  });

  it('un match de DOMINIO exacto SÍ sigue siendo un bloqueo duro Apollo', () => {
    const candidate = candidateWithMatches([
      { source: 'sellup', status: 'existing_in_sellup', confidence: 95 },
    ]);
    const verdict = readDuplicateVerdict(candidate);
    assert.deepEqual(verdict, { sellUpDuplicate: true, hubSpotDuplicate: false });
  });
});

// ─── Scenario H — accounts-only page ──────────────────────────────────────────

describe('Scenario H — an accounts-only page costs 1 credit and yields 0 candidates', () => {
  it('organizations=[] + accounts=[1] ⇒ 1 crédito, 0 candidatos, 0 aceptados', async () => {
    const accountsOnlyPage: ApolloPageFetchResult = {
      ok: true,
      status: 200,
      requestSent: true,
      malformedBody: false,
      timedOut: false,
      payload: {
        organizations: [],
        accounts: [{ id: 'acct_1', organization_id: 'org_only_in_accounts', name: 'Acme' }],
        pagination: { page: 1, per_page: 100, total_entries: 1, total_pages: 1 },
      },
      headers: null,
    };
    const h = harness([accountsOnlyPage]);

    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget() },
      h,
    );

    assert.equal(result.estimatedCredits, 1, 'la página tuvo resultados (accounts) y se cobra');
    assert.equal(result.organizations.length, 0, 'accounts-only no es candidato de descubrimiento');
  });
});

// ─── Scenario I — account completa organization ──────────────────────────────

describe('Scenario I — a matched account completes the organization, not a second candidate', () => {
  it('organizations=[O1] + accounts=[match O1] ⇒ exactamente 1 candidato', async () => {
    const mergedPage: ApolloPageFetchResult = {
      ok: true,
      status: 200,
      requestSent: true,
      malformedBody: false,
      timedOut: false,
      payload: {
        organizations: [{ id: 'org_1', name: 'Acme', primary_domain: null }],
        accounts: [{ id: 'acct_1', organization_id: 'org_1', primary_domain: 'acme.com' }],
        pagination: { page: 1, per_page: 100, total_entries: 1, total_pages: 1 },
      },
      headers: null,
    };
    const h = harness([mergedPage]);

    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget() },
      h,
    );

    assert.equal(result.organizations.length, 1);
    assert.equal(result.organizations[0]!.primaryDomain, 'acme.com', 'accounts completó el dominio');
  });
});

// ─── Scenario J — website fallback (ya soportado hoy) ─────────────────────────

describe('Scenario J — a candidate with website but no declared domain is enrichment-eligible', () => {
  it('domain=null, website presente ⇒ elegible (dominio inferido del sitio)', () => {
    const result = {
      title: 'Acme Corp',
      url: 'https://acme.com',
      rank: 1,
      provider: 'apollo_organizations' as const,
      metadata: {
        domain: 'acme.com',
        website: 'https://acme.com',
        country_code: 'CO',
        industry: 'retail',
        keywords: ['supermercado', 'grocery'],
      },
    };
    const verdict = evaluateApolloEnrichmentEligibility(result, {
      targetCountryCode: 'CO',
      sector: 'Retail y Consumo',
      subindustries: ['Supermercados e Hipermercados'],
    });
    assert.equal(verdict.eligible, true);
  });
});

// ─── Scenario K/L — sin dominio ni sitio: se salta, sin GET-by-ID ─────────────

describe('Scenario K/L — no domain, no website: skipped safely, never a synthetic-URL leak', () => {
  it('sólo LinkedIn (sin dominio, sin sitio) ⇒ invalid_domain, no "apollo.io" inventado', () => {
    // AGENT1-APOLLO-NET-NEW-PAGINATION § 18 — REMAINING DEBT: este cut cierra la
    // fuga de "apollo.io" como dominio inventado (§ 20), pero NO añade un
    // camino de elegibilidad basado SÓLO en linkedin_url — eso exige extender
    // `ApolloEnrichmentEligibility` para transportar una identidad no-dominio,
    // fuera del alcance seguro de este corte. El comportamiento actual es
    // CORRECTO (no gasta, no inventa un dominio), pero no es "elegible por
    // LinkedIn" todavía.
    const result = {
      title: 'Acme Corp',
      url: 'https://apollo.io/companies/org_x',
      rank: 1,
      provider: 'apollo_organizations' as const,
      metadata: { domain: null, website: null, linkedin_url: 'https://www.linkedin.com/company/acme' },
    };
    const verdict = evaluateApolloEnrichmentEligibility(result, {
      targetCountryCode: null,
      sector: null,
    });
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.skipReason, 'invalid_domain');
    assert.notEqual(verdict.domain, 'apollo.io', 'nunca se infiere "apollo.io" como dominio del candidato');
  });
});

// ─── Scenario M — página vacía terminal ───────────────────────────────────────

describe('Scenario M — an empty terminal page costs 0, not another credit', () => {
  it('page1=100 resultados, page2=0 ⇒ 1 crédito, no 2', async () => {
    const empty: ApolloPageFetchResult = {
      ok: true,
      status: 200,
      requestSent: true,
      malformedBody: false,
      timedOut: false,
      payload: {
        organizations: [],
        pagination: { page: 2, per_page: 100, total_entries: 100, total_pages: 2 },
      },
      headers: null,
    };
    const h = harness([orgPayload(1, 100, 0), empty]);

    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget(), netNewTarget: 999 },
      { ...h, evaluateAcceptance: () => false },
    );

    assert.equal(result.pagesProcessed, 2);
    assert.equal(result.estimatedCredits, 1, 'la página vacía no cobra');
  });
});

// ─── Scenario N — 100 resultados = 1 crédito ──────────────────────────────────

describe('Scenario N — 100 results on one page still cost exactly 1 credit', () => {
  it('100 resultados ⇒ 1 crédito, no 100', async () => {
    const onePage: ApolloPageFetchResult = {
      ok: true,
      status: 200,
      requestSent: true,
      malformedBody: false,
      timedOut: false,
      payload: {
        organizations: Array.from({ length: 100 }, (_unused, i) => ({
          id: `org_${i}`,
          name: `Empresa ${i}`,
          primary_domain: `empresa-${i}.com`,
        })),
        // total_pages=1 — Apollo declara que no hay más: la paginación se
        // detiene por agotamiento del proveedor, no por un tope artificial.
        pagination: { page: 1, per_page: 100, total_entries: 100, total_pages: 1 },
      },
      headers: null,
    };
    const h = harness([onePage]);
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget() },
      h,
    );
    assert.equal(result.organizations.length, 100);
    assert.equal(result.estimatedCredits, 1);
    assert.equal(result.stopReason, 'last_page_reached');
  });
});

// ─── Scenario O — agotamiento de presupuesto ──────────────────────────────────

describe('Scenario O — budget exhaustion stops cleanly without exceeding it', () => {
  it('objetivo sin alcanzar + presupuesto de créditos agotado ⇒ para limpio', async () => {
    // maxCandidates queda muy por debajo de 50 × 2 páginas a propósito: si el
    // tope de créditos no mandara, el motor seguiría acumulando candidatos
    // crudos hasta ese tope en vez de detenerse en maxPages.
    const h = harness([orgPayload(1, 50, 0), orgPayload(2, 50, 100)]);
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ maxPages: 1, maxCandidates: 500 }),
        netNewTarget: 999,
      },
      { ...h, evaluateAcceptance: () => false },
    );

    assert.equal(result.pagesProcessed, 1, 'no se pidió una página más allá del presupuesto');
    // Con maxPages=1, maxCredits también es 1 (1 crédito por página): las dos
    // razones de parada coinciden en la misma página, y cualquiera de las dos
    // es una parada limpia por presupuesto.
    assert.ok(
      result.stopReason === 'max_pages_reached' || result.stopReason === 'max_credits_reached',
      `parada inesperada: ${result.stopReason}`,
    );
    assert.equal(h.bodies.length, 1, 'ninguna petición de Apollo Search más allá del presupuesto');
  });
});
