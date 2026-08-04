// Tests — preflight PURO de saldo del reveal de teléfono
// (Agente 2A · AGENT2A-PHONE-WATERFALL-4D)
//
// OFFLINE por construcción: el módulo bajo prueba no tiene I/O, así que aquí no hay
// red, ni DB, ni Apollo, ni Lusha, ni un solo crédito. El saldo se inyecta como dato.
//
// Lo que se fija es lo que cuesta dinero si se rompe:
//   * el tope exigido por modalidad (13 / 8 / 5) y que sea el del core del waterfall;
//   * que un saldo que no alcanza BLOQUEE (no que "avise");
//   * que un saldo NO verificable bloquee igual (fail-closed) pero con un desenlace
//     distinto: "no se pudo comprobar" no es "no hay créditos";
//   * que la combinación entre proveedores sea la conservadora.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  combinePhoneRevealCreditBalances,
  evaluatePhoneRevealCreditBudget,
  resolvePhoneRevealCreditBudgetMode,
  resolvePhoneRevealCreditBudgetProviders,
  resolvePhoneRevealCreditBudgetRequiredCredits,
  PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS,
  PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS,
  PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
  type PhoneRevealCreditBalance,
} from '../phone-reveal-credit-budget-core';
import {
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
} from '../phone-reveal-waterfall-core';

// ═══════════════════════════════════════════════════════════════
// 1. Topes: espejo del core del waterfall (autoridad real)
// ═══════════════════════════════════════════════════════════════

describe('preflight de saldo — topes alineados con el core del waterfall', () => {
  test('waterfall completo exige 13, y 13 es el tope del core', () => {
    assert.equal(PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS, 13);
    assert.equal(
      PHONE_REVEAL_CREDIT_BUDGET_FULL_WATERFALL_REQUIRED_CREDITS,
      PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
    );
  });

  test('Apollo-only exige 8, y 8 es el tope de la pata Apollo del core', () => {
    assert.equal(PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS, 8);
    assert.equal(
      PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS,
      PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
    );
  });

  test('legacy exige 5, y 5 es el tope legacy del core (jamás 13 ni 8)', () => {
    assert.equal(PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS, 5);
    assert.equal(
      PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
    );
  });

  test('el tope por modalidad se resuelve exactamente a 13 / 8 / 5', () => {
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits('full_waterfall'), 13);
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits('apollo_only'), 8);
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits('legacy_lusha_only'), 5);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Modalidad y proveedores implicados
// ═══════════════════════════════════════════════════════════════

describe('preflight de saldo — modalidad y proveedores', () => {
  test('legacy manda sobre la elegibilidad de Lusha', () => {
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({ legacyLushaOnly: true, lushaEligible: true }),
      'legacy_lusha_only',
    );
  });

  test('sin id Lusha la modalidad es Apollo-only (tope 8, no 13)', () => {
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({
        legacyLushaOnly: false,
        lushaEligible: false,
      }),
      'apollo_only',
    );
  });

  test('con id Lusha la modalidad es el waterfall completo (tope 13)', () => {
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({ legacyLushaOnly: false, lushaEligible: true }),
      'full_waterfall',
    );
  });

  test('cada modalidad consulta SOLO los proveedores que puede llegar a llamar', () => {
    assert.deepEqual(resolvePhoneRevealCreditBudgetProviders('full_waterfall'), [
      'apollo',
      'lusha',
    ]);
    assert.deepEqual(resolvePhoneRevealCreditBudgetProviders('apollo_only'), ['apollo']);
    // Apollo NO se ejecuta en legacy: bloquear por su saldo bloquearía por un
    // proveedor que no va a correr.
    assert.deepEqual(resolvePhoneRevealCreditBudgetProviders('legacy_lusha_only'), [
      'lusha',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Decisión: saldo 5 contra los tres topes
// ═══════════════════════════════════════════════════════════════

describe('preflight de saldo — saldo 5 (el caso del período vigente)', () => {
  const balance: PhoneRevealCreditBalance = { kind: 'available', credits: 5 };

  test('bloquea el waterfall completo de 13', () => {
    const verdict = evaluatePhoneRevealCreditBudget({ mode: 'full_waterfall', balance });
    assert.equal(verdict.decision, 'insufficient_credits');
    assert.equal(verdict.requiredCredits, 13);
    assert.equal(verdict.availableCredits, 5);
  });

  test('bloquea el Apollo-only de 8', () => {
    const verdict = evaluatePhoneRevealCreditBudget({ mode: 'apollo_only', balance });
    assert.equal(verdict.decision, 'insufficient_credits');
    assert.equal(verdict.requiredCredits, 8);
  });

  test('permite el legacy de 5 (contractualmente; aquí solo offline)', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'legacy_lusha_only',
      balance,
    });
    assert.equal(verdict.decision, 'authorized');
    assert.equal(verdict.requiredCredits, 5);
  });
});

describe('preflight de saldo — umbrales y bordes', () => {
  test('el umbral es >= : saldo exacto autoriza, uno menos bloquea', () => {
    for (const [mode, required] of [
      ['full_waterfall', 13],
      ['apollo_only', 8],
      ['legacy_lusha_only', 5],
    ] as const) {
      assert.equal(
        evaluatePhoneRevealCreditBudget({
          mode,
          balance: { kind: 'available', credits: required },
        }).decision,
        'authorized',
        `${mode} con saldo exacto`,
      );
      assert.equal(
        evaluatePhoneRevealCreditBudget({
          mode,
          balance: { kind: 'available', credits: required - 1 },
        }).decision,
        'insufficient_credits',
        `${mode} con un crédito menos`,
      );
    }
  });

  test('saldo 0 bloquea las tres modalidades', () => {
    for (const mode of ['full_waterfall', 'apollo_only', 'legacy_lusha_only'] as const) {
      assert.equal(
        evaluatePhoneRevealCreditBudget({
          mode,
          balance: { kind: 'available', credits: 0 },
        }).decision,
        'insufficient_credits',
        mode,
      );
    }
  });

  test('sin límite configurado NO se inventa un tope: autoriza', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall',
      balance: { kind: 'unlimited' },
    });
    assert.equal(verdict.decision, 'authorized');
    // Y no se reporta un saldo que no existe (ni 0, que significaría "sin saldo").
    assert.equal(verdict.availableCredits, null);
  });

  test('saldo no verificable ⇒ fail-closed, y NO se reporta como "insuficiente"', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall',
      balance: { kind: 'unavailable' },
    });
    assert.equal(verdict.decision, 'balance_unavailable');
    assert.notEqual(verdict.decision, 'insufficient_credits');
    assert.equal(verdict.availableCredits, null);
  });

  test('un saldo numérico roto (NaN / Infinity) es NO verificable, no "grande"', () => {
    for (const credits of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(
        evaluatePhoneRevealCreditBudget({
          mode: 'legacy_lusha_only',
          balance: { kind: 'available', credits },
        }).decision,
        'balance_unavailable',
        String(credits),
      );
    }
  });

  test('un saldo negativo (sobregiro) bloquea', () => {
    assert.equal(
      evaluatePhoneRevealCreditBudget({
        mode: 'legacy_lusha_only',
        balance: { kind: 'available', credits: -3 },
      }).decision,
      'insufficient_credits',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Combinación entre proveedores: conservadora
// ═══════════════════════════════════════════════════════════════

describe('preflight de saldo — combinación de saldos', () => {
  test('un solo proveedor no verificable contamina el resultado (fail-closed)', () => {
    assert.deepEqual(
      combinePhoneRevealCreditBalances([
        { kind: 'available', credits: 100 },
        { kind: 'unavailable' },
      ]),
      { kind: 'unavailable' },
    );
  });

  test('todos sin límite ⇒ sin límite', () => {
    assert.deepEqual(
      combinePhoneRevealCreditBalances([{ kind: 'unlimited' }, { kind: 'unlimited' }]),
      { kind: 'unlimited' },
    );
  });

  test('mezcla de límite y sin límite ⇒ manda el que TIENE límite', () => {
    assert.deepEqual(
      combinePhoneRevealCreditBalances([
        { kind: 'unlimited' },
        { kind: 'available', credits: 7 },
      ]),
      { kind: 'available', credits: 7 },
    );
  });

  test('dos límites ⇒ el MÍNIMO, no la suma', () => {
    // La suma autorizaría un gasto que ninguno de los dos puede cubrir por separado.
    assert.deepEqual(
      combinePhoneRevealCreditBalances([
        { kind: 'available', credits: 9 },
        { kind: 'available', credits: 5 },
      ]),
      { kind: 'available', credits: 5 },
    );
  });

  test('lista vacía ⇒ sin límite (no hay proveedor al que aplicárselo)', () => {
    assert.deepEqual(combinePhoneRevealCreditBalances([]), { kind: 'unlimited' });
  });

  test('un saldo roto dentro de la mezcla también es no verificable', () => {
    assert.deepEqual(
      combinePhoneRevealCreditBalances([
        { kind: 'available', credits: Number.NaN },
        { kind: 'available', credits: 20 },
      ]),
      { kind: 'unavailable' },
    );
  });
});
