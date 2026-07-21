'use server';

// Q3F-5AZ.2C — Approve action for the pending review queue.
//
// The ONLY write action exposed by the review surface in this hito. It approves
// a clean production candidate (record_origin='production', status='needs_review')
// and transitions it to status='approved'. It does NOT convert to an account,
// does NOT touch HubSpot, and does NOT call any provider/enrichment path.
//
// Separation of concerns:
//   - Read + admin gate + eligibility policy live here (read-only .select()).
//   - The actual status write + audit are DELEGATED to the canonical
//     `approveCandidate` in prospect-batches so there is a single source of
//     truth for the needs_review → approved transition (reviewed_by/reviewed_at
//     + candidate_approved audit). This file itself performs no insert/update.
//
// Writes go through the authenticated SESSION client (via approveCandidate),
// never the service-role admin client the read-only queue uses.

import { revalidatePath } from 'next/cache';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { createClient } from '@/lib/supabase/server';
import { approveCandidate } from '@/modules/prospect-batches/actions';
import {
  evaluateApproveEligibility,
  type ApproveOptions,
  type ApproveRejectReason,
} from './approve-eligibility';

const REVIEW_QUEUE_PATH = '/prospect-batches/review';

/** Typed result surfaced to the client. Never throws to the caller. */
export type ApproveActionResult =
  | { ok: true; status: 'approved' }
  | { ok: true; status: 'idempotent_success' }
  | {
      ok: false;
      reason: 'not_found' | 'not_allowed' | 'unexpected_error' | ApproveRejectReason;
    };

/**
 * Approves a single clean-production candidate from the review queue. Admin
 * only. Validates the candidate is genuinely in the clean pending set before
 * delegating the write. All failure modes resolve to a typed result — the UI
 * renders a friendly message instead of crashing.
 */
export async function approvePendingReviewCandidateAction(
  candidateId: string,
  options: ApproveOptions = {},
): Promise<ApproveActionResult> {
  try {
    // 1. Admin gate BEFORE touching data (phase-1 policy).
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) return { ok: false, reason: 'not_allowed' };

    // 2. Valid id required.
    if (typeof candidateId !== 'string' || candidateId.length === 0) {
      return { ok: false, reason: 'not_found' };
    }

    // 3. Read the minimal state needed to validate. Session client (RLS-scoped),
    //    read-only — mirrors approveCandidate's own pre-check read.
    const supabase = await createClient();
    const { data: current, error } = await supabase
      .from('prospect_candidates')
      .select('id, status, record_origin, duplicate_status')
      .eq('id', candidateId)
      .maybeSingle();

    if (error) {
      console.error('[prospect-review] approve: candidate read failed:', error);
      return { ok: false, reason: 'unexpected_error' };
    }
    if (!current) return { ok: false, reason: 'not_found' };

    // 4. Evaluate the pure eligibility policy.
    const decision = evaluateApproveEligibility(
      {
        status: current.status,
        recordOrigin: current.record_origin,
        duplicateStatus: current.duplicate_status,
      },
      options,
    );

    if (decision.decision === 'idempotent') {
      revalidatePath(REVIEW_QUEUE_PATH);
      return { ok: true, status: 'idempotent_success' };
    }
    if (decision.decision === 'reject') {
      return { ok: false, reason: decision.reason };
    }

    // 5. Delegate the status write + audit to the canonical approveCandidate.
    //    (needs_review → approved, reviewed_by/reviewed_at, candidate_approved.)
    await approveCandidate(candidateId);

    // 6. Refresh the review queue so the row drops out (no longer needs_review).
    revalidatePath(REVIEW_QUEUE_PATH);
    return { ok: true, status: 'approved' };
  } catch (err) {
    // Detailed context stays server-side; the UI gets a safe generic result.
    console.error('[prospect-review] approve action failed:', err);
    return { ok: false, reason: 'unexpected_error' };
  }
}
