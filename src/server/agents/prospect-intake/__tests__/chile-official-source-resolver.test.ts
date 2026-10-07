/**
 * SOURCES-CL-NAME-ALIAS-1 — RUT por nombre de Chile: variantes del nombre, siglas
 * de organismos públicos y nombre comercial al final de la razón social. Lectura
 * inyectada en memoria (cero E/S). Casos tomados de las empresas chilenas en
 * revisión sin RUT medidas en Producción el 07-10-2026.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createChileOfficialSourceResolver,
  type ChileNameRow,
} from '../resolvers/chile-official-source-resolver';
import type { OfficialSourceResolverInput } from '../source-enrichment';
import {
  chileBrandTailKey,
  chileCandidateNameVariants,
  chilePublicEntityBySigla,
  CL_PUBLIC_ENTITY_SIGLAS,
} from '@/server/source-catalog/connectors/sii-chile/cl-name-keys';
import { buildClSiiNameAliasRow } from '@/server/source-catalog/connectors/sii-chile/cl-sii-name-alias-rows';
import { normalizeChileRut } from '@/server/source-catalog/connectors/res-chile/cl-res-registry-row';
import { getSourceFamily } from '@/server/source-catalog/record-identity/source-family-registry';
import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';

function input(canonicalName: string, domain: string | null = null): OfficialSourceResolverInput {
  return {
    candidate: { canonicalName, countryCode: 'CL', domain, websiteUrl: null },
    criteria: { countryCode: 'CL' },
  } as unknown as OfficialSourceResolverInput;
}

/** Registro en memoria: clave guardada → filas. Anota cada clave pedida. */
function memoryQuery(table: Record<string, ChileNameRow[]>) {
  const asked: string[] = [];
  const query = async (core: string): Promise<ChileNameRow[]> => {
    asked.push(core);
    return table[core] ?? [];
  };
  return { query, asked };
}

const row = (taxId: string, name: string, extra: Partial<ChileNameRow> = {}): ChileNameRow => ({
  taxId,
  legalName: name,
  normalizedLegalName: name,
  ...extra,
});

describe('variantes del nombre del candidato', () => {
  const cores = (name: string) => chileCandidateNameVariants(name).map((v) => v.core);

  it('el núcleo de siempre va primero', () => {
    assert.equal(cores('Municipalidad de Curicó')[0], 'MUNICIPALIDAD DE CURICO');
  });

  it('sin restos de la web', () => {
    assert.ok(cores('Sernac.cl').includes('SERNAC'));
    assert.ok(cores('Sscoquimbo.redsalud.gob.cl').includes('SSCOQUIMBO'));
  });

  it('cada parte de un nombre doble: la primera siempre; las demás si son nombre completo o sigla', () => {
    assert.ok(cores('PDI- Policía de Investigaciones de Chile').includes('POLICIA DE INVESTIGACIONES DE CHILE'));
    assert.ok(cores('Subsecretaría de Desarrollo Regional y Administrativo | Subdere').includes('SUBDERE'));
    assert.ok(
      cores('Subsecretaría de Desarrollo Regional y Administrativo | Subdere').includes(
        'SUBSECRETARIA DE DESARROLLO REGIONAL Y ADMINISTRATIVO',
      ),
    );
    assert.ok(cores('Servicio Nacional para la Prevención y Rehabilitación del Consumo de Drogas y Alcohol (SENDA)').includes('SENDA'));
    // «Customer Analytics» (2 palabras, no sigla) podría ser otra sociedad.
    assert.deepEqual(cores('Unipdata - Customer Analytics').includes('CUSTOMER ANALYTICS'), false);
    assert.ok(cores('Unipdata - Customer Analytics').includes('UNIPDATA'));
  });

  it('sin «Chile» al final', () => {
    assert.ok(cores('INJUV Chile').includes('INJUV'));
    assert.ok(cores('ImagenSalud Chile').includes('IMAGENSALUD'));
  });
});

describe('siglas de organismos públicos', () => {
  it('cada RUT de la tabla es un RUT chileno válido', () => {
    for (const [sigla, entity] of Object.entries(CL_PUBLIC_ENTITY_SIGLAS)) {
      assert.equal(normalizeChileRut(entity.rut), entity.rut, sigla);
    }
  });

  it('5+ letras basta; una corta necesita su web; METRO siempre su web', () => {
    const v = (name: string) => chileCandidateNameVariants(name);
    assert.equal(chilePublicEntityBySigla(v('Junaeb'), null)?.rut, '60908000-0');
    assert.equal(chilePublicEntityBySigla(v('PDI'), null), null);
    assert.equal(chilePublicEntityBySigla(v('PDI'), 'https://www.pdichile.cl/')?.rut, '60506000-5');
    assert.equal(chilePublicEntityBySigla(v('Metro'), null), null);
    assert.equal(chilePublicEntityBySigla(v('Metro'), 'metro.cl')?.rut, '61219000-3');
  });
});

describe('nombre comercial al final de la razón social', () => {
  it('la palabra final, larga y no genérica', () => {
    assert.equal(chileBrandTailKey('EMPRESA DE TRANSMISION ELECTRICA TRANSEMEL'), 'TRANSEMEL');
    assert.equal(chileBrandTailKey('INVERSIONES DEL SUR CHILE'), null);
    assert.equal(chileBrandTailKey('TRANSEMEL'), null);
    assert.equal(chileBrandTailKey('SERVICIOS ABC'), null);
  });

  it('sólo con una palabra de UNA sola sociedad y 10+ trabajadores', () => {
    const company = {
      rut: '96893220-9',
      legalName: 'EMPRESA DE TRANSMISION ELECTRICA TRANSEMEL S A',
      core: 'EMPRESA DE TRANSMISION ELECTRICA TRANSEMEL',
      workers: 18,
      metricsYear: 2024,
    };
    const params = { sourceYear: 2026, importedAt: '2026-10-07T00:00:00.000Z' };
    const unique = new Map([['TRANSEMEL', 1]]);
    const built = buildClSiiNameAliasRow(company, unique, params);
    assert.equal(built?.normalized_legal_name, 'TRANSEMEL');
    assert.equal(built?.normalized_tax_id, '96893220-9');
    assert.equal(built?.source_key, 'cl_sii_name_alias');
    // Razón social cortada por el SII a 40 caracteres: la última palabra puede estar a medias.
    assert.equal(
      buildClSiiNameAliasRow(
        { ...company, legalName: 'SUBSECRETARIA DEL MINISTERIO DE AGRICULT', core: 'SUBSECRETARIA DEL MINISTERIO DE AGRICULT' },
        new Map([['AGRICULT', 1]]),
        params,
      ),
      null,
    );
    // Banmédica: la palabra sale en dos sociedades ⇒ no se guarda.
    assert.equal(buildClSiiNameAliasRow(company, new Map([['TRANSEMEL', 2]]), params), null);
    assert.equal(buildClSiiNameAliasRow({ ...company, workers: 6 }, unique, params), null);
    assert.equal(buildClSiiNameAliasRow({ ...company, rut: '96893220-1' }, unique, params), null);
  });
});

describe('createChileOfficialSourceResolver', () => {
  it('núcleo exacto: RUT fuerte y trabajadores', async () => {
    const { query } = memoryQuery({
      'MUNICIPALIDAD DE CURICO': [row('69100100-8', 'MUNICIPALIDAD DE CURICO', { workforce: { workers: 5023, year: 2024, source: 'cl_sii_registry' } })],
    });
    const out = await createChileOfficialSourceResolver({ querySnapshots: query }).resolve(input('Municipalidad de Curicó'));
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '69100100-8');
    assert.equal(out.workforce?.workers, 5023);
  });

  it('nombre doble: la parte con el nombre completo', async () => {
    const { query } = memoryQuery({
      'POLICIA DE INVESTIGACIONES DE CHILE': [row('60506000-5', 'POLICIA DE INVESTIGACIONES DE CHILE')],
    });
    const out = await createChileOfficialSourceResolver({ querySnapshots: query }).resolve(
      input('PDI- Policía de Investigaciones de Chile', 'pdichile.cl'),
    );
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '60506000-5');
  });

  it('sigla sin fila en el registro: el RUT de la tabla de siglas', async () => {
    const { query } = memoryQuery({});
    const out = await createChileOfficialSourceResolver({ querySnapshots: query }).resolve(input('INJUV Chile', 'injuv.gob.cl'));
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '60110000-2');
    assert.equal(out.sourceKey, 'cl_sii_registry');
  });

  it('alias del nombre comercial: la razón social del registro', async () => {
    const { query } = memoryQuery({
      TRANSEMEL: [row('96893220-9', 'EMPRESA DE TRANSMISION ELECTRICA TRANSEMEL S A', { normalizedLegalName: 'TRANSEMEL', alias: true })],
    });
    const out = await createChileOfficialSourceResolver({ querySnapshots: query }).resolve(input('Transemel', 'transemel.cl'));
    assert.equal(out.status, 'matched');
    assert.equal(out.taxIdentifier, '96893220-9');
    assert.equal(out.legalName, 'EMPRESA DE TRANSMISION ELECTRICA TRANSEMEL S A');
    assert.equal((out.safeMetadata as Record<string, unknown>).matchedAlias, true);
  });

  it('alias sin una web que lo confirme: sólo pista («LAETITIA» puede ser otra marca)', async () => {
    const { query } = memoryQuery({
      LAETITIA: [row('53333903-4', 'FUNDACION SOCIAL AMORIS LAETITIA', { normalizedLegalName: 'LAETITIA', alias: true })],
    });
    const resolver = createChileOfficialSourceResolver({ querySnapshots: query });
    const sinWeb = await resolver.resolve(input('Laetitia'));
    assert.equal(sinWeb.status, 'low_confidence_match');
    assert.equal((sinWeb.safeMetadata as Record<string, unknown>).aliasNeedsDomain, true);
    const otraWeb = await resolver.resolve(input('Laetitia', 'cosmeticos-luz.cl'));
    assert.equal(otraWeb.status, 'low_confidence_match');
  });

  it('varios RUT: sólo pista', async () => {
    const { query } = memoryQuery({
      'GRIFOLS CHILE': [row('96582310-7', 'GRIFOLS CHILE'), row('76000000-0', 'GRIFOLS CHILE')],
    });
    const out = await createChileOfficialSourceResolver({ querySnapshots: query }).resolve(input('Grifols Chile S.A.'));
    assert.equal(out.status, 'low_confidence_match');
  });

  it('la primera variante con filas decide y nunca prueba «Customer Analytics»', async () => {
    const { query, asked } = memoryQuery({});
    const out = await createChileOfficialSourceResolver({ querySnapshots: query }).resolve(input('Unipdata - Customer Analytics'));
    assert.equal(out.status, 'not_found');
    assert.equal(asked.includes('CUSTOMER ANALYTICS'), false);
  });
});

describe('conexión', () => {
  it('la corrida usa el resolvedor de Chile, con el RES de respaldo', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/prospect-batches/official-source-resolvers.ts'), 'utf8');
    assert.match(src, /createChileOfficialSourceResolver\(\{\s*querySnapshots: buildChileSnapshotNameQuery\(snapshotClient\)/);
    assert.match(src, /sourceKey: 'cl_res_registry'/);
  });

  it('la lectura pide registro y alias a la vez, sólo lectura', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/prospect-batches/chile-snapshot-query.ts'), 'utf8');
    assert.match(src, /\.in\('source_key', \[CL_SII_REGISTRY_SOURCE_KEY, CL_SII_NAME_ALIAS_SOURCE_KEY\]\)/);
    assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/);
  });

  it('la fuente de alias está registrada y en el catálogo como identidad en la corrida', () => {
    assert.equal(getSourceFamily('cl_sii_name_alias'), 'NATIVE_RECORD_GRAIN');
    const entry = CATALOG_SOURCES.find((source) => source.key === 'cl_sii_name_alias');
    assert.equal(entry?.aiFlowStatus, 'connected_identity_in_run');
  });
});
