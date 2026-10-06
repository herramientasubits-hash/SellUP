/**
 * SOURCES-DO-SIZE-SIGNAL-1 — señal de tamaño y nombre comercial de República
 * Dominicana: lectura de las listas de Grandes Contribuyentes de la DGII, armado
 * de las dos fuentes que se cargan y la pista por nombre comercial en la corrida.
 *
 * Cero E/S. RNC y nombres sintéticos; los textos de actividad y las etiquetas
 * son los que guardan la DGII y la DGCP de verdad.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  mergeDgiiLargeTaxpayerLists,
  parseDgiiLargeTaxpayerListHtml,
} from '../do-large-taxpayer-list';
import {
  buildDoSizeRegistryRows,
  buildDoTradeNameRegistryRows,
  classifyDgcpMipyme,
  DO_DGII_SIZE_REGISTRY_SOURCE_KEY,
  DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY,
  doSizePriorityScore,
  resolveDoSizeTier,
  type DoPadronRow,
  type DoProcurementSummary,
} from '../do-size-registry-rows';
import { DO_DGII_MACRO_TABLE_VERSION } from '@/server/prospect-batches/country-source-discovery/do-dgii-macro-table';
import { createDominicanOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/dominican-republic-official-source-resolver';
import { normalizeDominicanCompanyCore } from '@/server/agents/prospect-intake/resolvers/dominican-republic-official-source-resolver';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import { createFallbackOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/fallback-official-source-resolver';
import {
  DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY,
  enrichNormalizedProspectWithOfficialSources,
} from '@/server/agents/prospect-intake/source-enrichment';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';
import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';

const TECH = 'ACTIVIDADES DE INFORMÁTICA N.C';
const HEALTH = 'FABRICACIÓN DE MEDICAMENTOS DE';
const AMBIGUOUS = 'FABRICACIÓN DE PRODUCTOS DE LA';
const NO_MACRO = 'ACTIVIDADES DE ARTISTAS INDIVI';

const NACIONALES_HTML = `
<table>
  <tr><th>RNC</th><th>Raz&oacute;n Social</th></tr>
  <tr>
    <td>
      101000001
    </td>
    <td>  ALFA DOMINICANA S A </td>
    <td>15 de enero 2024</td><td>&#10004;</td>
  </tr>
  <tr><td>101000002</td><td>BETA &amp; ASOCIADOS SRL</td><td>15 de mayo 2024</td></tr>
  <tr><td>101000002</td><td>BETA REPETIDA SRL</td></tr>
  <tr><td>12345</td><td>RNC CORTO</td></tr>
</table>`;

const LOCALES_HTML = `
<table>
<tr><th>RNC</th><th>Raz&oacute;n Social</th><th>Clasificaci&oacute;n </th><th>Plazo</th><th>Autorizados</th></tr>
<tr><td>101000002</td><td>BETA &amp; ASOCIADOS SRL</td><td>Grande Local</td><td>15-05-2025</td><td>SI</td></tr>
<tr><td>101000003</td><td>GAMMA SRL</td><td>Grande Local</td><td>15-05-2025</td><td>SI</td></tr>
<tr><td>101000004</td><td>DELTA SRL</td><td>Mediana</td><td>15-11-2025</td><td>NO</td></tr>
<tr><td>00107182156</td><td>PERSONA FISICA</td><td>Mediana</td><td>15-11-2025</td><td>NO</td></tr>
<tr><td>101000005</td><td>EPSILON SRL</td><td>Pequeña</td><td>15-11-2025</td><td>NO</td></tr>
</table>`;

describe('listas de Grandes Contribuyentes de la DGII', () => {
  it('nacionales: todas son gran_nacional; limpia espacios, decodifica y no repite RNC', () => {
    const list = parseDgiiLargeTaxpayerListHtml(NACIONALES_HTML, 'nacionales');
    assert.deepEqual(list, [
      { rnc: '101000001', legalName: 'ALFA DOMINICANA S A', dgiiClass: 'gran_nacional' },
      { rnc: '101000002', legalName: 'BETA & ASOCIADOS SRL', dgiiClass: 'gran_nacional' },
    ]);
  });

  it('locales y medianos: sólo RNC de empresa y sólo las dos clases publicadas', () => {
    const list = parseDgiiLargeTaxpayerListHtml(LOCALES_HTML, 'locales_medianos');
    assert.deepEqual(
      list.map((e) => [e.rnc, e.dgiiClass]),
      [
        ['101000002', 'gran_local'],
        ['101000003', 'gran_local'],
        ['101000004', 'mediana'],
      ],
      'la cédula de 11 dígitos (persona física) y la clase desconocida quedan fuera',
    );
  });

  it('al unir las listas gana la clase mayor', () => {
    const merged = mergeDgiiLargeTaxpayerLists(
      parseDgiiLargeTaxpayerListHtml(LOCALES_HTML, 'locales_medianos'),
      parseDgiiLargeTaxpayerListHtml(NACIONALES_HTML, 'nacionales'),
    );
    assert.equal(merged.size, 4);
    assert.equal(merged.get('101000002')?.dgiiClass, 'gran_nacional');
    assert.equal(merged.get('101000004')?.dgiiClass, 'mediana');
  });

  it('una página sin tabla no da filas', () => {
    assert.deepEqual(parseDgiiLargeTaxpayerListHtml('<html>Error 500</html>', 'nacionales'), []);
  });
});

describe('nivel de tamaño', () => {
  it('reduce las etiquetas reales de la DGCP', () => {
    assert.equal(classifyDgcpMipyme('Micro empresa'), 'micro_pequena');
    assert.equal(classifyDgcpMipyme('MIPYME Mujer - Pequeña empresa'), 'micro_pequena');
    assert.equal(classifyDgcpMipyme('MIPYME Mujer - Mediana empresa'), 'mediana');
    assert.equal(classifyDgcpMipyme('Mediana empresa'), 'mediana');
    assert.equal(classifyDgcpMipyme('Gran empresa'), 'gran');
    assert.equal(classifyDgcpMipyme('No clasificada'), 'sin_clasificar');
    assert.equal(classifyDgcpMipyme(null), 'sin_clasificar');
  });

  it('la DGII manda; la DGCP decide sólo si la DGII no lista a la empresa', () => {
    const gc = (dgiiClass: 'gran_nacional' | 'gran_local' | 'mediana') => ({ rnc: 'x', legalName: 'x', dgiiClass });
    const dgcp = (mipymeClass: string | null): DoProcurementSummary => ({ awardedTotalDop: 1, mipymeClass });
    assert.equal(resolveDoSizeTier(gc('gran_nacional'), dgcp('Micro empresa')), 1);
    assert.equal(resolveDoSizeTier(gc('gran_local'), undefined), 2);
    assert.equal(resolveDoSizeTier(gc('mediana'), dgcp('Gran empresa')), 3);
    assert.equal(resolveDoSizeTier(undefined, dgcp('Gran empresa')), 2);
    assert.equal(resolveDoSizeTier(undefined, dgcp('Mediana empresa')), 3);
    assert.equal(resolveDoSizeTier(undefined, dgcp('No clasificada')), 4);
    assert.equal(resolveDoSizeTier(undefined, dgcp(null)), 4);
    assert.equal(resolveDoSizeTier(undefined, dgcp('Micro empresa')), null);
    assert.equal(resolveDoSizeTier(undefined, dgcp('Pequeña empresa')), null);
    assert.equal(resolveDoSizeTier(undefined, undefined), null);
  });

  it('el nivel manda en el orden; dentro del nivel, el importe', () => {
    assert.ok(doSizePriorityScore(1, 0) > doSizePriorityScore(2, 1e12));
    assert.ok(doSizePriorityScore(3, 5e6) > doSizePriorityScore(3, 1e6));
    assert.equal(doSizePriorityScore(4, 0), 100);
    assert.equal(doSizePriorityScore(4, Number.NaN), 100);
    assert.ok(doSizePriorityScore(4, 1e15) < 200);
  });
});

function padron(rnc: string, sector: string | null, overrides: Partial<DoPadronRow> = {}): DoPadronRow {
  return { rnc, legalName: `EMPRESA ${rnc} SRL`, tradeName: null, sector, isActive: true, ...overrides };
}

describe('buildDoSizeRegistryRows', () => {
  const largeTaxpayers = mergeDgiiLargeTaxpayerLists(
    parseDgiiLargeTaxpayerListHtml(NACIONALES_HTML, 'nacionales'),
    parseDgiiLargeTaxpayerListHtml(LOCALES_HTML, 'locales_medianos'),
  );
  const procurement = new Map<string, DoProcurementSummary>([
    ['101000004', { awardedTotalDop: 9e6, mipymeClass: 'Micro empresa' }],
    ['102000001', { awardedTotalDop: 5e6, mipymeClass: 'No clasificada' }],
    ['102000002', { awardedTotalDop: 7e6, mipymeClass: 'Pequeña empresa' }],
    ['102000003', { awardedTotalDop: 1e6, mipymeClass: 'MIPYME Mujer - Mediana empresa' }],
  ]);

  const rows = buildDoSizeRegistryRows({
    padron: [
      padron('102000001', TECH),
      padron('101000001', HEALTH, { tradeName: ' ALFA ' }),
      padron('101000002', TECH, { isActive: false }),
      padron('101000003', NO_MACRO),
      padron('101000004', TECH),
      padron('102000002', TECH),
      padron('102000003', AMBIGUOUS),
      padron('102000004', TECH),
      padron('1020000', TECH),
      padron('101000001', TECH),
    ],
    largeTaxpayers,
    procurement,
    sourceYear: 2026,
    importedAt: '2026-10-05T00:00:00.000Z',
  });

  it('sólo activas, con macro de la tabla de hoy y con señal de tamaño', () => {
    assert.deepEqual(
      rows.map((r) => [r.normalized_tax_id, r.signals.size_tier]),
      [
        ['101000001', 1],
        ['101000004', 3],
        ['102000001', 4],
      ],
    );
    // 101000002 inactiva · 101000003 sin macro · 102000002 pequeña sin lista DGII ·
    // 102000003 texto ambiguo · 102000004 sin señal · 1020000 RNC inválido · RNC repetido.
  });

  it('la DGII rescata a una «Micro empresa» de la DGCP que ella lista como mediana', () => {
    const delta = rows.find((r) => r.normalized_tax_id === '101000004');
    assert.equal(delta?.raw_data.dgii_size_class, 'mediana');
    assert.equal(delta?.raw_data.dgcp_mipyme_class, 'Micro empresa');
  });

  it('cada fila lleva lo que la lectura y la revisión necesitan', () => {
    const alfa = rows.find((r) => r.normalized_tax_id === '101000001');
    assert.ok(alfa);
    assert.equal(alfa.source_key, DO_DGII_SIZE_REGISTRY_SOURCE_KEY);
    assert.equal(alfa.country_code, 'DO');
    assert.equal(alfa.sector, HEALTH);
    assert.equal(alfa.legal_name, 'EMPRESA 101000001 SRL');
    assert.equal(alfa.normalized_legal_name, 'EMPRESA 101000001');
    assert.equal(alfa.priority_score, doSizePriorityScore(1, 0));
    assert.equal(alfa.raw_data.macro_industry_key, 'health_pharma');
    assert.equal(alfa.raw_data.macro_table_version, DO_DGII_MACRO_TABLE_VERSION);
    assert.equal(alfa.raw_data.trade_name, 'ALFA');
    assert.equal(alfa.raw_data.is_state_supplier, false);
    assert.equal(alfa.raw_data.size_tier, 1);
    assert.ok(alfa.record_identity_key);

    const prov = rows.find((r) => r.normalized_tax_id === '102000001');
    assert.equal(prov?.raw_data.is_state_supplier, true);
    assert.equal(prov?.signals.awarded_total_dop, 5e6);
  });
});

describe('buildDoTradeNameRegistryRows', () => {
  const rows = buildDoTradeNameRegistryRows({
    padron: [
      padron('103000001', TECH, { legalName: 'COMPANIA DOMINICANA DE TELEFONOS S A', tradeName: 'CODETEL' }),
      padron('103000002', TECH, { legalName: 'PLAZA LAMA S A', tradeName: 'PLAZA LAMA' }),
      padron('103000003', TECH, { legalName: 'XYZ SRL', tradeName: 'AB' }),
      padron('103000004', TECH, { legalName: 'INACTIVA SRL', tradeName: 'MARCA INACTIVA', isActive: false }),
      padron('103000005', TECH, { legalName: 'SIN COMERCIAL SRL', tradeName: '   ' }),
      padron('103000006', TECH, { legalName: 'SALDENT INTERNACIONAL DIVISION FARMACIA S R L', tradeName: 'SIDPHARMA S.R.L.' }),
    ],
    sourceYear: 2026,
    importedAt: '2026-10-05T00:00:00.000Z',
  });

  it('una fila por empresa activa cuyo nombre comercial tiene otro núcleo', () => {
    assert.deepEqual(
      rows.map((r) => [r.normalized_tax_id, r.normalized_legal_name, r.legal_name]),
      [
        ['103000001', 'CODETEL', 'COMPANIA DOMINICANA DE TELEFONOS S A'],
        ['103000006', 'SIDPHARMA', 'SALDENT INTERNACIONAL DIVISION FARMACIA S R L'],
      ],
    );
    assert.equal(rows[0].source_key, DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY);
    assert.equal(rows[0].raw_data.trade_name, 'CODETEL');
  });
});

function candidate(name: string): NormalizedProspectCandidate {
  return {
    sourceProvider: 'apollo',
    providerRecordId: 'rec-do-1',
    providerRequestId: 'req-do-1',
    canonicalName: name,
    normalizedName: name.toLowerCase(),
    commercialName: name,
    legalName: null,
    websiteUrl: null,
    domain: null,
    corporateLinkedinUrl: null,
    country: 'República Dominicana',
    countryCode: 'DO',
    requestedCountryCode: 'DO',
    region: null,
    city: null,
    industry: 'Technology',
    subindustry: null,
    industryCodes: {},
    employeeCount: null,
    employeeRange: null,
    sourceUrl: null,
    sourceConfidence: null,
    searchCriteria: {},
    warnings: [],
    issues: [],
    providerMetadataSafe: {},
    trace: { sourceProvider: 'apollo', providerRecordId: 'rec-do-1', providerRequestId: 'req-do-1', sourceUrl: null },
  };
}

/** El mismo combinador que la factoría: razón social → nombre comercial (sólo pista). */
function doResolver(legalRows: { rnc: string; name: string; active?: boolean }[], tradeRows: { rnc: string; trade: string; legal: string }[]) {
  const tradeCalls: string[] = [];
  const resolver = createFallbackOfficialSourceResolver(
    createDominicanOfficialSourceResolver({
      querySnapshots: async (names) =>
        legalRows
          .filter((r) => names.includes(r.name))
          .map((r) => ({
            rnc: r.rnc,
            legalName: r.name,
            normalizedLegalName: r.name,
            taxpayerStatus: 'ACTIVO',
            isActiveTaxpayer: r.active !== false,
          })),
    }),
    createSnapshotNameOfficialSourceResolver({
      countryCode: 'DO',
      sourceKey: DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY,
      taxIdentifierType: 'RNC',
      validTaxId: /^\d{9}$/,
      normalizeCore: (name) => normalizeDominicanCompanyCore(name ?? ''),
      querySnapshots: async (core) => {
        tradeCalls.push(core);
        return tradeRows
          .filter((r) => normalizeDominicanCompanyCore(r.trade) === core)
          .map((r) => ({ taxId: r.rnc, legalName: r.legal, normalizedLegalName: normalizeDominicanCompanyCore(r.trade) }));
      },
      signalOnly: true,
    }),
  );
  return { resolver, tradeCalls };
}

describe('RNC por nombre comercial (sólo pista)', () => {
  it('si la razón social no aparece, el nombre comercial único deja una PISTA, nunca un RNC seguro', async () => {
    const { resolver } = doResolver([], [{ rnc: '101001577', trade: 'CODETEL', legal: 'COMPANIA DOMINICANA DE TELEFONOS S A' }]);
    const result = await resolver.resolve({ candidate: candidate('Codetel'), criteria: { countryCode: 'DO' }, policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY });
    assert.equal(result.status, 'low_confidence_match');
    assert.equal(result.sourceKey, DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY);
    assert.equal(result.taxIdentifier, '101001577');
    assert.equal(result.taxIdentifierType, 'RNC');
    assert.equal(result.legalName, 'COMPANIA DOMINICANA DE TELEFONOS S A');
    assert.deepEqual(result.safeMetadata, { normalizedSearchName: 'CODETEL', signalOnlySource: true });

    const identity = await enrichNormalizedProspectWithOfficialSources(candidate('Codetel'), { countryCode: 'DO' }, [resolver]);
    assert.equal(identity.strongIdentityAvailable, false, 'una pista no llena la identidad fuerte');
  });

  it('la razón social única sigue ganando y el nombre comercial ni se consulta', async () => {
    const { resolver, tradeCalls } = doResolver(
      [{ rnc: '131000001', name: 'CODETEL SRL' }],
      [{ rnc: '101001577', trade: 'CODETEL', legal: 'COMPANIA DOMINICANA DE TELEFONOS S A' }],
    );
    const result = await resolver.resolve({ candidate: candidate('Codetel SRL'), criteria: { countryCode: 'DO' }, policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY });
    assert.equal(result.status, 'matched');
    assert.equal(result.taxIdentifier, '131000001');
    assert.deepEqual(tradeCalls, []);
  });

  it('dos empresas con el mismo nombre comercial: pista ambigua', async () => {
    const { resolver } = doResolver(
      [],
      [
        { rnc: '101000011', trade: 'LA SIRENA', legal: 'GRUPO RAMOS S A' },
        { rnc: '101000012', trade: 'LA SIRENA', legal: 'OTRA EMPRESA SRL' },
      ],
    );
    const result = await resolver.resolve({ candidate: candidate('La Sirena'), criteria: { countryCode: 'DO' }, policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY });
    assert.equal(result.status, 'low_confidence_match');
    assert.equal((result.safeMetadata as Record<string, unknown>).ambiguous, true);
  });

  it('sin razón social ni nombre comercial: no encontrado', async () => {
    const { resolver } = doResolver([], []);
    const result = await resolver.resolve({ candidate: candidate('Nadie Conocido'), criteria: { countryCode: 'DO' }, policy: DEFAULT_OFFICIAL_SOURCE_ENRICHMENT_POLICY });
    assert.equal(result.status, 'not_found');
  });
});

describe('Catálogo de fuentes', () => {
  const entries = [
    { key: DO_DGII_SIZE_REGISTRY_SOURCE_KEY, status: 'connected_free_discovery' },
    { key: DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY, status: 'connected_identity_in_run' },
  ] as const;

  for (const { key, status } of entries) {
    it(`${key}: RD, ${status}, snapshot de sólo lectura, sin «connected» y fuera de las recomendaciones`, () => {
      const source = CATALOG_SOURCES.find((s) => s.key === key);
      assert.ok(source, key);
      assert.deepEqual(source.countryCodes, ['DO']);
      assert.equal(source.aiFlowStatus, status);
      assert.equal(source.connectionMode, 'read_only_snapshot');
      assert.equal(source.operationalStatus, 'pending_validation', 'hasta que la carga esté hecha y verificada');
      assert.deepEqual(source.sectors, []);
      assert.ok((source.limitations ?? []).length > 0);
      for (const depth of ['basic', 'standard', 'deep'] as const) {
        const ctx = getCatalogContext({ country: 'DO', countryCode: 'DO', industry: 'technology', searchDepth: depth });
        assert.equal(ctx.recommendedSources.some((r) => r.key === key), false, `${key} ${depth}`);
      }
    });
  }
});

describe('guardas estáticas', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

  it('los armadores de filas y el lector de listas son puros', () => {
    for (const file of ['do-large-taxpayer-list.ts', 'do-size-registry-rows.ts']) {
      const code = read(`src/server/source-catalog/connectors/dgii-rd/${file}`);
      assert.doesNotMatch(code, /supabase|process\.env|\bfetch\s*\(|readFileSync|Date\.now|new Date\(/i, file);
    }
  });

  it('la factoría conecta el nombre comercial como respaldo SÓLO-PISTA del padrón DGII', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(
      wiring,
      /createFallbackOfficialSourceResolver\(\s*createDominicanOfficialSourceResolver\(\{[\s\S]*?sourceKey:\s*DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY[\s\S]*?signalOnly:\s*true/,
    );
  });

  it('el cargador sólo escribe sus dos fuentes y por defecto no escribe', () => {
    const etl = read('scripts/source-catalog/run-do-size-registry-etl.ts');
    assert.match(etl, /const apply = argv\.includes\('--apply'\)/);
    assert.match(etl, /assertLargeImportAllowed\(/);
    const upserts = etl.match(/\.upsert\(/g) ?? [];
    assert.equal(upserts.length, 1, 'un único punto de escritura');
    assert.doesNotMatch(etl, /\.(delete|update|insert|rpc)\s*\(/);
  });
});
