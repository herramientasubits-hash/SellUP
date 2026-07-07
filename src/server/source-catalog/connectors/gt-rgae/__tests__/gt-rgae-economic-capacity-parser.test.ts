/**
 * Tests — GT RGAE Economic Capacity Parser
 * Hito: Centroamérica.7G.1
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEconomicCapacity } from '../gt-rgae-economic-capacity-parser';

describe('parseEconomicCapacity', () => {
  it('N/A → not_applicable', () => {
    const r = parseEconomicCapacity('N/A');
    assert.equal(r.kind, 'not_applicable');
    assert.equal(r.amount, null);
    assert.equal(r.raw, 'N/A');
  });

  it('n/a (minúsculas) → not_applicable', () => {
    const r = parseEconomicCapacity('n/a');
    assert.equal(r.kind, 'not_applicable');
  });

  it('  N/A  (con espacios) → not_applicable', () => {
    const r = parseEconomicCapacity('  N/A  ');
    assert.equal(r.kind, 'not_applicable');
  });

  it('COMPRA DIRECTA → direct_purchase', () => {
    const r = parseEconomicCapacity('COMPRA DIRECTA');
    assert.equal(r.kind, 'direct_purchase');
    assert.equal(r.amount, null);
    assert.equal(r.raw, 'COMPRA DIRECTA');
  });

  it('compra directa (minúsculas) → direct_purchase', () => {
    const r = parseEconomicCapacity('compra directa');
    assert.equal(r.kind, 'direct_purchase');
  });

  it('integer string → numeric', () => {
    const r = parseEconomicCapacity('500000');
    assert.equal(r.kind, 'numeric');
    assert.equal(r.amount, 500000);
    assert.equal(r.raw, '500000');
  });

  it('decimal float string → numeric', () => {
    const r = parseEconomicCapacity('1250000.50');
    assert.equal(r.kind, 'numeric');
    assert.ok(Math.abs((r.amount ?? 0) - 1250000.5) < 0.01);
  });

  it('zero → numeric', () => {
    const r = parseEconomicCapacity('0');
    assert.equal(r.kind, 'numeric');
    assert.equal(r.amount, 0);
  });

  it('negativo → unparsed', () => {
    const r = parseEconomicCapacity('-1000');
    assert.equal(r.kind, 'unparsed');
    assert.equal(r.amount, null);
  });

  it('texto desconocido → unparsed', () => {
    const r = parseEconomicCapacity('GRANDE');
    assert.equal(r.kind, 'unparsed');
    assert.equal(r.amount, null);
    assert.equal(r.raw, 'GRANDE');
  });

  it('null → unparsed con raw null', () => {
    const r = parseEconomicCapacity(null);
    assert.equal(r.kind, 'unparsed');
    assert.equal(r.raw, null);
  });

  it('string vacío → unparsed', () => {
    const r = parseEconomicCapacity('');
    assert.equal(r.kind, 'unparsed');
  });

  it('raw siempre preservado en not_applicable', () => {
    const r = parseEconomicCapacity('N/A');
    assert.equal(r.raw, 'N/A');
  });

  it('raw siempre preservado en unparsed', () => {
    const r = parseEconomicCapacity('VALOR_RARO');
    assert.equal(r.raw, 'VALOR_RARO');
  });
});
