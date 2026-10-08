/**
 * SOURCES-CR-CICR-1 — la web de los socios de la Cámara de Industrias de Costa Rica
 * se cruza por nombre con el registro de cédulas y llega como alias `web:`.
 * Filas con la forma real de la página de asociados. Sin red, sin DB, sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCrCompanyRegistry } from '../cr-company-registry-rows';
import { buildCrCicrWebAliasRows, matchCrCicrMembers, type CrCicrMember } from '../cr-cicr-members';
import {
  buildCrCicrMemberRow,
  buildCrSicopSupplierRow,
  mergeCrFreeDirectoryRows,
  type CrRegistryLookup,
} from '../cr-free-directory-row';
import { resolveCrCicrActivityMacro } from '@/server/prospect-batches/country-source-discovery/cr-cicr-macro-table';
import { resolveCrDirectoryMacro } from '@/server/prospect-batches/country-source-discovery/cr-free-directory-macro-table';
import {
  buildCrFreeDirectoryDiscoveryAdapter,
  type CrFreeDirectorySnapshotReadRow,
} from '@/server/prospect-batches/country-source-discovery/cr-free-directory-discovery-adapter';

const REGISTRY = [
  { tax_id: '3101111111', normalized_legal_name: 'SERVICIOS INDUSTRIALES HENALI' },
  { tax_id: '3101222222', normalized_legal_name: 'PLYCEM CONSTRUSISTEMAS COSTA RICA' },
  { tax_id: '3101333333', normalized_legal_name: 'GRUPO REPETIDO' },
  { tax_id: '3102444444', normalized_legal_name: 'GRUPO REPETIDO' },
];

const member = (overrides: Partial<CrCicrMember> & { name: string }): CrCicrMember => ({
  domain: 'ejemplo.cr',
  activity: null,
  legal_form: true,
  ...overrides,
});

describe('matchCrCicrMembers', () => {
  it('asocia la web con la única cédula que tiene ese nombre', () => {
    const { websitesByCedula, report } = matchCrCicrMembers(
      [member({ name: 'SERVICIOS INDUSTRIALES HENALI SOCIEDAD ANONIMA', domain: 'henali.cr' })],
      REGISTRY,
    );
    assert.equal(websitesByCedula.get('3101111111'), 'https://henali.cr/');
    assert.equal(report.matched, 1);
  });

  it('encuentra la sociedad aunque el socio omita «de Costa Rica»', () => {
    const { websitesByCedula } = matchCrCicrMembers(
      [member({ name: 'PLYCEM CONSTRUSISTEMAS S.A.', domain: 'plycem.com' })],
      REGISTRY,
    );
    assert.equal(websitesByCedula.get('3101222222'), 'https://plycem.com/');
  });

  it('no adivina cuando el nombre pertenece a más de una cédula', () => {
    const { websitesByCedula, report } = matchCrCicrMembers([member({ name: 'GRUPO REPETIDO S.A.' })], REGISTRY);
    assert.equal(websitesByCedula.size, 0);
    assert.equal(report.excluded.ambiguous_name, 1);
  });

  it('descarta personas físicas, socios sin web y dominios que no son propios', () => {
    const { websitesByCedula, report } = matchCrCicrMembers(
      [
        member({ name: 'JOSÉ ALONSO HERNÁNDEZ GÓMEZ', legal_form: false }),
        member({ name: 'SERVICIOS INDUSTRIALES HENALI S.A.', domain: null }),
        member({ name: 'SERVICIOS INDUSTRIALES HENALI S.A.', domain: 'facebook.com' }),
      ],
      REGISTRY,
    );
    assert.equal(websitesByCedula.size, 0);
    assert.deepEqual(
      [report.excluded.not_company, report.excluded.no_domain, report.excluded.invalid_domain],
      [1, 1, 1],
    );
  });

  it('cuenta los socios que el registro no conoce', () => {
    const { report } = matchCrCicrMembers([member({ name: 'EMPRESA DESCONOCIDA S.A.' })], REGISTRY);
    assert.equal(report.excluded.no_match, 1);
    assert.equal(report.total, 1);
  });
});

describe('alias web de CICR en el registro', () => {
  it('la carga guarda la web de CICR como alias `web:<dominio>` de la cédula', () => {
    const records = {
      pymes: [
        {
          NOMBRE: 'SERVICIOS INDUSTRIALES HENALI SOCIEDAD ANONIMA',
          IDENTIFICACION: '3101111111',
          TAMAÑO: 'Mediana',
          PROVINCIA: 'SAN JOSE',
          'ACTIVIDAD CIIU': '2220',
        },
      ],
    };
    const first = buildCrCompanyRegistry(records, { sourceYear: 2026, importedAt: '2026-10-08T00:00:00.000Z' });
    const { websitesByCedula } = matchCrCicrMembers(
      [member({ name: 'SERVICIOS INDUSTRIALES HENALI SOCIEDAD ANONIMA', domain: 'henali.cr' })],
      first.registry,
    );
    const second = buildCrCompanyRegistry(
      { ...records, websitesByCedula },
      { sourceYear: 2026, importedAt: '2026-10-08T00:00:00.000Z' },
    );
    assert.equal(first.registry.length, 1);
    assert.ok(second.aliases.some((a) => a.normalized_legal_name === 'web:henali.cr' && a.tax_id === '3101111111'));
  });
});

describe('tabla de actividades de CICR (aprobada 08-10-2026)', () => {
  const cases: Array<[string, string | null]> = [
    ['Industria alimentaria', 'consumer_goods'],
    ['Metalmecánica', 'industry_manufacturing_chemicals_automotive'],
    ['Fabricación de tambores en acero inoxidable', 'industry_manufacturing_chemicals_automotive'],
    ['Laboratorio Farmaceútico', 'health_pharma'],
    ['Fabricación de productos farmacéuticos', 'health_pharma'],
    ['Forestal', 'agroindustry'],
    ['Bienes Inmuebles', 'property_construction'],
    ['Transporte marítimo', 'transport_logistics'],
    ['Consultoría en tecnología e inteligencia artificial', 'technology'],
    ['Consultoría en gestión', 'services_company'],
    ['Importación de productos ferreteros', 'retail'],
    ['Venta de vehículos nuevos y usados, seguros, financiamiento', null],
    ['Mecánica de Precisión', null],
    ['', null],
  ];
  for (const [activity, macro] of cases) {
    it(`«${activity}» → ${macro ?? 'sin macro'}`, () => {
      assert.equal(resolveCrCicrActivityMacro(activity), macro);
    });
  }

  it('los socios de CICR se clasifican por el texto, no por un código', () => {
    assert.equal(resolveCrDirectoryMacro('cicr_member', 'Industria alimentaria'), 'consumer_goods');
    assert.equal(resolveCrDirectoryMacro('cicr_member', null), null);
  });
});

describe('directorio gratuito con socios de CICR', () => {
  const params = { sourceYear: 2026, importedAt: '2026-10-08T00:00:00.000Z' };
  const registry: CrRegistryLookup = (cedula) =>
    ({
      '3101111111': { legalName: 'SERVICIOS INDUSTRIALES HENALI SOCIEDAD ANONIMA', meicSize: 'MEDIANA' },
      '3101222222': { legalName: 'TALLER PEQUENO SOCIEDAD ANONIMA', meicSize: 'PEQUEÑA' },
      '3101333333': { legalName: 'ALIMENTOS DEL VALLE SOCIEDAD ANONIMA', meicSize: null },
    })[cedula] ?? null;

  it('la fila lleva industria, actividad declarada y web propia', () => {
    const out = buildCrCicrMemberRow({
      member: { cedula: '3101333333', activity: 'Industria alimentaria', domain: 'alimentosdelvalle.com' },
      registry,
      ...params,
    });
    assert.ok('row' in out);
    assert.equal(out.row.raw_data.directory_kind, 'cicr_member');
    assert.equal(out.row.raw_data.macro_industry_key, 'consumer_goods');
    assert.equal(out.row.raw_data.activity_text, 'Industria alimentaria');
    assert.equal(out.row.raw_data.website_domain, 'alimentosdelvalle.com');
  });

  it('deja fuera micro y pequeñas, cédulas desconocidas y actividades sin macro', () => {
    const base = { activity: 'Industria alimentaria', domain: 'x.cr' };
    assert.deepEqual(buildCrCicrMemberRow({ member: { cedula: '3101222222', ...base }, registry, ...params }), {
      excluded: 'meic_small',
    });
    assert.deepEqual(buildCrCicrMemberRow({ member: { cedula: '3101999999', ...base }, registry, ...params }), {
      excluded: 'no_name',
    });
    assert.deepEqual(
      buildCrCicrMemberRow({ member: { cedula: '3101111111', activity: 'Mecánica de Precisión', domain: 'x.cr' }, registry, ...params }),
      { excluded: 'no_dominant_macro' },
    );
  });

  it('si otra fuente decide la industria, la web de CICR se conserva', () => {
    const cicr = buildCrCicrMemberRow({
      member: { cedula: '3101111111', activity: 'Metalmecánica', domain: 'henali.cr' },
      registry,
      ...params,
    });
    const sicop = buildCrSicopSupplierRow({
      summary: { cedula: '3101111111', amountByFamily: { '2310': 1_000_000 }, buyers: 12, offers: 40, lastOfferYear: 2024 },
      registry,
      ...params,
    });
    assert.ok('row' in cicr && 'row' in sicop);
    const merged = mergeCrFreeDirectoryRows([cicr.row, sicop.row]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].raw_data.directory_kind, 'sicop_supplier');
    assert.equal(merged[0].raw_data.website_domain, 'henali.cr');
  });

  it('el adaptador ofrece al socio con su web y la industria que declaró', async () => {
    const stored: CrFreeDirectorySnapshotReadRow = {
      record_identity_key: 'k1',
      cedula: '3101333333',
      legal_name: 'ALIMENTOS DEL VALLE SOCIEDAD ANONIMA',
      normalized_legal_name: 'ALIMENTOS DEL VALLE',
      city: null,
      region: null,
      directory_kind: 'cicr_member',
      activity_code: null,
      activity_text: 'Industria alimentaria',
      website_domain: 'alimentosdelvalle.com',
      meic_size: null,
      priority_score: 200000,
    };
    const adapter = buildCrFreeDirectoryDiscoveryAdapter({ readCompaniesByMacro: async () => [stored] });
    const consumer = await adapter({ countryCode: 'CR', macroIndustryKey: 'consumer_goods', limit: 10 } as never);
    assert.equal(consumer.companies[0]?.domain, 'alimentosdelvalle.com');
    assert.equal(consumer.companies[0]?.declaredIndustry, 'Industria alimentaria');
    const retail = await adapter({ countryCode: 'CR', macroIndustryKey: 'retail', limit: 10 } as never);
    assert.deepEqual(retail.companies, []);
  });
});

describe('alias de web de CICR sobre filas ya cargadas', () => {
  const rows = buildCrCompanyRegistry(
    {
      pymes: [
        { NOMBRE: 'ALFA SOCIEDAD ANONIMA', IDENTIFICACION: '3101000001', TAMAÑO: 'Mediana', PROVINCIA: 'SAN JOSE', 'ACTIVIDAD CIIU': '2220' },
        { NOMBRE: 'BETA SOCIEDAD ANONIMA', IDENTIFICACION: '3101000002', TAMAÑO: 'Mediana', PROVINCIA: 'SAN JOSE', 'ACTIVIDAD CIIU': '2220' },
      ],
    },
    { sourceYear: 2026, importedAt: '2026-10-08T00:00:00.000Z' },
  ).registry;

  it('crea un alias por cédula con su web', () => {
    const out = buildCrCicrWebAliasRows({ registry: rows, websitesByCedula: new Map([['3101000001', 'https://alfa.cr/']]) });
    assert.deepEqual(out.map((a) => [a.tax_id, a.normalized_legal_name]), [['3101000001', 'web:alfa.cr']]);
    assert.equal(out[0].source_key, 'cr_company_name_alias');
    assert.ok(out[0].record_identity_key);
  });

  it('no asigna una web compartida por dos cédulas ni una que ya es de otra', () => {
    const shared = new Map([
      ['3101000001', 'https://grupo.cr/'],
      ['3101000002', 'https://grupo.cr/'],
    ]);
    assert.deepEqual(buildCrCicrWebAliasRows({ registry: rows, websitesByCedula: shared }), []);
    const taken = new Map([['web:alfa.cr', '3101000002']]);
    assert.deepEqual(
      buildCrCicrWebAliasRows({ registry: rows, websitesByCedula: new Map([['3101000001', 'https://alfa.cr/']]), takenWebKeys: taken }),
      [],
    );
  });
});
