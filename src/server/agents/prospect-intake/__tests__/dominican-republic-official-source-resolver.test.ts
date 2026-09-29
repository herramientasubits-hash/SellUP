/**
 * SOURCES-DO-INRUN-RNC-1 — República Dominicana (rd_dgii_bulk) name→RNC resolver.
 *
 * Pure tests with a FAKE injected snapshot query. No I/O, no DB, no providers.
 * Row shapes mirror real DGII snapshot rows (upper-case legal name that keeps the
 * legal-form suffix, 9-digit RNC, taxpayer status text).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichNormalizedProspectWithOfficialSources,
  buildOfficialSourceTypedColumns,
} from '../source-enrichment';
import type { NormalizedProspectCandidate, ProspectSearchCriteria } from '../types';
import {
  buildDominicanLookupNames,
  createDominicanOfficialSourceResolver,
  normalizeDominicanCompanyCore,
  DOMINICAN_EXACT_MATCH_CONFIDENCE,
  type DominicanSnapshotRow,
} from '../resolvers/dominican-republic-official-source-resolver';

function makeCandidate(
  overrides: Partial<NormalizedProspectCandidate> = {},
): NormalizedProspectCandidate {
  return {
    sourceProvider: 'apollo',
    providerRecordId: 'rec-do-1',
    providerRequestId: 'req-do-1',
    canonicalName: 'Grupo Ramos Arias',
    normalizedName: 'grupo ramos arias',
    commercialName: 'Grupo Ramos Arias',
    legalName: null,
    websiteUrl: null,
    domain: null,
    corporateLinkedinUrl: null,
    country: 'República Dominicana',
    countryCode: 'DO',
    requestedCountryCode: 'DO',
    region: null,
    city: 'Santo Domingo',
    industry: 'Retail',
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
    trace: {
      sourceProvider: 'apollo',
      providerRecordId: 'rec-do-1',
      providerRequestId: 'req-do-1',
      sourceUrl: null,
    },
    ...overrides,
  };
}

const DO_CRITERIA: ProspectSearchCriteria = { countryCode: 'DO' };

function row(
  rnc: string,
  normalizedLegalName: string,
  taxpayerStatus = 'ACTIVO',
): DominicanSnapshotRow {
  return {
    rnc,
    legalName: normalizedLegalName,
    normalizedLegalName,
    taxpayerStatus,
    isActiveTaxpayer: taxpayerStatus === 'ACTIVO',
  };
}

/** Fake query: returns the rows whose stored name is in the requested list. */
function fakeQuery(rows: DominicanSnapshotRow[]) {
  const calls: string[][] = [];
  const query = async (names: string[]) => {
    calls.push(names);
    return rows.filter((r) => names.includes(r.normalizedLegalName ?? ''));
  };
  return { query, calls };
}

async function enrich(
  candidate: NormalizedProspectCandidate,
  rows: DominicanSnapshotRow[],
) {
  const { query, calls } = fakeQuery(rows);
  const resolver = createDominicanOfficialSourceResolver({ querySnapshots: query });
  const identity = await enrichNormalizedProspectWithOfficialSources(candidate, DO_CRITERIA, [
    resolver,
  ]);
  return { identity, calls };
}

describe('normalizeDominicanCompanyCore', () => {
  it('strips accents, punctuation and every DGII legal-form spelling', () => {
    assert.equal(normalizeDominicanCompanyCore('Grupo Ramos Arias, S.R.L.'), 'GRUPO RAMOS ARIAS');
    assert.equal(normalizeDominicanCompanyCore('INVERSIONES CLARO VELO S A'), 'INVERSIONES CLARO VELO');
    assert.equal(normalizeDominicanCompanyCore('Compañía Aérea C. por A.'), 'COMPANIA AEREA');
    assert.equal(normalizeDominicanCompanyCore('Tecnología Caribe SAS'), 'TECNOLOGIA CARIBE');
    assert.equal(normalizeDominicanCompanyCore('Servicios Viales E.I.R.L.'), 'SERVICIOS VIALES');
  });

  it('keeps & (DGII stores it) and never strips a name down to nothing', () => {
    assert.equal(normalizeDominicanCompanyCore('Dinamismo & Accion SRL'), 'DINAMISMO & ACCION');
    assert.equal(normalizeDominicanCompanyCore('SA'), 'SA');
    assert.equal(normalizeDominicanCompanyCore('   '), '');
  });

  it('asks the index for the core plus each suffix spelling', () => {
    const names = buildDominicanLookupNames('GRUPO RAMOS ARIAS');
    assert.ok(names.includes('GRUPO RAMOS ARIAS'));
    assert.ok(names.includes('GRUPO RAMOS ARIAS SRL'));
    assert.ok(names.includes('GRUPO RAMOS ARIAS S R L'));
    assert.ok(names.includes('GRUPO RAMOS ARIAS C POR A'));
    assert.deepEqual(buildDominicanLookupNames(''), []);
  });
});

describe('createDominicanOfficialSourceResolver', () => {
  it('only attempts DO candidates with a usable name', () => {
    const resolver = createDominicanOfficialSourceResolver({ querySnapshots: async () => [] });
    const policy = {
      minimumStrongMatchConfidence: 0.85,
      allowLowConfidenceAsSignal: true,
      unsupportedCountryMode: 'warning' as const,
      errorMode: 'fail_soft' as const,
    };
    assert.equal(resolver.canResolve({ candidate: makeCandidate(), criteria: DO_CRITERIA, policy }), true);
    assert.equal(
      resolver.canResolve({
        candidate: makeCandidate({ countryCode: 'CO' }),
        criteria: { countryCode: 'CO' },
        policy,
      }),
      false,
    );
    assert.equal(
      resolver.canResolve({ candidate: makeCandidate({ canonicalName: 'AB' }), criteria: DO_CRITERIA, policy }),
      false,
    );
  });

  it('one active RNC with the same core → STRONG identity (RNC typed columns)', async () => {
    const { identity } = await enrich(makeCandidate(), [row('131735444', 'GRUPO RAMOS ARIAS SRL')]);

    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.officialSource.status, 'matched');
    assert.equal(identity.officialSource.confidence, DOMINICAN_EXACT_MATCH_CONFIDENCE);
    assert.equal(identity.taxIdentifier, '131735444');
    assert.equal(identity.taxIdentifierType, 'RNC');

    const columns = buildOfficialSourceTypedColumns(identity);
    assert.equal(columns.tax_identifier, '131735444');
    assert.equal(columns.tax_identifier_type, 'RNC');
    assert.equal(columns.legal_name, 'GRUPO RAMOS ARIAS SRL');
  });

  it('an active RNC wins over inactive homonyms, and says so', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Punto Claro' }), [
      row('133406292', 'PUNTO CLARO SRL'),
      row('130187096', 'PUNTO CLARO S A', 'DADO DE BAJA'),
    ]);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '133406292');
    assert.equal(identity.officialSource.safeMetadata?.inactiveHomonyms, 1);
  });

  it('two ACTIVE RNCs with the same core → signal only, never strong', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Mont Claro' }), [
      row('133353131', 'MONT CLARO SRL'),
      row('131486509', 'MONT CLARO S A'),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'low_confidence_match');
    assert.equal(identity.taxIdentifier ?? null, null);
    assert.equal(identity.officialSource.safeMetadata?.ambiguous, true);
    assert.equal(buildOfficialSourceTypedColumns(identity).tax_identifier, null);
  });

  it('only inactive / suspended taxpayers → signal only, never strong', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Rio Claro Films' }), [
      row('133170949', 'RIO CLARO FILMS SRL', 'SUSPENDIDO'),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'low_confidence_match');
    assert.equal(identity.officialSource.safeMetadata?.noActiveTaxpayer, true);
  });

  it('a longer registry name is NOT a match (no fuzzy RNC)', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Grupo Ramos' }), [
      row('131735444', 'GRUPO RAMOS ARIAS SRL'),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('a row with a different core is discarded even if the read returns it', async () => {
    // Defence in depth: the resolver re-checks every returned row, so a looser
    // read can never turn a different company into a strong identity.
    const resolver = createDominicanOfficialSourceResolver({
      querySnapshots: async () => [row('131735444', 'GRUPO RAMOS ARIAS SRL')],
    });
    const identity = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate({ canonicalName: 'Grupo Ramos' }),
      DO_CRITERIA,
      [resolver],
    );
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('the same RNC repeated in several rows counts once', async () => {
    const { identity } = await enrich(makeCandidate(), [
      row('131735444', 'GRUPO RAMOS ARIAS SRL'),
      row('131735444', 'GRUPO RAMOS ARIAS S R L'),
    ]);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '131735444');
  });

  it('ignores rows without a valid 9-digit business RNC', async () => {
    const { identity } = await enrich(makeCandidate(), [
      row('00112345678', 'GRUPO RAMOS ARIAS SRL'),
      row('', 'GRUPO RAMOS ARIAS SA'),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('a too-generic name never queries the registry', async () => {
    const { identity, calls } = await enrich(makeCandidate({ canonicalName: 'Grupo SRL' }), [
      row('131111111', 'GRUPO SRL'),
    ]);
    assert.equal(calls.length, 0);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('a failing query degrades softly (empty rows → not found)', async () => {
    const resolver = createDominicanOfficialSourceResolver({ querySnapshots: async () => [] });
    const identity = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate(),
      DO_CRITERIA,
      [resolver],
    );
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });
});
