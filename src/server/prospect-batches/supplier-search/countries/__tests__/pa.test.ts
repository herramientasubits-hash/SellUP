/**
 * Tests — Panamá en «Proveedores de una empresa» (PanamaCompra en Cifras, OCDS mensual).
 * Las adjudicaciones son reales (sep-2026, Caja de Seguro Social) recortadas; las
 * personas naturales van con cédula y nombre ficticios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ProcurementLinksAggregator, type ProcurementLine } from '../../procurement-links';
import { runPublicBuyerSupplierStep } from '../../public-buyer-suppliers';
import { publicBuyerCountry } from '../index';
import { PROCUREMENT_LOADERS } from '../loaders';
import { publicBuyerCountryLookups } from '../index.server';
import { isPaCompanyRuc, normalizePaRuc, PA_COUNTRY } from '../pa';
import { createPaReader, PA_LOADER, paAwardFamilies } from '../pa.loader';
import { PUBLIC_PROCUREMENT_CATALOG_SOURCES } from '../catalog';

const CSS = { id: '1-111-1137', name: 'Caja de Seguro Social' };
const TENDER_URI = 'https://www.panamacompra.gob.pa/Inicio/#/pliego-de-cargos/procesos-generados/eyJwIjoicHJvY2Vzb1Zpc3RhUGxpZWdvIiwiaSI6MTA2Mjg0NiwidHAiOjR9';

type Award = Record<string, unknown>;
const award = (overrides: Partial<Award> = {}): Award => ({
  id: '2026-1-10-01-09-CM-024486',
  status: 'pending',
  statusDetails: 'Adjudicado',
  date: '2026-09-30T15:12:44-05:00',
  value: { currency: 'PAB', amount: 8009.96 },
  suppliers: [{ id: '32812-2-249262', name: 'IMPORTADORA VIRZI, S.A.' }],
  items: [
    { classification: { scheme: 'UNSPSC', id: '50131802' }, totalValue: { amount: '921.6' } },
    { classification: { scheme: 'UNSPSC', id: '50131802' }, totalValue: { amount: '606.4' } },
  ],
  ...overrides,
});

const release = (ocid: string, awards: Award[], buyer = CSS) => ({
  compiledRelease: { ocid, buyer, tender: { uri: TENDER_URI }, awards },
});

const month = (records: unknown[]) => JSON.stringify({ uri: 'https://v2.panamacompraencifras.gob.pa/', records });

function read(texts: string[]): ProcurementLine[] {
  const reader = createPaReader();
  const out: ProcurementLine[] = [];
  for (const text of texts) reader(text, (l) => out.push(l));
  return out;
}

describe('1. RUC panameño', () => {
  it('quita el «DV» pegado y normaliza', () => {
    assert.equal(normalizePaRuc('155590028-2-2014 DV 10'), '155590028-2-2014');
    assert.equal(normalizePaRuc(' 8-nt-1-14278 dv 51 '), '8-NT-1-14278');
    assert.equal(normalizePaRuc(''), null);
  });

  it('empresa = tomo-folio-asiento con primer bloque ≥ 3 dígitos; fuera cédulas, extranjeros y «NT»', () => {
    for (const ruc of ['44752-77-297090', '155620936-2-2016', '1950065-1-731681', '280-134-61098', '32812-2-249262']) assert.ok(isPaCompanyRuc(ruc), ruc);
    for (const ruc of ['8-000-0000', '4-782-1338', 'E-8-123456', 'N-19-1234', 'PE-12-345', '8-NT-1-13653', '1-111-1137', 'E8157750']) assert.ok(!isPaCompanyRuc(ruc), ruc);
  });
});

describe('2. lector OCDS', () => {
  it('adjudicación real de la CSS: una línea con familia UNSPSC, prueba https y fecha', () => {
    const [line, ...rest] = read([month([release('ocds-emvi6n-panamacompra-v3-2026-1-10-01-09-CM-024486-1', [award()])])]);
    assert.equal(rest.length, 0);
    assert.deepEqual(
      { ...line, amount: Math.round(line.amount) },
      {
        buyerCode: '1-111-1137',
        buyerName: 'Caja de Seguro Social',
        buyerTaxId: '1-111-1137',
        supplierTaxId: '32812-2-249262',
        supplierName: 'IMPORTADORA VIRZI, S.A.',
        amount: 8010,
        orderCode: '2026-1-10-01-09-CM-024486',
        orderUrl: TENDER_URI,
        date: '2026-09-30',
        classificationKey: '5013',
      },
    );
  });

  it('reparte el monto adjudicado entre familias según el valor de los ítems', () => {
    const parts = paAwardFamilies(
      award({
        value: { amount: 1000 },
        items: [
          { classification: { scheme: 'UNSPSC', id: '43211503' }, totalValue: { amount: '300' } },
          { classification: { scheme: 'UNSPSC', id: '81111500' }, totalValue: { amount: '100' } },
        ],
      }),
    );
    assert.deepEqual(parts, [
      { family: '4321', amount: 750 },
      { family: '8111', amount: 250 },
    ]);
  });

  it('fuera personas naturales, canceladas y proveedores que también compran; republicada cuenta una vez', () => {
    const otherBuyer = { id: '1818454-1-708570', name: 'Transporte Masivo De Panamá, S.A' };
    const lines = read([
      month([
        release('o-1', [award()]),
        release('o-2', [award({ id: 'P-1', suppliers: [{ id: '8-000-0000', name: 'PERSONA FICTICIA' }] })]),
        release('o-3', [award({ id: 'C-1', status: 'cancelled', statusDetails: 'Cancelado' })]),
        release('o-4', [award({ id: 'E-1', suppliers: [{ id: '1818454-1-708570', name: 'Transporte Masivo De Panamá, S.A' }] })]),
        release('o-5', [], otherBuyer),
      ]),
      month([release('o-1', [award()])]),
    ]);
    assert.deepEqual(lines.map((l) => l.orderCode), ['2026-1-10-01-09-CM-024486']);
  });
});

describe('3. registro y cargador', () => {
  it('Panamá está conectado como «loaded» con su lector, consultas y entrada de catálogo', () => {
    assert.equal(publicBuyerCountry('pa')?.kind, 'loaded');
    assert.equal(PROCUREMENT_LOADERS.PA, PA_LOADER);
    const entry = PUBLIC_PROCUREMENT_CATALOG_SOURCES.find((s) => s.key === PA_COUNTRY.sourceKey);
    assert.equal(entry?.aiFlowStatus, 'connected_free_discovery');
    assert.equal(entry?.operationalStatus, 'pending_validation');
  });

  it('archivos mensuales con mes de dos dígitos', () => {
    const files = PA_LOADER.files({ year: 2026, month: 9 }, 2);
    assert.deepEqual(files, [
      { url: 'https://v2.panamacompraencifras.gob.pa/api/v1/file/panamacompra_v3/json/2026/08', name: 'pa-2026-8.zip' },
      { url: 'https://v2.panamacompraencifras.gob.pa/api/v1/file/panamacompra_v3/json/2026/09', name: 'pa-2026-9.zip' },
    ]);
  });
});

/** Doble mínimo del cliente de Supabase (devuelve las filas de cada tabla). */
function fakeClient(dataByTable: Record<string, unknown[]>): SupabaseClient {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'in', 'like', 'or', 'order', 'limit']) builder[op] = () => builder;
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: dataByTable[table] ?? [], error: null });
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('4. punta a punta: «Caja de Seguro Social» × Tecnología', () => {
  it('reconoce la entidad, ofrece sólo el proveedor de tecnología y busca su web en la capa gratuita', async () => {
    const lines = read([
      month([
        release('o-1', [award({ value: { amount: 18_504 }, suppliers: [{ id: '1875923-1-718107', name: 'TAIGA CONSULTING S.A.' }], items: [{ classification: { scheme: 'UNSPSC', id: '81111500' }, totalValue: { amount: '18504' } }] })]),
        release('o-2', [award({ id: 'X-2', value: { amount: 872_995 }, suppliers: [{ id: '44752-77-297090', name: 'HOSPITALES NACIONALES, S. A.' }], items: [{ classification: { scheme: 'UNSPSC', id: '85101500' }, totalValue: { amount: '872995' } }] })]),
      ]),
    ]);
    const agg = new ProcurementLinksAggregator(PA_COUNTRY);
    for (const l of lines) agg.add(l);
    const rows = agg.rows({ windowStart: '2025-10-01', windowEnd: '2026-09-30', minPairAmount: PA_COUNTRY.minPairAmount });
    assert.equal(rows.length, 2);

    const client = fakeClient({
      public_procurement_supplier_links: rows,
      source_company_snapshots: [{ tax_id: '1875923-1-718107', normalized_tax_id: '1875923-1-718107', source_key: 'pa_free_directory', raw_data: { website_domain: 'taiga.com.pa' } }],
    });
    const lookups = publicBuyerCountryLookups('PA', client)!;
    const written: string[] = [];
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b1', referenceCompanyName: 'Caja de Seguro Social', countryCode: 'PA', macroIndustryKey: 'technology', nowIso: '2026-10-15T00:00:00Z' },
      {
        ...lookups,
        writeWithWebsite: async (companies) => {
          written.push(...companies.map((c) => `${c.taxId}|${c.taxIdentifierType}|${c.domain}`));
          return { written: companies.length, failed: false };
        },
        recordWithoutWebsite: async (companies) => companies.length,
      },
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.taxId, '1-111-1137');
    assert.equal(outcome.offered, 1);
    assert.deepEqual(written, ['1875923-1-718107|RUC|taiga.com.pa']);
    assert.match(outcome.relationships[0].evidence, /con Caja de Seguro Social en compras públicas desde 2025/);
    assert.equal(outcome.relationships[0].evidenceUrl, TENDER_URI);
  });
});
