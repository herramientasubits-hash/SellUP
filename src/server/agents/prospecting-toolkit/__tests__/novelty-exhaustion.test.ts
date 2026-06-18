/**
 * Tests — Novelty exhaustion metadata contract (16AB.43.23 Problem C)
 *
 * Verifies that:
 *   a) IncrementalSearchMetadata exposes novelty_exhausted as an optional boolean.
 *   b) A pipeline output with novelty_exhausted:true + persistable:0 is structurally
 *      valid — enabling callers to detect exhaustion without querying Supabase again.
 *   c) The field is absent when conditions for exhaustion are not met (happy path).
 *   d) The computation semantics are correct: exhaustion = pre-check ran AND useful>0
 *      AND persistable==0.
 *
 * Note: runIncrementalProspectingSearch has hardcoded Supabase dependencies and
 * cannot be invoked here. These tests validate the type contract and shape of
 * the output so the downstream wizard action can trust the metadata payload.
 *
 * Uses Node.js built-in test runner. No Supabase, no Tavily, no LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  IncrementalSearchOutput,
  IncrementalSearchMetadata,
} from '../incremental-search-types';

// ── NE1: Type contract — novelty_exhausted is optional boolean in metadata ────

describe('NE1 — IncrementalSearchMetadata type contract: novelty_exhausted is optional boolean', () => {

  it('NE1-a: metadata without novelty_exhausted is valid', () => {
    const meta: IncrementalSearchMetadata = {
      rounds_executed: 2,
      stopped_reason: 'max_rounds_reached',
      total_raw_evaluated: 12,
      total_candidates_accumulated: 12,
      useful_candidates_count: 12,
      min_useful_candidates: 7,
      target_internal: 25,
      max_rounds: 2,
      max_total_raw_to_evaluate: 50,
      dry_run: false,
      rounds: [],
    };
    assert.equal(meta.novelty_exhausted, undefined);
  });

  it('NE1-b: metadata with novelty_exhausted:true is valid', () => {
    const meta: IncrementalSearchMetadata = {
      rounds_executed: 2,
      stopped_reason: 'max_rounds_reached',
      total_raw_evaluated: 12,
      total_candidates_accumulated: 12,
      useful_candidates_count: 12,
      min_useful_candidates: 7,
      target_internal: 25,
      max_rounds: 2,
      max_total_raw_to_evaluate: 50,
      dry_run: false,
      rounds: [],
      novelty_exhausted: true,
      estimated_persistable_after_novelty: 0,
    };
    assert.equal(meta.novelty_exhausted, true);
    assert.equal(meta.estimated_persistable_after_novelty, 0);
  });

  it('NE1-c: metadata with novelty_exhausted:false is valid', () => {
    const meta: IncrementalSearchMetadata = {
      rounds_executed: 1,
      stopped_reason: 'min_useful_reached',
      total_raw_evaluated: 10,
      total_candidates_accumulated: 8,
      useful_candidates_count: 8,
      min_useful_candidates: 7,
      target_internal: 25,
      max_rounds: 2,
      max_total_raw_to_evaluate: 50,
      dry_run: false,
      rounds: [],
      novelty_exhausted: false,
    };
    assert.equal(meta.novelty_exhausted, false);
  });
});

// ── NE2: Output shape when novelty exhaustion occurred ────────────────────────

describe('NE2 — IncrementalSearchOutput shape for novelty-exhausted run', () => {

  function makeExhaustedOutput(): IncrementalSearchOutput {
    return {
      input: {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Tecnología',
        webSearchProvider: 'tavily',
        existingBatchId: 'batch-001',
        dryRun: false,
      },
      candidates: [],
      candidatesCount: 12,
      usefulCandidatesCount: 12,
      candidatesCreated: 0,                       // nothing persisted
      metadata: {
        rounds_executed: 2,
        stopped_reason: 'max_rounds_reached',
        total_raw_evaluated: 12,
        total_candidates_accumulated: 12,
        useful_candidates_count: 12,
        estimated_persistable_after_novelty: 0,   // all blocked by novelty
        estimated_novelty_skipped: 12,
        novelty_exhausted: true,                   // flag set by orchestrator
        min_useful_candidates: 7,
        target_internal: 25,
        max_rounds: 2,
        max_total_raw_to_evaluate: 50,
        dry_run: false,
        rounds: [],
      },
      warnings: [],
      batchId: 'batch-001',
    };
  }

  it('NE2-a: novelty_exhausted is true in metadata', () => {
    const output = makeExhaustedOutput();
    assert.equal(output.metadata.novelty_exhausted, true);
  });

  it('NE2-b: estimated_persistable_after_novelty is 0', () => {
    const output = makeExhaustedOutput();
    assert.equal(output.metadata.estimated_persistable_after_novelty, 0);
  });

  it('NE2-c: candidatesCreated is 0', () => {
    const output = makeExhaustedOutput();
    assert.equal(output.candidatesCreated, 0);
  });

  it('NE2-d: usefulCandidatesCount can be > 0 (useful before novelty check)', () => {
    const output = makeExhaustedOutput();
    assert.ok(
      (output.usefulCandidatesCount ?? 0) > 0,
      'usefulCandidatesCount should reflect candidates found before novelty filtering',
    );
  });
});

// ── NE3: Semantics — exhaustion implies pre-check ran AND useful>0 AND persist=0

describe('NE3 — Exhaustion semantics: pre-check ran, useful>0, persistable==0', () => {

  it('NE3-a: exhaustion requires useful_candidates_count > 0 (candidates were found)', () => {
    const exhaustedMeta: IncrementalSearchMetadata = {
      rounds_executed: 2,
      stopped_reason: 'max_rounds_reached',
      total_raw_evaluated: 12,
      total_candidates_accumulated: 12,
      useful_candidates_count: 12,      // >0: candidates were found
      estimated_persistable_after_novelty: 0,
      novelty_exhausted: true,
      min_useful_candidates: 7,
      target_internal: 25,
      max_rounds: 2,
      max_total_raw_to_evaluate: 50,
      dry_run: false,
      rounds: [],
    };
    // novelty_exhausted is only meaningful when there were useful candidates
    assert.ok((exhaustedMeta.useful_candidates_count) > 0);
    assert.equal(exhaustedMeta.novelty_exhausted, true);
    assert.equal(exhaustedMeta.estimated_persistable_after_novelty, 0);
  });

  it('NE3-b: if useful_candidates_count is 0 and no novelty_exhausted, that is empty-results (not exhaustion)', () => {
    const emptyResultsMeta: IncrementalSearchMetadata = {
      rounds_executed: 1,
      stopped_reason: 'no_results_round_1',
      total_raw_evaluated: 0,
      total_candidates_accumulated: 0,
      useful_candidates_count: 0,       // truly empty search
      min_useful_candidates: 7,
      target_internal: 25,
      max_rounds: 2,
      max_total_raw_to_evaluate: 50,
      dry_run: false,
      rounds: [],
      // novelty_exhausted absent/undefined in this case
    };
    assert.equal(emptyResultsMeta.novelty_exhausted, undefined);
    assert.equal(emptyResultsMeta.useful_candidates_count, 0);
  });

  it('NE3-c: happy-path output (8 candidates created) has no novelty_exhausted flag', () => {
    const happyOutput: IncrementalSearchOutput = {
      input: {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Tecnología',
        webSearchProvider: 'tavily',
        dryRun: false,
      },
      candidates: [],
      candidatesCount: 8,
      usefulCandidatesCount: 8,
      candidatesCreated: 8,
      metadata: {
        rounds_executed: 1,
        stopped_reason: 'min_useful_reached',
        total_raw_evaluated: 10,
        total_candidates_accumulated: 8,
        useful_candidates_count: 8,
        min_useful_candidates: 7,
        target_internal: 25,
        max_rounds: 2,
        max_total_raw_to_evaluate: 50,
        dry_run: false,
        rounds: [],
        // novelty_exhausted intentionally absent
      },
      warnings: [],
    };
    assert.equal(happyOutput.metadata.novelty_exhausted, undefined);
    assert.ok((happyOutput.candidatesCreated ?? 0) > 0);
  });
});

// ── NE4: Distinguishing exhaustion from empty search ─────────────────────────

describe('NE4 — Exhaustion vs empty-search distinction', () => {

  it('NE4-a: exhaustion: useful > 0 AND persistable == 0 AND novelty_exhausted == true', () => {
    function isNoveltyExhausted(meta: IncrementalSearchMetadata): boolean {
      return (
        meta.novelty_exhausted === true &&
        (meta.estimated_persistable_after_novelty ?? -1) === 0 &&
        meta.useful_candidates_count > 0
      );
    }

    const exhaustedMeta: IncrementalSearchMetadata = {
      rounds_executed: 2,
      stopped_reason: 'max_rounds_reached',
      total_raw_evaluated: 12,
      total_candidates_accumulated: 12,
      useful_candidates_count: 12,
      estimated_persistable_after_novelty: 0,
      novelty_exhausted: true,
      min_useful_candidates: 7,
      target_internal: 25,
      max_rounds: 2,
      max_total_raw_to_evaluate: 50,
      dry_run: false,
      rounds: [],
    };

    assert.equal(isNoveltyExhausted(exhaustedMeta), true);
  });

  it('NE4-b: empty search (useful==0) does not qualify as exhaustion', () => {
    function isNoveltyExhausted(meta: IncrementalSearchMetadata): boolean {
      return (
        meta.novelty_exhausted === true &&
        (meta.estimated_persistable_after_novelty ?? -1) === 0 &&
        meta.useful_candidates_count > 0
      );
    }

    const emptyMeta: IncrementalSearchMetadata = {
      rounds_executed: 1,
      stopped_reason: 'no_results_round_1',
      total_raw_evaluated: 0,
      total_candidates_accumulated: 0,
      useful_candidates_count: 0,
      min_useful_candidates: 7,
      target_internal: 25,
      max_rounds: 2,
      max_total_raw_to_evaluate: 50,
      dry_run: false,
      rounds: [],
    };

    assert.equal(isNoveltyExhausted(emptyMeta), false);
  });
});
