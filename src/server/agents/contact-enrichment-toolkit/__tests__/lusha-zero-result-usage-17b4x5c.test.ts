/**
 * Tests — Lusha Zero-Result Prospecting Usage Trace · Agente 2A · 17B.4X.5C
 *
 * Closes G7 (ZERO_RESULT_USAGE_TRACE_MISSING): a real company_first_discovery
 * prospecting call that returns 0 raw results must still leave exactly one
 * provider_usage_logs audit row, priced from the SAME cost component already
 * computed for the run's cost truth (no second pricing lookup, no duplicate
 * logging, no fabricated 0 for unknown-cost scenarios).
 *
 * All pure / dependency-injected. No live Supabase. No provider calls. No DB writes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeLushaCreditCostComponent,
  buildLushaRunCostSummaryFields,
  buildLushaZeroResultProspectingUsageLogInput,
} from '../lusha-enrichment-runner';

const LUSHA_UNIT_COST = 0.08823529;

function stubPricing(unitCostUsd: number) {
  return async () => ({
    pricingConfigId: 'pricing-row-1',
    providerKey: 'lusha',
    operationKey: 'credit',
    unit: 'per_credit' as const,
    unitCostUsd,
  });
}

const stubMissingPricing = async () => null;

// ─── TEST 1 — zero results, credits=0, valid pricing → estimated zero ──────

describe('buildLushaZeroResultProspectingUsageLogInput — TEST 1: estimated zero (ACRIP pattern)', () => {
  it('valid known-zero: results_returned=0, credits_used=0, estimated_cost_usd=0, real_cost_usd=null', async () => {
    const costComponent = await computeLushaCreditCostComponent(
      'lusha_contact_prospecting',
      0,
      'prospecting_and_enrich_treated_as_fungible',
      stubPricing(LUSHA_UNIT_COST),
    );

    const input = buildLushaZeroResultProspectingUsageLogInput({
      agentRunId: 'agent-run-1',
      agentRunStepId: 'step-1',
      triggeredBy: 'user-1',
      prospectingCreditsCharged: 0,
      searchStatus: 'no_results',
      requestId: 'req-acrip-001',
      durationMs: 842,
      costComponent,
    });

    assert.equal(input.provider_key, 'lusha');
    assert.equal(input.operation_key, 'lusha_contact_prospecting');
    assert.equal(input.credits_used, 0, 'provider-reported 0 credits must persist as numeric 0, not null/undefined');
    assert.equal(input.results_returned, 0);
    assert.equal(input.estimated_cost_usd, 0);
    assert.equal(input.real_cost_usd, null);
    assert.equal(input.status, 'success');
    assert.equal(input.duration_ms, 842);
    assert.equal(input.agent_run_id, 'agent-run-1');
    assert.equal(input.agent_run_step_id, 'step-1');
  });
});

// ─── TEST 2 & 3 — metadata.cost trace ──────────────────────────────────────

describe('buildLushaZeroResultProspectingUsageLogInput — TEST 2/3: metadata.cost trace', () => {
  it('TEST 2: truth_source=estimated + full pricing snapshot + assumption literal', async () => {
    const costComponent = await computeLushaCreditCostComponent(
      'lusha_contact_prospecting',
      0,
      'prospecting_and_enrich_treated_as_fungible',
      stubPricing(LUSHA_UNIT_COST),
    );

    const input = buildLushaZeroResultProspectingUsageLogInput({
      prospectingCreditsCharged: 0,
      searchStatus: 'no_results',
      requestId: null,
      durationMs: 100,
      costComponent,
    });

    const meta = input.metadata as Record<string, unknown>;
    const cost = meta['cost'] as Record<string, unknown>;

    assert.equal(cost['truth_source'], 'estimated');
    assert.equal(cost['pricing_provider_key'], 'lusha');
    assert.equal(cost['pricing_operation_key'], 'credit');
    assert.equal(cost['pricing_unit'], 'per_credit');
    assert.equal(cost['unit_cost_usd_snapshot'], LUSHA_UNIT_COST);
    assert.equal(cost['credit_unit_assumption'], 'prospecting_and_enrich_treated_as_fungible');
  });

  it('TEST 3: pricing_config_id preserved in metadata.cost', async () => {
    const costComponent = await computeLushaCreditCostComponent(
      'lusha_contact_prospecting',
      0,
      'prospecting_and_enrich_treated_as_fungible',
      stubPricing(LUSHA_UNIT_COST),
    );

    const input = buildLushaZeroResultProspectingUsageLogInput({
      prospectingCreditsCharged: 0,
      searchStatus: 'no_results',
      requestId: null,
      durationMs: 100,
      costComponent,
    });

    const meta = input.metadata as Record<string, unknown>;
    const cost = meta['cost'] as Record<string, unknown>;
    assert.equal(cost['pricing_config_id'], 'pricing-row-1');
  });
});

// ─── TEST 4 — exactly ONE usage row (no duplicate logging) ─────────────────

describe('lusha-enrichment-runner source — TEST 4: single usage-log call site in Path B', () => {
  it('the zero-result branch ("Path B — no results") contains exactly one logProviderUsage call', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.join(import.meta.dirname, '..', 'lusha-enrichment-runner.ts'),
      'utf-8',
    );

    const pathBStart = src.indexOf('// Path B — no results');
    const pathCStart = src.indexOf('// Path C — results: filter');
    assert.ok(pathBStart > -1, 'Path B marker must exist');
    assert.ok(pathCStart > pathBStart, 'Path C marker must exist after Path B');

    const pathBBlock = src.slice(pathBStart, pathCStart);
    const matches = pathBBlock.match(/await logProviderUsage\(/g) ?? [];
    assert.equal(matches.length, 1, 'Path B must call logProviderUsage exactly once (no duplicate rows)');
  });
});

// ─── TEST 5 — zero-result run result/lifecycle unchanged ───────────────────

describe('lusha-enrichment-runner source — TEST 5: Path B return contract unchanged', () => {
  it('Path B still returns ok:true, status:no_reviewable_candidate, candidatesCreated:0, duplicatesSkipped:0', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.join(import.meta.dirname, '..', 'lusha-enrichment-runner.ts'),
      'utf-8',
    );

    const pathBStart = src.indexOf('// Path B — no results');
    const pathCStart = src.indexOf('// Path C — results: filter');
    const pathBBlock = src.slice(pathBStart, pathCStart);

    assert.match(pathBBlock, /status:\s*'ready_for_review'/, 'run status must remain ready_for_review');
    assert.match(pathBBlock, /ok:\s*true,/);
    assert.match(pathBBlock, /status:\s*'no_reviewable_candidate'/);
    assert.match(pathBBlock, /candidatesCreated:\s*0,/);
    assert.match(pathBBlock, /duplicatesSkipped:\s*0,/);
  });
});

// ─── TEST 6 — run summary still reconciles ─────────────────────────────────

describe('buildLushaRunCostSummaryFields — TEST 6: zero-result run summary reconciliation', () => {
  it('credits=0 + valid pricing → estimated_cost_usd=0, cost_truth_source=estimated, unknown_count=0', async () => {
    const costComponent = await computeLushaCreditCostComponent(
      'lusha_contact_prospecting',
      0,
      'prospecting_and_enrich_treated_as_fungible',
      stubPricing(LUSHA_UNIT_COST),
    );
    const fields = buildLushaRunCostSummaryFields([costComponent]);

    assert.equal(fields.cost_truth_source, 'estimated');
    assert.equal(fields.known_cost_subtotal_usd, 0);
    assert.equal(fields.unknown_cost_component_count, 0);
  });
});

// ─── TEST 7 — usage row and run truth share the SAME cost component ────────

describe('shared cost component — TEST 7: usage metadata.cost and run cost truth derive from one pricing load', () => {
  it('pricing loaded exactly once produces consistent values across both consumers (behavioral, not source-text)', async () => {
    let pricingCallCount = 0;
    const countingPricing = async () => {
      pricingCallCount += 1;
      // Distinct value per call — if either consumer triggered a second
      // load, the two derived values below would diverge from each other.
      return {
        pricingConfigId: 'pricing-row-1',
        providerKey: 'lusha',
        operationKey: 'credit',
        unit: 'per_credit' as const,
        unitCostUsd: 0.05 * pricingCallCount,
      };
    };

    // Mirrors the runner: ONE computeLushaCreditCostComponent call produces
    // the component reused by both the usage row and the run summary.
    const costComponent = await computeLushaCreditCostComponent(
      'lusha_contact_prospecting',
      2,
      'prospecting_and_enrich_treated_as_fungible',
      countingPricing,
    );

    assert.equal(pricingCallCount, 1, 'pricing must be loaded exactly once for this run');

    const usageInput = buildLushaZeroResultProspectingUsageLogInput({
      prospectingCreditsCharged: 2,
      searchStatus: 'no_results',
      requestId: null,
      durationMs: 50,
      costComponent,
    });
    const runFields = buildLushaRunCostSummaryFields([costComponent]);

    // Both derive from the same single-load component: 2 credits * 0.05 = 0.1.
    assert.equal(usageInput.estimated_cost_usd, 0.1);
    assert.equal(runFields.known_cost_subtotal_usd, 0.1);
    assert.equal(usageInput.estimated_cost_usd, runFields.known_cost_subtotal_usd);

    const meta = usageInput.metadata as Record<string, unknown>;
    const cost = meta['cost'] as Record<string, unknown>;
    assert.equal(cost['unit_cost_usd_snapshot'], 0.05, 'usage row must snapshot the same unit cost used for the run');

    // No second pricing load occurred while building either downstream artifact.
    assert.equal(pricingCallCount, 1);
  });
});

// ─── TEST 8 & 9 — zero results does NOT imply zero cost (unknown scenarios) ─

describe('buildLushaZeroResultProspectingUsageLogInput — TEST 8/9: unknown cost on zero results', () => {
  it('TEST 8: zero results + credits unavailable → unknown, not a fabricated zero', async () => {
    const costComponent = await computeLushaCreditCostComponent(
      'lusha_contact_prospecting',
      null,
      'prospecting_and_enrich_treated_as_fungible',
      stubMissingPricing,
    );

    const input = buildLushaZeroResultProspectingUsageLogInput({
      prospectingCreditsCharged: null,
      searchStatus: 'no_results',
      requestId: null,
      durationMs: 10,
      costComponent,
    });

    assert.equal(input.credits_used, undefined, 'unavailable credits must not be coerced to 0');
    assert.equal(input.estimated_cost_usd, null);
    const meta = input.metadata as Record<string, unknown>;
    const cost = meta['cost'] as Record<string, unknown>;
    assert.equal(cost['truth_source'], 'unknown');
    assert.equal(cost['unknown_reason'], 'credits_not_available');

    const runFields = buildLushaRunCostSummaryFields([costComponent]);
    assert.equal(runFields.cost_truth_source, 'unknown');
  });

  it('TEST 9: zero results + credits known but pricing unavailable → unknown, not zero', async () => {
    const costComponent = await computeLushaCreditCostComponent(
      'lusha_contact_prospecting',
      0,
      'prospecting_and_enrich_treated_as_fungible',
      stubMissingPricing,
    );

    const input = buildLushaZeroResultProspectingUsageLogInput({
      prospectingCreditsCharged: 0,
      searchStatus: 'no_results',
      requestId: null,
      durationMs: 10,
      costComponent,
    });

    assert.equal(input.credits_used, 0, 'credits are known (0) even though pricing is unavailable');
    assert.equal(input.estimated_cost_usd, null, 'pricing unavailable must never default to a fabricated 0');
    const meta = input.metadata as Record<string, unknown>;
    const cost = meta['cost'] as Record<string, unknown>;
    assert.equal(cost['truth_source'], 'unknown');
    assert.equal(cost['unknown_reason'], 'pricing_not_available');

    const runFields = buildLushaRunCostSummaryFields([costComponent]);
    assert.equal(runFields.cost_truth_source, 'unknown');
  });
});

// ─── Sibling branch regression — error/success logging untouched ───────────

describe('lusha-enrichment-runner source — sibling branch regression', () => {
  it('Path A (provider error) still calls logProviderUsage exactly once with status error', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.join(import.meta.dirname, '..', 'lusha-enrichment-runner.ts'),
      'utf-8',
    );

    const pathAStart = src.indexOf('// Path A — provider error');
    const pathBStart = src.indexOf('// Path B — no results');
    assert.ok(pathAStart > -1 && pathBStart > pathAStart);

    const pathABlock = src.slice(pathAStart, pathBStart);
    const matches = pathABlock.match(/await logProviderUsage\(/g) ?? [];
    assert.equal(matches.length, 1, 'Path A logging must remain unchanged (exactly one call)');
    assert.match(pathABlock, /status:\s*'error',/);
  });

  it('Path C (success/candidates) still calls logProviderUsage exactly once', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.join(import.meta.dirname, '..', 'lusha-enrichment-runner.ts'),
      'utf-8',
    );

    const pathCStart = src.indexOf('// Path C — results: filter');
    const nextSection = src.indexOf("if (discoveryMode === 'invalid_search_context')");
    assert.ok(pathCStart > -1 && nextSection > pathCStart);

    const pathCBlock = src.slice(pathCStart, nextSection);
    const matches = pathCBlock.match(/await logProviderUsage\(/g) ?? [];
    assert.equal(matches.length, 1, 'Path C logging must remain unchanged (exactly one call)');
  });
});
