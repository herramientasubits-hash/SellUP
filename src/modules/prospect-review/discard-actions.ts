'use server';

// Q3F-5AZ.2G-1 — Safe discard wrapper for the Prospectos surface.
//
// The Prospectos "Descartar" action removes a clean-production candidate from
// pending review WITHOUT creating an account, WITHOUT touching HubSpot, WITHOUT
// calling any provider/enrichment/AI path. The canonical implementation of the
// status write + audit already exists as `discardCandidate` in prospect-batches
// — but it is NOT safe to call directly from the Prospectos surface because it
// gates on `requireActiveUser` (any active user) and has no Prospectos-specific
// eligibility contract. This wrapper HARDENS that path for Prospectos:
//
//   - admin gate (isCurrentUserAdmin) BEFORE touching data — same as the
//     approve wrappers, stronger than the legacy requireActiveUser.
//   - Prospectos eligibility contract (clean production, needs_review, with a
//     controlled idempotent no-op for an already-discarded row).
//   - Q3F-5BB.11K-FIX: a REQUIRED, server-validated traceable reason — the
//     Prospectos surface can no longer land a discard with `review_notes = null`.
//   - then DELEGATES the actual status write + audit to `discardCandidate`.
//
// This file performs NO write of its own (no insert/update/upsert/delete/rpc) —
// it reads the minimal state to gate, then delegates. There is exactly ONE
// source of truth for the discard transition (the canonical action). It never
// calls any approve action, never creates an account, and never marks a
// candidate as duplicate.

import { revalidatePath } from 'next/cache';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { createClient } from '@/lib/supabase/server';
import { discardCandidate } from '@/modules/prospect-batches/actions';
import {
  evaluateDiscardEligibility,
  type DiscardRejectReason,
} from './discard-eligibility';
import { validateDiscardReason } from './discard-reason';

// Prospectos lives at /accounts?tab=prospectos; the legacy review queue mirrors
// review decisions too. Discarding drops the row out of pendientes on both.
const ACCOUNTS_PATH = '/accounts';
const REVIEW_QUEUE_PATH = '/prospect-batches/review';

/** Where the discard was triggered from (telemetry / future use). */
export type DiscardSource =
  | 'prospectos_drawer'
  | 'prospectos_row_menu'
  | 'prospectos_context_menu'
  | 'prospectos_selection_bar';

export interface DiscardActionOptions {
  /**
   * Human reason, persisted to review_notes by the canonical action.
   * Q3F-5BB.11K-FIX — REQUIRED on this hardened path: a discard from Prospectos
   * without a traceable motive is rejected as `invalid_reason` before any read
   * or write. The canonical mutation keeps its own reason parameter OPTIONAL, so
   * Route B — the legacy batch-detail dialog — stays untouched.
   */
  reason?: string;
  source?: DiscardSource;
}

/** Typed result surfaced to the client. Never throws to the caller. */
export type DiscardActionResult =
  | { ok: true; status: 'discarded' | 'idempotent_success'; message?: string }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_allowed'
        | 'invalid_reason'
        | DiscardRejectReason
        | 'discard_failed'
        | 'unexpected_error';
      message?: string;
    };

/**
 * Discards a single clean-production candidate from the Prospectos surface.
 * Admin only. Requires a traceable `options.reason` (validated server-side).
 * Validates the Prospectos eligibility contract before DELEGATING
 * the status write + audit to the canonical `discardCandidate`. All failure
 * modes resolve to a typed result — the UI renders a friendly message instead
 * of crashing. Requires explicit human decision (the caller confirms first).
 */
export async function discardPendingReviewCandidateAction(
  candidateId: string,
  options: DiscardActionOptions = {},
): Promise<DiscardActionResult> {
  try {
    // 1. Admin gate BEFORE touching data — hardens the legacy requireActiveUser.
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) return { ok: false, reason: 'not_allowed' };

    // 2. Valid id required.
    if (typeof candidateId !== 'string' || candidateId.length === 0) {
      return { ok: false, reason: 'not_found' };
    }

    // 3. Q3F-5BB.11K-FIX — traceable motive REQUIRED, validated server-side
    //    BEFORE any read and long before the mutation. The client validates the
    //    same contract with the same pure helper, but the server never trusts
    //    it: an absent / blank / too-short / oversized / non-string reason is
    //    rejected fail-closed. The NORMALIZED value is what gets persisted.
    const validatedReason = validateDiscardReason(options.reason);
    if (!validatedReason.ok) {
      return { ok: false, reason: 'invalid_reason' };
    }

    // 4. Read the minimal state needed to gate. Session client (RLS-scoped),
    //    read-only — never a parallel write. The canonical action re-reads and
    //    re-validates itself; this is only the Prospectos gate.
    const supabase = await createClient();
    const { data: current, error } = await supabase
      .from('prospect_candidates')
      .select('id, status, record_origin')
      .eq('id', candidateId)
      .maybeSingle();

    if (error) {
      console.error('[prospect-review] discard: candidate read failed:', error);
      return { ok: false, reason: 'unexpected_error' };
    }
    if (!current) return { ok: false, reason: 'not_found' };

    // 5. Evaluate the pure Prospectos discard eligibility policy.
    const decision = evaluateDiscardEligibility({
      status: current.status,
      recordOrigin: current.record_origin,
    });

    if (decision.decision === 'idempotent') {
      revalidatePath(ACCOUNTS_PATH);
      revalidatePath(REVIEW_QUEUE_PATH);
      return {
        ok: true,
        status: 'idempotent_success',
        message: 'Este prospecto ya estaba descartado.',
      };
    }
    if (decision.decision === 'reject') {
      return { ok: false, reason: decision.reason };
    }

    // 6. Delegate the status write + audit to the canonical discardCandidate.
    //    (needs_review → discarded, review_notes, reviewed_by/reviewed_at,
    //    candidate_discarded audit.) The canonical action THROWS on failure, so
    //    a thrown error maps to the controlled `discard_failed` result rather
    //    than crashing the caller. The VALIDATED/normalized reason is what
    //    reaches review_notes + the audit trail.
    try {
      await discardCandidate(candidateId, validatedReason.reason);
    } catch (delegateErr) {
      console.error('[prospect-review] discard delegation failed:', delegateErr);
      return { ok: false, reason: 'discard_failed' };
    }

    // 7. Refresh so the row drops out of pendientes (no longer needs_review).
    revalidatePath(ACCOUNTS_PATH);
    revalidatePath(REVIEW_QUEUE_PATH);
    return { ok: true, status: 'discarded' };
  } catch (err) {
    // Detailed context stays server-side; the UI gets a safe generic result.
    console.error('[prospect-review] discard action failed:', err);
    return { ok: false, reason: 'unexpected_error' };
  }
}
