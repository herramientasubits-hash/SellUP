'use server';

// Q3F-5AZ.2G-2 — Safe mark-duplicate wrapper for the Prospectos surface.
//
// The Prospectos "Marcar duplicado" action classifies a clean-production
// candidate as a duplicate WITHOUT creating an account, WITHOUT merging any
// records, WITHOUT touching HubSpot, and WITHOUT calling any provider /
// enrichment / AI path. The canonical implementation of the status write +
// audit already exists as `markCandidateDuplicate` in prospect-batches — but it
// is NOT safe to call directly from the Prospectos surface because it gates on
// `requireActiveUser` (any active user) and has no Prospectos-specific
// eligibility contract. This wrapper HARDENS that path for Prospectos:
//
//   - admin gate (isCurrentUserAdmin) BEFORE touching data — same as the
//     approve / discard wrappers, stronger than the legacy requireActiveUser.
//   - Prospectos eligibility contract (clean production, needs_review, with a
//     controlled idempotent no-op for an already-duplicate row).
//   - then DELEGATES the actual status write + audit to `markCandidateDuplicate`.
//
// This file performs NO write of its own (no insert/update/upsert/delete/rpc) —
// it reads the minimal state to gate, then delegates. There is exactly ONE
// source of truth for the duplicate transition (the canonical action). It never
// calls any approve action, never calls any discard action, and never creates
// an account.
//
// Classification choice: the one-click Prospectos "Marcar duplicado" has no
// duplicate-type selector and no matched-account evidence, so it delegates with
// the conservative `possible_duplicate` classification (the same default the
// legacy per-batch dialog uses). The canonical action sets status='duplicate'
// regardless of the duplicate_status value, so the prospect always leaves the
// pending-review queue; passing `possible_duplicate` avoids over-asserting an
// exact match we cannot back with a matched_account_id.

import { revalidatePath } from 'next/cache';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { createClient } from '@/lib/supabase/server';
import { markCandidateDuplicate } from '@/modules/prospect-batches/actions';
import {
  evaluateDuplicateEligibility,
  type DuplicateRejectReason,
} from './duplicate-eligibility';

// Prospectos lives at /accounts?tab=prospectos; the legacy review queue mirrors
// review decisions too. Marking a duplicate drops the row out of pendientes on both.
const ACCOUNTS_PATH = '/accounts';
const REVIEW_QUEUE_PATH = '/prospect-batches/review';

// Conservative classification for a one-click, evidence-free mark (see header).
const PROSPECTOS_DUPLICATE_STATUS = 'possible_duplicate' as const;

/** Where the mark-duplicate was triggered from (telemetry / future use). */
export type MarkDuplicateSource =
  | 'prospectos_drawer'
  | 'prospectos_row_menu'
  | 'prospectos_context_menu'
  | 'prospectos_selection_bar';

export interface MarkDuplicateActionOptions {
  source?: MarkDuplicateSource;
}

/** Typed result surfaced to the client. Never throws to the caller. */
export type MarkDuplicateActionResult =
  | { ok: true; status: 'duplicate' | 'idempotent_success'; message?: string }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_allowed'
        | DuplicateRejectReason
        | 'duplicate_failed'
        | 'unexpected_error';
      message?: string;
    };

/**
 * Marks a single clean-production candidate as a duplicate from the Prospectos
 * surface. Admin only. Validates the Prospectos eligibility contract before
 * DELEGATING the status write + audit to the canonical `markCandidateDuplicate`.
 * All failure modes resolve to a typed result — the UI renders a friendly
 * message instead of crashing. Requires explicit human decision (the caller
 * confirms first).
 */
export async function markDuplicatePendingReviewCandidateAction(
  candidateId: string,
  options: MarkDuplicateActionOptions = {},
): Promise<MarkDuplicateActionResult> {
  // Telemetry breadcrumb (where the action was triggered from); logged on the
  // failure paths below to aid debugging. Never persisted / never sent anywhere.
  const source = options.source ?? 'unknown';
  try {
    // 1. Admin gate BEFORE touching data — hardens the legacy requireActiveUser.
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) return { ok: false, reason: 'not_allowed' };

    // 2. Valid id required.
    if (typeof candidateId !== 'string' || candidateId.length === 0) {
      return { ok: false, reason: 'not_found' };
    }

    // 3. Read the minimal state needed to gate. Session client (RLS-scoped),
    //    read-only — never a parallel write. The canonical action re-reads and
    //    writes itself; this is only the Prospectos gate.
    const supabase = await createClient();
    const { data: current, error } = await supabase
      .from('prospect_candidates')
      .select('id, status, record_origin')
      .eq('id', candidateId)
      .maybeSingle();

    if (error) {
      console.error('[prospect-review] mark-duplicate: candidate read failed:', error);
      return { ok: false, reason: 'unexpected_error' };
    }
    if (!current) return { ok: false, reason: 'not_found' };

    // 4. Evaluate the pure Prospectos mark-duplicate eligibility policy.
    const decision = evaluateDuplicateEligibility({
      status: current.status,
      recordOrigin: current.record_origin,
    });

    if (decision.decision === 'idempotent') {
      revalidatePath(ACCOUNTS_PATH);
      revalidatePath(REVIEW_QUEUE_PATH);
      return {
        ok: true,
        status: 'idempotent_success',
        message: 'Este prospecto ya estaba marcado como duplicado.',
      };
    }
    if (decision.decision === 'reject') {
      return { ok: false, reason: decision.reason };
    }

    // 5. Delegate the status write + audit to the canonical markCandidateDuplicate.
    //    (needs_review → duplicate, duplicate_status, reviewed_by/reviewed_at,
    //    candidate_marked_duplicate audit.) No matched_account_id / no HubSpot id
    //    is passed — this is a classification, not a merge. The canonical action
    //    THROWS on failure, so a thrown error maps to the controlled
    //    `duplicate_failed` result rather than crashing the caller.
    try {
      await markCandidateDuplicate(candidateId, {
        duplicate_status: PROSPECTOS_DUPLICATE_STATUS,
      });
    } catch (delegateErr) {
      console.error(
        `[prospect-review] mark-duplicate delegation failed (source=${source}):`,
        delegateErr,
      );
      return { ok: false, reason: 'duplicate_failed' };
    }

    // 6. Refresh so the row drops out of pendientes (no longer needs_review).
    revalidatePath(ACCOUNTS_PATH);
    revalidatePath(REVIEW_QUEUE_PATH);
    return { ok: true, status: 'duplicate' };
  } catch (err) {
    // Detailed context stays server-side; the UI gets a safe generic result.
    console.error('[prospect-review] mark-duplicate action failed:', err);
    return { ok: false, reason: 'unexpected_error' };
  }
}
