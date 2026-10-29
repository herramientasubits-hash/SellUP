// «Mapa de uso»: cifras, nombres de columna y hora pico.
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsageMapValue, peakSlotLabel, usageMapColumnLabel } from '../usage-map-format';

const NAMES = {
  roleLabels: { vendedor: 'Vendedor' },
  groupNames: { g1: 'Mid Market' },
  personNames: { lia: 'Lía Gómez' },
};

describe('formatUsageMapValue', () => {
  it('conteo, porcentaje, dólares y sin dato', () => {
    assert.equal(formatUsageMapValue(0.54, 'percent'), '54 %');
    assert.equal(formatUsageMapValue(1.5, 'usd'), '$1.50');
    assert.equal(formatUsageMapValue(null, 'count'), '—');
  });
});

describe('usageMapColumnLabel', () => {
  it('lo que falta se dice con palabras', () => {
    assert.equal(usageMapColumnLabel('rol', 'sin_rol', NAMES), 'Sin rol');
    assert.equal(usageMapColumnLabel('lider', 'sin_lider', NAMES), 'Sin líder');
    assert.equal(usageMapColumnLabel('pais', 'sin_pais', NAMES), 'Sin país');
  });
  it('nombres legibles', () => {
    assert.equal(usageMapColumnLabel('rol', 'vendedor', NAMES), 'Vendedor');
    assert.equal(usageMapColumnLabel('grupo', 'g1', NAMES), 'Mid Market');
    assert.equal(usageMapColumnLabel('lider', 'lia', NAMES), 'Equipo de Lía Gómez');
    assert.equal(usageMapColumnLabel('pais', 'CO', NAMES), 'Colombia');
  });
});

describe('peakSlotLabel', () => {
  it('la hora con más consultas; sin consultas ⇒ null', () => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    assert.equal(peakSlotLabel(grid), null);
    grid[1][10] = 5;
    assert.equal(peakSlotLabel(grid), 'martes a las 10:00');
  });
});
