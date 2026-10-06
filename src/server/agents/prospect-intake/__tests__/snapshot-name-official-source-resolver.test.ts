/**
 * SOURCES-GT-HN-BY-NAME-1 — resolvedor genérico nombre → número fiscal sobre un
 * snapshot cargado, probado con las configuraciones de Guatemala y Honduras.
 *
 * Consulta DOBLE inyectada. Sin E/S, sin DB, sin proveedores. Nombres con la forma
 * real de RGAE (Guatemala) y Contrataciones Abiertas (Honduras); números
 * sintéticos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOfficialSourceTypedColumns,
  enrichNormalizedProspectWithOfficialSources,
} from '../source-enrichment';
import type { NormalizedProspectCandidate, ProspectSearchCriteria } from '../types';
import {
  createSnapshotNameOfficialSourceResolver,
  SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE,
  type SnapshotNameRow,
} from '../resolvers/snapshot-name-official-source-resolver';
import {
  buildCompanyNameCoreSql,
  CENTRAL_AMERICA_LEGAL_FORMS,
  normalizeCompanyNameCore,
} from '@/server/source-catalog/company-name-core';

const core = (name: string | null | undefined) => normalizeCompanyNameCore(name, CENTRAL_AMERICA_LEGAL_FORMS);

function makeCandidate(overrides: Partial<NormalizedProspectCandidate> = {}): NormalizedProspectCandidate {
  return {
    sourceProvider: 'apollo',
    providerRecordId: 'rec-gt-1',
    providerRequestId: 'req-gt-1',
    canonicalName: 'Opigrafik S.A.',
    normalizedName: 'opigrafik',
    commercialName: 'Opigrafik',
    legalName: null,
    websiteUrl: null,
    domain: null,
    corporateLinkedinUrl: null,
    country: 'Guatemala',
    countryCode: 'GT',
    requestedCountryCode: 'GT',
    region: null,
    city: 'Guatemala',
    industry: 'Technology',
    subindustry: null,
    industryCodes: {},
    employeeCount: 80,
    employeeRange: null,
    sourceUrl: null,
    sourceConfidence: null,
    searchCriteria: {},
    warnings: [],
    issues: [],
    providerMetadataSafe: {},
    trace: { sourceProvider: 'apollo', providerRecordId: 'rec-gt-1', providerRequestId: 'req-gt-1', sourceUrl: null },
    ...overrides,
  };
}

function fake(rows: SnapshotNameRow[]) {
  const calls: string[] = [];
  return {
    calls,
    query: async (c: string) => {
      calls.push(c);
      return rows.filter((r) => r.normalizedLegalName === c);
    },
  };
}

function gtResolver(rows: SnapshotNameRow[]) {
  const f = fake(rows);
  const resolver = createSnapshotNameOfficialSourceResolver({
    countryCode: 'GT',
    sourceKey: 'gt_rgae_proveedores',
    taxIdentifierType: 'NIT',
    validTaxId: /^\d{4,12}K?$/,
    normalizeCore: core,
    querySnapshots: f.query,
  });
  return { resolver, calls: f.calls };
}

const GT: ProspectSearchCriteria = { countryCode: 'GT' };
const row = (taxId: string, legalName: string): SnapshotNameRow => ({
  taxId,
  legalName,
  normalizedLegalName: core(legalName),
});

describe('normalizeCompanyNameCore (Centroamérica)', () => {
  it('quita las formas de Guatemala y Honduras', () => {
    assert.equal(core('GRUPO WIT, SOCIEDAD ANONIMA'), 'GRUPO WIT');
    assert.equal(core('INVERSIONES MARROQUIN & LEAL, SOCIEDAD ANÓNIMA'), 'INVERSIONES MARROQUIN & LEAL');
    assert.equal(core('SERVICIOS E INVERSIONES ZOOM S. DE R.L.'), 'SERVICIOS E INVERSIONES ZOOM');
    assert.equal(core('GRUPO ACCESO S. A. DE C. V.'), 'GRUPO ACCESO');
    assert.equal(core('CONSTRUCTORA RAMIREZ S.A.'), 'CONSTRUCTORA RAMIREZ');
    assert.equal(core('Grupo Wit S.A.'), 'GRUPO WIT');
  });

  it('no deja nombres vacíos', () => {
    assert.equal(core('SA'), 'SA');
    assert.equal(core(''), '');
    assert.equal(core(null), '');
  });

  it('la versión SQL usa las mismas formas, en el mismo orden, tres veces', () => {
    const sql = buildCompanyNameCoreSql(CENTRAL_AMERICA_LEGAL_FORMS);
    assert.equal(sql.split(CENTRAL_AMERICA_LEGAL_FORMS.join('|')).length - 1, 3);
    assert.match(sql, /translate\(legal_name,/);
  });
});

describe('createSnapshotNameOfficialSourceResolver', () => {
  it('sólo intenta el país configurado', () => {
    const { resolver } = gtResolver([]);
    const policy = {
      minimumStrongMatchConfidence: 0.85,
      allowLowConfidenceAsSignal: true,
      unsupportedCountryMode: 'warning' as const,
      errorMode: 'fail_soft' as const,
    };
    assert.equal(resolver.countryCode, 'GT');
    assert.equal(resolver.canResolve({ candidate: makeCandidate(), criteria: GT, policy }), true);
    assert.equal(
      resolver.canResolve({ candidate: makeCandidate({ countryCode: 'HN' }), criteria: { countryCode: 'HN' }, policy }),
      false,
    );
  });

  it('un único NIT con el mismo núcleo → identidad FUERTE con el tipo configurado', async () => {
    const { resolver, calls } = gtResolver([row('68687125', 'OPIGRAFIK, SOCIEDAD ANONIMA')]);
    const identity = await enrichNormalizedProspectWithOfficialSources(makeCandidate(), GT, [resolver]);
    assert.deepEqual(calls, ['OPIGRAFIK']);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.officialSource.confidence, SNAPSHOT_NAME_EXACT_MATCH_CONFIDENCE);
    const columns = buildOfficialSourceTypedColumns(identity);
    assert.equal(columns.tax_identifier, '68687125');
    assert.equal(columns.tax_identifier_type, 'NIT');
  });

  it('dos números con el mismo núcleo → sólo señal', async () => {
    const { resolver } = gtResolver([
      row('68687125', 'OPIGRAFIK, SOCIEDAD ANONIMA'),
      row('4482328', 'OPIGRAFIK S.A.'),
    ]);
    const identity = await enrichNormalizedProspectWithOfficialSources(makeCandidate(), GT, [resolver]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'low_confidence_match');
    assert.equal(buildOfficialSourceTypedColumns(identity).tax_identifier, null);
  });

  it('descarta números con forma inválida y filas con otro núcleo', async () => {
    const { resolver } = gtResolver([
      row('12', 'OPIGRAFIK, SOCIEDAD ANONIMA'),
      { taxId: '68687125', legalName: 'OPIGRAFIK HOLDING', normalizedLegalName: 'OPIGRAFIK HOLDING' },
    ]);
    const identity = await enrichNormalizedProspectWithOfficialSources(makeCandidate(), GT, [resolver]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('una fila con otro núcleo se descarta aunque la lectura la devuelva', async () => {
    const resolver = createSnapshotNameOfficialSourceResolver({
      countryCode: 'GT',
      sourceKey: 'gt_rgae_proveedores',
      taxIdentifierType: 'NIT',
      validTaxId: /^\d{4,12}K?$/,
      normalizeCore: core,
      querySnapshots: async () => [row('68687125', 'OPIGRAFIK HOLDING, SOCIEDAD ANONIMA')],
    });
    const identity = await enrichNormalizedProspectWithOfficialSources(makeCandidate(), GT, [resolver]);
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'not_found');
  });

  it('acepta un NIT guatemalteco con K final', async () => {
    const { resolver } = gtResolver([row('1234567K', 'OPIGRAFIK, SOCIEDAD ANONIMA')]);
    const identity = await enrichNormalizedProspectWithOfficialSources(makeCandidate(), GT, [resolver]);
    assert.equal(identity.taxIdentifier, '1234567K');
  });

  it('un nombre genérico nunca consulta («Grupo Wit» se queda en «GRUPO»)', async () => {
    const wit = gtResolver([row('111321522', 'GRUPO WIT, SOCIEDAD ANONIMA')]);
    const witIdentity = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate({ canonicalName: 'Grupo Wit S.A.' }),
      GT,
      [wit.resolver],
    );
    assert.equal(wit.calls.length, 0);
    assert.equal(witIdentity.strongIdentityAvailable, false);
  });

  it('un nombre de una sola palabra genérica nunca consulta', async () => {
    const { resolver, calls } = gtResolver([row('111321522', 'GRUPO, SOCIEDAD ANONIMA')]);
    const identity = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate({ canonicalName: 'Grupo S.A.' }),
      GT,
      [resolver],
    );
    assert.equal(calls.length, 0);
    assert.equal(identity.strongIdentityAvailable, false);
  });

  it('Honduras: RTN de 14 dígitos con su propio tipo', async () => {
    const f = fake([row('08019016822561', 'GRUPO ACCESO S. A. DE C. V.')]);
    const resolver = createSnapshotNameOfficialSourceResolver({
      countryCode: 'HN',
      sourceKey: 'hn_contrataciones_abiertas',
      taxIdentifierType: 'RTN',
      validTaxId: /^\d{14}$/,
      normalizeCore: core,
      querySnapshots: f.query,
    });
    const identity = await enrichNormalizedProspectWithOfficialSources(
      makeCandidate({ canonicalName: 'Grupo Acceso', countryCode: 'HN', requestedCountryCode: 'HN' }),
      { countryCode: 'HN' },
      [resolver],
    );
    assert.equal(identity.taxIdentifier, '08019016822561');
    assert.equal(identity.taxIdentifierType, 'RTN');
  });
});

describe('SOURCES-EC-CLOSE-1 — largeCompanyStrongMinWorkers', () => {
  const big = { ...row('111321522', 'OPIGRAFIK, SOCIEDAD ANONIMA'), workforce: { workers: 900, year: 2025, source: 'x' } };
  const small = { ...big, workforce: { workers: 12, year: 2025, source: 'x' } };

  async function resolve(rows: SnapshotNameRow[], extra: Record<string, unknown>) {
    const f = fake(rows);
    const resolver = createSnapshotNameOfficialSourceResolver({
      countryCode: 'GT',
      sourceKey: 'gt_rgae_proveedores',
      taxIdentifierType: 'NIT',
      validTaxId: /^\d{4,12}K?$/,
      normalizeCore: core,
      querySnapshots: f.query,
      singleWordIsSignalOnly: true,
      ...extra,
    });
    return enrichNormalizedProspectWithOfficialSources(makeCandidate({ canonicalName: 'Opigrafik' }), GT, [resolver]);
  }

  it('sin la opción nada cambia: una palabra suelta es pista aunque la empresa sea grande', async () => {
    assert.equal((await resolve([big], {})).strongIdentityAvailable, false);
  });

  it('con la opción, una palabra suelta de UNA empresa grande es fuerte; de una pequeña, pista', async () => {
    assert.equal((await resolve([big], { largeCompanyStrongMinWorkers: 200 })).strongIdentityAvailable, true);
    assert.equal((await resolve([small], { largeCompanyStrongMinWorkers: 200 })).strongIdentityAvailable, false);
  });

  it('también levanta signalOnly, pero nunca con dos empresas posibles', async () => {
    assert.equal(
      (await resolve([big], { largeCompanyStrongMinWorkers: 200, signalOnly: true })).strongIdentityAvailable,
      true,
    );
    const other = { ...big, taxId: '222321522' };
    const two = await resolve([big, other], { largeCompanyStrongMinWorkers: 200 });
    assert.equal(two.strongIdentityAvailable, false);
  });
});
