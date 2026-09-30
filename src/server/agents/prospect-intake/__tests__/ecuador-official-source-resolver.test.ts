/**
 * SOURCES-EC-RUC-BY-NAME-1 — Ecuador (ec_scvs) name→RUC resolver.
 *
 * Pure tests with a FAKE injected query. No I/O, no DB, no providers. Names shaped
 * like real Superintendencia de Compañías rows; RUCs synthetic (13 digits, 001).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOfficialSourceTypedColumns,
  enrichNormalizedProspectWithOfficialSources,
} from '../source-enrichment';
import type { NormalizedProspectCandidate, ProspectSearchCriteria } from '../types';
import {
  ECUADOR_EXACT_MATCH_CONFIDENCE,
  createEcuadorOfficialSourceResolver,
  type EcuadorSnapshotRow,
} from '../resolvers/ecuador-official-source-resolver';
import {
  EC_COMPANY_NAME_CORE_SQL,
  normalizeEcCompanyCore,
} from '@/server/source-catalog/connectors/ec-scvs/ec-company-name-core';

function makeCandidate(overrides: Partial<NormalizedProspectCandidate> = {}): NormalizedProspectCandidate {
  return {
    sourceProvider: 'apollo',
    providerRecordId: 'rec-ec-1',
    providerRequestId: 'req-ec-1',
    canonicalName: 'Sistemas Audiovisuales Lumens S.A.',
    normalizedName: 'sistemas audiovisuales lumens',
    commercialName: 'Lumens',
    legalName: null,
    websiteUrl: null,
    domain: null,
    corporateLinkedinUrl: null,
    country: 'Ecuador',
    countryCode: 'EC',
    requestedCountryCode: 'EC',
    region: null,
    city: 'Guayaquil',
    industry: 'Audiovisual',
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
    trace: { sourceProvider: 'apollo', providerRecordId: 'rec-ec-1', providerRequestId: 'req-ec-1', sourceUrl: null },
    ...overrides,
  };
}

const EC_CRITERIA: ProspectSearchCriteria = { countryCode: 'EC' };

function row(ruc: string, legalName: string): EcuadorSnapshotRow {
  return { ruc, legalName, normalizedLegalName: normalizeEcCompanyCore(legalName) };
}

function fakeQuery(rows: EcuadorSnapshotRow[]) {
  const calls: string[] = [];
  const query = async (core: string) => {
    calls.push(core);
    return rows.filter((r) => r.normalizedLegalName === core);
  };
  return { query, calls };
}

async function enrich(candidate: NormalizedProspectCandidate, rows: EcuadorSnapshotRow[]) {
  const { query, calls } = fakeQuery(rows);
  const resolver = createEcuadorOfficialSourceResolver({ querySnapshots: query });
  const identity = await enrichNormalizedProspectWithOfficialSources(candidate, EC_CRITERIA, [resolver]);
  return { identity, calls };
}

describe('normalizeEcCompanyCore', () => {
  it('quita las formas societarias ecuatorianas', () => {
    assert.equal(normalizeEcCompanyCore('SISTEMAS AUDIOVISUALES LUMENS S.A.'), 'SISTEMAS AUDIOVISUALES LUMENS');
    assert.equal(normalizeEcCompanyCore('CONSULTORA VISUPROY CIA. LTDA.'), 'CONSULTORA VISUPROY');
    assert.equal(normalizeEcCompanyCore('SEIMEER CIA.LTDA.'), 'SEIMEER');
    assert.equal(normalizeEcCompanyCore('TURISMO LAS LUCIERNAGAS C LTDA'), 'TURISMO LAS LUCIERNAGAS');
    assert.equal(normalizeEcCompanyCore('OPTICA VAZVISION COMPAÑIA LIMITADA'), 'OPTICA VAZVISION');
    assert.equal(normalizeEcCompanyCore('MAXPHONE SOCIEDAD POR ACCIONES SIMPLIFICADA'), 'MAXPHONE');
    assert.equal(normalizeEcCompanyCore('ARQUIGAMA S.A.S.'), 'ARQUIGAMA');
    assert.equal(normalizeEcCompanyCore('NUMANCIA CA'), 'NUMANCIA');
    assert.equal(normalizeEcCompanyCore('PANÓPTICO S.A.S.'), 'PANOPTICO');
  });

  it('conserva «EN LIQUIDACIÓN» y las formas en mitad del nombre', () => {
    assert.equal(normalizeEcCompanyCore('AGRITECHNO S.A.S., EN LIQUIDACIÓN'), 'AGRITECHNO S A S EN LIQUIDACION');
    assert.equal(normalizeEcCompanyCore('SEGURIDAD DEL PACIFICO S.A. SEGUPAC'), 'SEGURIDAD DEL PACIFICO S A SEGUPAC');
  });

  it('nunca deja un nombre vacío', () => {
    assert.equal(normalizeEcCompanyCore('SA'), 'SA');
    assert.equal(normalizeEcCompanyCore(''), '');
    assert.equal(normalizeEcCompanyCore(undefined), '');
  });

  it('la versión SQL aplica los mismos pasos y las mismas formas', () => {
    assert.match(EC_COMPANY_NAME_CORE_SQL, /translate\(legal_name,/);
    assert.match(EC_COMPANY_NAME_CORE_SQL, /'\[\^A-Z0-9& \]', ' ', 'g'/);
    assert.equal(EC_COMPANY_NAME_CORE_SQL.split("CIA LTDA|C LTDA").length - 1, 3);
    assert.doesNotMatch(EC_COMPANY_NAME_CORE_SQL, /LIQUIDACION/);
  });
});

describe('createEcuadorOfficialSourceResolver', () => {
  it('sólo intenta candidatos de EC con nombre utilizable', () => {
    const resolver = createEcuadorOfficialSourceResolver({ querySnapshots: async () => [] });
    const policy = {
      minimumStrongMatchConfidence: 0.85,
      allowLowConfidenceAsSignal: true,
      unsupportedCountryMode: 'warning' as const,
      errorMode: 'fail_soft' as const,
    };
    assert.equal(resolver.canResolve({ candidate: makeCandidate(), criteria: EC_CRITERIA, policy }), true);
    assert.equal(
      resolver.canResolve({ candidate: makeCandidate({ countryCode: 'CO' }), criteria: { countryCode: 'CO' }, policy }),
      false,
    );
    assert.equal(
      resolver.canResolve({ candidate: makeCandidate({ canonicalName: 'AB' }), criteria: EC_CRITERIA, policy }),
      false,
    );
  });

  it('un único RUC con el mismo núcleo → identidad FUERTE (columnas RUC)', async () => {
    const { identity, calls } = await enrich(makeCandidate(), [
      row('0992402008001', 'SISTEMAS AUDIOVISUALES LUMENS S.A.'),
    ]);
    assert.deepEqual(calls, ['SISTEMAS AUDIOVISUALES LUMENS']);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.officialSource.confidence, ECUADOR_EXACT_MATCH_CONFIDENCE);
    assert.equal(identity.taxIdentifier, '0992402008001');
    assert.equal(identity.taxIdentifierType, 'RUC');
    const columns = buildOfficialSourceTypedColumns(identity);
    assert.equal(columns.tax_identifier, '0992402008001');
    assert.equal(columns.tax_identifier_type, 'RUC');
    assert.equal(columns.legal_name, 'SISTEMAS AUDIOVISUALES LUMENS S.A.');
  });

  it('dos RUC con el mismo núcleo → sólo señal, nunca fuerte', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Inmobiliaria Verzam' }), [
      row('1790000001001', 'INMOBILIARIA VERZAM CIA. LTDA.'),
      row('1790000002001', 'INMOBILIARIA VERZAM S.A.'),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'low_confidence_match');
    assert.equal(identity.officialSource.safeMetadata?.ambiguous, true);
    assert.equal(buildOfficialSourceTypedColumns(identity).tax_identifier, null);
  });

  it('el mismo RUC en varios expedientes cuenta una sola vez', async () => {
    const { identity } = await enrich(makeCandidate(), [
      row('0992402008001', 'SISTEMAS AUDIOVISUALES LUMENS S.A.'),
      row('0992402008001', 'SISTEMAS AUDIOVISUALES LUMENS SA'),
    ]);
    assert.equal(identity.strongIdentityAvailable, true);
  });

  it('descarta RUC que no son de compañía (no terminan en 001) o mal formados', async () => {
    const { identity } = await enrich(makeCandidate(), [
      row('0992402008002', 'SISTEMAS AUDIOVISUALES LUMENS S.A.'),
      row('09924020', 'SISTEMAS AUDIOVISUALES LUMENS S.A.'),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('una fila con otro núcleo se descarta aunque la lectura la devuelva', async () => {
    const resolver = createEcuadorOfficialSourceResolver({
      querySnapshots: async () => [row('0992402008001', 'SISTEMAS AUDIOVISUALES LUMENS HOLDING S.A.')],
    });
    const identity = await enrichNormalizedProspectWithOfficialSources(makeCandidate(), EC_CRITERIA, [resolver]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('un nombre demasiado genérico nunca consulta', async () => {
    const { identity, calls } = await enrich(makeCandidate({ canonicalName: 'Grupo S.A.' }), [
      row('1790000001001', 'GRUPO SA'),
    ]);
    assert.equal(calls.length, 0);
    assert.equal(identity.strongIdentityAvailable, false);
  });

  it('una compañía en liquidación nunca coincide con el nombre activo', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Agritechno S.A.S.' }), [
      row('0993000001001', 'AGRITECHNO S.A.S., EN LIQUIDACIÓN'),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('una lectura vacía degrada a no encontrado', async () => {
    const { identity } = await enrich(makeCandidate(), []);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });
});
