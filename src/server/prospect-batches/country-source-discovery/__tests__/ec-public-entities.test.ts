/**
 * SOURCES-EC-PUBLIC-ENTITIES-1 — capa gratuita de Ecuador para Gobierno y Salud con
 * las entidades públicas del catastro del SRI (dueña 07-10). Nombres con la forma
 * de las filas reales de Prod; RUC sintéticos con tercer dígito 6. Cero E/S.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  classifyEcPublicEntity,
  EC_PUBLIC_ENTITY_RULES_VERSION,
} from '@/server/source-catalog/connectors/ec-scvs/ec-public-entity-classifier';
import { normalizeEcEntityCore } from '@/server/source-catalog/connectors/ec-scvs/ec-entity-name-core';
import {
  buildEcScvsDirectoryDiscoveryAdapter,
  macroHasEcFreeLayerCoverage,
  type EcScvsDirectoryDiscoveryReads,
  type EcScvsDirectorySnapshotReadRow,
} from '../ec-scvs-directory-discovery-adapter';
import { buildEcScvsDirectoryDiscoveryReads } from '../ec-scvs-directory-snapshot-query';
import { countrySourceMacroHasCoverage } from '../country-source-capability';

describe('1. nombres de gobiernos locales que el SRI escribe de otra forma (Prod 07-10)', () => {
  it('llegan a la misma forma canónica que «Municipio de X»', () => {
    const cases: Array<[string, string]> = [
      ['GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPALIDAD DE AMBATO', 'GAD MUNICIPAL AMBATO'],
      ['GOBIERNO AUTONOMO DESCENTRALIZADO ILUSTRE MUNICIPALIDAD DEL CANTON DAULE', 'GAD MUNICIPAL DAULE'],
      ['GOBIERNO MUNICIPAL DEL CANTON MORONA', 'GAD MUNICIPAL MORONA'],
      ['GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON BABAHOYO - GADM DE BABAHOYO', 'GAD MUNICIPAL BABAHOYO'],
      [
        'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON SAN FRANCISCO DE MILAGRO GADMM',
        'GAD MUNICIPAL SAN FRANCISCO DE MILAGRO',
      ],
      ['GOBIERNO AUTONOMO DESCENTRALIZADO PROVINCIAL DE LOS RIOS', 'GAD PROVINCIAL LOS RIOS'],
      ['HONORABLE GOBIERNO AUTONOMO DESCENTRALIZADO DE LA PROVINCIA DE CHIMBORAZO', 'GAD PROVINCIAL CHIMBORAZO'],
      ['Municipio de Ambato', 'GAD MUNICIPAL AMBATO'],
    ];
    for (const [name, canonical] of cases) assert.equal(normalizeEcEntityCore(name), canonical, name);
  });

  it('los casos de antes no cambian', () => {
    assert.equal(
      normalizeEcEntityCore('GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON CELICA'),
      'GAD MUNICIPAL CELICA',
    );
    assert.equal(
      normalizeEcEntityCore('GOBIERNO AUTONOMO DESCENTRALIZADO DEL DISTRITO METROPOLITANO DE QUITO'),
      'GAD MUNICIPAL QUITO',
    );
    assert.equal(normalizeEcEntityCore('Prefectura del Carchi'), 'GAD PROVINCIAL CARCHI');
  });
});

describe('2. qué entidad pública se ofrece (regla por tipo)', () => {
  const kind = (name: string) => {
    const c = classifyEcPublicEntity(name);
    return c ? `${c.macroIndustryKey}/${c.kind}` : null;
  };

  it('Gobierno: nacionales cabeza, provincias, municipios grandes y universidades públicas', () => {
    assert.equal(kind('MINISTERIO DE SALUD PUBLICA'), 'government/national');
    assert.equal(kind('INSTITUTO ECUATORIANO DE SEGURIDAD SOCIAL IESS'), 'government/national');
    assert.equal(kind('SERVICIO DE RENTAS INTERNAS'), 'government/national');
    assert.equal(kind('CONSEJO DE GOBIERNO DEL REGIMEN ESPECIAL DE GALAPAGOS'), 'government/national');
    assert.equal(kind('GOBIERNO PROVINCIAL DEL GUAYAS'), 'government/provincial');
    assert.equal(kind('GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON CUENCA'), 'government/municipal');
    assert.equal(kind('GOBIERNO AUTONOMO DESCENTRALIZADO DE SAN MIGUEL DE IBARRA'), 'government/municipal');
    assert.equal(kind('UNIVERSIDAD CENTRAL DEL ECUADOR'), 'government/university');
    assert.equal(kind('ESCUELA SUPERIOR POLITECNICA DEL LITORAL ESPOL'), 'government/university');
  });

  it('Salud: hospitales públicos grandes', () => {
    assert.equal(kind('HOSPITAL DE ESPECIALIDADES CARLOS ANDRADE MARIN'), 'health_pharma/hospital');
    assert.equal(kind('HOSPITAL PROVINCIAL GENERAL PABLO ARTURO SUAREZ'), 'health_pharma/hospital');
    assert.equal(kind('HOSPITAL PEDIATRICO BACA ORTIZ'), 'health_pharma/hospital');
  });

  it('no se ofrece: parroquias, municipios pequeños, dependencias, hospitales básicos, bomberos, empresas municipales', () => {
    for (const name of [
      'GOBIERNO AUTONOMO DESCENTRALIZADO PARROQUIAL RURAL DE SELVA ALEGRE',
      'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON CELICA',
      'GOBIERNO AUTONOMO DESCENTRALIZADO DEL DISTRITO METROPOLITANO DE QUITO UNIDAD EDUCATIVA MUNICIPAL JULIO E. MORENO',
      'DIRECCION DISTRITAL 11D06-CALVAS-GONZANAMA-QUILANGA-SALUD',
      'FACULTAD DE MEDICINA VETERINARIA Y ZOOTECNIA DE LA UNIVERSIDAD CENTRAL DEL ECUADOR',
      'UNIVERSIDAD CENTRAL DEL ECUADOR - HOSPITAL DEL DIA',
      'MINISTERIO DE GOBIERNO - ESCUELA DE FORMACION DE POLICIAS CABO SEGUNDO VICTOR HUGO USCA PACHACAMA',
      'MINISTERIO DEL TRABAJO, REGIONAL 2, LITORAL Y GALAPAGOS',
      'SERVICIO NACIONAL DE ADUANA DEL ECUADOR - DISTRITO GUAYAQUIL',
      'CONSEJO NACIONAL ELECTORAL DELEGACION PROVINCIAL DE LOS RIOS',
      'HOSPITAL BASICO DE PELILEO',
      'IESS CENTRO DE SALUD A EL COCA',
      'CUERPO DE BOMBEROS DE HUAQUILLAS',
      'EMPRESA PUBLICA MUNICIPAL DE AGUA POTABLE Y ALCANTARILLADO DE OTAVALO',
      'REGISTRO DE LA PROPIEDAD DEL CANTON PIMAMPIRO',
      '',
    ]) {
      assert.equal(kind(name), null, name);
    }
  });

  it('lo nacional se ofrece antes que lo demás', () => {
    assert.ok(
      (classifyEcPublicEntity('MINISTERIO DE EDUCACION')?.priority ?? 0) >
        (classifyEcPublicEntity('GOBIERNO PROVINCIAL DEL GUAYAS')?.priority ?? 0),
    );
  });
});

function publicRow(n: number, legalName: string, overrides: Partial<EcScvsDirectorySnapshotReadRow> = {}): EcScvsDirectorySnapshotReadRow {
  const ruc = `17600${String(n).padStart(5, '0')}001`;
  return {
    record_identity_key: `tax:${ruc}`,
    ruc,
    legal_name: legalName,
    normalized_legal_name: normalizeEcEntityCore(legalName),
    city: 'QUITO',
    region: 'PICHINCHA',
    ciiu_code: 'O8411.01',
    employees: null,
    metrics_year: null,
    priority_score: null,
    public_entity: classifyEcPublicEntity(legalName),
    ...overrides,
  };
}

describe('3. el adapter de Ecuador ofrece entidades públicas en Gobierno y Salud', () => {
  it('cobertura: Gobierno ahora tiene capa gratuita en Ecuador', () => {
    assert.equal(macroHasEcFreeLayerCoverage('government'), true);
    assert.equal(countrySourceMacroHasCoverage('EC', 'government'), true);
    assert.equal(countrySourceMacroHasCoverage('EC', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('EC', 'no_existe'), false);
  });

  it('Gobierno: entidad con RUC, industria Gobierno, regla por tipo y SIN tamaño inventado', async () => {
    const calls: string[] = [];
    const reads: EcScvsDirectoryDiscoveryReads = {
      readCompaniesByMacro: async () => (calls.push('companies'), []),
      readPublicEntitiesByMacro: async (input) => (
        calls.push(`public:${input.macroIndustryKey}`),
        [publicRow(1, 'MINISTERIO DE EDUCACION'), publicRow(2, 'GOBIERNO PROVINCIAL DEL GUAYAS')]
      ),
    };
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({ countryCode: 'EC', macroIndustryKey: 'government', limit: 5 });
    assert.ok(calls.includes('public:government'));
    assert.deepEqual(result.companies.map((c) => c.legalName), ['MINISTERIO DE EDUCACION', 'GOBIERNO PROVINCIAL DEL GUAYAS']);
    const [first] = result.companies;
    assert.equal(first.taxId, '1760000001001');
    assert.equal(first.declaredIndustry, 'Gobierno');
    assert.equal(first.domain, null);
    assert.equal(first.officialWorkforce, null);
    assert.deepEqual(first.officialMacroIndustry, { macroIndustryKeys: ['government'], tableVersion: EC_PUBLIC_ENTITY_RULES_VERSION });
  });

  it('Salud: primero las compañías de la Superintendencia, después los hospitales públicos', async () => {
    const company: EcScvsDirectorySnapshotReadRow = {
      record_identity_key: 'tax:0990858322001',
      ruc: '0990858322001',
      legal_name: 'DISTRIBUIDORA FARMACEUTICA ECUATORIANA (DIFARE) S.A.',
      normalized_legal_name: 'DISTRIBUIDORA FARMACEUTICA ECUATORIANA DIFARE',
      city: 'GUAYAQUIL',
      region: 'GUAYAS',
      ciiu_code: 'G4772.01',
      employees: 3000,
      metrics_year: 2025,
      priority_score: 99,
    };
    const reads: EcScvsDirectoryDiscoveryReads = {
      readCompaniesByMacro: async () => [company],
      readPublicEntitiesByMacro: async () => [publicRow(3, 'HOSPITAL DE ESPECIALIDADES EUGENIO ESPEJO')],
    };
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({ countryCode: 'EC', macroIndustryKey: 'health_pharma', limit: 5 });
    assert.deepEqual(result.companies.map((c) => c.taxId), ['0990858322001', '1760000003001']);
  });

  it('una entidad de otra industria, o ya vista por SellUp, no se ofrece', async () => {
    const reads: EcScvsDirectoryDiscoveryReads = {
      readCompaniesByMacro: async () => [],
      readPublicEntitiesByMacro: async () => [
        publicRow(4, 'HOSPITAL PEDIATRICO BACA ORTIZ'),
        publicRow(5, 'MINISTERIO DEL TRABAJO', { prior_sighting: 'candidate' }),
        publicRow(6, 'SERVICIO DE RENTAS INTERNAS'),
      ],
    };
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({ countryCode: 'EC', macroIndustryKey: 'government', limit: 5 });
    assert.deepEqual(result.companies.map((c) => c.legalName), ['SERVICIO DE RENTAS INTERNAS']);
  });

  it('sin la lectura de entidades públicas, Gobierno no ofrece nada (como antes)', async () => {
    const reads: EcScvsDirectoryDiscoveryReads = { readCompaniesByMacro: async () => [] };
    const result = await buildEcScvsDirectoryDiscoveryAdapter(reads)({ countryCode: 'EC', macroIndustryKey: 'government', limit: 5 });
    assert.equal(result.companies.length, 0);
  });
});

describe('4. la lectura de producción', () => {
  /** Cliente doble: devuelve las filas del SRI y nada más; cualquier escritura revienta. */
  function fakeClient(rows: Array<Record<string, unknown>>) {
    const filters: Array<Record<string, unknown>> = [];
    const client = {
      from(table: string) {
        const f: Record<string, unknown> = { table };
        filters.push(f);
        const builder = {
          select: () => builder,
          eq: (col: string, val: unknown) => ((f[col] = val), builder),
          in: () => builder,
          order: () => builder,
          range: async (from: number, to: number) => ({
            data: table === 'source_company_snapshots' ? rows.slice(from, to + 1) : [],
            error: null,
          }),
          then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
          insert: () => assert.fail('escritura prohibida'),
          update: () => assert.fail('escritura prohibida'),
          upsert: () => assert.fail('escritura prohibida'),
          delete: () => assert.fail('escritura prohibida'),
        };
        return builder;
      },
    };
    return { client: client as unknown as SupabaseClient, filters };
  }

  const sri = (n: number, legalName: string) => ({
    record_identity_key: `tax:17600${String(n).padStart(5, '0')}001`,
    normalized_tax_id: `17600${String(n).padStart(5, '0')}001`,
    legal_name: legalName,
    normalized_legal_name: normalizeEcEntityCore(legalName),
    city: 'QUITO',
    region: 'PICHINCHA',
    priority_score: null,
    raw_data: { sector_type: 'public', ciiu_code: 'O8411.01' },
  });

  it('lee sólo entidades públicas del SRI de Ecuador, filtra por tipo e industria y ordena lo nacional primero', async () => {
    const { client, filters } = fakeClient([
      sri(1, 'GOBIERNO PROVINCIAL DEL GUAYAS'),
      sri(2, 'GOBIERNO AUTONOMO DESCENTRALIZADO PARROQUIAL RURAL DE SELVA ALEGRE'),
      sri(3, 'HOSPITAL PEDIATRICO BACA ORTIZ'),
      sri(4, 'MINISTERIO DE EDUCACION'),
    ]);
    const rows = await buildEcScvsDirectoryDiscoveryReads(client).readPublicEntitiesByMacro!({ macroIndustryKey: 'government', limit: 5 });
    assert.deepEqual(rows.map((r) => r.legal_name), ['MINISTERIO DE EDUCACION', 'GOBIERNO PROVINCIAL DEL GUAYAS']);
    assert.equal(rows[0].public_entity?.kind, 'national');
    assert.equal(rows[0].employees, null);
    const read = filters.find((f) => f.table === 'source_company_snapshots');
    assert.equal(read?.source_key, 'ec_sri_registry');
    assert.equal(read?.country_code, 'EC');
    assert.equal(read?.['raw_data->>sector_type'], 'public');
  });

  it('con límite 0 no consulta', async () => {
    const { client, filters } = fakeClient([sri(1, 'MINISTERIO DE EDUCACION')]);
    const rows = await buildEcScvsDirectoryDiscoveryReads(client).readPublicEntitiesByMacro!({ macroIndustryKey: 'government', limit: 0 });
    assert.deepEqual(rows, []);
    assert.equal(filters.length, 0);
  });
});
