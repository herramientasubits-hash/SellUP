/**
 * Filtros de columna de `DataTable` en puro (dueño 17-11: filtro en todas las
 * columnas de las 7 vistas de Empresas y Contactos).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_FILTER_VALUE,
  PAST_DATE_PRESETS,
  FUTURE_DATE_PRESETS,
  compareDateCells,
  countBucketFilter,
  countBuckets,
  describeDateFilter,
  describeTextFilter,
  matchesColumnFilter,
  matchesDateFilter,
  matchesTextFilter,
  normalizeDateFilter,
  normalizeTextFilter,
  optionKeysOf,
  presenceFilter,
} from '../data-table-filters';

describe('casillas: valores y «(Vacío)»', () => {
  it('las celdas sin dato caen en «(Vacío)»', () => {
    assert.deepEqual(optionKeysOf(null), [EMPTY_FILTER_VALUE]);
    assert.deepEqual(optionKeysOf(''), [EMPTY_FILTER_VALUE]);
    assert.deepEqual(optionKeysOf('   '), [EMPTY_FILTER_VALUE]);
    assert.deepEqual(optionKeysOf([]), [EMPTY_FILTER_VALUE]);
    assert.deepEqual(optionKeysOf('CO'), ['CO']);
  });

  it('elegir «(Vacío)» deja sólo las filas sin dato; varias opciones suman', () => {
    assert.equal(matchesColumnFilter(null, [EMPTY_FILTER_VALUE]), true);
    assert.equal(matchesColumnFilter('CO', [EMPTY_FILTER_VALUE]), false);
    assert.equal(matchesColumnFilter('CO', ['MX', 'CO']), true);
    assert.equal(matchesColumnFilter(null, ['MX', EMPTY_FILTER_VALUE]), true);
    assert.equal(matchesColumnFilter('PE', ['MX', EMPTY_FILTER_VALUE]), false);
  });

  it('sin filtro o con lista vacía pasa todo', () => {
    assert.equal(matchesColumnFilter('x', undefined), true);
    assert.equal(matchesColumnFilter('x', []), true);
  });
});

describe('tramos y «tiene / no tiene»', () => {
  it('los cortes [0, 1, 3, 6] dan Ninguno · 1 a 2 · 3 a 5 · 6 o más', () => {
    assert.deepEqual(
      countBuckets([0, 1, 3, 6]).map((bucket) => bucket.label),
      ['Ninguno', '1 a 2', '3 a 5', '6 o más'],
    );
    assert.deepEqual(countBuckets([0, 1, 3], 'Ninguna').map((bucket) => bucket.label), ['Ninguna', '1 a 2', '3 o más']);
  });

  it('cada número cae en su tramo y el filtro usa esa clave', () => {
    const { filterKey, filterOptions } = countBucketFilter([0, 1, 3, 6]);
    assert.deepEqual(filterOptions.map((option) => option.value), ['0', '1-2', '3-5', '6+']);
    assert.equal(filterKey(0), '0');
    assert.equal(filterKey(2), '1-2');
    assert.equal(filterKey(5), '3-5');
    assert.equal(filterKey(40), '6+');
    assert.equal(filterKey(null), '0');
    assert.equal(matchesColumnFilter(4, ['3-5'], filterKey), true);
    assert.equal(matchesColumnFilter(7, ['3-5'], filterKey), false);
  });

  it('«tiene / no tiene» trata vacío, 0 y false como «no tiene»', () => {
    const { filterKey } = presenceFilter('En HubSpot', 'No está');
    assert.equal(filterKey('123'), 'yes');
    assert.equal(filterKey(1), 'yes');
    assert.equal(filterKey(''), 'no');
    assert.equal(filterKey(null), 'no');
    assert.equal(filterKey(0), 'no');
    assert.equal(matchesColumnFilter(null, ['no'], filterKey), true);
    assert.equal(matchesColumnFilter('987', ['no'], filterKey), false);
  });
});

describe('texto libre', () => {
  it('«contiene» no distingue mayúsculas ni tildes', () => {
    assert.equal(matchesTextFilter('Gerente de Gestión Humana', { contains: 'gestion' }), true);
    assert.equal(matchesTextFilter('Analista', { contains: 'gerente' }), false);
    assert.equal(matchesTextFilter(null, { contains: 'a' }), false);
  });

  it('«con dato» y «sin dato»', () => {
    assert.equal(matchesTextFilter('acme.co', { presence: 'filled' }), true);
    assert.equal(matchesTextFilter('', { presence: 'filled' }), false);
    assert.equal(matchesTextFilter(null, { presence: 'empty' }), true);
    assert.equal(matchesTextFilter('acme.co', { presence: 'empty' }), false);
  });

  it('el filtro por defecto lo reconoce por su forma', () => {
    assert.equal(matchesColumnFilter('Acme SAS', { contains: 'acme' }), true);
    assert.equal(matchesColumnFilter('Beta', { contains: 'acme' }), false);
  });

  it('un filtro sin nada se quita y el chip lo dice en una línea', () => {
    assert.equal(normalizeTextFilter({ contains: '  ' }), undefined);
    assert.deepEqual(normalizeTextFilter({ contains: 'rh', presence: 'filled' }), { contains: 'rh', presence: 'filled' });
    assert.equal(describeTextFilter({ contains: 'rh', presence: 'filled' }), 'contiene «rh» · con dato');
  });
});

describe('fechas', () => {
  it('el rango incluye sus extremos (día en la zona de la aplicación)', () => {
    // 2026-11-17 03:00 UTC es todavía el 16 en Bogotá.
    assert.equal(matchesDateFilter('2026-11-17T03:00:00.000Z', { from: '2026-11-16', to: '2026-11-16' }), true);
    assert.equal(matchesDateFilter('2026-11-17T15:00:00.000Z', { from: '2026-11-16', to: '2026-11-16' }), false);
    assert.equal(matchesDateFilter('2026-11-10T15:00:00.000Z', { to: '2026-11-10' }), true);
    assert.equal(matchesDateFilter(null, { from: '2026-01-01' }), false);
  });

  it('«Sin fecha» deja sólo las filas vacías', () => {
    assert.equal(matchesDateFilter(null, { empty: true }), true);
    assert.equal(matchesDateFilter('2026-11-10T15:00:00.000Z', { empty: true }), false);
    assert.equal(matchesColumnFilter(null, { empty: true }), true);
  });

  it('los atajos calculan su rango a partir de hoy', () => {
    const last30 = PAST_DATE_PRESETS.find((preset) => preset.id === 'last-30')!;
    assert.deepEqual(last30.range('2026-11-17'), { from: '2026-10-19', to: '2026-11-17' });
    const older90 = PAST_DATE_PRESETS.find((preset) => preset.id === 'older-90')!;
    assert.deepEqual(older90.range('2026-11-17'), { to: '2026-08-18' });
    const overdue = FUTURE_DATE_PRESETS.find((preset) => preset.id === 'overdue')!;
    assert.deepEqual(overdue.range('2026-11-17'), { to: '2026-11-16' });
    const next7 = FUTURE_DATE_PRESETS.find((preset) => preset.id === 'next-7')!;
    assert.deepEqual(next7.range('2026-11-30'), { from: '2026-11-30', to: '2026-12-06' });
  });

  it('el chip nombra el atajo o el rango', () => {
    assert.equal(describeDateFilter({ to: '2026-08-18', preset: 'older-90' }), 'hace más de 90 días');
    assert.equal(describeDateFilter({ from: '2026-01-01', to: '2026-01-31' }), '2026-01-01 a 2026-01-31');
    assert.equal(describeDateFilter({ empty: true }), 'sin fecha');
    assert.equal(normalizeDateFilter({}), undefined);
  });

  it('el orden compara instantes (no texto) y deja las vacías al final', () => {
    const sorted = ['2026-11-17T10:00:00.000Z', null, '2026-11-17T09:00:00-05:00', '2026-01-01T00:00:00+00:00'].sort(
      compareDateCells,
    );
    assert.deepEqual(sorted, ['2026-01-01T00:00:00+00:00', '2026-11-17T10:00:00.000Z', '2026-11-17T09:00:00-05:00', null]);
  });
});
