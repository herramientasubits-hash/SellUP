/**
 * Tests — AGENT1-COUNTRY-SOURCE-PERSISTENCE-CONTRACT-1, caller real co_siis.
 *
 * `persistCountrySourceCandidates` es el ÚNICO caller que hoy pasa
 * `sourceProvider = public_source` al writer genérico. Antes del fix eso
 * también fijaba `prospect_batches.source = public_source`, que el CHECK de
 * la base rechaza (migrations 040-052) — el lote NUNCA se creaba y el
 * candidato tampoco, así que una corrida con `residualGap = 0` no dejaba
 * NADA para revisar.
 *
 * Este test ejercita el caller real, no un doble del writer: verifica que la
 * llamada completa (persist-country-source-candidates → writer genérico →
 * INSERT) produce el vocabulario correcto en ambas tablas y conserva la
 * procedencia del batch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { persistCountrySourceCandidates } from '../persist-country-source-candidates';
import type { CountrySourceCompany } from '../country-source-types';

type Stats = {
  batchInserts: Array<Record<string, unknown>>;
  candidateInserts: Array<Record<string, unknown>>;
};

function freshStats(): Stats {
  return { batchInserts: [], candidateInserts: [] };
}

function makeFakeSupabase(stats: Stats): SupabaseClient {
  let batchSeq = 0;
  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          insert(row: Record<string, unknown>) {
            stats.batchInserts.push({ ...row });
            return {
              select() {
                return { single: async () => ({ data: { id: `batch-${++batchSeq}` }, error: null }) };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidates') {
        return {
          insert(row: Record<string, unknown>) {
            stats.candidateInserts.push({ ...row });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function syntheticCompany(overrides: Partial<CountrySourceCompany> = {}): CountrySourceCompany {
  return {
    recordIdentityKey: 'co-siis-record-0001',
    legalName: 'EMPRESA SINTETICA CO-SIIS',
    normalizedLegalName: 'empresa sintetica co-siis',
    taxId: null,
    taxIdentifierType: null,
    countryCode: 'CO',
    city: 'BOGOTA',
    region: 'BOGOTA D.C.',
    domain: null,
    declaredIndustry: 'Fabricación de productos farmacéuticos',
    industryCode: '2100',
    coarseSector: 'MANUFACTURA',
    ...overrides,
  };
}

describe('AGENT1-COUNTRY-SOURCE-PERSISTENCE-CONTRACT-1 — caller co_siis real', () => {
  it('el lote se crea con source=agent_1 (nunca public_source) y el candidato con source_primary=public_source', async () => {
    const stats = freshStats();
    const result = await persistCountrySourceCandidates(makeFakeSupabase(stats), {
      companies: [syntheticCompany()],
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedByUserId: 'user-synthetic-1',
    });

    assert.equal(result.failed, false);
    assert.equal(result.writtenCount, 1);
    assert.ok(result.batchId);

    assert.equal(stats.batchInserts.length, 1);
    assert.equal(stats.batchInserts[0].source, 'agent_1');
    assert.notEqual(stats.batchInserts[0].source, 'public_source');

    assert.equal(stats.candidateInserts.length, 1);
    assert.equal(stats.candidateInserts[0].source_primary, 'public_source');
  });

  it('source_trace conserva sourceKey, sourceRecordId y el código CIIU (industryCode)', async () => {
    const stats = freshStats();
    await persistCountrySourceCandidates(makeFakeSupabase(stats), {
      companies: [syntheticCompany({ recordIdentityKey: 'co-siis-record-9999', industryCode: '2100' })],
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedByUserId: 'user-synthetic-1',
    });

    const trace = stats.candidateInserts[0].source_trace as Record<string, unknown>;
    assert.equal(trace.sourceKey, 'co_siis_discovery');
    assert.equal(trace.sourceRecordId, 'co-siis-record-9999');
    assert.equal(trace.industryCode, '2100');
  });

  it('metadata.discovery_layer y metadata.macro_industry_key llegan al candidato', async () => {
    const stats = freshStats();
    await persistCountrySourceCandidates(makeFakeSupabase(stats), {
      companies: [syntheticCompany()],
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedByUserId: 'user-synthetic-1',
    });

    const metadata = stats.candidateInserts[0].metadata as Record<string, unknown>;
    assert.equal(metadata.discovery_layer, 'country_source_prepaid');
    assert.equal(metadata.macro_industry_key, 'health_pharma');
    assert.equal(metadata.website_available, false);
  });

  it('missing_website viaja en review_flags y website es null (§ 22(I))', async () => {
    const stats = freshStats();
    await persistCountrySourceCandidates(makeFakeSupabase(stats), {
      companies: [syntheticCompany()],
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedByUserId: 'user-synthetic-1',
    });

    const inserted = stats.candidateInserts[0];
    assert.equal(inserted.website, null);
    assert.ok((inserted.review_flags as string[]).includes('missing_website'));
  });

  it('el metadata del LOTE conserva discovery_layer y macro_industry_key sin ambigüedad', async () => {
    const stats = freshStats();
    await persistCountrySourceCandidates(makeFakeSupabase(stats), {
      companies: [syntheticCompany()],
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedByUserId: 'user-synthetic-1',
      metadata: { prepaid_novelty: { some_telemetry_field: 42 } },
    });

    const batchMetadata = stats.batchInserts[0].metadata as Record<string, unknown>;
    assert.equal(batchMetadata.discovery_layer, 'country_source_prepaid');
    assert.equal(batchMetadata.macro_industry_key, 'health_pharma');
    // La telemetría del caller convive, no se pierde por el merge.
    assert.deepEqual(batchMetadata.prepaid_novelty, { some_telemetry_field: 42 });
  });

  it('mutación — telemetría del caller NO puede sobrescribir discovery_layer del batch', async () => {
    const stats = freshStats();
    await persistCountrySourceCandidates(makeFakeSupabase(stats), {
      companies: [syntheticCompany()],
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedByUserId: 'user-synthetic-1',
      // Un caller (o telemetría corrupta) intentando pisar la clave canónica.
      metadata: { discovery_layer: 'attacker_injected_layer', macro_industry_key: 'attacker_injected_macro' },
    });

    const batchMetadata = stats.batchInserts[0].metadata as Record<string, unknown>;
    assert.equal(batchMetadata.discovery_layer, 'country_source_prepaid');
    assert.equal(batchMetadata.macro_industry_key, 'health_pharma');
  });

  it('lote vacío no falla y no persiste nada', async () => {
    const stats = freshStats();
    const result = await persistCountrySourceCandidates(makeFakeSupabase(stats), {
      companies: [],
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedByUserId: 'user-synthetic-1',
    });

    assert.equal(result.failed, false);
    assert.equal(result.writtenCount, 0);
    assert.equal(stats.batchInserts.length, 0);
  });
});
