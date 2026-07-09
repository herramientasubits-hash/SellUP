// 17B.4X.5H — truthful unknown-cost display helper tests.
// Uses the repo's native node:test + assert runner.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCostDisplay,
  resolveRemainingCostDisplay,
  toCostTruth,
} from '../cost-display';

const formatUsd = (v: number) => `$${v.toFixed(2)}`;

describe('toCostTruth', () => {
  it('maps false -> complete', () => {
    assert.equal(toCostTruth(false), 'complete');
  });
  it('maps true -> unknown', () => {
    assert.equal(toCostTruth(true), 'unknown');
  });
});

describe('resolveCostDisplay — complete truth', () => {
  it('TEST 1: complete + 0 -> current zero convention', () => {
    const result = resolveCostDisplay({ valueUsd: 0, costTruth: 'complete', formatUsd });
    assert.equal(result.label, '$0.00');
    assert.equal(result.isPartial, false);
    assert.equal(result.description, null);
  });

  it('TEST 1b: complete + 0 with custom zeroDisplay -> honors override', () => {
    const result = resolveCostDisplay({ valueUsd: 0, costTruth: 'complete', formatUsd, zeroDisplay: '—' });
    assert.equal(result.label, '—');
    assert.equal(result.isPartial, false);
  });

  it('TEST 2: complete + positive -> normal USD formatting', () => {
    const result = resolveCostDisplay({ valueUsd: 5.2, costTruth: 'complete', formatUsd });
    assert.equal(result.label, '$5.20');
    assert.equal(result.isPartial, false);
    assert.equal(result.description, null);
  });
});

describe('resolveCostDisplay — unknown truth', () => {
  it('TEST 3: unknown + 0 -> Costo desconocido', () => {
    const result = resolveCostDisplay({ valueUsd: 0, costTruth: 'unknown', formatUsd });
    assert.equal(result.label, 'Costo desconocido');
    assert.equal(result.isPartial, true);
    assert.equal(result.description, 'Costo no disponible para una o más operaciones.');
  });

  it('TEST 4: unknown + positive -> formatted value with a trailing +', () => {
    const result = resolveCostDisplay({ valueUsd: 5.2, costTruth: 'unknown', formatUsd });
    assert.equal(result.label, '$5.20+');
    assert.equal(result.isPartial, true);
  });

  it('TEST 5: unknown + positive -> partial-cost explanation', () => {
    const result = resolveCostDisplay({ valueUsd: 5.2, costTruth: 'unknown', formatUsd });
    assert.equal(result.description, 'Costo parcial: existen operaciones con costo no calculado.');
  });

  it('TEST 6: never infers unknown-ness from a numeric zero — costTruth must be explicit', () => {
    const complete = resolveCostDisplay({ valueUsd: 0, costTruth: 'complete', formatUsd });
    assert.equal(complete.isPartial, false);
    assert.equal(complete.label, '$0.00');

    const unknown = resolveCostDisplay({ valueUsd: 0, costTruth: 'unknown', formatUsd });
    assert.equal(unknown.isPartial, true);
    assert.equal(unknown.label, 'Costo desconocido');
  });
});

describe('resolveRemainingCostDisplay', () => {
  it('TEST 17: unknown truth -> Indeterminado, never an exact number', () => {
    const result = resolveRemainingCostDisplay(3.5, 'unknown', formatUsd);
    assert.equal(result.label, 'Indeterminado');
    assert.equal(result.isPartial, true);
    assert.equal(result.description, 'El consumo USD incluye operaciones con costo no calculado.');
  });

  it('TEST 18: complete truth -> normal remaining USD, no marker', () => {
    const result = resolveRemainingCostDisplay(3.5, 'complete', formatUsd);
    assert.equal(result.label, '$3.50');
    assert.equal(result.isPartial, false);
    assert.equal(result.description, null);
  });
});
