/**
 * SOURCES-EC-CLOSE-1 — Ecuador: nombres, siglas, entidades públicas, dominio de
 * SERCOP y filas de los registros nuevos (SCVS con empleados, SRI). Puro, sin E/S.
 * Nombres con la forma de las filas reales; RUC sintéticos con formato EC-RUC-v1.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ecCompanyNameAlias, normalizeEcCompanyCore } from '../ec-company-name-core';
import { canonicalEcLocalGovernment, normalizeEcEntityCore } from '../ec-entity-name-core';
import {
  buildEcSercopDomainMap,
  ecCorporateDomainFromUrls,
  hostFromDeclaredUrl,
  readSercopPartyUrls,
} from '../ec-sercop-domain';
import {
  admitEcRegistryCompany,
  buildEcScvsRegistryRows,
  EC_SMALL_COMPANY_MAX_SALES_USD,
  ecWorkforceFields,
  EC_SCVS_ALIAS_REGISTRY_SOURCE_KEY,
  EC_SCVS_REGISTRY_SOURCE_KEY,
  pickEcRegistryEntry,
} from '../ec-scvs-registry-rows';
import {
  accumulateEcSriEntry,
  admitEcSriRecord,
  buildEcSriRegistryRows,
  EC_SRI_REGISTRY_SOURCE_KEY,
  EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY,
  readEcSriLine,
  type EcSriRecord,
} from '../ec-sri-registry-rows';
import type { EcDirectoryRecord } from '../ec-scvs-directory-rows';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import { getSourceFamily } from '../../../record-identity';
import { isRecycledCountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-prior-sightings';

describe('formas societarias escritas de cualquier manera (Prod 06-10: ~5.000 nombres)', () => {
  it('quita B.I.C., C.L., Compañía Anónima, E.P., C.E.M. y formas extranjeras, también apiladas', () => {
    const cases: Array<[string, string]> = [
      ["''AGIL GAS'' FULGAS CIA.LTDA. B.I.C.", 'AGIL GAS FULGAS'],
      ["''ACG'' ATTESTING & CONSULTING GROUP C.L.", 'ACG ATTESTING & CONSULTING GROUP'],
      ['CONSTRUCTORA DICONXZ COMPAÑÍA ANÓNIMA', 'CONSTRUCTORA DICONXZ'],
      ['BOLIVARIANA DE TRANSPORTE DE CARGA TRANSBOLIVARIANA CIA. ANONIMA', 'BOLIVARIANA DE TRANSPORTE DE CARGA TRANSBOLIVARIANA'],
      ["'' HYDROPROJECT ENGINEERING S.L.''", 'HYDROPROJECT ENGINEERING'],
      ["''SOUTH AMERICAN OIL SERVICES S.A.C.''", 'SOUTH AMERICAN OIL SERVICES'],
      ["''ACS INTERNATIONAL S.R.L.''", 'ACS INTERNATIONAL'],
      ['3COM INTERNATIONAL INC.', '3COM INTERNATIONAL'],
      ['B.L. HARBERT INTERNATIONAL L.L.C.', 'B L HARBERT INTERNATIONAL'],
      ['CORPORACION NACIONAL DE TELECOMUNICACIONES CNT EP', 'CORPORACION NACIONAL DE TELECOMUNICACIONES CNT'],
      ['EMPRESA PUBLICA DE AGUA X E.P.', 'EMPRESA PUBLICA DE AGUA X'],
      ['AGRICOLA SANTA CARLA S.C.', 'AGRICOLA SANTA CARLA'],
    ];
    for (const [raw, core] of cases) assert.equal(normalizeEcCompanyCore(raw), core, raw);
  });

  it('las iniciales que NO son forma societaria se conservan («D.P.C.»)', () => {
    assert.equal(normalizeEcCompanyCore('AGRICOLA D.P.C. C LTDA'), 'AGRICOLA D P C');
    assert.equal(normalizeEcCompanyCore('COMERCIAL C.M.C. C LTDA'), 'COMERCIAL C M C');
  });
});

describe('sigla o nombre corto dentro de la razón social', () => {
  it('la palabra tras una forma en mitad del nombre, o lo que va entre paréntesis', () => {
    const cases: Array<[string, string]> = [
      ['CONSORCIO ECUATORIANO DE TELECOMUNICACIONES S.A. CONECEL', 'CONECEL'],
      ['PROCESADORA NACIONAL DE ALIMENTOS C.A. PRONACA', 'PRONACA'],
      ['FARMACIAS Y COMISARIATOS DE MEDICINAS SA FARCOMED', 'FARCOMED'],
      ['ACERIA DEL ECUADOR CA ADELCA.', 'ADELCA'],
      ['DISTRIBUIDORA FARMACEUTICA ECUATORIANA (DIFARE) S.A.', 'DIFARE'],
      ['AMERICAN CALL CENTER S.A. (AMERICALL)', 'AMERICALL'],
      ['EMBARFRU S.A. EMBARCADORA DE FRUTAS TROPICALES', 'EMBARFRU'],
      // Las iniciales entre paréntesis no valen; el nombre antes de la forma, sí.
      ['AUTOMOTORES Y ANEXOS S.A. (A.Y.A.S.A.)', 'AUTOMOTORES Y ANEXOS'],
    ];
    for (const [raw, alias] of cases) assert.equal(ecCompanyNameAlias(raw), alias, raw);
  });

  it('nunca un lugar, iniciales sueltas, una forma, el nombre entero ni algo de una liquidación', () => {
    for (const raw of [
      'G4S SECURE SOLUTIONS (ECUADOR) CIA. LTDA.',
      'INTERNATIONAL WATER SERVICES ( GUAYAQUIL ) INTERAGUA C. LTDA.',
      'CORPORACION FAVORITA C.A.',
      'EMPRESA X (S.A.)',
      'EMPRESA Y S.A. (EN LIQUIDACION)',
      '',
      null,
    ]) {
      assert.equal(ecCompanyNameAlias(raw), null, String(raw));
    }
  });
});

describe('entidades públicas: el nombre del SRI y el de Apollo llegan al mismo núcleo', () => {
  it('municipios y distritos metropolitanos', () => {
    for (const name of [
      'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL DEL CANTON CELICA',
      'GAD Municipal de Celica',
      'Municipio de Celica',
      'Alcaldía de Celica',
      'Ilustre Municipalidad del Cantón Celica',
    ]) {
      assert.equal(normalizeEcEntityCore(name), 'GAD MUNICIPAL CELICA', name);
    }
    for (const name of [
      'GOBIERNO AUTONOMO DESCENTRALIZADO DEL DISTRITO METROPOLITANO DE QUITO',
      'Municipio del Distrito Metropolitano de Quito',
      'Alcaldía de Quito',
    ]) {
      assert.equal(normalizeEcEntityCore(name), 'GAD MUNICIPAL QUITO', name);
    }
    assert.equal(normalizeEcEntityCore('M.I. MUNICIPALIDAD DE GUAYAQUIL'), 'GAD MUNICIPAL GUAYAQUIL');
  });

  it('prefecturas y juntas parroquiales', () => {
    for (const name of [
      'GOBIERNO AUTONOMO DESCENTRALIZADO DE LA PROVINCIA DEL CARCHI',
      'Prefectura del Carchi',
      'Gobierno Provincial del Carchi',
      'GAD Provincial del Carchi',
    ]) {
      assert.equal(normalizeEcEntityCore(name), 'GAD PROVINCIAL CARCHI', name);
    }
    for (const name of [
      'GOBIERNO AUTONOMO DESCENTRALIZADO PARROQUIAL RURAL DE TAMBILLO',
      'GOBIERNO AUTONOMO DESCENTRALIZADO DE LA PARROQUIA RURAL TAMBILLO',
      'GAD Parroquial de Tambillo',
    ]) {
      assert.equal(normalizeEcEntityCore(name), 'GAD PARROQUIAL TAMBILLO', name);
    }
  });

  it('lo que no es un gobierno local se compara por su nombre limpio', () => {
    assert.equal(canonicalEcLocalGovernment('HOSPITAL PROVINCIAL GENERAL ISIDRO AYORA'), null);
    assert.equal(normalizeEcEntityCore('MINISTERIO DE SALUD PUBLICA'), 'MINISTERIO DE SALUD PUBLICA');
    assert.equal(normalizeEcEntityCore('CORPORACION FAVORITA C.A.'), 'CORPORACION FAVORITA');
  });
});

describe('dominio declarado en SERCOP', () => {
  it('host limpio desde la URL declarada', () => {
    assert.equal(hostFromDeclaredUrl('http://www.eeq.com.ec/'), 'eeq.com.ec');
    assert.equal(hostFromDeclaredUrl('HTTPS://WWW.Chaide.com/inicio?x=1'), 'chaide.com');
    assert.equal(hostFromDeclaredUrl('http'), null);
    assert.equal(hostFromDeclaredUrl(null), null);
  });

  it('sólo si se parece al nombre (o a su sigla); nunca redes, gobierno ni dos dominios distintos', () => {
    assert.equal(ecCorporateDomainFromUrls({ legalName: 'CHAIDE Y CHAIDE SA', urls: ['http://www.chaide.com'] }), 'chaide.com');
    assert.equal(
      ecCorporateDomainFromUrls({ legalName: 'EMPRESA ELECTRICA REGIONAL DEL SUR SA EERSSA', urls: ['http://www.eerssa.com'] }),
      'eerssa.com',
    );
    assert.equal(ecCorporateDomainFromUrls({ legalName: 'CHAIDE Y CHAIDE SA', urls: ['https://facebook.com/chaide'] }), null);
    assert.equal(ecCorporateDomainFromUrls({ legalName: 'CHAIDE Y CHAIDE SA', urls: ['http://chaide.gob.ec'] }), null);
    assert.equal(ecCorporateDomainFromUrls({ legalName: 'CHAIDE Y CHAIDE SA', urls: ['http://www.otracosa.com'] }), null);
    assert.equal(
      ecCorporateDomainFromUrls({ legalName: 'CHAIDE Y CHAIDE SA', urls: ['http://chaide.com', 'http://chaide.com.ec'] }),
      null,
    );
  });

  it('lee las partes con RUC de una entrega OCDS y descarta un dominio compartido por 3 RUC', () => {
    const parties = readSercopPartyUrls({
      parties: [
        { id: 'EC-RUC-1790000001001-1', name: 'A', contactPoint: { url: 'http://alfa.com' } },
        { id: 'EC-RUC-1790000002001', name: 'B', contactPoint: {} },
        { id: 'OTRO-123', name: 'C' },
      ],
    });
    assert.deepEqual(parties, [
      { ruc: '1790000001001', name: 'A', url: 'http://alfa.com' },
      { ruc: '1790000002001', name: 'B', url: null },
    ]);
    const names: Record<string, string> = {
      '1790000001001': 'ALFA S.A.',
      '1790000002001': 'ALFA SERVICIOS S.A.',
      '1790000003001': 'ALFA COMERCIAL S.A.',
      '1790000004001': 'BETA S.A.',
    };
    const map = buildEcSercopDomainMap(
      [
        { ruc: '1790000001001', name: '', url: 'http://alfa.com' },
        { ruc: '1790000002001', name: '', url: 'http://alfa.com' },
        { ruc: '1790000003001', name: '', url: 'http://alfa.com' },
        { ruc: '1790000004001', name: '', url: 'http://beta.com.ec' },
        { ruc: '1790000005001', name: '', url: 'http://gamma.com' }, // no está en el directorio
      ],
      (ruc) => names[ruc] ?? null,
    );
    assert.deepEqual([...map], [['1790000004001', 'beta.com.ec']]);
  });
});

const DIRECTORY: EcDirectoryRecord = {
  expediente: '47972',
  ruc: '1791256115001',
  legalName: 'CONSORCIO ECUATORIANO DE TELECOMUNICACIONES S.A. CONECEL',
  legalStatus: 'ACTIVA',
  companyType: 'ANÓNIMA',
  province: 'GUAYAS',
  city: 'GUAYAQUIL',
  ciiuCode: 'J6120.01',
};

describe('registro de la Superintendencia con empleados (ec_scvs_registry)', () => {
  it('sólo activas con RUC de sociedad; un RUC, la de más empleados', () => {
    assert.equal(admitEcRegistryCompany(DIRECTORY), '1791256115001');
    assert.equal(admitEcRegistryCompany({ ...DIRECTORY, legalStatus: 'INACTIVA' }), null);
    assert.equal(admitEcRegistryCompany({ ...DIRECTORY, ruc: '1791256115002' }), null);
    assert.equal(admitEcRegistryCompany({ ...DIRECTORY, legalName: '' }), null);
    const small = { record: DIRECTORY, metrics: { year: 2025, employees: 3, salesRevenue: null } };
    const big = { record: DIRECTORY, metrics: { year: 2025, employees: 3302, salesRevenue: null } };
    const none = { record: DIRECTORY, metrics: null };
    assert.equal(pickEcRegistryEntry(pickEcRegistryEntry(undefined, small), big), big);
    assert.equal(pickEcRegistryEntry(big, none), big);
  });

  it('razón social limpia + sigla, ambas con los empleados en el formato del SII de Chile', () => {
    const rows = buildEcScvsRegistryRows({
      ruc: '1791256115001',
      entry: { record: DIRECTORY, metrics: { year: 2025, employees: 3302, salesRevenue: 1 } },
      sourceYear: 2026,
      importedAt: '2026-10-06T00:00:00.000Z',
    });
    assert.deepEqual(
      rows.map((r) => [r.source_key, r.normalized_legal_name, r.source_year, r.record_identity_key]),
      [
        [EC_SCVS_REGISTRY_SOURCE_KEY, 'CONSORCIO ECUATORIANO DE TELECOMUNICACIONES S A CONECEL', 2025, 'tax:1791256115001'],
        [EC_SCVS_ALIAS_REGISTRY_SOURCE_KEY, 'CONECEL', 2025, 'tax:1791256115001'],
      ],
    );
    for (const row of rows) {
      assert.deepEqual(workforceFromRawData(row.raw_data, row.source_key), {
        workers: 3302,
        year: 2025,
        source: row.source_key,
        salesBracket: null,
      });
      assert.equal(getSourceFamily(row.source_key), 'TAX_GRAIN');
    }
  });

  it('menos de 50 empleados con ventas de grande: los empleados NO deciden el tamaño (planilla tercerizada)', () => {
    assert.deepEqual(ecWorkforceFields({ year: 2025, employees: 6, salesRevenue: 1_641_394_550 }), {
      declared_workers: 6,
      metrics_year: 2025,
      workers_omitted_reason: 'sales_above_small_company_ceiling',
    });
    // Pequeña de verdad (ventas bajo el techo) o sin ventas: los empleados deciden.
    assert.deepEqual(ecWorkforceFields({ year: 2025, employees: 6, salesRevenue: 400_000 }), { workers: 6, metrics_year: 2025 });
    assert.deepEqual(ecWorkforceFields({ year: 2025, employees: 6, salesRevenue: null }), { workers: 6, metrics_year: 2025 });
    assert.deepEqual(ecWorkforceFields({ year: 2025, employees: 60, salesRevenue: 9e9 }), { workers: 60, metrics_year: 2025 });
    assert.deepEqual(ecWorkforceFields({ year: 2025, employees: null, salesRevenue: 9e9 }), {});
    assert.equal(EC_SMALL_COMPANY_MAX_SALES_USD, 1_000_000);
    const [row] = buildEcScvsRegistryRows({
      ruc: '0990004196001',
      entry: {
        record: { ...DIRECTORY, ruc: '0990004196001', legalName: 'CORPORACION EL ROSADO S.A.' },
        metrics: { year: 2025, employees: 6, salesRevenue: 1_641_394_550 },
      },
      sourceYear: 2026,
      importedAt: '2026-10-06T00:00:00.000Z',
    });
    assert.equal(workforceFromRawData(row.raw_data, row.source_key), null);
  });

  it('sin ranking: sin empleados y con el año de la carga; nunca representante ni teléfono', () => {
    const [row] = buildEcScvsRegistryRows({
      ruc: '1790016919001',
      entry: { record: { ...DIRECTORY, ruc: '1790016919001', legalName: 'CORPORACION FAVORITA C.A.' }, metrics: null },
      sourceYear: 2026,
      importedAt: '2026-10-06T00:00:00.000Z',
    });
    assert.equal(row.source_year, 2026);
    assert.equal(workforceFromRawData(row.raw_data, row.source_key), null);
    assert.equal(JSON.stringify(row).includes('REPRESENTANTE'), false);
  });
});

function sri(overrides: Partial<EcSriRecord> = {}): EcSriRecord {
  return {
    ruc: '1760001550001',
    legalName: 'GOBIERNO AUTONOMO DESCENTRALIZADO DEL DISTRITO METROPOLITANO DE QUITO',
    status: 'ACTIVO',
    establishment: 1,
    tradeName: '',
    province: 'PICHINCHA',
    canton: 'QUITO',
    ciiuCode: 'O841101',
    ...overrides,
  };
}

describe('catastro del SRI (ec_sri_registry, ec_sri_trade_name_registry)', () => {
  it('lee la fila por cabecera y admite sólo sociedades ACTIVAS (privadas 9 o públicas 6)', () => {
    const record = readEcSriLine({
      NUMERO_RUC: '1790016919001',
      RAZON_SOCIAL: ' CORPORACION  FAVORITA C.A. ',
      ESTADO_CONTRIBUYENTE: 'activo',
      NUMERO_ESTABLECIMIENTO: '12',
      NOMBRE_FANTASIA_COMERCIAL: 'SUPERMAXI',
      DESCRIPCION_PROVINCIA_EST: 'PICHINCHA',
      DESCRIPCION_CANTON_EST: 'QUITO',
      CODIGO_CIIU: 'g471101',
    });
    assert.deepEqual(record, {
      ruc: '1790016919001',
      legalName: 'CORPORACION FAVORITA C.A.',
      status: 'ACTIVO',
      establishment: 12,
      tradeName: 'SUPERMAXI',
      province: 'PICHINCHA',
      canton: 'QUITO',
      ciiuCode: 'G471101',
    });
    assert.equal(admitEcSriRecord(sri()), true);
    assert.equal(admitEcSriRecord(sri({ ruc: '1790016919001' })), true);
    assert.equal(admitEcSriRecord(sri({ status: 'PASIVO' })), false);
    assert.equal(admitEcSriRecord(sri({ ruc: '1712345678001' })), false); // persona natural
    assert.equal(admitEcSriRecord(sri({ ruc: '1760001550002' })), false);
  });

  it('el nombre comercial es el del establecimiento de número más bajo que lo trae', () => {
    let entry = accumulateEcSriEntry(undefined, sri({ establishment: 7, tradeName: 'SUCURSAL NORTE' }));
    entry = accumulateEcSriEntry(entry, sri({ establishment: 1, tradeName: '' }));
    entry = accumulateEcSriEntry(entry, sri({ establishment: 2, tradeName: 'MARCA' }));
    assert.equal(entry.main.establishment, 1);
    assert.equal(entry.tradeName, 'MARCA');
  });

  it('una entidad pública queda con su núcleo canónico; sin nombre comercial no hay pista', () => {
    const rows = buildEcSriRegistryRows({
      entry: accumulateEcSriEntry(undefined, sri()),
      metrics: null,
      sourceYear: 2025,
      importedAt: '2026-10-06T00:00:00.000Z',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_key, EC_SRI_REGISTRY_SOURCE_KEY);
    assert.equal(rows[0].normalized_legal_name, 'GAD MUNICIPAL QUITO');
    assert.equal(rows[0].raw_data.sector_type, 'public');
    assert.equal(rows[0].city, 'QUITO');
    assert.equal(getSourceFamily(EC_SRI_REGISTRY_SOURCE_KEY), 'TAX_GRAIN');
  });

  it('el nombre comercial lleva los empleados de la Superintendencia; uno genérico o igual a la razón social, no', () => {
    const favorita = sri({ ruc: '1790016919001', legalName: 'CORPORACION FAVORITA C.A.', tradeName: 'SUPERMAXI' });
    const rows = buildEcSriRegistryRows({
      entry: accumulateEcSriEntry(undefined, favorita),
      metrics: { year: 2025, employees: 12033, salesRevenue: null },
      sourceYear: 2025,
      importedAt: '2026-10-06T00:00:00.000Z',
    });
    const trade = rows.find((r) => r.source_key === EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY);
    assert.equal(trade?.normalized_legal_name, 'SUPERMAXI');
    assert.equal(trade?.raw_data.workers, 12033);
    assert.equal(getSourceFamily(EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY), 'TAX_GRAIN');
    for (const tradeName of ['MATRIZ', 'CORPORACION FAVORITA', 'AB']) {
      const only = buildEcSriRegistryRows({
        entry: accumulateEcSriEntry(undefined, { ...favorita, tradeName }),
        metrics: null,
        sourceYear: 2025,
        importedAt: '2026-10-06T00:00:00.000Z',
      });
      assert.equal(only.length, 1, tradeName);
    }
  });
});

describe('no volver a proponer lo ya visto (regla común)', () => {
  it('candidata y descarte cerrado: nunca; descarte sin cierre: sólo si ahora hay web', () => {
    assert.equal(isRecycledCountrySourceCompany('candidate', true), true);
    assert.equal(isRecycledCountrySourceCompany('definitive_discard', true), true);
    assert.equal(isRecycledCountrySourceCompany('discard', false), true);
    assert.equal(isRecycledCountrySourceCompany('discard', true), false);
    assert.equal(isRecycledCountrySourceCompany(null, false), false);
    assert.equal(isRecycledCountrySourceCompany(undefined, false), false);
  });
});
