/**
 * SOURCES-FREE-LAYER-OFFICIAL-SIZE-1 — el tamaño que la fuente oficial publica
 * llega a la ficha del candidato de la capa gratuita.
 *
 * Prod 07-10 (PE×Gobierno 14cfb6ef): 10 municipalidades con 1.604–3.169
 * trabajadores en el padrón SUNAT y la ficha decía «tamaño por validar». Aquí:
 * el adapter de Perú lo entrega, el writer común lo escribe en `employee_count`
 * con su procedencia y, sin dato, todo sigue como antes. Cero E/S.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { persistCountrySourceCandidates } from '../persist-country-source-candidates';
import { buildCountrySourceOfficialWorkforce, type CountrySourceCompany } from '../country-source-types';
import {
  buildPeSunatDirectoryDiscoveryAdapter,
  type PeSunatDirectorySnapshotReadRow,
} from '../pe-sunat-directory-discovery-adapter';
import {
  officialEmployeeCountSourceText,
  resolveOfficialEmployeeCount,
} from '@/server/agents/prospecting-toolkit/structured-source-candidate-writer';
import { resolveEmployeeCountFieldDisplay } from '@/modules/prospect-batches/candidate-company-fields-display';
import { preM126Rpc } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';

function makeFakeSupabase(candidateInserts: Array<Record<string, unknown>>): SupabaseClient {
  return {
    rpc: preM126Rpc,
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          insert() {
            return { select: () => ({ single: async () => ({ data: { id: 'batch-1' }, error: null }) }) };
          },
        };
      }
      if (table === 'prospect_candidates') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: async () => ({ data: [], error: null }),
          insert(row: Record<string, unknown>) {
            candidateInserts.push({ ...row });
            return Promise.resolve({ error: null });
          },
        };
        return chain;
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function company(overrides: Partial<CountrySourceCompany> = {}): CountrySourceCompany {
  return {
    recordIdentityKey: 'tax:20600000001',
    legalName: 'MUNICIPALIDAD PROVINCIAL SINTETICA',
    normalizedLegalName: 'municipalidad provincial sintetica',
    // Sin RUC: el doble no modela el índice de novedad por número fiscal, y el
    // tamaño no depende de él.
    taxId: null,
    taxIdentifierType: 'RUC',
    countryCode: 'PE',
    city: 'LIMA',
    region: 'LIMA',
    domain: 'munisintetica.gob.pe',
    declaredIndustry: 'ACTIVIDADES DE LA ADMINISTRACION PUBLICA EN GENERAL',
    industryCode: '8411',
    coarseSector: null,
    ...overrides,
  };
}

async function persistOne(c: CountrySourceCompany): Promise<Record<string, unknown>> {
  const inserts: Array<Record<string, unknown>> = [];
  const result = await persistCountrySourceCandidates(makeFakeSupabase(inserts), {
    companies: [c],
    countryCode: 'PE',
    countryName: 'Perú',
    macroIndustryKey: 'government',
    requestedByUserId: 'user-synthetic-1',
    claimIdentities: async () => ({ degraded: false, claimedElsewhere: [] }) as never,
  });
  assert.equal(result.failed, false);
  assert.equal(inserts.length, 1);
  return inserts[0];
}

describe('buildCountrySourceOfficialWorkforce', () => {
  it('sólo enteros positivos; el año raro se descarta sin tirar el número', () => {
    assert.deepEqual(buildCountrySourceOfficialWorkforce(2078, 2026, 'SUNAT'), { workers: 2078, year: 2026, sourceLabel: 'SUNAT' });
    assert.deepEqual(buildCountrySourceOfficialWorkforce(250, 26, 'SII'), { workers: 250, year: null, sourceLabel: 'SII' });
    for (const bad of [null, undefined, 0, -3, 12.5, Number.NaN]) {
      assert.equal(buildCountrySourceOfficialWorkforce(bad as number | null, 2026, 'SUNAT'), null);
    }
  });
});

describe('resolveOfficialEmployeeCount (writer común)', () => {
  it('≥100 ⇒ estimated_100_plus; <100 ⇒ estimated_under_100 (estimado oficial, nunca confirmado); sin dato o sin etiqueta ⇒ null', () => {
    assert.equal(resolveOfficialEmployeeCount({ officialEmployeeCount: { count: 100, year: 2026, sourceLabel: 'SII' } })?.status, 'estimated_100_plus');
    assert.equal(resolveOfficialEmployeeCount({ officialEmployeeCount: { count: 99, year: null, sourceLabel: 'SII' } })?.status, 'estimated_under_100');
    assert.equal(resolveOfficialEmployeeCount({}), null);
    assert.equal(resolveOfficialEmployeeCount({ officialEmployeeCount: { count: 0, year: 2026, sourceLabel: 'SII' } }), null);
    assert.equal(resolveOfficialEmployeeCount({ officialEmployeeCount: { count: 300, year: 2026, sourceLabel: '  ' } }), null);
  });

  it('la procedencia lleva el año cuando existe', () => {
    assert.equal(officialEmployeeCountSourceText({ sourceLabel: 'SUNAT', year: 2026 }), 'SUNAT 2026');
    assert.equal(officialEmployeeCountSourceText({ sourceLabel: 'SIGEP', year: null }), 'SIGEP');
  });
});

describe('persistCountrySourceCandidates → writer → fila', () => {
  it('con tamaño oficial: employee_count, estado estimado, procedencia y la ficha lo muestra', async () => {
    const row = await persistOne(company({ officialWorkforce: { workers: 2078, year: 2026, sourceLabel: 'SUNAT' } }));
    assert.equal(row.employee_count, 2078);
    assert.equal(row.employee_count_status, 'estimated_100_plus');
    assert.equal(row.employee_count_source, 'SUNAT 2026');
    assert.equal(row.employee_count_confidence, 90);
    const metadata = row.metadata as Record<string, unknown>;
    const enrichment = metadata.enrichment as Record<string, unknown>;
    assert.ok(!(enrichment.missing_fields as string[]).includes('company_size'));
    assert.deepEqual(metadata.company_employee_count, {
      employee_count: 2078,
      employee_count_status: 'official_estimate',
      employee_count_source: 'SUNAT 2026',
    });
    const display = resolveEmployeeCountFieldDisplay(row.metadata, row.employee_count as number);
    assert.equal(display.kind, 'value');
    assert.equal(display.value, 2078);
    assert.equal(display.sourceLabel, 'Fuente: SUNAT 2026');
  });

  it('sin tamaño oficial: todo como antes («por validar»)', async () => {
    const row = await persistOne(company());
    assert.equal(row.employee_count, null);
    assert.equal(row.employee_count_status, 'unknown_requires_manual_validation');
    assert.equal(row.employee_count_source, null);
    assert.equal(row.employee_count_confidence, null);
    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata.company_employee_count, undefined);
    assert.equal(metadata.notes, 'Tamaño no confirmado — validar manualmente');
    assert.ok(((metadata.enrichment as Record<string, unknown>).missing_fields as string[]).includes('company_size'));
  });
});

describe('adapters con número exacto', () => {
  it('Perú entrega los trabajadores del padrón SUNAT con su año', async () => {
    const row: PeSunatDirectorySnapshotReadRow = {
      record_identity_key: 'tax:20600000001',
      ruc: '20600000001',
      legal_name: 'MUNICIPALIDAD PROVINCIAL SINTETICA',
      normalized_legal_name: 'MUNICIPALIDAD PROVINCIAL SINTETICA',
      city: 'LIMA',
      region: 'LIMA',
      ciiu4_code: '8411',
      activity_text: 'ACTIVIDADES DE LA ADMINISTRACION PUBLICA EN GENERAL',
      website_domain: 'munisintetica.gob.pe',
      employees: 2078,
      metrics_year: 2026,
      priority_score: 2078,
    };
    const adapter = buildPeSunatDirectoryDiscoveryAdapter({ readCompaniesByMacro: async () => [row] });
    const result = await adapter({ countryCode: 'PE', macroIndustryKey: 'government', limit: 10 });
    assert.equal(result.companies.length, 1);
    assert.deepEqual(result.companies[0].officialWorkforce, { workers: 2078, year: 2026, sourceLabel: 'SUNAT' });
  });

  it('Ecuador, Chile y entidades públicas de Colombia también lo entregan (guarda estática)', () => {
    const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const read = (file: string) => strip(readFileSync(join(process.cwd(), 'src/server/prospect-batches/country-source-discovery', file), 'utf8'));
    assert.match(read('ec-scvs-directory-discovery-adapter.ts'), /officialWorkforce: buildCountrySourceOfficialWorkforce\(row\.employees, row\.metrics_year, 'Supercias'\)/);
    assert.match(read('cl-sii-directory-discovery-adapter.ts'), /officialWorkforce: buildCountrySourceOfficialWorkforce\(row\.workers, row\.metrics_year, 'SII'\)/);
    assert.match(read('co-siis-discovery-adapter.ts'), /officialWorkforce: buildCountrySourceOfficialWorkforce\(row\.workers, null, 'SIGEP'\)/);
  });
});
