/**
 * readWizardBudgetPeriodSnapshot — AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1.
 *
 * Read-only lookup used ONLY to explain a `BUDGET_EXCEEDED` block the atomic
 * reservation RPC already decided (migration 064: available = budget_credits -
 * credits_consumed - credits_reserved). Never writes, never changes what the
 * RPC allows.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readWizardBudgetPeriodSnapshot } from '../wizard-budget-reservations';
import type { BudgetPeriodLookupClient } from '../wizard-budget-reservations';

function fakeClient(
  row: { budget_credits: number; credits_consumed: number; credits_reserved: number } | null,
  error: { message: string } | null = null,
): BudgetPeriodLookupClient {
  return {
    from: (table: string) => {
      assert.equal(table, 'wizard_monthly_budget_periods');
      return {
        select: (cols: string) => {
          assert.equal(cols, 'budget_credits, credits_consumed, credits_reserved');
          return {
            eq: (col: string, val: string) => {
              assert.equal(col, 'period_start');
              assert.equal(val, '2026-08-01');
              return { maybeSingle: async () => ({ data: row, error }) };
            },
          };
        },
      };
    },
  };
}

describe('readWizardBudgetPeriodSnapshot', () => {
  it('deriva availableCredits con la fórmula de la migración 064 (matches the real prod numbers)', async () => {
    // Producción conocida: budget=244, consumed=239, reserved=0 → available=5.
    const snapshot = await readWizardBudgetPeriodSnapshot(
      '2026-08-01',
      fakeClient({ budget_credits: 244, credits_consumed: 239, credits_reserved: 0 }),
    );
    assert.deepEqual(snapshot, {
      budgetCredits: 244,
      creditsConsumed: 239,
      creditsReserved: 0,
      availableCredits: 5,
    });
  });

  it('resta también la reserva viva, no sólo lo consumido', async () => {
    const snapshot = await readWizardBudgetPeriodSnapshot(
      '2026-08-01',
      fakeClient({ budget_credits: 100, credits_consumed: 50, credits_reserved: 30 }),
    );
    assert.equal(snapshot?.availableCredits, 20);
  });

  it('available puede ser 0 (exhausted real, no sólo insuficiente)', async () => {
    const snapshot = await readWizardBudgetPeriodSnapshot(
      '2026-08-01',
      fakeClient({ budget_credits: 50, credits_consumed: 50, credits_reserved: 0 }),
    );
    assert.equal(snapshot?.availableCredits, 0);
  });

  it('fila ausente → null (el llamador cae al copy genérico, no a un número inventado)', async () => {
    const snapshot = await readWizardBudgetPeriodSnapshot('2026-08-01', fakeClient(null));
    assert.equal(snapshot, null);
  });

  it('error de DB → null, nunca lanza', async () => {
    const snapshot = await readWizardBudgetPeriodSnapshot(
      '2026-08-01',
      fakeClient(null, { message: 'connection reset' }),
    );
    assert.equal(snapshot, null);
  });
});
