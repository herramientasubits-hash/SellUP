/**
 * BR Receita CNPJ — INVOCATION-SCOPED TEMPORARY-STORAGE APPROVAL (BR-SOURCE-ATTEMPT2-FINAL § 2–§ 6).
 *
 * The engine keeps its own temporary-storage wall, and that wall did not know how to read the only
 * authorization an operator can actually express.
 *
 * BR-SOURCE-ATTEMPT2-OPS made an owner decision representable per invocation: three separate approvals,
 * each `false` unless its own explicit flag was passed, none of them persisted anywhere. The benchmark's
 * `authorization` stage learned to accept that grant. The ENGINE's second wall did not — it consulted
 * `BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED`, a tracked `false as const`, and nothing
 * else. A fully-authorized attempt therefore refused at `before_first_read` with
 * `temporary_storage_policy_not_approved`, having read zero bytes: the wall was not wrong, it was deaf.
 *
 * This module is the ear. It mints a single opaque value that MEANS "this invocation's operator grant
 * approved temporary storage", and the workspace accepts that value as an alternative to the tracked
 * constant. Both walls remain: the benchmark still requires a complete grant at its authorization stage,
 * and the workspace still refuses a real run that carries neither the constant nor this approval.
 *
 * ── Why a minted VALUE and not a boolean ────────────────────────────────────────
 * A `temporaryStoragePolicyApproved: boolean` threaded through the engine request would be a parameter
 * any caller could set, which is the shape of a bypass rather than of an authorization. The approval
 * here is branded with a symbol this module does not export, so the only way to hold one is to have
 * called `mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval` with a COMPLETE operator grant
 * whose own `temporaryStoragePolicyApproved` flag was passed. A hand-built object literal does not type-
 * check, and a `JSON.parse` of one does not carry the symbol.
 *
 * ── Invocation-scoped, structurally ─────────────────────────────────────────────
 * The mint is a pure function of its argument and the result is returned, never stored: there is no
 * module-level binding holding an approval, no cache keyed by anything, and no way to ask this module
 * whether an approval was minted earlier. When the process exits the value is gone, so the next
 * invocation starts from "no approval" and a run with no flags is refused by the workspace exactly as it
 * was before this module existed.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`, `node:process`, or any I/O module. It reads one object's three booleans.
 *   - reads an environment variable, or any ambient state.
 *   - persists, caches or memoizes an approval.
 *   - reads, reports or flips `BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED`. That
 *     constant is the OTHER wall's, it is still `false`, and this module is an alternative to it rather
 *     than a way to change it.
 *   - derives the temporary-storage approval from `ownerAuthorization` or `capInputPolicyApproved`. All
 *     three are required, and the one this module is about must be stated on its own.
 *   - touches Supabase, a migration, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

import {
  brazilReceitaAttempt2OperatorAuthorizationGranted,
  type BrazilReceitaAttempt2OperatorAuthorization,
} from './br-receita-cnpj-attempt2-operator-authorization';

// ─── The brand ────────────────────────────────────────────────────────────────

/**
 * The private brand. NOT exported, and that omission is the whole enforcement mechanism.
 *
 * A `unique symbol` known only inside this module means an approval cannot be constructed elsewhere:
 * TypeScript refuses an object literal missing the key, and no runtime value carries the symbol unless
 * it came from the mint below.
 */
const BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_BRAND = Symbol(
  'br-receita-cnpj-full-join-invocation-temporary-storage-approval',
);

/** How long a minted approval lasts. One invocation, and nothing here could extend it. */
export const BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_LIFETIME = 'invocation_scoped' as const;

/** Whether a minted approval survives the process. It does not. */
export const BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_PERSISTED = false as const;

/**
 * One invocation's temporary-storage approval.
 *
 * Deliberately contentless beyond its provenance: it is not a capability object, it cannot widen a cap,
 * choose a destination or extend a lifetime. It answers exactly one question — "did THIS invocation's
 * operator grant approve temporary storage?" — and the workspace asks it exactly once.
 */
export interface BrazilReceitaFullJoinInvocationTemporaryStorageApproval {
  readonly [BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_BRAND]: true;
  readonly lifetime: typeof BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_LIFETIME;
  /** Where the approval came from. One member today, and a second would need its own mint. */
  readonly grantedBy: 'operator_grant';
}

// ─── Minting ──────────────────────────────────────────────────────────────────

/**
 * Mints an approval from ONE invocation's operator grant, or refuses with `null`.
 *
 * Two conditions, both required and neither inferred from the other:
 *
 *   1. `temporaryStoragePolicyApproved` is the literal `true`. This is the approval being minted, and it
 *      has its own flag; a truthy `1` or `'true'` is not an owner decision.
 *   2. The grant is COMPLETE. Not because temporary storage implies the other two — it does not, and
 *      § 5 forbids collapsing them — but because an approval minted from a partial grant would be an
 *      approval that outran the invocation it belongs to. The benchmark's authorization stage already
 *      requires all three; this makes the engine's wall no weaker than the one in front of it.
 *
 * `null` rather than a throw: a caller with no grant is the ordinary case, and the workspace's refusal is
 * where that fact is supposed to become a terminal code.
 */
export function mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(
  authorization: BrazilReceitaAttempt2OperatorAuthorization | null | undefined,
): BrazilReceitaFullJoinInvocationTemporaryStorageApproval | null {
  if (authorization === null || authorization === undefined || typeof authorization !== 'object') {
    return null;
  }
  const record = authorization as unknown as Record<string, unknown>;
  if (record.temporaryStoragePolicyApproved !== true) return null;
  if (!brazilReceitaAttempt2OperatorAuthorizationGranted(authorization)) return null;

  return Object.freeze({
    [BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_BRAND]: true,
    lifetime: BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_LIFETIME,
    grantedBy: 'operator_grant',
  } as const);
}

/**
 * Whether a value IS a minted approval.
 *
 * The brand check is the whole test, and it runs against `unknown` on purpose: the workspace receives
 * this through a request field, and a request is data. An object shaped like the interface but built
 * anywhere else fails here, which is what makes the type-level guarantee hold at runtime too.
 */
export function brazilReceitaFullJoinInvocationTemporaryStorageApprovalPresent(
  approval: unknown,
): approval is BrazilReceitaFullJoinInvocationTemporaryStorageApproval {
  if (approval === null || typeof approval !== 'object') return false;
  return (
    (approval as Record<symbol, unknown>)[
      BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_BRAND
    ] === true
  );
}
