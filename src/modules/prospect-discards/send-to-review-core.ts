// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — "Enviar a revisión" core logic.
//
// Pure orchestration over an INJECTED Supabase client (same pattern as
// `approval-idempotency.ts`'s `applyOptimisticCandidateConversionUpdate`):
// no `createClient()` call of its own, no admin/scope resolution of its own
// — those stay in the thin `'use server'` wrapper (`send-to-review-actions.ts`).
// Injecting the client and the scope predicate makes this file fully
// unit-testable with an in-memory fake, no module mocking required.
//
// Absolute requirements this file upholds (issue #389):
//   - reads/writes ONLY `prospect_candidates` and `prospect_discarded_dispositions`
//     — never a provider client, never a budget/credit table.
//   - idempotent: retrying either branch never creates a second candidate.
//   - the disposition branch CLAIMS first (conditional UPDATE
//     discarded → sent_to_review) and only THEN creates the candidate, so a
//     race between two concurrent calls can only ever produce one candidate.

import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateSendToReviewEligibility, type SendToReviewRejectReason } from './send-to-review-eligibility';
import { toCandidateSourcePrimary } from './mapping';
import { DISCARD_DISPOSITION_LABELS, type DiscardDispositionCode } from './types';

export interface SendToReviewCoreDeps {
  supabase: Pick<SupabaseClient, 'from'>;
  actorUserId: string;
  /** Resolves the current viewer's commercial-scope visibility over a batch.
   *  Injected so this module never resolves scope itself. */
  isBatchInScope: (batchId: string) => Promise<boolean>;
}

export type SendToReviewCoreOutcome =
  | {
      outcome: 'sent';
      candidateId: string;
      batchId: string;
      auditDetails: Record<string, unknown>;
    }
  | { outcome: 'idempotent'; candidateId: string }
  | { outcome: 'not_found' }
  | { outcome: 'out_of_scope' }
  | { outcome: 'reject'; reason: SendToReviewRejectReason }
  | { outcome: 'write_failed'; message: string };

function buildOverrideReviewNote(
  disposition: DiscardDispositionCode,
  reasonDetail: string | null,
): string {
  const label = DISCARD_DISPOSITION_LABELS[disposition] ?? 'Descartada';
  return reasonDetail ? `${label}: ${reasonDetail}` : label;
}

// ─── Branch A: existing prospect_candidates row (manual discard) ──────────

export async function sendCandidateToReviewCore(
  deps: SendToReviewCoreDeps,
  candidateId: string,
): Promise<SendToReviewCoreOutcome> {
  // actorUserId is not used by this branch: transitioning an EXISTING
  // candidate row records no new "reviewed_by" (see the UPDATE below, which
  // deliberately clears reviewed_by/reviewed_at rather than stamping this
  // actor as the reviewer of a decision they are overriding) — the caller
  // still receives it via auditDetails-independent logging using its own copy.
  const { supabase, isBatchInScope } = deps;

  const { data: current, error } = await supabase
    .from('prospect_candidates')
    .select('id, batch_id, status, review_notes')
    .eq('id', candidateId)
    .maybeSingle();
  if (error) return { outcome: 'write_failed', message: error.message };
  if (!current) return { outcome: 'not_found' };

  if (!(await isBatchInScope(current.batch_id as string))) {
    return { outcome: 'out_of_scope' };
  }

  const decision = evaluateSendToReviewEligibility({ status: current.status as string });
  if (decision.decision === 'idempotent') {
    return { outcome: 'idempotent', candidateId };
  }
  if (decision.decision === 'reject') {
    return { outcome: 'reject', reason: decision.reason };
  }

  // Optimistic conditional UPDATE — same shape as
  // applyOptimisticCandidateConversionUpdate: condition on the expected
  // status so a concurrent transition never gets silently overwritten.
  const { data: updatedRows, error: updateError } = await supabase
    .from('prospect_candidates')
    .update({
      status: 'needs_review',
      review_notes: current.review_notes,
      reviewed_by: null,
      reviewed_at: null,
    })
    .eq('id', candidateId)
    .eq('status', 'discarded')
    .select('id');

  if (updateError) {
    return { outcome: 'write_failed', message: updateError.message };
  }
  if (!updatedRows || (updatedRows as unknown[]).length === 0) {
    // Lost the race — re-read and resolve idempotently rather than erroring.
    const { data: reread } = await supabase
      .from('prospect_candidates')
      .select('status')
      .eq('id', candidateId)
      .maybeSingle();
    if ((reread as { status?: string } | null)?.status === 'needs_review') {
      return { outcome: 'idempotent', candidateId };
    }
    return { outcome: 'reject', reason: 'status_conflict' };
  }

  return {
    outcome: 'sent',
    candidateId,
    batchId: current.batch_id as string,
    auditDetails: {
      human_override: true,
      source: 'discarded_candidate',
      original_status: 'discarded',
      original_reason: current.review_notes,
    },
  };
}

// ─── Branch B: prospect_discarded_dispositions row (pipeline auto-reject) ─

export async function sendDispositionToReviewCore(
  deps: SendToReviewCoreDeps,
  dispositionId: string,
): Promise<SendToReviewCoreOutcome> {
  const { supabase, actorUserId, isBatchInScope } = deps;

  const { data: disposition, error } = await supabase
    .from('prospect_discarded_dispositions')
    .select('*')
    .eq('id', dispositionId)
    .maybeSingle();
  if (error) return { outcome: 'write_failed', message: error.message };
  if (!disposition) return { outcome: 'not_found' };

  const disp = disposition as {
    batch_id: string;
    candidate_id: string | null;
    status: string;
    resulting_candidate_id: string | null;
    name: string;
    domain: string | null;
    country_code: string | null;
    industry: string | null;
    source_primary: string | null;
    disposition: DiscardDispositionCode;
    reason_code: string | null;
    reason_detail: string | null;
    evidence: Record<string, unknown>;
  };

  if (!(await isBatchInScope(disp.batch_id))) {
    return { outcome: 'out_of_scope' };
  }

  const decision = evaluateSendToReviewEligibility({ status: disp.status });
  if (decision.decision === 'idempotent') {
    const existingCandidateId = disp.resulting_candidate_id ?? disp.candidate_id;
    if (existingCandidateId) {
      return { outcome: 'idempotent', candidateId: existingCandidateId };
    }
    // Marked sent_to_review but no candidate id recorded — a prior attempt's
    // candidate insert failed after the claim. Fail closed rather than
    // silently re-claiming (see the revert-on-failure path below).
    return { outcome: 'write_failed', message: 'Disposición sin candidato resultante.' };
  }
  if (decision.decision === 'reject') {
    return { outcome: 'reject', reason: decision.reason };
  }

  // Already linked to a real candidate row (e.g. future dedup path) —
  // transition that row instead of creating a second one.
  if (disp.candidate_id) {
    return sendCandidateToReviewCore(deps, disp.candidate_id);
  }

  // ── Claim: conditional UPDATE wins the race before anything is created ──
  const { data: claimedRows, error: claimError } = await supabase
    .from('prospect_discarded_dispositions')
    .update({
      status: 'sent_to_review',
      sent_to_review_by: actorUserId,
      sent_to_review_at: new Date().toISOString(),
    })
    .eq('id', dispositionId)
    .eq('status', 'discarded')
    .select('id');

  if (claimError) {
    return { outcome: 'write_failed', message: claimError.message };
  }
  if (!claimedRows || (claimedRows as unknown[]).length === 0) {
    // Lost the race — someone else claimed it concurrently. Re-read.
    const { data: reread } = await supabase
      .from('prospect_discarded_dispositions')
      .select('status, resulting_candidate_id, candidate_id')
      .eq('id', dispositionId)
      .maybeSingle();
    const rereadRow = reread as
      | { status?: string; resulting_candidate_id?: string | null; candidate_id?: string | null }
      | null;
    const winnerCandidateId = rereadRow?.resulting_candidate_id ?? rereadRow?.candidate_id ?? null;
    if (rereadRow?.status === 'sent_to_review' && winnerCandidateId) {
      return { outcome: 'idempotent', candidateId: winnerCandidateId };
    }
    return { outcome: 'reject', reason: 'status_conflict' };
  }

  // ── Won the claim: create the candidate from persisted evidence only ────
  const { data: newCandidate, error: insertError } = await supabase
    .from('prospect_candidates')
    .insert({
      batch_id: disp.batch_id,
      name: disp.name,
      domain: disp.domain,
      country_code: disp.country_code,
      industry: disp.industry,
      source_primary: toCandidateSourcePrimary(disp.source_primary),
      status: 'needs_review',
      record_origin: 'production',
      review_notes: buildOverrideReviewNote(disp.disposition, disp.reason_detail),
      metadata: {
        human_override: true,
        sent_to_review_from: 'discarded_disposition',
        discard_disposition_id: dispositionId,
        original_disposition: disp.disposition,
        original_reason_code: disp.reason_code,
        original_reason_detail: disp.reason_detail,
        original_evidence: disp.evidence,
      },
    })
    .select('id')
    .single();

  if (insertError || !newCandidate) {
    // Revert the claim so the item doesn't get stuck in a limbo state — the
    // next attempt (retry) can claim it again cleanly.
    await supabase
      .from('prospect_discarded_dispositions')
      .update({ status: 'discarded', sent_to_review_by: null, sent_to_review_at: null })
      .eq('id', dispositionId)
      .eq('status', 'sent_to_review');
    return {
      outcome: 'write_failed',
      message: (insertError as { message?: string } | null)?.message ?? 'No se pudo crear el candidato.',
    };
  }

  const newCandidateId = (newCandidate as { id: string }).id;

  await supabase
    .from('prospect_discarded_dispositions')
    .update({ resulting_candidate_id: newCandidateId, candidate_id: newCandidateId })
    .eq('id', dispositionId);

  return {
    outcome: 'sent',
    candidateId: newCandidateId,
    batchId: disp.batch_id,
    auditDetails: {
      human_override: true,
      source: 'discarded_disposition',
      discard_disposition_id: dispositionId,
      original_disposition: disp.disposition,
      original_reason_code: disp.reason_code,
      original_reason_detail: disp.reason_detail,
    },
  };
}
