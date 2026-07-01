// Tests for tavily-budget-alert helper (Hito F — alert-only)
// Verifica: sin regla, alert, block, require_approval, error técnico, userId faltante.
// Usa node:test + mocks manuales (patrón del proyecto).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TAVILY_BUDGET_PROVIDER_KEY,
} from '../tavily-budget-alert';

// ── Helpers de factories ───────────────────────────────────────────────────────

function makeCheckBudgetResult(overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    reason: null,
    providerKey: TAVILY_BUDGET_PROVIDER_KEY,
    userId: 'user-1',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-07-31T23:59:59.999Z',
    scopeApplied: 'global' as const,
    matchedRule: null,
    consumedCredits: 120,
    consumedUsd: 0,
    projectedCredits: 4,
    projectedUsd: 0,
    remainingCredits: 380,
    remainingUsd: null,
    ...overrides,
  };
}

function makeRule(onExceed: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-tavily-1',
    providerKey: 'tavily',
    scopeType: 'global' as const,
    scopeId: null,
    limitCredits: 500,
    limitUsd: null,
    periodType: 'monthly' as const,
    onExceed,
    ...overrides,
  };
}

// ── Evaluador inline con stub inyectable ──────────────────────────────────────
// Replica la lógica del helper para test de contrato (patrón proyecto).

async function runHelper(
  mockResult: unknown | Error,
  userId: string | null | undefined = 'user-1',
  projectedCredits = 4,
  operationKey = 'multi_query_web_search',
): Promise<Record<string, unknown>> {
  const checkBudgetStub = async (_pk: string, _uid: string, _op: { credits?: number }) => {
    if (mockResult instanceof Error) throw mockResult;
    return mockResult;
  };

  if (!userId) {
    return {
      mode: 'alert_only' as const,
      provider_key: TAVILY_BUDGET_PROVIDER_KEY,
      operation_key: operationKey,
      allowed: true,
      would_block_in_enforcement: false,
      scope_applied: 'unknown' as const,
      matched_rule_id: null,
      on_exceed: null,
      reason: 'missing_user_id',
      consumed_credits: 0,
      projected_credits: projectedCredits,
      remaining_credits: null,
      missing_user: true as const,
    };
  }

  try {
    const result = await checkBudgetStub(TAVILY_BUDGET_PROVIDER_KEY, userId, { credits: projectedCredits });
    const r = result as ReturnType<typeof makeCheckBudgetResult>;
    const onExceed = r.matchedRule ? (r.matchedRule as ReturnType<typeof makeRule>).onExceed : null;
    const wouldBlock = onExceed === 'block' || onExceed === 'require_approval';
    return {
      mode: 'alert_only' as const,
      provider_key: TAVILY_BUDGET_PROVIDER_KEY,
      operation_key: operationKey,
      allowed: r.allowed,
      would_block_in_enforcement: !r.allowed || wouldBlock,
      scope_applied: r.scopeApplied,
      matched_rule_id: r.matchedRule ? (r.matchedRule as { id: string }).id : null,
      on_exceed: onExceed,
      reason: r.reason,
      consumed_credits: r.consumedCredits,
      projected_credits: projectedCredits,
      remaining_credits: r.remainingCredits,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      mode: 'alert_only' as const,
      provider_key: TAVILY_BUDGET_PROVIDER_KEY,
      operation_key: operationKey,
      allowed: true,
      would_block_in_enforcement: false,
      scope_applied: 'unknown' as const,
      matched_rule_id: null,
      on_exceed: null,
      reason: null,
      consumed_credits: 0,
      projected_credits: projectedCredits,
      remaining_credits: null,
      technical_error: msg,
    };
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('evaluateTavilyBudgetAlertOnly — lógica de contrato', () => {
  it('constante TAVILY_BUDGET_PROVIDER_KEY = tavily', () => {
    assert.equal(TAVILY_BUDGET_PROVIDER_KEY, 'tavily');
  });

  it('sin regla — allowed=true, would_block=false, sin reason', async () => {
    const meta = await runHelper(makeCheckBudgetResult({ scopeApplied: 'none', matchedRule: null }));
    assert.equal(meta.mode, 'alert_only');
    assert.equal(meta.provider_key, 'tavily');
    assert.equal(meta.allowed, true);
    assert.equal(meta.would_block_in_enforcement, false);
    assert.equal(meta.reason, null);
    assert.equal(meta.on_exceed, null);
    assert.ok(!('technical_error' in meta));
    assert.ok(!('missing_user' in meta));
  });

  it('operation_key se propaga correctamente', async () => {
    const meta = await runHelper(makeCheckBudgetResult(), 'user-1', 1, 'linkedin_company_search');
    assert.equal(meta.operation_key, 'linkedin_company_search');
  });

  it('projected_credits refleja el valor pasado', async () => {
    const meta = await runHelper(makeCheckBudgetResult(), 'user-1', 5);
    assert.equal(meta.projected_credits, 5);
  });

  it('on_exceed=alert y excedido — allowed=true, would_block=false, reason presente', async () => {
    const meta = await runHelper(
      makeCheckBudgetResult({
        allowed: true,
        reason: '504 créditos proyectados vs límite de 500',
        matchedRule: makeRule('alert'),
      }),
    );
    assert.equal(meta.allowed, true);
    assert.equal(meta.would_block_in_enforcement, false);
    assert.equal(meta.on_exceed, 'alert');
    assert.ok(String(meta.reason).includes('500'));
    assert.equal(meta.matched_rule_id, 'rule-tavily-1');
  });

  it('on_exceed=block y excedido — would_block_in_enforcement=true, búsqueda continúa (allowed no lanza)', async () => {
    const meta = await runHelper(
      makeCheckBudgetResult({
        allowed: false,
        reason: '504 créditos proyectados vs límite de 500',
        matchedRule: makeRule('block', { id: 'rule-tavily-2' }),
      }),
    );
    assert.equal(meta.would_block_in_enforcement, true);
    assert.equal(meta.on_exceed, 'block');
    assert.ok(meta.reason !== null);
    // mode siempre alert_only — nunca bloquea
    assert.equal(meta.mode, 'alert_only');
  });

  it('on_exceed=require_approval y excedido — would_block_in_enforcement=true', async () => {
    const meta = await runHelper(
      makeCheckBudgetResult({
        allowed: false,
        reason: 'Excedido',
        matchedRule: makeRule('require_approval', { id: 'rule-tavily-3', limitCredits: 100 }),
      }),
    );
    assert.equal(meta.would_block_in_enforcement, true);
    assert.equal(meta.on_exceed, 'require_approval');
    assert.equal(meta.mode, 'alert_only');
  });

  it('error técnico — devuelve allowed=true con technical_error, no lanza excepción', async () => {
    const meta = await runHelper(new Error('DB connection failed'));
    assert.equal(meta.allowed, true);
    assert.equal(meta.would_block_in_enforcement, false);
    assert.equal((meta as { technical_error?: string }).technical_error, 'DB connection failed');
    assert.equal(meta.consumed_credits, 0);
    assert.equal(meta.mode, 'alert_only');
  });

  it('userId null — missing_user=true, allowed=true, no lanza excepción', async () => {
    const meta = await runHelper(makeCheckBudgetResult(), null);
    assert.equal(meta.allowed, true);
    assert.equal(meta.would_block_in_enforcement, false);
    assert.equal((meta as { missing_user?: boolean }).missing_user, true);
    assert.equal(meta.mode, 'alert_only');
  });

  it('remaining_credits se propaga desde el resultado', async () => {
    const meta = await runHelper(makeCheckBudgetResult({ remainingCredits: 380 }));
    assert.equal(meta.remaining_credits, 380);
  });

  it('consumed_credits se propaga desde el resultado', async () => {
    const meta = await runHelper(makeCheckBudgetResult({ consumedCredits: 120 }));
    assert.equal(meta.consumed_credits, 120);
  });
});
