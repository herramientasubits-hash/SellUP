'use server';

// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — "Enviar a revisión" server action.
//
// Thin wrapper: resolves auth/admin/scope, injects the session Supabase
// client into `send-to-review-core.ts`, and performs the side effects
// (audit log, path revalidation) the core intentionally does not do itself.
// All the actual read/write orchestration — including the claim-then-create
// idempotency guarantee — lives in send-to-review-core.ts, where it is
// unit-tested directly against an injected fake client.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { resolveCommercialScope } from '@/modules/access/commercial-scope';
import { isCommercialScopeEnabled } from '@/lib/feature-flags.server';
import {
  requireActiveUser,
  logProspectCandidateAudit,
} from '@/modules/prospect-batches/actions';
import {
  sendCandidateToReviewCore,
  sendDispositionToReviewCore,
  type SendToReviewCoreOutcome,
} from './send-to-review-core';
import type { SendToReviewRejectReason } from './send-to-review-eligibility';

const ACCOUNTS_PATH = '/accounts';

export type SendToReviewActionResult =
  | { ok: true; status: 'sent_to_review' | 'idempotent_success'; candidateId: string }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_allowed'
        | 'out_of_scope'
        | SendToReviewRejectReason
        | 'write_failed'
        | 'unexpected_error';
      message?: string;
    };

/** Server-side scope guard shared by both branches. Never trusts the client. */
async function isBatchInScope(batchId: string): Promise<boolean> {
  if (!isCommercialScopeEnabled()) return true;
  const scope = await resolveCommercialScope();
  if (!scope) return false;
  if (scope.canViewAll) return true;

  const supabase = await createClient();
  const { data: batch } = await supabase
    .from('prospect_batches')
    .select('owner_id, created_by')
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) return false;

  const allowed = new Set(scope.allowedUserIds);
  const ownerInScope = batch.owner_id != null && allowed.has(batch.owner_id as string);
  const creatorInScope = batch.created_by != null && allowed.has(batch.created_by as string);
  return ownerInScope || creatorInScope;
}

async function toActionResult(
  outcome: SendToReviewCoreOutcome,
  actorUserId: string,
): Promise<SendToReviewActionResult> {
  switch (outcome.outcome) {
    case 'sent': {
      try {
        await logProspectCandidateAudit({
          batchId: outcome.batchId,
          candidateId: outcome.candidateId,
          actorUserId,
          actionType: 'candidate_sent_to_review',
          details: outcome.auditDetails,
        });
      } catch (auditErr) {
        console.warn('[prospect-discards] audit log failed (non-critical):', auditErr);
      }
      revalidatePath(ACCOUNTS_PATH);
      return { ok: true, status: 'sent_to_review', candidateId: outcome.candidateId };
    }
    case 'idempotent':
      return { ok: true, status: 'idempotent_success', candidateId: outcome.candidateId };
    case 'not_found':
      return { ok: false, reason: 'not_found' };
    case 'out_of_scope':
      return { ok: false, reason: 'out_of_scope' };
    case 'reject':
      return { ok: false, reason: outcome.reason };
    case 'write_failed':
      return { ok: false, reason: 'write_failed', message: outcome.message };
  }
}

/**
 * Sends one discarded item (candidate row OR disposition row) back to
 * `needs_review`. `itemId` is the composite id from `DiscardedProspectItem`
 * (`disposition:<id>` or `candidate:<id>`). Admin gate mirrors the existing
 * `prospect-review` discard/approve wrappers — this is the same class of
 * sensitive override.
 */
export async function sendDiscardedProspectToReviewAction(
  itemId: string,
): Promise<SendToReviewActionResult> {
  try {
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) return { ok: false, reason: 'not_allowed' };

    const { internalUserId } = await requireActiveUser();

    const [source, id] = itemId.split(':', 2) as [string | undefined, string | undefined];
    if (!id || (source !== 'disposition' && source !== 'candidate')) {
      return { ok: false, reason: 'not_found' };
    }

    const supabase = await createClient();
    const deps = { supabase, actorUserId: internalUserId, isBatchInScope };

    const outcome =
      source === 'candidate'
        ? await sendCandidateToReviewCore(deps, id)
        : await sendDispositionToReviewCore(deps, id);

    return await toActionResult(outcome, internalUserId);
  } catch (err) {
    console.error('[prospect-discards] send-to-review action failed:', err);
    return { ok: false, reason: 'unexpected_error' };
  }
}
