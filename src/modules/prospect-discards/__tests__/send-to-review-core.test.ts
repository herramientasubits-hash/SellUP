// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — "Enviar a revisión" core logic tests,
// against an in-memory fake Supabase client injected directly (no module
// mocking — `mock.module` + tsconfig path aliases is unreliable in this
// environment's Node/tsx combination even for the pre-existing precedent
// test, `cut4b1-import-record-origin.test.ts`; dependency injection sidesteps
// that entirely, and matches the established `approval-idempotency.ts`
// pattern of taking an injected `Pick<SupabaseClient, 'from'>`).
//
// Covers:
//   D — server-side commercial scope (isBatchInScope callback)
//   G — "Enviar a revisión" happy path (disposition-only item)
//   H — resulting candidate lands at needs_review
//   I — human_override audit details are returned for the caller to log
//   L — an item already linked to a candidate reuses it (no duplicate)
//   M — retrying the SAME send-to-review call does not create a 2nd candidate
//   F/K — zero provider calls, zero budget/credit table touched (the fake
//         Supabase below is the entire reachable surface; no import besides
//         node:test/assert and the module under test)
//
// Run: node --import tsx --test <this file>

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendCandidateToReviewCore, sendDispositionToReviewCore } from '../send-to-review-core';

// ─── In-memory fake DB + Supabase-shaped query builder ─────────────────────

type Row = Record<string, unknown>;
type Table = Map<string, Row>;

let db: Record<string, Table> = {};

function resetFakeState(): void {
  db = {
    prospect_candidates: new Map(),
    prospect_discarded_dispositions: new Map(),
    prospect_batches: new Map(),
  };
}
resetFakeState();

function seed(table: string, row: Row): void {
  db[table].set(row.id as string, { ...row });
}

function makeFakeSupabase() {
  function from(table: string) {
    const state: {
      filters: [string, unknown][];
      op: { type: 'update'; patch: Row } | { type: 'insert'; rows: Row[] } | null;
      single: 'maybe' | true | false;
    } = { filters: [], op: null, single: false };

    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        state.filters.push([col, val]);
        return builder;
      },
      update(patch: Row) {
        state.op = { type: 'update', patch };
        return builder;
      },
      insert(patch: Row | Row[]) {
        state.op = { type: 'insert', rows: Array.isArray(patch) ? patch : [patch] };
        return builder;
      },
      maybeSingle() {
        state.single = 'maybe';
        return exec();
      },
      single() {
        state.single = true;
        return exec();
      },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        exec().then(resolve, reject);
      },
    };

    function matches(row: Row): boolean {
      return state.filters.every(([col, val]) => row[col] === val);
    }

    async function exec(): Promise<{ data: unknown; error: { message: string } | null }> {
      const tableMap = db[table];
      if (!tableMap) return { data: null, error: { message: `unknown table ${table}` } };

      if (state.op?.type === 'update') {
        const matched = [...tableMap.values()].filter(matches);
        for (const row of matched) Object.assign(row, state.op.patch);
        const data = matched.map((r) => ({ ...r }));
        if (state.single === 'maybe' || state.single === true) return { data: data[0] ?? null, error: null };
        return { data, error: null };
      }

      if (state.op?.type === 'insert') {
        const inserted = state.op.rows.map((patch) => {
          const id =
            (patch.id as string) ?? `generated-${tableMap.size}-${Math.random().toString(36).slice(2, 8)}`;
          const row: Row = {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...patch,
            id,
          };
          tableMap.set(id, row);
          return { ...row };
        });
        if (state.single === true) return { data: inserted[0], error: null };
        return { data: inserted, error: null };
      }

      const matched = [...tableMap.values()].filter(matches).map((r) => ({ ...r }));
      if (state.single === 'maybe') return { data: matched[0] ?? null, error: null };
      if (state.single === true) {
        return matched[0] ? { data: matched[0], error: null } : { data: null, error: { message: 'not found' } };
      }
      return { data: matched, error: null };
    }

    return builder;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from } as any;
}

function seedBatch(id = 'batch-1'): void {
  seed('prospect_batches', { id, owner_id: 'owner-1', created_by: 'owner-1' });
}

function seedDisposition(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: 'disp-1',
    batch_id: 'batch-1',
    candidate_id: null,
    provider_identifier: 'apollo-org-1',
    source_key: 'domain:acme.com',
    name: 'Acme',
    domain: 'acme.com',
    country_code: 'CO',
    industry: 'Tecnología',
    source_primary: 'apollo',
    round_origin: 'round_1',
    disposition: 'country_rejected',
    reason_code: 'country_rejected_final',
    reason_detail: 'country_incompatible',
    evidence: { candidate_key: 'k1' },
    status: 'discarded',
    resulting_candidate_id: null,
    sent_to_review_by: null,
    sent_to_review_at: null,
    ...overrides,
  };
  seed('prospect_discarded_dispositions', row);
  return row;
}

const alwaysInScope = async () => true;
const neverInScope = async () => false;

describe('sendDispositionToReviewCore — happy path (Test G/H/I)', () => {
  beforeEach(resetFakeState);

  it('creates a needs_review candidate and returns human_override audit details', async () => {
    seedBatch();
    seedDisposition();

    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'disp-1',
    );

    assert.equal(outcome.outcome, 'sent');
    if (outcome.outcome !== 'sent') return;
    assert.ok(outcome.candidateId);
    assert.equal(outcome.batchId, 'batch-1');
    assert.equal(outcome.auditDetails.human_override, true); // Test I
    assert.equal(outcome.auditDetails.source, 'discarded_disposition');
    assert.equal(outcome.auditDetails.original_disposition, 'country_rejected');

    const candidate = db.prospect_candidates.get(outcome.candidateId);
    assert.ok(candidate);
    assert.equal(candidate!.status, 'needs_review'); // Test H
    assert.equal(candidate!.name, 'Acme');
    assert.equal(candidate!.record_origin, 'production');
    assert.equal((candidate!.metadata as Row).human_override, true);

    const disposition = db.prospect_discarded_dispositions.get('disp-1');
    assert.equal(disposition!.status, 'sent_to_review');
    assert.equal(disposition!.resulting_candidate_id, outcome.candidateId);
  });

  it('maps tavily source_primary to a value prospect_candidates actually accepts', async () => {
    seedBatch();
    seedDisposition({ source_primary: 'tavily' });

    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'disp-1',
    );
    assert.equal(outcome.outcome, 'sent');
    if (outcome.outcome !== 'sent') return;
    assert.equal(db.prospect_candidates.get(outcome.candidateId)!.source_primary, 'other');
  });
});

describe('sendDispositionToReviewCore — idempotency (Test M)', () => {
  beforeEach(resetFakeState);

  it('retrying the same disposition never creates a second candidate', async () => {
    seedBatch();
    seedDisposition();
    const deps = { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope };

    const first = await sendDispositionToReviewCore(deps, 'disp-1');
    assert.equal(first.outcome, 'sent');
    const countAfterFirst = db.prospect_candidates.size;

    const second = await sendDispositionToReviewCore(deps, 'disp-1');
    assert.equal(second.outcome, 'idempotent');
    if (second.outcome !== 'idempotent' || first.outcome !== 'sent') return;
    assert.equal(second.candidateId, first.candidateId);
    assert.equal(db.prospect_candidates.size, countAfterFirst, 'no second candidate created');
  });
});

describe('sendDispositionToReviewCore — reuses an existing candidate (Test L)', () => {
  beforeEach(resetFakeState);

  it('a disposition already linked to a candidate transitions that row instead of duplicating', async () => {
    seedBatch();
    seed('prospect_candidates', {
      id: 'existing-candidate-1',
      batch_id: 'batch-1',
      status: 'discarded',
      review_notes: 'Duplicado confirmado manualmente',
    });
    seedDisposition({ candidate_id: 'existing-candidate-1' });

    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'disp-1',
    );
    assert.equal(outcome.outcome, 'sent');
    if (outcome.outcome !== 'sent') return;
    assert.equal(outcome.candidateId, 'existing-candidate-1');
    assert.equal(db.prospect_candidates.size, 1, 'no new candidate row created');
    assert.equal(db.prospect_candidates.get('existing-candidate-1')!.status, 'needs_review');
  });
});

describe('sendDispositionToReviewCore — scope (Test D)', () => {
  beforeEach(resetFakeState);

  it('rejects a request the injected scope predicate denies', async () => {
    seedBatch();
    seedDisposition();

    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: neverInScope },
      'disp-1',
    );
    assert.equal(outcome.outcome, 'out_of_scope');
    assert.equal(db.prospect_candidates.size, 0, 'no candidate created for an out-of-scope request');
  });
});

describe('sendDispositionToReviewCore — not found / status conflicts', () => {
  beforeEach(resetFakeState);

  it('reports not_found for an unknown disposition id', async () => {
    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'does-not-exist',
    );
    assert.equal(outcome.outcome, 'not_found');
  });

  it('rejects a disposition already sent_to_review with no resulting candidate as write_failed (fail-closed)', async () => {
    seedBatch();
    seedDisposition({ status: 'sent_to_review', resulting_candidate_id: null, candidate_id: null });

    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'disp-1',
    );
    assert.equal(outcome.outcome, 'write_failed');
  });
});

describe('sendCandidateToReviewCore — manual discard branch', () => {
  beforeEach(resetFakeState);

  it('sends an already-discarded candidate row back to needs_review', async () => {
    seedBatch();
    seed('prospect_candidates', {
      id: 'cand-1',
      batch_id: 'batch-1',
      status: 'discarded',
      review_notes: 'Fuera del segmento objetivo',
    });

    const outcome = await sendCandidateToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'cand-1',
    );
    assert.equal(outcome.outcome, 'sent');
    if (outcome.outcome !== 'sent') return;
    assert.equal(outcome.candidateId, 'cand-1');
    assert.equal(db.prospect_candidates.get('cand-1')!.status, 'needs_review');
  });

  it('is idempotent when the candidate is already needs_review', async () => {
    seedBatch();
    seed('prospect_candidates', { id: 'cand-1', batch_id: 'batch-1', status: 'needs_review' });

    const outcome = await sendCandidateToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'cand-1',
    );
    assert.equal(outcome.outcome, 'idempotent');
  });

  it('rejects a candidate in a conflicting status (e.g. approved)', async () => {
    seedBatch();
    seed('prospect_candidates', { id: 'cand-1', batch_id: 'batch-1', status: 'approved' });

    const outcome = await sendCandidateToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'cand-1',
    );
    assert.equal(outcome.outcome, 'reject');
    if (outcome.outcome !== 'reject') return;
    assert.equal(outcome.reason, 'status_conflict');
  });
});
