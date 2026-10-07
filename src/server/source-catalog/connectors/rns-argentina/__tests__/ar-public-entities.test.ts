/**
 * SOURCES-AR-PUBLIC-ENTITIES-1 — directorio de entidades públicas de Argentina:
 * filas de `ar_public_entities`, buscador gratuito de Gobierno y CUIT por nombre.
 * Puro, sin E/S: lecturas y consultas dobles. CUIT con dígito verificador válido;
 * nombres con la forma real de las fuentes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  AR_PUBLIC_ENTITIES_SOURCE_KEY,
  AR_PUBLIC_ENTITIES_TABLE_VERSION,
  AR_PUBLIC_ENTITY_UNSIZED_PRIORITY,
  arPublicEntityDomain,
  buildArPublicEntityRows,
  normalizeArPublicEntityCore,
  type ArPublicEntityCsvRow,
} from '../ar-public-entities';
import { SOURCE_FAMILY_BY_SOURCE_KEY } from '@/server/source-catalog/record-identity/source-family-registry';
import {
  buildArRnsDiscoveryAdapter,
  type ArRnsSnapshotReadRow,
} from '@/server/prospect-batches/country-source-discovery/ar-rns-discovery-adapter';
import { buildArRnsDiscoveryReads } from '@/server/prospect-batches/country-source-discovery/ar-rns-snapshot-query';
import { enrichNormalizedProspectWithOfficialSources } from '@/server/agents/prospect-intake/source-enrichment';
import type { NormalizedProspectCandidate } from '@/server/agents/prospect-intake/types';
import {
  createSnapshotNameOfficialSourceResolver,
  type SnapshotNameRow,
} from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';

const CUIT_A = '30999000017';
const CUIT_B = '30999000025';
const CUIT_C = '30999000033';
const CUIT_D = '30999000041';

function csv(overrides: Partial<ArPublicEntityCsvRow> = {}): ArPublicEntityCsvRow {
  return {
    cuit: CUIT_A,
    name: 'MUNICIPALIDAD DE GENERAL PUEYRREDON',
    entity_type: 'municipality',
    province: 'Buenos Aires',
    website: 'https://www.mardelplata.gob.ar/',
    size: '667082',
    size_kind: 'population_2022',
    match: 'truncated',
    ...overrides,
  };
}

describe('normalizeArPublicEntityCore', () => {
  it('«Municipalidad de», «Municipio de» y «del Partido de» dan la MISMA forma', () => {
    const expected = 'MUNICIPALIDAD LA PLATA';
    assert.equal(normalizeArPublicEntityCore('Municipalidad de La Plata'), expected);
    assert.equal(normalizeArPublicEntityCore('Municipio de La Plata'), expected);
    assert.equal(normalizeArPublicEntityCore('MUNICIPALIDAD DEL PARTIDO DE LA PLATA'), expected);
  });

  it('quita la sigla entre paréntesis y no convierte un nombre suelto en municipio', () => {
    assert.equal(
      normalizeArPublicEntityCore('Administración Nacional de la Seguridad Social (ANSES)'),
      normalizeArPublicEntityCore('ADMINISTRACION NACIONAL DE LA SEGURIDAD SOCIAL'),
    );
    assert.equal(normalizeArPublicEntityCore('La Plata'), 'LA PLATA');
    assert.equal(normalizeArPublicEntityCore(null), '');
  });
});

describe('arPublicEntityDomain', () => {
  it('deja el host sin esquema, ruta ni «www.»', () => {
    assert.equal(arPublicEntityDomain('https://www.mardelplata.gob.ar/inicio'), 'mardelplata.gob.ar');
    assert.equal(arPublicEntityDomain('uba.ar'), 'uba.ar');
  });

  it('nunca un dominio compartido ni uno sin forma', () => {
    assert.equal(arPublicEntityDomain('https://www.argentina.gob.ar/anses'), null);
    assert.equal(arPublicEntityDomain('facebook.com/municipio'), null);
    assert.equal(arPublicEntityDomain('no es web'), null);
    assert.equal(arPublicEntityDomain(''), null);
  });
});

describe('buildArPublicEntityRows', () => {
  it('arma la fila: CUIT, núcleo para buscar, web, tamaño y macro Gobierno', () => {
    const [row] = buildArPublicEntityRows([csv()], 'T');
    assert.equal(row.source_key, AR_PUBLIC_ENTITIES_SOURCE_KEY);
    assert.equal(row.normalized_tax_id, CUIT_A);
    assert.equal(row.normalized_legal_name, 'MUNICIPALIDAD GENERAL PUEYRREDON');
    assert.equal(row.sector, 'Gobierno municipal');
    assert.equal(row.region, 'Buenos Aires');
    assert.equal(row.raw_data['website_domain'], 'mardelplata.gob.ar');
    assert.equal(row.raw_data['macro_industry_key'], 'government');
    assert.equal(row.raw_data['macro_table_version'], AR_PUBLIC_ENTITIES_TABLE_VERSION);
    assert.equal(row.raw_data['tax_identifier_type'], 'CUIT');
    assert.equal(row.signals['size'], 667082);
    assert.ok(row.record_identity_key);
  });

  it('descarta CUIT inválida o de persona humana, tipo desconocido, sin nombre y CUIT repetida', () => {
    const rows = buildArPublicEntityRows(
      [
        csv(),
        csv({ cuit: '30999000018' }),
        csv({ cuit: '20333449588' }),
        csv({ cuit: CUIT_B, entity_type: 'company' }),
        csv({ cuit: CUIT_C, name: '  ' }),
        csv({ name: 'OTRA CON LA MISMA CUIT' }),
      ],
      'T',
    );
    assert.deepEqual(rows.map((r) => r.legal_name), ['MUNICIPALIDAD DE GENERAL PUEYRREDON']);
  });

  it('el puntaje es el percentil DENTRO de su tipo; sin tamaño, el fijo', () => {
    const rows = buildArPublicEntityRows(
      [
        csv({ cuit: CUIT_A, size: '50000' }),
        csv({ cuit: CUIT_B, size: '900000' }),
        csv({ cuit: CUIT_C, entity_type: 'national_entity', name: 'INSTITUTO NACIONAL X', size: '300', size_kind: 'employees' }),
        csv({ cuit: CUIT_D, entity_type: 'university', name: 'UNIVERSIDAD NACIONAL X', size: '' }),
      ],
      'T',
    );
    const score = new Map(rows.map((r) => [r.normalized_tax_id, r.priority_score]));
    assert.equal(score.get(CUIT_A), 0);
    assert.equal(score.get(CUIT_B), 100);
    assert.equal(score.get(CUIT_C), 0, 'un solo organismo: no se compara con la población de los municipios');
    assert.equal(score.get(CUIT_D), AR_PUBLIC_ENTITY_UNSIZED_PRIORITY);
  });

  it('nunca guarda datos de personas: sólo las columnas del directorio', () => {
    const [row] = buildArPublicEntityRows([{ ...csv(), ...({ email: 'x@y.com', dni: '1' } as object) }], 'T');
    assert.doesNotMatch(JSON.stringify(row), /x@y\.com|dni/);
  });
});

function publicRow(n: number, overrides: Partial<ArRnsSnapshotReadRow> = {}): ArRnsSnapshotReadRow {
  const cuits = [CUIT_A, CUIT_B, CUIT_C, CUIT_D];
  return {
    origin: 'public_entity',
    record_identity_key: `tax:${cuits[n]}`,
    cuit: cuits[n],
    legal_name: `MUNICIPALIDAD DE CIUDAD ${n}`,
    normalized_legal_name: `MUNICIPALIDAD CIUDAD ${n}`,
    sector: 'Gobierno municipal',
    city: null,
    region: 'Buenos Aires',
    activity_code: null,
    priority_score: 90 - n,
    website_domain: `ciudad${n}.gob.ar`,
    ...overrides,
  };
}

describe('buscador gratuito de Gobierno', () => {
  it('ofrece las entidades públicas con CUIT, web y la versión del directorio', async () => {
    const adapter = buildArRnsDiscoveryAdapter({
      readCompaniesByMacro: async () => [publicRow(0), publicRow(1)],
    });
    const result = await adapter({ countryCode: 'AR', macroIndustryKey: 'government', limit: 10 } as never);
    assert.deepEqual(result.companies.map((c) => [c.taxId, c.domain]), [
      [CUIT_A, 'ciudad0.gob.ar'],
      [CUIT_B, 'ciudad1.gob.ar'],
    ]);
    assert.equal(result.companies[0].industryCode, null);
    assert.equal(result.companies[0].officialMacroIndustry?.tableVersion, AR_PUBLIC_ENTITIES_TABLE_VERSION);
  });

  it('una entidad pública nunca se ofrece fuera de Gobierno, y lo ya visto no se repite', async () => {
    const adapter = buildArRnsDiscoveryAdapter({
      readCompaniesByMacro: async () => [publicRow(0), publicRow(1, { prior_sighting: 'candidate' })],
    });
    const tech = await adapter({ countryCode: 'AR', macroIndustryKey: 'technology', limit: 10 } as never);
    assert.equal(tech.companies.length, 0);
    const gov = await adapter({ countryCode: 'AR', macroIndustryKey: 'government', limit: 10 } as never);
    assert.deepEqual(gov.companies.map((c) => c.taxId), [CUIT_A]);
  });

  it('la lectura de Gobierno consulta SÓLO ar_public_entities; las demás macros, las sociedades', async () => {
    const eqs: unknown[][] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'select', 'order']) builder[method] = () => builder;
    builder.eq = (...args: unknown[]) => {
      eqs.push(args);
      return builder;
    };
    builder.limit = () => Promise.resolve({ data: [], error: null });
    builder.in = () => Promise.resolve({ data: [], error: null });
    for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
      builder[write] = () => {
        throw new Error(`escritura prohibida: ${write}`);
      };
    }
    const reads = buildArRnsDiscoveryReads(builder as unknown as SupabaseClient);
    await reads.readCompaniesByMacro({ macroIndustryKey: 'government', limit: 10 });
    const govSources = eqs.filter((a) => a[0] === 'source_key').map((a) => a[1]);
    assert.deepEqual(govSources, ['ar_public_entities']);
    eqs.length = 0;
    await reads.readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(eqs.filter((a) => a[0] === 'source_key').map((a) => a[1]), ['ar_rns', 'ar_atp_employers']);
  });
});

function candidate(name: string): NormalizedProspectCandidate {
  return {
    sourceProvider: 'apollo',
    providerRecordId: 'rec-ar-1',
    providerRequestId: 'req-ar-1',
    canonicalName: name,
    normalizedName: name.toLowerCase(),
    commercialName: name,
    legalName: null,
    websiteUrl: null,
    domain: null,
    corporateLinkedinUrl: null,
    country: 'Argentina',
    countryCode: 'AR',
    requestedCountryCode: 'AR',
    region: null,
    city: null,
    industry: 'Government Administration',
    subindustry: null,
    industryCodes: {},
    employeeCount: 3000,
    employeeRange: null,
    sourceUrl: null,
    sourceConfidence: null,
    searchCriteria: {},
    warnings: [],
    issues: [],
    providerMetadataSafe: {},
    trace: { sourceProvider: 'apollo', providerRecordId: 'rec-ar-1', providerRequestId: 'req-ar-1', sourceUrl: null },
  };
}

describe('CUIT por nombre en el directorio (respaldo del registro de sociedades)', () => {
  const rows: SnapshotNameRow[] = buildArPublicEntityRows([csv()], 'T').map((r) => ({
    taxId: r.normalized_tax_id,
    legalName: r.legal_name,
    normalizedLegalName: r.normalized_legal_name,
  }));
  const resolver = createSnapshotNameOfficialSourceResolver({
    countryCode: 'AR',
    sourceKey: AR_PUBLIC_ENTITIES_SOURCE_KEY,
    taxIdentifierType: 'CUIT',
    validTaxId: /^(30|33|34)\d{9}$/,
    normalizeCore: normalizeArPublicEntityCore,
    querySnapshots: async (core) => rows.filter((r) => r.normalizedLegalName === core),
    singleWordIsSignalOnly: true,
  });

  it('«Municipio de General Pueyrredón» encuentra la CUIT de la Municipalidad', async () => {
    const identity = await enrichNormalizedProspectWithOfficialSources(
      candidate('Municipio de General Pueyrredón'),
      { countryCode: 'AR' },
      [resolver],
    );
    assert.equal(identity.strongIdentityAvailable, true);
    assert.equal(identity.taxIdentifier, CUIT_A);
  });

  it('un nombre suelto sin «Municipalidad» no se adivina', async () => {
    const identity = await enrichNormalizedProspectWithOfficialSources(
      candidate('General Pueyrredón'),
      { countryCode: 'AR' },
      [resolver],
    );
    assert.equal(identity.strongIdentityAvailable, false);
  });
});

describe('guardas', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

  it('la fuente es de grano fiscal (un CUIT, una fila)', () => {
    assert.equal(SOURCE_FAMILY_BY_SOURCE_KEY[AR_PUBLIC_ENTITIES_SOURCE_KEY], 'TAX_GRAIN');
  });

  it('el módulo es puro: sin env, red ni base de datos', () => {
    const code = read('src/server/source-catalog/connectors/rns-argentina/ar-public-entities.ts');
    assert.doesNotMatch(code, /process\.env|fetch\(|createClient|supabase-js/);
  });

  it('el cableado usa el directorio como respaldo del registro de sociedades de Argentina', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(
      wiring,
      /createFallbackOfficialSourceResolver\(\s*createArgentinaOfficialSourceResolver\([\s\S]*?\),\s*createSnapshotNameOfficialSourceResolver\(\{\s*countryCode:\s*'AR',\s*sourceKey:\s*AR_PUBLIC_ENTITIES_SOURCE_KEY/,
    );
  });

  it('el ETL escribe sólo con --apply y pasa por el guardarraíl de cargas grandes', () => {
    const etl = read('scripts/source-catalog/run-ar-public-entities-etl.ts');
    assert.match(etl, /argv\.includes\('--apply'\)/);
    assert.match(etl, /assertLargeImportAllowed\(/);
    assert.ok(etl.indexOf('if (!config.apply)') < etl.indexOf('.upsert('));
  });
});
