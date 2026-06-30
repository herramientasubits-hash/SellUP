/**
 * Tests unitarios — ChileCompra OCDS Snapshot ETL
 *
 * Sin red real. Prueba acumulador, filtros, montos, mapping y guardianes de escritura.
 */

import assert from 'node:assert/strict';
import { describe, it, mock, beforeEach } from 'node:test';
import {
  processRelease,
  accToSnapshotRow,
  computePriorityScore,
  normalizeChileanLegalName,
  runChileCompraOcdsSnapshotEtl,
} from '../run-chilecompra-ocds-snapshot-etl';
import type { ProcessReleaseCounters } from '../run-chilecompra-ocds-snapshot-etl';
import type { OcdsRelease } from '../types';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeCounters(): ProcessReleaseCounters {
  return {
    processesWithoutAward: 0,
    awardsWithoutSupplierRut: 0,
    awardsWithMissingAmount: 0,
    awardsInNonClpCurrency: 0,
    currenciesSeen: new Set(),
  };
}

function makeRelease(overrides: Partial<OcdsRelease> = {}): OcdsRelease {
  return {
    ocid: 'ocds-70d2nz-4280-24-LP1',
    tender: {
      id: '4280-24-LP1',
      title: 'Licitación de prueba',
      procurementMethod: 'open',
    },
    parties: [
      {
        id: 'supplier-1',
        name: 'Proveedor SA',
        roles: ['supplier'],
        identifier: { scheme: 'CL-RUT', id: '76.543.210-K' },
        address: { region: 'RM', countryName: 'Chile' },
      },
      {
        id: 'buyer-1',
        name: 'Municipalidad de Santiago',
        roles: ['buyer'],
        identifier: { scheme: 'CL-RUT', id: '69.123.456-7' },
        address: { region: 'RM', countryName: 'Chile' },
      },
    ],
    buyer: { id: 'buyer-1', name: 'Municipalidad de Santiago' },
    awards: [
      {
        id: 'award-1',
        status: 'active',
        suppliers: [{ id: 'supplier-1', name: 'Proveedor SA' }],
        // @ts-expect-error -- value no está en OcdsAward tipado pero sí en datos reales
        value: { amount: 1_000_000, currency: 'CLP' },
      },
    ],
    ...overrides,
  };
}

// ─── 1. Acumulador ─────────────────────────────────────────────────────────────

describe('Acumulador — aggregation', () => {
  it('agrega dos adjudicaciones del mismo RUT en una sola fila', () => {
    const map = new Map();
    const counters = makeCounters();

    const release1 = makeRelease({ ocid: 'ocds-70d2nz-4280-24-LP1' });
    const release2 = makeRelease({
      ocid: 'ocds-70d2nz-4280-24-LP2',
      awards: [
        {
          id: 'award-2',
          status: 'active',
          suppliers: [{ id: 'supplier-1', name: 'Proveedor SA' }],
          // @ts-expect-error
          value: { amount: 2_000_000, currency: 'CLP' },
        },
      ],
    });

    processRelease(release1, release1.ocid!, 'http://example.com/1', map, counters);
    processRelease(release2, release2.ocid!, 'http://example.com/2', map, counters);

    assert.equal(map.size, 1, 'debe haber una sola fila por RUT');
    const acc = map.values().next().value;
    assert.equal(acc.awardsCount, 2);
    assert.equal(acc.totalAwardedAmountClp, 3_000_000);
  });

  it('deduplica OCIDs en el acumulador', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease({ ocid: 'ocds-70d2nz-4280-24-LP1' });

    // Procesar dos veces el mismo OCID (simula reintentos)
    processRelease(release, release.ocid!, null, map, counters);
    processRelease(release, release.ocid!, null, map, counters);

    const acc = map.values().next().value;
    assert.equal(acc.ocids.size, 1, 'OCID debe deduplicarse');
  });

  it('deduplica buyer_names y buyer_ruts', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease();

    processRelease(release, release.ocid!, null, map, counters);
    processRelease(release, 'ocds-70d2nz-0000-24-LP2', null, map, counters);

    const acc = map.values().next().value;
    assert.equal(acc.buyerNames.size, 1, 'buyer_names debe deduplicarse');
    assert.equal(acc.buyerRuts.size, 1, 'buyer_ruts debe deduplicarse');
  });

  it('deduplica UNSPSC por código', () => {
    const map = new Map();
    const counters = makeCounters();
    const releaseWithUnspsc = makeRelease({
      tender: {
        id: '4280-24-LP1',
        items: [
          { classification: { scheme: 'UNSPSC', id: '72151501', description: 'Construcción' } },
          { classification: { scheme: 'UNSPSC', id: '72151501', description: 'Construcción dup' } },
        ],
      },
    });

    processRelease(releaseWithUnspsc, releaseWithUnspsc.ocid!, null, map, counters);

    const acc = map.values().next().value;
    assert.equal(acc.unspscMap.size, 1, 'UNSPSC duplicado debe deduplicarse');
  });

  it('aplica tope de 50 a arrays en accToSnapshotRow', () => {
    const map = new Map();
    const counters = makeCounters();

    // Generar 60 releases con diferentes OCIDs y RUT fijo
    for (let i = 0; i < 60; i++) {
      const release = makeRelease({ ocid: `ocds-70d2nz-4280-24-LP${i}` });
      processRelease(release, release.ocid!, `http://example.com/${i}`, map, counters);
    }

    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [1, 2, 3], new Date().toISOString());
    const signals = row['signals'] as Record<string, unknown>;

    assert.ok((signals['ocids'] as unknown[]).length <= 50, 'ocids debe tener máximo 50');
    assert.ok((signals['source_urls'] as unknown[]).length <= 50, 'source_urls debe tener máximo 50');
  });
});

// ─── 2. Filtros ────────────────────────────────────────────────────────────────

describe('Filtros — descarte de procesos/awards', () => {
  it('descarta proceso sin award y aumenta processes_without_award', () => {
    const map = new Map();
    const counters = makeCounters();
    const release: OcdsRelease = { ...makeRelease(), awards: [] };

    const result = processRelease(release, release.ocid!, null, map, counters);

    assert.equal(result, false);
    assert.equal(map.size, 0);
    assert.equal(counters.processesWithoutAward, 1);
  });

  it('descarta award sin supplier en la lista', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease({
      awards: [{ id: 'award-x', status: 'active', suppliers: [] }],
    });

    processRelease(release, release.ocid!, null, map, counters);

    assert.equal(map.size, 0);
    assert.equal(counters.processesWithoutAward, 1);
  });

  it('descarta award sin RUT resoluble y aumenta awards_without_supplier_rut', () => {
    const map = new Map();
    const counters = makeCounters();
    // supplier-999 no tiene party correspondiente
    const release = makeRelease({
      awards: [
        {
          id: 'award-1',
          status: 'active',
          suppliers: [{ id: 'supplier-999', name: 'Sin RUT' }],
          // @ts-expect-error
          value: { amount: 1_000_000, currency: 'CLP' },
        },
      ],
    });

    processRelease(release, release.ocid!, null, map, counters);

    assert.equal(map.size, 0);
    assert.equal(counters.awardsWithoutSupplierRut, 1);
  });

  it('nunca escribe normalized_tax_id null', () => {
    const map = new Map();
    const counters = makeCounters();
    // Party con identifier vacío
    const release = makeRelease({
      parties: [
        {
          id: 'supplier-empty',
          name: 'Sin ID',
          roles: ['supplier'],
          identifier: { scheme: 'CL-RUT', id: '' },
        },
      ],
      awards: [
        {
          id: 'award-1',
          status: 'active',
          suppliers: [{ id: 'supplier-empty', name: 'Sin ID' }],
          // @ts-expect-error
          value: { amount: 500_000, currency: 'CLP' },
        },
      ],
    });

    processRelease(release, release.ocid!, null, map, counters);

    for (const acc of map.values()) {
      assert.ok(
        acc.normalizedTaxId !== null && acc.normalizedTaxId.length > 0,
        'normalizedTaxId nunca debe ser null o vacío',
      );
    }
  });
});

// ─── 3. Montos ─────────────────────────────────────────────────────────────────

describe('Montos — suma solo CLP', () => {
  it('suma solo montos CLP', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease();
    processRelease(release, release.ocid!, null, map, counters);
    const acc = map.values().next().value;
    assert.equal(acc.totalAwardedAmountClp, 1_000_000);
  });

  it('no suma montos non-CLP y aumenta awards_in_non_clp_currency', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease({
      awards: [
        {
          id: 'award-usd',
          status: 'active',
          suppliers: [{ id: 'supplier-1', name: 'Proveedor SA' }],
          // @ts-expect-error
          value: { amount: 10_000, currency: 'USD' },
        },
      ],
    });

    processRelease(release, release.ocid!, null, map, counters);

    const acc = map.values().next().value;
    assert.equal(acc.totalAwardedAmountClp, 0);
    assert.equal(acc.awardsInNonClpCurrency, 1);
    assert.equal(counters.awardsInNonClpCurrency, 1);
  });

  it('cuenta awards_with_missing_amount cuando falta el monto', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease({
      awards: [
        {
          id: 'award-no-amount',
          status: 'active',
          suppliers: [{ id: 'supplier-1', name: 'Proveedor SA' }],
          // sin value
        },
      ],
    });

    processRelease(release, release.ocid!, null, map, counters);

    const acc = map.values().next().value;
    assert.equal(acc.awardsWithMissingAmount, 1);
    assert.equal(counters.awardsWithMissingAmount, 1);
    assert.equal(acc.totalAwardedAmountClp, 0);
  });

  it('currencies_seen se deduplica correctamente', () => {
    const map = new Map();
    const counters = makeCounters();

    const release1 = makeRelease({
      ocid: 'ocds-70d2nz-1111-24-LP1',
      awards: [
        {
          id: 'a1',
          status: 'active',
          suppliers: [{ id: 'supplier-1', name: 'Proveedor SA' }],
          // @ts-expect-error
          value: { amount: 100, currency: 'USD' },
        },
      ],
    });
    const release2 = makeRelease({
      ocid: 'ocds-70d2nz-2222-24-LP2',
      awards: [
        {
          id: 'a2',
          status: 'active',
          suppliers: [{ id: 'supplier-1', name: 'Proveedor SA' }],
          // @ts-expect-error
          value: { amount: 200, currency: 'USD' },
        },
      ],
    });

    processRelease(release1, release1.ocid!, null, map, counters);
    processRelease(release2, release2.ocid!, null, map, counters);

    assert.equal(counters.currenciesSeen.size, 1, 'USD debe aparecer solo una vez');
    assert.ok(counters.currenciesSeen.has('USD'));
  });
});

// ─── 4. Mapping ────────────────────────────────────────────────────────────────

describe('Mapping — campos snapshot', () => {
  it('region/city/department/sector quedan null', () => {
    const map = new Map();
    const counters = makeCounters();
    processRelease(makeRelease(), 'ocds-70d2nz-4280-24-LP1', null, map, counters);
    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [1], new Date().toISOString());

    assert.equal(row['region'], null);
    assert.equal(row['city'], null);
    assert.equal(row['department'], null);
    assert.equal(row['sector'], null);
  });

  it('financials queda {}', () => {
    const map = new Map();
    const counters = makeCounters();
    processRelease(makeRelease(), 'ocds-70d2nz-4280-24-LP1', null, map, counters);
    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [1], new Date().toISOString());

    assert.deepEqual(row['financials'], {});
  });

  it('raw_data no contiene release completo', () => {
    const map = new Map();
    const counters = makeCounters();
    processRelease(makeRelease(), 'ocds-70d2nz-4280-24-LP1', null, map, counters);
    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [1], new Date().toISOString());
    const rawData = row['raw_data'] as Record<string, unknown>;

    assert.ok(!('tender' in rawData), 'raw_data no debe contener release.tender');
    assert.ok(!('parties' in rawData), 'raw_data no debe contener release.parties');
    assert.ok(!('awards' in rawData), 'raw_data no debe contener release.awards');
    assert.equal(rawData['etl_version'], 'v1.16CL-D.1');
    assert.equal(rawData['source'], 'chilecompra_ocds');
  });

  it('source_key/country_code/source_year correctos', () => {
    const map = new Map();
    const counters = makeCounters();
    processRelease(makeRelease(), 'ocds-70d2nz-4280-24-LP1', null, map, counters);
    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [1], new Date().toISOString());

    assert.equal(row['source_key'], 'cl_chilecompra_ocds');
    assert.equal(row['country_code'], 'CL');
    assert.equal(row['source_year'], 2024);
  });

  it('normalizeChileanLegalName quita tildes y sufijos legales', () => {
    assert.equal(normalizeChileanLegalName('Constructora Pérez Ltda.'), 'constructora perez');
    assert.equal(normalizeChileanLegalName('Servicios ABC S.A.'), 'servicios abc');
    assert.equal(normalizeChileanLegalName('Empresa SpA'), 'empresa');
    assert.equal(normalizeChileanLegalName(null), null);
    assert.equal(normalizeChileanLegalName(''), null);
  });
});

const mockEmptyListado = async () => ({ ok: true as const, total: 0, items: [] });

// ─── 5. Dry-run (unit) ─────────────────────────────────────────────────────────

describe('Dry-run — no escribe', () => {
  it('retorna writes_performed = 0 en dry-run', async () => {
    const result = await runChileCompraOcdsSnapshotEtl({
      year: 2024,
      months: [1],
      maxProcessesPerMonth: 1,
      dryRun: true,
      _fetchListado: mockEmptyListado,
    });

    assert.equal(result.dry_run, true);
    assert.equal(result.writes_performed, 0);
    assert.equal(result.records_upserted, 0);
  });
});

// ─── 6. Partial write guard ────────────────────────────────────────────────────

describe('Partial write guard', () => {
  it('dryRun=false + months parcial + allowPartialWrite=false => error', async () => {
    const result = await runChileCompraOcdsSnapshotEtl({
      year: 2024,
      months: [6],
      dryRun: false,
      allowPartialWrite: false,
    });

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes('Partial write blocked')),
      'debe incluir mensaje de partial write bloqueado',
    );
  });

  it('dryRun=true + months parcial => permitido (no llama DB)', async () => {
    const result = await runChileCompraOcdsSnapshotEtl({
      year: 2024,
      months: [6],
      dryRun: true,
      _fetchListado: mockEmptyListado,
    });

    assert.equal(result.ok, true);
    assert.equal(result.writes_performed, 0);
  });

  it('dryRun=false + año completo (1..12) => no bloquea', async () => {
    // Sin SERVICE_ROLE_KEY el write fallará, pero verificamos que NO sea error de partial write.
    const result = await runChileCompraOcdsSnapshotEtl({
      year: 2024,
      months: [1,2,3,4,5,6,7,8,9,10,11,12],
      dryRun: false,
      allowPartialWrite: false,
      _fetchListado: mockEmptyListado,
    });

    const hasPartialWriteError = result.errors.some((e) => e.includes('Partial write blocked'));
    assert.equal(hasPartialWriteError, false, 'no debe bloquear año completo por partial write');
  });
});

// ─── 7. Priority score ─────────────────────────────────────────────────────────

describe('Priority score', () => {
  it('score 10 para montos > 10B CLP', () => {
    assert.equal(computePriorityScore(15_000_000_000, 1), 10);
  });
  it('score 7 para montos entre 1B y 10B CLP', () => {
    assert.equal(computePriorityScore(5_000_000_000, 1), 7);
  });
  it('score 5 para montos entre 100M y 1B CLP', () => {
    assert.equal(computePriorityScore(500_000_000, 1), 5);
  });
  it('score mínimo 1 para montos bajos y pocos awards', () => {
    assert.equal(computePriorityScore(0, 1), 1);
  });
  it('score 2 para awardsCount > 5 con monto bajo', () => {
    assert.equal(computePriorityScore(0, 6), 2);
  });
});

// ─── 8. Award endpoint ─────────────────────────────────────────────────────────

describe('Award endpoint — ETL usa urlAward cuando existe', () => {
  it('llama _fetchAward cuando el item tiene urlAward y produce métricas de adjudicación', async () => {
    const awardRelease: OcdsRelease = {
      ocid: 'ocds-70d2nz-4280-24-LP99',
      awards: [
        {
          id: 'award-99',
          status: 'active',
          suppliers: [{ id: 'supplier-1', name: 'Proveedor SA' }],
          // @ts-expect-error
          value: { amount: 5_000_000, currency: 'CLP' },
        },
      ],
      parties: [
        {
          id: 'supplier-1',
          name: 'Proveedor SA',
          roles: ['supplier'],
          identifier: { scheme: 'CL-RUT', id: '76.543.210-K' },
        },
      ],
    };

    const tenderRelease: OcdsRelease = {
      ocid: 'ocds-70d2nz-4280-24-LP99',
      tender: { id: '4280-24-LP99', title: 'Licitación test award' },
      parties: [],
      awards: [],
    };

    const mockListado = async () => ({
      ok: true as const,
      total: 1,
      items: [
        {
          ocid: 'ocds-70d2nz-4280-24-LP99',
          urlTender: 'https://api.mercadopublico.cl/APISOCDS/OCDS/tender/4280-24-LP99',
          urlAward: 'https://api.mercadopublico.cl/APISOCDS/OCDS/award/4280-24-LP99',
        },
      ],
    });

    let awardFetchCalled = false;
    const mockFetchAward = async (_url: string) => {
      awardFetchCalled = true;
      return { ok: true as const, release: awardRelease };
    };

    const mockFetchTender = async (_ocid: string) => ({
      ok: true as const,
      release: tenderRelease,
    });

    const result = await runChileCompraOcdsSnapshotEtl({
      year: 2024,
      months: [6],
      dryRun: true,
      _fetchListado: mockListado,
      _fetchTender: mockFetchTender,
      _fetchAward: mockFetchAward,
    });

    assert.equal(awardFetchCalled, true, 'debe llamar _fetchAward cuando urlAward existe');
    assert.equal(result.awarded_processes, 1, 'debe contar el proceso como adjudicado');
    assert.equal(result.suppliers_unique, 1, 'debe contar 1 proveedor único');
    assert.equal(result.records_found, 1, 'debe encontrar 1 record');
    assert.equal(result.award_url_missing, 0, 'no debe contar award_url_missing');
    assert.equal(result.writes_performed, 0);
  });

  it('cuenta award_url_missing cuando el item no tiene urlAward', async () => {
    const mockListado = async () => ({
      ok: true as const,
      total: 1,
      items: [
        {
          ocid: 'ocds-70d2nz-4280-24-LP98',
          urlTender: 'https://api.mercadopublico.cl/APISOCDS/OCDS/tender/4280-24-LP98',
          urlAward: null,
        },
      ],
    });

    const mockFetchTender = async (_ocid: string) => ({
      ok: true as const,
      release: { ocid: 'ocds-70d2nz-4280-24-LP98', awards: [], parties: [] } as OcdsRelease,
    });

    const result = await runChileCompraOcdsSnapshotEtl({
      year: 2024,
      months: [6],
      dryRun: true,
      _fetchListado: mockListado,
      _fetchTender: mockFetchTender,
    });

    assert.equal(result.award_url_missing, 1, 'debe contar 1 award_url_missing');
    assert.equal(result.processes_without_award, 1, 'proceso sin awards válidos');
  });

  it('continúa procesando si award endpoint falla', async () => {
    const mockListado = async () => ({
      ok: true as const,
      total: 1,
      items: [
        {
          ocid: 'ocds-70d2nz-4280-24-LP97',
          urlTender: 'https://api.mercadopublico.cl/APISOCDS/OCDS/tender/4280-24-LP97',
          urlAward: 'https://api.mercadopublico.cl/APISOCDS/OCDS/award/4280-24-LP97',
        },
      ],
    });

    const mockFetchTender = async (_ocid: string) => ({
      ok: true as const,
      release: { ocid: 'ocds-70d2nz-4280-24-LP97', awards: [], parties: [] } as OcdsRelease,
    });

    const mockFetchAward = async (_url: string) => ({
      ok: false as const,
      error: 'HTTP 503 en award',
    });

    const result = await runChileCompraOcdsSnapshotEtl({
      year: 2024,
      months: [6],
      dryRun: true,
      _fetchListado: mockListado,
      _fetchTender: mockFetchTender,
      _fetchAward: mockFetchAward,
    });

    assert.equal(result.ok, true, 'ETL no debe abortar por fallo en award endpoint');
    assert.ok(
      result.errors.some((e) => e.includes('HTTP 503 en award')),
      'debe registrar el error del award en errors',
    );
    assert.equal(result.processes_scanned, 1);
    assert.equal(result.award_url_missing, 0, 'no es missing url, es fallo de fetch');
  });
});
