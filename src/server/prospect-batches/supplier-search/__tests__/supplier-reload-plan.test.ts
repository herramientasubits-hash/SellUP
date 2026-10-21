/**
 * Tests — recarga mensual de las compras públicas (AGENT1-SUPPLIER-RELOAD-1, auditoría de
 * «Proveedores» 21-10, bloque «Próximo»).
 *
 * Todo se cargó el 15-10 hasta el 30-09 y nada lo recargaba. Ahora: un plan por país (mes
 * final según su cadencia, con meses de respaldo si aún no se publicó), México a mano con
 * aviso si el archivo es viejo, y la frescura de los datos en cada corrida. Prod 21-10
 * (`--check`): Argentina hasta 2026-07-31 ⇒ «viejo». Sin red, sin Producción.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  formatYearMonth,
  isManualFileStale,
  isNotYetPublished,
  isProcurementDataStale,
  planCountryReload,
  RELOAD_CADENCE,
  shiftMonth,
} from '../countries/reload-plan';
import { PROCUREMENT_LOADERS } from '../countries/loaders';
import { runPublicBuyerSupplierStep, type PublicBuyerStepDeps } from '../public-buyer-suppliers';

const TODAY = new Date('2026-10-21T12:00:00Z');

describe('1. el plan de cada país', () => {
  it('mensual: el mes pasado y, de respaldo, dos antes', () => {
    const plan = planCountryReload('CL', TODAY)!;
    assert.deepEqual(plan.ends.map(formatYearMonth), ['2026-9', '2026-8', '2026-7']);
    assert.equal(plan.months, 12);
    assert.equal(plan.manual, undefined);
  });

  it('enero cruza de año', () => {
    assert.deepEqual(planCountryReload('PE', new Date('2027-01-05T00:00:00Z'))!.ends.map(formatYearMonth), ['2026-12', '2026-11', '2026-10']);
    assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  });

  it('Uruguay (anual): sólo años cerrados', () => {
    assert.deepEqual(planCountryReload('UY', TODAY)!.ends.map(formatYearMonth), ['2025-12', '2024-12']);
  });

  it('México (a mano): el CSV del año y dónde bajarlo', () => {
    const plan = planCountryReload('MX', TODAY)!;
    assert.deepEqual(plan.ends.map(formatYearMonth), ['2026-9']);
    assert.equal(plan.manual?.fileName, 'contratos_comprasmx_2026.csv');
    assert.match(plan.manual?.downloadPage ?? '', /comprasmx\.buengobierno\.gob\.mx/);
  });

  it('cada país cargado tiene cadencia (y nada más)', () => {
    assert.deepEqual(Object.keys(RELOAD_CADENCE).sort(), Object.keys(PROCUREMENT_LOADERS).sort());
    assert.equal(planCountryReload('CO', TODAY), null);
  });
});

describe('2. cuándo probar un mes antes', () => {
  it('404/403 de la fuente o año no publicado ⇒ sí; otro error ⇒ no', () => {
    assert.equal(isNotYetPublished('download_failed:https://x.cl/oc-da/2026-9.zip:404'), true);
    assert.equal(isNotYetPublished('uy_ocds_year_not_published:2026 (último publicado: 2025)'), true);
    assert.equal(isNotYetPublished('upsert_failed_at_500: permission denied'), false);
    assert.equal(isNotYetPublished('download_failed:https://x.cl/oc-da/2026-9.zip:500'), false);
  });

  it('el archivo a mano de México vale 35 días', () => {
    assert.equal(isManualFileStale(new Date('2026-10-01T00:00:00Z'), TODAY, 35), false);
    assert.equal(isManualFileStale(new Date('2026-09-01T00:00:00Z'), TODAY, 35), true);
  });
});

describe('3. frescura de los datos', () => {
  it('mensual: viejo con más de 75 días desde el fin de la ventana (Argentina en Prod 21-10)', () => {
    assert.equal(isProcurementDataStale('CL', '2026-09-30', TODAY), false);
    assert.equal(isProcurementDataStale('AR', '2026-07-31', TODAY), true);
    assert.equal(isProcurementDataStale('UY', '2025-12-31', TODAY), false);
    assert.equal(isProcurementDataStale('UY', '2024-12-31', TODAY), true);
    assert.equal(isProcurementDataStale('CL', null, TODAY), false);
  });

  it('el paso deja en el lote hasta cuándo llegan los datos y si están viejos', async () => {
    const deps: PublicBuyerStepDeps = {
      sourceKey: 'ar_comprar_adjudications',
      findPublicEntities: async () => [{ taxId: 'SAF310', normalizedLegalName: 'MINISTERIO DE SALUD', shortName: null, isHead: true }],
      listSuppliers: async () => ({
        ok: true,
        suppliers: [],
        read: 0,
        outsideIndustry: 0,
        tableVersion: 't1',
        windowEnd: '2026-07-31',
      }),
      listPublicOnlyTaxIds: async () => new Set<string>(),
      findDomainsByTaxId: async () => new Map<string, string>(),
      writeWithWebsite: async () => ({ written: 0, failed: false }),
      recordWithoutWebsite: async () => 0,
    };
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b1', referenceCompanyName: 'Ministerio de Salud', countryCode: 'AR', macroIndustryKey: 'technology', nowIso: TODAY.toISOString() },
      deps,
    );
    assert.equal(outcome.executed && outcome.dataWindowEnd, '2026-07-31');
    assert.equal(outcome.executed && outcome.dataStale, true);
  });
});

describe('4. la recarga escribe sólo con autorización', () => {
  const script = readFileSync(join(process.cwd(), 'scripts/source-catalog/run-public-procurement-monthly.ts'), 'utf8');
  it('dry-run por defecto; --apply pasa la compuerta de cada fuente; --check es sólo lectura', () => {
    assert.match(script, /const apply = process\.argv\.includes\('--apply'\)/);
    assert.match(script, /SELLUP_CONFIRMED_SOURCE_KEY: sourceKey/);
    assert.doesNotMatch(script.slice(script.indexOf('async function check'), script.indexOf('function runLoader')), /\.(upsert|insert|update|delete)\(/);
  });

  it('la migración 154 devuelve el fin de la ventana a «frecuentes»', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/154_public_procurement_read_functions.sql'), 'utf8');
    assert.match(sql, /max\(b\.window_end\)\s+AS window_end/);
  });
});
