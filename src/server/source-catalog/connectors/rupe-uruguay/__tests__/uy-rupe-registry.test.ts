/**
 * SOURCES-UY-RUT-BY-NAME-1 — Uruguay: RUT por nombre sobre el RUPE.
 *
 * Registros reales del RUPE de agosto de 2026 (datos abiertos de ARCE). Sin E/S
 * de red, sin DB, sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildUyRupeRegistryRow,
  carriesUruguayLegalForm,
  normalizeUruguayCompanyCore,
  UY_RUPE_REGISTRY_SOURCE_KEY,
} from '../uy-rupe-registry-row';
import { readCsvFile } from '../../rns-argentina/streaming-csv';
import {
  calculateUruguayRutCheckDigit,
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

const record = (identificacion: string, denominacion: string, overrides: Record<string, string> = {}) => ({
  pais_prov: 'URUGUAY',
  identificacion_prov: identificacion,
  denominacion_social_prov: denominacion,
  domicilio_fiscal: 'RAFFO MOLINOS DE 884',
  localidad_prov: 'Montevideo',
  departamento_prov: 'Montevideo',
  estado_prov: 'ACTIVO',
  ...overrides,
});

describe('regla del RUT uruguayo', () => {
  it('está registrada para UY, con dígito verificador', () => {
    const rule = getTaxIdentifierRule('uy');
    assert.equal(rule?.label, 'RUT');
    assert.equal(rule?.validationLevel, 'checksum');
  });

  it('calcula el dígito verificador de la DGI (11 → 0; 10 → inválido)', () => {
    assert.equal(calculateUruguayRutCheckDigit('21526101001'), 9);
    assert.equal(calculateUruguayRutCheckDigit('21656948001'), 8);
    assert.equal(calculateUruguayRutCheckDigit('04037865001'), 6);
    assert.equal(calculateUruguayRutCheckDigit('21287395001'), 8);
    assert.equal(calculateUruguayRutCheckDigit('2152610100'), null);
    // Cuerpo sintético cuya suma da resto 1 → 11 − 1 = 10 → no existe RUT válido.
    assert.equal(calculateUruguayRutCheckDigit('30000000000'), null);
    // Cuerpo sintético cuya suma da resto 0 → 11 → dígito 0.
    assert.equal(calculateUruguayRutCheckDigit('00000000000'), 0);
  });

  it('acepta RUT reales, con o sin separadores', () => {
    for (const rut of ['215261010019', '216569480018', '21-526101-001-9', '215 261 010 019']) {
      assert.equal(validateTaxIdentifier(rut, 'UY').valid, true, rut);
    }
    assert.equal(validateTaxIdentifier('21-526101-001-9', 'UY').normalized, '215261010019');
  });

  it('rechaza un dígito verificador equivocado y un largo distinto de 12', () => {
    assert.equal(validateTaxIdentifier('215261010018', 'UY').valid, false);
    assert.equal(validateTaxIdentifier('21526101001', 'UY').valid, false);
  });
});

describe('fila del RUPE', () => {
  it('una empresa activa → fila mínima (RUT, razón social, núcleo, departamento; sin domicilio)', () => {
    const row = buildUyRupeRegistryRow(record('216569480018', 'HORMETAL URUGUAY S.A.', { departamento_prov: 'Canelones' }), params);
    assert.ok(row);
    assert.equal(row.source_key, UY_RUPE_REGISTRY_SOURCE_KEY);
    assert.equal(row.country_code, 'UY');
    assert.equal(row.tax_id, '216569480018');
    assert.equal(row.legal_name, 'HORMETAL URUGUAY S.A.');
    assert.equal(row.normalized_legal_name, 'HORMETAL URUGUAY');
    assert.deepEqual(row.raw_data, { department: 'Canelones' });
    assert.equal(row.record_identity_key, 'tax:216569480018');
  });

  it('«Sin dato» en el departamento → null', () => {
    const row = buildUyRupeRegistryRow(record('215261010019', 'GRAM SOCIEDAD ANONIMA', { departamento_prov: 'Sin dato' }), params);
    assert.deepEqual(row?.raw_data, { department: null });
    assert.equal(row?.normalized_legal_name, 'GRAM');
  });

  it('fuera: personas físicas, bajas, en ingreso, otros países y RUT con DV equivocado', () => {
    assert.equal(buildUyRupeRegistryRow(record('070287320015', 'CARLOS PERAZZA DANIS RODRIGO'), params), null);
    assert.equal(buildUyRupeRegistryRow(record('213146130019', 'LUKELAND S.A.', { estado_prov: 'BAJA DGI' }), params), null);
    assert.equal(buildUyRupeRegistryRow(record('216569480018', 'HORMETAL URUGUAY S.A.', { estado_prov: 'EN INGRESO' }), params), null);
    assert.equal(buildUyRupeRegistryRow(record('B98309511', 'VERATECH FOR HEALTH S.L.', { pais_prov: 'ESPAÑA' }), params), null);
    assert.equal(buildUyRupeRegistryRow(record('216569480017', 'HORMETAL URUGUAY S.A.'), params), null);
  });

  it('sólo son empresas las razones sociales que terminan en forma societaria', () => {
    assert.equal(carriesUruguayLegalForm('MECANICA DE LEON LTDA'), true);
    assert.equal(carriesUruguayLegalForm('MEZZACAPPA Y ROMERO S.R.L.'), true);
    assert.equal(carriesUruguayLegalForm('CIELOMAN S.A.'), true);
    assert.equal(carriesUruguayLegalForm('PACHECO TROISI MARIANGEL'), false);
    assert.equal(carriesUruguayLegalForm('S.A.'), false);
    assert.equal(carriesUruguayLegalForm(''), false);
  });

  it('núcleo uruguayo', () => {
    assert.equal(normalizeUruguayCompanyCore('Hormetal Uruguay Sociedad Anónima'), 'HORMETAL URUGUAY');
    assert.equal(normalizeUruguayCompanyCore('MEZZACAPPA Y ROMERO S.R.L.'), 'MEZZACAPPA Y ROMERO');
    assert.equal(normalizeUruguayCompanyCore('Tech Uy SAS'), 'TECH UY');
  });

  it('la fuente es de grano fiscal (un RUT, una fila)', () => {
    assert.equal(getSourceFamily('uy_rupe_registry'), 'TAX_GRAIN');
  });

  it('el CSV del RUPE (separado por «;», con saltos de línea entre comillas) se lee bien', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uy-rupe-'));
    const file = join(dir, 'rupe.csv');
    writeFileSync(
      file,
      'pais_prov;identificacion_prov;denominacion_social_prov;domicilio_fiscal;localidad_prov;departamento_prov;estado_prov\n' +
        'URUGUAY;090257550017;DISTRIBUIDORA SAN FRANCISCO S R L;"17 METROS S/N, Esquina Carlos Falco de Medina.\nPadrón n° 15365";MINAS  LAVALLEJA;Lavalleja;ACTIVO\n' +
        'URUGUAY;216569480018;HORMETAL URUGUAY S.A.;"Ruta 8; km 20";Pando;Canelones;ACTIVO\n',
    );
    const rows = [];
    for await (const rec of readCsvFile(file, { delimiter: ';' })) rows.push(buildUyRupeRegistryRow(rec, params));
    assert.deepEqual(
      rows.map((row) => [row?.tax_id, row?.normalized_legal_name, row?.raw_data.department]),
      [
        ['090257550017', 'DISTRIBUIDORA SAN FRANCISCO', 'Lavalleja'],
        ['216569480018', 'HORMETAL URUGUAY', 'Canelones'],
      ],
    );
  });
});

describe('RUT por nombre dentro de la corrida', () => {
  const rows = [
    buildUyRupeRegistryRow(record('216569480018', 'HORMETAL URUGUAY S.A.'), params),
    buildUyRupeRegistryRow(record('217297740013', 'CIELOMAN S.A.'), params),
  ].filter((row) => row !== null);

  const resolver = createSnapshotNameOfficialSourceResolver({
    countryCode: 'UY',
    sourceKey: 'uy_rupe_registry',
    taxIdentifierType: 'RUT',
    validTaxId: /^\d{12}$/,
    normalizeCore: normalizeUruguayCompanyCore,
    querySnapshots: async (core) =>
      rows
        .filter((row) => row.normalized_legal_name === core)
        .map((row) => ({ taxId: row.normalized_tax_id, legalName: row.legal_name, normalizedLegalName: row.normalized_legal_name })),
  });

  const candidate = (canonicalName: string): NormalizedProspectCandidate =>
    ({
      sourceProvider: 'apollo',
      providerRecordId: 'rec-uy-1',
      providerRequestId: 'req-uy-1',
      canonicalName,
      normalizedName: canonicalName.toLowerCase(),
      commercialName: canonicalName,
      legalName: null,
      websiteUrl: null,
      domain: null,
      corporateLinkedinUrl: null,
      country: 'Uruguay',
      countryCode: 'UY',
      requestedCountryCode: 'UY',
      region: null,
      city: 'Montevideo',
      industry: 'Manufacturing',
      subindustry: null,
      industryCodes: {},
      employeeCount: 120,
      employeeRange: null,
      sourceUrl: null,
      sourceConfidence: null,
      searchCriteria: {},
      warnings: [],
      issues: [],
      providerMetadataSafe: {},
      trace: { sourceProvider: 'apollo', providerRecordId: 'rec-uy-1', providerRequestId: 'req-uy-1', sourceUrl: null },
    }) as NormalizedProspectCandidate;

  it('nombre con otra forma societaria → mismo núcleo → RUT fuerte en las columnas tipadas', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate('Hormetal Uruguay Sociedad Anónima'),
      { country: 'Uruguay', countryCode: 'UY' },
      [resolver],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, '216569480018');
    assert.equal(enriched.taxIdentifierType, 'RUT');
    assert.equal(validateTaxIdentifier(enriched.taxIdentifier ?? '', 'UY').valid, true);
  });

  it('una empresa que no está en el RUPE → sin RUT', async () => {
    const out = await resolver.resolve({
      candidate: candidate('Empresa Inexistente del Este'),
      criteria: { countryCode: 'UY' },
      policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    });
    assert.equal(out.status, 'not_found');
  });
});
