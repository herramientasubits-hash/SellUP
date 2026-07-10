// Q3F-11C — supported-provider gate + UI-state resolver tests.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEffectivenessSupportedProvider,
  resolveContactEnrichmentEffectivenessUiState,
} from '../contact-enrichment-effectiveness-ui';
import type { ProviderEffectivenessProviderSummary } from '@/modules/provider-effectiveness/types';

function makeSummary(
  coverageOverrides: Partial<ProviderEffectivenessProviderSummary['coverage']> = {},
): ProviderEffectivenessProviderSummary {
  return {
    provider: 'apollo',
    comparable: {
      costPerApprovedContactUsd: null,
      costPerReviewableCandidateUsd: null,
      approvalRate: null,
      zeroReviewableRate: null,
    },
    coverage: {
      attributedRunCount: 0,
      outcomeMatureRunCount: 0,
      approvalComparisonEligibleRunCount: 0,
      openReviewRunCount: 0,
      costEligibleRunCount: 0,
      unknownCostRunCount: 0,
      ambiguousCostRunCount: 0,
      reviewableCandidateCount: 0,
      approvedCandidateCount: 0,
      newOfficialContactCount: 0,
      zeroReviewableRunCount: 0,
      zeroReviewableEligibleRunCount: 0,
      comparableCostUsd: 0,
      ...coverageOverrides,
    },
    diagnostics: {
      technicalSuccessRunCount: 0,
      technicalFailureRunCount: 0,
      technicalUnknownRunCount: 0,
      medianProviderRunLatencyMs: null,
      latencyEligibleRunCount: 0,
      unknownLatencyRunCount: 0,
    },
    truth: {
      costEvidenceState: 'clean',
      reliabilityEvidenceState: 'clean',
      attributionEvidenceState: 'clean',
      latencyEvidenceState: 'complete',
    },
  };
}

describe('isEffectivenessSupportedProvider', () => {
  it('supports apollo', () => {
    assert.equal(isEffectivenessSupportedProvider('apollo'), true);
  });

  it('supports lusha', () => {
    assert.equal(isEffectivenessSupportedProvider('lusha'), true);
  });

  it('does not support openai', () => {
    assert.equal(isEffectivenessSupportedProvider('openai'), false);
  });

  it('does not support tavily', () => {
    assert.equal(isEffectivenessSupportedProvider('tavily'), false);
  });
});

describe('resolveContactEnrichmentEffectivenessUiState', () => {
  it('returns no_evidence when there are zero attributed runs', () => {
    const summary = makeSummary({ attributedRunCount: 0, outcomeMatureRunCount: 0 });
    assert.equal(resolveContactEnrichmentEffectivenessUiState(summary), 'no_evidence');
  });

  it('returns pending_review when runs are attributed but none are outcome-mature', () => {
    const summary = makeSummary({ attributedRunCount: 3, outcomeMatureRunCount: 0, openReviewRunCount: 3 });
    assert.equal(resolveContactEnrichmentEffectivenessUiState(summary), 'pending_review');
  });

  it('returns mature when at least one run is outcome-mature', () => {
    const summary = makeSummary({ attributedRunCount: 5, outcomeMatureRunCount: 2, openReviewRunCount: 3 });
    assert.equal(resolveContactEnrichmentEffectivenessUiState(summary), 'mature');
  });
});
