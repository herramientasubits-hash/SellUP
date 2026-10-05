/**
 * SOURCES-PA-RUC-BY-NAME-1 — Panamá: RUC por nombre desde el buscador de
 * proveedores de PanamaCompraEnCifras. Resultados con la forma real (05-10).
 * Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildPaPanamaCompraRucRows,
  normalizePanamaCompanyCore,
  normalizePanamaJuridicalRuc,
  parsePanamaCompraSupplier,
} from '../pa-panamacompra-ruc-rows';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';

const result = (id: string, legalName: string, lastProcess = '2026-09-01T00:00:00.000Z') => ({
  supplier: { id, name: legalName },
  party: { identifier: { legalName, scheme: 'PA-RUC', id }, roles: ['tenderer'], name: legalName, id },
  total_processes: 3,
  last_process: lastProcess,
});

describe('RUC de persona jurídica', () => {
  it('tomo-folio-asiento con primer tramo de 3+ dígitos; el DV va aparte', () => {
    assert.deepEqual(normalizePanamaJuridicalRuc('998592-1-535732'), { ruc: '998592-1-535732', dv: null });
    assert.deepEqual(normalizePanamaJuridicalRuc('280-319-61818 D.V.53'), { ruc: '280-319-61818', dv: '53' });
    assert.deepEqual(normalizePanamaJuridicalRuc('984825-1-532934 DV 86'), { ruc: '984825-1-532934', dv: '86' });
    assert.deepEqual(normalizePanamaJuridicalRuc('983932-1-532761-43'), { ruc: '983932-1-532761', dv: '43' });
  });

  it('fuera: cédulas de personas naturales y formas rotas', () => {
    for (const id of ['8-123-456', 'E-8-96362', 'N-738-2017', 'PE-9-1606', '8NT2763992', '9--95-113', '263837-1-404979-1-404979']) {
      assert.equal(normalizePanamaJuridicalRuc(id), null, id);
    }
  });
});

describe('núcleo del nombre panameño', () => {
  it('quita S.A. mal escrita, S. de R.L. y formas en inglés', () => {
    assert.equal(normalizePanamaCompanyCore('Cable Onda, S..A.'), 'CABLE ONDA');
    assert.equal(normalizePanamaCompanyCore('PINTURAS GARANTIZADAS. S,A'), 'PINTURAS GARANTIZADAS');
    assert.equal(normalizePanamaCompanyCore('GRUPO X, S. DE R.L.'), 'GRUPO X');
    assert.equal(normalizePanamaCompanyCore('Liberty Services Corporation'), 'LIBERTY SERVICES');
    assert.equal(normalizePanamaCompanyCore('ACME INC'), 'ACME');
  });
});

describe('buscador → una fila por RUC', () => {
  it('lee el identificador PA-RUC del resultado', () => {
    assert.deepEqual(parsePanamaCompraSupplier(result('998592-1-535732', 'CRUZ DEL SUR DUWEST, S.A.')), {
      id: '998592-1-535732',
      scheme: 'PA-RUC',
      legalName: 'CRUZ DEL SUR DUWEST, S.A.',
      lastProcess: '2026-09-01T00:00:00.000Z',
    });
    assert.equal(parsePanamaCompraSupplier({}), null);
  });

  it('gana la participación más reciente; personas naturales nunca entran; el DV se conserva', () => {
    const rows = buildPaPanamaCompraRucRows(
      [
        result('984825-1-532934 DV 86', 'RGH PANAMA S.A.', '2025-01-01T00:00:00.000Z'),
        result('984825-1-532934', 'RGH Panama, S.A.', '2026-09-29T00:00:00.000Z'),
        result('E-8-96362', 'luz Stella Soto'),
        result('8-123-456', 'JUAN PEREZ'),
      ].map((r) => parsePanamaCompraSupplier(r)!),
      { sourceYear: 2026, importedAt: '2026-10-05T00:00:00.000Z' },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].normalized_tax_id, '984825-1-532934');
    assert.equal(rows[0].legal_name, 'RGH Panama, S.A.');
    assert.equal(rows[0].normalized_legal_name, 'RGH PANAMA');
    assert.deepEqual(rows[0].raw_data, { dv: '86', last_process: '2026-09-29' });
    assert.equal(rows[0].record_identity_key, 'tax:984825-1-532934');
    assert.equal(JSON.stringify(rows).includes('Stella'), false);
  });

  it('otro esquema que no sea PA-RUC no entra', () => {
    const supplier = parsePanamaCompraSupplier(result('998592-1-535732', 'X S.A.'))!;
    assert.deepEqual(buildPaPanamaCompraRucRows([{ ...supplier, scheme: 'CO-NIT' }], { sourceYear: 2026, importedAt: 'x' }), []);
  });

  it('grano fiscal: un RUC, una fila', () => {
    assert.equal(getSourceFamily('pa_panamacompra_ruc_registry'), 'TAX_GRAIN');
  });
});

describe('RUC por nombre dentro de la corrida', () => {
  const rows = buildPaPanamaCompraRucRows(
    [parsePanamaCompraSupplier(result('30394-2-238626', 'Cable Onda, S..A.'))!],
    { sourceYear: 2026, importedAt: 'x' },
  );
  const resolver = createSnapshotNameOfficialSourceResolver({
    countryCode: 'PA',
    sourceKey: 'pa_panamacompra_ruc_registry',
    taxIdentifierType: 'RUC',
    validTaxId: /^\d{3,}-\d{1,4}-\d{1,7}$/,
    normalizeCore: normalizePanamaCompanyCore,
    querySnapshots: async (core) =>
      rows
        .filter((row) => row.normalized_legal_name === core)
        .map((row) => ({ taxId: row.normalized_tax_id, legalName: row.legal_name, normalizedLegalName: row.normalized_legal_name })),
    singleWordIsSignalOnly: true,
  });
  const candidate = (canonicalName: string) =>
    ({ sourceProvider: 'apollo', canonicalName, countryCode: 'PA', requestedCountryCode: 'PA', domain: null, websiteUrl: null, warnings: [], issues: [], providerMetadataSafe: {}, trace: {} }) as unknown as NormalizedProspectCandidate;

  it('«Cable Onda S.A.» → RUC fuerte, tipo RUC', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(candidate('Cable Onda S.A.'), { country: 'Panamá', countryCode: 'PA' }, [resolver], DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY);
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, '30394-2-238626');
    assert.equal(enriched.taxIdentifierType, 'RUC');
  });

  it('cableado: Panamá en la fábrica, con la regla de una palabra', () => {
    const wiring = readFileSync(join(process.cwd(), 'src/server/prospect-batches/official-source-resolvers.ts'), 'utf8');
    assert.match(
      wiring,
      /countryCode: 'PA',\s*sourceKey: PA_PANAMACOMPRA_RUC_SOURCE_KEY,\s*taxIdentifierType: 'RUC',[\s\S]{0,200}normalizeCore: normalizePanamaCompanyCore,[\s\S]{0,200}singleWordIsSignalOnly: true,/,
    );
  });
});

describe('catálogo', () => {
  it('conectada en código, carga pendiente, fuera de las recomendaciones', () => {
    const s = CATALOG_SOURCES.find((source) => source.key === 'pa_panamacompra_ruc_registry');
    assert.ok(s);
    assert.deepEqual(s.countryCodes, ['PA']);
    assert.equal(s.aiFlowStatus, 'connected_identity_in_run');
    assert.equal(s.operationalStatus, 'pending_validation');
    for (const depth of ['basic', 'standard', 'deep'] as const) {
      const ctx = getCatalogContext({ country: 'Panamá', countryCode: 'PA', industry: 'technology', searchDepth: depth });
      assert.equal(ctx.recommendedSources.some((r) => r.key === 'pa_panamacompra_ruc_registry'), false, depth);
    }
  });
});
