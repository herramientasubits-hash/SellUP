/**
 * Tests — Agent 1 · v1.16K-R-B — Tavily LinkedIn pricing & usage-logging hardening
 *
 * Verifies the cost-tracking gap fix for controlled LinkedIn company search:
 *
 *   1. Pricing loader exposes a dedicated resolver for
 *      tavily/linkedin_company_search (loadActiveTavilyLinkedInCompanySearchPricing).
 *   2. Orchestrator: real Tavily mode WITHOUT resolved pricing (unitCostUsd=null)
 *      fails visibly (skipped_reason='missing_pricing', zero provider calls, zero
 *      usage logs) — never silently logs $0.
 *   3. Orchestrator: real Tavily mode WITH resolved pricing emits usage logs whose
 *      estimated_cost_usd > 0 and never null.
 *   4. dryRun never trips the pricing guard and never accrues cost.
 *   5. Incremental search threads unitCostUsd into the override; flag off → no
 *      override (no usage logs at all).
 *
 * NO real Tavily / Apollo / Lusha / LLM / LinkedIn / Supabase calls. The provider
 * is an injected mock; the usage logger is captured in-memory; the flag is toggled
 * via env. ENABLE_LINKEDIN_COMPANY_SEARCH is never enabled outside a single test
 * that toggles it locally and restores it.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runControlledLinkedInCompanySearch,
  type LinkedInSearchConfig,
  type ControlledLinkedInSearchCandidate,
  type LinkedInSearchProviderFn,
  type LinkedInUsageLogPayload,
  type LinkedInUsageLoggerFn,
} from '../linkedin-company-search';
import { loadActiveTavilyLinkedInCompanySearchPricing } from '@/modules/usage-tracking/provider-pricing';
import { runIncrementalProspectingSearch } from '../incremental-search';
import { LINKEDIN_COMPANY_SEARCH_FLAG } from '@/lib/feature-flags.server';
import type { LinkedInSearchOverride } from '../candidate-writer';
import type { CandidateWriterInput, CandidateWriterOutput } from '../types';
import type { IncrementalSearchInput } from '../incremental-search-types';

const CHECKED_AT = '2026-06-26T10:00:00.000Z';
const BATCH_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TAVILY_UNIT_COST = 0.008;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TAVILY_STRICT_CONFIG: LinkedInSearchConfig = {
  enabled: true,
  provider: 'tavily',
  maxPerBatch: 3,
  minConfidenceScore: 70,
  maxQueriesPerCandidate: 1,
  maxResultsPerQuery: 1,
};

function makeCandidate(
  overrides: Partial<ControlledLinkedInSearchCandidate> = {},
): ControlledLinkedInSearchCandidate {
  return {
    name: 'Softland Colombia',
    domain: 'softland.com.co',
    countryCode: 'CO',
    sourceTitle: 'Softland Colombia - Software ERP',
    sourceSnippet: 'Software ERP para empresas en Colombia.',
    confidenceScore: 80,
    currentEnrichment: {
      enabled: true,
      status: 'not_found',
      confidence: 0,
      warnings: ['No LinkedIn company URL available in current evidence.'],
      source: 'none',
      checked_at: CHECKED_AT,
    },
    isBlockedByDuplicateGuard: false,
    isBlockedByEvidencePolicy: false,
    ...overrides,
  };
}

/** Provider that counts how many times it is invoked. */
function makeCountingProvider(urls: string[] = []): {
  calls: () => number;
  fn: LinkedInSearchProviderFn;
} {
  const state = { count: 0 };
  return {
    calls: () => state.count,
    fn: async () => {
      state.count++;
      return urls;
    },
  };
}

/** In-memory usage logger that captures every payload. */
function makeCapturingLogger(): {
  payloads: LinkedInUsageLogPayload[];
  fn: LinkedInUsageLoggerFn;
} {
  const payloads: LinkedInUsageLogPayload[] = [];
  return {
    payloads,
    fn: async (payload: LinkedInUsageLogPayload) => {
      payloads.push(payload);
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// G1 — Pricing loader for linkedin_company_search
// ════════════════════════════════════════════════════════════════════════════

describe('G1 — loadActiveTavilyLinkedInCompanySearchPricing', () => {
  it('is an async resolver; returns null (not a throw) when Supabase is unconfigured', async () => {
    const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const result = await loadActiveTavilyLinkedInCompanySearchPricing();
      // Without credentials the loader must degrade to null, never throw.
      assert.equal(result, null);
    } finally {
      if (prevUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
      if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G2 — Missing pricing guard (real Tavily mode, unitCostUsd=null)
// ════════════════════════════════════════════════════════════════════════════

describe('G2 — real Tavily mode without pricing fails visibly, never logs $0', () => {
  it('unitCostUsd=null → skipped_reason=missing_pricing, zero provider calls, zero usage logs', async () => {
    const provider = makeCountingProvider(['https://www.linkedin.com/company/softland']);
    const logger = makeCapturingLogger();

    const output = await runControlledLinkedInCompanySearch(
      [makeCandidate()],
      TAVILY_STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: null },
        usageLoggerFn: logger.fn,
      },
    );

    assert.equal(output.batchMetadata.skipped_reason, 'missing_pricing');
    assert.equal(output.results[0].attempted, false);
    assert.equal(output.results[0].skipReason, 'missing_pricing');
    assert.equal(provider.calls(), 0, 'no Tavily provider call may happen without pricing');
    assert.equal(logger.payloads.length, 0, 'no usage log may be written without pricing');
    assert.equal(output.usagePayloads.length, 0);
    assert.equal(output.batchMetadata.estimated_cost_usd, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G3 — Resolved pricing → estimated_cost_usd > 0 and never null
// ════════════════════════════════════════════════════════════════════════════

describe('G3 — real Tavily mode with pricing emits usage log with estimated_cost_usd > 0', () => {
  it('unitCostUsd=0.008 → usage log written, estimated_cost_usd > 0, not null', async () => {
    const provider = makeCountingProvider([]); // empty result still logs usage
    const logger = makeCapturingLogger();

    const output = await runControlledLinkedInCompanySearch(
      [makeCandidate()],
      TAVILY_STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: {
          batchId: BATCH_ID,
          userId: USER_A,
          dryRun: false,
          unitCostUsd: TAVILY_UNIT_COST,
        },
        usageLoggerFn: logger.fn,
      },
    );

    assert.equal(provider.calls(), 1, 'exactly one Tavily call (maxQueriesPerCandidate=1)');
    assert.equal(logger.payloads.length, 1, 'exactly one usage log written');

    const logged = logger.payloads[0];
    assert.equal(logged.feature, 'linkedin_company_search');
    assert.equal(logged.provider, 'tavily');
    assert.notEqual(logged.estimated_cost_usd, null, 'estimated_cost_usd must not be null');
    assert.ok(
      (logged.estimated_cost_usd ?? 0) > 0,
      'estimated_cost_usd must be > 0 when pricing is resolved',
    );
    assert.equal(logged.estimated_cost_usd, TAVILY_UNIT_COST);

    // Batch aggregate cost reflects the resolved unit cost.
    assert.equal(output.batchMetadata.estimated_cost_usd, TAVILY_UNIT_COST);
    assert.equal(output.batchMetadata.usage_logged, true);
    assert.equal(output.batchMetadata.usage_log_success_count, 1);
  });

  it('respects strict caps: 3 candidates, maxPerBatch=3 → at most 3 provider calls', async () => {
    const provider = makeCountingProvider([]);
    const logger = makeCapturingLogger();

    await runControlledLinkedInCompanySearch(
      [
        makeCandidate({ name: 'Alpha SAS', domain: 'alpha.co' }),
        makeCandidate({ name: 'Beta SAS', domain: 'beta.co' }),
        makeCandidate({ name: 'Gamma SAS', domain: 'gamma.co' }),
        makeCandidate({ name: 'Delta SAS', domain: 'delta.co' }),
      ],
      TAVILY_STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: {
          batchId: BATCH_ID,
          userId: USER_A,
          dryRun: false,
          unitCostUsd: TAVILY_UNIT_COST,
        },
        usageLoggerFn: logger.fn,
      },
    );

    assert.ok(provider.calls() <= 3, 'maxPerBatch=3 hard caps provider calls');
    assert.ok(logger.payloads.length <= 3, 'no more usage logs than provider calls');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G4 — dryRun never trips pricing guard, never accrues cost
// ════════════════════════════════════════════════════════════════════════════

describe('G4 — dryRun is exempt from the pricing guard and from cost', () => {
  it('dryRun + unitCostUsd=null → not blocked by missing_pricing, no usage logs, no cost', async () => {
    const provider = makeCountingProvider(['https://www.linkedin.com/company/softland']);
    const logger = makeCapturingLogger();

    const output = await runControlledLinkedInCompanySearch(
      [makeCandidate()],
      TAVILY_STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: true, unitCostUsd: null },
        usageLoggerFn: logger.fn,
      },
    );

    assert.notEqual(
      output.batchMetadata.skipped_reason,
      'missing_pricing',
      'dryRun must not be blocked by the pricing guard',
    );
    assert.equal(output.batchMetadata.skipped_reason, 'dry_run');
    assert.equal(logger.payloads.length, 0, 'dryRun writes no usage logs');
    assert.equal(output.usagePayloads.length, 0, 'dryRun accumulates no usage payloads');
    assert.equal(output.batchMetadata.estimated_cost_usd, null, 'dryRun accrues no cost');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G5 — Incremental search wiring: flag gating + unitCostUsd threading
// ════════════════════════════════════════════════════════════════════════════

type CapturedWriterArgs = {
  linkedInSearchOverride: LinkedInSearchOverride | undefined;
};

function makeCapturingWriter(captured: { args: CapturedWriterArgs | null }) {
  return async (
    _input: CandidateWriterInput,
    _admin?: unknown,
    linkedInSearchOverride?: LinkedInSearchOverride,
  ): Promise<CandidateWriterOutput> => {
    captured.args = { linkedInSearchOverride };
    return {
      dryRun: false,
      batchId: 'batch-fake-0000-0000-0000-000000000001',
      candidatesCreated: 1,
      candidatesSkipped: 0,
      createdCandidateIds: ['cand-001'],
      skipped: [],
      status: 'success',
      errors: [],
    };
  };
}

function makeIncrementalInput(): IncrementalSearchInput {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'EdTech',
    webSearchProvider: 'mock',
    dryRun: false,
    triggeredByUserId: USER_A,
    ownerId: USER_A,
  };
}

describe('G5 — incremental search threads unitCostUsd and respects the flag', () => {
  afterEach(() => {
    delete process.env[LINKEDIN_COMPANY_SEARCH_FLAG];
  });

  it('flag OFF (default) → no override → no LinkedIn usage logs possible', async () => {
    delete process.env[LINKEDIN_COMPANY_SEARCH_FLAG];
    const captured: { args: CapturedWriterArgs | null } = { args: null };

    await runIncrementalProspectingSearch(makeIncrementalInput(), makeCapturingWriter(captured));

    assert.ok(captured.args);
    assert.equal(captured.args.linkedInSearchOverride, undefined);
  });

  it('flag ON → override carries the unitCostUsd field (resolved from pricing config)', async () => {
    process.env[LINKEDIN_COMPANY_SEARCH_FLAG] = 'true';
    const captured: { args: CapturedWriterArgs | null } = { args: null };

    await runIncrementalProspectingSearch(makeIncrementalInput(), makeCapturingWriter(captured));

    const override = captured.args?.linkedInSearchOverride;
    assert.ok(override, 'a LinkedIn override must be passed when the flag is on');
    // The override always carries the unitCostUsd field so the writer can fold it
    // into the default usage context. Value is null when pricing is unresolved
    // (e.g. no Supabase in test env) or a finite number when resolved.
    assert.ok('unitCostUsd' in override, 'override must expose unitCostUsd');
    assert.ok(
      override.unitCostUsd === null || typeof override.unitCostUsd === 'number',
      'unitCostUsd must be null or a number',
    );
    assert.equal(typeof override.usageLoggerFn, 'function');
  });
});
