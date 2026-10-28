/**
 * Los únicos límites de gasto son los de Configuración › Proveedores (dueña 28-10):
 * sin nada configurado, libre para todos; con un límite que bloquea, se respeta.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { configuredLimitMessage, decideConfiguredLimit } from '../configured-limit-gate';

const NO_QUOTA = { allowed: true, providerCreditsAvailable: null };
const NO_RULE = { allowed: true, remainingCredits: null, enforces: false };

describe('decideConfiguredLimit', () => {
  it('sin cupo ni regla: pasa y no inventa un saldo', () => {
    assert.deepEqual(decideConfiguredLimit({ quota: NO_QUOTA, rule: NO_RULE, requiredCredits: 50 }), {
      status: 'available',
      availableCredits: null,
    });
  });

  it('el cupo del proveedor manda cuando no alcanza para la búsqueda', () => {
    const quota = { allowed: true, providerCreditsAvailable: 3 };
    assert.deepEqual(decideConfiguredLimit({ quota, rule: NO_RULE, requiredCredits: 6 }), {
      status: 'blocked',
      reason: 'provider_quota',
      availableCredits: 3,
    });
    assert.deepEqual(decideConfiguredLimit({ quota, rule: NO_RULE, requiredCredits: 2 }), {
      status: 'available',
      availableCredits: 3,
    });
  });

  it('una regla que bloquea y no alcanza, bloquea', () => {
    const rule = { allowed: false, remainingCredits: 4, enforces: true };
    assert.deepEqual(decideConfiguredLimit({ quota: NO_QUOTA, rule, requiredCredits: 6 }), {
      status: 'blocked',
      reason: 'rule',
      availableCredits: 4,
    });
  });

  it('una regla que sólo avisa no cuenta como tope', () => {
    const rule = { allowed: true, remainingCredits: 0, enforces: false };
    assert.deepEqual(decideConfiguredLimit({ quota: NO_QUOTA, rule, requiredCredits: 6 }), {
      status: 'available',
      availableCredits: null,
    });
  });

  it('lo disponible es lo menor entre el cupo y la regla que bloquea', () => {
    const quota = { allowed: true, providerCreditsAvailable: 100 };
    const rule = { allowed: true, remainingCredits: 12, enforces: true };
    assert.deepEqual(decideConfiguredLimit({ quota, rule, requiredCredits: 6 }), {
      status: 'available',
      availableCredits: 12,
    });
  });

  it('una estimación ilegible cuesta al menos un crédito', () => {
    const quota = { allowed: true, providerCreditsAvailable: 0 };
    assert.equal(decideConfiguredLimit({ quota, rule: NO_RULE, requiredCredits: Number.NaN }).status, 'blocked');
  });
});

describe('configuredLimitMessage', () => {
  it('dice qué límite fue y cuánto queda', () => {
    assert.match(
      configuredLimitMessage('lusha', { status: 'blocked', reason: 'rule', availableCredits: 1 }),
      /límite de créditos de Lusha que fijó un administrador.*queda 1 crédito/,
    );
    assert.match(
      configuredLimitMessage('apollo', { status: 'blocked', reason: 'provider_quota', availableCredits: 0 }),
      /Apollo no tiene créditos suficientes.*quedan 0 créditos/,
    );
  });
});
