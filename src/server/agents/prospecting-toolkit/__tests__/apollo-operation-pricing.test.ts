/**
 * Tests — apollo-operation-pricing.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * The reservation used to cover Organization Search only, so a run that also
 * enriched spent credits nobody had reserved. This file pins the single pricing
 * source: both billable operations, an explicit breakdown, and no hardcoded 3.
 *
 * A. Operation catalogue
 * B. Breakdown arithmetic
 * C. The enrichment flag decides whether enrichment is reserved
 * D. Degenerate caps
 * E. Pricing identity (source + version)
 * F. Metadata projection
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_BILLABLE_OPERATION_KEYS,
  APOLLO_CREDITS_PER_UNIT,
  APOLLO_PRICING_SOURCE,
  APOLLO_PRICING_VERSION,
  creditsForApolloOperationUnit,
  estimateApolloRunCreditBreakdown,
  isApolloBillableOperation,
  toApolloRunCreditBreakdownMetadata,
} from '../apollo-operation-pricing';

// ── A. Operation catalogue ────────────────────────────────────────────────────

describe('A — billable operations', () => {
  it('A1: exactly the two operations a discovery run can be charged for', () => {
    assert.deepEqual([...APOLLO_BILLABLE_OPERATION_KEYS].sort(), [
      'organization_enrichment',
      'organizations_search',
    ]);
  });

  it('A2: the keys are the ones written to provider_usage_logs.operation_key', () => {
    // These strings are a persistence contract: renaming one silently orphans
    // every historical row.
    assert.ok(APOLLO_BILLABLE_OPERATION_KEYS.includes('organizations_search'));
    assert.ok(APOLLO_BILLABLE_OPERATION_KEYS.includes('organization_enrichment'));
  });

  it('A3: isApolloBillableOperation recognizes only those keys', () => {
    assert.equal(isApolloBillableOperation('organizations_search'), true);
    assert.equal(isApolloBillableOperation('organization_enrichment'), true);
    assert.equal(isApolloBillableOperation('people_search'), false);
    assert.equal(isApolloBillableOperation('multi_query_web_search'), false);
    assert.equal(isApolloBillableOperation(''), false);
  });

  it('A4: every billable operation has a unit price', () => {
    for (const operation of APOLLO_BILLABLE_OPERATION_KEYS) {
      assert.equal(creditsForApolloOperationUnit(operation), APOLLO_CREDITS_PER_UNIT[operation]);
      assert.ok(creditsForApolloOperationUnit(operation) > 0, operation);
    }
  });
});

// ── B. Breakdown arithmetic ───────────────────────────────────────────────────

describe('B — breakdown arithmetic', () => {
  it('B1: the QA configuration reserves 3 + 1 = 4, not 3', () => {
    // 1 query x 3 results = 3 search credits, plus 1 enrichment credit. This is
    // exactly the 4 the QA batch was charged.
    const breakdown = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 1,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 1,
      enrichmentEnabled: true,
    });
    assert.equal(breakdown.searchReservedCredits, 3);
    assert.equal(breakdown.enrichmentReservedCredits, 1);
    assert.equal(breakdown.totalReservedCredits, 4);
  });

  it('B2: search credits are per result returned, not per query issued', () => {
    const breakdown = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 2,
      maxResultsPerQuery: 10,
      maxEnrichmentsPerRun: 0,
      enrichmentEnabled: true,
    });
    assert.equal(breakdown.searchReservedCredits, 20);
  });

  it('B3: the total is always the sum of its parts', () => {
    for (const [queries, results, enrichments] of [
      [1, 3, 1],
      [2, 5, 4],
      [3, 10, 0],
    ]) {
      const breakdown = estimateApolloRunCreditBreakdown({
        maxQueriesPerRun: queries as number,
        maxResultsPerQuery: results as number,
        maxEnrichmentsPerRun: enrichments as number,
        enrichmentEnabled: true,
      });
      assert.equal(
        breakdown.totalReservedCredits,
        breakdown.searchReservedCredits + breakdown.enrichmentReservedCredits,
      );
    }
  });

  it('B4: the function is pure — same input, same output', () => {
    const input = {
      maxQueriesPerRun: 1,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 1,
      enrichmentEnabled: true,
    };
    assert.deepEqual(
      estimateApolloRunCreditBreakdown(input),
      estimateApolloRunCreditBreakdown(input),
    );
  });

  it('B5: the input object is not mutated', () => {
    const input = {
      maxQueriesPerRun: 1.9,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 1,
      enrichmentEnabled: true,
    };
    const snapshot = { ...input };
    estimateApolloRunCreditBreakdown(input);
    assert.deepEqual(input, snapshot);
  });
});

// ── C. Enrichment flag ────────────────────────────────────────────────────────

describe('C — a disabled cascade reserves no enrichment credit', () => {
  it('C1: flag OFF keeps the legacy 3-credit reservation', () => {
    const breakdown = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 1,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 5,
      enrichmentEnabled: false,
    });
    assert.equal(breakdown.enrichmentReservedCredits, 0);
    assert.equal(breakdown.totalReservedCredits, 3);
  });

  it('C2: flag OFF still records that the operation was considered', () => {
    const breakdown = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 1,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 5,
      enrichmentEnabled: false,
    });
    assert.equal(breakdown.inputs.enrichmentEnabled, false);
    // The cap is normalized to what was actually reserved, so the record
    // reproduces the reservation rather than the unused configuration.
    assert.equal(breakdown.inputs.maxEnrichmentsPerRun, 0);
  });

  it('C3: flag ON with a zero cap also reserves nothing', () => {
    const breakdown = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 1,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 0,
      enrichmentEnabled: true,
    });
    assert.equal(breakdown.enrichmentReservedCredits, 0);
    assert.equal(breakdown.totalReservedCredits, 3);
  });
});

// ── D. Degenerate caps ────────────────────────────────────────────────────────

describe('D — degenerate caps never produce a negative or fractional reservation', () => {
  it('D1: negative caps floor at zero', () => {
    const breakdown = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: -5,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: -1,
      enrichmentEnabled: true,
    });
    assert.equal(breakdown.totalReservedCredits, 0);
    assert.equal(breakdown.inputs.maxQueriesPerRun, 0);
  });

  it('D2: fractional caps truncate down — credits are whole units', () => {
    const breakdown = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 1.9,
      maxResultsPerQuery: 3.7,
      maxEnrichmentsPerRun: 2.5,
      enrichmentEnabled: true,
    });
    assert.equal(breakdown.searchReservedCredits, 3);
    assert.equal(breakdown.enrichmentReservedCredits, 2);
    assert.equal(breakdown.totalReservedCredits, 5);
  });

  it('D3: NaN and Infinity resolve to zero rather than poisoning the total', () => {
    const breakdown = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: Number.NaN,
      maxResultsPerQuery: Number.POSITIVE_INFINITY,
      maxEnrichmentsPerRun: Number.NaN,
      enrichmentEnabled: true,
    });
    assert.equal(breakdown.totalReservedCredits, 0);
    assert.ok(Number.isFinite(breakdown.totalReservedCredits));
  });
});

// ── E. Pricing identity ───────────────────────────────────────────────────────

describe('E — a reservation records which pricing produced it', () => {
  it('E1: every breakdown carries source and version', () => {
    const breakdown = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 1,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 1,
      enrichmentEnabled: true,
    });
    assert.equal(breakdown.pricingSource, APOLLO_PRICING_SOURCE);
    assert.equal(breakdown.pricingVersion, APOLLO_PRICING_VERSION);
  });

  it('E2: the source is a pricing table, not a live provider config read', () => {
    assert.equal(APOLLO_PRICING_SOURCE, 'apollo_operation_pricing_table');
  });

  it('E3: the version is a non-empty identifier', () => {
    assert.ok(APOLLO_PRICING_VERSION.length > 0);
    assert.match(APOLLO_PRICING_VERSION, /^a1-apollo-operation-pricing-v\d+$/);
  });
});

// ── F. Metadata projection ────────────────────────────────────────────────────

describe('F — metadata projection', () => {
  const BREAKDOWN = estimateApolloRunCreditBreakdown({
    maxQueriesPerRun: 1,
    maxResultsPerQuery: 3,
    maxEnrichmentsPerRun: 1,
    enrichmentEnabled: true,
  });

  it('F1: projects the whole breakdown to snake_case', () => {
    assert.deepEqual(toApolloRunCreditBreakdownMetadata(BREAKDOWN), {
      search_reserved_credits: 3,
      enrichment_reserved_credits: 1,
      total_reserved_credits: 4,
      pricing_source: APOLLO_PRICING_SOURCE,
      pricing_version: APOLLO_PRICING_VERSION,
      max_queries_per_run: 1,
      max_results_per_query: 3,
      max_enrichments_per_run: 1,
      enrichment_enabled: true,
    });
  });

  it('F2: carries caps and identifiers only — no key, token or query', () => {
    const keys = Object.keys(toApolloRunCreditBreakdownMetadata(BREAKDOWN));
    for (const key of keys) {
      assert.ok(
        !/key|token|secret|query_text|api/.test(key.replace('max_queries_per_run', '')),
        `unexpected key: ${key}`,
      );
    }
  });

  it('F3: the metadata is JSON-serializable with finite numbers only', () => {
    const parsed = JSON.parse(JSON.stringify(toApolloRunCreditBreakdownMetadata(BREAKDOWN)));
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), key);
    }
  });
});
