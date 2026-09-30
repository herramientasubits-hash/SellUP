/**
 * SOURCES-AR-CUIT-BY-NAME-1 — Argentina (ar_rns_registry) name→CUIT resolver.
 *
 * Pure tests with a FAKE injected query. No I/O, no DB, no providers. CUIT with a
 * valid check digit; names shaped like real Registro Nacional de Sociedades rows.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOfficialSourceTypedColumns,
  enrichNormalizedProspectWithOfficialSources,
} from '../source-enrichment';
import type { NormalizedProspectCandidate, ProspectSearchCriteria } from '../types';
import {
  ARGENTINA_EXACT_MATCH_CONFIDENCE,
  createArgentinaOfficialSourceResolver,
  type ArgentinaSnapshotRow,
} from '../resolvers/argentina-official-source-resolver';
import { normalizeArCompanyCore } from '@/server/source-catalog/connectors/rns-argentina/ar-company-name-core';

function makeCandidate(overrides: Partial<NormalizedProspectCandidate> = {}): NormalizedProspectCandidate {
  return {
    sourceProvider: 'apollo',
    providerRecordId: 'rec-ar-1',
    providerRequestId: 'req-ar-1',
    canonicalName: 'Telecom Argentina S.A.',
    normalizedName: 'telecom argentina',
    commercialName: 'Telecom Argentina',
    legalName: null,
    websiteUrl: null,
    domain: null,
    corporateLinkedinUrl: null,
    country: 'Argentina',
    countryCode: 'AR',
    requestedCountryCode: 'AR',
    region: null,
    city: 'Buenos Aires',
    industry: 'Telecommunications',
    subindustry: null,
    industryCodes: {},
    employeeCount: 5000,
    employeeRange: null,
    sourceUrl: null,
    sourceConfidence: null,
    searchCriteria: {},
    warnings: [],
    issues: [],
    providerMetadataSafe: {},
    trace: { sourceProvider: 'apollo', providerRecordId: 'rec-ar-1', providerRequestId: 'req-ar-1', sourceUrl: null },
    ...overrides,
  };
}

const AR_CRITERIA: ProspectSearchCriteria = { countryCode: 'AR' };

function row(cuit: string, legalName: string): ArgentinaSnapshotRow {
  return { cuit, legalName, normalizedLegalName: normalizeArCompanyCore(legalName) };
}

function fakeQuery(rows: ArgentinaSnapshotRow[]) {
  const calls: string[] = [];
  const query = async (core: string) => {
    calls.push(core);
    return rows.filter((r) => r.normalizedLegalName === core);
  };
  return { query, calls };
}

async function enrich(candidate: NormalizedProspectCandidate, rows: ArgentinaSnapshotRow[]) {
  const { query, calls } = fakeQuery(rows);
  const resolver = createArgentinaOfficialSourceResolver({ querySnapshots: query });
  const identity = await enrichNormalizedProspectWithOfficialSources(candidate, AR_CRITERIA, [resolver]);
  return { identity, calls };
}

describe('normalizeArCompanyCore', () => {
  it('iguala las formas societarias largas y cortas', () => {
    assert.equal(normalizeArCompanyCore('TELECOM ARGENTINA SOCIEDAD ANONIMA'), 'TELECOM ARGENTINA');
    assert.equal(normalizeArCompanyCore('Telecom Argentina S.A.'), 'TELECOM ARGENTINA');
    assert.equal(normalizeArCompanyCore('MERCADOLIBRE S.R.L.'), 'MERCADOLIBRE');
    assert.equal(normalizeArCompanyCore('LOMA NEGRA CIA INDUSTRIAL ARGENTINA S. A.'), 'LOMA NEGRA CIA INDUSTRIAL ARGENTINA');
    assert.equal(normalizeArCompanyCore('Ñandú Tech S.A.S.'), 'NANDU TECH');
    assert.equal(normalizeArCompanyCore('EMPRESA X SOCIEDAD DE RESPONSABILIDAD LIMITADA'), 'EMPRESA X');
    assert.equal(normalizeArCompanyCore('EMPRESA Y S.A.U.'), 'EMPRESA Y');
  });

  it('nunca deja un nombre vacío por quitar la forma societaria', () => {
    assert.equal(normalizeArCompanyCore('SA'), 'SA');
    assert.equal(normalizeArCompanyCore('   '), '');
    assert.equal(normalizeArCompanyCore(null), '');
  });
});

describe('createArgentinaOfficialSourceResolver', () => {
  it('sólo intenta candidatos de AR con nombre utilizable', () => {
    const resolver = createArgentinaOfficialSourceResolver({ querySnapshots: async () => [] });
    const policy = {
      minimumStrongMatchConfidence: 0.85,
      allowLowConfidenceAsSignal: true,
      unsupportedCountryMode: 'warning' as const,
      errorMode: 'fail_soft' as const,
    };
    assert.equal(resolver.canResolve({ candidate: makeCandidate(), criteria: AR_CRITERIA, policy }), true);
    assert.equal(
      resolver.canResolve({ candidate: makeCandidate({ countryCode: 'CO' }), criteria: { countryCode: 'CO' }, policy }),
      false,
    );
    assert.equal(
      resolver.canResolve({ candidate: makeCandidate({ canonicalName: 'AB' }), criteria: AR_CRITERIA, policy }),
      false,
    );
  });

  it('un único CUIT con el mismo núcleo → identidad FUERTE (columnas CUIT)', async () => {
    const { identity, calls } = await enrich(makeCandidate(), [
      row('30639453738', 'TELECOM ARGENTINA SOCIEDAD ANONIMA'),
    ]);
    assert.deepEqual(calls, ['TELECOM ARGENTINA']);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.officialSource.confidence, ARGENTINA_EXACT_MATCH_CONFIDENCE);
    assert.equal(identity.taxIdentifier, '30639453738');
    assert.equal(identity.taxIdentifierType, 'CUIT');
    const columns = buildOfficialSourceTypedColumns(identity);
    assert.equal(columns.tax_identifier, '30639453738');
    assert.equal(columns.tax_identifier_type, 'CUIT');
    assert.equal(columns.legal_name, 'TELECOM ARGENTINA SOCIEDAD ANONIMA');
  });

  it('dos CUIT con el mismo núcleo → sólo señal, nunca fuerte', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Pampa Energía' }), [
      row('30526741457', 'PAMPA ENERGIA S A'),
      row('30500000127', 'PAMPA ENERGIA SOCIEDAD ANONIMA'),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'low_confidence_match');
    assert.equal(identity.officialSource.safeMetadata?.ambiguous, true);
    assert.equal(buildOfficialSourceTypedColumns(identity).tax_identifier, null);
  });

  it('el mismo CUIT repetido cuenta una sola vez', async () => {
    const { identity } = await enrich(makeCandidate(), [
      row('30639453738', 'TELECOM ARGENTINA SOCIEDAD ANONIMA'),
      row('30639453738', 'TELECOM ARGENTINA S.A.'),
    ]);
    assert.equal(identity.strongIdentityAvailable, true);
  });

  it('descarta CUIT de persona física o mal formada', async () => {
    const { identity } = await enrich(makeCandidate(), [
      row('20333449588', 'TELECOM ARGENTINA S.A.'),
      row('3063945', 'TELECOM ARGENTINA S.A.'),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('una fila con otro núcleo se descarta aunque la lectura la devuelva', async () => {
    const resolver = createArgentinaOfficialSourceResolver({
      querySnapshots: async () => [row('30639453738', 'TELECOM ARGENTINA HOLDING SA')],
    });
    const identity = await enrichNormalizedProspectWithOfficialSources(makeCandidate(), AR_CRITERIA, [resolver]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('un nombre demasiado genérico nunca consulta', async () => {
    const { identity, calls } = await enrich(makeCandidate({ canonicalName: 'Grupo S.A.' }), [
      row('30500000127', 'GRUPO SA'),
    ]);
    assert.equal(calls.length, 0);
    assert.equal(identity.strongIdentityAvailable, false);
  });

  it('una lectura vacía degrada a no encontrado', async () => {
    const { identity } = await enrich(makeCandidate(), []);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });
});
