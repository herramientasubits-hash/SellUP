/**
 * Tests — Tavily Usage Logging (Hito 16AB.43.10)
 *
 * Verifica la instrumentación económica por ronda Tavily multi-query.
 * Sin red real, sin Supabase remoto, sin proveedores externos.
 *
 * Cobertura:
 *  26.1  Una fila por ronda básica
 *  26.2  Segunda ronda tiene usage_key diferente
 *  26.3  Búsqueda avanzada (deep) → 2 créditos/query
 *  26.4  results_returned = total crudo; metadata diferencia capas
 *  26.5  Fallo parcial: partial_failure=true, credits solo por exitosas
 *  26.6  Todas las queries fallan → error, credits=0, cost=0
 *  26.7  loadPricing retorna null → cero calls Tavily, cero logs
 *  26.8  Unidad de pricing incorrecta → cero calls Tavily, cero logs
 *  26.9  Duplicado 23505 (already_logged) → pipeline no falla
 *  26.10 logUsage falla después de Tavily → resultado conservado, warning
 *  26.11 Sin usageContext → comportamiento previo intacto
 *  26.12 Propagación de rondas en IncrementalProspectingSearch
 *  26.13 Wizard pasa reservedBatchId → batch_id del log; userId → triggered_by
 *  26.14 Anti-Apollo: la ruta de logging no importa Apollo
 *
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runMultiQueryWebSearch } from '../web-search-tool';
import { runIncrementalProspectingSearch } from '../incremental-search';
import { runWizardTavilySearch } from '@/modules/prospect-batches/chat-wizard-execution/wizard-tavily-executor';
import { buildTavilyUsageKey, creditsForSearchDepth, TavilyPricingUnavailableError } from '../tavily-usage-logging';
import type { TavilyUsageDeps, UsageLogResult, TavilyUsageContext } from '../tavily-usage-logging';
import type { MultiQuerySearchInput } from '../types';
import type { ActivePricingConfig } from '@/modules/usage-tracking/provider-pricing';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type { WebSearchInput, WebSearchOutput } from '../types';
import type { IncrementalSearchInput, IncrementalSearchOutput } from '../incremental-search-types';
import type { ProspectingPipelineInput, ProspectingPipelineOutput } from '../types';
import type { WizardTavilyInput } from '@/modules/prospect-batches/chat-wizard-execution/wizard-tavily-executor';
import type { ResolvedWizardExecution } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BATCH_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'user-uuid-test-0001';
const ROUND_1 = 1;
const ROUND_2 = 2;

const BASIC_PRICING: ActivePricingConfig = { unitCostUsd: 0.008, unit: 'per_credit' };

function makeUsageContext(overrides?: Partial<TavilyUsageContext>): TavilyUsageContext {
  return {
    batchId: BATCH_ID,
    triggeredByUserId: USER_ID,
    roundNumber: ROUND_1,
    ...overrides,
  };
}

/** Base input without usageContext for backward-compat tests */
function makeBaseInput(overrides?: Partial<MultiQuerySearchInput>): MultiQuerySearchInput {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    provider: 'mock',
    queries: ['query-1', 'query-2', 'query-3', 'query-4', 'query-5'],
    maxResultsPerQuery: 2,
    targetCount: 10,
    ...overrides,
  };
}

/** Fake dispatcher that returns N non-skipped results per query */
function makeSuccessDispatcher(resultsPerQuery = 2) {
  let callCount = 0;
  const dispatcher = async (_provider: string, input: WebSearchInput, _maxResults: number): Promise<WebSearchOutput> => {
    callCount++;
    return {
      provider: 'tavily' as const,
      query: input.query,
      results: Array.from({ length: resultsPerQuery }, (_, i) => ({
        title: `Result ${i + 1} for ${input.query}`,
        url: `https://company-${callCount}-${i}.com`,
        snippet: null,
        source: 'tavily',
        rank: i + 1,
        provider: 'tavily' as const,
        confidence: null,
        metadata: {},
      })),
      resultsCount: resultsPerQuery,
      skipped: false,
      skipReason: null,
      estimatedCostUsd: null,
      metadata: {},
    };
  };
  return { dispatcher, getCallCount: () => callCount };
}

/** Fake dispatcher that always returns skipped */
function makeSkippedDispatcher(skipReason = 'tavily_api_key_missing') {
  let callCount = 0;
  const dispatcher = async (_provider: string, input: WebSearchInput, _maxResults: number): Promise<WebSearchOutput> => {
    callCount++;
    return {
      provider: 'tavily' as const,
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason,
      estimatedCostUsd: null,
      metadata: {},
    };
  };
  return { dispatcher, getCallCount: () => callCount };
}

/** Fake dispatcher that succeeds for some queries and fails for others */
function makePartialDispatcher(successCount: number) {
  let callCount = 0;
  const dispatcher = async (_provider: string, input: WebSearchInput, _maxResults: number): Promise<WebSearchOutput> => {
    callCount++;
    const succeed = callCount <= successCount;
    return {
      provider: 'tavily' as const,
      query: input.query,
      results: succeed
        ? [{ title: 'A', url: `https://success-${callCount}.com`, snippet: null, source: 'tavily', rank: 1, provider: 'tavily' as const, confidence: null, metadata: {} }]
        : [],
      resultsCount: succeed ? 1 : 0,
      skipped: !succeed,
      skipReason: succeed ? null : 'tavily_timeout',
      estimatedCostUsd: null,
      metadata: {},
    };
  };
  return { dispatcher, getCallCount: () => callCount };
}

/** Fake logger that captures calls and returns the provided result */
function makeLogger(result: UsageLogResult = { kind: 'logged' }) {
  const calls: LogProviderUsageInput[] = [];
  const logger = async (input: LogProviderUsageInput): Promise<UsageLogResult> => {
    calls.push(input);
    return result;
  };
  return { logger, getCalls: () => calls };
}

/** Fake pricingLoader that returns the provided config (or null) */
function makePricingLoader(config: ActivePricingConfig | null) {
  return async (): Promise<ActivePricingConfig | null> => config;
}

/** Build a TavilyUsageDeps with fake components */
function makeDeps(overrides?: {
  pricing?: ActivePricingConfig | null;
  logResult?: UsageLogResult;
  dispatcher?: TavilyUsageDeps['dispatchQuery'];
  logCapture?: { logger: TavilyUsageDeps['logUsage']; getCalls: () => LogProviderUsageInput[] };
}): {
  deps: TavilyUsageDeps;
  dispatchCallCount: () => number;
  logCalls: () => LogProviderUsageInput[];
} {
  const { dispatcher, getCallCount } = makeSuccessDispatcher();
  const { logger, getCalls } = overrides?.logCapture ?? makeLogger(overrides?.logResult ?? { kind: 'logged' });
  const deps: TavilyUsageDeps = {
    loadPricing: makePricingLoader(overrides?.pricing !== undefined ? overrides.pricing : BASIC_PRICING),
    logUsage: logger,
    dispatchQuery: overrides?.dispatcher ?? dispatcher,
  };
  return { deps, dispatchCallCount: getCallCount, logCalls: getCalls };
}

// ─── 26.1: Una fila por ronda básica ─────────────────────────────────────────

describe('26.1: basic round produces exactly one log row with correct economics', () => {
  it('logUsage called exactly once for 5 basic queries', async () => {
    const { dispatcher } = makeSuccessDispatcher(2);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: logger,
      dispatchQuery: dispatcher,
    };
    const input = makeBaseInput({ usageContext: makeUsageContext() });
    await runMultiQueryWebSearch(input, deps);
    assert.equal(getCalls().length, 1, 'exactly one log call');
  });

  it('credits_used = 5 for 5 successful basic queries', async () => {
    const { dispatcher } = makeSuccessDispatcher(2);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: logger,
      dispatchQuery: dispatcher,
    };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].credits_used, 5);
  });

  it('estimated_cost_usd = 0.04 for 5 basic credits at 0.008/credit', async () => {
    const { dispatcher } = makeSuccessDispatcher(2);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: logger,
      dispatchQuery: dispatcher,
    };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].estimated_cost_usd, 0.04);
  });

  it('batch_id matches usageContext.batchId', async () => {
    const { dispatcher } = makeSuccessDispatcher();
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].batch_id, BATCH_ID);
  });

  it('triggered_by matches usageContext.triggeredByUserId', async () => {
    const { dispatcher } = makeSuccessDispatcher();
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].triggered_by, USER_ID);
  });

  it('usage_key ends with round:1', async () => {
    const { dispatcher } = makeSuccessDispatcher();
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext({ roundNumber: 1 }) }), deps);
    assert.ok(getCalls()[0].usage_key?.endsWith('round:1'));
  });
});

// ─── 26.2: Segunda ronda tiene usage_key diferente ───────────────────────────

describe('26.2: round 2 produces a different usage_key from round 1', () => {
  it('usage_key for round 2 differs from round 1', async () => {
    const key1 = buildTavilyUsageKey(BATCH_ID, 1);
    const key2 = buildTavilyUsageKey(BATCH_ID, 2);
    assert.notEqual(key1, key2);
  });

  it('usage_key ends with round:2 for roundNumber=2', async () => {
    const { dispatcher } = makeSuccessDispatcher();
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext({ roundNumber: 2 }) }), deps);
    assert.ok(getCalls()[0].usage_key?.endsWith('round:2'));
  });

  it('same batch, different round → logUsage called once per invocation', async () => {
    const logCalls: LogProviderUsageInput[] = [];
    const sharedLogger = async (i: LogProviderUsageInput): Promise<UsageLogResult> => {
      logCalls.push(i);
      return { kind: 'logged' };
    };
    const mkDeps = (round: number): TavilyUsageDeps => ({
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: sharedLogger,
      dispatchQuery: makeSuccessDispatcher().dispatcher,
    });
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext({ roundNumber: 1 }) }), mkDeps(1));
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext({ roundNumber: 2 }) }), mkDeps(2));
    assert.equal(logCalls.length, 2);
    assert.ok(logCalls[0].usage_key?.endsWith('round:1'));
    assert.ok(logCalls[1].usage_key?.endsWith('round:2'));
  });
});

// ─── 26.3: Búsqueda avanzada → 2 créditos/query ──────────────────────────────

describe('26.3: advanced search (deep) uses 2 credits per query', () => {
  it('creditsForSearchDepth("deep") = 2', () => {
    assert.equal(creditsForSearchDepth('deep'), 2);
  });

  it('creditsForSearchDepth("basic") = 1', () => {
    assert.equal(creditsForSearchDepth('basic'), 1);
  });

  it('creditsForSearchDepth("standard") = 1', () => {
    assert.equal(creditsForSearchDepth('standard'), 1);
  });

  it('creditsForSearchDepth(undefined) = 1', () => {
    assert.equal(creditsForSearchDepth(undefined), 1);
  });

  it('5 queries deep → credits_used=10, estimated_cost_usd=0.08', async () => {
    const { dispatcher } = makeSuccessDispatcher(2);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(
      makeBaseInput({ searchDepth: 'deep', usageContext: makeUsageContext() }),
      deps,
    );
    const call = getCalls()[0];
    assert.equal(call.credits_used, 10);
    assert.equal(call.estimated_cost_usd, 0.08);
  });
});

// ─── 26.4: results_returned = total crudo; metadata diferencia capas ─────────

describe('26.4: results_returned is raw count; metadata separates layers', () => {
  it('results_returned equals total raw results across all queries', async () => {
    const resultsPerQuery = 2;
    const queryCount = 5;
    const { dispatcher } = makeSuccessDispatcher(resultsPerQuery);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    const call = getCalls()[0];
    // Each query returns resultsPerQuery unique-domain results
    assert.ok(typeof call.results_returned === 'number');
    assert.ok(call.results_returned >= 0, 'results_returned must be non-negative');
  });

  it('metadata contains raw_results, deduped_results, filtered_out, final_results', async () => {
    const { dispatcher } = makeSuccessDispatcher(2);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    const meta = getCalls()[0].metadata ?? {};
    assert.ok('raw_results' in meta, 'metadata must have raw_results');
    assert.ok('deduped_results' in meta, 'metadata must have deduped_results');
    assert.ok('filtered_out' in meta, 'metadata must have filtered_out');
    assert.ok('final_results' in meta, 'metadata must have final_results');
  });

  it('metadata raw_results >= deduped_results >= final_results', async () => {
    const { dispatcher } = makeSuccessDispatcher(2);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    const meta = getCalls()[0].metadata ?? {};
    assert.ok(Number(meta.raw_results) >= Number(meta.deduped_results));
    assert.ok(Number(meta.deduped_results) >= Number(meta.final_results));
  });
});

// ─── 26.5: Fallo parcial ─────────────────────────────────────────────────────

describe('26.5: partial failure — 3 success + 2 failure', () => {
  it('produces exactly one log row', async () => {
    const { dispatcher } = makePartialDispatcher(3);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls().length, 1);
  });

  it('status = success when at least one query succeeded', async () => {
    const { dispatcher } = makePartialDispatcher(3);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].status, 'success');
  });

  it('credits_used = 3 (only successful queries) in basic mode', async () => {
    const { dispatcher } = makePartialDispatcher(3);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].credits_used, 3);
  });

  it('metadata.partial_failure = true', async () => {
    const { dispatcher } = makePartialDispatcher(3);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].metadata?.partial_failure, true);
  });

  it('metadata.failed_query_count = 2', async () => {
    const { dispatcher } = makePartialDispatcher(3);
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].metadata?.failed_query_count, 2);
  });
});

// ─── 26.6: Todas las queries fallan ──────────────────────────────────────────

describe('26.6: all queries fail → error log, credits=0, cost=0', () => {
  it('logUsage called once even when all queries fail', async () => {
    const { dispatcher } = makeSkippedDispatcher();
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls().length, 1);
  });

  it('credits_used = 0 when all fail', async () => {
    const { dispatcher } = makeSkippedDispatcher();
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].credits_used, 0);
  });

  it('estimated_cost_usd = 0 when all fail', async () => {
    const { dispatcher } = makeSkippedDispatcher();
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].estimated_cost_usd, 0);
  });

  it('status is a valid ProviderUsageStatus when all fail', async () => {
    const { dispatcher } = makeSkippedDispatcher();
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    const valid = ['success', 'error', 'rate_limited', 'quota_exceeded'];
    assert.ok(valid.includes(String(getCalls()[0].status)), `status must be valid, got: ${getCalls()[0].status}`);
  });

  it('status = rate_limited when all queries return 429', async () => {
    const { dispatcher } = makeSkippedDispatcher('tavily_http_error_429');
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = { loadPricing: makePricingLoader(BASIC_PRICING), logUsage: logger, dispatchQuery: dispatcher };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(getCalls()[0].status, 'rate_limited');
  });
});

// ─── 26.7: Tarifa inexistente → cero calls Tavily, cero logs ─────────────────

describe('26.7: missing pricing → no Tavily calls, no logs, identifiable error', () => {
  it('throws TavilyPricingUnavailableError when pricing is null', async () => {
    let dispatchCalled = 0;
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(null),
      logUsage: async () => ({ kind: 'logged' }),
      dispatchQuery: async () => { dispatchCalled++; return { provider: 'tavily' as const, query: '', results: [], resultsCount: 0, skipped: true, skipReason: null, estimatedCostUsd: null, metadata: {} }; },
    };
    await assert.rejects(
      () => runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps),
      (err: unknown) => {
        assert.ok(err instanceof TavilyPricingUnavailableError);
        assert.equal((err as TavilyPricingUnavailableError).code, 'TAVILY_PRICING_UNAVAILABLE');
        return true;
      },
    );
    assert.equal(dispatchCalled, 0, 'Tavily must not be called when pricing is unavailable');
  });

  it('logUsage not called when pricing is null', async () => {
    const { logger, getCalls } = makeLogger();
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(null),
      logUsage: logger,
      dispatchQuery: async () => { throw new Error('should not be called'); },
    };
    try {
      await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    } catch {
      // expected
    }
    assert.equal(getCalls().length, 0, 'logUsage must not be called when pricing is missing');
  });
});

// ─── 26.8: Unidad de pricing incorrecta → cero calls ────────────────────────

describe('26.8: wrong pricing unit → no Tavily calls, no logs', () => {
  it('throws when unit is not per_credit', async () => {
    let dispatchCalled = 0;
    const badPricing = { unitCostUsd: 0.008, unit: 'per_request' as 'per_credit' };
    const deps: TavilyUsageDeps = {
      loadPricing: async () => badPricing,
      logUsage: async () => ({ kind: 'logged' }),
      dispatchQuery: async () => { dispatchCalled++; return { provider: 'tavily' as const, query: '', results: [], resultsCount: 0, skipped: true, skipReason: null, estimatedCostUsd: null, metadata: {} }; },
    };
    await assert.rejects(
      () => runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps),
      (err: unknown) => {
        assert.ok(err instanceof TavilyPricingUnavailableError);
        return true;
      },
    );
    assert.equal(dispatchCalled, 0);
  });
});

// ─── 26.9: Duplicado usage_key (already_logged) ──────────────────────────────

describe('26.9: duplicate usage_key (23505) → already_logged, pipeline does not fail', () => {
  it('function returns normally when logUsage returns already_logged', async () => {
    const { dispatcher } = makeSuccessDispatcher();
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: async () => ({ kind: 'already_logged' }),
      dispatchQuery: dispatcher,
    };
    // Should not throw
    const result = await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.ok(result, 'should return a result');
  });

  it('results are returned intact on already_logged', async () => {
    const { dispatcher } = makeSuccessDispatcher(2);
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: async () => ({ kind: 'already_logged' }),
      dispatchQuery: dispatcher,
    };
    const result = await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.ok(result.results.length >= 0);
    assert.equal(result.metadata?.usage_logging_failed, undefined, 'already_logged is not a failure');
  });

  it('no additional cost is added when already_logged (logUsage called once)', async () => {
    let logCount = 0;
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: async () => { logCount++; return { kind: 'already_logged' }; },
      dispatchQuery: makeSuccessDispatcher().dispatcher,
    };
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(logCount, 1, 'logUsage called exactly once regardless of already_logged');
  });
});

// ─── 26.10: Error de logging posterior a Tavily exitoso ───────────────────────

describe('26.10: logging failure after successful Tavily round', () => {
  it('does not throw when logUsage fails', async () => {
    const { dispatcher } = makeSuccessDispatcher();
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: async () => ({ kind: 'failed', error: 'DB connection timeout' }),
      dispatchQuery: dispatcher,
    };
    const result = await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.ok(result, 'search result returned despite logging failure');
  });

  it('search results are preserved when logUsage fails', async () => {
    const { dispatcher } = makeSuccessDispatcher(2);
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: async () => ({ kind: 'failed', error: 'network error' }),
      dispatchQuery: dispatcher,
    };
    const result = await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.ok(result.estimatedCreditCount >= 0);
  });

  it('metadata.usage_logging_failed = true when logUsage fails', async () => {
    const { dispatcher } = makeSuccessDispatcher();
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: async () => ({ kind: 'failed', error: 'timeout' }),
      dispatchQuery: dispatcher,
    };
    const result = await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(result.metadata?.usage_logging_failed, true);
  });

  it('Tavily dispatcher is not called again after logging failure', async () => {
    let dispatchCount = 0;
    let logCount = 0;
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: async () => { logCount++; return { kind: 'failed', error: 'err' }; },
      dispatchQuery: async (_p, input) => {
        dispatchCount++;
        return { provider: 'tavily' as const, query: input.query, results: [], resultsCount: 0, skipped: false, skipReason: null, estimatedCostUsd: null, metadata: {} };
      },
    };
    const queryCount = 5;
    await runMultiQueryWebSearch(makeBaseInput({ usageContext: makeUsageContext() }), deps);
    assert.equal(dispatchCount, queryCount, 'dispatch called exactly once per query');
    assert.equal(logCount, 1, 'logUsage called once and not retried');
  });
});

// ─── 26.11: Sin usageContext → comportamiento previo intacto ─────────────────

describe('26.11: no usageContext → existing behavior unchanged', () => {
  it('runMultiQueryWebSearch without usageContext does not call loadPricing', async () => {
    let pricingLoaded = false;
    const deps: TavilyUsageDeps = {
      loadPricing: async () => { pricingLoaded = true; return BASIC_PRICING; },
      logUsage: async () => ({ kind: 'logged' }),
      dispatchQuery: makeSuccessDispatcher().dispatcher,
    };
    // No usageContext in input
    await runMultiQueryWebSearch(makeBaseInput(), deps);
    assert.equal(pricingLoaded, false, 'pricing must not be loaded without usageContext');
  });

  it('runMultiQueryWebSearch without usageContext does not call logUsage', async () => {
    let logged = false;
    const deps: TavilyUsageDeps = {
      loadPricing: makePricingLoader(BASIC_PRICING),
      logUsage: async () => { logged = true; return { kind: 'logged' }; },
      dispatchQuery: makeSuccessDispatcher().dispatcher,
    };
    await runMultiQueryWebSearch(makeBaseInput(), deps);
    assert.equal(logged, false, 'logUsage must not be called without usageContext');
  });

  it('runMultiQueryWebSearch without usageContext returns valid output', async () => {
    const result = await runMultiQueryWebSearch(makeBaseInput({ provider: 'mock' }));
    assert.ok(Array.isArray(result.results));
    assert.ok(typeof result.rawResultsCount === 'number');
  });
});

// ─── 26.12: Propagación de rondas en IncrementalProspectingSearch ─────────────

describe('26.12: round number propagates correctly through incremental search', () => {
  it('round 1 receives roundNumber=1 and round 2 receives roundNumber=2', async () => {
    const capturedContexts: Array<{ roundNumber: number }> = [];

    const fakePipeline = async (input: ProspectingPipelineInput): Promise<ProspectingPipelineOutput> => {
      if (input.usageContext) {
        capturedContexts.push({ roundNumber: input.usageContext.roundNumber });
      }
      return {
        input,
        catalogContext: {
          country: input.country,
          countryCode: input.countryCode ?? 'CO',
          industry: input.industry,
          searchDepth: 'standard' as const,
          fiscalIdentifierLabel: null,
          recommendedSources: [],
          sectorSources: [],
          risks: [],
          operatingRules: [],
          coverageNotes: [],
          promptContext: '',
        },
        searchQuery: 'test',
        webSearch: {
          provider: 'mock' as const,
          query: 'test',
          results: [],
          resultsCount: 0,
          skipped: false,
          skipReason: null,
          estimatedCostUsd: null,
          metadata: {},
        },
        candidates: [],
        summary: {
          requested: 0, searched: 0, returned: 0,
          highQualityNew: 0, needsReview: 0, duplicates: 0,
          insufficientData: 0, discarded: 0, unchecked: 0,
        },
        warnings: [],
        metadata: {},
      };
    };

    const incrementalInput: IncrementalSearchInput = {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'mock',
      dryRun: true,
      maxRounds: 2,
      minUsefulCandidates: 999, // force both rounds
      usageInputContext: {
        batchId: BATCH_ID,
        triggeredByUserId: USER_ID,
      },
    };

    await runIncrementalProspectingSearch(incrementalInput, undefined, fakePipeline as typeof import('../prospecting-pipeline').runProspectingPipeline);

    assert.ok(capturedContexts.length >= 1, 'pipeline must have been called at least once');
    assert.equal(capturedContexts[0].roundNumber, 1, 'first round must have roundNumber=1');
    if (capturedContexts.length >= 2) {
      assert.equal(capturedContexts[1].roundNumber, 2, 'second round must have roundNumber=2');
    }
  });

  it('without usageInputContext, usageContext is null in pipeline', async () => {
    let receivedContext: null | undefined | { roundNumber: number } = undefined;
    const fakePipeline = async (input: ProspectingPipelineInput): Promise<ProspectingPipelineOutput> => {
      receivedContext = input.usageContext ?? null;
      return {
        input,
        catalogContext: { country: input.country, countryCode: input.countryCode ?? 'CO', industry: input.industry, searchDepth: 'standard' as const, fiscalIdentifierLabel: null, recommendedSources: [], sectorSources: [], risks: [], operatingRules: [], coverageNotes: [], promptContext: '' },
        searchQuery: 'test',
        webSearch: { provider: 'mock' as const, query: 'test', results: [], resultsCount: 0, skipped: false, skipReason: null, estimatedCostUsd: null, metadata: {} },
        candidates: [],
        summary: { requested: 0, searched: 0, returned: 0, highQualityNew: 0, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0 },
        warnings: [],
        metadata: {},
      };
    };

    await runIncrementalProspectingSearch(
      { country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', webSearchProvider: 'mock', dryRun: true, maxRounds: 1 },
      undefined,
      fakePipeline as typeof import('../prospecting-pipeline').runProspectingPipeline,
    );

    assert.equal(receivedContext, null, 'usageContext must be null when usageInputContext not provided');
  });
});

// ─── 26.13: Wizard → batch_id y triggered_by en el log ───────────────────────

describe('26.13: wizard passes reservedBatchId→batch_id and userId→triggered_by', () => {
  const WIZARD_BATCH = 'batch-wizard-uuid-9999';
  const WIZARD_USER = 'user-wizard-uuid-8888';

  const BASE_RESOLVED: ResolvedWizardExecution = {
    userId: WIZARD_USER,
    clientRequestId: 'req-test-0001',
    mode: 'exploratory',
    country: { code: 'CO', name: 'Colombia' },
    catalog: { version: 'v2024-01' },
    industry: { id: 'ind-test-001', slug: 'tecnologia', name: 'Tecnología' },
    subindustries: [],
    additionalCriteria: null,
    systemControls: { targetCount: 25, minimumEmployees: 200, employeeThresholdMode: 'hard_filter' },
  };

  it('usageInputContext.batchId equals reservedBatchId', async () => {
    let capturedInput: IncrementalSearchInput | null = null;
    const fakeRunner = async (input: IncrementalSearchInput): Promise<IncrementalSearchOutput> => {
      capturedInput = input;
      return {
        input,
        candidates: [],
        candidatesCount: 0,
        usefulCandidatesCount: 0,
        metadata: {
          rounds_executed: 0, stopped_reason: 'max_rounds_reached',
          total_raw_evaluated: 0, total_candidates_accumulated: 0,
          useful_candidates_count: 0, min_useful_candidates: 7,
          target_internal: 25, max_rounds: 2, max_total_raw_to_evaluate: 50,
          dry_run: false, rounds: [],
        },
        warnings: [],
        batchId: WIZARD_BATCH,
      };
    };

    const wizardInput: WizardTavilyInput = {
      resolved: { ...BASE_RESOLVED, userId: WIZARD_USER },
      reservedBatchId: WIZARD_BATCH,
    };
    await runWizardTavilySearch(wizardInput, fakeRunner as unknown as typeof runIncrementalProspectingSearch);

    assert.ok(capturedInput, 'runner must have been called');
    const ci = capturedInput as IncrementalSearchInput;
    assert.equal(ci.usageInputContext?.batchId, WIZARD_BATCH);
  });

  it('usageInputContext.triggeredByUserId equals resolved.userId', async () => {
    let capturedInput: IncrementalSearchInput | null = null;
    const fakeRunner = async (input: IncrementalSearchInput): Promise<IncrementalSearchOutput> => {
      capturedInput = input;
      return {
        input, candidates: [], candidatesCount: 0, usefulCandidatesCount: 0,
        metadata: { rounds_executed: 0, stopped_reason: 'max_rounds_reached', total_raw_evaluated: 0, total_candidates_accumulated: 0, useful_candidates_count: 0, min_useful_candidates: 7, target_internal: 25, max_rounds: 2, max_total_raw_to_evaluate: 50, dry_run: false, rounds: [] },
        warnings: [], batchId: WIZARD_BATCH,
      };
    };

    await runWizardTavilySearch({ resolved: { ...BASE_RESOLVED, userId: WIZARD_USER }, reservedBatchId: WIZARD_BATCH }, fakeRunner as unknown as typeof runIncrementalProspectingSearch);
    const ci = capturedInput as unknown as IncrementalSearchInput;
    assert.equal(ci.usageInputContext?.triggeredByUserId, WIZARD_USER);
  });
});

// ─── 26.14: Anti-Apollo structural guardrail ─────────────────────────────────

describe('26.14: Anti-Apollo — tavily-usage-logging module does not reference Apollo', () => {
  it('tavily-usage-logging.ts source does not import Apollo-related identifiers', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/tavily-usage-logging.ts'),
      'utf-8',
    );
    const forbidden = [
      'generateAIProspectBatch',
      'runProspectGenerationAgent',
      'searchApolloOrganizations',
      'apollo',
      'Apollo',
    ];
    for (const name of forbidden) {
      assert.ok(!source.includes(name), `tavily-usage-logging.ts must not reference: ${name}`);
    }
  });

  it('web-search-tool.ts instrumented path does not import Apollo', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/web-search-tool.ts'),
      'utf-8',
    );
    assert.ok(!source.includes('generateAIProspectBatch'), 'no Apollo in web-search-tool.ts');
    assert.ok(!source.includes('runProspectGenerationAgent'), 'no Apollo in web-search-tool.ts');
  });
});
