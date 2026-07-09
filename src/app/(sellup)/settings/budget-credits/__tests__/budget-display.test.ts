// 17B.4X.5H — budget "consumido" display truth tests.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveConsumedDisplay } from '../budget-display';
import { resolveRemainingCostDisplay } from '@/modules/usage-tracking/cost-display';

describe('deriveConsumedDisplay', () => {
  it('TEST 14: complete consumption -> normal consumed USD', () => {
    const result = deriveConsumedDisplay(0, 5.2, false);
    assert.equal(result.label, '$5.20');
    assert.equal(result.description, undefined);
  });

  it('TEST 15: unknown + positive known subtotal -> consumed USD with a trailing +', () => {
    const result = deriveConsumedDisplay(0, 5.2, true);
    assert.equal(result.label, '$5.20+');
    assert.equal(result.description, 'Costo parcial: existen operaciones con costo no calculado.');
  });

  it('TEST 16: unknown + zero known subtotal -> Costo desconocido', () => {
    const result = deriveConsumedDisplay(0, 0, true);
    assert.equal(result.label, 'Costo desconocido');
  });

  it('complete + zero + zero credits -> bare dash (no misleading marker)', () => {
    const result = deriveConsumedDisplay(0, 0, false);
    assert.equal(result.label, '—');
  });

  it('combines credits and USD parts when both are present', () => {
    const result = deriveConsumedDisplay(120, 5.2, false);
    assert.equal(result.label, '120 cr · $5.20');
  });
});

describe('resolveRemainingCostDisplay — budget remaining USD', () => {
  it('TEST 17: unknown USD truth -> remaining USD renders as Indeterminado', () => {
    const result = resolveRemainingCostDisplay(1, 'unknown', (v) => `$${v.toFixed(2)}`);
    assert.equal(result.label, 'Indeterminado');
  });

  it('TEST 18: complete USD truth -> normal remaining USD', () => {
    const result = resolveRemainingCostDisplay(1, 'complete', (v) => `$${v.toFixed(2)}`);
    assert.equal(result.label, '$1.00');
  });
});
