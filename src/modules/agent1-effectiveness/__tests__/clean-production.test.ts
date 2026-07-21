// Q3F-5AY.4 — Clean production read-model wiring tests (pure, non-live).
//
// No DB, no fetch, no providers. Exercises the effective-classification layer
// (persisted-wins fallback) and the clean-production aggregation over the pure
// runtime classifier from Q3F-5AY.2.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateAgent1Effectiveness,
  buildCleanProduction,
  buildClassificationSourceBreakdown,
  buildOriginBreakdown,
  buildRejectionReasonBreakdown,
  resolveCandidateClassification,
  resolveClassifications,
} from '../aggregators';
import type { Agent1BatchRow, Agent1CandidateRow, Agent1UsageRow } from '../types';

function batch(overrides: Partial<Agent1BatchRow> = {}): Agent1BatchRow {
  return {
    id: overrides.id ?? 'b1',
    status: overrides.status ?? 'completed',
    countryCode: overrides.countryCode ?? 'CO',
    industry: overrides.industry ?? 'tech',
    createdBy: overrides.createdBy ?? 'u1',
    createdAt: overrides.createdAt ?? '2026-07-01T00:00:00Z',
    generatedCandidateCount: overrides.generatedCandidateCount ?? null,
    adaptiveResultStatus: overrides.adaptiveResultStatus ?? null,
    source: overrides.source ?? 'agent_1',
    name: overrides.name ?? 'Prospect run',
    metadata: overrides.metadata ?? {},
  };
}

function candidate(overrides: Partial<Agent1CandidateRow> = {}): Agent1CandidateRow {
  return {
    batchId: overrides.batchId ?? 'b1',
    status: overrides.status ?? 'needs_review',
    duplicateStatus: overrides.duplicateStatus ?? 'no_match',
    convertedAccountId: overrides.convertedAccountId ?? null,
    recordOrigin: overrides.recordOrigin ?? null,
    rejectionReason: overrides.rejectionReason ?? null,
    classificationSource: overrides.classificationSource ?? null,
    classificationConfidence: overrides.classificationConfidence ?? null,
    sourcePrimary: overrides.sourcePrimary ?? null,
    reviewNotes: overrides.reviewNotes ?? null,
    metadata: overrides.metadata ?? null,
    reviewedBy: overrides.reviewedBy ?? null,
  };
}

// A representative mixed scope reused across several cases.
function mixedScope(): { batches: Agent1BatchRow[]; candidates: Agent1CandidateRow[] } {
  return {
    batches: [batch()],
    candidates: [
      candidate({ status: 'approved' }), // production
      candidate({ status: 'converted_to_account', convertedAccountId: 'acc-1' }), // production converted
      candidate({ status: 'discarded', sourcePrimary: 'smoke_script' }), // smoke_test / test_record
      candidate({ status: 'discarded', reviewNotes: 'limpieza histórica masiva' }), // historical_cleanup / cleanup_record
      candidate({ status: 'needs_review', sourcePrimary: 'external_import' }), // import
      candidate({ status: 'discarded' }), // unknown / unknown
    ],
  };
}

describe('Q3F-5AY.4 — all-scope metrics preserved', () => {
  it('1. existing all-scope funnel counts every candidate, independent of origin', () => {
    const { batches, candidates } = mixedScope();
    const s = aggregateAgent1Effectiveness({ batches, candidates, usageLogs: [] });
    // All-scope funnel is unchanged: it still counts ALL 6 candidates.
    assert.equal(s.funnel.persistedCandidatesCount, 6);
    assert.equal(s.funnel.approvedCandidatesCount, 2); // approved + converted_to_account
    assert.equal(s.funnel.convertedAccountsCount, 1);
    assert.equal(s.funnel.rejectedCandidatesCount, 3); // three discarded
  });
});

describe('Q3F-5AY.4 — clean production exclusions', () => {
  it('2. clean production excludes smoke_test', () => {
    const batches = [batch()];
    const candidates = [
      candidate({ status: 'approved' }),
      candidate({ status: 'approved', sourcePrimary: 'smoke_script' }),
    ];
    const s = aggregateAgent1Effectiveness({ batches, candidates, usageLogs: [] });
    assert.equal(s.funnel.persistedCandidatesCount, 2);
    assert.equal(s.cleanProduction.funnel.persistedCandidatesCount, 1);
    assert.equal(s.cleanProduction.excludedByOrigin.smoke_test, 1);
  });

  it('3. clean production excludes qa', () => {
    const s = aggregateAgent1Effectiveness({
      batches: [batch()],
      candidates: [candidate({ status: 'approved' }), candidate({ status: 'approved', metadata: { qa_only: true } })],
      usageLogs: [],
    });
    assert.equal(s.cleanProduction.funnel.persistedCandidatesCount, 1);
    assert.equal(s.cleanProduction.excludedByOrigin.qa, 1);
  });

  it('4. clean production excludes historical_cleanup', () => {
    const s = aggregateAgent1Effectiveness({
      batches: [batch()],
      candidates: [
        candidate({ status: 'approved' }),
        candidate({ status: 'discarded', reviewNotes: 'limpieza histórica' }),
      ],
      usageLogs: [],
    });
    assert.equal(s.cleanProduction.funnel.persistedCandidatesCount, 1);
    assert.equal(s.cleanProduction.excludedByOrigin.historical_cleanup, 1);
  });

  it('5. clean production excludes import', () => {
    const s = aggregateAgent1Effectiveness({
      batches: [batch()],
      candidates: [
        candidate({ status: 'approved' }),
        candidate({ status: 'needs_review', sourcePrimary: 'external_import' }),
      ],
      usageLogs: [],
    });
    assert.equal(s.cleanProduction.funnel.persistedCandidatesCount, 1);
    assert.equal(s.cleanProduction.excludedByOrigin.import, 1);
  });

  it('6. clean production excludes unknown by default and reports it', () => {
    const s = aggregateAgent1Effectiveness({
      batches: [batch()],
      candidates: [candidate({ status: 'approved' }), candidate({ status: 'discarded' })],
      usageLogs: [],
    });
    assert.equal(s.cleanProduction.funnel.persistedCandidatesCount, 1);
    assert.equal(s.cleanProduction.unknownOriginCount, 1);
    assert.equal(s.cleanProduction.excludedByOrigin.unknown, 1);
    assert.ok(s.cleanProduction.classificationWarnings.includes('unknown_origin_present'));
    assert.ok(s.classificationWarnings.includes('unknown_origin_present'));
  });

  it('7. production candidates enter clean production', () => {
    const s = aggregateAgent1Effectiveness({
      batches: [batch()],
      candidates: [candidate({ status: 'approved' }), candidate({ status: 'needs_review' })],
      usageLogs: [],
    });
    assert.equal(s.cleanProduction.funnel.persistedCandidatesCount, 2);
    assert.equal(s.cleanProduction.excludedFromCleanProductionCount, 0);
    assert.equal(s.originBreakdown.production, 2);
  });

  it('8. converted production counts as clean converted', () => {
    const s = aggregateAgent1Effectiveness({
      batches: [batch()],
      candidates: [candidate({ status: 'converted_to_account', convertedAccountId: 'acc-1' })],
      usageLogs: [],
    });
    assert.equal(s.cleanProduction.funnel.convertedAccountsCount, 1);
    assert.equal(s.cleanProduction.funnel.approvedCandidatesCount, 1);
    assert.equal(s.cleanProduction.rates.conversionRate, 1);
  });

  it('9. discarded cleanup does NOT count as a clean rejected candidate', () => {
    const s = aggregateAgent1Effectiveness({
      batches: [batch()],
      candidates: [
        candidate({ status: 'approved' }),
        candidate({ status: 'discarded', reviewNotes: 'limpieza histórica' }),
      ],
      usageLogs: [],
    });
    // All-scope has 1 rejected; clean production has 0 rejected (cleanup excluded).
    assert.equal(s.funnel.rejectedCandidatesCount, 1);
    assert.equal(s.cleanProduction.funnel.rejectedCandidatesCount, 0);
  });
});

describe('Q3F-5AY.4 — rejection reason breakdown', () => {
  it('10-12. groups cleanup_record, test_record and unknown reasons', () => {
    const { batches, candidates } = mixedScope();
    const s = aggregateAgent1Effectiveness({ batches, candidates, usageLogs: [] });
    assert.equal(s.rejectionReasonBreakdown.cleanup_record, 1);
    assert.equal(s.rejectionReasonBreakdown.test_record, 1);
    assert.equal(s.rejectionReasonBreakdown.unknown, 1);
  });
});

describe('Q3F-5AY.4 — persisted vs runtime resolution', () => {
  it('13. persisted classification wins over the runtime classifier when non-null', () => {
    // Status would derive 'production', but persisted says smoke_test → persisted wins.
    const c = candidate({
      status: 'approved',
      recordOrigin: 'smoke_test',
      rejectionReason: 'test_record',
      classificationSource: 'writer',
    });
    const resolved = resolveCandidateClassification(c);
    assert.equal(resolved.effectiveRecordOrigin, 'smoke_test');
    assert.equal(resolved.effectiveRejectionReason, 'test_record');
    assert.equal(resolved.effectiveClassificationSource, 'writer');
    assert.equal(resolved.classificationResolutionSource, 'persisted');
  });

  it('14. persisted record_origin null → derives at runtime', () => {
    const resolved = resolveCandidateClassification(candidate({ status: 'approved', recordOrigin: null }));
    assert.equal(resolved.effectiveRecordOrigin, 'production');
    assert.equal(resolved.classificationResolutionSource, 'derived_runtime');
  });

  it('14b. invalid persisted record_origin is ignored and falls back to runtime', () => {
    const resolved = resolveCandidateClassification(candidate({ status: 'approved', recordOrigin: 'garbage_value' }));
    assert.equal(resolved.effectiveRecordOrigin, 'production');
    assert.equal(resolved.classificationResolutionSource, 'derived_runtime');
  });

  it('15. classificationSourceBreakdown reports persisted vs derived_runtime', () => {
    const s = aggregateAgent1Effectiveness({
      batches: [batch()],
      candidates: [
        candidate({ status: 'approved', recordOrigin: 'production', classificationSource: 'manual' }), // persisted
        candidate({ status: 'approved' }), // derived
        candidate({ status: 'discarded' }), // derived
      ],
      usageLogs: [],
    });
    assert.equal(s.classificationSourceBreakdown.persisted, 1);
    assert.equal(s.classificationSourceBreakdown.derived_runtime, 2);
  });
});

describe('Q3F-5AY.4 — batch fallback classification', () => {
  it('16. batch-level smoke marker derives smoke_test for an unmarked candidate', () => {
    const b = batch({ id: 'bs', name: 'SMOKE run 2026-07' });
    const c = candidate({ batchId: 'bs', status: 'needs_review' });
    const resolved = resolveClassifications([b], [c]);
    assert.equal(resolved[0].effectiveRecordOrigin, 'smoke_test');
    assert.equal(resolved[0].effectiveClassificationSource, 'derived_batch');
  });
});

describe('Q3F-5AY.4 — purity & safety', () => {
  it('17. does not mutate candidate/batch inputs', () => {
    const b = batch({ id: 'bx', name: 'SMOKE' });
    const c = candidate({ batchId: 'bx', status: 'discarded', metadata: { smoke_test: true } });
    const bSnap = JSON.stringify(b);
    const cSnap = JSON.stringify(c);
    resolveClassifications([b], [c]);
    buildOriginBreakdown(resolveClassifications([b], [c]));
    assert.equal(JSON.stringify(b), bSnap);
    assert.equal(JSON.stringify(c), cSnap);
  });

  it('18. empty arrays do not throw and produce a zero-filled, safe shape', () => {
    const s = aggregateAgent1Effectiveness({ batches: [], candidates: [], usageLogs: [] });
    assert.equal(s.cleanProduction.funnel.persistedCandidatesCount, 0);
    assert.equal(s.cleanProduction.excludedFromCleanProductionCount, 0);
    assert.equal(s.cleanProduction.unknownOriginCount, 0);
    assert.equal(s.cleanProduction.cleanCostUsd, null);
    // Every origin key present and zero.
    for (const origin of [
      'production',
      'smoke_test',
      'qa',
      'historical_cleanup',
      'import',
      'unknown',
      'synthetic',
    ] as const) {
      assert.equal(s.originBreakdown[origin], 0);
      assert.equal(s.cleanProduction.excludedByOrigin[origin], 0);
    }
    assert.deepEqual(s.rejectionReasonBreakdown, {});
    assert.equal(s.classificationSourceBreakdown.persisted, 0);
    assert.equal(s.classificationSourceBreakdown.derived_runtime, 0);
    // Buildable directly too.
    assert.doesNotThrow(() => buildCleanProduction([], [], []));
    assert.doesNotThrow(() => buildRejectionReasonBreakdown([]));
    assert.doesNotThrow(() => buildClassificationSourceBreakdown([]));
  });

  it('19. clean rates never yield Infinity/NaN', () => {
    const { batches, candidates } = mixedScope();
    const s = aggregateAgent1Effectiveness({ batches, candidates, usageLogs: [] });
    for (const v of [
      s.cleanProduction.rates.approvalRate,
      s.cleanProduction.rates.rejectionRate,
      s.cleanProduction.rates.conversionRate,
      s.cleanProduction.rates.pendingRate,
      s.cleanProduction.rates.duplicateOrSkippedRate,
    ]) {
      assert.ok(v === null || Number.isFinite(v));
    }
  });

  it('20. clean cost is not invented — cleanCostUsd null with batch-level warning', () => {
    const usageLogs: Agent1UsageRow[] = [
      {
        batchId: 'b1',
        providerKey: 'anthropic',
        operationKey: 'generate',
        status: 'success',
        estimatedCostUsd: 0.5,
        creditsUsed: 0,
        resultsReturned: 0,
      },
    ];
    const s = aggregateAgent1Effectiveness({
      batches: [batch()],
      candidates: [candidate({ status: 'approved' })],
      usageLogs,
    });
    // All-scope cost still computed; clean per-candidate cost deliberately null.
    assert.ok(s.cost.totalProviderCostUsd > 0);
    assert.equal(s.cleanProduction.cleanCostUsd, null);
    assert.ok(s.cleanProduction.classificationWarnings.includes('clean_cost_attribution_is_batch_level'));
  });

  it('high unknown share raises the high_unknown_discarded_share warning', () => {
    const s = aggregateAgent1Effectiveness({
      batches: [batch()],
      candidates: [
        candidate({ status: 'discarded' }),
        candidate({ status: 'discarded' }),
        candidate({ status: 'approved' }),
      ],
      usageLogs: [],
    });
    // 2/3 unknown > 0.5 threshold.
    assert.ok(s.cleanProduction.classificationWarnings.includes('high_unknown_discarded_share'));
  });
});
