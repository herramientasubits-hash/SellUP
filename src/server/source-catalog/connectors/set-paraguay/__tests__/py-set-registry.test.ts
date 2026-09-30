/**
 * SOURCES-PY-RUC-BY-NAME-1 — Paraguay: RUC por nombre sobre el padrón de la SET.
 *
 * Líneas reales del padrón público de RUC (septiembre de 2026). Sin E/S, sin DB,
 * sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPySetRegistryRow,
  normalizeParaguayCompanyCore,
  parsePySetLine,
  PY_SET_REGISTRY_SOURCE_KEY,
} from '../py-set-registry-row';
import {
  calculateParaguayRucCheckDigit,
  getTaxIdentifierRule,
  validateTaxIdentifier,
} from '@/modules/prospect-batches/tax-identifier-rules';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';

const params = { sourceYear: 2026, importedAt: '2026-09-30T00:00:00.000Z' };

describe('regla del RUC paraguayo', () => {
  it('está registrada para PY, con dígito verificador', () => {
    const rule = getTaxIdentifierRule('py');
    assert.equal(rule?.label, 'RUC');
    assert.equal(rule?.validationLevel, 'checksum');
  });

  it('calcula el dígito verificador de la SET (incluidos los restos 0 y 1 → 0)', () => {
    assert.equal(calculateParaguayRucCheckDigit('80002201'), 7);
    assert.equal(calculateParaguayRucCheckDigit('80003457'), 0);
    assert.equal(calculateParaguayRucCheckDigit('80023325'), 5);
    assert.equal(calculateParaguayRucCheckDigit('1000018'), 6);
    assert.equal(calculateParaguayRucCheckDigit('80000038'), 2);
    assert.equal(calculateParaguayRucCheckDigit('8000A'), null);
  });

  it('acepta RUC reales con o sin guion y los deja como «cuerpo-DV»', () => {
    for (const ruc of ['80002201-7', '800022017', '80.002.201-7', '80003457-0']) {
      assert.equal(validateTaxIdentifier(ruc, 'PY').valid, true, ruc);
    }
    assert.equal(validateTaxIdentifier('800022017', 'PY').normalized, '80002201-7');
  });

  it('rechaza un dígito verificador equivocado y las letras', () => {
    assert.equal(validateTaxIdentifier('80002201-8', 'PY').valid, false);
    assert.equal(validateTaxIdentifier('8000220A-7', 'PY').valid, false);
  });
});

describe('fila del padrón', () => {
  it('una sociedad activa → fila mínima con el RUC «cuerpo-DV»', () => {
    const row = buildPySetRegistryRow('80002201|BANCO ITAU PARAGUAY S.A|7|INTA7678808|ACTIVO|', params);
    assert.ok(row);
    assert.equal(row.source_key, PY_SET_REGISTRY_SOURCE_KEY);
    assert.equal(row.country_code, 'PY');
    assert.equal(row.tax_id, '80002201-7');
    assert.equal(row.normalized_tax_id, '80002201-7');
    assert.equal(row.legal_name, 'BANCO ITAU PARAGUAY S.A');
    assert.equal(row.normalized_legal_name, 'BANCO ITAU PARAGUAY');
    assert.equal(row.record_identity_key, 'tax:80002201-7');
  });

  it('una «|» sobrante dentro de la razón social no descoloca los campos', () => {
    const row = buildPySetRegistryRow('80099501|ROAL GROUP SOCIEDAD ANONIMA||5|RGRA177150M|ACTIVO|', params);
    assert.equal(row?.tax_id, '80099501-5');
    assert.equal(row?.legal_name, 'ROAL GROUP SOCIEDAD ANONIMA');
    assert.equal(row?.normalized_legal_name, 'ROAL GROUP');
    assert.deepEqual(parsePySetLine('80099501|ROAL GROUP SOCIEDAD ANONIMA||5|RGRA177150M|ACTIVO|'), {
      ruc: '80099501',
      legalName: 'ROAL GROUP SOCIEDAD ANONIMA',
      dv: '5',
      status: 'ACTIVO',
    });
  });

  it('fuera: suspendidas, personas físicas, DV que no cuadra y líneas rotas', () => {
    assert.equal(buildPySetRegistryRow('80000011|CALZADOS LA GOLONDRINA S.R.L|0|CGOB7786405|SUSPENSION TEMPORAL|', params), null);
    assert.equal(buildPySetRegistryRow('1000028|CABRERA AMARILLA, MANUEL|3|CAAM631400D|ACTIVO|', params), null);
    assert.equal(buildPySetRegistryRow('80002201|BANCO ITAU PARAGUAY S.A|8|INTA7678808|ACTIVO|', params), null);
    assert.equal(buildPySetRegistryRow('80002201|BANCO ITAU PARAGUAY S.A|7', params), null);
    assert.equal(buildPySetRegistryRow('80002201||7|X|ACTIVO|', params), null);
  });

  it('núcleo paraguayo: quita la forma final (S.A., S.R.L., S.A.E.C.A., SOCIEDAD ANONIMA)', () => {
    assert.equal(normalizeParaguayCompanyCore('CERVECERIA PARAGUAYA SA'), 'CERVECERIA PARAGUAYA');
    assert.equal(normalizeParaguayCompanyCore('Frigorífico Concepción S.A.'), 'FRIGORIFICO CONCEPCION');
    assert.equal(normalizeParaguayCompanyCore('BANCO CONTINENTAL S.A.E.C.A.'), 'BANCO CONTINENTAL');
    assert.equal(normalizeParaguayCompanyCore('COMERCIAL SAN ANDRES SRL'), 'COMERCIAL SAN ANDRES');
  });

  it('la fuente es de grano fiscal (un RUC, una fila)', () => {
    assert.equal(getSourceFamily('py_set_registry'), 'TAX_GRAIN');
  });
});

describe('RUC por nombre dentro de la corrida', () => {
  const rows = [
    buildPySetRegistryRow('80003457|CERVECERIA PARAGUAYA SA|0|CPAA1074009|ACTIVO|', params),
    buildPySetRegistryRow('80023325|FRIGORIFICO CONCEPCION S.A.|5|FCOA017150G|ACTIVO|', params),
  ].filter((row) => row !== null);

  const resolver = createSnapshotNameOfficialSourceResolver({
    countryCode: 'PY',
    sourceKey: 'py_set_registry',
    taxIdentifierType: 'RUC',
    validTaxId: /^80\d{6}-\d$/,
    normalizeCore: normalizeParaguayCompanyCore,
    querySnapshots: async (core) =>
      rows
        .filter((row) => row.normalized_legal_name === core)
        .map((row) => ({ taxId: row.normalized_tax_id, legalName: row.legal_name, normalizedLegalName: row.normalized_legal_name })),
  });

  const candidate = (canonicalName: string): NormalizedProspectCandidate =>
    ({
      sourceProvider: 'apollo',
      providerRecordId: 'rec-py-1',
      providerRequestId: 'req-py-1',
      canonicalName,
      normalizedName: canonicalName.toLowerCase(),
      commercialName: canonicalName,
      legalName: null,
      websiteUrl: null,
      domain: null,
      corporateLinkedinUrl: null,
      country: 'Paraguay',
      countryCode: 'PY',
      requestedCountryCode: 'PY',
      region: null,
      city: 'Asunción',
      industry: 'Food',
      subindustry: null,
      industryCodes: {},
      employeeCount: 500,
      employeeRange: null,
      sourceUrl: null,
      sourceConfidence: null,
      searchCriteria: {},
      warnings: [],
      issues: [],
      providerMetadataSafe: {},
      trace: { sourceProvider: 'apollo', providerRecordId: 'rec-py-1', providerRequestId: 'req-py-1', sourceUrl: null },
    }) as NormalizedProspectCandidate;

  it('nombre con otra forma societaria → mismo núcleo → RUC fuerte en las columnas tipadas', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate('Cervecería Paraguaya S.A.'),
      { country: 'Paraguay', countryCode: 'PY' },
      [resolver],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, '80003457-0');
    assert.equal(enriched.taxIdentifierType, 'RUC');
    assert.equal(validateTaxIdentifier(enriched.taxIdentifier ?? '', 'PY').valid, true);
  });

  it('una empresa que no está en el padrón → sin RUC', async () => {
    const out = await resolver.resolve({
      candidate: candidate('Empresa Inexistente del Chaco'),
      criteria: { countryCode: 'PY' },
      policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    });
    assert.equal(out.status, 'not_found');
  });
});
