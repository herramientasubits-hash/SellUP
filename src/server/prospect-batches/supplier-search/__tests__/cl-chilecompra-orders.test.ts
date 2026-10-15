/**
 * Tests — «Proveedores de una empresa» en Chile (AGENT1-SUPPLIER-SEARCH-CL-1): resumen
 * de las órdenes de compra mensuales de ChileCompra y búsqueda sobre lo cargado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  clBuyersFromLinks,
  clOrderUrl,
  ClOrdersAggregator,
  clSuppliersFromLinks,
  isClCompanyRut,
  normalizeClBuyerName,
  parseClAmount,
  parseClRut,
  type ClOrderLine,
  type ClStoredLink,
} from '../cl-chilecompra-orders';
import { runPublicBuyerSupplierStep, taxIdKey, type PublicBuyerStepDeps } from '../public-buyer-suppliers';

function line(overrides: Partial<ClOrderLine>): ClOrderLine {
  return {
    Codigo: '2582-359-SE22',
    Link: 'http://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=2582-359-SE22',
    Estado: 'Aceptada',
    FechaEnvio: '2026-09-24',
    CodigoOrganismoPublico: '86568',
    OrganismoPublico: 'I MUNICIPALIDAD DE SANTIAGO',
    sector: 'Municipalidades',
    RutUnidadCompra: '69.070.100-6',
    RutSucursal: '96.505.260-7',
    NombreProveedor: 'COMERCIAL AUTOMOTRIZ PETRIC LIMITADA',
    codigoProductoONU: '43211500',
    totalLineaNeto: '6000000,5',
    ...overrides,
  };
}

describe('1. lectura del archivo de ChileCompra', () => {
  it('RUT: con puntos, guion y K', () => {
    assert.deepEqual(parseClRut('96.505.260-7'), { rut: '96505260-7', number: 96505260 });
    assert.deepEqual(parseClRut('76286049-k'), { rut: '76286049-K', number: 76286049 });
    assert.equal(parseClRut('NA'), null);
  });

  it('sólo empresas: personas, servicios públicos y municipios quedan fuera', () => {
    assert.equal(isClCompanyRut(parseClRut('96.505.260-7')), true);
    assert.equal(isClCompanyRut(parseClRut('12.345.678-5')), false);
    assert.equal(isClCompanyRut(parseClRut('61.608.000-4')), false);
    assert.equal(isClCompanyRut(parseClRut('69.070.100-6')), false);
  });

  it('monto con coma decimal, nombre del comprador sin «I»/«Ilustre» y enlace https', () => {
    assert.equal(parseClAmount('18218023,5294118'), 18218023.5294118);
    assert.equal(parseClAmount('NA'), 0);
    assert.equal(normalizeClBuyerName('I MUNICIPALIDAD DE SANTIAGO'), 'MUNICIPALIDAD DE SANTIAGO');
    assert.equal(normalizeClBuyerName('Ilustre Municipalidad de Santiago'), 'MUNICIPALIDAD DE SANTIAGO');
    assert.equal(normalizeClBuyerName('Ministerio de Salud'), 'MINISTERIO DE SALUD');
    assert.equal(
      clOrderUrl('http://www.mercadopublico.cl/PurchaseOrder/x?codigoOC=1'),
      'https://www.mercadopublico.cl/PurchaseOrder/x?codigoOC=1',
    );
    assert.equal(clOrderUrl('https://evil.example/x'), null);
  });
});

describe('2. resumen entidad × proveedor', () => {
  it('suma ítems y órdenes, separa por familia y guarda la orden más grande', () => {
    const agg = new ClOrdersAggregator();
    agg.add(line({}));
    agg.add(line({ codigoProductoONU: '81111500', totalLineaNeto: '3000000' }));
    agg.add(line({ Codigo: 'OC-2', Link: 'http://www.mercadopublico.cl/x?codigoOC=OC-2', totalLineaNeto: '2000000', FechaEnvio: '2026-08-01' }));
    agg.add(line({ Estado: 'Cancelada' }));
    agg.add(line({ RutSucursal: '12.345.678-5' }));
    const rows = agg.rows({ windowStart: '2025-10-01', windowEnd: '2026-09-30', minPairAmount: 10_000_000 });
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.buyer_name_normalized, 'MUNICIPALIDAD DE SANTIAGO');
    assert.equal(row.buyer_tax_id, '69070100-6');
    assert.equal(row.supplier_tax_id, '96505260-7');
    assert.equal(row.order_count, 2);
    assert.equal(row.total_amount, 11_000_001);
    assert.deepEqual(row.amount_by_family, { '4321': 8_000_001, '8111': 3_000_000 });
    assert.equal(row.top_order_code, '2582-359-SE22');
    assert.match(row.top_order_url ?? '', /^https:\/\/www\.mercadopublico\.cl\//);
    assert.equal(row.first_order_on, '2026-08-01');
    assert.equal(row.last_order_on, '2026-09-24');
    assert.deepEqual(agg.stats, { lines: 5, skippedState: 1, skippedNotCompany: 1, skippedMalformed: 0 });
  });

  it('bajo el piso no se guarda (cola de compras chicas)', () => {
    const agg = new ClOrdersAggregator();
    agg.add(line({ totalLineaNeto: '9999999' }));
    assert.equal(agg.rows({ windowStart: '2025-10-01', windowEnd: '2026-09-30' }).length, 0);
  });

  it('nunca guarda contactos ni el texto de la orden', () => {
    const agg = new ClOrdersAggregator();
    agg.add(line({ totalLineaNeto: '20000000', 'Descripcion/Obervaciones': 'CONTACTO x@muni.cl' }));
    const [row] = agg.rows({ windowStart: '2025-10-01', windowEnd: '2026-09-30' });
    assert.doesNotMatch(JSON.stringify(row), /CONTACTO|@muni/);
  });
});

const STORED: ClStoredLink[] = [
  {
    buyer_code: '86568',
    buyer_name_normalized: 'MUNICIPALIDAD DE SANTIAGO',
    supplier_tax_id: '76111111-1',
    supplier_name: 'SOFTWARE SPA',
    total_amount: '50000000',
    order_count: 4,
    amount_by_family: { '8111': 45_000_000, '4321': 5_000_000 },
    last_order_on: '2026-09-01',
    top_order_url: 'http://www.mercadopublico.cl/x?codigoOC=A',
    window_start: '2025-10-01',
  },
  {
    buyer_code: '86568',
    buyer_name_normalized: 'MUNICIPALIDAD DE SANTIAGO',
    supplier_tax_id: '96505260-7',
    supplier_name: 'PETRIC',
    total_amount: 40000000,
    order_count: 2,
    amount_by_family: { '7210': 40_000_000 },
    last_order_on: '2026-08-01',
    top_order_url: null,
    window_start: '2025-10-01',
  },
];

describe('3. búsqueda sobre lo cargado', () => {
  it('la industria del proveedor es la de lo que más le vende a esa entidad', () => {
    const result = clSuppliersFromLinks(STORED, 'technology');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.suppliers.map((s) => s.taxId), ['76111111-1']);
    assert.equal(result.outsideIndustry, 1);
    assert.equal(result.sinceYear, '2025');
    assert.equal(result.suppliers[0].evidenceUrl, 'https://www.mercadopublico.cl/x?codigoOC=A');
  });

  it('un comprador por código', () => {
    assert.deepEqual(clBuyersFromLinks(STORED), [
      { taxId: '86568', normalizedLegalName: 'MUNICIPALIDAD DE SANTIAGO', shortName: null, isHead: false },
    ]);
  });

  it('paso completo en Chile: «Ilustre Municipalidad de Santiago» se reconoce, sin web a Descartadas con RUT', async () => {
    const recorded: Array<{ key: string; type: unknown; workers: unknown }> = [];
    const deps: PublicBuyerStepDeps = {
      sourceKey: 'cl_chilecompra_orders',
      taxIdentifierType: 'RUT',
      normalizeName: normalizeClBuyerName,
      findPublicEntities: async (name) => (name === 'MUNICIPALIDAD DE SANTIAGO' ? clBuyersFromLinks(STORED) : []),
      listSuppliers: async ({ macroIndustryKey }) => {
        const listed = clSuppliersFromLinks(STORED, macroIndustryKey);
        return listed.ok
          ? { ...listed, suppliers: listed.suppliers.map((s) => ({ ...s, officialWorkers: { workers: 250, year: 2024, sourceLabel: 'SII' } })) }
          : listed;
      },
      listPublicOnlyTaxIds: async () => new Set(),
      findDomainsByTaxId: async () => new Map(),
      writeWithWebsite: async () => ({ written: 0, failed: false }),
      recordWithoutWebsite: async (companies) => {
        for (const c of companies) recorded.push({ key: c.recordIdentityKey, type: c.taxIdentifierType, workers: c.officialWorkforce?.workers });
        return companies.length;
      },
    };
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b1', referenceCompanyName: 'Ilustre Municipalidad de Santiago', countryCode: 'CL', macroIndustryKey: 'technology', nowIso: '2026-10-15T00:00:00Z' },
      deps,
    );
    assert.equal(outcome.executed, true);
    assert.deepEqual(recorded, [{ key: 'tax:76111111-1', type: 'RUT', workers: 250 }]);
    if (outcome.executed) assert.match(outcome.relationships[0].evidence, /desde 2025/);
  });

  it('el RUT del candidato cruza con el del proveedor para «Proveedor de X»', () => {
    assert.equal(taxIdKey('76286049-K'), '76286049K');
    assert.equal(taxIdKey('76.286.049-k'), '76286049K');
    assert.equal(taxIdKey('900092385-1'), '900092385');
  });
});

describe('4. la migración 150', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/150_public_procurement_supplier_links.sql'), 'utf8');
  it('crea la tabla con RLS y sin políticas (sólo service_role)', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.public_procurement_supplier_links/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.doesNotMatch(sql, /CREATE POLICY/i);
  });
  it('no toca otras tablas (sin contar los comentarios)', () => {
    const code = sql.replace(/--.*$/gm, '');
    assert.doesNotMatch(code, /ALTER TABLE public\.(?!public_procurement_supplier_links)/);
    assert.doesNotMatch(code, /\b(UPDATE|DELETE FROM|DROP TABLE|INSERT INTO)\b/i);
  });
});
