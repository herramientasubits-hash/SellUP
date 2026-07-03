/**
 * Tests — GET /api/debug/agent1-apollo-config
 *
 * Verifica la lógica de configuración que expone el endpoint:
 * - Resolución de guardrails de Apollo (sin llamadas reales)
 * - Resolución del provider de discovery
 * - Flags de feature
 *
 * No instancia NextResponse ni hace llamadas HTTP.
 * No consume créditos Apollo. No activa ningún provider.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveApolloMaxQueriesPerRun,
  resolveApolloMaxResultsPerQuery,
  APOLLO_MAX_QUERIES_DEFAULT,
  APOLLO_MAX_QUERIES_HARD_CAP,
  APOLLO_MAX_RESULTS_DEFAULT,
  APOLLO_MAX_RESULTS_HARD_CAP,
} from '@/server/agents/prospecting-toolkit/apollo-cost-guardrails';
import { resolveApolloMaxEnrichmentsPerRun } from '@/lib/feature-flags.server';
import {
  resolveWizardDiscoveryProviderVerbose,
  APOLLO_ORGANIZATION_ROLES,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-resolver';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

// ─── Tests: guardrails apollo (valores que emite el endpoint) ─────────────────

describe('agent1-apollo-config: resolveApolloMaxQueriesPerRun', () => {
  it('returns default when env var absent', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: undefined }, () => {
      assert.strictEqual(resolveApolloMaxQueriesPerRun(), APOLLO_MAX_QUERIES_DEFAULT);
    });
  });

  it('returns parsed value within bounds', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '2' }, () => {
      assert.strictEqual(resolveApolloMaxQueriesPerRun(), 2);
    });
  });

  it('clamps to hard cap', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '99' }, () => {
      assert.strictEqual(resolveApolloMaxQueriesPerRun(), APOLLO_MAX_QUERIES_HARD_CAP);
    });
  });
});

describe('agent1-apollo-config: resolveApolloMaxResultsPerQuery', () => {
  it('returns default when env var absent', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: undefined }, () => {
      assert.strictEqual(resolveApolloMaxResultsPerQuery(), APOLLO_MAX_RESULTS_DEFAULT);
    });
  });

  it('clamps to hard cap', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: '99' }, () => {
      assert.strictEqual(resolveApolloMaxResultsPerQuery(), APOLLO_MAX_RESULTS_HARD_CAP);
    });
  });
});

describe('agent1-apollo-config: resolveApolloMaxEnrichmentsPerRun', () => {
  it('returns 1 when env var absent', () => {
    withEnv({ AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN: undefined }, () => {
      assert.strictEqual(resolveApolloMaxEnrichmentsPerRun(), 1);
    });
  });

  it('clamps to 3 (hard cap)', () => {
    withEnv({ AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN: '99' }, () => {
      assert.strictEqual(resolveApolloMaxEnrichmentsPerRun(), 3);
    });
  });
});

describe('agent1-apollo-config: resolveWizardDiscoveryProviderVerbose', () => {
  it('defaults to tavily when AGENT1_WIZARD_DISCOVERY_PROVIDER absent', () => {
    withEnv({ AGENT1_WIZARD_DISCOVERY_PROVIDER: undefined, ENABLE_APOLLO_COMPANY_SEARCH: undefined }, () => {
      const result = resolveWizardDiscoveryProviderVerbose();
      assert.strictEqual(result.provider, 'tavily');
      assert.strictEqual(result.reason, 'default');
    });
  });

  it('returns tavily when apollo flag is off even with provider override', () => {
    withEnv(
      { AGENT1_WIZARD_DISCOVERY_PROVIDER: 'apollo_organizations', ENABLE_APOLLO_COMPANY_SEARCH: 'false' },
      () => {
        const result = resolveWizardDiscoveryProviderVerbose();
        assert.strictEqual(result.provider, 'tavily');
        assert.strictEqual(result.reason, 'apollo_flag_off');
      }
    );
  });

  it('returns apollo_organizations when both gates are on', () => {
    withEnv(
      { AGENT1_WIZARD_DISCOVERY_PROVIDER: 'apollo_organizations', ENABLE_APOLLO_COMPANY_SEARCH: 'true' },
      () => {
        const result = resolveWizardDiscoveryProviderVerbose();
        assert.strictEqual(result.provider, 'apollo_organizations');
        assert.strictEqual(result.reason, 'apollo_both_gates_on');
      }
    );
  });
});

// ─── Tests: APOLLO_ORGANIZATION_ROLES — decisión estratégica Q3F-3 ────────────

describe('agent1-apollo-config: APOLLO_ORGANIZATION_ROLES', () => {
  it('search role is discovery_fallback_experimental', () => {
    assert.strictEqual(APOLLO_ORGANIZATION_ROLES.search, 'discovery_fallback_experimental');
  });

  it('enrichment role is enrichment', () => {
    assert.strictEqual(APOLLO_ORGANIZATION_ROLES.enrichment, 'enrichment');
  });
});
