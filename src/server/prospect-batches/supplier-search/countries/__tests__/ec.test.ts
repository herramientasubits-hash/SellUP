/**
 * Tests — Ecuador en «Proveedores de una empresa» (SERCOP OCDS, industria por CIIU del
 * proveedor). Filas reales recortadas de los CSV de 2026 (sólo sociedades; la persona
 * natural es inventada).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ProcurementLinksAggregator, type ProcurementLine } from '../../procurement-links';
import { runPublicBuyerSupplierStep } from '../../public-buyer-suppliers';
import { EC_ACTIVITY_CLASSIFIER, EC_COUNTRY, ecActivityMacro, ecProcedureUrl, isEcCompanyRuc, normalizeEcBuyerName, parseEcRuc } from '../ec';
import { EC_LOADER, ecLinesFromTables, ecWindowFromFileName, parseEcAmount } from '../ec.loader';
import { EC_SERVER_HOOKS, ecMacroByTaxId } from '../ec.server';
import { publicBuyerCountryLookups } from '../index.server';
import { buildLoadedLinksLookups } from '../loaded-lookups.server';

const RELEASES = [
  { ocid: 'ocds-5wno2w-CE-20260002969199-2455', buyer_id: 'EC-RUC-1760001120001', buyer_name: 'MINISTERIO DE SALUD PUBLICA MATRIZ', date: '2026-02-04T00:00:00-05:00' },
  { ocid: 'ocds-5wno2w-CE-20260002969200-2455', buyer_id: 'EC-RUC-1760001120001-2455', buyer_name: 'MINISTERIO DE SALUD PUBLICA MATRIZ', date: '2026-02-04T00:00:00-05:00' },
  { ocid: 'ocds-5wno2w-SIE-GADCM-2025-005-21126', buyer_id: 'EC-RUC-0560000540001-27207', buyer_name: 'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL INTERCULTURAL DEL CANTON PUJILI', date: '2025-06-10T00:00:00-05:00' },
  { ocid: 'ocds-5wno2w-CE-20250000000001-1', buyer_id: 'EC-RUC-1760001120001', buyer_name: 'MINISTERIO DE SALUD PUBLICA MATRIZ', date: '2025-03-01T00:00:00-05:00' },
];
const AWARDS = [
  { ocid: 'ocds-5wno2w-CE-20260002969199-2455', id: 'CE-20260002969199', status: 'active', date: '', amount: '103723.20' },
  { ocid: 'ocds-5wno2w-CE-20260002969200-2455', id: 'CE-20260002969200', status: 'active', date: '', amount: '14038.00' },
  // Régimen común: estado vacío, con fecha de adjudicación (cuenta por esa fecha).
  { ocid: 'ocds-5wno2w-SIE-GADCM-2025-005-21126', id: '2569619-SIE-GADCM-2025-005', status: '', date: '2026-01-29T10:28:11-05:00', amount: '42000.00' },
  // Fuera de la ventana.
  { ocid: 'ocds-5wno2w-CE-20250000000001-1', id: 'CE-20250000000001', status: 'active', date: '', amount: '50000' },
];
const SUPPLIERS = [
  { ocid: 'ocds-5wno2w-CE-20260002969199-2455', award_id: 'CE-20260002969199', id: 'EC-RUC-1792569397001-598626', name: 'PFIZER PFE CIA.LTDA.' },
  { ocid: 'ocds-5wno2w-CE-20260002969200-2455', award_id: 'CE-20260002969200', id: 'EC-RUC-1791362160001-5430', name: 'PHARMABRAND S.A.' },
  // Dos proveedores en una adjudicación: el monto se reparte.
  { ocid: 'ocds-5wno2w-SIE-GADCM-2025-005-21126', award_id: '2569619-SIE-GADCM-2025-005', id: 'ID-1792488761001-544849', name: 'CONSTRUCTORA UNO S.A.' },
  { ocid: 'ocds-5wno2w-SIE-GADCM-2025-005-21126', award_id: '2569619-SIE-GADCM-2025-005', id: 'EC-RUC-1712345678001-1', name: 'PERSONA NATURAL' },
  { ocid: 'ocds-5wno2w-CE-20250000000001-1', award_id: 'CE-20250000000001', id: 'EC-RUC-1792569397001-598626', name: 'PFIZER PFE CIA.LTDA.' },
];

describe('1. Ecuador — reglas', () => {
  it('RUC sin sufijo; sólo sociedad privada (3.er dígito 9)', () => {
    assert.equal(parseEcRuc('EC-RUC-1792569397001-598626'), '1792569397001');
    assert.equal(parseEcRuc('ID-1792488761001-544849'), '1792488761001');
    assert.equal(parseEcRuc('EC-RUC-17681535300017-322436'), null, '14 dígitos: mal escrito');
    assert.equal(isEcCompanyRuc('1792569397001'), true);
    assert.equal(isEcCompanyRuc('1760001120001'), false, 'entidad pública (6)');
    assert.equal(isEcCompanyRuc('1712345678001'), false, 'persona natural (1)');
  });

  it('nombre de la entidad: sin MATRIZ / PLANTA CENTRAL; las zonales conservan el suyo', () => {
    assert.equal(normalizeEcBuyerName('MINISTERIO DE SALUD PUBLICA MATRIZ'), 'MINISTERIO DE SALUD PUBLICA');
    assert.equal(normalizeEcBuyerName('Ministerio de Salud Pública'), 'MINISTERIO DE SALUD PUBLICA');
    assert.equal(normalizeEcBuyerName('MINISTERIO DE SALUD PUBLICA - COORDINACION ZONAL 5'), 'MINISTERIO DE SALUD PUBLICA COORDINACION ZONAL 5');
    assert.equal(normalizeEcBuyerName('COMANDANCIA GENERAL - PLANTA CENTRAL'), 'COMANDANCIA GENERAL');
  });

  it('CIIU de la SCVS (con punto) y del SRI (sin punto) por la tabla aprobada', () => {
    assert.equal(ecActivityMacro('G4649.22'), 'health_pharma');
    assert.equal(ecActivityMacro('G464922'), 'health_pharma');
    assert.equal(ecActivityMacro('J6202.10'), 'technology');
    assert.equal(ecActivityMacro('F4220.11'), 'property_construction');
    assert.equal(ecActivityMacro('I5629.02'), null, 'restaurantes: sin macro');
    assert.equal(ecActivityMacro('G4649'), null, 'código corto: no se adivina');
  });

  it('el clasificador de compras nunca decide; la versión nombra la tabla de actividad', () => {
    assert.equal(EC_ACTIVITY_CLASSIFIER.classify({ x: 1 }), null);
    assert.match(EC_ACTIVITY_CLASSIFIER.tableVersion, /^ec-activity\(ec-ciiu4-inec-macro-v2\)$/);
  });

  it('monto, enlace del procedimiento y ventana del nombre del archivo', () => {
    assert.equal(parseEcAmount('103723.20'), 103723.2);
    assert.equal(parseEcAmount(''), 0);
    assert.equal(ecProcedureUrl('ocds-5wno2w-CE-20260002969199-2455'), 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/ocds/ocds-5wno2w-CE-20260002969199-2455');
    assert.equal(ecProcedureUrl('javascript:x'), null);
    assert.deepEqual(ecWindowFromFileName('/x/ec-2025-2025-10_2026-09.zip'), { from: '2025-10', to: '2026-09' });
    assert.deepEqual(
      EC_LOADER.files({ year: 2026, month: 9 }, 12).map((f) => f.name),
      ['ec-2025-2025-10_2026-09.zip', 'ec-2026-2025-10_2026-09.zip'],
    );
  });
});

describe('2. Ecuador — lector', () => {
  it('junta releases + awards + suppliers: empresa, monto repartido, ventana, fecha de respaldo', () => {
    const lines: ProcurementLine[] = [];
    ecLinesFromTables({ releases: RELEASES, awards: AWARDS, suppliers: SUPPLIERS }, { from: '2025-10', to: '2026-09' }, (l) => lines.push(l));
    assert.deepEqual(
      lines.map((l) => [l.buyerCode, l.supplierTaxId, l.amount, l.date]),
      [
        ['1760001120001', '1792569397001', 103723.2, '2026-02-04'],
        ['1760001120001', '1791362160001', 14038, '2026-02-04'],
        ['0560000540001', '1792488761001', 21000, '2026-01-29'],
      ],
    );
    assert.equal(lines[0].orderUrl, 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/ocds/ocds-5wno2w-CE-20260002969199-2455');
  });

  it('agregado: una entidad por RUC aunque el id del comprador traiga sufijo', () => {
    const agg = new ProcurementLinksAggregator({ countryCode: 'EC', sourceKey: EC_COUNTRY.sourceKey, currency: 'USD', normalizeBuyerName: EC_COUNTRY.normalizeBuyerName });
    ecLinesFromTables({ releases: RELEASES, awards: AWARDS, suppliers: SUPPLIERS }, { from: '2025-10', to: '2026-09' }, (l) => agg.add(l));
    const rows = agg.rows({ windowStart: '2025-10-01', windowEnd: '2026-09-30', minPairAmount: EC_COUNTRY.minPairAmount });
    assert.deepEqual(rows.map((r) => [r.buyer_code, r.buyer_name_normalized, r.supplier_tax_id]), [
      ['1760001120001', 'MINISTERIO DE SALUD PUBLICA', '1792569397001'],
      ['0560000540001', 'GOBIERNO AUTONOMO DESCENTRALIZADO MUNICIPAL INTERCULTURAL DEL CANTON PUJILI', '1792488761001'],
      ['1760001120001', 'MINISTERIO DE SALUD PUBLICA', '1791362160001'],
    ]);
  });
});

describe('3. Ecuador — industria por actividad', () => {
  it('fuente más autorizada primero; sin macro en la tabla, sin industria', () => {
    const macros = ecMacroByTaxId([
      { tax_id: 'A', source_key: 'ec_sri_registry', ciiu: 'J620201', macro: null },
      { tax_id: 'A', source_key: 'ec_scvs_registry', ciiu: 'G4649.22', macro: null },
      { tax_id: 'B', source_key: 'ec_sri_registry', ciiu: 'I562902', macro: null },
      { tax_id: 'B', source_key: 'latam_curated_directory', ciiu: null, macro: 'technology' },
      { tax_id: 'C', source_key: 'latam_curated_directory', ciiu: null, macro: 'inventada' },
    ]);
    assert.deepEqual([...macros].sort(), [['A', 'health_pharma'], ['B', 'technology']]);
  });
});

/** Doble del cliente de Supabase: filas por (tabla, source_key) y registro de llamadas. */
function fakeClient(links: unknown[], snapshots: Array<Record<string, unknown>>) {
  const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  const client = {
    from(table: string) {
      const call = { table, ops: [] as Array<[string, unknown[]]> };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      // `gt` y `range`: las consultas «loaded» paginan (entidades distintas, proveedores por páginas).
      for (const op of ['select', 'eq', 'in', 'like', 'gt', 'or', 'order', 'limit', 'range']) builder[op] = (...args: unknown[]) => (call.ops.push([op, args]), builder);
      builder.then = (resolve: (v: unknown) => unknown) => {
        if (table !== 'source_company_snapshots') return resolve({ data: links, error: null });
        const keys = (call.ops.find(([op, a]) => op === 'in' && a[0] === 'source_key')?.[1][1] ?? []) as string[];
        return resolve({ data: snapshots.filter((s) => keys.includes(String(s.source_key))), error: null });
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const LINK = (supplier: string, name: string, amount: number) => ({
  buyer_code: '1760001120001',
  buyer_name_normalized: 'MINISTERIO DE SALUD PUBLICA',
  supplier_tax_id: supplier,
  supplier_name: name,
  total_amount: amount,
  order_count: 2,
  amount_by_family: {},
  last_order_on: '2026-09-01',
  top_order_url: 'https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/ocds/ocds-5wno2w-CE-1',
  window_start: '2025-10-01',
});

describe('4. Ecuador — punta a punta del paso', () => {
  it('«Ministerio de Salud Pública» × Salud: industria por CIIU, web y tamaño de la SCVS', async () => {
    const { client } = fakeClient(
      [LINK('0992262192001', 'LETERAGO DEL ECUADOR S.A', 5_886_189), LINK('1792156734001', 'RRPGOLDEN INTEGRA IMPORTADORA S.A.', 9_062_336)],
      [
        { tax_id: '0992262192001', normalized_tax_id: '0992262192001', source_key: 'ec_scvs_registry', ciiu: 'G4649.22', macro: null, raw_data: { workers: 571, metrics_year: 2025 } },
        { tax_id: '1792156734001', normalized_tax_id: '1792156734001', source_key: 'ec_scvs_registry', ciiu: 'G4690.00', macro: null, raw_data: {} },
        { tax_id: '0992262192001', normalized_tax_id: '0992262192001', source_key: 'ec_scvs_directory', ciiu: 'G4649.22', macro: 'health_pharma', raw_data: { website_domain: 'leterago.com.ec' } },
      ],
    );
    const lookups = publicBuyerCountryLookups('EC', client);
    assert.ok(lookups);
    const written: unknown[] = [];
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b-1', countryCode: 'EC', referenceCompanyName: 'Ministerio de Salud Pública', macroIndustryKey: 'health_pharma', nowIso: '2026-10-15T00:00:00Z' },
      {
        ...lookups!,
        writeWithWebsite: async (rows) => (written.push(...rows), { written: rows.length, failed: false }),
        recordWithoutWebsite: async (rows) => rows.length,
      },
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.read, 2);
    assert.equal(outcome.outsideIndustry, 1, 'el mayorista general (CIIU 4690) es Comercio');
    assert.deepEqual(outcome.relationships.map((r) => r.taxId), ['0992262192001']);
    assert.equal(outcome.tableVersion, 'ec-activity(ec-ciiu4-inec-macro-v2)');
    const [company] = written as Array<{ domain: string; taxIdentifierType: string; officialWorkforce?: unknown }>;
    assert.equal(company.domain, 'leterago.com.ec');
    assert.equal(company.taxIdentifierType, 'RUC');
    assert.ok(company.officialWorkforce);
  });

  it('el gancho filtra por país y por las fichas con CIIU', async () => {
    const { client, calls } = fakeClient([], []);
    await EC_SERVER_HOOKS.activityMacroByTaxId!(client, ['0992262192001']);
    const ops = calls[0].ops;
    assert.deepEqual(ops.find(([op]) => op === 'eq')?.[1], ['country_code', 'EC']);
    assert.deepEqual(ops.find(([op, a]) => op === 'in' && a[0] === 'tax_id')?.[1], ['tax_id', ['0992262192001']]);
  });

  it('sin el gancho, ningún proveedor tiene industria (el clasificador no decide)', async () => {
    const { client } = fakeClient([LINK('0992262192001', 'LETERAGO DEL ECUADOR S.A', 5_886_189)], []);
    const r = await buildLoadedLinksLookups(EC_COUNTRY, client).listSuppliers({ buyerTaxId: '1760001120001', macroIndustryKey: 'health_pharma', nowIso: '2026-10-15' });
    assert.equal(r.ok && r.suppliers.length, 0);
  });
});
