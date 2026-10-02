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
import { preM126Rpc } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';

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
    // CUT-3B4-CORRECCIÓN — la 126 SIN aplicar se declara como lo hace la BASE.
    // Omitir `rpc` modelaría un cliente no soportado, y eso degrada CERRADO.
    rpc: preM126Rpc,
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
        // CUT-3B4-CORRECCIÓN — la siembra del registro de identidad LEE esta
        // tabla. El doble tiene que responderla: antes se caía y el `catch`
        // acababa contando como «la 126 no está aplicada», que era exactamente el
        // defecto —una avería habilitando una escritura sin valla—. Un lote nuevo
        // está vacío, así que la respuesta correcta es cero filas.
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: async () => ({ data: [], error: null }),
          insert(row: Record<string, unknown>) {
            stats.candidateInserts.push({ ...row });
            return Promise.resolve({ error: null });
          },
        };
        return chain;
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

  it('una fuente que SÍ publica web (DENUE) la guarda: website, dominio y sin missing_website', async () => {
    const stats = freshStats();
    await persistCountrySourceCandidates(makeFakeSupabase(stats), {
      companies: [
        syntheticCompany({
          recordIdentityKey: 'denue:12345',
          legalName: 'AT&T COMUNICACIONES DIGITALES S. DE R.L. DE C.V.',
          countryCode: 'MX',
          domain: 'att.com.mx',
          industryCode: '517312',
        }),
      ],
      countryCode: 'MX',
      countryName: 'México',
      macroIndustryKey: 'technology',
      requestedByUserId: 'user-synthetic-1',
    });

    const inserted = stats.candidateInserts[0];
    assert.equal(inserted.website, 'https://att.com.mx');
    assert.equal(inserted.domain, 'att.com.mx');
    assert.equal((inserted.review_flags as string[]).includes('missing_website'), false);
    assert.equal((inserted.metadata as Record<string, unknown>).website_available, true);
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

/**
 * Un candidato CON identificador fiscal activa la comprobación de novedad fiscal
 * del writer, que lee `prospect_candidates` y `accounts` con cadenas
 * `.select().in().eq()…`. Este doble responde cualquier cadena de lectura con cero
 * filas (lote nuevo, nada conocido) y conserva las escrituras del doble base.
 */
function makeFiscalAwareFakeSupabase(stats: Stats): SupabaseClient {
  const base = makeFakeSupabase(stats) as unknown as { rpc: unknown; from(table: string): unknown };
  const emptyRead = () => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'in', 'eq', 'neq', 'order', 'limit', 'not', 'or', 'ilike', 'is']) {
      chain[op] = () => chain;
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return chain;
  };
  return {
    rpc: base.rpc,
    from(table: string) {
      if (table === 'accounts') return emptyRead();
      if (table === 'prospect_candidates') {
        const chain = emptyRead();
        chain.insert = (row: Record<string, unknown>) => {
          stats.candidateInserts.push({ ...row });
          return Promise.resolve({ error: null });
        };
        return chain;
      }
      return base.from(table);
    },
  } as unknown as SupabaseClient;
}

describe('SOURCES-DO-FREE-DISCOVERY-1 — República Dominicana', () => {
  it('el candidato dominicano lleva su propia fuente, su RNC y su código CIIU.DR', async () => {
    const stats = freshStats();
    const result = await persistCountrySourceCandidates(makeFiscalAwareFakeSupabase(stats), {
      companies: [
        syntheticCompany({
          recordIdentityKey: 'rnc:100000009',
          legalName: 'EMPRESA SINTETICA DO SRL',
          normalizedLegalName: 'EMPRESA SINTETICA DO SRL',
          taxId: '100000009',
          taxIdentifierType: 'RNC',
          countryCode: 'DO',
          city: null,
          region: null,
          declaredIndustry: 'Actividades de informática N.C.P.',
          industryCode: '729000',
          coarseSector: null,
          officialMacroIndustry: { macroIndustryKeys: ['technology'], tableVersion: 'do-ciiu-dr-2009-macro-v1' },
        }),
      ],
      countryCode: 'DO',
      countryName: 'República Dominicana',
      macroIndustryKey: 'technology',
      requestedByUserId: 'user-synthetic-1',
    });

    assert.equal(result.failed, false);
    assert.equal(result.writtenCount, 1);
    const candidate = stats.candidateInserts[0];
    assert.equal(candidate.source_primary, 'public_source');
    assert.equal(candidate.tax_identifier, '100000009');
    assert.equal(candidate.tax_identifier_type, 'RNC');
    const trace = candidate.source_trace as Record<string, unknown>;
    assert.equal(trace.sourceKey, 'do_dgii_discovery');
    assert.equal(trace.industryCode, '729000');
    const metadata = candidate.metadata as Record<string, unknown>;
    assert.equal(metadata.macro_industry_key, 'technology');
    assert.equal(stats.batchInserts[0].source, 'agent_1');
  });

  it('Colombia sigue escribiendo co_siis_discovery', async () => {
    const stats = freshStats();
    await persistCountrySourceCandidates(makeFakeSupabase(stats), {
      companies: [syntheticCompany()],
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedByUserId: 'user-synthetic-1',
    });
    const candidate = stats.candidateInserts[0];
    assert.equal((candidate.source_trace as Record<string, unknown>).sourceKey, 'co_siis_discovery');
  });
});

describe('SOURCES-AR-RNS-1 — Argentina', () => {
  it('el candidato argentino lleva su propia fuente, su CUIT y su código de actividad', async () => {
    const stats = freshStats();
    const result = await persistCountrySourceCandidates(makeFiscalAwareFakeSupabase(stats), {
      companies: [
        syntheticCompany({
          recordIdentityKey: 'tax:30500001001',
          legalName: 'EMPRESA SINTETICA AR S.A.',
          normalizedLegalName: 'EMPRESA SINTETICA AR S.A.',
          taxId: '30500001001',
          taxIdentifierType: 'CUIT',
          countryCode: 'AR',
          city: 'CAPITAL FEDERAL',
          region: 'CIUDAD AUTONOMA BUENOS AIRES',
          declaredIndustry: 'Servicios de informática n.c.p.',
          industryCode: '620100',
          coarseSector: null,
          officialMacroIndustry: { macroIndustryKeys: ['technology'], tableVersion: 'ar-ciiu4-arca-macro-v1' },
        }),
      ],
      countryCode: 'AR',
      countryName: 'Argentina',
      macroIndustryKey: 'technology',
      requestedByUserId: 'user-synthetic-1',
    });

    assert.equal(result.failed, false);
    assert.equal(result.writtenCount, 1);
    const candidate = stats.candidateInserts[0];
    assert.equal(candidate.source_primary, 'public_source');
    assert.equal(candidate.tax_identifier, '30500001001');
    assert.equal(candidate.tax_identifier_type, 'CUIT');
    assert.equal(candidate.country_code, 'AR');
    const trace = candidate.source_trace as Record<string, unknown>;
    assert.equal(trace.sourceKey, 'ar_rns_discovery');
    assert.equal(trace.industryCode, '620100');
    assert.equal((candidate.metadata as Record<string, unknown>).macro_industry_key, 'technology');
    assert.equal(stats.batchInserts[0].source, 'agent_1');
  });
});

describe('SOURCES-EC-FREE-DISCOVERY-1 — Ecuador', () => {
  it('el candidato ecuatoriano lleva su propia fuente, su RUC y su CIIU; la procedencia sigue siendo la lista cerrada', async () => {
    const stats = freshStats();
    const result = await persistCountrySourceCandidates(makeFiscalAwareFakeSupabase(stats), {
      companies: [
        syntheticCompany({
          recordIdentityKey: 'tax:1791234567001',
          legalName: 'EMPRESA SINTETICA EC S.A.',
          normalizedLegalName: 'EMPRESA SINTETICA EC',
          taxId: '1791234567001',
          taxIdentifierType: 'RUC',
          countryCode: 'EC',
          city: 'QUITO',
          region: 'PICHINCHA',
          declaredIndustry: null,
          industryCode: 'J6201.01',
          coarseSector: null,
          officialMacroIndustry: { macroIndustryKeys: ['technology'], tableVersion: 'ec-ciiu4-inec-macro-v1' },
        }),
      ],
      countryCode: 'EC',
      countryName: 'Ecuador',
      macroIndustryKey: 'technology',
      requestedByUserId: 'user-synthetic-1',
    });

    assert.equal(result.failed, false);
    assert.equal(result.writtenCount, 1);
    const candidate = stats.candidateInserts[0];
    assert.equal(candidate.source_primary, 'public_source');
    assert.equal(candidate.tax_identifier, '1791234567001');
    assert.equal(candidate.tax_identifier_type, 'RUC');
    assert.equal(candidate.country_code, 'EC');
    const trace = candidate.source_trace as Record<string, unknown>;
    assert.equal(trace.sourceKey, 'ec_scvs_directory_discovery');
    assert.equal(trace.industryCode, 'J6201.01');
    assert.equal((candidate.metadata as Record<string, unknown>).macro_industry_key, 'technology');
    assert.equal(stats.batchInserts[0].source, 'agent_1');
  });
});
