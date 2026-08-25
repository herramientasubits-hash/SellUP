/**
 * BR-SOURCE CUT D — transport for the fenced fiscal-identity PROMOTION.
 *
 * The sibling of `batch-identity-fence.ts`, for the operation that file does not
 * cover. Migration 126 fences the INSERT of a candidate; nothing fenced the
 * ADDITION of a fiscal identity to a row that already exists, which is exactly
 * what CUT C's report calls out:
 *
 *     DURABLE_TAX_ID_SAFE_PATH = NOT_FOUND
 *
 * ── What this module is ─────────────────────────────────────────────────────
 *
 * TRANSPORT. It does not decide identity. It does not know what TIER 0 is, what
 * a canonical fiscal identifier is, or what a domain is. It marshals one call and
 * types one answer. The identity policy stays whole and uncopied in
 * `fiscal-identity.ts`, `company-identity-evidence.ts` and
 * `batch-identity-registry.ts`; the decision loop that consults them lives in
 * `run-fenced-identity-promotion.ts`.
 *
 * ── 🔴 Why this does not reuse `isMissingFenceCapabilityError` ──────────────
 *
 * That predicate names the two RPCs of migration 126 in its message branch. It is
 * load-bearing for a security decision (it is what may authorize the pre-B4 write
 * path), so widening it to also match a third function name would enlarge what a
 * message can prove for callers that have nothing to do with this cut. A local
 * predicate with the SAME two SQLSTATE codes and only THIS function's name is
 * narrower and cannot affect them.
 *
 * ── 🔴 Privacy (§ 6) ────────────────────────────────────────────────────────
 *
 * A CNPJ travels IN, as `taxIdentifier`, on its way to its authorized column. No
 * result shape here has a field that can carry one back out — a conflict reports
 * a CATEGORY, never the colliding identifier — and no driver message is ever
 * forwarded, because a PostgREST error body can quote the filter it failed on and
 * this call's arguments include the identifier.
 *
 * Never throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** The fenced promotion of the local (still unnumbered) CUT D migration. */
export const PROMOTE_FISCAL_IDENTITY_RPC = 'promote_candidate_fiscal_identity_fenced';

/** Why the database refused to adjudicate. A CATEGORY, always safe to log. */
export type FiscalIdentityConflictReason =
  /** The candidate row already stores a DIFFERENT fiscal identifier. */
  | 'candidate_holds_other_identity'
  /** Another occupying candidate of the same batch already stores this one. */
  | 'batch_peer_holds_identity'
  /** The database reported a conflict category this client does not know. */
  | 'unknown_conflict';

export type FencedIdentityPromotionRpcResult =
  | { status: 'promoted'; previousEpoch: number; nextEpoch: number }
  /** The row already stores exactly this identifier. ZERO writes, epoch intact. */
  | { status: 'already_same_identity'; currentEpoch: number }
  | { status: 'fiscal_identity_conflict'; conflict: FiscalIdentityConflictReason }
  /** Expected epoch != current. ZERO writes, epoch intact. Normal concurrency. */
  | { status: 'stale'; currentEpoch: number }
  /** No such candidate IN THIS BATCH — the pair is the IDOR guard, not the id alone. */
  | { status: 'candidate_not_found' }
  | { status: 'batch_not_found' }
  | { status: 'invalid_input' }
  /** The CUT D migration is not applied. See the compatibility note in the SQL. */
  | { status: 'capability_absent' }
  /** A REAL failure. The transaction reverted: no row change, no epoch advance. */
  | { status: 'promotion_failed'; code: string };

/**
 * Does this error mean "that function does not exist yet"?
 *
 * Two shapes because there are two layers: PostgREST answers `PGRST202` when the
 * function is absent from its schema cache, PostgreSQL answers `42883` when the
 * call reaches the engine. Anything else is a REAL failure and must never be
 * degraded into "the migration is not applied".
 */
export function isMissingPromotionCapabilityError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === '42883' || code === 'PGRST202') return true;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  return (
    lower.includes(PROMOTE_FISCAL_IDENTITY_RPC) &&
    (lower.includes('does not exist') ||
      lower.includes('could not find') ||
      lower.includes('schema cache'))
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Reads a `bigint` the way PostgREST actually serializes it.
 *
 * It arrives as a STRING. Reading it only as a number left the epoch `null` and
 * turned every successful call into an unreadable answer — the same defect
 * `batch-identity-fence.ts` had to fix, reproduced here rather than imported so
 * neither file has to know about the other.
 */
function readFiniteInteger(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readConflict(record: Record<string, unknown>): FiscalIdentityConflictReason {
  const raw = record['conflict'];
  return raw === 'candidate_holds_other_identity' || raw === 'batch_peer_holds_identity'
    ? raw
    : 'unknown_conflict';
}

/** Translates the RPC's `jsonb` into the typed result. Never throws. */
export function parseFencedIdentityPromotionPayload(
  payload: unknown,
): FencedIdentityPromotionRpcResult {
  const record = asRecord(payload);
  if (!record) return { status: 'promotion_failed', code: 'promotion_unreadable_payload' };

  switch (record['status']) {
    case 'promoted': {
      const previousEpoch = readFiniteInteger(record, 'previous_epoch');
      const nextEpoch = readFiniteInteger(record, 'next_epoch');
      if (previousEpoch === null || nextEpoch === null) {
        return { status: 'promotion_failed', code: 'promotion_unreadable_epoch' };
      }
      return { status: 'promoted', previousEpoch, nextEpoch };
    }
    case 'already_same_identity': {
      const currentEpoch = readFiniteInteger(record, 'current_epoch');
      if (currentEpoch === null) {
        return { status: 'promotion_failed', code: 'promotion_unreadable_epoch' };
      }
      return { status: 'already_same_identity', currentEpoch };
    }
    case 'fiscal_identity_conflict':
      return { status: 'fiscal_identity_conflict', conflict: readConflict(record) };
    case 'stale': {
      const currentEpoch = readFiniteInteger(record, 'current_epoch');
      if (currentEpoch === null) {
        return { status: 'promotion_failed', code: 'promotion_unreadable_epoch' };
      }
      return { status: 'stale', currentEpoch };
    }
    case 'candidate_not_found':
      return { status: 'candidate_not_found' };
    case 'batch_not_found':
      return { status: 'batch_not_found' };
    case 'invalid_input':
      return { status: 'invalid_input' };
    default:
      return { status: 'promotion_failed', code: 'promotion_unknown_status' };
  }
}

export type FencedIdentityPromotionArgs = {
  batchId: string;
  candidateId: string;
  expectedEpoch: number;
  /**
   * The exact value to persist into `tax_identifier`.
   *
   * 🔴 Already canonical when it gets here — for Brazil, the 14-digit form
   * `normalizeBrazilCnpj` produced. This module does not normalize it, and must
   * not: normalization is the identity authority's job and a second one here
   * would be a second authority.
   */
  taxIdentifier: string;
  /**
   * The recomputed `identity_key`, from `buildProspectCandidateIdentityKey`.
   * MANDATORY — the SQL refuses a promotion without one, because a changed
   * identifier with an unchanged key is one of the defects this cut closes.
   */
  identityKey: string;
  /** The admission vocabulary. Travels as a parameter; it is never written in SQL. */
  blockingStatuses: ReadonlyArray<string>;
};

/**
 * Promotes a resolved fiscal identity onto ONE candidate, DECLARING which epoch
 * the decision was taken against.
 *
 * All the real work — epoch comparison, batch-scoped lookup, peer backstop,
 * update, epoch advance — happens inside ONE transaction in the database. This
 * function transports and types.
 */
export async function promoteCandidateFiscalIdentityFenced(
  client: SupabaseClient,
  args: FencedIdentityPromotionArgs,
): Promise<FencedIdentityPromotionRpcResult> {
  if (typeof (client as { rpc?: unknown }).rpc !== 'function') {
    // 🔴 The SHAPE of a client says nothing about the schema. A client without
    // `.rpc` is a double or an unsupported client, never proof that the migration
    // is missing — the exact confusion CUT-3B4's correction had to undo. Fail
    // closed as a real failure, not as `capability_absent`.
    return { status: 'promotion_failed', code: 'promotion_client_without_rpc' };
  }

  try {
    const { data, error } = await client.rpc(PROMOTE_FISCAL_IDENTITY_RPC, {
      p_batch_id: args.batchId,
      p_candidate_id: args.candidateId,
      p_expected_epoch: args.expectedEpoch,
      p_tax_identifier: args.taxIdentifier,
      p_identity_key: args.identityKey,
      p_blocking_statuses: [...args.blockingStatuses],
    });

    if (error) {
      if (isMissingPromotionCapabilityError(error)) return { status: 'capability_absent' };
      // 🔴 The CODE only. A driver message on this path can quote the arguments,
      // and one of them is a CNPJ.
      return {
        status: 'promotion_failed',
        code:
          typeof error.code === 'string' && error.code.length > 0
            ? error.code
            : 'promotion_rpc_error',
      };
    }

    return parseFencedIdentityPromotionPayload(data);
  } catch (err) {
    if (isMissingPromotionCapabilityError(err)) return { status: 'capability_absent' };
    return { status: 'promotion_failed', code: 'promotion_rpc_threw' };
  }
}
