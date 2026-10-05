/**
 * SOURCES-MX-RFC-BY-NAME-1 — México: RFC por nombre desde los contratos de
 * CompraNet. Filas con la forma real de los CSV (05-10). Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildMxCompranetRfcRows,
  indexCompranetHeader,
  MX_COMPRANET_LEGAL_FORMS,
  normalizeMexicoCompanyCore,
  normalizeMexicoMoralRfc,
} from '../mx-compranet-rfc-rows';
import { MEXICO_LEGAL_FORMS } from '@/server/source-catalog/company-name-core';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import { validateTaxIdentifier } from '@/modules/prospect-batches/tax-identifier-rules';
import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';

const importedAt = '2026-10-05T00:00:00.000Z';
const contract = (rfc: string, supplier: string, stratification: string, year = 2025) => ({ rfc, supplier, stratification, year });

describe('RFC de persona moral', () => {
  it('12 caracteres con fecha válida; & y Ñ se aceptan; espacios y guiones se quitan', () => {
    assert.equal(normalizeMexicoMoralRfc('AAA930521IJ4'), 'AAA930521IJ4');
    assert.equal(normalizeMexicoMoralRfc('a&m-060201-3e2'), 'A&M0602013E2');
    assert.equal(normalizeMexicoMoralRfc('ÑAA930521IJ4'), 'ÑAA930521IJ4');
    assert.equal(validateTaxIdentifier('AAA930521IJ4', 'MX').valid, true);
  });

  it('fuera: persona física (13), extranjeros (EXT…), mes o día imposibles', () => {
    assert.equal(normalizeMexicoMoralRfc('PEMJ800101AB1'), null);
    assert.equal(normalizeMexicoMoralRfc('EXT190501US001'), null);
    assert.equal(normalizeMexicoMoralRfc('AAA931321IJ4'), null);
    assert.equal(normalizeMexicoMoralRfc('AAA930500IJ4'), null);
    assert.equal(normalizeMexicoMoralRfc(null), null);
  });
});

describe('núcleo del nombre mexicano', () => {
  it('quita la forma societaria escrita sin puntos, como la escribe CompraNet', () => {
    assert.equal(normalizeMexicoCompanyCore('AQ&MK SA DE CV'), 'AQ&MK');
    assert.equal(normalizeMexicoCompanyCore('GRUPO X S DE RL DE CV'), 'GRUPO X');
    assert.equal(normalizeMexicoCompanyCore('INNOVA SAPI DE CV'), 'INNOVA');
    assert.equal(normalizeMexicoCompanyCore('FINANCIERA X SA DE CV SOFOM ENR'), 'FINANCIERA X');
    assert.equal(normalizeMexicoCompanyCore('CENTRO DE ESTUDIOS AC'), 'CENTRO DE ESTUDIOS');
  });

  it('y la de siempre, con puntos (Apollo / Tavily): mismo núcleo', () => {
    assert.equal(normalizeMexicoCompanyCore('Grupo Bimbo, S.A.B. de C.V.'), 'GRUPO BIMBO');
    assert.equal(normalizeMexicoCompanyCore('GRUPO BIMBO SAB DE CV'), 'GRUPO BIMBO');
  });

  it('DENUE no cambia: MEXICO_LEGAL_FORMS sigue igual y está incluida', () => {
    assert.equal(MEXICO_LEGAL_FORMS.includes('SA DE CV'), false);
    for (const form of MEXICO_LEGAL_FORMS) assert.ok(MX_COMPRANET_LEGAL_FORMS.includes(form), form);
  });
});

describe('contratos → una fila por RFC', () => {
  const header = ['Orden de gobierno', 'rfc', 'Proveedor o contratista', 'Folio en el RUPC', 'Estratificación'];

  it('encuentra las columnas por nombre', () => {
    assert.deepEqual(indexCompranetHeader(header), { rfc: 1, supplier: 2, stratification: 4 });
    assert.equal(indexCompranetHeader(['a', 'b']), null);
  });

  it('gana el contrato más reciente; personas físicas y extranjeros nunca entran', () => {
    const rows = buildMxCompranetRfcRows(
      [
        contract('AAA930521IJ4', 'AGENCIA ADUANERA DE AMERICA EN AEREO SC', 'MEDIANA', 2024),
        contract('AAA930521IJ4', 'AGENCIA ADUANERA DE AMERICA EN AEREO SC', 'GRANDE', 2025),
        contract('PEMJ800101AB1', 'JUAN PEREZ MARTINEZ', 'MICRO'),
        contract('EXT190501US001', 'ACME INC', 'NO ASIGNADO'),
        contract('AAA0003232I9', '', 'MICRO'),
      ],
      { importedAt },
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      source_key: 'mx_compranet_rfc_registry',
      country_code: 'MX',
      source_year: 2025,
      tax_id: 'AAA930521IJ4',
      normalized_tax_id: 'AAA930521IJ4',
      legal_name: 'AGENCIA ADUANERA DE AMERICA EN AEREO SC',
      normalized_legal_name: 'AGENCIA ADUANERA DE AMERICA EN AEREO',
      raw_data: { stratification: 'GRANDE', last_contract_year: 2025 },
      imported_at: importedAt,
      record_identity_key: 'tax:AAA930521IJ4',
    });
    assert.equal(JSON.stringify(rows).includes('JUAN PEREZ'), false);
  });

  it('grano fiscal: un RFC, una fila', () => {
    assert.equal(getSourceFamily('mx_compranet_rfc_registry'), 'TAX_GRAIN');
  });
});

describe('RFC por nombre dentro de la corrida', () => {
  const rows = buildMxCompranetRfcRows(
    [contract('GBI8110012K5', 'GRUPO BIMBO SAB DE CV', 'GRANDE'), contract('SOF950101AB1', 'SOFTTEK SA DE CV', 'GRANDE')],
    { importedAt },
  );
  const resolver = createSnapshotNameOfficialSourceResolver({
    countryCode: 'MX',
    sourceKey: 'mx_compranet_rfc_registry',
    taxIdentifierType: 'RFC',
    validTaxId: /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/,
    normalizeCore: normalizeMexicoCompanyCore,
    querySnapshots: async (core) =>
      rows
        .filter((row) => row.normalized_legal_name === core)
        .map((row) => ({ taxId: row.normalized_tax_id, legalName: row.legal_name, normalizedLegalName: row.normalized_legal_name })),
    singleWordIsSignalOnly: true,
  });
  const candidate = (canonicalName: string) =>
    ({ sourceProvider: 'apollo', canonicalName, countryCode: 'MX', requestedCountryCode: 'MX', domain: null, websiteUrl: null, warnings: [], issues: [], providerMetadataSafe: {}, trace: {} }) as unknown as NormalizedProspectCandidate;

  it('«Grupo Bimbo, S.A.B. de C.V.» → RFC fuerte, tipo RFC', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(candidate('Grupo Bimbo, S.A.B. de C.V.'), { country: 'México', countryCode: 'MX' }, [resolver], DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY);
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, 'GBI8110012K5');
    assert.equal(enriched.taxIdentifierType, 'RFC');
  });

  it('una palabra sin forma («Softtek») → sólo pista, nunca RFC fuerte', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(candidate('Softtek'), { country: 'México', countryCode: 'MX' }, [resolver], DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY);
    assert.equal(enriched.officialSource.status, 'low_confidence_match');
    assert.equal(enriched.taxIdentifier, null);
  });

  it('cableado: México en la fábrica, con la regla de una palabra', () => {
    const wiring = readFileSync(join(process.cwd(), 'src/server/prospect-batches/official-source-resolvers.ts'), 'utf8');
    assert.match(
      wiring,
      /countryCode: 'MX',\s*sourceKey: MX_COMPRANET_RFC_SOURCE_KEY,\s*taxIdentifierType: 'RFC',\s*validTaxId: \/\^\[A-ZÑ&\]\{3\}\\d\{6\}\[A-Z0-9\]\{3\}\$\/,\s*normalizeCore: normalizeMexicoCompanyCore,\s*querySnapshots: buildSnapshotNameQuery\(snapshotClient, MX_COMPRANET_RFC_SOURCE_KEY, 'MX'\),\s*singleWordIsSignalOnly: true,/,
    );
  });
});

describe('catálogo', () => {
  it('conectada en código, carga pendiente, fuera de las recomendaciones', () => {
    const s = CATALOG_SOURCES.find((source) => source.key === 'mx_compranet_rfc_registry');
    assert.ok(s);
    assert.deepEqual(s.countryCodes, ['MX']);
    assert.equal(s.aiFlowStatus, 'connected_identity_in_run');
    assert.equal(s.operationalStatus, 'pending_validation');
    assert.match(s.nextAction ?? '', /espera la autorización/);
    for (const depth of ['basic', 'standard', 'deep'] as const) {
      const ctx = getCatalogContext({ country: 'México', countryCode: 'MX', industry: 'technology', searchDepth: depth });
      assert.equal(ctx.recommendedSources.some((r) => r.key === 'mx_compranet_rfc_registry'), false, depth);
    }
  });
});
