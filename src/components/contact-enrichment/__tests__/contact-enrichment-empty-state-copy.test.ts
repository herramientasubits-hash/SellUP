/**
 * Tests — getContactEnrichmentEmptyStateCopy (Hito 17A.7A)
 *
 * Pure unit tests. No network, no DOM.
 *
 * Cases:
 *   A — Apollo returned 0 profiles (no_results)
 *   B — Apollo returned profiles but all filtered (all_filtered)
 *   C — Search stopped by budget guardrail (guardrail_blocked)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getContactEnrichmentEmptyStateCopy } from '../contact-enrichment-empty-state-copy';

const BASE = {
  rawResultsCount: 0,
  rejectedByRelevance: 0,
  candidatesCreated: 0,
  noActionableContactsFound: false,
  noReviewableContactsFound: false,
  searchGuardrail: undefined as undefined | {
    max_search_attempts: number;
    max_results_per_attempt: number;
    max_results_per_run: number;
    estimated_search_credits: number;
    blocked_by_search_budget: boolean;
    stopped_early_reason: string | null;
  },
};

describe('getContactEnrichmentEmptyStateCopy', () => {
  describe('Case A — no results from Apollo', () => {
    it('returns case no_results when rawResultsCount is 0', () => {
      const copy = getContactEnrichmentEmptyStateCopy({ ...BASE });
      assert.equal(copy.case, 'no_results');
    });

    it('headline mentions Apollo did not return profiles', () => {
      const copy = getContactEnrichmentEmptyStateCopy({ ...BASE });
      assert.match(copy.headline, /Apollo no devolvió/i);
    });

    it('notAnError message mentions no contacts created and no HubSpot sync', () => {
      const copy = getContactEnrichmentEmptyStateCopy({ ...BASE });
      assert.match(copy.notAnError, /no se crearon contactos/i);
      assert.match(copy.notAnError, /HubSpot/i);
    });

    it('includes at least one actionable tip', () => {
      const copy = getContactEnrichmentEmptyStateCopy({ ...BASE });
      assert.ok(copy.tips.length > 0);
    });
  });

  describe('Case B — profiles found but all filtered', () => {
    it('returns case all_filtered when rawResultsCount > 0 and candidatesCreated = 0', () => {
      const copy = getContactEnrichmentEmptyStateCopy({
        ...BASE,
        rawResultsCount: 5,
        rejectedByRelevance: 5,
        candidatesCreated: 0,
      });
      assert.equal(copy.case, 'all_filtered');
    });

    it('headline mentions profiles were found but filtered', () => {
      const copy = getContactEnrichmentEmptyStateCopy({
        ...BASE,
        rawResultsCount: 3,
        candidatesCreated: 0,
      });
      assert.match(copy.headline, /filtros de calidad/i);
    });

    it('notAnError message confirms no completion credits spent', () => {
      const copy = getContactEnrichmentEmptyStateCopy({
        ...BASE,
        rawResultsCount: 2,
        candidatesCreated: 0,
      });
      assert.match(copy.notAnError, /no se gastaron créditos de completion/i);
    });

    it('does not trigger for rawResultsCount = 0 even with candidatesCreated = 0', () => {
      const copy = getContactEnrichmentEmptyStateCopy({ ...BASE });
      assert.notEqual(copy.case, 'all_filtered');
    });
  });

  describe('Case C — guardrail blocked search', () => {
    const guardrailResult = {
      ...BASE,
      searchGuardrail: {
        max_search_attempts: 3,
        max_results_per_attempt: 25,
        max_results_per_run: 50,
        estimated_search_credits: 50,
        blocked_by_search_budget: true,
        stopped_early_reason: 'search_budget_reached' as string | null,
      },
    };

    it('returns case guardrail_blocked when blocked_by_search_budget is true', () => {
      const copy = getContactEnrichmentEmptyStateCopy(guardrailResult);
      assert.equal(copy.case, 'guardrail_blocked');
    });

    it('headline mentions credit control', () => {
      const copy = getContactEnrichmentEmptyStateCopy(guardrailResult);
      assert.match(copy.headline, /control de créditos/i);
    });

    it('detail mentions that more profiles may exist', () => {
      const copy = getContactEnrichmentEmptyStateCopy(guardrailResult);
      assert.match(copy.detail, /más perfiles/i);
    });

    it('takes priority over all_filtered case (rawResultsCount > 0)', () => {
      const copy = getContactEnrichmentEmptyStateCopy({
        ...guardrailResult,
        rawResultsCount: 10,
        candidatesCreated: 0,
      });
      assert.equal(copy.case, 'guardrail_blocked');
    });

    it('does NOT trigger when blocked_by_search_budget is false', () => {
      const copy = getContactEnrichmentEmptyStateCopy({
        ...BASE,
        searchGuardrail: {
          ...guardrailResult.searchGuardrail,
          blocked_by_search_budget: false,
        },
      });
      assert.notEqual(copy.case, 'guardrail_blocked');
    });
  });
});
