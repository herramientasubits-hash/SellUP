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

describe('sendDispositionToReviewCore — buscador gratuito conserva su número fiscal (SOURCES-FREE-DISCARDS-KEEP-CUIT-1)', () => {
  beforeEach(resetFakeState);

  it('una fila public_source con identidad tax: crea el candidato con CUIT y razón social', async () => {
    seedBatch();
    seedDisposition({
      provider_identifier: 'tax:30685856715',
      source_key: 'free:tax:30685856715',
      name: 'CAPGEMINI ARGENTINA S. A.',
      domain: null,
      country_code: 'AR',
      source_primary: 'public_source',
      round_origin: 'free_source',
      disposition: 'final_validation_rejected',
      reason_code: 'missing_domain_final',
      evidence: { provider_raw_name: 'CAPGEMINI ARGENTINA S. A.', tax_identifier_present: true, tax_identifier_type: 'CUIT' },
    });

    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'disp-1',
    );
    assert.equal(outcome.outcome, 'sent');
    if (outcome.outcome !== 'sent') return;
    const candidate = db.prospect_candidates.get(outcome.candidateId)!;
    assert.equal(candidate.tax_identifier, '30685856715');
    assert.equal(candidate.tax_id, '30685856715');
    assert.equal(candidate.tax_identifier_type, 'CUIT');
    assert.equal(candidate.legal_name, 'CAPGEMINI ARGENTINA S. A.');
  });

  it('una fila de Apollo sigue sin número fiscal', async () => {
    seedBatch();
    seedDisposition();
    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'disp-1',
    );
    assert.equal(outcome.outcome, 'sent');
    if (outcome.outcome !== 'sent') return;
    const candidate = db.prospect_candidates.get(outcome.candidateId)!;
    assert.equal(candidate.tax_identifier, undefined);
    assert.equal(candidate.legal_name, undefined);
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

// AGENT1-CLAUDE-RESCUE-1 — el rescate automático usa el MISMO núcleo, marcado
// como origen de sistema: sin `human_override`, con su nota y sus columnas.
describe('sendDispositionToReviewCore — origen claude_rescue', () => {
  beforeEach(resetFakeState);

  it('crea el candidato sin human_override, con la nota, la metadata y las columnas del rescate', async () => {
    seedBatch();
    seedDisposition();

    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'disp-1',
      {
        kind: 'claude_rescue',
        reviewNote: 'Rescatada por Claude: Salud & Farmacéuticos.',
        metadata: { claude_rescue: { decision: 'admit' } },
        columns: { employee_count: 1001 },
      },
    );

    assert.equal(outcome.outcome, 'sent');
    if (outcome.outcome !== 'sent') return;
    assert.equal(outcome.auditDetails.human_override, undefined);
    assert.equal(outcome.auditDetails.system_origin, 'claude_rescue');
    const candidate = db.prospect_candidates.get(outcome.candidateId)!;
    assert.equal(candidate.status, 'needs_review');
    assert.equal(candidate.review_notes, 'Rescatada por Claude: Salud & Farmacéuticos.');
    assert.equal(candidate.employee_count, 1001);
    const metadata = candidate.metadata as Row;
    assert.equal(metadata.human_override, undefined);
    assert.equal(metadata.sent_to_review_by_system, 'claude_rescue');
    assert.deepEqual(metadata.claude_rescue, { decision: 'admit' });
  });

  it('el rescate nunca reabre una fila de candidato ya existente', async () => {
    seedBatch();
    seedDisposition({ candidate_id: 'cand-9' });
    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'user-1', isBatchInScope: alwaysInScope },
      'disp-1',
      { kind: 'claude_rescue', reviewNote: 'x', metadata: {} },
    );
    assert.deepEqual(outcome, { outcome: 'reject', reason: 'status_conflict' });
  });
});

// ─── AGENT1-SEND-TO-REVIEW-RECLAIM-1 — volver a revisión vuelve a reclamar ──
//
// Descartar libera el reclamo global (disparador de la 140). Devolver a
// revisión tiene que volver a reclamarlo; si otro vendedor ya tiene la
// empresa, la RPC la deja `duplicate` y la acción lo dice.

function claimsSpy(opts: { elsewhere?: boolean; degraded?: boolean; throws?: boolean } = {}) {
  const calls: Array<{ batchId: string; candidateIds: string[] }> = [];
  return {
    calls,
    fn: async (batchId: string, candidateIds: string[]) => {
      calls.push({ batchId, candidateIds });
      if (opts.throws) throw new Error('RPC caída');
      if (opts.elsewhere) {
        for (const id of candidateIds) {
          const row = db.prospect_candidates.get(id);
          if (row) row.status = 'duplicate';
        }
      }
      return {
        claimedElsewhere: opts.elsewhere ? candidateIds.map((candidateId) => ({ candidateId })) : [],
        degraded: !!opts.degraded,
      };
    },
  };
}

describe('AGENT1-SEND-TO-REVIEW-RECLAIM-1 — reclamo global al volver de Descartadas', () => {
  beforeEach(resetFakeState);

  it('candidato descartado → vuelve a revisión Y se reclama su identidad', async () => {
    seedBatch();
    seed('prospect_candidates', { id: 'cand-1', batch_id: 'batch-1', status: 'discarded', review_notes: 'x' });
    const spy = claimsSpy();
    const outcome = await sendCandidateToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'u', isBatchInScope: alwaysInScope, claimGlobalIdentities: spy.fn },
      'cand-1',
    );
    assert.equal(outcome.outcome, 'sent');
    assert.deepEqual(spy.calls, [{ batchId: 'batch-1', candidateIds: ['cand-1'] }]);
    assert.equal(db.prospect_candidates.get('cand-1')!.status, 'needs_review');
  });

  it('disposición → el candidato NUEVO se reclama', async () => {
    seedBatch();
    seedDisposition();
    const spy = claimsSpy();
    const outcome = await sendDispositionToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'u', isBatchInScope: alwaysInScope, claimGlobalIdentities: spy.fn },
      'disp-1',
    );
    assert.equal(outcome.outcome, 'sent');
    if (outcome.outcome !== 'sent') return;
    assert.deepEqual(spy.calls, [{ batchId: 'batch-1', candidateIds: [outcome.candidateId] }]);
  });

  it('otro vendedor ya la tiene → claimed_by_other_seller y la fila queda duplicate', async () => {
    seedBatch();
    seed('prospect_candidates', { id: 'cand-1', batch_id: 'batch-1', status: 'discarded', review_notes: null });
    const outcome = await sendCandidateToReviewCore(
      {
        supabase: makeFakeSupabase(),
        actorUserId: 'u',
        isBatchInScope: alwaysInScope,
        claimGlobalIdentities: claimsSpy({ elsewhere: true }).fn,
      },
      'cand-1',
    );
    assert.deepEqual(outcome, { outcome: 'claimed_by_other_seller', candidateId: 'cand-1' });
    assert.equal(db.prospect_candidates.get('cand-1')!.status, 'duplicate');
  });

  it('reclamo degradado o caído → degrada CERRADO: sigue en revisión, nadie queda duplicado', async () => {
    for (const opts of [{ degraded: true }, { throws: true }]) {
      resetFakeState();
      seedBatch();
      seed('prospect_candidates', { id: 'cand-1', batch_id: 'batch-1', status: 'discarded', review_notes: null });
      const outcome = await sendCandidateToReviewCore(
        { supabase: makeFakeSupabase(), actorUserId: 'u', isBatchInScope: alwaysInScope, claimGlobalIdentities: claimsSpy(opts).fn },
        'cand-1',
      );
      assert.equal(outcome.outcome, 'sent', JSON.stringify(opts));
      assert.equal(db.prospect_candidates.get('cand-1')!.status, 'needs_review');
    }
  });

  it('idempotente (ya en revisión) → no vuelve a llamar al reclamo', async () => {
    seedBatch();
    seed('prospect_candidates', { id: 'cand-1', batch_id: 'batch-1', status: 'needs_review', review_notes: null });
    const spy = claimsSpy();
    const outcome = await sendCandidateToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'u', isBatchInScope: alwaysInScope, claimGlobalIdentities: spy.fn },
      'cand-1',
    );
    assert.equal(outcome.outcome, 'idempotent');
    assert.equal(spy.calls.length, 0);
  });

  it('sin la dependencia inyectada, el comportamiento anterior no cambia', async () => {
    seedBatch();
    seed('prospect_candidates', { id: 'cand-1', batch_id: 'batch-1', status: 'discarded', review_notes: null });
    const outcome = await sendCandidateToReviewCore(
      { supabase: makeFakeSupabase(), actorUserId: 'u', isBatchInScope: alwaysInScope },
      'cand-1',
    );
    assert.equal(outcome.outcome, 'sent');
  });
});
