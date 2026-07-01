// Tests for parseBudgetCheck helper (Hito G — pure unit tests, no DB)
// Runner: node --import tsx --test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBudgetCheck,
  OUTCOME_LABEL,
  SCOPE_LABEL,
  ON_EXCEED_LABEL,
} from '../budget-check-parser';

function assertParsed(v: unknown) {
  if (!v || typeof v !== 'object') throw new Error('Expected non-null ParsedBudgetCheck');
  return v as Record<string, unknown>;
}

describe('parseBudgetCheck', () => {
  it('returns null for null input', () => {
    assert.equal(parseBudgetCheck(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(parseBudgetCheck(undefined), null);
  });

  it('returns null for non-object input', () => {
    assert.equal(parseBudgetCheck('string'), null);
    assert.equal(parseBudgetCheck(42), null);
    assert.equal(parseBudgetCheck([]), null);
  });

  it('parses a clean allowed Apollo check', () => {
    const raw = {
      mode: 'alert_only',
      provider_key: 'apollo',
      allowed: true,
      would_block_in_enforcement: false,
      scope_applied: 'global',
      matched_rule_id: 'rule-uuid-123',
      on_exceed: 'alert',
      reason: null,
      consumed_credits: 50,
      projected_credits: 51,
      remaining_credits: 949,
    };

    const result = assertParsed(parseBudgetCheck(raw));
    assert.equal(result['outcome'], 'allowed');
    assert.equal(result['allowed'], true);
    assert.equal(result['wouldBlockInEnforcement'], false);
    assert.equal(result['scopeApplied'], 'global');
    assert.equal(result['matchedRuleId'], 'rule-uuid-123');
    assert.equal(result['onExceed'], 'alert');
    assert.equal(result['consumedCredits'], 50);
    assert.equal(result['projectedCredits'], 51);
    assert.equal(result['remainingCredits'], 949);
    assert.equal(result['technicalError'], null);
    assert.equal(result['missingUser'], false);
  });

  it('parses a would_block check correctly', () => {
    const raw = {
      mode: 'alert_only',
      provider_key: 'apollo',
      allowed: false,
      would_block_in_enforcement: true,
      scope_applied: 'global',
      matched_rule_id: 'some-id',
      on_exceed: 'block',
      reason: '100 créditos proyectados vs límite de 50',
      consumed_credits: 50,
      projected_credits: 100,
      remaining_credits: 0,
    };

    const result = assertParsed(parseBudgetCheck(raw));
    assert.equal(result['outcome'], 'would_block');
    assert.equal(result['wouldBlockInEnforcement'], true);
    assert.equal(result['reason'], '100 créditos proyectados vs límite de 50');
  });

  it('outcome is alerted when allowed=true but reason present', () => {
    const raw = {
      mode: 'alert_only',
      provider_key: 'tavily',
      operation_key: 'multi_query_web_search',
      allowed: true,
      would_block_in_enforcement: false,
      scope_applied: 'global',
      matched_rule_id: null,
      on_exceed: 'alert',
      reason: 'Se acerca al límite',
      consumed_credits: 90,
      projected_credits: 91,
      remaining_credits: 10,
    };

    const result = assertParsed(parseBudgetCheck(raw));
    assert.equal(result['outcome'], 'alerted');
    assert.equal(result['operationKey'], 'multi_query_web_search');
  });

  it('parses technical_error outcome', () => {
    const raw = {
      mode: 'alert_only',
      provider_key: 'apollo',
      allowed: true,
      would_block_in_enforcement: false,
      scope_applied: 'unknown',
      matched_rule_id: null,
      on_exceed: null,
      reason: null,
      consumed_credits: 0,
      projected_credits: 1,
      remaining_credits: null,
      technical_error: 'Supabase service credentials not configured',
    };

    const result = assertParsed(parseBudgetCheck(raw));
    assert.equal(result['outcome'], 'technical_error');
    assert.equal(result['technicalError'], 'Supabase service credentials not configured');
  });

  it('parses missing_user outcome (Tavily)', () => {
    const raw = {
      mode: 'alert_only',
      provider_key: 'tavily',
      operation_key: 'linkedin_company_search',
      allowed: true,
      would_block_in_enforcement: false,
      scope_applied: 'unknown',
      matched_rule_id: null,
      on_exceed: null,
      reason: 'missing_user_id',
      consumed_credits: 0,
      projected_credits: 8,
      remaining_credits: null,
      missing_user: true,
    };

    const result = assertParsed(parseBudgetCheck(raw));
    assert.equal(result['outcome'], 'missing_user');
    assert.equal(result['missingUser'], true);
  });

  it('handles empty object gracefully', () => {
    const result = assertParsed(parseBudgetCheck({}));
    assert.equal(result['outcome'], 'allowed');
    assert.equal(result['allowed'], true);
    assert.equal(result['consumedCredits'], null);
  });

  it('handles unknown scope_applied safely', () => {
    const result = assertParsed(parseBudgetCheck({ scope_applied: 'custom_scope' }));
    assert.equal(result['scopeApplied'], 'unknown');
  });

  it('handles invalid on_exceed safely', () => {
    const result = assertParsed(parseBudgetCheck({ on_exceed: 'unknown_action' }));
    assert.equal(result['onExceed'], null);
  });
});

describe('OUTCOME_LABEL', () => {
  it('has human-readable labels for all outcomes', () => {
    assert.equal(OUTCOME_LABEL['allowed'], 'Permitido');
    assert.equal(OUTCOME_LABEL['would_block'], 'Habría bloqueado');
    assert.equal(OUTCOME_LABEL['technical_error'], 'Error técnico');
    assert.equal(OUTCOME_LABEL['missing_user'], 'Sin usuario');
  });
});

describe('SCOPE_LABEL', () => {
  it('translates all scopes to Spanish', () => {
    assert.equal(SCOPE_LABEL['global'], 'Global');
    assert.equal(SCOPE_LABEL['user'], 'Usuario');
    assert.equal(SCOPE_LABEL['group'], 'Grupo');
    assert.equal(SCOPE_LABEL['role'], 'Rol');
    assert.equal(SCOPE_LABEL['none'], 'Ninguno');
  });
});

describe('ON_EXCEED_LABEL', () => {
  it('translates all on_exceed values', () => {
    assert.equal(ON_EXCEED_LABEL['alert'], 'Alertar');
    assert.equal(ON_EXCEED_LABEL['block'], 'Bloquear');
    assert.equal(ON_EXCEED_LABEL['require_approval'], 'Requiere aprobación');
    assert.equal(ON_EXCEED_LABEL['none'], 'No configurado');
  });
});
