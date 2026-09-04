// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — pure mapping tests.
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapApolloFinalDispositionToCode,
  computeDiscardDispositionSourceKey,
  toCandidateSourcePrimary,
} from '../mapping';

describe('mapApolloFinalDispositionToCode — taxonomy coverage (Test B: each reason bucket)', () => {
  const cases: Array<[string, string | null]> = [
    ['country_rejected_final', 'country_rejected'],
    ['sector_subindustry_rejected_final', 'sector_rejected'],
    ['ownership_rejected_final', 'ownership_domain_rejected'],
    ['hubspot_duplicate_final', 'hubspot_duplicate'],
    ['sellup_duplicate_final', 'sellup_duplicate'],
    ['cooldown_final', 'cooldown_active'],
    ['enrichment_budget_exhausted_final', 'enrichment_budget_exhausted'],
    ['not_selected_for_enrichment_final', 'not_selected_for_enrichment'],
    ['target_cap_final', 'target_cap_reached'],
    ['insufficient_evidence_not_enriched_final', 'other'],
    ['unclassified_final', 'other'],
    ['provisionally_persisted_pending_writer_final', null],
    ['persisted_review_only_final', null],
    ['something_the_pipeline_never_named', null],
  ];

  for (const [input, expected] of cases) {
    it(`maps ${input} -> ${expected}`, () => {
      assert.equal(mapApolloFinalDispositionToCode(input), expected);
    });
  }
});

describe('computeDiscardDispositionSourceKey — idempotency key preference order (Test C)', () => {
  it('prefers domain over provider id and name', () => {
    const key = computeDiscardDispositionSourceKey({
      domain: 'Example.com',
      providerIdentifier: 'apollo-org-1',
      name: 'Example Inc',
    });
    assert.equal(key, 'domain:example.com');
  });

  it('falls back to provider id when domain is absent', () => {
    const key = computeDiscardDispositionSourceKey({
      domain: null,
      providerIdentifier: 'apollo-org-1',
      name: 'Example Inc',
    });
    assert.equal(key, 'provider:apollo-org-1');
  });

  it('falls back to normalized name when domain and provider id are absent', () => {
    const key = computeDiscardDispositionSourceKey({
      domain: null,
      providerIdentifier: null,
      name: 'Café & Co.  ',
    });
    assert.equal(key, 'name:cafe-co');
  });

  it('produces the SAME key for the same company seen twice (idempotency)', () => {
    const a = computeDiscardDispositionSourceKey({
      domain: 'acme.com',
      providerIdentifier: null,
      name: 'Acme',
    });
    const b = computeDiscardDispositionSourceKey({
      domain: 'ACME.com',
      providerIdentifier: null,
      name: 'Acme',
    });
    assert.equal(a, b);
  });

  it('produces DIFFERENT keys for different domains', () => {
    const a = computeDiscardDispositionSourceKey({ domain: 'acme.com', name: 'Acme' });
    const b = computeDiscardDispositionSourceKey({ domain: 'acme.co', name: 'Acme' });
    assert.notEqual(a, b);
  });
});

describe('toCandidateSourcePrimary — narrows to the prospect_candidates vocabulary', () => {
  it("maps 'tavily' to 'other' (not a valid prospect_candidates.source_primary value)", () => {
    assert.equal(toCandidateSourcePrimary('tavily'), 'other');
  });

  it('passes through values already valid on both tables', () => {
    assert.equal(toCandidateSourcePrimary('apollo'), 'apollo');
    assert.equal(toCandidateSourcePrimary('manual'), 'manual');
  });

  it('passes through null', () => {
    assert.equal(toCandidateSourcePrimary(null), null);
  });
});
