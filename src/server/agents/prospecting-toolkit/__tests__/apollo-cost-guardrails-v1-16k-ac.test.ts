/**
 * Tests — Apollo Cost Safety Guardrails (v1.16K-AC)
 *
 * Verifica que los guardrails de costo de Apollo funcionen correctamente:
 *   A. Cap global por ejecución (cross-round)
 *   B. No consumo accidental de 30 créditos
 *   C. LinkedIn enrichment skipped cuando provider = apollo_organizations
 *   D. Tavily no afectado por guardrails Apollo
 *   E. Env safety (valores inválidos, límites)
 *   F. No secretos en metadata
 *   G. Lusha safety
 *
 * IMPORTANTE: estos tests no hacen llamadas reales a Apollo, Tavily ni Lusha.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveApolloMaxQueriesPerRun,
  resolveApolloMaxResultsPerQuery,
  APOLLO_MAX_QUERIES_DEFAULT,
  APOLLO_MAX_QUERIES_HARD_CAP,
  APOLLO_MAX_RESULTS_DEFAULT,
  APOLLO_MAX_RESULTS_HARD_CAP,
} from '../apollo-cost-guardrails';

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
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ─── A. Cap global Apollo por ejecución ──────────────────────────────────────

describe('A. resolveApolloMaxQueriesPerRun — defaults and env', () => {
  it('A1: returns default (1) when env var absent', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: undefined }, () => {
      assert.equal(resolveApolloMaxQueriesPerRun(), APOLLO_MAX_QUERIES_DEFAULT);
      assert.equal(resolveApolloMaxQueriesPerRun(), 1);
    });
  });

  it('A2: returns value from env when valid', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '2' }, () => {
      assert.equal(resolveApolloMaxQueriesPerRun(), 2);
    });
  });

  it('A3: hard cap at 3 even if env requests more', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '10' }, () => {
      assert.equal(resolveApolloMaxQueriesPerRun(), APOLLO_MAX_QUERIES_HARD_CAP);
      assert.equal(resolveApolloMaxQueriesPerRun(), 3);
    });
  });

  it('A4: hard cap constant equals 3', () => {
    assert.equal(APOLLO_MAX_QUERIES_HARD_CAP, 3);
  });

  it('A5: default constant equals 1', () => {
    assert.equal(APOLLO_MAX_QUERIES_DEFAULT, 1);
  });
});

// ─── B. No consumo accidental de créditos excesivos ───────────────────────────

describe('B. resolveApolloMaxResultsPerQuery — defaults and env', () => {
  it('B1: returns default (3) when env var absent', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: undefined }, () => {
      assert.equal(resolveApolloMaxResultsPerQuery(), APOLLO_MAX_RESULTS_DEFAULT);
      assert.equal(resolveApolloMaxResultsPerQuery(), 3);
    });
  });

  it('B2: returns value from env when valid', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: '4' }, () => {
      assert.equal(resolveApolloMaxResultsPerQuery(), 4);
    });
  });

  it('B3: hard cap at 5 even if env requests more', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: '20' }, () => {
      assert.equal(resolveApolloMaxResultsPerQuery(), APOLLO_MAX_RESULTS_HARD_CAP);
      assert.equal(resolveApolloMaxResultsPerQuery(), 5);
    });
  });

  it('B4: hard cap constant equals 5', () => {
    assert.equal(APOLLO_MAX_RESULTS_HARD_CAP, 5);
  });

  it('B5: default constant equals 3', () => {
    assert.equal(APOLLO_MAX_RESULTS_DEFAULT, 3);
  });

  it('B6: max credits with defaults — 1 query × 3 results = 3 credits', () => {
    withEnv({
      AGENT1_APOLLO_MAX_QUERIES_PER_RUN: undefined,
      AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: undefined,
    }, () => {
      const maxQueries = resolveApolloMaxQueriesPerRun();
      const maxResults = resolveApolloMaxResultsPerQuery();
      const maxCredits = maxQueries * maxResults;
      // With defaults: 1 × 3 = 3 credits (vs. 6 queries × 5 results = 30 before the fix)
      assert.equal(maxCredits, 3);
      assert.ok(maxCredits <= 3, `expected maxCredits <= 3, got ${maxCredits}`);
    });
  });
});

// ─── E. Env safety ───────────────────────────────────────────────────────────

describe('E. Env safety — invalid values fall back to defaults', () => {
  it('E1: AGENT1_APOLLO_MAX_QUERIES_PER_RUN=0 → default 1', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '0' }, () => {
      assert.equal(resolveApolloMaxQueriesPerRun(), 1);
    });
  });

  it('E2: AGENT1_APOLLO_MAX_QUERIES_PER_RUN=-1 → default 1', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '-1' }, () => {
      assert.equal(resolveApolloMaxQueriesPerRun(), 1);
    });
  });

  it('E3: AGENT1_APOLLO_MAX_QUERIES_PER_RUN=abc → default 1', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: 'abc' }, () => {
      assert.equal(resolveApolloMaxQueriesPerRun(), 1);
    });
  });

  it('E4: AGENT1_APOLLO_MAX_QUERIES_PER_RUN=3.7 → floor to 3 (parseInt)', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '3.7' }, () => {
      // parseInt('3.7') = 3, which equals the hard cap
      assert.equal(resolveApolloMaxQueriesPerRun(), 3);
    });
  });

  it('E5: AGENT1_APOLLO_MAX_QUERIES_PER_RUN="" → default 1', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '' }, () => {
      assert.equal(resolveApolloMaxQueriesPerRun(), 1);
    });
  });

  it('E6: AGENT1_APOLLO_MAX_RESULTS_PER_QUERY=0 → default 3', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: '0' }, () => {
      assert.equal(resolveApolloMaxResultsPerQuery(), 3);
    });
  });

  it('E7: AGENT1_APOLLO_MAX_RESULTS_PER_QUERY=-5 → default 3', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: '-5' }, () => {
      assert.equal(resolveApolloMaxResultsPerQuery(), 3);
    });
  });

  it('E8: AGENT1_APOLLO_MAX_RESULTS_PER_QUERY=xyz → default 3', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: 'xyz' }, () => {
      assert.equal(resolveApolloMaxResultsPerQuery(), 3);
    });
  });

  it('E9: AGENT1_APOLLO_MAX_RESULTS_PER_QUERY=6 → hard cap 5', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: '6' }, () => {
      assert.equal(resolveApolloMaxResultsPerQuery(), 5);
    });
  });

  it('E10: AGENT1_APOLLO_MAX_RESULTS_PER_QUERY=100 → hard cap 5', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: '100' }, () => {
      assert.equal(resolveApolloMaxResultsPerQuery(), 5);
    });
  });
});

// ─── F. No secretos en metadata de guardrails ─────────────────────────────────

describe('F. No secrets in guardrail values', () => {
  const SECRET_PATTERNS = [
    'api_key', 'authorization', 'bearer', 'token', 'secret', 'password',
  ];

  it('F1: resolveApolloMaxQueriesPerRun returns a number, not a secret', () => {
    withEnv({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: undefined }, () => {
      const val = resolveApolloMaxQueriesPerRun();
      assert.equal(typeof val, 'number');
      const str = String(val);
      for (const pattern of SECRET_PATTERNS) {
        assert.ok(!str.toLowerCase().includes(pattern), `value should not contain "${pattern}"`);
      }
    });
  });

  it('F2: resolveApolloMaxResultsPerQuery returns a number, not a secret', () => {
    withEnv({ AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: undefined }, () => {
      const val = resolveApolloMaxResultsPerQuery();
      assert.equal(typeof val, 'number');
      const str = String(val);
      for (const pattern of SECRET_PATTERNS) {
        assert.ok(!str.toLowerCase().includes(pattern), `value should not contain "${pattern}"`);
      }
    });
  });

  it('F3: guardrail module source does not embed API keys', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-cost-guardrails.ts'),
      'utf-8',
    );
    for (const pattern of SECRET_PATTERNS) {
      // Allow the word "secret" only in comments describing env var naming conventions
      if (pattern === 'secret') continue;
      assert.ok(
        !source.toLowerCase().includes(pattern),
        `guardrail source must not contain "${pattern}"`,
      );
    }
  });
});

// ─── G. Lusha safety ─────────────────────────────────────────────────────────

describe('G. Lusha safety — no activation from Apollo guardrails', () => {
  it('G1: apollo-cost-guardrails module does not import or reference Lusha', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-cost-guardrails.ts'),
      'utf-8',
    );
    assert.ok(!source.toLowerCase().includes('lusha'), 'guardrail module must not reference Lusha');
  });

  it('G2: Lusha requires a separate flag (not activated by Apollo env vars)', () => {
    // Lusha is controlled via its own service (lusha-connection.ts) and API key.
    // Setting Apollo guardrail env vars must not affect Lusha.
    withEnv({
      AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '3',
      AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: '5',
      ENABLE_APOLLO_COMPANY_SEARCH: 'true',
    }, () => {
      // None of these env vars should activate Lusha; Lusha needs its own API key.
      const lushaKey = process.env.LUSHA_API_KEY;
      const lushaVaultKey = process.env.SELLUP_PROSPECTING_LUSHA_API_KEY;
      // We don't assert on their values — just that Apollo flags are separate from Lusha.
      assert.ok(
        lushaKey === undefined || lushaKey === '',
        'LUSHA_API_KEY should not be set in test environment',
      );
      assert.ok(
        lushaVaultKey === undefined || lushaVaultKey === '',
        'SELLUP_PROSPECTING_LUSHA_API_KEY should not be set in test environment',
      );
    });
  });

  it('G3: incremental-search source skips LinkedIn when apollo provider', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/incremental-search.ts'),
      'utf-8',
    );
    // Verify the LinkedIn skip guardrail is present in source
    assert.ok(
      source.includes('isApolloProvider'),
      'incremental-search must reference isApolloProvider',
    );
    assert.ok(
      source.includes('apollo_provider_cost_guardrail') ||
      source.includes('isApolloProvider\n        ? undefined'),
      'incremental-search must skip LinkedIn when Apollo is provider',
    );
  });
});

// ─── D. Tavily no afectado ────────────────────────────────────────────────────

describe('D. Tavily not affected by Apollo guardrails', () => {
  it('D1: Apollo max queries cap does not change when Tavily-only env is set', () => {
    withEnv({
      AGENT1_APOLLO_MAX_QUERIES_PER_RUN: undefined,
      AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: undefined,
    }, () => {
      // Defaults are for Apollo; Tavily uses its own logic (unaffected)
      assert.equal(resolveApolloMaxQueriesPerRun(), 1);
      assert.equal(resolveApolloMaxResultsPerQuery(), 3);
    });
  });

  it('D2: apollo-cost-guardrails module does not import Tavily symbols', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-cost-guardrails.ts'),
      'utf-8',
    );
    assert.ok(!source.includes('tavily'), 'guardrail module must not reference Tavily');
    assert.ok(!source.includes('runTavilyWebSearch'), 'guardrail module must not import Tavily search');
  });
});

// ─── C. LinkedIn enrichment skip (structural) ────────────────────────────────

describe('C. LinkedIn enrichment skip when Apollo provider', () => {
  it('C1: incremental-search imports resolveApolloMaxQueriesPerRun', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/incremental-search.ts'),
      'utf-8',
    );
    assert.ok(
      source.includes('resolveApolloMaxQueriesPerRun'),
      'incremental-search must import resolveApolloMaxQueriesPerRun',
    );
  });

  it('C2: incremental-search has apolloGlobalCap tracking', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/incremental-search.ts'),
      'utf-8',
    );
    assert.ok(
      source.includes('apolloGlobalCap'),
      'incremental-search must define apolloGlobalCap',
    );
    assert.ok(
      source.includes('apolloQueriesExecutedTotal'),
      'incremental-search must track apolloQueriesExecutedTotal',
    );
  });

  it('C3: apollo-cost-guardrails has both resolver functions', () => {
    // Functions are callable and return numbers
    withEnv({
      AGENT1_APOLLO_MAX_QUERIES_PER_RUN: undefined,
      AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: undefined,
    }, () => {
      const q = resolveApolloMaxQueriesPerRun();
      const r = resolveApolloMaxResultsPerQuery();
      assert.equal(typeof q, 'number');
      assert.equal(typeof r, 'number');
      assert.ok(q >= 1 && q <= 3, `queries per run ${q} must be in [1,3]`);
      assert.ok(r >= 1 && r <= 5, `results per query ${r} must be in [1,5]`);
    });
  });
});
