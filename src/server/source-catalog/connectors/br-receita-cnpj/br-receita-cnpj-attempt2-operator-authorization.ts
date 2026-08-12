/**
 * BR Receita CNPJ — ATTEMPT #2 PROCESS-SCOPED OPERATOR AUTHORIZATION (BR-SOURCE-ATTEMPT2-OPS § 2–§ 4,
 * § 13).
 *
 * The hard stop this module exists to remove is a shape problem, not a permission problem. Attempt #2
 * was authorized by the owner and could not be executed, because the ONLY way for the three approvals
 * a real run needs to arrive as `true` was for someone to edit tracked source:
 * `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED = false as const`, plus a CLI that read all three
 * of `temporaryStoragePolicyApproved`, `capInputPolicyApproved` and `benchmarkAuthorization` out of that
 * single constant. An owner decision that is only expressible as a source edit is an owner decision that
 * outlives the invocation it was made for, and one constant standing in for three approvals is the exact
 * inference § 6 of 14B.0F forbids.
 *
 * This module is the other representation: three SEPARATE approvals, each `false` by default, each set
 * to `true` only by its own explicit flag on one invocation, and none of them derived from another or
 * from a constant.
 *
 * ── Invocation-scoped, and that is structural ───────────────────────────────────
 * The grant is a value returned from parsing `argv`. It is not written anywhere, not cached, not stored
 * in a module-level binding, and not read back from a constant. When the process exits the grant is
 * gone, so the next invocation starts from the frozen all-`false` default and a run with no flags is
 * refused — see `BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_LIFETIME`.
 *
 * ── No environment variable, ever (§ 2) ─────────────────────────────────────────
 * A persistent env var would be precisely the silent bypass this module replaces: exported once in a
 * shell profile, it authorizes every future run of every future shape without anybody deciding to. There
 * is no `process.env` reference in this file, so "the grant cannot come from ambient state" is a property
 * of the file rather than a promise about it.
 *
 * ── Generic override flags are refused by name (§ 3) ────────────────────────────
 * `--force`, `--unsafe`, `--bypass` and `--yes` mean "whatever the code was about to refuse, do it
 * anyway", which is a different and much larger permission than any of the three approvals. They are
 * refused rather than ignored: an operator who typed one believes they granted something, and silently
 * dropping it would let them think a refused run had been authorized.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`, `node:child_process`, or any I/O module. It reads a string array.
 *   - reads an environment variable, or any ambient state.
 *   - persists, caches or memoizes a grant.
 *   - defaults an approval to `true`, or derives one approval from another.
 *   - flips, reads or reports `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED`. It is a SECOND,
 *     independent way for an approval to arrive — never a replacement for the tracked constant, and
 *     never a way to change it.
 *   - authorizes an attempt NUMBER. Which attempt this is, and whether the ledger admits it, is the
 *     attempt ledger's question and this module has no opinion on it.
 *   - touches Supabase, a migration, the runtime, Agent 1, a provider, HubSpot or the UI.
 */

// ─── The three approvals ──────────────────────────────────────────────────────

/**
 * The three approvals a real full-scan benchmark needs, as separate keys.
 *
 * Three, not one, and the split is load-bearing: the owner approving that a second real attempt may run
 * is a different decision from approving where four gigabytes of temporary partition data may live, which
 * is a different decision again from approving the proposed cap profile as the input to the run. Merging
 * any two would mean an operator who answered one question had answered another they were never asked.
 */
export const BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_KEYS = [
  'ownerAuthorization',
  'temporaryStoragePolicyApproved',
  'capInputPolicyApproved',
] as const;

export type BrazilReceitaAttempt2OperatorApprovalKey =
  (typeof BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_KEYS)[number];

/**
 * The flag that grants each approval. Verbose and specific, per § 3.
 *
 * `--second-real-attempt-owner-authorized` already existed at the CLI (BR-SOURCE-14B.0J § 12) as the
 * "who approved a second one" declaration, so it is REUSED rather than duplicated: a second flag meaning
 * the same thing would be a second place for an operator to be told they had declared something.
 */
export const BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS: Readonly<
  Record<BrazilReceitaAttempt2OperatorApprovalKey, string>
> = Object.freeze({
  ownerAuthorization: '--second-real-attempt-owner-authorized',
  temporaryStoragePolicyApproved: '--temporary-storage-policy-approved',
  capInputPolicyApproved: '--cap-input-policy-approved',
});

/**
 * Flags that would mean "override whatever was about to be refused". Refused by name (§ 3).
 *
 * None of them maps to a policy declaration, and that is the point: every approval here names the exact
 * thing it approves, so a report can say which decision was made. `--yes` names nothing.
 */
export const BRAZIL_RECEITA_ATTEMPT_2_FORBIDDEN_GENERIC_FLAGS: readonly string[] = Object.freeze([
  '--force',
  '--unsafe',
  '--bypass',
  '--yes',
]);

/** How long a grant lasts. One invocation, and there is no code path that could extend it. */
export const BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_LIFETIME = 'invocation_scoped' as const;

/** Whether a grant survives the process. It does not, and nothing here could make it. */
export const BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_PERSISTED = false as const;

/**
 * Whether representing a grant requires editing tracked source. It does not — that is the milestone.
 *
 * Descriptive, like 14B.0K's `EXPECTED_INVENTORY_KNOWN`: it records what the code now supports and grants
 * nothing. A run with no flags is still refused whatever this line says.
 */
export const BRAZIL_RECEITA_ATTEMPT_2_TRACKED_SOURCE_FLIP_REQUIRED = false as const;

// ─── The grant ────────────────────────────────────────────────────────────────

/**
 * One invocation's approvals.
 *
 * Three booleans rather than a status enum, because an enum would need a member for every combination
 * and a caller would then be tempted to test the "close enough" ones. With three fields, a missing
 * approval is a missing approval.
 */
export interface BrazilReceitaAttempt2OperatorAuthorization {
  /** The owner approving that a second real attempt may run. */
  readonly ownerAuthorization: boolean;
  /** GATE-2's temporary-storage policy approval. Separate decision, separately stated. */
  readonly temporaryStoragePolicyApproved: boolean;
  /** The CAP-input policy approval. Separate decision, separately stated. */
  readonly capInputPolicyApproved: boolean;
}

/**
 * The standing grant: nothing approved.
 *
 * Frozen and exported so a caller that has no grant can name the absence rather than construct an object
 * whose fields it might get wrong. It is the value every invocation starts from.
 */
export const BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT: BrazilReceitaAttempt2OperatorAuthorization =
  Object.freeze({
    ownerAuthorization: false,
    temporaryStoragePolicyApproved: false,
    capInputPolicyApproved: false,
  });

// ─── Resolution ───────────────────────────────────────────────────────────────

/** Why an invocation's approval declarations could not be read at all. */
export const BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_REFUSALS = [
  'generic_override_flag_not_supported',
] as const;

export type BrazilReceitaAttempt2OperatorAuthorizationRefusal =
  (typeof BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_REFUSALS)[number];

export type BrazilReceitaAttempt2OperatorAuthorizationResolution =
  | {
      readonly ok: true;
      readonly authorization: BrazilReceitaAttempt2OperatorAuthorization;
    }
  | {
      readonly ok: false;
      readonly refusal: BrazilReceitaAttempt2OperatorAuthorizationRefusal;
      /** The all-`false` default. A refusal never yields a partial grant. */
      readonly authorization: BrazilReceitaAttempt2OperatorAuthorization;
    };

/**
 * Reads the three approvals off ONE invocation's argv.
 *
 * Presence of the exact flag is the whole test: there is no value to parse, so there is no `'false'`, no
 * `'0'` and no empty string that could be read as truthy. An absent flag is `false`, which is the same
 * answer a caller gets for an empty argv.
 *
 * A generic override flag refuses the WHOLE resolution rather than one approval, and returns the default
 * grant: an invocation that tried to override something is not an invocation whose other declarations
 * should be honoured.
 */
export function resolveBrazilReceitaAttempt2OperatorAuthorization(
  argv: readonly string[],
): BrazilReceitaAttempt2OperatorAuthorizationResolution {
  const args = Array.isArray(argv) ? argv : [];

  for (const generic of BRAZIL_RECEITA_ATTEMPT_2_FORBIDDEN_GENERIC_FLAGS) {
    if (args.includes(generic)) {
      return {
        ok: false,
        refusal: 'generic_override_flag_not_supported',
        authorization: BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
      };
    }
  }

  return {
    ok: true,
    authorization: {
      ownerAuthorization: args.includes(
        BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS.ownerAuthorization,
      ),
      temporaryStoragePolicyApproved: args.includes(
        BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS.temporaryStoragePolicyApproved,
      ),
      capInputPolicyApproved: args.includes(
        BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS.capInputPolicyApproved,
      ),
    },
  };
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Every approval that is not the literal `true`, in declaration order.
 *
 * All of them rather than the first, so an operator assembling a three-flag invocation learns the whole
 * gap in one refusal. `!== true` rather than falsy: a `1`, a `'true'` or an object are not approvals, and
 * a truthiness test is how a value nobody intended becomes one.
 */
export function findBrazilReceitaAttempt2MissingOperatorApprovals(
  authorization: BrazilReceitaAttempt2OperatorAuthorization | null | undefined,
): readonly BrazilReceitaAttempt2OperatorApprovalKey[] {
  if (authorization === null || typeof authorization !== 'object') {
    return [...BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_KEYS];
  }
  const record = authorization as unknown as Record<string, unknown>;
  return BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_KEYS.filter((key) => record[key] !== true);
}

/**
 * Whether this invocation carries a COMPLETE operator grant.
 *
 * All three, and an AND rather than an OR: § 4's precondition list is a conjunction, and two approvals
 * out of three is not a smaller authorization — it is an unanswered question about the third.
 */
export function brazilReceitaAttempt2OperatorAuthorizationGranted(
  authorization: BrazilReceitaAttempt2OperatorAuthorization | null | undefined,
): boolean {
  return findBrazilReceitaAttempt2MissingOperatorApprovals(authorization).length === 0;
}

// ─── Reportable standing ──────────────────────────────────────────────────────

export interface BrazilReceitaAttempt2OperatorAuthorizationStanding {
  readonly processScopedAuthorizationReady: true;
  readonly trackedSourceAuthorizationFlipRequired: typeof BRAZIL_RECEITA_ATTEMPT_2_TRACKED_SOURCE_FLIP_REQUIRED;
  readonly approvalKeys: readonly BrazilReceitaAttempt2OperatorApprovalKey[];
  readonly approvalFlags: Readonly<Record<BrazilReceitaAttempt2OperatorApprovalKey, string>>;
  readonly allThreeRequired: true;
  readonly defaults: BrazilReceitaAttempt2OperatorAuthorization;
  readonly lifetime: typeof BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_LIFETIME;
  readonly persisted: typeof BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_PERSISTED;
  readonly forbiddenGenericFlags: readonly string[];
}

/**
 * The mechanism's standing, as data.
 *
 * `processScopedAuthorizationReady: true` alongside `defaults` that are all `false` is the pair worth
 * reporting together: the representation exists, and nothing is approved. A reader who sees only the
 * first would read readiness as permission, which is the confusion every gate in this connector is
 * built to prevent.
 */
export function summarizeBrazilReceitaAttempt2OperatorAuthorization(): BrazilReceitaAttempt2OperatorAuthorizationStanding {
  return {
    processScopedAuthorizationReady: true,
    trackedSourceAuthorizationFlipRequired: BRAZIL_RECEITA_ATTEMPT_2_TRACKED_SOURCE_FLIP_REQUIRED,
    approvalKeys: BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_KEYS,
    approvalFlags: BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_APPROVAL_FLAGS,
    allThreeRequired: true,
    defaults: BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
    lifetime: BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_LIFETIME,
    persisted: BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_PERSISTED,
    forbiddenGenericFlags: BRAZIL_RECEITA_ATTEMPT_2_FORBIDDEN_GENERIC_FLAGS,
  };
}
