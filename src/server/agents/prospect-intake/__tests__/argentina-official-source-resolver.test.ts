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
import {
  AR_REGISTRY_COMPOSITE_FORMS,
  buildArRegistryLookupTiers,
  normalizeArCompanyCore,
} from '@/server/source-catalog/connectors/rns-argentina/ar-company-name-core';

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

/** Fake read: each call records the FIRST name asked (the tier's base). */
function fakeQuery(rows: ArgentinaSnapshotRow[]) {
  const calls: string[] = [];
  const asked: string[][] = [];
  const query = async (names: readonly string[]) => {
    calls.push(names[0]);
    asked.push([...names]);
    return rows.filter((r) => names.includes(r.normalizedLegalName ?? ''));
  };
  return { query, calls, asked };
}

async function enrich(candidate: NormalizedProspectCandidate, rows: ArgentinaSnapshotRow[]) {
  const { query, calls, asked } = fakeQuery(rows);
  const resolver = createArgentinaOfficialSourceResolver({ querySnapshots: query });
  const identity = await enrichNormalizedProspectWithOfficialSources(candidate, AR_CRITERIA, [resolver]);
  return { identity, calls, asked };
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

describe('buildArRegistryLookupTiers (SOURCES-AR-E2E-1)', () => {
  it('ordena: exacto → forma compuesta → con/sin ARGENTINA → palabras juntas', () => {
    const tiers = buildArRegistryLookupTiers('MERCADO LIBRE');
    assert.deepEqual(
      tiers.map((t) => [t.kind, t.core]),
      [
        ['exact', 'MERCADO LIBRE'],
        ['legal_form', 'MERCADO LIBRE'],
        ['country_variant', 'MERCADO LIBRE DE ARGENTINA'],
        ['country_variant', 'MERCADO LIBRE ARGENTINA'],
        ['compact', 'MERCADOLIBRE'],
      ],
    );
    assert.deepEqual(tiers[0].names, ['MERCADO LIBRE']);
    assert.equal(tiers[1].names.length, AR_REGISTRY_COMPOSITE_FORMS.length);
    assert.ok(tiers[1].names.includes('MERCADO LIBRE S A I C'));
    assert.ok(!tiers[1].names.includes('MERCADO LIBRE'), 'el escalón de forma no repite el exacto');
    assert.equal(tiers[4].names[0], 'MERCADOLIBRE');
  });

  it('quita «ARGENTINA» / «DE ARGENTINA» del final en vez de añadirlo', () => {
    assert.deepEqual(
      buildArRegistryLookupTiers('CENCOSUD ARGENTINA').filter((t) => t.kind === 'country_variant').map((t) => t.core),
      ['CENCOSUD'],
    );
    assert.deepEqual(
      buildArRegistryLookupTiers('TELEFONICA DE ARGENTINA').filter((t) => t.kind === 'country_variant').map((t) => t.core),
      ['TELEFONICA'],
    );
  });

  it('una sola palabra o con dígitos nunca se junta; un núcleo vacío no busca', () => {
    assert.ok(!buildArRegistryLookupTiers('ARCOR').some((t) => t.kind === 'compact'));
    assert.ok(!buildArRegistryLookupTiers('GRUPO 21 MEDIA').some((t) => t.kind === 'compact'));
    assert.ok(!buildArRegistryLookupTiers('A B C D').some((t) => t.kind === 'compact'));
    assert.deepEqual(buildArRegistryLookupTiers(''), []);
  });

  it('cada escalón cabe en una sola lectura (≤ 80 nombres)', () => {
    for (const tier of buildArRegistryLookupTiers('SWISS MEDICAL')) {
      assert.ok(tier.names.length <= 80, `${tier.kind}: ${tier.names.length}`);
    }
  });
});

describe('resolvedor AR con escalones (SOURCES-AR-E2E-1)', () => {
  it('forma compuesta: «Arcor» → ARCOR S A I C, FUERTE', async () => {
    const { identity, calls } = await enrich(makeCandidate({ canonicalName: 'Arcor' }), [
      { cuit: '30500041681', legalName: 'ARCOR S A I C', normalizedLegalName: 'ARCOR S A I C' },
    ]);
    assert.deepEqual(calls, ['ARCOR', 'ARCOR ASOCIACION CIVIL']);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '30500041681');
    assert.equal(identity.officialSource.safeMetadata?.lookupTier, 'legal_form');
  });

  it('asociación civil: «Hospital Alemán» → HOSPITAL ALEMAN ASOCIACION CIVIL', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Hospital Alemán' }), [
      { cuit: '30545768447', legalName: 'HOSPITAL ALEMAN ASOCIACION CIVIL', normalizedLegalName: 'HOSPITAL ALEMAN ASOCIACION CIVIL' },
    ]);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '30545768447');
  });

  it('sin «Argentina»: «Cencosud Argentina» → CENCOSUD S A, FUERTE', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Cencosud Argentina' }), [
      row('30590360763', 'CENCOSUD S A'),
    ]);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '30590360763');
    assert.equal(identity.officialSource.safeMetadata?.lookupTier, 'country_variant');
  });

  it('con «Argentina»: «Auth0» → AUTH0 ARGENTINA S. A.', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Auth0', domain: 'auth0.com' }), [
      row('30715478812', 'AUTH0 ARGENTINA S. A.'),
    ]);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '30715478812');
  });

  it('palabras juntas: «Mercado Libre» → MERCADOLIBRE S.R.L.', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Mercado Libre' }), [
      row('30703088534', 'MERCADOLIBRE S.R.L.'),
    ]);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.officialSource.safeMetadata?.lookupTier, 'compact');
  });

  it('el primer escalón con CUIT decide: el exacto gana y no se lee nada más', async () => {
    const { identity, calls } = await enrich(makeCandidate(), [
      row('30639453738', 'TELECOM ARGENTINA SOCIEDAD ANONIMA'),
      row('30500000127', 'TELECOM S A'),
    ]);
    assert.deepEqual(calls, ['TELECOM ARGENTINA']);
    assert.equal(identity.taxIdentifier, '30639453738');
    assert.equal(identity.officialSource.safeMetadata?.lookupTier, 'exact');
  });

  it('dos CUIT en un escalón variante → sólo señal, nunca fuerte', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Sodimac Argentina' }), [
      row('30708113371', 'SODIMAC S A'),
      row('30709553630', 'SODIMAC SRL'),
    ]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'low_confidence_match');
    assert.equal(identity.officialSource.safeMetadata?.lookupTier, 'country_variant');
  });

  it('una variante genérica no se consulta («Grupo Argentina» nunca busca «GRUPO»)', async () => {
    const { identity, calls } = await enrich(makeCandidate({ canonicalName: 'Grupo Argentina' }), [
      row('30500000127', 'GRUPO SA'),
    ]);
    assert.ok(!calls.includes('GRUPO'));
    assert.equal(identity.strongIdentityAvailable, false);
  });

  it('una fila con un nombre que no se pidió en ese escalón se descarta', async () => {
    const resolver = createArgentinaOfficialSourceResolver({
      querySnapshots: async () => [
        { cuit: '30500041681', legalName: 'ARCOR HOLDING S A I C', normalizedLegalName: 'ARCOR HOLDING S A I C' },
      ],
    });
    const identity = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate({ canonicalName: 'Arcor' }),
      AR_CRITERIA,
      [resolver],
    );
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });
});
