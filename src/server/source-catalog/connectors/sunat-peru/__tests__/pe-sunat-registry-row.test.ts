/**
 * SOURCES-PE-RUC-BY-NAME-1 — fila del registro SUNAT y RUC por nombre en Perú.
 * Líneas con el formato real del padrón reducido; RUC y nombres sintéticos o de
 * dominio público. Sin E/S.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPeSunatRegistryRow,
  normalizePeruCompanyCore,
} from '../pe-sunat-registry-row';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import {
  buildOfficialSourceTypedColumns,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';

const P = { sourceYear: 2026, importedAt: '2026-09-30T00:00:00.000Z' };
const line = (ruc: string, name: string, status = 'ACTIVO', domicile = 'HABIDO', ubigeo = '150101') =>
  `${ruc}|${name}|${status}|${domicile}|${ubigeo}|AV.|LARCO|-|-|123|-|-|-|-|-|`;

describe('normalizePeruCompanyCore', () => {
  it('quita las formas societarias peruanas', () => {
    assert.equal(normalizePeruCompanyCore('ALICORP S.A.A.'), 'ALICORP');
    assert.equal(normalizePeruCompanyCore('EMPRESA X S.A.C.'), 'EMPRESA X');
    assert.equal(normalizePeruCompanyCore('INVERSIONES Y E.I.R.L.'), 'INVERSIONES Y');
    assert.equal(normalizePeruCompanyCore('TRANSPORTES Z SOCIEDAD ANONIMA CERRADA'), 'TRANSPORTES Z');
    assert.equal(normalizePeruCompanyCore('CONSULTORES W S.R.L.'), 'CONSULTORES W');
    assert.equal(normalizePeruCompanyCore('AGRÍCOLA ÑUÑOA SAC'), 'AGRICOLA NUNOA');
  });
});

describe('buildPeSunatRegistryRow', () => {
  it('arma la fila mínima de una sociedad activa y habida', () => {
    const row = buildPeSunatRegistryRow(line('20100055237', 'ALICORP S.A.A.'), P)!;
    assert.equal(row.source_key, 'pe_sunat_registry');
    assert.equal(row.country_code, 'PE');
    assert.equal(row.normalized_tax_id, '20100055237');
    assert.equal(row.legal_name, 'ALICORP S.A.A.');
    assert.equal(row.normalized_legal_name, 'ALICORP');
    assert.deepEqual(row.raw_data, { ubigeo: '150101' });
    assert.ok(row.record_identity_key);
  });

  it('descarta personas naturales, bajas, suspendidas, no habidas y la cabecera', () => {
    assert.equal(buildPeSunatRegistryRow(line('10452159428', 'GARCIA CHANCO CARLOS'), P), null);
    assert.equal(buildPeSunatRegistryRow(line('20100055237', 'ALICORP S.A.A.', 'BAJA DE OFICIO'), P), null);
    assert.equal(buildPeSunatRegistryRow(line('20100055237', 'ALICORP S.A.A.', 'SUSPENSION TEMPORAL'), P), null);
    assert.equal(buildPeSunatRegistryRow(line('20100055237', 'ALICORP S.A.A.', 'ACTIVO', 'NO HABIDO'), P), null);
    assert.equal(
      buildPeSunatRegistryRow('RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO|', P),
      null,
    );
    assert.equal(buildPeSunatRegistryRow('20100055237|x', P), null);
  });

  it('un ubigeo vacío queda en null', () => {
    assert.deepEqual(buildPeSunatRegistryRow(line('20100055237', 'ALICORP S.A.A.', 'ACTIVO', 'HABIDO', '-'), P)!.raw_data, {
      ubigeo: null,
    });
  });
});

describe('RUC por nombre (configuración de Perú)', () => {
  const candidate: NormalizedProspectCandidate = {
    sourceProvider: 'apollo',
    providerRecordId: 'rec-pe-1',
    providerRequestId: 'req-pe-1',
    canonicalName: 'Alicorp',
    normalizedName: 'alicorp',
    commercialName: 'Alicorp',
    legalName: null,
    websiteUrl: null,
    domain: null,
    corporateLinkedinUrl: null,
    country: 'Perú',
    countryCode: 'PE',
    requestedCountryCode: 'PE',
    region: null,
    city: 'Lima',
    industry: 'Consumer Goods',
    subindustry: null,
    industryCodes: {},
    employeeCount: 9000,
    employeeRange: null,
    sourceUrl: null,
    sourceConfidence: null,
    searchCriteria: {},
    warnings: [],
    issues: [],
    providerMetadataSafe: {},
    trace: { sourceProvider: 'apollo', providerRecordId: 'rec-pe-1', providerRequestId: 'req-pe-1', sourceUrl: null },
  };

  function resolver(rows: Array<{ taxId: string; legalName: string }>) {
    return createSnapshotNameOfficialSourceResolver({
      countryCode: 'PE',
      sourceKey: 'pe_sunat_registry',
      taxIdentifierType: 'RUC',
      validTaxId: /^20\d{9}$/,
      normalizeCore: normalizePeruCompanyCore,
      querySnapshots: async (core) =>
        rows
          .map((r) => ({ ...r, normalizedLegalName: normalizePeruCompanyCore(r.legalName) }))
          .filter((r) => r.normalizedLegalName === core),
    });
  }

  it('una sola sociedad con ese nombre → RUC fuerte', async () => {
    const identity = await enrichNormalizedProspectWithOfficialSources(candidate, { countryCode: 'PE' }, [
      resolver([{ taxId: '20100055237', legalName: 'ALICORP S.A.A.' }]),
    ]);
    const columns = buildOfficialSourceTypedColumns(identity);
    assert.equal(columns.tax_identifier, '20100055237');
    assert.equal(columns.tax_identifier_type, 'RUC');
  });

  it('un RUC de persona natural nunca se ofrece', async () => {
    const identity = await enrichNormalizedProspectWithOfficialSources(candidate, { countryCode: 'PE' }, [
      resolver([{ taxId: '10452159428', legalName: 'ALICORP' }]),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
  });
});
