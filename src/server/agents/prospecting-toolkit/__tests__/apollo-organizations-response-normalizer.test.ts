/**
 * A1-APOLLO-WIZARD-1 — Normalización de la respuesta de Apollo Organization Search.
 *
 * Puro, offline, determinista. Fixtures locales; cero llamadas reales a Apollo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeApolloOrganizationsResponse,
  normalizeDomain,
  buildNormalizedDomains,
} from '../apollo-organizations-response-normalizer';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ACME = {
  id: 'org_acme_1',
  name: 'Acme S.A.S',
  primary_domain: 'acme.com',
  all_domains: ['acme.com', 'acme.co', 'www.acme-legacy.com'],
  website_url: 'https://www.acme.com/inicio',
  linkedin_url: 'https://www.linkedin.com/company/acme',
  phone: '+57 1 555 0000',
  founded_year: 1998,
  country: 'Colombia',
  city: 'Bogotá',
  industry: 'e-learning',
  sic_codes: ['8200'],
};

const ORG_MINIMAL = { id: 'org_minimal_1', name: 'Minimal Ltda' };

describe('A1-APOLLO-WIZARD-1 · normalización de dominios', () => {
  it('normaliza protocolo, www, mayúsculas, puerto, path, query y slash final', () => {
    assert.equal(normalizeDomain('https://WWW.Acme.com:8443/ruta?x=1#y'), 'acme.com');
    assert.equal(normalizeDomain('http://acme.com/'), 'acme.com');
    assert.equal(normalizeDomain('  ACME.COM  '), 'acme.com');
    assert.equal(normalizeDomain('acme.com.'), 'acme.com');
  });

  it('rechaza dominios inválidos', () => {
    for (const invalid of ['', '   ', 'localhost', 'no-dot', '.leading.com', 'a..b.com', null, undefined]) {
      assert.equal(normalizeDomain(invalid as string | null), null, `debe rechazar: ${String(invalid)}`);
    }
  });

  // ── Caso 16: primary_domain y all_domains ──────────────────────────────────
  it('combina primary_domain con all_domains, deduplicando y preservando el principal primero', () => {
    const domains = buildNormalizedDomains('acme.com', ['ACME.com', 'https://www.acme.co', 'acme.io']);
    assert.deepEqual(domains, ['acme.com', 'acme.co', 'acme.io']);
  });

  it('all_domains es alias, no reemplazo: primary_domain encabeza siempre', () => {
    const domains = buildNormalizedDomains('principal.com', ['otro.com']);
    assert.equal(domains[0], 'principal.com');
  });

  // ── Caso 17: dominios ausentes ─────────────────────────────────────────────
  it('deriva del website sólo cuando no hay ningún dominio declarado', () => {
    assert.deepEqual(buildNormalizedDomains(null, null, 'https://www.derivado.com/x'), ['derivado.com']);
    assert.deepEqual(buildNormalizedDomains('declarado.com', null, 'https://otro.com'), ['declarado.com']);
  });

  it('sin dominios devuelve un array vacío, no un fallo', () => {
    assert.deepEqual(buildNormalizedDomains(null, null, null), []);
  });

  // ── A1-APOLLO-WIZARD-1R: formas de all_domains que Apollo puede devolver ────
  it('tolera all_domains omitido, vacío, null y con entradas nulas o basura', () => {
    assert.deepEqual(buildNormalizedDomains('acme.com', undefined), ['acme.com']);
    assert.deepEqual(buildNormalizedDomains('acme.com', []), ['acme.com']);
    assert.deepEqual(buildNormalizedDomains('acme.com', null), ['acme.com']);
    assert.deepEqual(
      buildNormalizedDomains('acme.com', [null, undefined, '', '   ', 'localhost', 'ACME.com']),
      ['acme.com'],
      'las entradas inválidas se descartan sin desplazar al dominio principal',
    );
  });
});

describe('A1-APOLLO-WIZARD-1 · normalización de respuesta', () => {
  // ── Caso 11: respuesta con organizations[] ─────────────────────────────────
  it('procesa organizations[] como fuente principal', () => {
    const result = normalizeApolloOrganizationsResponse({ organizations: [ORG_ACME] });
    assert.equal(result.organizations.length, 1);
    const [org] = result.organizations;
    assert.equal(org.providerReference.providerOrganizationId, 'org_acme_1');
    assert.equal(org.providerReference.providerAccountId, null);
    assert.equal(org.name, 'Acme S.A.S');
    assert.deepEqual(org.normalizedDomains, ['acme.com', 'acme.co', 'acme-legacy.com']);
    assert.equal(result.meta.source_priority, 'organizations_first');
  });

  // ── Caso 12 (AGENT1-APOLLO-NET-NEW-PAGINATION § 2, Scenario H): accounts[]
  // sin contraparte en organizations[] NUNCA es un candidato de descubrimiento
  // por su cuenta. organizations[] es la ÚNICA fuente de identidad; accounts[]
  // sólo completa. Se cuenta para diagnóstico agregado, nunca se materializa.
  it('descarta accounts[] solo — no es candidato de descubrimiento, sólo diagnóstico', () => {
    const result = normalizeApolloOrganizationsResponse({
      accounts: [{ id: 'acct_9', organization_id: 'org_acme_1', name: 'Acme S.A.S' }],
    });
    assert.equal(result.organizations.length, 0);
    assert.equal(result.meta.accounts_only_count, 1);
  });

  // ── Caso 15 (Scenario I): accounts[*].id NO es el organization id ──────────
  // Se ejercita vía el camino de FUSIÓN (organizations[] + accounts[] con el
  // mismo organization_id): sólo ese camino produce un candidato, y es donde
  // `providerAccountId` se completa.
  it('nunca usa accounts[*].id como Apollo Organization ID', () => {
    const result = normalizeApolloOrganizationsResponse({
      organizations: [{ id: 'org_real_1', name: 'X' }],
      accounts: [{ id: 'acct_NOT_AN_ORG_ID', organization_id: 'org_real_1', name: 'X' }],
    });
    const [org] = result.organizations;
    assert.equal(org.providerReference.providerOrganizationId, 'org_real_1');
    assert.notEqual(org.providerReference.providerOrganizationId, 'acct_NOT_AN_ORG_ID');
    assert.equal(org.providerReference.providerAccountId, 'acct_NOT_AN_ORG_ID');
  });

  it('descarta una entrada de accounts sin organization_id en vez de inventar identidad', () => {
    const result = normalizeApolloOrganizationsResponse({
      accounts: [{ id: 'acct_sin_org', name: 'Huérfana' }],
    });
    assert.equal(result.organizations.length, 0);
    assert.equal(result.meta.dropped_without_id_count, 1);
  });

  // ── Casos 13 y 14: ambos arrays, prioridad de organizations ────────────────
  it('con ambos arrays, organizations tiene prioridad y accounts sólo completa', () => {
    const result = normalizeApolloOrganizationsResponse({
      organizations: [
        {
          id: 'org_acme_1',
          name: 'Acme S.A.S',
          primary_domain: 'acme.com',
          country: null,
          industry: 'e-learning',
        },
      ],
      accounts: [
        {
          id: 'acct_1',
          organization_id: 'org_acme_1',
          name: 'NOMBRE DEL WORKSPACE',
          primary_domain: 'workspace-wrong.com',
          country: 'Colombia',
          industry: 'otra-industria',
        },
      ],
    });

    assert.equal(result.organizations.length, 1);
    const [org] = result.organizations;
    // No sobrescribe lo válido…
    assert.equal(org.name, 'Acme S.A.S');
    assert.equal(org.primaryDomain, 'acme.com');
    assert.equal(org.industry, 'e-learning');
    // …y sí completa lo ausente.
    assert.equal(org.country, 'Colombia');
    assert.ok(org.filledFromAccountFields.includes('country'));
    assert.equal(org.filledFromAccountFields.includes('name'), false);
    assert.equal(result.meta.accounts_merged_count, 1);
    // El account id se conserva como metadata del workspace.
    assert.equal(org.providerReference.providerAccountId, 'acct_1');
    assert.equal(org.providerReference.providerOrganizationId, 'org_acme_1');
  });

  it('un accounts con campos vacíos no degrada los de organizations', () => {
    const result = normalizeApolloOrganizationsResponse({
      organizations: [{ id: 'o1', name: 'Real', country: 'Colombia' }],
      accounts: [{ id: 'a1', organization_id: 'o1', name: null, country: null }],
    });
    const [org] = result.organizations;
    assert.equal(org.name, 'Real');
    assert.equal(org.country, 'Colombia');
    assert.deepEqual(org.filledFromAccountFields, []);
  });

  // ── Dedup defensivo ────────────────────────────────────────────────────────
  it('deduplica por Apollo Organization ID dentro de organizations[]', () => {
    const result = normalizeApolloOrganizationsResponse({
      organizations: [ORG_ACME, { ...ORG_ACME, name: 'Acme duplicada' }],
    });
    assert.equal(result.organizations.length, 1);
    assert.equal(result.organizations[0].name, 'Acme S.A.S');
    assert.equal(result.meta.duplicates_removed_count, 1);
  });

  // A1-APOLLO-WIZARD-1R: la cara opuesta del dedup — colapsar de más sería
  // perder una empresa real, no ahorrar una duplicada.
  it('no colapsa dos organizaciones distintas con ids distintos', () => {
    const result = normalizeApolloOrganizationsResponse({
      organizations: [
        ORG_ACME,
        { ...ORG_ACME, id: 'org_acme_2', name: 'Acme Andina S.A.S' },
      ],
      accounts: [
        { id: 'acct_x', organization_id: 'org_acme_1', city: 'Medellín' },
        { id: 'acct_y', organization_id: 'org_acme_2', city: 'Cali' },
      ],
    });

    assert.equal(result.organizations.length, 2);
    assert.deepEqual(
      result.organizations.map((org) => org.providerReference.providerOrganizationId),
      ['org_acme_1', 'org_acme_2'],
    );
    assert.deepEqual(
      result.organizations.map((org) => org.providerReference.providerAccountId),
      ['acct_x', 'acct_y'],
      'cada organización conserva su propio account id del workspace',
    );
    assert.equal(result.meta.duplicates_removed_count, 0);
    assert.equal(result.meta.accounts_only_count, 0);
  });

  it('descarta entradas de organizations sin id', () => {
    const result = normalizeApolloOrganizationsResponse({
      organizations: [{ name: 'Sin id' }, ORG_MINIMAL],
    });
    assert.equal(result.organizations.length, 1);
    assert.equal(result.meta.dropped_without_id_count, 1);
  });

  // ── Campos opcionales ──────────────────────────────────────────────────────
  it('no falla porque falten campos opcionales', () => {
    const result = normalizeApolloOrganizationsResponse({ organizations: [ORG_MINIMAL] });
    const [org] = result.organizations;
    assert.equal(org.primaryDomain, null);
    assert.equal(org.foundedYear, null);
    assert.equal(org.country, null);
    assert.equal(org.phone, null);
    assert.equal(org.linkedinUrl, null);
    assert.deepEqual(org.normalizedDomains, []);
    assert.deepEqual(org.industries, []);
  });

  it('acepta founded_year como string numérico', () => {
    const result = normalizeApolloOrganizationsResponse({
      organizations: [{ id: 'o1', founded_year: '2004' }],
    });
    assert.equal(result.organizations[0].foundedYear, 2004);
  });

  // ── Payloads degenerados ───────────────────────────────────────────────────
  it('tolera payloads nulos, vacíos o sin arrays', () => {
    for (const payload of [null, undefined, {}, { organizations: null, accounts: null }]) {
      const result = normalizeApolloOrganizationsResponse(payload as never);
      assert.deepEqual(result.organizations, []);
    }
  });

  it('reporta la presencia de cada array por separado', () => {
    const onlyOrgs = normalizeApolloOrganizationsResponse({ organizations: [] });
    assert.equal(onlyOrgs.meta.organizations_array_present, true);
    assert.equal(onlyOrgs.meta.accounts_array_present, false);
  });

  // ── Paginación ─────────────────────────────────────────────────────────────
  it('extrae la paginación cuando existe', () => {
    const result = normalizeApolloOrganizationsResponse({
      organizations: [ORG_MINIMAL],
      pagination: { page: 2, per_page: 25, total_entries: 320, total_pages: 13 },
    });
    assert.deepEqual(result.pagination, {
      page: 2,
      perPage: 25,
      totalEntries: 320,
      totalPages: 13,
    });
  });

  it('deja la paginación en null cuando Apollo no la envía', () => {
    const result = normalizeApolloOrganizationsResponse({ organizations: [ORG_MINIMAL] });
    assert.deepEqual(result.pagination, {
      page: null,
      perPage: null,
      totalEntries: null,
      totalPages: null,
    });
  });

  it('no propaga los campos SIC que Apollo pueda devolver como si fueran filtros', () => {
    const result = normalizeApolloOrganizationsResponse({ organizations: [ORG_ACME] });
    assert.equal('sic_codes' in result.organizations[0], false);
  });
});
