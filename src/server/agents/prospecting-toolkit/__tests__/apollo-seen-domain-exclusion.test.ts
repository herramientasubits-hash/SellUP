/**
 * AGENT1-APOLLO-SEEN-DOMAIN-EXCLUSION-1 — Apollo deja de cobrarnos por traer las
 * mismas empresas otra vez.
 *
 * Para los mismos criterios Apollo devuelve siempre la misma página y la cobra;
 * SellUp las descartaba DESPUÉS, con el crédito ya gastado. Ahora, con la
 * bandera encendida, la petición lleva `not_organization_websites_list` (parámetro
 * documentado en la especificación oficial de Organization Search) con lo que ya
 * es nuestro y lo que pagamos por ver en los últimos 30 días.
 *
 *   § 1 · qué se excluye y en qué orden (lo nuestro siempre; lo visto, temporal);
 *   § 2 · el contrato lo envía, con tope propio y huella compacta;
 *   § 3 · CADA página enviada lleva la misma exclusión que la huella comparada;
 *   § 4 · sin lista, la petición es exactamente la de antes;
 *   § 5 · cableado: la bandera nace apagada y la lista viaja congelada.
 *
 * 0 llamadas reales a Apollo: el transporte está inyectado y `fetch` prohibido.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  APOLLO_SEEN_EXCLUSION_COOLDOWN_DAYS,
  resolveApolloSeenDomainExclusion,
} from '../../../../modules/prospect-batches/provider-seen/apollo-seen-domain-exclusion';
import { buildProviderSeenMemory } from '../../../../modules/prospect-batches/provider-seen/provider-seen-identity';
import {
  APOLLO_MAX_EXCLUDED_DOMAINS,
  buildApolloOrganizationsRequestContract,
} from '../apollo-organizations-request-contract';
import {
  buildApolloOrganizationsEffectiveRequest,
  toApolloContractFilters,
} from '../apollo-organizations-effective-request';
import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
} from '../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../apollo-organizations-pagination-budget';
import type { WebSearchInput } from '../types';

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (...args: unknown[]) => {
  throw new Error(`LLAMADA REAL PROHIBIDA EN TESTS: ${String(args[0])}`);
}) as typeof originalFetch;

const NOW = new Date('2026-09-28T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function memory(entries: { domain: string; lastSeenAt?: string | null }[]) {
  return buildProviderSeenMemory(
    entries.map((e) => ({
      providerEntityId: null,
      normalizedDomain: e.domain,
      lastSeenAt: e.lastSeenAt ?? null,
    })),
  );
}

describe('§ 1 — qué se excluye', () => {
  it('apagada ⇒ lista vacía, aunque haya memoria y cuentas', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: false,
      authorityDomains: ['nuestra.co'],
      providerSeenMemory: memory([{ domain: 'vista.co', lastSeenAt: daysAgo(1) }]),
      now: NOW,
    });
    assert.deepEqual(r.domains, []);
    assert.equal(r.telemetry.enabled, false);
  });

  it('🔴 lo que ya es nuestro se excluye siempre, primero', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: ['zeta.co', 'Alfa.co ', 'zeta.co'],
      providerSeenMemory: memory([{ domain: 'vista.co', lastSeenAt: daysAgo(1) }]),
      now: NOW,
    });
    assert.deepEqual(r.domains, ['alfa.co', 'zeta.co', 'vista.co']);
    assert.equal(r.telemetry.from_authority, 2);
    assert.equal(r.telemetry.from_recent_seen, 1);
  });

  it(`🔴 lo visto sólo se excluye ${APOLLO_SEEN_EXCLUSION_COOLDOWN_DAYS} días: después vuelve a poder aparecer`, () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: [],
      providerSeenMemory: memory([
        { domain: 'reciente.co', lastSeenAt: daysAgo(3) },
        { domain: 'vieja.co', lastSeenAt: daysAgo(45) },
      ]),
      now: NOW,
    });
    assert.deepEqual(r.domains, ['reciente.co']);
    assert.equal(r.telemetry.seen_outside_cooldown, 1);
  });

  it('🔴 un dominio visto SIN fecha fiable no se excluye (no se afirma que sea reciente)', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: [],
      providerSeenMemory: memory([{ domain: 'sinfecha.co', lastSeenAt: null }]),
      now: NOW,
    });
    assert.deepEqual(r.domains, []);
    assert.equal(r.telemetry.seen_without_date, 1);
  });

  it('memoria no leída ⇒ sólo lo nuestro', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: ['nuestra.co'],
      providerSeenMemory: null,
      now: NOW,
    });
    assert.deepEqual(r.domains, ['nuestra.co']);
  });

  it('lo visto más reciente va primero, y con tope se corta lo más viejo', () => {
    const r = resolveApolloSeenDomainExclusion({
      enabled: true,
      authorityDomains: ['nuestra.co'],
      providerSeenMemory: memory([
        { domain: 'hace5.co', lastSeenAt: daysAgo(5) },
        { domain: 'hace1.co', lastSeenAt: daysAgo(1) },
        { domain: 'hace9.co', lastSeenAt: daysAgo(9) },
      ]),
      now: NOW,
      cap: 3,
    });
    assert.deepEqual(r.domains, ['nuestra.co', 'hace1.co', 'hace5.co']);
    assert.equal(r.telemetry.omitted_due_to_cap, 1);
  });

  it('determinista: misma entrada ⇒ misma lista', () => {
    const input = {
      enabled: true,
      authorityDomains: ['b.co', 'a.co'],
      providerSeenMemory: memory([
        { domain: 'x.co', lastSeenAt: daysAgo(2) },
        { domain: 'y.co', lastSeenAt: daysAgo(2) },
      ]),
      now: NOW,
    };
    assert.deepEqual(
      resolveApolloSeenDomainExclusion(input).domains,
      resolveApolloSeenDomainExclusion(input).domains,
    );
  });
});

describe('§ 2 — el contrato de la petición', () => {
  const base = { locations: ['Colombia'], keywordTags: ['retail'], page: 1, perPage: 100 };

  it('🔴 la lista viaja como not_organization_websites_list', () => {
    const c = buildApolloOrganizationsRequestContract({
      ...base,
      excludedDomains: ['a.co', 'b.co'],
    });
    assert.deepEqual(c.body.not_organization_websites_list, ['a.co', 'b.co']);
    assert.ok(c.sentParamKeys.includes('not_organization_websites_list'));
  });

  it(`tope propio de ${APOLLO_MAX_EXCLUDED_DOMAINS}, no el de 25 de los filtros`, () => {
    const many = Array.from({ length: 600 }, (_, i) => `dominio${i}.co`);
    const c = buildApolloOrganizationsRequestContract({ ...base, excludedDomains: many });
    assert.equal(c.body.not_organization_websites_list?.length, APOLLO_MAX_EXCLUDED_DOMAINS);
    assert.ok(
      c.omittedFilters.some(
        (f) => f.param === 'not_organization_websites_list' && f.reason === 'truncated_to_limit',
      ),
    );
  });

  it('🔴 la huella lleva un RESUMEN compacto, estable al orden', () => {
    const many = Array.from({ length: 300 }, (_, i) => `dominio${i}.co`);
    const a = buildApolloOrganizationsRequestContract({ ...base, excludedDomains: many });
    const b = buildApolloOrganizationsRequestContract({
      ...base,
      excludedDomains: [...many].reverse(),
    });
    assert.equal(a.filtersFingerprint, b.filtersFingerprint);
    assert.match(a.filtersFingerprint, /not_organization_websites_list=300:[0-9a-f]{16}/);
    assert.ok(a.filtersFingerprint.length < 400, 'la huella no crece con la lista');
  });

  it('otra lista ⇒ otra huella (no se confunden dos búsquedas distintas)', () => {
    const a = buildApolloOrganizationsRequestContract({ ...base, excludedDomains: ['a.co'] });
    const b = buildApolloOrganizationsRequestContract({ ...base, excludedDomains: ['b.co'] });
    assert.notEqual(a.filtersFingerprint, b.filtersFingerprint);
  });

  it('un extra no puede colar la exclusión por la puerta genérica', () => {
    const c = buildApolloOrganizationsRequestContract({
      ...base,
      excludedDomains: ['a.co'],
      extraParams: { not_organization_websites_list: ['intruso.co'] },
    });
    assert.deepEqual(c.body.not_organization_websites_list, ['a.co']);
  });
});

function searchInput(): WebSearchInput {
  return {
    query: 'hipótesis',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    intent: 'company_discovery',
    maxResults: 5,
    provider: 'apollo_organizations',
    subindustries: ['Supermercados e Hipermercados'],
    additionalCriteriaTokens: ['supermercado'],
  };
}

function effective(excludedDomains?: string[]) {
  return buildApolloOrganizationsEffectiveRequest({
    input: searchInput(),
    requestedMaxResults: 5,
    resultLimitMode: 'two_round',
    twoRoundMaxResultsPerRound: 5,
    startPage: 1,
    legacyMaxResultsPerQuery: 3,
    ...(excludedDomains ? { excludedDomains } : {}),
  });
}

function okPage(page: number): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: Array.from({ length: 100 }, (_u, i) => ({
        id: `org_${page}_${i}`,
        name: `Empresa ${page}-${i}`,
        primary_domain: `empresa-${page}-${i}.co`,
      })),
      pagination: { page, per_page: 100, total_entries: 300, total_pages: 3 },
    },
    headers: null,
  };
}

describe('§ 3 — cada página enviada lleva la exclusión', () => {
  it('🔴 la petición efectiva y los params del provider llevan la misma lista', () => {
    const e = effective(['nuestra.co', 'vista.co']);
    assert.deepEqual(e.body.not_organization_websites_list, ['nuestra.co', 'vista.co']);
    assert.deepEqual(toApolloContractFilters(e.params).excludedDomains, ['nuestra.co', 'vista.co']);
  });

  it('🔴 las 3 páginas despachadas llevan la exclusión, y la huella enviada es la comparada', async () => {
    const e = effective(['nuestra.co', 'vista.co']);
    const bodies: Record<string, unknown>[] = [];
    let clock = 0;
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        filters: toApolloContractFilters(e.params),
        budget: createApolloPaginationBudget({ perPage: 100, maxPages: 3 }),
        wizardRunId: 'wizard-run-exclusion',
        startPage: 1,
      },
      {
        fetchPage: async (body) => {
          bodies.push(body);
          clock += 10;
          return okPage(bodies.length);
        },
        now: () => clock,
        random: () => 0.5,
      },
    );
    assert.equal(bodies.length, 3);
    for (const body of bodies) {
      assert.deepEqual(body['not_organization_websites_list'], ['nuestra.co', 'vista.co']);
    }
    assert.equal(result.effectiveRequestFingerprintSent, e.effectiveRequestFingerprint);
  });
});

describe('§ 4 — sin lista, la petición de siempre', () => {
  it('sin excludedDomains el body no lleva el campo y la huella no cambia', () => {
    const without = effective();
    const empty = effective([]);
    assert.equal('not_organization_websites_list' in without.body, false);
    assert.equal(without.filtersFingerprint, empty.filtersFingerprint);
    assert.equal(without.filtersFingerprint.includes('not_organization_websites_list'), false);
  });
});

describe('§ 5 — cableado', () => {
  const root = path.resolve(__dirname, '../../../../..');
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

  it('la bandera nace apagada: sólo `true` la enciende', async () => {
    const { isAgent1ApolloSeenDomainExclusionEnabled, AGENT1_APOLLO_SEEN_DOMAIN_EXCLUSION_FLAG } =
      await import('../../../../lib/feature-flags.server');
    const previous = process.env[AGENT1_APOLLO_SEEN_DOMAIN_EXCLUSION_FLAG];
    try {
      delete process.env[AGENT1_APOLLO_SEEN_DOMAIN_EXCLUSION_FLAG];
      assert.equal(isAgent1ApolloSeenDomainExclusionEnabled(), false);
      process.env[AGENT1_APOLLO_SEEN_DOMAIN_EXCLUSION_FLAG] = 'yes';
      assert.equal(isAgent1ApolloSeenDomainExclusionEnabled(), false);
      process.env[AGENT1_APOLLO_SEEN_DOMAIN_EXCLUSION_FLAG] = 'true';
      assert.equal(isAgent1ApolloSeenDomainExclusionEnabled(), true);
    } finally {
      if (previous === undefined) delete process.env[AGENT1_APOLLO_SEEN_DOMAIN_EXCLUSION_FLAG];
      else process.env[AGENT1_APOLLO_SEEN_DOMAIN_EXCLUSION_FLAG] = previous;
    }
  });

  it('el wizard resuelve la lista con la bandera y la entrega al runner', () => {
    const source = read(
      'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
    );
    assert.match(source, /enabled:\s*isAgent1ApolloSeenDomainExclusionEnabled\(\)/);
    assert.match(source, /dedupeAuthorityValues/);
    assert.match(source, /excludedDomains:\s*apolloDomainExclusion\.domains/);
  });

  it('🔴 el runner pasa la MISMA lista a las opciones y al request efectivo', () => {
    const source = read(
      'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts',
    );
    assert.match(source, /excludedDomains:\s*input\.excludedDomains/);
    assert.match(source, /excludedDomains:\s*searchOptions\.excludedDomains \?\? null/);
  });

  it('la lista vive en la entrada del runner, que la continuación restaura entera', () => {
    const source = read(
      'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts',
    );
    const typeStart = source.indexOf('export type ApolloTwoRoundWizardRunInput = {');
    const typeEnd = source.indexOf('\n};', typeStart);
    assert.ok(
      source.slice(typeStart, typeEnd).includes('excludedDomains?: readonly string[] | null;'),
    );
  });
});
