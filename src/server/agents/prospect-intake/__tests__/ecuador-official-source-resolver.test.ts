/**
 * Ecuador name→RUC inside the Agent 1 run.
 *
 * SOURCES-EC-RUC-BY-NAME-1 (normalizer) · SOURCES-EC-CLOSE-1 (the chain:
 * SCVS registry with employees → its acronyms → SRI registry → SRI trade name →
 * July SCVS snapshot). Pure tests over a FAKE read-only client keyed by
 * `source_key`; any write blows up. No I/O, no DB, no providers. Names shaped
 * like real rows; RUCs synthetic (13 digits, 001).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildOfficialSourceEnrichmentMetadata,
  buildOfficialSourceTypedColumns,
  enrichNormalizedProspectWithOfficialSources,
} from '../source-enrichment';
import type { NormalizedProspectCandidate, ProspectSearchCriteria } from '../types';
import {
  EC_COMPANY_NAME_CORE_SQL,
  normalizeEcCompanyCore,
} from '@/server/source-catalog/connectors/ec-scvs/ec-company-name-core';
import { normalizeEcEntityCore } from '@/server/source-catalog/connectors/ec-scvs/ec-entity-name-core';
import { buildEcuadorOfficialSourceResolver } from '@/server/prospect-batches/ecuador-official-source-chain';
import { extractOfficialRegistryWorkforce } from '@/server/agents/prospecting-toolkit/employee-size-resolver';

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

type SnapshotRow = {
  source_key: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  source_year?: number;
  raw_data?: Record<string, unknown>;
};

function scvs(ruc: string, legalName: string, workers?: number): SnapshotRow {
  return {
    source_key: 'ec_scvs_registry',
    normalized_tax_id: ruc,
    legal_name: legalName,
    normalized_legal_name: normalizeEcCompanyCore(legalName),
    source_year: 2025,
    raw_data: workers === undefined ? {} : { workers, metrics_year: 2025 },
  };
}

/** Fake read-only client: answers `.eq('source_key')…eq('normalized_legal_name')`. */
function fakeClient(rows: SnapshotRow[]) {
  const asked: Array<[string, string]> = [];
  const client = {
    from(table: string) {
      assert.equal(table, 'source_company_snapshots');
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        limit: async () => {
          asked.push([filters.source_key, filters.normalized_legal_name]);
          assert.equal(filters.country_code, 'EC');
          return {
            data: rows.filter(
              (r) => r.source_key === filters.source_key && r.normalized_legal_name === filters.normalized_legal_name,
            ),
            error: null,
          };
        },
        insert: () => assert.fail('escritura prohibida'),
        update: () => assert.fail('escritura prohibida'),
        upsert: () => assert.fail('escritura prohibida'),
        delete: () => assert.fail('escritura prohibida'),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, asked };
}

async function enrich(candidate: NormalizedProspectCandidate, rows: SnapshotRow[]) {
  const { client, asked } = fakeClient(rows);
  const resolver = buildEcuadorOfficialSourceResolver(client);
  const identity = await enrichNormalizedProspectWithOfficialSources(candidate, EC_CRITERIA, [resolver]);
  return { identity, asked };
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
    assert.equal(EC_COMPANY_NAME_CORE_SQL.split('CIA LTDA|C LTDA').length - 1, 3);
    assert.match(EC_COMPANY_NAME_CORE_SQL, /\|B I C\|/);
    assert.doesNotMatch(EC_COMPANY_NAME_CORE_SQL, /LIQUIDACION/);
  });
});

describe('cadena de Ecuador (buildEcuadorOfficialSourceResolver)', () => {
  it('un único RUC en el registro → identidad FUERTE con columnas RUC y el tamaño oficial', async () => {
    const { identity, asked } = await enrich(makeCandidate(), [
      scvs('0992402008001', 'SISTEMAS AUDIOVISUALES LUMENS S.A.', 35),
    ]);
    assert.deepEqual(asked, [['ec_scvs_registry', 'SISTEMAS AUDIOVISUALES LUMENS']]);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '0992402008001');
    assert.equal(identity.taxIdentifierType, 'RUC');
    const columns = buildOfficialSourceTypedColumns(identity);
    assert.equal(columns.tax_identifier, '0992402008001');
    assert.equal(columns.legal_name, 'SISTEMAS AUDIOVISUALES LUMENS S.A.');
    // El gate ICP de tamaño lee los empleados (35 ⇒ pequeña) por el camino de Chile.
    const workforce = extractOfficialRegistryWorkforce({
      officialSourceIdentity: { strongIdentityAvailable: true, officialSourceMetadata: buildOfficialSourceEnrichmentMetadata(identity) },
    });
    assert.deepEqual(workforce && { workers: workforce.workers, year: workforce.year }, { workers: 35, year: 2025 });
  });

  it('la sigla de la razón social: «Conecel» de una compañía grande es FUERTE', async () => {
    const { identity, asked } = await enrich(makeCandidate({ canonicalName: 'Conecel' }), [
      { ...scvs('1791251237001', 'X', 3302), source_key: 'ec_scvs_alias_registry', normalized_legal_name: 'CONECEL' },
    ]);
    assert.deepEqual(asked.map(([source]) => source).slice(0, 2), ['ec_scvs_registry', 'ec_scvs_alias_registry']);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '1791251237001');
  });

  it('una palabra suelta de una compañía pequeña (o sin empleados) queda como pista, nunca fuerte', async () => {
    for (const workers of [12, undefined]) {
      const { identity } = await enrich(makeCandidate({ canonicalName: 'Movistar' }), [
        scvs('0991425756001', 'MOVISTAR S.A.', workers),
      ]);
      assert.equal(identity.strongIdentityAvailable, false, String(workers));
      assert.equal(identity.officialSource.status, 'low_confidence_match');
      assert.equal(buildOfficialSourceTypedColumns(identity).tax_identifier, null);
    }
  });

  it('una entidad pública del SRI se encuentra por su nombre de uso («Municipio de Celica»)', async () => {
    const legal = 'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON CELICA';
    const { identity, asked } = await enrich(makeCandidate({ canonicalName: 'Municipio de Celica' }), [
      {
        source_key: 'ec_sri_registry',
        normalized_tax_id: '1160000310001',
        legal_name: legal,
        normalized_legal_name: normalizeEcEntityCore(legal),
      },
    ]);
    assert.ok(asked.some(([source, core]) => source === 'ec_sri_registry' && core === 'GAD MUNICIPAL CELICA'));
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '1160000310001');
  });

  it('el nombre comercial es pista; sólo es fuerte si la empresa es grande', async () => {
    const trade = (workers?: number): SnapshotRow => ({
      source_key: 'ec_sri_trade_name_registry',
      normalized_tax_id: '1790016919001',
      legal_name: 'CORPORACION FAVORITA C.A.',
      normalized_legal_name: 'SUPERMAXI',
      source_year: 2025,
      raw_data: workers === undefined ? {} : { workers, metrics_year: 2025 },
    });
    const big = await enrich(makeCandidate({ canonicalName: 'Supermaxi' }), [trade(12033)]);
    assert.equal(big.identity.strongIdentityAvailable, true);
    assert.equal(big.identity.taxIdentifier, '1790016919001');
    const unknown = await enrich(makeCandidate({ canonicalName: 'Super Maxi Plus' }), [
      { ...trade(), normalized_legal_name: 'SUPER MAXI PLUS' },
    ]);
    assert.equal(unknown.identity.strongIdentityAvailable, false);
    assert.equal(unknown.identity.officialSource.status, 'low_confidence_match');
  });

  it('sin las fuentes nuevas cargadas, el snapshot de julio sigue resolviendo (palabra suelta: pista)', async () => {
    const legacy = (ruc: string, legalName: string): SnapshotRow => ({
      source_key: 'ec_scvs',
      normalized_tax_id: ruc,
      legal_name: legalName,
      normalized_legal_name: normalizeEcCompanyCore(legalName),
    });
    const strong = await enrich(makeCandidate(), [legacy('0992402008001', 'SISTEMAS AUDIOVISUALES LUMENS S.A.')]);
    assert.equal(strong.identity.strongIdentityAvailable, true);
    assert.deepEqual(
      strong.asked.map(([source]) => source),
      ['ec_scvs_registry', 'ec_scvs_alias_registry', 'ec_sri_registry', 'ec_sri_trade_name_registry', 'ec_scvs'],
    );
    const single = await enrich(makeCandidate({ canonicalName: 'Petroecuador' }), [
      legacy('0990295573001', 'PETROECUADOR S.A.'),
    ]);
    assert.equal(single.identity.strongIdentityAvailable, false);
  });

  it('dos RUC con el mismo núcleo → sólo señal; el mismo RUC repetido cuenta una vez', async () => {
    const two = await enrich(makeCandidate({ canonicalName: 'Inmobiliaria Verzam' }), [
      scvs('1790000001001', 'INMOBILIARIA VERZAM CIA. LTDA.'),
      scvs('1790000002001', 'INMOBILIARIA VERZAM S.A.'),
    ]);
    assert.equal(two.identity.strongIdentityAvailable, false);
    assert.equal(two.identity.officialSource.status, 'low_confidence_match');
    const repeated = await enrich(makeCandidate(), [
      scvs('0992402008001', 'SISTEMAS AUDIOVISUALES LUMENS S.A.'),
      scvs('0992402008001', 'SISTEMAS AUDIOVISUALES LUMENS SA'),
    ]);
    assert.equal(repeated.identity.strongIdentityAvailable, true);
  });

  it('descarta RUC que no son de sociedad y nombres demasiado genéricos', async () => {
    const bad = await enrich(makeCandidate(), [
      scvs('0992402008002', 'SISTEMAS AUDIOVISUALES LUMENS S.A.'),
      scvs('1712345678001', 'SISTEMAS AUDIOVISUALES LUMENS S.A.'), // persona natural
    ]);
    assert.equal(bad.identity.strongIdentityAvailable, false);
    const generic = await enrich(makeCandidate({ canonicalName: 'Grupo S.A.' }), [scvs('1790000001001', 'GRUPO SA')]);
    assert.equal(generic.asked.length, 0);
    assert.equal(generic.identity.strongIdentityAvailable, false);
  });

  it('sólo candidatos de Ecuador', async () => {
    const { asked, identity } = await enrich(makeCandidate({ countryCode: 'CO', requestedCountryCode: 'CO' }), [
      scvs('0992402008001', 'SISTEMAS AUDIOVISUALES LUMENS S.A.'),
    ]);
    assert.equal(asked.length, 0);
    assert.equal(identity.strongIdentityAvailable, false);
  });
});

// ── SOURCES-EC-NAME-MATCH-GAPS-1 (Prod 07-10, Ecuador × Salud) ──────────────────

describe('segundo intento sin «Ecuador» / «Ec» al final del nombre', () => {
  it('«Farmacias Cuxibamba Ecuador» → «FARMACIAS CUXIBAMBA» por la sigla de la razón social, FUERTE (1.204 empleados)', async () => {
    const { identity, asked } = await enrich(makeCandidate({ canonicalName: 'Farmacias Cuxibamba Ecuador' }), [
      {
        ...scvs('1191751422001', 'FARMACIAS CUXIBAMBA FARMACUX CIA. LTDA.', 1204),
        source_key: 'ec_scvs_alias_registry',
        normalized_legal_name: 'FARMACIAS CUXIBAMBA',
      },
    ]);
    assert.ok(asked.some(([s, core]) => s === 'ec_scvs_alias_registry' && core === 'FARMACIAS CUXIBAMBA'));
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '1191751422001');
  });

  it('una palabra suelta tras quitar el país sigue la regla de palabra suelta: pista si es pequeña', async () => {
    const { identity, asked } = await enrich(makeCandidate({ canonicalName: 'Dibeal Ecuador' }), [
      scvs('1790976343001', 'DIBEAL COMPAÑIA LIMITADA', 154),
    ]);
    assert.ok(asked.some(([s, core]) => s === 'ec_scvs_registry' && core === 'DIBEAL ECUADOR'));
    assert.ok(asked.some(([s, core]) => s === 'ec_scvs_registry' && core === 'DIBEAL'));
    assert.equal(identity.strongIdentityAvailable, false);
    assert.equal(identity.officialSource.status, 'low_confidence_match');
    assert.equal(identity.officialSource.taxIdentifier, '1790976343001');
  });

  it('…y fuerte si declara 200 o más empleados', async () => {
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Dibeal Ecuador' }), [
      scvs('1790976343001', 'DIBEAL COMPAÑIA LIMITADA', 420),
    ]);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '1790976343001');
  });

  it('si el nombre completo ya da un RUC seguro, no se pregunta de nuevo', async () => {
    const { identity, asked } = await enrich(makeCandidate({ canonicalName: 'Nestle Ecuador' }), [
      scvs('1790011674001', 'NESTLE ECUADOR S.A.', 1500),
    ]);
    assert.equal(identity.taxIdentifier, '1790011674001');
    assert.ok(!asked.some(([, core]) => core === 'NESTLE'));
  });

  it('el reintento nunca usa el snapshot de julio (mezcla compañías inactivas)', async () => {
    const { identity, asked } = await enrich(makeCandidate({ canonicalName: 'Movistar Ecuador' }), [
      { ...scvs('0991425756001', 'MOVISTAR S.A.', 12), source_key: 'ec_scvs' },
    ]);
    assert.ok(!asked.some(([s, core]) => s === 'ec_scvs' && core === 'MOVISTAR'));
    assert.equal(identity.officialSource.status === 'matched' && identity.strongIdentityAvailable, false);
  });

  it('un hospital público por su nombre corto («Hospital Pablo Arturo Suárez»)', async () => {
    const legal = 'HOSPITAL PROVINCIAL GENERAL PABLO ARTURO SUAREZ';
    const { identity } = await enrich(makeCandidate({ canonicalName: 'Hospital Pablo Arturo Suarez' }), [
      { source_key: 'ec_sri_registry', normalized_tax_id: '1768033550001', legal_name: legal, normalized_legal_name: normalizeEcEntityCore(legal) },
    ]);
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, '1768033550001');
  });
});
