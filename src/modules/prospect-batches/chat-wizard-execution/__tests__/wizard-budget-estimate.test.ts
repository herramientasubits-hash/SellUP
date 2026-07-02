/**
 * Tests — wizard-budget-estimate.ts (v1.16K-AG)
 *
 * Covers provider-aware credit estimation and preflight validation logic.
 *
 * A. Apollo defaults pass with available=12, max=25
 * B. Apollo blocks with insufficient available budget
 * C. Apollo blocks when estimate exceeds max_credits_per_execution
 * D. Apollo applies hard caps when env values are extreme
 * E. Tavily regression — uses adaptive pipeline, not Apollo guardrails
 * F. No secrets in metadata output
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveWizardExecutionCreditEstimate,
  estimateCreditsForProvider,
  toWizardBudgetValidationMetadata,
  APOLLO_MAX_QUERIES_DEFAULT,
  APOLLO_MAX_RESULTS_DEFAULT,
  APOLLO_MAX_QUERIES_HARD_CAP,
  APOLLO_MAX_RESULTS_HARD_CAP,
} from '../wizard-budget-estimate';

// ── Env helpers ───────────────────────────────────────────────────────────────

function withApolloEnv(
  overrides: { queries?: string; results?: string },
  fn: () => void,
) {
  const savedQ = process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
  const savedR = process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;

  if (overrides.queries !== undefined) {
    process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN = overrides.queries;
  } else {
    delete process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
  }

  if (overrides.results !== undefined) {
    process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY = overrides.results;
  } else {
    delete process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;
  }

  try {
    fn();
  } finally {
    if (savedQ !== undefined) process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN = savedQ;
    else delete process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;

    if (savedR !== undefined) process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY = savedR;
    else delete process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;
  }
}

// ── Section A: Apollo defaults pass ──────────────────────────────────────────

describe('Section A — Apollo defaults pass (available=12, max=25)', () => {
  it('A1: estimateCreditsForProvider returns 3 with default env', () => {
    withApolloEnv({}, () => {
      const credits = estimateCreditsForProvider('apollo_organizations');
      // default: 1 query × 3 results = 3
      assert.equal(credits, APOLLO_MAX_QUERIES_DEFAULT * APOLLO_MAX_RESULTS_DEFAULT);
      assert.equal(credits, 3);
    });
  });

  it('A2: resolveWizardExecutionCreditEstimate passes with available=12, max=25', () => {
    withApolloEnv({}, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 12,
        maxCreditsPerExecution: 25,
      });
      assert.equal(result.passed, true);
      assert.equal(result.blockReason, null);
      assert.equal(result.estimatedCredits, 3);
      assert.equal(result.estimateSource, 'apollo_cost_guardrails');
      assert.equal(result.apolloMaxQueriesPerRun, 1);
      assert.equal(result.apolloMaxResultsPerQuery, 3);
    });
  });

  it('A3: explicit env 1/3 also passes', () => {
    withApolloEnv({ queries: '1', results: '3' }, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 12,
        maxCreditsPerExecution: 25,
      });
      assert.equal(result.passed, true);
      assert.equal(result.estimatedCredits, 3);
    });
  });
});

// ── Section B: Apollo blocks on insufficient available budget ────────────────

describe('Section B — Apollo blocks when available budget is insufficient', () => {
  it('B1: available=2, max=25, estimate=3 → blocks with insufficient_available_budget', () => {
    withApolloEnv({}, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 2,
        maxCreditsPerExecution: 25,
      });
      assert.equal(result.passed, false);
      assert.equal(result.blockReason, 'insufficient_available_budget');
      assert.equal(result.estimatedCredits, 3);
    });
  });

  it('B2: available=0, max=25, estimate=3 → blocks', () => {
    withApolloEnv({}, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 0,
        maxCreditsPerExecution: 25,
      });
      assert.equal(result.passed, false);
      assert.equal(result.blockReason, 'insufficient_available_budget');
    });
  });

  it('B3: available exactly equal to estimate passes', () => {
    withApolloEnv({}, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 3,
        maxCreditsPerExecution: 25,
      });
      assert.equal(result.passed, true);
      assert.equal(result.blockReason, null);
    });
  });
});

// ── Section C: Apollo blocks when estimate exceeds max_credits_per_execution ──

describe('Section C — Apollo blocks when estimate exceeds max_credits_per_execution', () => {
  it('C1: available=12, max=2, estimate=3 → blocks with exceeds_max_credits_per_execution', () => {
    withApolloEnv({}, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 12,
        maxCreditsPerExecution: 2,
      });
      assert.equal(result.passed, false);
      assert.equal(result.blockReason, 'exceeds_max_credits_per_execution');
    });
  });

  it('C2: max_per_execution check has precedence over available budget check', () => {
    withApolloEnv({}, () => {
      // Both would block; max_per_execution should be the reason
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 0,
        maxCreditsPerExecution: 1,
      });
      assert.equal(result.passed, false);
      assert.equal(result.blockReason, 'exceeds_max_credits_per_execution');
    });
  });
});

// ── Section D: Apollo applies hard caps ──────────────────────────────────────

describe('Section D — Apollo hard caps prevent extreme env values', () => {
  it('D1: env queries=99, results=99 → capped at hard caps (3×5=15)', () => {
    withApolloEnv({ queries: '99', results: '99' }, () => {
      const credits = estimateCreditsForProvider('apollo_organizations');
      // Hard caps: queries ≤ 3, results ≤ 5 → max 15
      assert.equal(credits, APOLLO_MAX_QUERIES_HARD_CAP * APOLLO_MAX_RESULTS_HARD_CAP);
      assert.equal(credits, 15);
    });
  });

  it('D2: capped estimate 15 > available 12 → blocks by budget', () => {
    withApolloEnv({ queries: '99', results: '99' }, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 12,
        maxCreditsPerExecution: 25,
      });
      assert.equal(result.passed, false);
      assert.equal(result.blockReason, 'insufficient_available_budget');
      assert.equal(result.estimatedCredits, 15);
    });
  });

  it('D3: invalid env (non-numeric) → falls back to defaults (1×3=3)', () => {
    withApolloEnv({ queries: 'not_a_number', results: 'bad' }, () => {
      const credits = estimateCreditsForProvider('apollo_organizations');
      assert.equal(credits, 3);
    });
  });

  it('D4: env value 0 → falls back to defaults', () => {
    withApolloEnv({ queries: '0', results: '0' }, () => {
      const credits = estimateCreditsForProvider('apollo_organizations');
      assert.equal(credits, 3);
    });
  });
});

// ── Section E: Tavily regression ─────────────────────────────────────────────

describe('Section E — Tavily regression (no Apollo guardrails used)', () => {
  it('E1: estimateCreditsForProvider tavily returns 20 (adaptive pipeline)', () => {
    const credits = estimateCreditsForProvider('tavily');
    // 4 rounds × 5 queries × 1 credit = 20
    assert.equal(credits, 20);
  });

  it('E2: resolveWizardExecutionCreditEstimate tavily uses tavily_adaptive_pipeline source', () => {
    const result = resolveWizardExecutionCreditEstimate({
      provider: 'tavily',
      availableCredits: 100,
      maxCreditsPerExecution: 25,
    });
    assert.equal(result.estimateSource, 'tavily_adaptive_pipeline');
    assert.equal(result.estimatedCredits, 20);
    assert.equal(result.apolloMaxQueriesPerRun, null);
    assert.equal(result.apolloMaxResultsPerQuery, null);
  });

  it('E3: tavily with available=12, max=25 → blocks by budget (20 > 12)', () => {
    const result = resolveWizardExecutionCreditEstimate({
      provider: 'tavily',
      availableCredits: 12,
      maxCreditsPerExecution: 25,
    });
    assert.equal(result.passed, false);
    assert.equal(result.blockReason, 'insufficient_available_budget');
  });

  it('E4: tavily Apollo env changes have no effect on tavily estimate', () => {
    withApolloEnv({ queries: '99', results: '99' }, () => {
      const credits = estimateCreditsForProvider('tavily');
      // Must still be 20 regardless of Apollo env
      assert.equal(credits, 20);
    });
  });
});

// ── Section F: No secrets in metadata ────────────────────────────────────────

describe('Section F — Metadata contains no secrets', () => {
  const SECRET_PATTERNS = [
    'api_key', 'apikey', 'authorization', 'bearer', 'token',
    'secret', 'password', 'x-api-key', 'api_secret',
  ];

  it('F1: toWizardBudgetValidationMetadata contains no secret fields', () => {
    withApolloEnv({}, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 12,
        maxCreditsPerExecution: 25,
      });
      const meta = toWizardBudgetValidationMetadata(result);
      const metaStr = JSON.stringify(meta).toLowerCase();

      for (const pattern of SECRET_PATTERNS) {
        assert.ok(
          !metaStr.includes(pattern),
          `Metadata must not contain "${pattern}"`,
        );
      }
    });
  });

  it('F2: metadata keys are only expected safe keys', () => {
    withApolloEnv({}, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 12,
        maxCreditsPerExecution: 25,
      });
      const meta = toWizardBudgetValidationMetadata(result);
      const keys = Object.keys(meta);
      const allowedKeys = [
        'provider', 'estimated_credits', 'estimate_source',
        'apollo_max_queries_per_run', 'apollo_max_results_per_query',
        'available_credits', 'max_credits_per_execution',
        'passed', 'block_reason',
      ];
      for (const key of keys) {
        assert.ok(allowedKeys.includes(key), `Unexpected metadata key: ${key}`);
      }
    });
  });

  it('F3: passed result metadata has expected shape', () => {
    withApolloEnv({}, () => {
      const result = resolveWizardExecutionCreditEstimate({
        provider: 'apollo_organizations',
        availableCredits: 12,
        maxCreditsPerExecution: 25,
      });
      const meta = toWizardBudgetValidationMetadata(result);
      assert.equal(meta.provider, 'apollo_organizations');
      assert.equal(meta.estimated_credits, 3);
      assert.equal(meta.estimate_source, 'apollo_cost_guardrails');
      assert.equal(meta.apollo_max_queries_per_run, 1);
      assert.equal(meta.apollo_max_results_per_query, 3);
      assert.equal(meta.available_credits, 12);
      assert.equal(meta.max_credits_per_execution, 25);
      assert.equal(meta.passed, true);
      assert.equal(meta.block_reason, null);
    });
  });
});
