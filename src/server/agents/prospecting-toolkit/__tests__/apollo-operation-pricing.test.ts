/**
 * Tests — apollo-operation-pricing.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * The QA batch of 2026-07-30 was charged 4 credits (3 organizations_search +
 * 1 organization_enrichment) against a 3-credit reservation, because the
 * reservation only knew about one of the two billable operations. These tests
 * pin the breakdown that closes that gap.
 *
 * Pure module: no network, no provider call, no process.env.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_BILLABLE_OPERATION_KEYS,
  APOLLO_PRICING_SOURCE,
  APOLLO_PRICING_VERSION,
  creditsForApolloOperation,
  creditsForApolloOperationUnit,
  estimateApolloRunCreditBreakdown,
  isApolloBillableOperation,
  toApolloRunCreditBreakdownMetadata,
} from '../apollo-operation-pricing';

const DEFAULT_CAPS = {
  maxQueriesPerRun: 1,
  maxResultsPerQuery: 3,
  maxEnrichmentsPerRun: 1,
};

describe('A. Both billable operations are part of the reservation', () => {
  it('reserves search AND enrichment when the cascade is enabled', () => {
    const b = estimateApolloRunCreditBreakdown({ ...DEFAULT_CAPS, enrichmentEnabled: true });

    assert.equal(b.searchReservedCredits, 3, '1 query x 3 results');
    assert.equal(b.enrichmentReservedCredits, 1, '1 enrichment');
    assert.equal(b.totalReservedCredits, 4);
  });

  it('reproduces the exact QA shortfall: the old estimate was 3, the real spend 4', () => {
    const withEnrichment = estimateApolloRunCreditBreakdown({
      ...DEFAULT_CAPS,
      enrichmentEnabled: true,
    });
    const searchOnly = withEnrichment.searchReservedCredits;

    assert.equal(searchOnly, 3, 'what the old formula reserved');
    assert.equal(withEnrichment.totalReservedCredits, 4, 'what Apollo actually charged');
    assert.ok(withEnrichment.totalReservedCredits > searchOnly);
  });

  it('reserves zero enrichment credits when the cascade is disabled', () => {
    const b = estimateApolloRunCreditBreakdown({ ...DEFAULT_CAPS, enrichmentEnabled: false });

    assert.equal(b.enrichmentReservedCredits, 0, 'a disabled cascade cannot call');
    assert.equal(b.totalReservedCredits, 3);
    // The operation is still recorded as considered.
    assert.equal(b.inputs.enrichmentEnabled, false);
  });

  it('exposes both canonical operation keys', () => {
    assert.deepEqual([...APOLLO_BILLABLE_OPERATION_KEYS], [
      'organizations_search',
      'organization_enrichment',
    ]);
  });
});

describe('B. Provenance travels with the breakdown', () => {
  it('carries pricingSource and pricingVersion', () => {
    const b = estimateApolloRunCreditBreakdown({ ...DEFAULT_CAPS, enrichmentEnabled: true });
    assert.equal(b.pricingSource, APOLLO_PRICING_SOURCE);
    assert.equal(b.pricingVersion, APOLLO_PRICING_VERSION);
    assert.ok(b.pricingVersion.length > 0);
  });

  it('echoes the caps so a reservation is reproducible from its record', () => {
    const b = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 3,
      maxResultsPerQuery: 5,
      maxEnrichmentsPerRun: 3,
      enrichmentEnabled: true,
    });
    assert.deepEqual(b.inputs, {
      maxQueriesPerRun: 3,
      maxResultsPerQuery: 5,
      maxEnrichmentsPerRun: 3,
      enrichmentEnabled: true,
    });
    assert.equal(b.totalReservedCredits, 18, '3x5 search + 3 enrichment');
  });

  it('metadata projection carries no secrets — only caps and identifiers', () => {
    const meta = toApolloRunCreditBreakdownMetadata(
      estimateApolloRunCreditBreakdown({ ...DEFAULT_CAPS, enrichmentEnabled: true }),
    );
    const serialized = JSON.stringify(meta).toLowerCase();
    for (const forbidden of ['api_key', 'apikey', 'authorization', 'bearer', 'token', 'secret']) {
      assert.ok(!serialized.includes(forbidden), `must not contain ${forbidden}`);
    }
    assert.equal(meta.total_reserved_credits, 4);
    assert.equal(meta.search_reserved_credits, 3);
    assert.equal(meta.enrichment_reserved_credits, 1);
  });
});

describe('C. Degenerate caps never produce a negative or fractional reservation', () => {
  it('clamps zero, negative and non-finite caps to zero', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const b = estimateApolloRunCreditBreakdown({
        maxQueriesPerRun: bad,
        maxResultsPerQuery: bad,
        maxEnrichmentsPerRun: bad,
        enrichmentEnabled: true,
      });
      assert.equal(b.totalReservedCredits, 0, `cap ${bad} must not reserve credits`);
      assert.ok(b.totalReservedCredits >= 0);
    }
  });

  it('floors fractional caps rather than reserving a fractional credit', () => {
    const b = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 1.9,
      maxResultsPerQuery: 3.9,
      maxEnrichmentsPerRun: 1.9,
      enrichmentEnabled: true,
    });
    assert.equal(b.searchReservedCredits, 3);
    assert.equal(b.enrichmentReservedCredits, 1);
    assert.ok(Number.isInteger(b.totalReservedCredits));
  });
});

describe('D. Per-operation unit pricing is the shared source', () => {
  it('converts result counts to credits for the search operation', () => {
    assert.equal(creditsForApolloOperation('organizations_search', 3), 3);
    assert.equal(creditsForApolloOperation('organizations_search', 0), 0);
    assert.equal(creditsForApolloOperation('organization_enrichment', 1), 1);
  });

  it('never returns a negative credit count', () => {
    assert.equal(creditsForApolloOperation('organizations_search', -4), 0);
    assert.equal(creditsForApolloOperation('organizations_search', Number.NaN), 0);
  });

  it('unit price is exposed for both operations', () => {
    assert.equal(creditsForApolloOperationUnit('organizations_search'), 1);
    assert.equal(creditsForApolloOperationUnit('organization_enrichment'), 1);
  });

  it('recognises exactly the billable operations', () => {
    assert.equal(isApolloBillableOperation('organizations_search'), true);
    assert.equal(isApolloBillableOperation('organization_enrichment'), true);
    assert.equal(isApolloBillableOperation('multi_query_web_search'), false);
    assert.equal(isApolloBillableOperation('people_search'), false);
  });
});
