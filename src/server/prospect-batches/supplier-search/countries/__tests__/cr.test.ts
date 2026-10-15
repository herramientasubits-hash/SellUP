/**
 * Tests — Costa Rica en «Proveedores de una empresa» (SICOP por nombre → cédula, industria
 * por actividad). Filas reales recortadas de los CSV de SICOP (sólo sociedades; la
 * persona física es inventada).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ProcurementLinksAggregator, type ProcurementLine } from '../../procurement-links';
import { runPublicBuyerSupplierStep } from '../../public-buyer-suppliers';
import { CR_ACTIVITY_CLASSIFIER, CR_COUNTRY, crActivityMacro, crCedulaInName, crSicopMonthUrl, isCrCompanyCedula, matchCrSupplier } from '../cr';
import { CR_LOADER, crLinesFromRecords, parseCrAmount, parseCrNameIndex } from '../cr.loader';
import { CR_SERVER_HOOKS, crMacroByTaxId } from '../cr.server';
import { publicBuyerCountryLookups } from '../index.server';

const INDEX = parseCrNameIndex(
  [
    'CONSULTORIA INTERDISCIPLINARIA EN DESARROLLO\t3101032976',
    'CONNECT ASSISTANCE CR\t3101415379',
    'CEFA CENTRAL FARMACEUTICA\t3101095144',
    // Homónimos: dos cédulas para el mismo núcleo.
    'ALTA TECNOLOGIA\t3101000001',
    'ALTA TECNOLOGIA\t3102000002',
    // Una asociación (3-002) no es empresa.
    'ASOCIACION CAMARA NACIONAL\t3002000003',
    'linea rota',
  ].join('\n'),
);

const row = (over: Record<string, string>): Record<string, string> => ({
  'Numero procedimiento': '2026LD-000045-0002800001',
  Institucion: 'MUNICIPALIDAD DE TIBaS',
  Partida: '1',
  'Numero de línea': '1',
  Adjudicatario: 'CONSULTORIA INTERDISCIPLINARIA EN DESARROLLO SOCIEDAD ANONIMA',
  Moneda: 'CRC',
  'Monto adjudicado en colones': '18500000',
  'Estado de procedimiento': 'Contrato',
  ...over,
});

describe('1. Costa Rica — reglas', () => {
  it('cédula de empresa por prefijo', () => {
    assert.equal(isCrCompanyCedula('3101032976'), true);
    assert.equal(isCrCompanyCedula('3102415379'), true);
    assert.equal(isCrCompanyCedula('3004045083'), true, 'cooperativa');
    assert.equal(isCrCompanyCedula('3007045083'), false, 'ente estatal');
    assert.equal(isCrCompanyCedula('3014042120'), false, 'municipalidad');
    assert.equal(isCrCompanyCedula('4000042147'), false, 'autónoma');
    assert.equal(isCrCompanyCedula('3002000003'), false, 'asociación');
  });

  it('cédula escrita en el nombre', () => {
    assert.equal(crCedulaInName('3-101-743778 SOCIEDAD ANONIMA'), '3101743778');
    assert.equal(crCedulaInName('TRES CIENTO UNO 3101743778 S.A.'), '3101743778');
    assert.equal(crCedulaInName('CONSTRUCTORA GASA S.A.'), null);
  });

  it('cruce por nombre: fuerte y único; personas, públicas, ambiguas y no empresas fuera', () => {
    assert.deepEqual(matchCrSupplier('CONNECT ASSISTANCE CR  SOCIEDAD ANONIMA', INDEX), { cedula: '3101415379', by: 'name' });
    assert.deepEqual(matchCrSupplier('Cefa Central Farmacéutica, S.A.', INDEX), { cedula: '3101095144', by: 'name' });
    assert.deepEqual(matchCrSupplier('3-101-743778 SOCIEDAD ANONIMA', INDEX), { cedula: '3101743778', by: 'cedula_in_name' });
    assert.deepEqual(matchCrSupplier('JUAN PEREZ MORA', INDEX), { cedula: null, reason: 'no_legal_form' });
    assert.deepEqual(matchCrSupplier('CEFA CENTRAL FARMACEUTICA', INDEX), { cedula: null, reason: 'no_legal_form' });
    assert.deepEqual(matchCrSupplier('INSTITUTO NACIONAL DE SEGUROS', INDEX), { cedula: null, reason: 'public_entity' });
    assert.deepEqual(matchCrSupplier('ALTA TECNOLOGIA S.A.', INDEX), { cedula: null, reason: 'ambiguous' });
    assert.deepEqual(matchCrSupplier('ASOCIACION CAMARA NACIONAL S.A.', INDEX), { cedula: null, reason: 'not_company' });
    assert.deepEqual(matchCrSupplier('OTRA EMPRESA SOCIEDAD ANONIMA', INDEX), { cedula: null, reason: 'not_found' });
  });

  it('CIIU del MEIC → macro con la tabla aprobada para Costa Rica', () => {
    assert.equal(crActivityMacro('6201 - Actividades de programación informática'), 'technology');
    assert.equal(crActivityMacro('4772 - Venta al por menor de productos farmacéuticos'), 'health_pharma');
    assert.equal(crActivityMacro('4100 - Construcción de edificios'), 'property_construction');
    assert.equal(crActivityMacro('5610 - Restaurantes'), null);
    assert.equal(crActivityMacro(null), null);
    assert.equal(CR_ACTIVITY_CLASSIFIER.classify({ x: 1 }), null);
  });

  it('monto, URL mensual y archivos de la ventana', () => {
    assert.equal(parseCrAmount('778549.77'), 778549.77);
    assert.equal(parseCrAmount(''), 0);
    assert.match(crSicopMonthUrl(2026, 2), /bgnYmd=01\/02\/2026&endYmd=28\/02\/2026$/);
    assert.deepEqual(CR_LOADER.files({ year: 2026, month: 1 }, 2).map((f) => f.name), ['cr-2025-12.csv', 'cr-2026-01.csv']);
  });
});

describe('2. Costa Rica — lector', () => {
  it('estados válidos, líneas repetidas por tipo de cambio una vez, cédula encontrada', () => {
    const lines: ProcurementLine[] = [];
    const stats = crLinesFromRecords(
      [
        row({}),
        row({ 'Estado de procedimiento': 'En evaluacion', Adjudicatario: 'CONNECT ASSISTANCE CR SOCIEDAD ANONIMA' }),
        row({ 'Numero procedimiento': '2026XE-000079-0001000001', Institucion: 'INSTITUTO NACIONAL DE SEGUROS', Adjudicatario: 'CONNECT ASSISTANCE CR  SOCIEDAD ANONIMA', 'Monto adjudicado en colones': '64447086.6', 'Estado de procedimiento': 'Adjudicado' }),
        row({ 'Numero procedimiento': '2026XE-000079-0001000001', Institucion: 'INSTITUTO NACIONAL DE SEGUROS', Adjudicatario: 'CONNECT ASSISTANCE CR  SOCIEDAD ANONIMA', 'Monto adjudicado en colones': '64447086.6', 'Estado de procedimiento': 'Adjudicado' }),
        row({ Adjudicatario: 'JUAN PEREZ MORA', 'Numero de línea': '2' }),
      ],
      INDEX,
      (l) => lines.push(l),
    );
    assert.deepEqual(
      lines.map((l) => [l.buyerCode, l.supplierTaxId, l.amount]),
      [
        ['MUNICIPALIDAD DE TIBAS', '3101032976', 18_500_000],
        ['INSTITUTO NACIONAL DE SEGUROS', '3101415379', 64_447_086.6],
      ],
    );
    assert.equal(lines[0].date, null);
    assert.equal(stats.lines, 3);
    assert.equal(stats.name, 2);
    assert.equal(stats.no_legal_form, 1);
  });

  it('agregado con el piso del país', () => {
    const agg = new ProcurementLinksAggregator({ countryCode: 'CR', sourceKey: CR_COUNTRY.sourceKey, currency: 'CRC', normalizeBuyerName: CR_COUNTRY.normalizeBuyerName });
    crLinesFromRecords([row({}), row({ 'Numero de línea': '2', 'Monto adjudicado en colones': '1000000' })], INDEX, (l) => agg.add(l));
    const [r] = agg.rows({ windowStart: '2025-10-01', windowEnd: '2026-09-30', minPairAmount: CR_COUNTRY.minPairAmount });
    assert.equal(r.buyer_name_normalized, 'MUNICIPALIDAD DE TIBAS');
    assert.equal(r.total_amount, 19_500_000);
    assert.equal(r.order_count, 1, 'un procedimiento');
    assert.equal(r.top_order_code, '2026LD-000045-0002800001');
  });
});

describe('3. Costa Rica — industria por actividad', () => {
  it('registro (CIIU) primero; directorio y curada como respaldo; macros inventadas fuera', () => {
    const macros = crMacroByTaxId([
      { tax_id: 'A', source_key: 'cr_free_directory', ciiu: null, macro: 'retail' },
      { tax_id: 'A', source_key: 'cr_company_registry', ciiu: '6201 - Programación', macro: null },
      { tax_id: 'B', source_key: 'cr_company_registry', ciiu: '5610 - Restaurantes', macro: null },
      { tax_id: 'B', source_key: 'cr_free_directory', ciiu: null, macro: 'health_pharma' },
      { tax_id: 'C', source_key: 'latam_curated_directory', ciiu: null, macro: 'otra' },
    ]);
    assert.deepEqual([...macros].sort(), [['A', 'technology'], ['B', 'health_pharma']]);
  });
});

function fakeClient(links: unknown[], snapshots: Array<Record<string, unknown>>) {
  const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  const client = {
    from(table: string) {
      const call = { table, ops: [] as Array<[string, unknown[]]> };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'in', 'like', 'or', 'order', 'limit']) builder[op] = (...args: unknown[]) => (call.ops.push([op, args]), builder);
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
  buyer_code: 'CAJA COSTARRICENSE DE SEGURO SOCIAL',
  buyer_name_normalized: 'CAJA COSTARRICENSE DE SEGURO SOCIAL',
  supplier_tax_id: supplier,
  supplier_name: name,
  total_amount: amount,
  order_count: 146,
  amount_by_family: {},
  last_order_on: null,
  top_order_url: null,
  window_start: '2025-10-01',
});

describe('4. Costa Rica — punta a punta del paso', () => {
  it('«Caja Costarricense de Seguro Social» × Salud: industria por actividad, sin web → sin sitio', async () => {
    const { client } = fakeClient(
      [LINK('3101095144', 'CEFA CENTRAL FARMACEUTICA SOCIEDAD ANONIMA', 6_225_960_906), LINK('3101279973', 'ZMT CORPORACION SOCIEDAD ANONIMA', 2_520_087_490)],
      [
        { tax_id: '3101095144', normalized_tax_id: '3101095144', source_key: 'cr_company_registry', ciiu: '4772 - Venta al por menor de productos farmacéuticos', macro: null, raw_data: {} },
        { tax_id: '3101279973', normalized_tax_id: '3101279973', source_key: 'cr_company_registry', ciiu: '4100 - Construcción de edificios', macro: null, raw_data: {} },
      ],
    );
    const lookups = publicBuyerCountryLookups('CR', client);
    assert.ok(lookups);
    const withoutWebsite: unknown[] = [];
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b-1', countryCode: 'CR', referenceCompanyName: 'Caja Costarricense de Seguro Social', macroIndustryKey: 'health_pharma', nowIso: '2026-10-15T00:00:00Z' },
      {
        ...lookups!,
        writeWithWebsite: async (rows) => ({ written: rows.length, failed: false }),
        recordWithoutWebsite: async (rows) => (withoutWebsite.push(...rows), rows.length),
      },
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.deepEqual(outcome.relationships.map((r) => r.taxId), ['3101095144']);
    assert.equal(outcome.outsideIndustry, 1);
    assert.equal(outcome.tableVersion, CR_ACTIVITY_CLASSIFIER.tableVersion);
    assert.equal((withoutWebsite[0] as { taxIdentifierType: string }).taxIdentifierType, 'cedula_juridica');
  });

  it('el gancho filtra por país', async () => {
    const { client, calls } = fakeClient([], []);
    await CR_SERVER_HOOKS.activityMacroByTaxId!(client, ['3101095144']);
    assert.deepEqual(calls[0].ops.find(([op]) => op === 'eq')?.[1], ['country_code', 'CR']);
  });
});
