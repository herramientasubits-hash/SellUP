/**
 * SOURCES-CR-CEDULA-BY-NAME-1 — Costa Rica: cédula jurídica por nombre sobre PYMES
 * activas del MEIC + proveedores SICOP con nombre. Filas con la forma real de los
 * archivos de datos.go.cr. Sin E/S de red, sin DB, sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCrCompanyRegistryRows,
  normalizeCostaRicaCompanyCedula,
  normalizeCostaRicaCompanyCore,
} from '../cr-company-registry-rows';
import { getTaxIdentifierRule, validateTaxIdentifier } from '@/modules/prospect-batches/tax-identifier-rules';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';

const params = { sourceYear: 2026, importedAt: '2026-10-02T00:00:00.000Z' };

const pyme = (id: string, name: string) => ({
  'ID CONSECUTIVO': 1,
  NOMBRE: name,
  IDENTIFICACION: id,
  TAMAÑO: 'Micro',
  PROVINCIA: 'SAN JOSE',
  'ACTIVIDAD CIIU': '2220',
});

describe('cédula jurídica', () => {
  it('regla CR registrada, sólo de forma (sin dígito verificador documentado)', () => {
    const rule = getTaxIdentifierRule('cr');
    assert.equal(rule?.label, 'Cédula jurídica');
    assert.equal(rule?.validationLevel, 'format_only');
    assert.equal(validateTaxIdentifier('3-101-052623', 'CR').valid, true);
    assert.equal(validateTaxIdentifier('3-101-052623', 'CR').normalized, '3101052623');
    assert.equal(validateTaxIdentifier('310105262', 'CR').valid, false);
  });

  it('sociedades (3…) y entes públicos (2…, 4…); cédula física y DIMEX quedan fuera (SOURCES-CR-CLOSE-1)', () => {
    assert.equal(normalizeCostaRicaCompanyCedula('3-101-052623'), '3101052623');
    assert.equal(normalizeCostaRicaCompanyCedula(3102124446), '3102124446');
    assert.equal(normalizeCostaRicaCompanyCedula('0105230456'), null);
    assert.equal(normalizeCostaRicaCompanyCedula('184001234567'), null);
    assert.equal(normalizeCostaRicaCompanyCedula('4000042147'), '4000042147');
    assert.equal(normalizeCostaRicaCompanyCedula('2-100-042005'), '2100042005');
    // Zona Franca escribe a veces un sufijo de planta.
    assert.equal(normalizeCostaRicaCompanyCedula('3-101-028685-24'), '3101028685');
    assert.equal(normalizeCostaRicaCompanyCedula(null), null);
  });
});

describe('combinación de los tres archivos', () => {
  const rows = buildCrCompanyRegistryRows(
    {
      pymes: [
        pyme('3101052623', 'PLASTICOS ZEBRA SOCIEDAD ANONIMA'),
        pyme('3102124446', 'NUÑEZ & ASOCIADOS LTDA'),
        pyme('0105230456', 'PEREZ MORA JUAN'),
        pyme('', ''),
      ],
      recursos: [
        { CEDULA_PROVEEDOR: '3102124446', PROVEEDOR: 'NUÑEZ Y ASOCIADOS LIMITADA' },
        { CEDULA_PROVEEDOR: '3101151360', PROVEEDOR: 'INICIATIVAS DE DESARROLLO EMPRESARIAL, S. A.' },
      ],
      aclaraciones: [
        { CEDULA_PROVEEDOR: '3101588623', EMPRESA_PROVEEDORA: 'CENTRO DE PSICOLOGÍA Y DESARROLLO HUMANO S.A.', SOLICITANTE: 'MARIA PEREZ' },
        { CEDULA_PROVEEDOR: '3101151360', EMPRESA_PROVEEDORA: 'OTRO NOMBRE S.A.', SOLICITANTE: 'X' },
      ],
    },
    params,
  );

  it('una fila por cédula; el nombre del MEIC gana, después recursos y después aclaraciones', () => {
    assert.deepEqual(
      rows.map((row) => [row.tax_id, row.legal_name, row.raw_data.origin]),
      [
        ['3101052623', 'PLASTICOS ZEBRA SOCIEDAD ANONIMA', 'meic_pymes'],
        ['3101151360', 'INICIATIVAS DE DESARROLLO EMPRESARIAL, S. A.', 'sicop_recursos'],
        ['3101588623', 'CENTRO DE PSICOLOGÍA Y DESARROLLO HUMANO S.A.', 'sicop_aclaraciones'],
        ['3102124446', 'NUÑEZ & ASOCIADOS LTDA', 'meic_pymes'],
      ],
    );
  });

  it('las filas del MEIC conservan tamaño, provincia y CIIU; nunca se guarda el solicitante', () => {
    const zebra = rows.find((row) => row.tax_id === '3101052623');
    assert.deepEqual(zebra?.raw_data, {
      origin: 'meic_pymes',
      origins: ['meic_pymes'],
      cr_meic_size: 'MICRO',
      cr_meic_size_year: 2025,
      province: 'SAN JOSE',
      ciiu: '2220',
    });
    assert.equal(JSON.stringify(rows).includes('MARIA PEREZ'), false);
    assert.equal(zebra?.record_identity_key, 'tax:3101052623');
    assert.equal(zebra?.normalized_legal_name, 'PLASTICOS ZEBRA');
  });

  it('núcleo costarricense', () => {
    assert.equal(normalizeCostaRicaCompanyCore('Iniciativas de Desarrollo Empresarial, S. A.'), 'INICIATIVAS DE DESARROLLO EMPRESARIAL');
    assert.equal(normalizeCostaRicaCompanyCore('NUÑEZ & ASOCIADOS LTDA'), 'NUNEZ & ASOCIADOS');
    assert.equal(normalizeCostaRicaCompanyCore('Tecno Sur Sociedad de Responsabilidad Limitada'), 'TECNO SUR');
    assert.equal(normalizeCostaRicaCompanyCore('Alfa S.R.L.'), 'ALFA');
  });

  it('un nombre sin núcleo utilizable no entra', () => {
    assert.deepEqual(buildCrCompanyRegistryRows({ pymes: [pyme('3101000001', 'S.A.')] }, params).length, 1);
    assert.deepEqual(buildCrCompanyRegistryRows({ pymes: [pyme('3101000001', 'X')] }, params), []);
  });

  it('la fuente es de grano fiscal (una cédula, una fila)', () => {
    assert.equal(getSourceFamily('cr_company_registry'), 'TAX_GRAIN');
  });
});

describe('cédula por nombre dentro de la corrida', () => {
  const rows = buildCrCompanyRegistryRows({ pymes: [pyme('3101052623', 'PLASTICOS ZEBRA SOCIEDAD ANONIMA')] }, params);
  const resolver = createSnapshotNameOfficialSourceResolver({
    countryCode: 'CR',
    sourceKey: 'cr_company_registry',
    taxIdentifierType: 'cedula_juridica',
    validTaxId: /^[234]\d{9}$/,
    normalizeCore: normalizeCostaRicaCompanyCore,
    querySnapshots: async (core) =>
      rows
        .filter((row) => row.normalized_legal_name === core)
        .map((row) => ({ taxId: row.normalized_tax_id, legalName: row.legal_name, normalizedLegalName: row.normalized_legal_name })),
  });

  const candidate = (canonicalName: string): NormalizedProspectCandidate =>
    ({
      sourceProvider: 'apollo',
      providerRecordId: 'rec-cr-1',
      providerRequestId: 'req-cr-1',
      canonicalName,
      normalizedName: canonicalName.toLowerCase(),
      commercialName: canonicalName,
      legalName: null,
      websiteUrl: null,
      domain: null,
      corporateLinkedinUrl: null,
      country: 'Costa Rica',
      countryCode: 'CR',
      requestedCountryCode: 'CR',
      region: null,
      city: 'San José',
      industry: 'Manufacturing',
      subindustry: null,
      industryCodes: {},
      employeeCount: 60,
      employeeRange: null,
      sourceUrl: null,
      sourceConfidence: null,
      searchCriteria: {},
      warnings: [],
      issues: [],
      providerMetadataSafe: {},
      trace: { sourceProvider: 'apollo', providerRecordId: 'rec-cr-1', providerRequestId: 'req-cr-1', sourceUrl: null },
    }) as NormalizedProspectCandidate;

  it('nombre con otra forma → mismo núcleo → cédula fuerte con tipo cedula_juridica', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate('Plásticos Zebra S.A.'),
      { country: 'Costa Rica', countryCode: 'CR' },
      [resolver],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, '3101052623');
    assert.equal(enriched.taxIdentifierType, 'cedula_juridica');
  });

  it('una empresa que no está → sin cédula', async () => {
    const out = await resolver.resolve({
      candidate: candidate('Empresa Inexistente del Pacífico'),
      criteria: { countryCode: 'CR' },
      policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    });
    assert.equal(out.status, 'not_found');
  });
});
