/**
 * SOURCES-BO-CLOSE-1 — descubrimiento gratuito de Bolivia: grandes contribuyentes
 * (PRICO/GRACO, con NIT) y entidades públicas de gob.bo (con web, sin NIT).
 *
 * Adapter con lecturas dobles y lectura de producción con un cliente doble que
 * registra cada llamada (cualquier escritura revienta la prueba). Cero E/S.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  BO_OFFICIAL_DISCOVERY_MAX_ROWS,
  BO_OFFICIAL_DISCOVERY_SOURCE_KEY,
  buildBoOfficialDiscoveryAdapter,
  macroHasBoDiscoveryCoverage,
  type BoLargeTaxpayerReadRow,
  type BoOfficialDiscoveryReads,
  type BoPublicEntityReadRow,
} from '../bo-official-discovery-adapter';
import { buildBoOfficialDiscoveryReads } from '../bo-official-discovery-snapshot-query';
import { BO_ACTIVITY_MACRO_TABLE_VERSION } from '../bo-activity-macro-table';
import {
  buildCountrySourceAdapter,
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';

const nit = (n: number): string => `10200${String(n).padStart(3, '0')}02${n % 10}`;

function taxpayer(n: number, overrides: Partial<BoLargeTaxpayerReadRow> = {}): BoLargeTaxpayerReadRow {
  return {
    record_identity_key: `tax:${nit(n)}`,
    nit: nit(n),
    legal_name: `SISTEMAS SINTETICOS ${n} S.R.L.`,
    normalized_legal_name: `SISTEMAS SINTETICOS ${n}`,
    department: 'SANTA CRUZ',
    social_purpose: 'DESARROLLO DE SOFTWARE Y SERVICIOS INFORMATICOS',
    matricula_renewed: true,
    taxpayer_category: 'GRACO',
    priority_score: 1,
    ...overrides,
  };
}

function entity(slug: string, overrides: Partial<BoPublicEntityReadRow> = {}): BoPublicEntityReadRow {
  return {
    record_identity_key: `gobbo:${slug}`,
    legal_name: `Entidad ${slug}`,
    normalized_legal_name: `ENTIDAD ${slug.toUpperCase()}`,
    city: 'La Paz',
    department: 'La Paz',
    entity_kind: 'ministry',
    website_domain: `${slug}.gob.bo`,
    macro_industry_key: 'government',
    ...overrides,
  };
}

function fakeReads(taxpayers: BoLargeTaxpayerReadRow[], entities: BoPublicEntityReadRow[]) {
  const calls: { source: string; macroIndustryKey: string; limit: number }[] = [];
  const reads: BoOfficialDiscoveryReads = {
    readLargeTaxpayersByMacro: async (input) => {
      calls.push({ source: 'taxpayers', ...input });
      return taxpayers;
    },
    readPublicEntitiesByMacro: async (input) => {
      calls.push({ source: 'entities', ...input });
      return entities;
    },
  };
  return { reads, calls };
}

describe('capacidad por país', () => {
  it('Bolivia tiene fuente gratuita y los demás conservan la suya', () => {
    assert.ok(COUNTRY_SOURCE_DISCOVERY_COUNTRIES.includes('BO'));
    assert.deepEqual(resolveCountrySourceCapability('bo'), { countryCode: 'BO', sourceKey: BO_OFFICIAL_DISCOVERY_SOURCE_KEY });
    assert.equal(resolveCountrySourceCapability('PE')?.sourceKey, 'pe_sunat_directory_discovery');
    assert.equal(resolveCountrySourceCapability('VE'), null);
  });

  it('la cobertura de Bolivia: macros con reglas, más Gobierno', () => {
    assert.equal(countrySourceMacroHasCoverage('BO', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('BO', 'government'), true);
    assert.equal(countrySourceMacroHasCoverage('BO', 'no_existe'), false);
    assert.equal(macroHasBoDiscoveryCoverage(null), false);
  });

  it('sin lectura inyectada no hay adapter (fail-open al pago)', () => {
    assert.equal(buildCountrySourceAdapter('BO', {}), null);
    assert.equal(buildCountrySourceAdapter('BO', { peSunatDirectoryDiscoveryReads: { readCompaniesByMacro: async () => [] } }), null);
    assert.ok(buildCountrySourceAdapter('BO', { boOfficialDiscoveryReads: fakeReads([], []).reads }));
  });
});

describe('buildBoOfficialDiscoveryAdapter', () => {
  it('grandes contribuyentes con NIT, macro de la tabla de HOY y sin web inventada', async () => {
    const { reads, calls } = fakeReads([taxpayer(1), taxpayer(2)], []);
    const result = await buildBoOfficialDiscoveryAdapter(reads)({ countryCode: 'BO', macroIndustryKey: 'technology', limit: 10 });
    assert.equal(result.sourceKey, BO_OFFICIAL_DISCOVERY_SOURCE_KEY);
    assert.deepEqual(result.companies.map((c) => c.taxId), [nit(1), nit(2)]);
    const [first] = result.companies;
    assert.equal(first.taxIdentifierType, 'NIT');
    assert.equal(first.countryCode, 'BO');
    assert.equal(first.domain, null);
    assert.equal(first.region, 'SANTA CRUZ');
    assert.deepEqual(first.officialMacroIndustry, { macroIndustryKeys: ['technology'], tableVersion: BO_ACTIVITY_MACRO_TABLE_VERSION });
    assert.deepEqual(calls.map((c) => c.source).sort(), ['entities', 'taxpayers']);
  });

  it('re-clasifica: la fila de otra macro, sin macro o con matrícula no renovada no se ofrece', async () => {
    const { reads } = fakeReads(
      [
        taxpayer(1),
        taxpayer(2, { legal_name: 'CONSTRUCTORA SINTETICA S.R.L.', social_purpose: 'CONSTRUCCION' }),
        taxpayer(3, { legal_name: 'KAOBA S.R.L.', social_purpose: 'ACTOS DE COMERCIO EN GENERAL' }),
        taxpayer(4, { matricula_renewed: false }),
      ],
      [],
    );
    const result = await buildBoOfficialDiscoveryAdapter(reads)({ countryCode: 'BO', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.taxId), [nit(1)]);
    assert.equal(result.recordsRead, 4);
  });

  it('lo que SellUp ya tiene no se vuelve a proponer', async () => {
    const { reads } = fakeReads(
      [taxpayer(1, { prior_sighting: 'candidate' }), taxpayer(2, { prior_sighting: 'definitive_discard' }), taxpayer(3, { prior_sighting: 'discard' }), taxpayer(4)],
      [],
    );
    const result = await buildBoOfficialDiscoveryAdapter(reads)({ countryCode: 'BO', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.taxId), [nit(4)]);
  });

  it('NIT de persona natural, sin nombre o repetido: fuera', async () => {
    const { reads } = fakeReads([taxpayer(1), taxpayer(1), taxpayer(2, { nit: '6082096011' }), taxpayer(3, { legal_name: ' ' })], []);
    const result = await buildBoOfficialDiscoveryAdapter(reads)({ countryCode: 'BO', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.taxId), [nit(1)]);
  });

  it('Gobierno: entidades con web primero, luego las que no la traen; sin NIT inventado', async () => {
    const { reads, calls } = fakeReads(
      [taxpayer(1)],
      [entity('sinweb', { website_domain: null }), entity('mineco'), entity('asfi', { website_domain: 'www.asfi.gob.bo' })],
    );
    const result = await buildBoOfficialDiscoveryAdapter(reads)({ countryCode: 'BO', macroIndustryKey: 'government', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.recordIdentityKey), ['gobbo:mineco', 'gobbo:asfi', 'gobbo:sinweb']);
    assert.deepEqual(result.companies.map((c) => c.domain), ['mineco.gob.bo', 'asfi.gob.bo', null]);
    assert.equal(result.companies.every((c) => c.taxId === null && c.taxIdentifierType === null), true);
    assert.equal(calls.some((c) => c.source === 'taxpayers'), false, 'Gobierno no lee grandes contribuyentes');
  });

  it('otra macro: empresas públicas con web, luego grandes contribuyentes, luego públicas sin web', async () => {
    const { reads } = fakeReads(
      [taxpayer(1)],
      [entity('entel', { macro_industry_key: 'technology', entity_kind: 'public_company' }), entity('otra', { macro_industry_key: 'technology', website_domain: null })],
    );
    const result = await buildBoOfficialDiscoveryAdapter(reads)({ countryCode: 'BO', macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(result.companies.map((c) => c.recordIdentityKey), ['gobbo:entel', `tax:${nit(1)}`, 'gobbo:otra']);
  });

  it('empresa pública que también es gran contribuyente: UNA vez, con el NIT y la web de gob.bo', async () => {
    const { reads } = fakeReads(
      [taxpayer(1, { normalized_legal_name: 'EMPRESA NACIONAL DE TELECOMUNICACIONES' })],
      [entity('entel', { normalized_legal_name: 'EMPRESA NACIONAL DE TELECOMUNICACIONES', macro_industry_key: 'technology', website_domain: 'www.entel.bo' })],
    );
    const result = await buildBoOfficialDiscoveryAdapter(reads)({ countryCode: 'BO', macroIndustryKey: 'technology', limit: 10 });
    assert.equal(result.companies.length, 1);
    assert.equal(result.companies[0].taxId, nit(1));
    assert.equal(result.companies[0].domain, 'entel.bo');
  });

  it('respeta el límite (techo 200) y no consulta con límite 0 ni sin cobertura', async () => {
    const { reads, calls } = fakeReads([taxpayer(1), taxpayer(2), taxpayer(3)], []);
    const adapter = buildBoOfficialDiscoveryAdapter(reads);
    const two = await adapter({ countryCode: 'BO', macroIndustryKey: 'technology', limit: 2 });
    assert.equal(two.companies.length, 2);
    await adapter({ countryCode: 'BO', macroIndustryKey: 'technology', limit: 5000 });
    assert.equal(calls.at(-1)?.limit, BO_OFFICIAL_DISCOVERY_MAX_ROWS);
    const before = calls.length;
    await adapter({ countryCode: 'BO', macroIndustryKey: 'technology', limit: 0 });
    await adapter({ countryCode: 'BO', macroIndustryKey: 'no_existe', limit: 5 });
    assert.equal(calls.length, before);
  });
});

describe('lectura de producción (buildBoOfficialDiscoveryReads)', () => {
  type Call = { method: string; args: unknown[] };

  function fakeClient(snapshot: unknown[], sightings: { candidates?: unknown[]; discards?: unknown[] } = {}) {
    const calls: Call[] = [];
    let table = '';
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.from = (name: string) => {
      table = name;
      calls.push({ method: 'from', args: [name] });
      return builder;
    };
    builder.limit = (...args: unknown[]) => {
      calls.push({ method: 'limit', args });
      return Promise.resolve({ data: snapshot, error: null });
    };
    builder.in = (...args: unknown[]) => {
      calls.push({ method: 'in', args });
      const data = table === 'prospect_candidates' ? sightings.candidates ?? [] : sightings.discards ?? [];
      return Promise.resolve({ data, error: null });
    };
    for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
      builder[write] = () => {
        throw new Error(`escritura prohibida: ${write}`);
      };
    }
    return { client: builder as unknown as SupabaseClient, calls };
  }

  it('grandes contribuyentes: sólo bo_large_taxpayers / BO, macro pedida, matrícula renovada, ×3 con tope; marca lo ya visto', async () => {
    const { client, calls } = fakeClient(
      [
        {
          record_identity_key: `tax:${nit(1)}`,
          normalized_tax_id: nit(1),
          legal_name: 'SISTEMAS SINTETICOS 1 S.R.L.',
          normalized_legal_name: 'SISTEMAS SINTETICOS 1',
          city: null,
          department: 'LA PAZ',
          priority_score: '4',
          raw_data: { social_purpose: 'SOFTWARE', matricula_renewed: true, taxpayer_category: 'PRICO' },
        },
      ],
      { candidates: [{ tax_identifier: nit(1) }] },
    );
    const rows = await buildBoOfficialDiscoveryReads(client).readLargeTaxpayersByMacro({ macroIndustryKey: 'technology', limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].taxpayer_category, 'PRICO');
    assert.equal(rows[0].matricula_renewed, true);
    assert.equal(rows[0].prior_sighting, 'candidate');
    const eqs = calls.filter((c) => c.method === 'eq').map((c) => c.args);
    assert.deepEqual(eqs.slice(0, 4), [
      ['source_key', 'bo_large_taxpayers'],
      ['country_code', 'BO'],
      ['raw_data->>macro_industry_key', 'technology'],
      ['raw_data->>matricula_renewed', 'true'],
    ]);
    assert.deepEqual(calls.find((c) => c.method === 'limit')?.args, [30]);
  });

  it('entidades públicas: sólo bo_public_entities / BO de la macro; un error degrada a vacío', async () => {
    const { client, calls } = fakeClient([
      {
        record_identity_key: 'gobbo:ende',
        normalized_tax_id: null,
        legal_name: 'Empresa Nacional de Electricidad',
        normalized_legal_name: 'EMPRESA NACIONAL DE ELECTRICIDAD',
        city: 'Cochabamba',
        department: 'Cochabamba',
        priority_score: 3,
        raw_data: { entity_kind: 'public_company', website_domain: 'ende.bo', macro_industry_key: 'energy_mining_environment' },
      },
    ]);
    const rows = await buildBoOfficialDiscoveryReads(client).readPublicEntitiesByMacro({ macroIndustryKey: 'energy_mining_environment', limit: 5 });
    assert.equal(rows[0].website_domain, 'ende.bo');
    assert.deepEqual(calls.filter((c) => c.method === 'eq').map((c) => c.args)[0], ['source_key', 'bo_public_entities']);
    const broken = { from: () => { throw new Error('caído'); } } as unknown as SupabaseClient;
    assert.deepEqual(await buildBoOfficialDiscoveryReads(broken).readPublicEntitiesByMacro({ macroIndustryKey: 'government', limit: 5 }), []);
    assert.deepEqual(await buildBoOfficialDiscoveryReads(broken).readLargeTaxpayersByMacro({ macroIndustryKey: 'technology', limit: 5 }), []);
  });
});
