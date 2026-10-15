/**
 * Tests — República Dominicana en «Proveedores de una empresa» (DGCP en vivo).
 * Contratos, unidades y rubros reales (15-10-2026) recortados; las personas físicas
 * van con nombre ficticio.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { runPublicBuyerSupplierStep } from '../../public-buyer-suppliers';
import { PUBLIC_PROCUREMENT_CATALOG_SOURCES } from '../catalog';
import {
  aggregateDoContracts,
  classifyDoRubro,
  DO_COUNTRY,
  DO_DGCP_MAX_CLASSIFIED,
  doSinceDate,
  fetchDoSuppliers,
  isDoCompanyRnc,
  matchDoBuyingUnits,
  parseDoBuyingUnits,
  parseDoRubroFamilies,
  type DoSupplierDeps,
} from '../do';
import { buildDoLookups } from '../do.server';
import { publicBuyerCountry } from '../index';
import { publicBuyerCountryLookups } from '../index.server';

const page = (content: unknown[]) => ({ code: 200, hasError: false, payload: { content }, page: 1, limit: 1000 });

const UNITS = page([
  { codigo_unidad_compra: 240, unidad_compra: 'Ministerio de Salud Pública y Asistencia Social', acronimo: 'MISPAS', tipo: 'Institución', estado: 'ACTIVA' },
  { codigo_unidad_compra: 983, unidad_compra: 'Servicio Nacional de Salud', acronimo: 'SNS', tipo: 'Institución', estado: 'ACTIVA' },
  { codigo_unidad_compra: 988, unidad_compra: 'Servicio Regional de Salud Ozama', acronimo: 'SRSO', tipo: 'Hospital', estado: 'ACTIVA' },
  { codigo_unidad_compra: 925, unidad_compra: 'ARS Salud Segura (Inactiva)', acronimo: 'ARS Salud Segura', tipo: 'Institución', estado: 'SUPRIMIDA' },
]);

const URL_MACROTECH = 'https://comunidad.comprasdominicana.gob.do/Public/Tendering/ContractDetailView/Index?UniqueIdentifier=DO1.PCCNTR.2403671&AwardContractDetailId=765183';
const contract = (overrides: Record<string, unknown> = {}) => ({
  codigo_contrato: 'SNS-2026-00100',
  estado_contrato: 'Activo',
  estado_adjudicacion: 'Confirmada y enviada',
  fecha_adjudicacion: '2026-10-13T19:34:52.3333333Z',
  divisa: 'DOP',
  valor_contratado: 756_000_000,
  url_contrato: URL_MACROTECH,
  unidad_compra: 'Servicio Nacional de Salud',
  codigo_unidad_compra: '983',
  rpe: '4266',
  razon_social: 'Macrotech Farmacéutica, SRL',
  ...overrides,
});

const CONTRACTS = page([
  contract(),
  contract({ codigo_contrato: 'SNS-2026-00101', valor_contratado: 313_620_400, rpe: '717', razon_social: 'Hospifar, SRL', url_contrato: null }),
  contract({ codigo_contrato: 'SNS-2026-00102', valor_contratado: 12_000_000, rpe: '3926', razon_social: 'GTG Industrial, SRL' }),
  contract({ codigo_contrato: 'SNS-2026-00103', valor_contratado: 9_000_000, rpe: '99999', razon_social: 'PERSONA FISICA FICTICIA' }),
  contract({ codigo_contrato: 'SNS-2026-00104', valor_contratado: 900_000_000, estado_contrato: 'Cancelado', estado_adjudicacion: 'Cancelada', rpe: '5555', razon_social: 'Cancelada, SRL' }),
  contract({ codigo_contrato: 'SNS-2026-00105', valor_contratado: 20_000, divisa: 'USD', rpe: '4884', razon_social: 'Servicios Electromédicos e Institucionales, SA' }),
  contract({ codigo_contrato: 'SNS-2026-00106', valor_contratado: 50_000_000, rpe: '7777', razon_social: 'Servicio Regional de Salud Ozama' }),
  contract({ codigo_contrato: 'SNS-2024-00001', valor_contratado: 70_000_000, fecha_adjudicacion: '2024-07-23T18:31:13.85Z', rpe: '4266' }),
]);

// Rubro real de Macrotech (39 familias declaradas, recortado a una muestra representativa).
const RUBRO: Record<string, string[]> = {
  '4266': ['41100000', '42120000', '42130000', '42140000', '51100000', '51110000', '51120000', '51130000', '85100000'],
  '717': ['51100000', '51110000', '42140000'],
  // «Suplidor de todo»: ninguna industria llega a la mitad.
  '3926': ['10190000', '14110000', '24110000', '25170000', '31160000', '39110000', '43210000', '44120000', '47130000', '50200000', '53100000', '72100000'],
  '4884': ['42200000', '42180000', '81110000'],
};
const RNC: Record<string, string> = { '4266': '122001212', '717': '101625589', '3926': '130297118', '4884': '101670541', '7777': '401007428' };

function fakeFetch(calls: string[], fail?: (url: string) => boolean) {
  return async (url: string): Promise<unknown> => {
    calls.push(url);
    if (fail?.(url)) throw new Error('HTTP 429');
    if (url.includes('/unidades_compra')) return UNITS;
    if (url.includes('/contratos?')) return url.includes('page=1') ? CONTRACTS : page([]);
    const rpe = new URL(url).searchParams.get('rpe') ?? '';
    return page((RUBRO[rpe] ?? []).map((familia_unspsc) => ({ rpe: Number(rpe), familia_unspsc })));
  };
}

const deps = (calls: string[], extra: Partial<DoSupplierDeps> = {}): DoSupplierDeps => ({
  fetchJson: fakeFetch(calls),
  rncByRpe: async (rpes) => new Map(rpes.filter((r) => RNC[r]).map((r) => [r, RNC[r]])),
  publicEntityNames: async () => new Set(parseDoBuyingUnits(UNITS).map((u) => u.normalizedLegalName)),
  nowMs: () => 0,
  ...extra,
});

const INPUT = { buyerTaxId: '983', macroIndustryKey: 'health_pharma', nowIso: '2026-10-15T12:00:00Z' };

describe('1. reglas de RD', () => {
  it('RNC de sociedad = 9 dígitos; la cédula (11) no', () => {
    assert.ok(isDoCompanyRnc('122001212'));
    assert.ok(!isDoCompanyRnc('00112345678'));
    assert.ok(!isDoCompanyRnc(undefined));
  });

  it('ventana de 12 meses', () => {
    assert.equal(doSinceDate('2026-10-15T12:00:00Z'), '2025-10-15');
    assert.equal(doSinceDate('2026-01-31T00:00:00Z'), '2025-01-31');
  });

  it('unidades activas; por nombre (comienzo) o acrónimo; Institución = cabeza', () => {
    const units = parseDoBuyingUnits(UNITS);
    assert.equal(units.length, 3, 'la suprimida no cuenta');
    assert.deepEqual(matchDoBuyingUnits(units, 'MINISTERIO DE SALUD PUBLICA').map((u) => u.taxId), ['240']);
    assert.deepEqual(matchDoBuyingUnits(units, 'SNS').map((u) => [u.taxId, u.isHead]), [['983', true]]);
  });

  it('contratos: sin cancelados ni viejos, USD a pesos, piso DOP 600 mil, prueba https del más grande', () => {
    const rows = aggregateDoContracts((CONTRACTS.payload.content as Record<string, unknown>[]), '2025-10-15');
    assert.deepEqual(
      rows.map((r) => [r.rpe, r.totalAmount, r.contractCount]),
      [
        ['4266', 756_000_000, 1],
        ['717', 313_620_400, 1],
        ['7777', 50_000_000, 1],
        ['3926', 12_000_000, 1],
        ['99999', 9_000_000, 1],
        ['4884', 1_200_000, 1],
      ],
    );
    assert.equal(rows[0].evidenceUrl, URL_MACROTECH);
    assert.equal(rows[1].evidenceUrl, null);
  });

  it('rubro declarado con la tabla UNSPSC aprobada: Macrotech = Salud; el «de todo» no se clasifica', () => {
    const macrotech = classifyDoRubro(parseDoRubroFamilies(page(RUBRO['4266'].map((familia_unspsc) => ({ familia_unspsc })))));
    assert.equal(macrotech?.macroIndustryKey, 'health_pharma');
    assert.ok(macrotech?.rubro);
    assert.equal(classifyDoRubro(RUBRO['3926'].map((f) => f.slice(0, 4))), null);
  });
});

describe('2. consulta en vivo (con dobles)', () => {
  it('Servicio Nacional de Salud × Salud: empresas con RNC, sin persona física ni otra entidad pública', async () => {
    const calls: string[] = [];
    const r = await fetchDoSuppliers(INPUT, deps(calls));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.suppliers.map((s) => [s.taxId, s.name]), [
      ['122001212', 'Macrotech Farmacéutica, SRL'],
      ['101625589', 'Hospifar, SRL'],
      ['101670541', 'Servicios Electromédicos e Institucionales, SA'],
    ]);
    assert.equal(r.read, 4);
    assert.equal(r.outsideIndustry, 1);
    assert.equal(r.sinceYear, '2025');
    assert.ok(!calls.some((u) => u.includes('rpe=99999') || u.includes('rpe=7777')), 'no se gasta rubro en quien no entra');
    assert.equal(calls.filter((u) => u.includes('/contratos?')).length, 1, 'una página basta si trae menos de 1.000');
  });

  it('industria sin UNSPSC (Gobierno) no consulta nada', async () => {
    const calls: string[] = [];
    const r = await fetchDoSuppliers({ ...INPUT, macroIndustryKey: 'government' }, deps(calls));
    assert.deepEqual(r, { ok: false, reason: 'industry_without_unspsc' });
    assert.equal(calls.length, 0);
  });

  it('contratos caídos ⇒ fuente no disponible; rubro con 429 ⇒ responde con lo ya clasificado', async () => {
    const down = await fetchDoSuppliers(INPUT, deps([], { fetchJson: fakeFetch([], (u) => u.includes('/contratos?')) }));
    assert.deepEqual(down, { ok: false, reason: 'source_unavailable' });
    const calls: string[] = [];
    const limited = await fetchDoSuppliers(INPUT, deps(calls, { fetchJson: fakeFetch(calls, (u) => u.includes('rpe=3926')) }));
    assert.equal(limited.ok, true);
    if (!limited.ok) return;
    assert.deepEqual(limited.suppliers.map((s) => s.taxId), ['122001212', '101625589', '101670541'], 'la tanda que falló igual aporta lo que sí respondió');
  });

  it('presupuesto: nunca más de 40 rubros ni pasado el tiempo máximo; la caché no gasta llamadas', async () => {
    const many = page(Array.from({ length: 80 }, (_, i) => contract({ codigo_contrato: `C-${i}`, rpe: String(1000 + i), razon_social: `Empresa ${i}, SRL`, valor_contratado: 10_000_000 - i })));
    const calls: string[] = [];
    const fetchJson = async (url: string) => (calls.push(url), url.includes('/contratos?') ? many : page([]));
    const rnc = async (rpes: readonly string[]) => new Map(rpes.map((r) => [r, `1${r.padStart(8, '0')}`]));
    await fetchDoSuppliers(INPUT, deps(calls, { fetchJson, rncByRpe: rnc }));
    assert.equal(calls.filter((u) => u.includes('/rubro')).length, DO_DGCP_MAX_CLASSIFIED);

    let clock = 0;
    const slow: string[] = [];
    await fetchDoSuppliers(INPUT, deps(slow, { fetchJson: async (u) => ((clock += 5_000), slow.push(u), u.includes('/contratos?') ? many : page([])), rncByRpe: rnc, nowMs: () => clock }));
    assert.ok(slow.filter((u) => u.includes('/rubro')).length <= 8, 'corta por tiempo');

    const cached: string[] = [];
    await fetchDoSuppliers(INPUT, deps(cached, { cachedRubro: () => ['5110'] }));
    assert.equal(cached.filter((u) => u.includes('/rubro')).length, 0);
  });
});

/** Doble del cliente de Supabase: filas por tabla y registro de filtros. */
function fakeClient(dataByTable: Record<string, unknown[]>) {
  const ops: Array<[string, unknown[]]> = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'in', 'like', 'or', 'order', 'limit']) builder[op] = (...args: unknown[]) => (ops.push([op, args]), builder);
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: dataByTable[table] ?? [], error: null });
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, ops };
}

describe('3. registro y punta a punta', () => {
  it('RD está conectada «live» con consultas y entrada de catálogo', () => {
    assert.equal(publicBuyerCountry('do')?.kind, 'live');
    assert.ok(publicBuyerCountryLookups('DO', fakeClient({}).client));
    const entry = PUBLIC_PROCUREMENT_CATALOG_SOURCES.find((s) => s.key === DO_COUNTRY.sourceKey);
    assert.equal(entry?.aiFlowStatus, 'connected_free_discovery');
    assert.equal(entry?.operationalStatus, 'pending_validation');
  });

  it('«Servicio Nacional de Salud» × Salud: RNC desde do_dgcp por rpe, web del registro DGII', async () => {
    const { client, ops } = fakeClient({
      source_company_snapshots: [
        ...Object.entries(RNC).map(([rpe, tax_id]) => ({ tax_id, rpe })),
        { tax_id: '122001212', raw_data: { website_domain: 'macrotech.com.do' } },
      ],
    });
    const lookups = buildDoLookups(client, fakeFetch([]));
    const written: string[] = [];
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b1', referenceCompanyName: 'Servicio Nacional de Salud', countryCode: 'DO', ...INPUT },
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
    assert.equal(outcome.buyer.taxId, '983');
    assert.equal(outcome.offered, 3);
    assert.deepEqual(written, ['122001212|RNC|macrotech.com.do']);
    assert.equal(outcome.recordedWithoutWebsite, 2);
    assert.equal(outcome.relationships[0].evidenceUrl, URL_MACROTECH);
    assert.match(outcome.relationships[0].evidence, /con Servicio Nacional de Salud en compras públicas desde 2025/);
    assert.ok(ops.some(([op, args]) => op === 'in' && args[0] === 'raw_data->>rpe'));
  });
});
