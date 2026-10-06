/**
 * SOURCES-EC-FREE-DISCOVERY-1 — filas `ec_scvs_directory` (directorio × ranking
 * de la Superintendencia de Compañías). Puro, nombres sintéticos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  admitEcDirectoryCompany,
  buildEcScvsDirectoryRow,
  EC_SCVS_DIRECTORY_MIN_EMPLOYEES,
  EC_SCVS_DIRECTORY_SOURCE_KEY,
  latestRanking,
  readEcDirectoryRecord,
  readEcRankingLine,
  type EcDirectoryRecord,
  type EcRankingMetrics,
} from '../ec-scvs-directory-rows';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';
import { getSourceFamily } from '../../../record-identity';

const DIRECTORY_ROW = {
  'No. FILA': 1,
  EXPEDIENTE: ' 12345 ',
  RUC: '1791234567001',
  NOMBRE: '  EMPRESA   SINTETICA S.A. ',
  'SITUACIÓN LEGAL': 'activa',
  TIPO: 'ANÓNIMA',
  PROVINCIA: 'PICHINCHA',
  CIUDAD: 'QUITO',
  CALLE: 'AV. SINTETICA',
  TELÉFONO: '022000000',
  REPRESENTANTE: 'PERSONA SINTETICA',
  CARGO: 'GERENTE GENERAL',
  'CIIU NIVEL 6': ' j6201.01 ',
};

function record(overrides: Partial<EcDirectoryRecord> = {}): EcDirectoryRecord {
  return { ...(readEcDirectoryRecord(DIRECTORY_ROW) as EcDirectoryRecord), ...overrides };
}

const METRICS: EcRankingMetrics = { year: 2025, employees: 350, salesRevenue: 12_500_000.5 };

describe('lectura del directorio', () => {
  it('toma sólo lo necesario, normaliza espacios, situación y CIIU', () => {
    assert.deepEqual(readEcDirectoryRecord(DIRECTORY_ROW), {
      expediente: '12345',
      ruc: '1791234567001',
      legalName: 'EMPRESA SINTETICA S.A.',
      legalStatus: 'ACTIVA',
      companyType: 'ANÓNIMA',
      province: 'PICHINCHA',
      city: 'QUITO',
      ciiuCode: 'J6201.01',
    });
  });

  it('sin expediente o sin RUC no hay registro; un CIIU inválido queda en null', () => {
    assert.equal(readEcDirectoryRecord({ ...DIRECTORY_ROW, EXPEDIENTE: '' }), null);
    assert.equal(readEcDirectoryRecord({ ...DIRECTORY_ROW, RUC: null }), null);
    assert.equal(readEcDirectoryRecord({ ...DIRECTORY_ROW, 'CIIU NIVEL 6': 'J62' })?.ciiuCode, null);
  });
});

describe('lectura del ranking', () => {
  it('empleados decimales se truncan; ingresos y año se leen como número', () => {
    assert.deepEqual(readEcRankingLine({ anio: '2025', expediente: ' 12345 ', n_empleados: '350.0', ingresos_ventas: '1200.5' }), [
      '12345',
      { year: 2025, employees: 350, salesRevenue: 1200.5 },
    ]);
  });

  it('empleados vacíos o negativos quedan en null; sin año o sin expediente no hay fila', () => {
    assert.equal(readEcRankingLine({ anio: '2025', expediente: '1', n_empleados: '' })?.[1].employees, null);
    assert.equal(readEcRankingLine({ anio: '2025', expediente: '1', n_empleados: '-3' })?.[1].employees, null);
    assert.equal(readEcRankingLine({ anio: '', expediente: '1', n_empleados: '300' }), null);
    assert.equal(readEcRankingLine({ anio: '2025.5', expediente: '1', n_empleados: '300' }), null);
    assert.equal(readEcRankingLine({ anio: '2025', expediente: ' ', n_empleados: '300' }), null);
  });

  it('se queda con el año más reciente', () => {
    const old = { year: 2009, employees: 900, salesRevenue: null };
    const recent = { year: 2025, employees: 250, salesRevenue: null };
    assert.equal(latestRanking(undefined, old), old);
    assert.equal(latestRanking(old, recent), recent);
    assert.equal(latestRanking(recent, old), recent);
  });
});

describe('admisión', () => {
  it('activa, RUC de sociedad y 100 o más empleados → RUC (dueña 06-10: «100+ como Chile»)', () => {
    assert.equal(EC_SCVS_DIRECTORY_MIN_EMPLOYEES, 100);
    assert.equal(admitEcDirectoryCompany(record(), METRICS), '1791234567001');
    assert.equal(admitEcDirectoryCompany(record(), { ...METRICS, employees: 100 }), '1791234567001');
    assert.equal(admitEcDirectoryCompany(record({ ruc: '1791-234567-001' }), METRICS), '1791234567001');
  });

  it('no entra: inactiva, en liquidación, sin nombre, pequeña, sin dato o sin ranking', () => {
    assert.equal(admitEcDirectoryCompany(record({ legalStatus: 'INACTIVA' }), METRICS), null);
    assert.equal(admitEcDirectoryCompany(record({ legalStatus: 'DISOLUCIÓN Y LIQUIDACIÓN OFICIO INSCRITA EN RM' }), METRICS), null);
    assert.equal(admitEcDirectoryCompany(record({ legalName: '' }), METRICS), null);
    assert.equal(admitEcDirectoryCompany(record(), { ...METRICS, employees: 99 }), null);
    assert.equal(admitEcDirectoryCompany(record(), { ...METRICS, employees: null }), null);
    assert.equal(admitEcDirectoryCompany(record(), null), null);
  });

  it('no entra un RUC que no es de sociedad o tiene formato inválido', () => {
    for (const ruc of ['1791234567002', '9991234567001', '179123456700', 'ABC1234567001']) {
      assert.equal(admitEcDirectoryCompany(record({ ruc }), METRICS), null, ruc);
    }
  });
});

describe('fila ec_scvs_directory', () => {
  const built = buildEcScvsDirectoryRow({
    record: record(),
    ruc: '1791234567001',
    metrics: METRICS,
    priorityScore: 87.654,
    importedAt: '2026-10-02T00:00:00.000Z',
  });

  it('identidad por RUC (TAX_GRAIN), país, año y percentil redondeado', () => {
    assert.equal(getSourceFamily(EC_SCVS_DIRECTORY_SOURCE_KEY), 'TAX_GRAIN');
    assert.equal(built.source_key, 'ec_scvs_directory');
    assert.equal(built.country_code, 'EC');
    assert.equal(built.source_year, 2025);
    assert.equal(built.tax_id, '1791234567001');
    assert.equal(built.normalized_tax_id, '1791234567001');
    assert.equal(built.record_identity_key, 'tax:1791234567001');
    assert.equal(built.priority_score, 87.65);
    assert.equal(built.city, 'QUITO');
    assert.equal(built.region, 'PICHINCHA');
    assert.equal(built.sector, 'J6201.01');
  });

  it('macro de la tabla, empleados con su año en el formato que ya lee el SII de Chile', () => {
    assert.equal(built.raw_data.macro_industry_key, 'technology');
    assert.equal(built.raw_data.macro_table_version, 'ec-ciiu4-inec-macro-v2');
    assert.deepEqual(workforceFromRawData(built.raw_data, 'ec_scvs_directory'), {
      workers: 350,
      year: 2025,
      source: 'ec_scvs_directory',
      salesBracket: null,
    });
    assert.deepEqual(built.financials, { sales_revenue_usd: 12_500_000.5 });
  });

  it('sin ingresos no inventa financieros; un CIIU sin macro guarda macro null', () => {
    const plain = buildEcScvsDirectoryRow({
      record: record({ ciiuCode: 'I5510.01' }),
      ruc: '1791234567001',
      metrics: { ...METRICS, salesRevenue: null },
      priorityScore: 150,
      importedAt: '2026-10-02T00:00:00.000Z',
    });
    assert.deepEqual(plain.financials, {});
    assert.equal(plain.raw_data.macro_industry_key, null);
    assert.equal(plain.priority_score, 100);
  });

  it('SOURCES-EC-CLOSE-1: sin dominio de SERCOP no hay web; con él, dominio y origen', () => {
    assert.equal('website_domain' in built.raw_data, false);
    const withWeb = buildEcScvsDirectoryRow({
      record: record(),
      ruc: '1791234567001',
      metrics: METRICS,
      priorityScore: 50,
      importedAt: '2026-10-02T00:00:00.000Z',
      websiteDomain: ' Sintetica.COM.ec ',
    });
    assert.equal(withWeb.raw_data.website_domain, 'sintetica.com.ec');
    assert.equal(withWeb.raw_data.website_domain_source, 'sercop_ocds_contact_url');
  });

  it('🔴 no guarda representante legal, cargo, teléfono ni dirección', () => {
    const serialized = JSON.stringify(built);
    for (const leaked of ['PERSONA SINTETICA', 'GERENTE', '022000000', 'AV. SINTETICA']) {
      assert.equal(serialized.includes(leaked), false, leaked);
    }
  });
});
