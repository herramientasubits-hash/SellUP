/**
 * SOURCES-CL-RUT-BY-NAME-1 — Chile: RUT por nombre sobre el Registro de Empresas y
 * Sociedades (datos.gob.cl). Registros reales del CSV de 2025. Sin E/S de red, sin
 * DB, sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildClResRegistryRow,
  normalizeChileCompanyCore,
  normalizeChileRut,
} from '../cl-res-registry-row';
import { readCsvFile } from '../../rns-argentina/streaming-csv';
import { validateTaxIdentifier } from '@/modules/prospect-batches/tax-identifier-rules';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';

const params = { sourceYear: 2026, importedAt: '2026-10-01T00:00:00.000Z' };

const record = (rut: string, name: string, type: string, overrides: Record<string, string> = {}) => ({
  ID: '5597762',
  RUT: rut,
  'Razon Social': name,
  Anio: '2025',
  'Comuna Tributaria': 'MACUL',
  'Codigo de sociedad': type,
  'Tipo de actuacion': 'CONSTITUCIÓN',
  ...overrides,
});

describe('RUT chileno', () => {
  it('normaliza y valida el dígito verificador (incluido K)', () => {
    assert.equal(normalizeChileRut('78081182-k'), '78081182-K');
    assert.equal(normalizeChileRut('78.081.198-6'), '78081198-6');
    assert.equal(normalizeChileRut('78081198-5'), null);
    assert.equal(normalizeChileRut('78081198'), null);
    assert.equal(normalizeChileRut(null), null);
  });

  it('el RUT guardado pasa la regla chilena existente', () => {
    assert.equal(validateTaxIdentifier('78081182-K', 'CL').valid, true);
    assert.equal(validateTaxIdentifier('78081205-2', 'CL').valid, true);
  });
});

describe('fila del RES', () => {
  it('una SpA → fila mínima con RUT, núcleo, tipo, comuna y año', () => {
    const row = buildClResRegistryRow(record('78081182-K', 'Directorio Pesticidas.cl SpA', 'SpA'), params);
    assert.ok(row);
    assert.equal(row.source_key, 'cl_res_registry');
    assert.equal(row.country_code, 'CL');
    assert.equal(row.tax_id, '78081182-K');
    assert.equal(row.normalized_legal_name, 'DIRECTORIO PESTICIDAS CL');
    assert.deepEqual(row.raw_data, { company_type: 'SPA', commune: 'MACUL', constituted_year: '2025' });
    assert.equal(row.record_identity_key, 'tax:78081182-K');
  });

  it('una sociedad limitada también entra; su núcleo quita «Limitada»', () => {
    const row = buildClResRegistryRow(record('78081205-2', 'Veritas Asesorías Integrales Limitada', 'SRL'), params);
    assert.equal(row?.normalized_legal_name, 'VERITAS ASESORIAS INTEGRALES');
  });

  it('fuera: EIRL (empresas de una persona), RUT con DV malo y nombres vacíos', () => {
    assert.equal(buildClResRegistryRow(record('78081177-3', 'Clínica Psicológica Pietro Luque Pinto E.I.R.L.', 'EIRL'), params), null);
    assert.equal(buildClResRegistryRow(record('78081182-1', 'Directorio Pesticidas.cl SpA', 'SpA'), params), null);
    assert.equal(buildClResRegistryRow(record('78081182-K', '  ', 'SpA'), params), null);
    assert.equal(buildClResRegistryRow(record('78081182-K', 'SpA', 'SpA'), params)?.normalized_legal_name, 'SPA');
  });

  it('núcleo chileno', () => {
    assert.equal(normalizeChileCompanyCore('Apicola Navarro SpA'), 'APICOLA NAVARRO');
    assert.equal(normalizeChileCompanyCore('Inversiones Andes S.A.'), 'INVERSIONES ANDES');
    assert.equal(normalizeChileCompanyCore('Comercial Sur Ltda.'), 'COMERCIAL SUR');
    assert.equal(normalizeChileCompanyCore('Tecnología Austral Sociedad por Acciones'), 'TECNOLOGIA AUSTRAL');
  });

  it('la fuente es de grano fiscal (un RUT, una fila)', () => {
    assert.equal(getSourceFamily('cl_res_registry'), 'TAX_GRAIN');
  });

  it('el CSV real (BOM, «;», CRLF) se lee bien', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cl-res-'));
    const file = join(dir, '2025-sociedades-por-fecha-rut-constitucion.csv');
    writeFileSync(
      file,
      '﻿ID;RUT;Razon Social;Fecha de actuacion (1era firma);Fecha de registro (ultima firma);Fecha de aprobacion x SII;Anio;Mes;Comuna Tributaria;Region Tributaria;Codigo de sociedad;Tipo de actuacion;Capital;Comuna Social;Region Social\r\n' +
        '5597811;78081198-6;Apicola Navarro SpA;01-01-2025;01-01-2025;01-01-2025;2025;Enero;CHEPICA;6;SpA;CONSTITUCIÓN;1500000;CHEPICA;6\r\n',
    );
    const rows = [];
    for await (const rec of readCsvFile(file, { delimiter: ';' })) rows.push(buildClResRegistryRow(rec, params));
    assert.deepEqual(
      rows.map((row) => [row?.tax_id, row?.normalized_legal_name, row?.raw_data.commune]),
      [['78081198-6', 'APICOLA NAVARRO', 'CHEPICA']],
    );
  });
});

describe('RUT por nombre dentro de la corrida', () => {
  const rows = [buildClResRegistryRow(record('78081198-6', 'Apicola Navarro SpA', 'SpA'), params)].filter((row) => row !== null);
  const resolver = createSnapshotNameOfficialSourceResolver({
    countryCode: 'CL',
    sourceKey: 'cl_res_registry',
    taxIdentifierType: 'RUT',
    validTaxId: /^\d{7,8}-[\dK]$/,
    normalizeCore: normalizeChileCompanyCore,
    querySnapshots: async (core) =>
      rows
        .filter((row) => row.normalized_legal_name === core)
        .map((row) => ({ taxId: row.normalized_tax_id, legalName: row.legal_name, normalizedLegalName: row.normalized_legal_name })),
  });

  const candidate = (canonicalName: string): NormalizedProspectCandidate =>
    ({
      sourceProvider: 'apollo',
      providerRecordId: 'rec-cl-1',
      providerRequestId: 'req-cl-1',
      canonicalName,
      normalizedName: canonicalName.toLowerCase(),
      commercialName: canonicalName,
      legalName: null,
      websiteUrl: null,
      domain: null,
      corporateLinkedinUrl: null,
      country: 'Chile',
      countryCode: 'CL',
      requestedCountryCode: 'CL',
      region: null,
      city: 'Santiago',
      industry: 'Agro',
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
      trace: { sourceProvider: 'apollo', providerRecordId: 'rec-cl-1', providerRequestId: 'req-cl-1', sourceUrl: null },
    }) as NormalizedProspectCandidate;

  it('nombre con otra forma → mismo núcleo → RUT fuerte con tipo RUT', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate('Apícola Navarro Ltda.'),
      { country: 'Chile', countryCode: 'CL' },
      [resolver],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, '78081198-6');
    assert.equal(enriched.taxIdentifierType, 'RUT');
  });

  it('una empresa que no está en el registro → sin RUT', async () => {
    const out = await resolver.resolve({
      candidate: candidate('Empresa Inexistente del Sur'),
      criteria: { countryCode: 'CL' },
      policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    });
    assert.equal(out.status, 'not_found');
  });
});
