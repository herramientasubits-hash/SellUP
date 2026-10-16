/**
 * Tests — base común de «Proveedores de una empresa» por compras públicas para todos los
 * países (AGENT1-SUPPLIER-SEARCH-ALL-1): agregador, búsqueda sobre lo cargado, registro.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buyersFromLinks,
  httpsUrl,
  ProcurementLinksAggregator,
  suppliersFromLinks,
  type ProcurementLine,
  type StoredProcurementLink,
} from '../../procurement-links';
import { UNSPSC_CLASSIFIER, unspscFamily } from '../../unspsc-classifier';
import { PUBLIC_BUYER_COUNTRY_CODES } from '../codes';
import { PUBLIC_BUYER_COUNTRIES, publicBuyerCountry } from '../index';
import { PROCUREMENT_LOADERS } from '../loaders';
import { monthsBack } from '../loader-io';
import { buildLoadedLinksLookups } from '../loaded-lookups.server';
import { publicBuyerCountryLookups } from '../index.server';
import type { LoadedCountrySource } from '../types';

const line = (overrides: Partial<ProcurementLine> = {}): ProcurementLine => ({
  buyerCode: 'B1',
  buyerName: 'Ministerio de Salud',
  buyerTaxId: '111',
  supplierTaxId: '20512831983',
  supplierName: 'SERVICIOS BRICKELL S.A.C.',
  amount: 6_000_000,
  orderCode: 'C-1',
  orderUrl: 'http://example.gob/c1',
  date: '2026-09-01',
  classificationKey: '8111',
  ...overrides,
});

describe('1. agregador común', () => {
  const agg = () =>
    new ProcurementLinksAggregator({ countryCode: 'PE', sourceKey: 'pe_test', currency: 'PEN', normalizeBuyerName: (s) => s.toUpperCase() });

  it('suma por entidad × proveedor, cuenta órdenes, guarda familia, fechas y la orden más grande (https)', () => {
    const a = agg();
    a.add(line());
    a.add(line({ amount: 1_000_000, classificationKey: '4321' }));
    a.add(line({ orderCode: 'C-2', orderUrl: 'https://example.gob/c2', amount: 9_000_000, date: '2026-01-15' }));
    const [row] = a.rows({ windowStart: '2025-10-01', windowEnd: '2026-09-30', minPairAmount: 10_000_000 });
    assert.equal(row.buyer_name_normalized, 'MINISTERIO DE SALUD');
    assert.equal(row.buyer_tax_id, '111');
    assert.equal(row.total_amount, 16_000_000);
    assert.equal(row.order_count, 2);
    assert.deepEqual(row.amount_by_family, { '8111': 15_000_000, '4321': 1_000_000 });
    assert.equal(row.top_order_code, 'C-2');
    assert.equal(row.top_order_url, 'https://example.gob/c2');
    assert.equal(row.first_order_on, '2026-01-15');
    assert.equal(row.last_order_on, '2026-09-01');
    assert.equal(row.currency, 'PEN');
  });

  it('piso: bajo el mínimo no se guarda; líneas incompletas se ignoran', () => {
    const a = agg();
    a.add(line({ amount: 9_999 }));
    a.add(line({ supplierTaxId: '', amount: 50_000_000 }));
    assert.equal(a.rows({ windowStart: '2025-10-01', windowEnd: '2026-09-30', minPairAmount: 10_000 }).length, 0);
  });

  it('enlaces: http sube a https, otro esquema se descarta', () => {
    assert.equal(httpsUrl('http://x.gob/a'), 'https://x.gob/a');
    assert.equal(httpsUrl('javascript:alert(1)'), null);
  });

  it('UNSPSC: familia de 4 dígitos; códigos propios de otra longitud se descartan', () => {
    assert.equal(unspscFamily('V1.43211500'), '4321');
    assert.equal(unspscFamily('81111500'), '8111');
    assert.equal(unspscFamily('101101001'), null, 'código propio de obras de ChileCompra (9 dígitos), no UNSPSC');
  });

  it('ventana de meses', () => {
    assert.deepEqual(monthsBack({ year: 2026, month: 2 }, 3), [
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });
});

const STORED: StoredProcurementLink[] = [
  { buyer_code: 'B1', buyer_name_normalized: 'MINISTERIO DE SALUD', supplier_tax_id: 'S1', supplier_name: 'SOFT SA', total_amount: '50000000', order_count: 3, amount_by_family: { '8111': 50_000_000 }, last_order_on: '2026-09-01', top_order_url: 'http://x.gob/1', window_start: '2025-10-01' },
  { buyer_code: 'B1', buyer_name_normalized: 'MINISTERIO DE SALUD', supplier_tax_id: 'S2', supplier_name: 'OBRAS SA', total_amount: 40_000_000, order_count: 1, amount_by_family: { '7210': 40_000_000 }, last_order_on: null, top_order_url: null, window_start: '2025-10-01' },
  { buyer_code: 'B1', buyer_name_normalized: 'MINISTERIO DE SALUD', supplier_tax_id: 'S3', supplier_name: 'SIN CLASIFICAR SA', total_amount: 30_000_000, order_count: 1, amount_by_family: {}, last_order_on: null, top_order_url: null, window_start: '2025-10-01' },
];

describe('2. búsqueda sobre lo cargado', () => {
  it('industria por lo que más le vende a la entidad (tabla del país)', () => {
    const r = suppliersFromLinks(STORED, 'technology', UNSPSC_CLASSIFIER);
    assert.equal(r.ok && r.suppliers.map((s) => s.taxId).join(), 'S1');
    assert.equal(r.ok && r.suppliers[0].evidenceUrl, 'https://x.gob/1');
    assert.equal(r.ok && r.sinceYear, '2025');
  });

  it('industria por la actividad oficial del proveedor (Ecuador, Costa Rica) manda cuando está', () => {
    const r = suppliersFromLinks(STORED, 'technology', UNSPSC_CLASSIFIER, new Map([['S3', 'technology'], ['S1', 'retail']]));
    assert.equal(r.ok && r.suppliers.map((s) => s.taxId).join(), 'S3');
  });

  it('un comprador por código', () => {
    assert.equal(buyersFromLinks(STORED).length, 1);
  });
});

/** Doble mínimo del cliente de Supabase: registra la consulta y devuelve filas por tabla. */
function fakeClient(dataByTable: Record<string, unknown[]>) {
  const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  const client = {
    from(table: string) {
      const call = { table, ops: [] as Array<[string, unknown[]]> };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      // `gt` y `range`: las consultas «loaded» paginan (entidades distintas, proveedores por páginas).
      for (const op of ['select', 'eq', 'in', 'like', 'gt', 'or', 'order', 'limit', 'range']) {
        builder[op] = (...args: unknown[]) => (call.ops.push([op, args]), builder);
      }
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: dataByTable[table] ?? [], error: null });
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('3. consultas genéricas de un país «loaded»', () => {
  const COUNTRY: LoadedCountrySource = {
    kind: 'loaded',
    countryCode: 'PE',
    sourceKey: 'pe_test',
    taxIdentifierType: 'RUC',
    currency: 'PEN',
    minPairAmount: 34_000,
    normalizeBuyerName: (s) => s.toUpperCase(),
    classifier: UNSPSC_CLASSIFIER,
    domainSourceKeys: ['pe_sunat_directory'],
    workersSourceKeys: ['pe_sunat_registry'],
    workersSourceLabel: 'SUNAT',
  };

  it('proveedores filtrados por industria, con trabajadores del registro del país', async () => {
    const { client, calls } = fakeClient({
      public_procurement_supplier_links: STORED,
      source_company_snapshots: [{ tax_id: 'S1', normalized_tax_id: 'S1', source_key: 'pe_sunat_registry', raw_data: { workers: 340 }, source_year: 2026 }],
    });
    const lookups = buildLoadedLinksLookups(COUNTRY, client);
    const r = await lookups.listSuppliers({ buyerTaxId: 'B1', macroIndustryKey: 'technology', nowIso: '2026-10-15' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.suppliers[0].officialWorkers, { workers: 340, year: 2026, sourceLabel: 'SUNAT' });
    const linksCall = calls.find((c) => c.table === 'public_procurement_supplier_links')!;
    assert.deepEqual(linksCall.ops.filter(([op]) => op === 'eq').map(([, a]) => a), [['country_code', 'PE'], ['source_key', 'pe_test'], ['buyer_code', 'B1']]);
  });

  it('web desde las fuentes del país (por tax_id o normalized_tax_id)', async () => {
    const { client } = fakeClient({
      source_company_snapshots: [{ tax_id: null, normalized_tax_id: 'S1', source_key: 'pe_sunat_directory', raw_data: { website_domain: 'soft.pe' } }],
    });
    const domains = await buildLoadedLinksLookups(COUNTRY, client).findDomainsByTaxId(['S1', 'S2']);
    assert.deepEqual([...domains], [['S1', 'soft.pe']]);
  });
});

describe('4. registro de países', () => {
  it('la lista de códigos y la de configuraciones coinciden', () => {
    assert.deepEqual([...PUBLIC_BUYER_COUNTRY_CODES].sort(), PUBLIC_BUYER_COUNTRIES.map((c) => c.countryCode).sort());
  });

  it('cada país «loaded» tiene su lector; cada uno da consultas', () => {
    const { client } = fakeClient({});
    for (const country of PUBLIC_BUYER_COUNTRIES) {
      if (country.kind === 'loaded') assert.ok(PROCUREMENT_LOADERS[country.countryCode], `${country.countryCode} sin lector`);
      assert.ok(publicBuyerCountryLookups(country.countryCode, client), `${country.countryCode} sin consultas`);
    }
    assert.equal(publicBuyerCountry('cl')?.countryCode, 'CL');
    assert.equal(publicBuyerCountry('BO'), null);
  });

  it('cada fuente tiene source_key propio', () => {
    const keys = PUBLIC_BUYER_COUNTRIES.map((c) => c.sourceKey);
    assert.equal(new Set(keys).size, keys.length);
  });
});
