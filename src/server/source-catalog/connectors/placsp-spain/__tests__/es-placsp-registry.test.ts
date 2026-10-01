/**
 * SOURCES-ES-NIF-BY-NAME-1 — España: NIF por nombre sobre las sociedades
 * adjudicatarias de la Plataforma de Contratación del Sector Público.
 *
 * Bloques con la forma real de la sindicación ATOM/CODICE (septiembre de 2026).
 * Sin E/S de red, sin DB, sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEsPlacspRegistryRow,
  extractPlacspWinners,
  normalizeSpainCompanyCore,
  normalizeSpainCompanyNif,
} from '../es-placsp-registry-rows';
import {
  calculateSpainCompanyNifControl,
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

const params = { sourceYear: 2026, importedAt: '2026-10-01T00:00:00.000Z' };

const party = (scheme: string, id: string, name: string) => `
                <cac:WinningParty>
                    <cac:PartyIdentification>
                        <cbc:ID schemeName="${scheme}">${id}</cbc:ID>
                    </cac:PartyIdentification>
                    <cac:PartyName>
                        <cbc:Name>${name}</cbc:Name>
                    </cac:PartyName>
                </cac:WinningParty>`;

describe('regla del NIF de sociedad', () => {
  it('está registrada para ES, con control', () => {
    const rule = getTaxIdentifierRule('es');
    assert.equal(rule?.label, 'NIF');
    assert.equal(rule?.validationLevel, 'checksum');
  });

  it('calcula el control (dígito o letra) de NIF reales de sociedades', () => {
    assert.deepEqual(calculateSpainCompanyNifControl('5871074'), { digit: '0', letter: 'J' });
    assert.deepEqual(calculateSpainCompanyNifControl('1038391'), { digit: '7', letter: 'G' });
    assert.equal(calculateSpainCompanyNifControl('103839'), null);
  });

  it('acepta sociedades reales y rechaza un control equivocado y los DNI de personas', () => {
    for (const nif of ['A58710740', 'B10383917', 'b-10383917', 'B62537774']) {
      assert.equal(validateTaxIdentifier(nif, 'ES').valid, true, nif);
    }
    assert.equal(validateTaxIdentifier('b-10383917', 'ES').normalized, 'B10383917');
    assert.equal(validateTaxIdentifier('B10383918', 'ES').valid, false);
    assert.equal(validateTaxIdentifier('24839482B', 'ES').valid, false);
  });

  it('normalizeSpainCompanyNif: sólo NIF de sociedad con control válido', () => {
    assert.equal(normalizeSpainCompanyNif(' a58710740 '), 'A58710740');
    assert.equal(normalizeSpainCompanyNif('A58710741'), null);
    assert.equal(normalizeSpainCompanyNif('28993984T'), null);
    assert.equal(normalizeSpainCompanyNif(null), null);
  });

  it('el control también puede ser una LETRA (organismos públicos: FNMT, Patrimonio del Estado)', () => {
    assert.equal(normalizeSpainCompanyNif('Q2826004J'), 'Q2826004J');
    assert.equal(normalizeSpainCompanyNif('S2826002D'), 'S2826002D');
    assert.equal(normalizeSpainCompanyNif('Q2826004K'), null);
  });
});

describe('adjudicatarias de la PLACSP', () => {
  it('extrae NIF y nombre (con entidades XML) y descarta DNI, «OTROS» y controles malos', () => {
    const xml =
      party('NIF', 'B10383917', 'GLOBALEX GESTION&amp;SERVICIOS S.L') +
      party('NIF', '24839482B', 'GARCIA PEREZ JUAN') +
      party('OTROS', 'A04011284', 'EMPRESA EXTRANJERA') +
      party('NIF', 'A58710741', 'NIF MAL ESCRITO S.A.') +
      party('NIF', 'A58710740', '   ') +
      party('NIF', 'B62537774', 'Produccions de Gastronomia, S.L.U.');
    assert.deepEqual(extractPlacspWinners(xml), [
      { nif: 'B10383917', name: 'GLOBALEX GESTION&SERVICIOS S.L' },
      { nif: 'B62537774', name: 'Produccions de Gastronomia, S.L.U.' },
    ]);
  });

  it('una adjudicataria → fila mínima con el NIF y el núcleo del nombre', () => {
    const row = buildEsPlacspRegistryRow({ nif: 'A58710740', name: 'PALEX MEDICAL, S.A.' }, params);
    assert.ok(row);
    assert.equal(row.source_key, 'es_placsp_registry');
    assert.equal(row.country_code, 'ES');
    assert.equal(row.tax_id, 'A58710740');
    assert.equal(row.normalized_legal_name, 'PALEX MEDICAL');
    assert.equal(row.record_identity_key, 'tax:A58710740');
    assert.equal(buildEsPlacspRegistryRow({ nif: 'A58710740', name: 'X' }, params), null);
  });

  it('núcleo español: S.L., S.L.U., S.A.U., S.Coop., SOCIEDAD LIMITADA…', () => {
    assert.equal(normalizeSpainCompanyCore('Produccions de Gastronomia, S.L.U.'), 'PRODUCCIONS DE GASTRONOMIA');
    assert.equal(normalizeSpainCompanyCore('VÁLVULAS AUTOMATICAS ROSS S.A.'), 'VALVULAS AUTOMATICAS ROSS');
    assert.equal(normalizeSpainCompanyCore('Estudio Nexo52 Arquitectura e Ingenieria S.L.P.'), 'ESTUDIO NEXO52 ARQUITECTURA E INGENIERIA');
    assert.equal(normalizeSpainCompanyCore('Cooperativa del Campo S. Coop.'), 'COOPERATIVA DEL CAMPO');
    assert.equal(normalizeSpainCompanyCore('Palex Medical Sociedad Anónima'), 'PALEX MEDICAL');
  });

  it('la fuente es de grano fiscal (un NIF, una fila)', () => {
    assert.equal(getSourceFamily('es_placsp_registry'), 'TAX_GRAIN');
  });
});

describe('NIF por nombre dentro de la corrida', () => {
  const rows = [buildEsPlacspRegistryRow({ nif: 'A58710740', name: 'PALEX MEDICAL, S.A.' }, params)].filter(
    (row) => row !== null,
  );
  const resolver = createSnapshotNameOfficialSourceResolver({
    countryCode: 'ES',
    sourceKey: 'es_placsp_registry',
    taxIdentifierType: 'NIF',
    validTaxId: /^[A-HJNPQRSUVW]\d{7}[0-9A-J]$/,
    normalizeCore: normalizeSpainCompanyCore,
    querySnapshots: async (core) =>
      rows
        .filter((row) => row.normalized_legal_name === core)
        .map((row) => ({ taxId: row.normalized_tax_id, legalName: row.legal_name, normalizedLegalName: row.normalized_legal_name })),
  });

  const candidate = (canonicalName: string): NormalizedProspectCandidate =>
    ({
      sourceProvider: 'apollo',
      providerRecordId: 'rec-es-1',
      providerRequestId: 'req-es-1',
      canonicalName,
      normalizedName: canonicalName.toLowerCase(),
      commercialName: canonicalName,
      legalName: null,
      websiteUrl: null,
      domain: null,
      corporateLinkedinUrl: null,
      country: 'España',
      countryCode: 'ES',
      requestedCountryCode: 'ES',
      region: null,
      city: 'Barcelona',
      industry: 'Health',
      subindustry: null,
      industryCodes: {},
      employeeCount: 400,
      employeeRange: null,
      sourceUrl: null,
      sourceConfidence: null,
      searchCriteria: {},
      warnings: [],
      issues: [],
      providerMetadataSafe: {},
      trace: { sourceProvider: 'apollo', providerRecordId: 'rec-es-1', providerRequestId: 'req-es-1', sourceUrl: null },
    }) as NormalizedProspectCandidate;

  it('nombre con otra forma societaria → mismo núcleo → NIF fuerte con tipo NIF', async () => {
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      candidate('Palex Medical S.A.U.'),
      { country: 'España', countryCode: 'ES' },
      [resolver],
      DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    );
    assert.equal(enriched.strongIdentityAvailable, true);
    assert.equal(enriched.taxIdentifier, 'A58710740');
    assert.equal(enriched.taxIdentifierType, 'NIF');
    assert.equal(validateTaxIdentifier(enriched.taxIdentifier ?? '', 'ES').valid, true);
  });

  it('una empresa que nunca ganó un contrato público → sin NIF', async () => {
    const out = await resolver.resolve({
      candidate: candidate('Empresa Sin Contratos S.L.'),
      criteria: { countryCode: 'ES' },
      policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
    });
    assert.equal(out.status, 'not_found');
  });
});
