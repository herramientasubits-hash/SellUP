// TABLEROS-1 — Filtros de /dashboards: lectura de la URL, rango recortado al
// lanzamiento (11-11-2026), días de Bogotá y cubetas de tiempo.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARDS_LAUNCH_DAY,
  DEFAULT_DASHBOARD_FILTERS,
  bogotaDayOf,
  bogotaDayStartIso,
  bucketKeyForIso,
  bucketLabel,
  describeRange,
  isWithinRange,
  listBuckets,
  parseDashboardFilters,
  resolveDashboardRange,
  toDashboardQuery,
  weekStart,
} from '../dashboard-filters';

const PERSON_A = '11111111-1111-4111-8111-111111111111';
const PERSON_B = '22222222-2222-4222-8222-222222222222';
const TODAY = '2026-11-25';

describe('parseDashboardFilters', () => {
  it('sin parámetros da los filtros por defecto (desde el lanzamiento, por semana)', () => {
    assert.deepEqual(parseDashboardFilters({}), DEFAULT_DASHBOARD_FILTERS);
  });

  it('lee listas separadas por coma, sin repetir y descartando lo que no es válido', () => {
    const filters = parseDashboardFilters({
      personas: `${PERSON_A}, ${PERSON_B},${PERSON_A},no-es-un-id`,
      fuentes: 'HubSpot,apollo,<script>',
      paises: 'co,MX,colombia',
    });
    assert.deepEqual(filters.people, [PERSON_A, PERSON_B]);
    assert.deepEqual(filters.sources, ['hubspot', 'apollo']);
    assert.deepEqual(filters.countries, ['CO', 'MX']);
  });

  it('un periodo o agrupado desconocido cae al de por defecto, nunca rompe', () => {
    const filters = parseDashboardFilters({ periodo: 'siempre', agrupar: 'anual' });
    assert.equal(filters.period, 'since_launch');
    assert.equal(filters.granularity, 'week');
  });

  it('las fechas a mano sólo cuentan con el periodo «custom» y si son días reales', () => {
    assert.equal(parseDashboardFilters({ desde: '2026-11-12' }).customFrom, null);
    const custom = parseDashboardFilters({ periodo: 'custom', desde: '2026-11-12', hasta: '2026-02-30' });
    assert.equal(custom.customFrom, '2026-11-12');
    assert.equal(custom.customTo, null, '30 de febrero no existe');
  });

  it('«fuente_vista=agrupada» agrupa las fuentes', () => {
    assert.equal(parseDashboardFilters({ fuente_vista: 'agrupada' }).sourceView, 'grouped');
    assert.equal(parseDashboardFilters({ fuente_vista: 'otra' }).sourceView, 'split');
  });
});

describe('toDashboardQuery', () => {
  it('conserva la pestaña y no ensucia la URL con los valores por defecto', () => {
    assert.equal(toDashboardQuery('tab=empresas&agrupar=month', DEFAULT_DASHBOARD_FILTERS), 'tab=empresas');
  });

  it('ida y vuelta: lo que escribe se vuelve a leer igual', () => {
    const filters = {
      ...DEFAULT_DASHBOARD_FILTERS,
      period: 'custom' as const,
      customFrom: '2026-11-12',
      customTo: '2026-11-20',
      granularity: 'day' as const,
      people: [PERSON_A, PERSON_B],
      sources: ['hubspot'],
      countries: ['CO'],
      sourceView: 'grouped' as const,
    };
    const query = toDashboardQuery('', filters);
    assert.deepEqual(parseDashboardFilters(Object.fromEntries(new URLSearchParams(query))), filters);
  });
});

describe('días de Bogotá (UTC-5 fijo)', () => {
  it('las 3:00 UTC del 25 todavía son el 24 en Bogotá', () => {
    assert.equal(bogotaDayOf('2026-11-25T03:00:00.000Z'), '2026-11-24');
    assert.equal(bogotaDayOf('2026-11-25T05:00:00.000Z'), '2026-11-25');
  });

  it('el día empieza a las 05:00 UTC', () => {
    assert.equal(bogotaDayStartIso('2026-11-11'), '2026-11-11T05:00:00.000Z');
  });

  it('la semana empieza el lunes', () => {
    assert.equal(weekStart('2026-11-25'), '2026-11-23'); // miércoles → lunes
    assert.equal(weekStart('2026-11-23'), '2026-11-23');
    assert.equal(weekStart('2026-11-29'), '2026-11-23'); // domingo
  });
});

describe('resolveDashboardRange', () => {
  it('por defecto: del lanzamiento a hoy', () => {
    const range = resolveDashboardRange(DEFAULT_DASHBOARD_FILTERS, TODAY);
    assert.equal(range.fromDay, DASHBOARDS_LAUNCH_DAY);
    assert.equal(range.toDay, TODAY);
    assert.equal(range.fromIso, '2026-11-11T05:00:00.000Z');
    assert.equal(range.toIsoExclusive, '2026-11-26T05:00:00.000Z');
    assert.equal(range.clampedToLaunch, false);
  });

  it('nunca muestra nada de antes del lanzamiento: «Últimos 90 días» se recorta', () => {
    const range = resolveDashboardRange({ ...DEFAULT_DASHBOARD_FILTERS, period: 'last_90' }, TODAY);
    assert.equal(range.fromDay, DASHBOARDS_LAUNCH_DAY);
    assert.equal(range.clampedToLaunch, true);
    assert.equal(range.isEmpty, false);
  });

  it('un periodo entero anterior al lanzamiento queda vacío', () => {
    const range = resolveDashboardRange({ ...DEFAULT_DASHBOARD_FILTERS, period: 'last_month' }, TODAY);
    assert.equal(range.isEmpty, true, 'octubre es anterior al 11-11');
  });

  it('«Mes pasado» en diciembre es noviembre desde el lanzamiento', () => {
    const range = resolveDashboardRange({ ...DEFAULT_DASHBOARD_FILTERS, period: 'last_month' }, '2026-12-10');
    assert.equal(range.fromDay, DASHBOARDS_LAUNCH_DAY);
    assert.equal(range.toDay, '2026-11-30');
  });

  it('«Últimos 7 días» incluye hoy', () => {
    const range = resolveDashboardRange({ ...DEFAULT_DASHBOARD_FILTERS, period: 'last_7' }, TODAY);
    assert.equal(range.fromDay, '2026-11-19');
    assert.equal(range.toDay, TODAY);
  });

  it('un rango a mano al revés se ordena y no pasa de hoy', () => {
    const range = resolveDashboardRange(
      { period: 'custom', customFrom: '2026-12-31', customTo: '2026-11-15' },
      TODAY,
    );
    assert.equal(range.fromDay, '2026-11-15');
    assert.equal(range.toDay, TODAY);
  });

  it('isWithinRange respeta el borde exclusivo del final', () => {
    const range = resolveDashboardRange(DEFAULT_DASHBOARD_FILTERS, TODAY);
    assert.equal(isWithinRange('2026-11-11T05:00:00.000Z', range), true);
    assert.equal(isWithinRange('2026-11-11T04:59:59.000Z', range), false, 'el 10 de noviembre en Bogotá');
    assert.equal(isWithinRange('2026-11-26T05:00:00.000Z', range), false);
    assert.equal(isWithinRange(null, range), false);
  });
});

describe('cubetas', () => {
  it('por semana: una por lunes, sin huecos', () => {
    const buckets = listBuckets({ fromDay: '2026-11-11', toDay: '2026-11-25' }, 'week');
    assert.deepEqual(
      buckets.map((bucket) => bucket.key),
      ['2026-11-09', '2026-11-16', '2026-11-23'],
    );
    assert.equal(buckets[0].label, 'Sem 9 nov');
  });

  it('por mes cruza el año', () => {
    const buckets = listBuckets({ fromDay: '2026-11-11', toDay: '2027-01-05' }, 'month');
    assert.deepEqual(buckets.map((bucket) => bucket.label), ['nov 2026', 'dic 2026', 'ene 2027']);
  });

  it('un instante cae en la cubeta de su día de Bogotá', () => {
    assert.equal(bucketKeyForIso('2026-11-16T04:00:00.000Z', 'week'), '2026-11-09', 'domingo 15 en Bogotá');
    assert.equal(bucketKeyForIso('2026-11-16T05:00:00.000Z', 'day'), '2026-11-16');
    assert.equal(bucketLabel('2026-11-16', 'day'), '16 nov');
  });

  it('describe el rango con su número de días', () => {
    assert.equal(describeRange({ fromDay: '2026-11-11', toDay: '2026-11-25' }), '11 nov 2026 – 25 nov 2026 (15 días)');
  });
});
