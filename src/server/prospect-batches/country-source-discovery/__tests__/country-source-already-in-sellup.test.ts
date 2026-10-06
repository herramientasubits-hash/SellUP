/**
 * SOURCES-FREE-LAYER-ALREADY-SEEN-1 — la capa gratuita no vuelve a proponer lo que
 * SellUp ya tiene (candidatas vivas de otros lotes, Descartadas). Prod 06-10: en
 * México AXTEL, BICENTEL… quedaron tres veces en revisión. Cero red: dobles.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { DuplicateCheckInput, DuplicateCheckResult } from '@/server/agents/prospecting-toolkit/types';
import { sellupKeysOf, splitAlreadyInSellup, type FindAlreadyInSellup } from '../country-source-already-in-sellup';
import { runCountrySourcePrePaidDiscovery } from '../run-country-source-prepaid-discovery';
import type { CountrySourceCompany } from '../country-source-types';

const MACRO = 'technology';

function company(key: string, taxId: string | null = null): CountrySourceCompany {
  return {
    recordIdentityKey: key,
    legalName: `EMPRESA SINTETICA ${key}`,
    normalizedLegalName: `EMPRESA SINTETICA ${key}`,
    taxId,
    taxIdentifierType: taxId ? 'RFC' : null,
    countryCode: 'MX',
    city: null,
    region: null,
    domain: null,
    declaredIndustry: 'Servicios de diseño de sistemas de cómputo',
    industryCode: '541510',
    coarseSector: null,
    officialMacroIndustry: { macroIndustryKeys: [MACRO], tableVersion: 'test' },
  };
}

function noMatch(input: DuplicateCheckInput): DuplicateCheckResult {
  return { status: 'new_candidate', confidence: 0, input, matches: [], summary: 'no_match', checkedSources: ['sellup', 'hubspot'] };
}

describe('lo que SellUp ya tiene', () => {
  it('claves: el registro de la fuente y, si hay, el número fiscal', () => {
    assert.deepEqual(sellupKeysOf(company('denue:1')), ['denue:1']);
    assert.deepEqual(sellupKeysOf(company('tax:AXT940727FP8', 'AXT940727FP8')), ['tax:AXT940727FP8']);
    assert.deepEqual(sellupKeysOf(company('denue:2', 'BIC1010137G6')), ['denue:2', 'tax:BIC1010137G6']);
  });

  it('se salta por registro de la fuente o por número fiscal; lo demás pasa', async () => {
    const asked: Parameters<FindAlreadyInSellup>[0][] = [];
    const find: FindAlreadyInSellup = async (input) => {
      asked.push(input);
      return { blocked: new Set(['denue:1', 'tax:BIC1010137G6']), blockedUnlessDomain: new Set<string>() };
    };
    const { fresh, alreadyInSellup } = await splitAlreadyInSellup(
      [company('denue:1'), company('denue:2', 'BIC1010137G6'), company('denue:3')],
      'MX',
      find,
    );
    assert.deepEqual(fresh.map((c) => c.recordIdentityKey), ['denue:3']);
    assert.equal(alreadyInSellup, 2);
    assert.deepEqual(asked[0].taxIds, ['BIC1010137G6']);
  });

  it('descartada sólo por falta de web: vuelve si ahora trae dominio, sigue fuera sin él', async () => {
    const find: FindAlreadyInSellup = async () => ({ blocked: new Set<string>(), blockedUnlessDomain: new Set(['tax:30500000000']) });
    const withDomain = { ...company('tax:30500000000', '30500000000'), domain: 'telecom.com.ar' };
    const withoutDomain = company('tax:30500000000', '30500000000');
    assert.equal((await splitAlreadyInSellup([withDomain], 'AR', find)).fresh.length, 1);
    assert.equal((await splitAlreadyInSellup([withoutDomain], 'AR', find)).fresh.length, 0);
  });

  it('sin lector o con lectura rota no se salta nada (fail-open)', async () => {
    const list = [company('denue:1')];
    assert.equal((await splitAlreadyInSellup(list, 'MX', null)).fresh.length, 1);
    const broken: FindAlreadyInSellup = async () => {
      throw new Error('db down');
    };
    assert.equal((await splitAlreadyInSellup(list, 'MX', broken)).fresh.length, 1);
  });

  it('en la corrida: lo ya visto cuenta como conocido por SellUp y no se acepta', async () => {
    const checked: string[] = [];
    const result = await runCountrySourcePrePaidDiscovery(
      { countryCode: 'MX', macroIndustryKey: MACRO, requestedTarget: 5 },
      {
        adapter: async () => ({ sourceKey: 'mx_denue', companies: [company('denue:1'), company('denue:2')], recordsRead: 2 }),
        checkCompanyDuplicate: async (input) => {
          checked.push(String(input.name));
          return noMatch(input);
        },
        findAlreadyInSellup: async () => ({ blocked: new Set(['denue:1']), blockedUnlessDomain: new Set<string>() }),
      },
    );
    assert.deepEqual(result.acceptedCompanies.map((c) => c.recordIdentityKey), ['denue:2']);
    assert.equal(result.outcome.sellupKnown, 1);
    assert.deepEqual(checked, ['EMPRESA SINTETICA denue:2'], 'lo ya visto ni siquiera gasta un chequeo de duplicado');
  });
});

describe('SOURCES-FREE-LAYER-ACTIVE-DOMAIN-1 — misma web que una candidata viva del mismo país', () => {
  const withDomain = (key: string, taxId: string, domain: string | null): CountrySourceCompany => ({
    ...company(key, taxId),
    countryCode: 'CO',
    taxIdentifierType: 'NIT',
    domain,
  });

  it('pide las webs canónicas (sin www.) y se salta la que ya está viva', async () => {
    const asked: Parameters<FindAlreadyInSellup>[0][] = [];
    const find: FindAlreadyInSellup = async (input) => {
      asked.push(input);
      return { blocked: new Set<string>(), blockedUnlessDomain: new Set<string>(), blockedDomains: new Set(['fiscalia.gov.co']) };
    };
    const { fresh, alreadyInSellup } = await splitAlreadyInSellup(
      [
        withDomain('tax:800152783', '800152783', 'https://WWW.Fiscalia.gov.co/'),
        withDomain('tax:899999003', '899999003', 'mindefensa.gov.co'),
        withDomain('tax:900000001', '900000001', null),
      ],
      'CO',
      find,
    );
    assert.deepEqual(asked[0].domains, ['fiscalia.gov.co', 'mindefensa.gov.co']);
    assert.deepEqual(fresh.map((c) => c.taxId), ['899999003', '900000001']);
    assert.equal(alreadyInSellup, 1);
  });

  it('un lector sin webs bloqueadas (versión anterior) no cambia nada', async () => {
    const find: FindAlreadyInSellup = async () => ({ blocked: new Set<string>(), blockedUnlessDomain: new Set<string>() });
    const { fresh } = await splitAlreadyInSellup([withDomain('tax:800152783', '800152783', 'fiscalia.gov.co')], 'CO', find);
    assert.equal(fresh.length, 1);
  });

  it('el lector real pide la web con y sin www., sólo del mismo país y de candidatas vivas', async () => {
    const { buildFindAlreadyInSellup } = await import('../prepaid-novelty-gate.server');
    type Call = { table: string; method: string; args: unknown[] };
    const calls: Call[] = [];
    const client = {
      from: (table: string) => {
        const builder: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'in', 'not']) {
          builder[method] = (...args: unknown[]) => {
            calls.push({ table, method, args });
            return builder;
          };
        }
        builder.then = (resolve: (v: unknown) => unknown) =>
          resolve({ data: table === 'prospect_candidates' && calls.some((c) => c.args[0] === 'domain') ? [{ domain: 'www.fiscalia.gov.co' }] : [], error: null });
        return builder;
      },
    };
    const find = buildFindAlreadyInSellup(client as never);
    const seen = await find({ countryCode: 'co', taxIds: [], recordIdentityKeys: [], domains: ['fiscalia.gov.co'] });

    assert.deepEqual([...(seen.blockedDomains ?? [])], ['fiscalia.gov.co']);
    const domainCalls = calls.filter((c) => c.table === 'prospect_candidates');
    assert.deepEqual(domainCalls.find((c) => c.method === 'eq')?.args, ['country_code', 'CO']);
    assert.deepEqual(domainCalls.find((c) => c.method === 'in')?.args, ['domain', ['fiscalia.gov.co', 'www.fiscalia.gov.co']]);
    assert.equal(domainCalls.find((c) => c.method === 'not')?.args[0], 'status');
  });
});
