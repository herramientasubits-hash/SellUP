'use server';

// Q3F-5AZ.2E-1 — Safe approve + convert wrapper for the Prospectos surface.
//
// The Prospectos "Aprobar" action must now do the FULL contract: validate the
// prospect, create/link a SellUp account, best-effort sync HubSpot, mark the
// candidate converted_to_account and drop it out of pendientes. The canonical
// implementation of that already exists as `approveAndConvertCandidateAction`
// in prospect-batches — but it is NOT safe to call directly from the Prospectos
// surface because it gates on `requireActiveUser` (any active user), runs the
// HubSpot sync synchronously, and has no Prospectos-specific eligibility
// contract. This wrapper HARDENS that path for Prospectos:
//
//   - admin gate (isCurrentUserAdmin) BEFORE touching data — same as the
//     approve-only action, stronger than the legacy requireActiveUser.
//   - Prospectos eligibility contract (clean production, needs_review, duplicate
//     + HubSpot-match confirmation, approved-only remediation conflict).
//   - then DELEGATES the actual account creation + HubSpot best-effort +
//     idempotency + audit to `approveAndConvertCandidateAction`.
//
// This file performs NO account creation and NO HubSpot logic of its own — it
// reads the minimal state to gate, then delegates. There is exactly ONE source
// of truth for the conversion (the canonical action). It never calls
// `approveCandidate` (approve-only) nor `approvePendingReviewCandidateAction`.

import { revalidatePath } from 'next/cache';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { createClient } from '@/lib/supabase/server';
import { approveAndConvertCandidateAction } from '@/modules/prospect-batches/actions';
import {
  evaluateConvertApproveEligibility,
  type ConvertApproveOptions,
  type ConvertApproveRejectReason,
} from './approve-and-convert-eligibility';

// Prospectos lives at /accounts?tab=prospectos; the converted account appears in
// Empresas (/accounts). The legacy review queue mirrors approvals too.
const ACCOUNTS_PATH = '/accounts';
const REVIEW_QUEUE_PATH = '/prospect-batches/review';

/** Where the approval was triggered from (telemetry / future use). */
export type ConvertApproveSource =
  | 'prospectos_drawer'
  | 'prospectos_row_menu'
  | 'prospectos_context_menu'
  | 'prospectos_selection_bar';

export interface ApproveAndConvertActionOptions extends ConvertApproveOptions {
  source?: ConvertApproveSource;
}

/** HubSpot outcome, normalized to the wrapper's stable vocabulary. */
export type ConvertApproveHubSpotStatus =
  | 'created'
  | 'linked_existing'
  | 'skipped_not_configured'
  | 'skipped_possible_match'
  | 'failed_create'
  | 'unknown';

/** Typed result surfaced to the client. Never throws to the caller. */
export type ApproveAndConvertActionResult =
  | {
      ok: true;
      status: 'converted_to_account' | 'idempotent_success';
      accountId?: string;
      hubSpotStatus?: ConvertApproveHubSpotStatus;
      message?: string;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_allowed'
        | ConvertApproveRejectReason
        | 'conversion_failed'
        | 'unexpected_error';
      message?: string;
    };

/** Maps the canonical action's hubspot.action onto the wrapper vocabulary. */
function mapHubSpotStatus(
  action:
    | 'created'
    | 'linked_existing'
    | 'skipped_possible_match'
    | 'skipped_not_configured'
    | 'failed'
    | 'not_required',
): ConvertApproveHubSpotStatus {
  switch (action) {
    case 'created':
      return 'created';
    case 'linked_existing':
      return 'linked_existing';
    case 'skipped_not_configured':
      return 'skipped_not_configured';
    case 'skipped_possible_match':
      return 'skipped_possible_match';
    case 'failed':
      return 'failed_create';
    default:
      return 'unknown';
  }
}

/**
 * Approves a single clean-production candidate from the Prospectos surface AND
 * converts it to a SellUp account (best-effort HubSpot). Admin only. Validates
 * the Prospectos eligibility contract before DELEGATING the conversion to the
 * canonical `approveAndConvertCandidateAction`. All failure modes resolve to a
 * typed result — the UI renders a friendly message instead of crashing.
 */
export async function approveAndConvertPendingReviewCandidateAction(
  candidateId: string,
  options: ApproveAndConvertActionOptions = {},
): Promise<ApproveAndConvertActionResult> {
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
    //    re-validates everything itself; this is only the Prospectos gate.
    const supabase = await createClient();
    const { data: current, error } = await supabase
      .from('prospect_candidates')
      .select(
        'id, status, record_origin, duplicate_status, converted_account_id, matched_hubspot_company_id',
      )
      .eq('id', candidateId)
      .maybeSingle();

    if (error) {
      console.error('[prospect-review] approve+convert: candidate read failed:', error);
      return { ok: false, reason: 'unexpected_error' };
    }
    if (!current) return { ok: false, reason: 'not_found' };

    // 4. Evaluate the pure Prospectos eligibility policy.
    const decision = evaluateConvertApproveEligibility(
      {
        status: current.status,
        recordOrigin: current.record_origin,
        duplicateStatus: current.duplicate_status,
        convertedAccountId: current.converted_account_id,
        matchedHubspotCompanyId: current.matched_hubspot_company_id,
      },
      {
        confirmPossibleDuplicate: options.confirmPossibleDuplicate,
        confirmHubSpotMatch: options.confirmHubSpotMatch,
      },
    );

    if (decision.decision === 'idempotent') {
      revalidatePath(ACCOUNTS_PATH);
      revalidatePath(REVIEW_QUEUE_PATH);
      return {
        ok: true,
        status: 'idempotent_success',
        accountId: decision.accountId,
        hubSpotStatus: 'unknown',
        message: 'Este prospecto ya estaba convertido en empresa.',
      };
    }
    if (decision.decision === 'reject') {
      return { ok: false, reason: decision.reason };
    }

    // 5. Delegate the conversion to the canonical action. This is the SINGLE
    //    source of truth for account creation + HubSpot best-effort + audit +
    //    idempotency. The wrapper adds no parallel write.
    const result = await approveAndConvertCandidateAction(candidateId);

    if (!result.success) {
      // The canonical action already logged detail; surface a safe generic
      // conversion failure (covers concurrency conflict, account insert error,
      // and any duplicate/readiness block the canonical action re-checks).
      return { ok: false, reason: 'conversion_failed', message: result.message };
    }

    revalidatePath(ACCOUNTS_PATH);
    revalidatePath(REVIEW_QUEUE_PATH);

    // The canonical action reports its two idempotent early-returns with
    // hubspot.action === 'not_required' (already converted / concurrency race).
    // A genuinely-fresh conversion always reports a concrete HubSpot action.
    if (result.hubspot.action === 'not_required') {
      return {
        ok: true,
        status: 'idempotent_success',
        accountId: result.sellup.account_id,
        hubSpotStatus: 'unknown',
        message: result.message,
      };
    }

    return {
      ok: true,
      status: 'converted_to_account',
      accountId: result.sellup.account_id,
      hubSpotStatus: mapHubSpotStatus(result.hubspot.action),
      message: result.message,
    };
  } catch (err) {
    // Detailed context stays server-side; the UI gets a safe generic result.
    console.error('[prospect-review] approve+convert action failed:', err);
    return { ok: false, reason: 'unexpected_error' };
  }
}
