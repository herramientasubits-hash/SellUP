/**
 * Tests — credits-display (A1-APOLLO-TWO-ROUND-QA-READINESS-1 § 3–5).
 *
 * El defecto que estos tests fijan: `Number(row.credits_used ?? 0)` convertía un
 * consumo INDETERMINADO en un cero confirmado. Cada caso de abajo separa las
 * tres situaciones que antes colapsaban en el mismo número.
 *
 * Puro: sin Supabase, sin red, sin proveedores. 0 créditos consumidos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveUsageCredits,
  readUsageBillingState,
  accumulateUsageCredits,
  aggregateUsageCredits,
  emptyUsageCreditsTotals,
  resolveCreditsDisplay,
  resolveCreditsTotalsDisplay,
  UNKNOWN_CREDITS_LABEL,
  UNKNOWN_CREDITS_DESCRIPTION,
  PARTIAL_CREDITS_DESCRIPTION,
} from '../credits-display';

// ─── § 3 · las tres reglas ────────────────────────────────────────────────────

describe('§ 3 · resolveUsageCredits', () => {
  it('crédito conocido cero se conserva como cero conocido', () => {
    const value = resolveUsageCredits(0, 'known');
    assert.deepStrictEqual(value, { state: 'known', credits: 0 });
  });

  it('crédito conocido cero sin billing_state sigue siendo conocido', () => {
    assert.deepStrictEqual(resolveUsageCredits(0), { state: 'known', credits: 0 });
  });

  it('crédito positivo conocido se conserva', () => {
    assert.deepStrictEqual(resolveUsageCredits(4), { state: 'known', credits: 4 });
  });

  it('credits_used NULL es desconocido, nunca cero', () => {
    const value = resolveUsageCredits(null);
    assert.strictEqual(value.state, 'unknown');
    assert.strictEqual(value.credits, null);
  });

  it('credits_used undefined es desconocido', () => {
    assert.strictEqual(resolveUsageCredits(undefined).state, 'unknown');
  });

  it('billing_state unknown gana aunque haya un número escrito al lado', () => {
    const value = resolveUsageCredits(3, 'unknown');
    assert.strictEqual(value.state, 'unknown');
    assert.strictEqual(value.credits, null);
  });

  it('un numérico ilegible es desconocido, no cero', () => {
    assert.strictEqual(resolveUsageCredits('no-es-un-numero').state, 'unknown');
  });

  it('acepta el numeric de Postgres serializado como string', () => {
    assert.deepStrictEqual(resolveUsageCredits('2.0000'), { state: 'known', credits: 2 });
  });
});

// ─── billing_state: columna y metadata ────────────────────────────────────────

describe('readUsageBillingState', () => {
  it('lee la columna nativa de la migración 100', () => {
    assert.strictEqual(readUsageBillingState({ billing_state: 'unknown' }), 'unknown');
  });

  it('lee metadata.run_correlation cuando la columna está apagada', () => {
    const state = readUsageBillingState({
      metadata: { run_correlation: { billing_state: 'unknown' } },
    });
    assert.strictEqual(state, 'unknown');
  });

  it('la columna manda sobre la metadata cuando ambas están presentes', () => {
    const state = readUsageBillingState({
      billing_state: 'known',
      metadata: { run_correlation: { billing_state: 'unknown' } },
    });
    assert.strictEqual(state, 'known');
  });

  it('un valor irreconocible no se inventa como conocido', () => {
    assert.strictEqual(readUsageBillingState({ billing_state: 'cualquier-cosa' }), null);
    assert.strictEqual(readUsageBillingState({ metadata: 'no-es-objeto' }), null);
    assert.strictEqual(readUsageBillingState({}), null);
  });
});

// ─── § 4 · el contrato de agregación ──────────────────────────────────────────

describe('§ 4 · agregación', () => {
  it('10 créditos conocidos + 1 operación NULL = 10 conocidos y 1 pendiente', () => {
    const totals = aggregateUsageCredits([
      resolveUsageCredits(4),
      resolveUsageCredits(6),
      resolveUsageCredits(null),
    ]);
    assert.strictEqual(totals.knownCreditsTotal, 10);
    assert.strictEqual(totals.unknownCreditOperations, 1);
    assert.strictEqual(totals.hasUnknownCredits, true);
  });

  it('sin operaciones desconocidas el total es cerrado', () => {
    const totals = aggregateUsageCredits([resolveUsageCredits(3), resolveUsageCredits(0)]);
    assert.deepStrictEqual(totals, {
      knownCreditsTotal: 3,
      unknownCreditOperations: 0,
      hasUnknownCredits: false,
    });
  });

  it('una operación desconocida no aporta ningún número al total', () => {
    const totals = aggregateUsageCredits([resolveUsageCredits(null), resolveUsageCredits(null)]);
    assert.strictEqual(totals.knownCreditsTotal, 0);
    assert.strictEqual(totals.unknownCreditOperations, 2);
  });

  it('accumulate es puro: no muta el acumulador que recibe', () => {
    const base = emptyUsageCreditsTotals();
    const next = accumulateUsageCredits(base, resolveUsageCredits(5));
    assert.strictEqual(base.knownCreditsTotal, 0);
    assert.strictEqual(next.knownCreditsTotal, 5);
  });
});

// ─── § 5 · presentación ───────────────────────────────────────────────────────

describe('§ 5 · presentación', () => {
  it('una operación indeterminada se muestra como pendiente, jamás como 0', () => {
    const display = resolveCreditsDisplay(resolveUsageCredits(null));
    assert.strictEqual(display.label, UNKNOWN_CREDITS_LABEL);
    assert.strictEqual(display.isPartial, true);
    assert.strictEqual(display.description, UNKNOWN_CREDITS_DESCRIPTION);
  });

  it('un cero CONOCIDO sigue mostrándose como cero', () => {
    const display = resolveCreditsDisplay(resolveUsageCredits(0));
    assert.strictEqual(display.label, '0');
    assert.strictEqual(display.isPartial, false);
  });

  it('un total con pendientes se muestra como cota inferior, no como total cerrado', () => {
    const display = resolveCreditsTotalsDisplay({
      totals: { knownCreditsTotal: 10, unknownCreditOperations: 1, hasUnknownCredits: true },
    });
    assert.strictEqual(display.label, '10+');
    assert.strictEqual(display.isPartial, true);
    assert.strictEqual(display.description, PARTIAL_CREDITS_DESCRIPTION);
  });

  it('sin nada conocido no se muestra un 0 que se leería como "sin consumo"', () => {
    const display = resolveCreditsTotalsDisplay({
      totals: { knownCreditsTotal: 0, unknownCreditOperations: 3, hasUnknownCredits: true },
    });
    assert.strictEqual(display.label, UNKNOWN_CREDITS_LABEL);
  });

  it('un total completo se muestra sin marcas ni sufijos', () => {
    const display = resolveCreditsTotalsDisplay({
      totals: { knownCreditsTotal: 12, unknownCreditOperations: 0, hasUnknownCredits: false },
    });
    assert.deepStrictEqual(display, { label: '12', isPartial: false, description: null });
  });

  it('ninguna etiqueta afirma gratuidad para una operación indeterminada', () => {
    const labels = [
      resolveCreditsDisplay(resolveUsageCredits(null)).label,
      resolveCreditsTotalsDisplay({
        totals: { knownCreditsTotal: 0, unknownCreditOperations: 1, hasUnknownCredits: true },
      }).label,
    ];
    for (const label of labels) {
      assert.doesNotMatch(label, /gratis|sin consumo|^0$/i, `etiqueta prohibida: ${label}`);
    }
  });
});
