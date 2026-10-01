// 17B.4X.5H — budget "consumido" display truth tests.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveConsumedCell, deriveConsumedDisplay } from '../budget-display';
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

// La celda «Consumo del mes»: valor principal + subtítulo, nunca una cadena
// larga que la tabla parta en dos renglones a su suerte.
describe('deriveConsumedCell — consumo del mes en dos niveles', () => {
  it('con créditos y dólares, los créditos mandan y el costo va debajo', () => {
    const cell = deriveConsumedCell({ consumedCredits: 17, consumedUsd: 24.03, hasUnknownCost: false }, true);

    assert.equal(cell.primary, '17 créditos');
    assert.equal(cell.secondary, '$24.03 USD');
  });

  it('un solo crédito va en singular', () => {
    const cell = deriveConsumedCell({ consumedCredits: 1, consumedUsd: 0, hasUnknownCost: false }, true);

    assert.equal(cell.primary, '1 crédito');
    assert.equal(cell.secondary, undefined);
  });

  it('solo dólares: el costo es el valor principal, sin subtítulo', () => {
    const cell = deriveConsumedCell({ consumedCredits: 0, consumedUsd: 5.2, hasUnknownCost: false }, true);

    assert.equal(cell.primary, '$5.20 USD');
    assert.equal(cell.secondary, undefined);
  });

  it('costo parcial: conserva el «+» y explica por qué', () => {
    const cell = deriveConsumedCell({ consumedCredits: 0, consumedUsd: 5.2, hasUnknownCost: true }, true);

    assert.equal(cell.primary, '$5.20+ USD');
    assert.equal(cell.description, 'Costo parcial: existen operaciones con costo no calculado.');
  });

  it('costo desconocido no es una cifra: no lleva la unidad', () => {
    const cell = deriveConsumedCell({ consumedCredits: 3, consumedUsd: 0, hasUnknownCost: true }, true);

    assert.equal(cell.primary, '3 créditos');
    assert.equal(cell.secondary, 'Costo desconocido');
  });

  it('medido y sin consumo dice «Sin consumo», no un guion', () => {
    const cell = deriveConsumedCell({ consumedCredits: 0, consumedUsd: 0, hasUnknownCost: false }, true);

    assert.equal(cell.primary, 'Sin consumo');
  });

  it('un proveedor que no se mide desde SellUp no afirma un consumo', () => {
    const cell = deriveConsumedCell({ consumedCredits: 40, consumedUsd: 9, hasUnknownCost: false }, false);

    assert.deepEqual(cell, { primary: '—' });
  });
});
