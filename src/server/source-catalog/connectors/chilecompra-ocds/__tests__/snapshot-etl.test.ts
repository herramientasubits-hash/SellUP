/**
 * Tests unitarios — ChileCompra OCDS Snapshot ETL
 *
 * Sin red real. Prueba acumulador, filtros, montos, mapping y guardianes de escritura.
 */

import assert from 'node:assert/strict';
import { describe, it, mock, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  processRelease,
  accToSnapshotRow,
  computePriorityScore,
  normalizeChileanLegalName,
  cleanOcdsComposedName,
  expandOcdsComposedName,
  runChileCompraOcdsSnapshotEtl,
} from '../run-chilecompra-ocds-snapshot-etl';
import type { ProcessReleaseCounters } from '../run-chilecompra-ocds-snapshot-etl';
import type { OcdsRelease } from '../types';
import {
  deriveTaxRecordIdentity,
  validateRecordIdentityKey,
  RECORD_IDENTITY_ON_CONFLICT,
} from '../../../record-identity';

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
    assert.equal(rawData['etl_version'], 'v1.16CL-D.2');
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

// ─── 8. Name cleanup ──────────────────────────────────────────────────────────

describe('cleanOcdsComposedName — limpieza de nombres con pipe', () => {
  it('nombre sin pipe: retorna tal cual sin hadPipe', () => {
    const result = cleanOcdsComposedName('DEMARCO S.A.');
    assert.equal(result.cleanName, 'DEMARCO S.A.');
    assert.equal(result.hadPipe, false);
    assert.deepEqual(result.segments, ['DEMARCO S.A.']);
  });

  it('nombre duplicado con pipe se colapsa al primero', () => {
    const result = cleanOcdsComposedName('DEMARCO S.A. | DEMARCO S.A.');
    assert.equal(result.cleanName, 'DEMARCO S.A.');
    assert.equal(result.hadPipe, true);
  });

  it('razón social + nombre comercial distintos: conserva primer segmento', () => {
    const result = cleanOcdsComposedName(
      'CONSULTORA, CARLA PATRICIA ROJAS NECULHUAL EMPRESA INDIVIDUAL DE RESPO | Diversity Development Consulting',
    );
    assert.equal(
      result.cleanName,
      'CONSULTORA, CARLA PATRICIA ROJAS NECULHUAL EMPRESA INDIVIDUAL DE RESPO',
    );
    assert.equal(result.hadPipe, true);
    assert.equal(result.segments.length, 2);
  });

  it('variante de capitalización con pipe: conserva primer segmento', () => {
    const result = cleanOcdsComposedName('Datamedica S.A. | Datamedica SPA.');
    assert.equal(result.cleanName, 'Datamedica S.A.');
    assert.equal(result.hadPipe, true);
  });

  it('null/vacío: retorna cleanName null', () => {
    assert.equal(cleanOcdsComposedName(null).cleanName, null);
    assert.equal(cleanOcdsComposedName('').cleanName, null);
    assert.equal(cleanOcdsComposedName('   ').cleanName, null);
  });
});

describe('expandOcdsComposedName — expansión buyer_names', () => {
  it('buyer duplicado con pipe se colapsa a un solo segmento', () => {
    const result = expandOcdsComposedName(
      'ILUSTRE MUNICIPALIDAD DE SAN CARLOS | ILUSTRE MUNICIPALIDAD DE SAN CARLOS',
    );
    assert.deepEqual(result, ['ILUSTRE MUNICIPALIDAD DE SAN CARLOS']);
  });

  it('organismo + unidad compradora distintos se conservan como dos segmentos', () => {
    const result = expandOcdsComposedName(
      'SERVICIO DE SALUD VINA DEL MAR QUILLOTA | Hospital San Martín de Quillota',
    );
    assert.equal(result.length, 2);
    assert.equal(result[0], 'SERVICIO DE SALUD VINA DEL MAR QUILLOTA');
    assert.equal(result[1], 'Hospital San Martín de Quillota');
  });

  it('nombre sin pipe: retorna array con un elemento', () => {
    const result = expandOcdsComposedName('Ministerio de Salud');
    assert.deepEqual(result, ['Ministerio de Salud']);
  });

  it('null/vacío: retorna array vacío', () => {
    assert.deepEqual(expandOcdsComposedName(null), []);
    assert.deepEqual(expandOcdsComposedName(''), []);
  });
});

describe('Name cleanup — integración en processRelease', () => {
  it('supplier con nombre duplicado pipe: legal_name limpio, original guardado', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease({
      parties: [
        {
          id: 'supplier-1',
          name: 'DEMARCO S.A. | DEMARCO S.A.',
          roles: ['supplier'],
          identifier: { scheme: 'CL-RUT', id: '76.543.210-K' },
        },
        {
          id: 'buyer-1',
          name: 'Municipalidad de Santiago',
          roles: ['buyer'],
          identifier: { scheme: 'CL-RUT', id: '69.123.456-7' },
        },
      ],
      awards: [
        {
          id: 'award-1',
          status: 'active',
          suppliers: [{ id: 'supplier-1', name: 'DEMARCO S.A. | DEMARCO S.A.' }],
          // @ts-expect-error
          value: { amount: 500_000, currency: 'CLP' },
        },
      ],
    });

    processRelease(release, release.ocid!, null, map, counters);

    const acc = map.values().next().value;
    assert.equal(acc.legalName, 'DEMARCO S.A.', 'legal_name debe estar limpio');
    assert.equal(
      acc.originalLegalNameSample,
      'DEMARCO S.A. | DEMARCO S.A.',
      'original debe guardarse para trazabilidad',
    );
  });

  it('normalized_legal_name se calcula desde el nombre limpio (sin pipe)', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease({
      parties: [
        {
          id: 'supplier-1',
          name: 'Servicios Pérez Ltda. | Servicios Pérez Ltda.',
          roles: ['supplier'],
          identifier: { scheme: 'CL-RUT', id: '76.543.210-K' },
        },
        {
          id: 'buyer-1',
          name: 'Municipalidad',
          roles: ['buyer'],
          identifier: { scheme: 'CL-RUT', id: '69.123.456-7' },
        },
      ],
      awards: [
        {
          id: 'award-1',
          status: 'active',
          suppliers: [{ id: 'supplier-1', name: 'Servicios Pérez Ltda. | Servicios Pérez Ltda.' }],
          // @ts-expect-error
          value: { amount: 100_000, currency: 'CLP' },
        },
      ],
    });

    processRelease(release, release.ocid!, null, map, counters);
    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [6], new Date().toISOString());

    assert.equal(row['legal_name'], 'Servicios Pérez Ltda.', 'legal_name sin pipe');
    const normalizedName = row['normalized_legal_name'] as string | null;
    assert.ok(normalizedName !== null, 'normalized_legal_name no debe ser null');
    assert.ok(
      !normalizedName!.includes('|'),
      'normalized_legal_name no debe contener pipe',
    );
  });

  it('buyer duplicado con pipe: buyerNames tiene solo un segmento', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease({
      parties: [
        {
          id: 'supplier-1',
          name: 'Proveedor SA',
          roles: ['supplier'],
          identifier: { scheme: 'CL-RUT', id: '76.543.210-K' },
        },
        {
          id: 'buyer-1',
          name: 'ILUSTRE MUNICIPALIDAD DE SAN CARLOS | ILUSTRE MUNICIPALIDAD DE SAN CARLOS',
          roles: ['buyer'],
          identifier: { scheme: 'CL-RUT', id: '69.123.456-7' },
        },
      ],
      buyer: { id: 'buyer-1', name: 'ILUSTRE MUNICIPALIDAD DE SAN CARLOS | ILUSTRE MUNICIPALIDAD DE SAN CARLOS' },
    });

    processRelease(release, release.ocid!, null, map, counters);

    const acc = map.values().next().value;
    assert.equal(acc.buyerNames.size, 1, 'buyer duplicado debe colapsar a 1');
    assert.ok(acc.buyerNames.has('ILUSTRE MUNICIPALIDAD DE SAN CARLOS'));
  });

  it('buyer organismo + unidad distintos: buyerNames tiene dos segmentos', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease({
      parties: [
        {
          id: 'supplier-1',
          name: 'Proveedor SA',
          roles: ['supplier'],
          identifier: { scheme: 'CL-RUT', id: '76.543.210-K' },
        },
        {
          id: 'buyer-1',
          name: 'SERVICIO DE SALUD VINA DEL MAR QUILLOTA | Hospital San Martín de Quillota',
          roles: ['buyer'],
          identifier: { scheme: 'CL-RUT', id: '69.999.999-9' },
        },
      ],
      buyer: { id: 'buyer-1', name: 'SERVICIO DE SALUD VINA DEL MAR QUILLOTA | Hospital San Martín de Quillota' },
    });

    processRelease(release, release.ocid!, null, map, counters);

    const acc = map.values().next().value;
    assert.equal(acc.buyerNames.size, 2, 'organismo + unidad deben conservarse como 2 entries');
    assert.ok(acc.buyerNames.has('SERVICIO DE SALUD VINA DEL MAR QUILLOTA'));
    assert.ok(acc.buyerNames.has('Hospital San Martín de Quillota'));
  });

  it('raw_data conserva original_supplier_name_sample cuando hubo limpieza', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease({
      parties: [
        {
          id: 'supplier-1',
          name: 'Empresa ABC | ABC Consulting',
          roles: ['supplier'],
          identifier: { scheme: 'CL-RUT', id: '76.543.210-K' },
        },
        {
          id: 'buyer-1',
          name: 'Municipalidad',
          roles: ['buyer'],
          identifier: { scheme: 'CL-RUT', id: '69.123.456-7' },
        },
      ],
      awards: [
        {
          id: 'award-1',
          status: 'active',
          suppliers: [{ id: 'supplier-1', name: 'Empresa ABC | ABC Consulting' }],
          // @ts-expect-error
          value: { amount: 200_000, currency: 'CLP' },
        },
      ],
    });

    processRelease(release, release.ocid!, null, map, counters);
    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [6], new Date().toISOString());
    const rawData = row['raw_data'] as Record<string, unknown>;

    assert.equal(
      rawData['original_supplier_name_sample'],
      'Empresa ABC | ABC Consulting',
      'raw_data debe conservar el nombre original con pipe',
    );
  });

  it('raw_data original_supplier_name_sample es null cuando no hubo limpieza', () => {
    const map = new Map();
    const counters = makeCounters();
    processRelease(makeRelease(), makeRelease().ocid!, null, map, counters);
    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [1], new Date().toISOString());
    const rawData = row['raw_data'] as Record<string, unknown>;

    assert.equal(
      rawData['original_supplier_name_sample'],
      null,
      'sin pipe no debe guardar original',
    );
  });
});

// ─── 9. Award endpoint ─────────────────────────────────────────────────────────

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

// ─── 10. record_identity_key shadow write (APP-A P2A) ─────────────────────────

describe('record_identity_key shadow write (APP-A P2A)', () => {
  it('accToSnapshotRow derives record_identity_key = tax:<normalizedTaxId>', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease();

    processRelease(release, release.ocid!, null, map, counters);
    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [1], new Date().toISOString());

    const identity = deriveTaxRecordIdentity(acc.normalizedTaxId);
    assert.equal(identity.status, 'resolved');
    if (identity.status !== 'resolved') return;

    assert.equal(row['record_identity_key'], identity.recordIdentityKey);
    assert.equal(row['record_identity_key'], `tax:${acc.normalizedTaxId}`);
  });

  it('two releases for the same supplier RUT collapse into one row with one record_identity_key (no row exclusion, no multiplicity change)', () => {
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
          // @ts-expect-error -- value no está en OcdsAward tipado pero sí en datos reales
          value: { amount: 2_000_000, currency: 'CLP' },
        },
      ],
    });

    processRelease(release1, release1.ocid!, null, map, counters);
    processRelease(release2, release2.ocid!, null, map, counters);

    assert.equal(map.size, 1, 'sigue habiendo una sola fila por RUT (sin cambio de multiplicidad)');
    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [1], new Date().toISOString());

    assert.equal(row['record_identity_key'], `tax:${acc.normalizedTaxId}`);
  });

  it('upsert onConflict target is cut over to RECORD_IDENTITY_ON_CONFLICT (APP-D1)', () => {
    const source = readFileSync(
      new URL('../run-chilecompra-ocds-snapshot-etl.ts', import.meta.url),
      'utf-8',
    );
    assert.ok(
      source.includes('onConflict: RECORD_IDENTITY_ON_CONFLICT'),
      'debe usar la constante compartida RECORD_IDENTITY_ON_CONFLICT',
    );
    assert.equal(
      RECORD_IDENTITY_ON_CONFLICT,
      'source_key,country_code,source_year,record_identity_key',
    );
    assert.ok(
      !source.includes(
        "onConflict: 'source_key,country_code,source_year,normalized_tax_id'",
      ),
      'no debe seguir usando el literal legacy OLD_TAX_GRAIN_ON_CONFLICT',
    );
  });
});

// ─── 11. record_identity_key boundary (APP-B P2B) ─────────────────────────────

describe('record_identity_key boundary (APP-B P2B)', () => {
  it('a row with a resolved tax:<normalizedTaxId> identity passes validateRecordIdentityKey', () => {
    const map = new Map();
    const counters = makeCounters();
    const release = makeRelease();

    processRelease(release, release.ocid!, null, map, counters);
    const acc = map.values().next().value;
    const row = accToSnapshotRow(acc, 2024, [1], new Date().toISOString());

    const validation = validateRecordIdentityKey(row['record_identity_key']);
    assert.equal(validation.valid, true);
  });

  it('a row with an unavailable identity (null record_identity_key) fails validateRecordIdentityKey', () => {
    const identity = deriveTaxRecordIdentity(null);
    assert.equal(identity.status, 'unavailable');

    // identity.status is already asserted 'unavailable' above, so record_identity_key is null.
    const recordIdentityKey: string | null = null;
    const validation = validateRecordIdentityKey(recordIdentityKey);
    assert.equal(validation.valid, false);
    if (validation.valid) return;
    assert.equal(validation.reason, 'missing_value');
  });

  it('the P2B boundary source uses RECORD_IDENTITY_ON_CONFLICT (APP-D1 cutover)', () => {
    const source = readFileSync(
      new URL('../run-chilecompra-ocds-snapshot-etl.ts', import.meta.url),
      'utf-8',
    );
    assert.ok(source.includes('RECORD_IDENTITY_ON_CONFLICT'));
    assert.ok(source.includes('validateRecordIdentityKey'));
    assert.ok(
      !source.includes(
        "onConflict: 'source_key,country_code,source_year,normalized_tax_id'",
      ),
    );
  });
});
