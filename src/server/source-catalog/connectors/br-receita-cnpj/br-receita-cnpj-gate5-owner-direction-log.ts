/**
 * BR Receita CNPJ — the GATE-5 OWNER-DIRECTION DECISION LOG (BR-SOURCE-FAST-TRACK-6).
 *
 * Three collisions, two supersessions and two output-key renames. This is the audit trail of how the
 * GATE-5 output contract reached the values it now holds — kept as its own module because it answers a
 * different question from the contract itself.
 *
 *   the contract  — "what may an output carry?"
 *   this log      — "who changed which value, in which direction, and what did NOT move?"
 *
 * ── 🔴 Why nothing here is ever deleted ──────────────────────────────────────
 *
 * A resolved collision is the moment an invariant is most likely to be quietly relaxed, and a deleted
 * collision is one nobody can audit. So every entry survives its own resolution, and every entry
 * carries `weakenedByThisRound` and `invariantMovedToAccommodateIt` alongside `resolvedByThisRound` —
 * the pairing is what lets a later reader see which of the two sides actually moved.
 *
 * In all three cases the side that moved was the OWNER DIRECTION. BR-SOURCE-11A's numeric-leaf
 * ceiling, its digit-run rules and § 5.2 group 7 are all untouched.
 *
 * ── This module NEVER ────────────────────────────────────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - approves a gate. GATE-5's status lives in the recorded record, and it is not `approved`.
 *   - records a HUMAN privacy, legal, test or operator approval. Every entry here is project
 *     technical/product direction, and `isAHumanPrivacyApproval` says so per supersession.
 *   - carries a literal CNPJ, CNPJ básico, CPF, personal name, address, contact value or real path.
 */

/**
 * The three collisions Round 3's owner values created with invariants that already existed. Kept
 * verbatim, and each now carrying its RESOLUTION.
 *
 * 🔴 `resolvedByThisRound` reads `true` for all three, and `weakenedByThisRound` still reads `false`
 * for all three. That pairing is the whole point: every one was closed by superseding the OWNER
 * DIRECTION, never by relaxing the invariant it collided with. A reader who sees a resolved
 * collision should be able to check, from this data alone, which of the two sides moved.
 */
export const BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS = [
  {
    id: 'OD-C1',
    ownerDirection: 'TOTAL_ROWS_SCANNED = ALLOWED',
    collidesWith: 'BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF',
    owningModule: 'br-receita-cnpj-full-join-output-sanitizer (BR-SOURCE-11A)',
    detail:
      'the 11A sanitizer rejects any numeric leaf beyond 9,999,999 as oversized_numeric_value; a national row total exceeds it',
    resolvedByThisRound: true,
    weakenedByThisRound: false,
    ownerChoice:
      'report total_rows_scanned as a bucket, OR record an explicit named-key carve-out from the numeric ceiling',
    resolution:
      'NEITHER — the owner direction itself was superseded: total_rows_scanned is an INTERNAL_EXECUTION_COUNTER_ONLY and is emitted on no surface, so the 11A numeric ceiling never sees it and needs no carve-out',
    invariantMovedToAccommodateIt: null,
  },
  {
    id: 'OD-C2',
    ownerDirection: 'TOTAL_ROWS_SCANNED = ALLOWED',
    collidesWith: 'VP-1 and VP-4',
    owningModule: 'this contract, § 5.3 of BR-SOURCE-10O',
    detail:
      'an exact national row total rendered onto the JSON surface is a digit run the digit-run rules reject; the rendered-output check sees the rendered form, not the integer',
    resolvedByThisRound: true,
    weakenedByThisRound: false,
    ownerChoice:
      'report total_rows_scanned as a bucket, OR record an explicit named-key carve-out from the digit-run rules on the rendered surface',
    resolution:
      'NEITHER — a counter that reaches no surface is never rendered, so VP-1 and VP-4 keep their exact frozen wording and the rendered-output check keeps its exact behaviour',
    invariantMovedToAccommodateIt: null,
  },
  {
    id: 'OD-C3',
    ownerDirection: 'the § 7 residual bucket label is other_or_suppressed_small_cell',
    collidesWith: 'the § 5.2 closed denylist, group 7',
    owningModule: 'this contract — 10O § 7 names the label, 10O § 5.2 group 7 forbids the substring',
    detail:
      "group 7 substring-matches `cell`, and the mandated residual label contains it; the one label small-cell suppression is REQUIRED to emit is refused by the same record's key rule",
    resolvedByThisRound: true,
    weakenedByThisRound: false,
    ownerChoice:
      'rename the residual label to a cell-free form, OR record it as a contract-named exemption — this round admits it under the allowlist-governs precedence and changes neither list',
    resolution:
      'the FIRST of the two choices: the label is superseded to `suppressed_other`, which survives group 7 unaided. No exemption was recorded and group 7 is unchanged.',
    invariantMovedToAccommodateIt: null,
  },
] as const;

// ─── The supersessions BR-SOURCE-FAST-TRACK-6 recorded ────────────────────────

/**
 * The technical/product directions that SUPERSEDE a Round-3 owner direction, stated explicitly
 * because 10K § 3 requires a `superseded` disposition to name its successor rather than let a
 * decision drift out of force.
 *
 * 🔴 Read `supersededBy` and `whatDidNotMove` together. Each entry names what replaced the direction
 * AND names the invariant that was left alone — which is the only way a later reader can tell a
 * supersession from a quiet relaxation. In all three cases the invariant that did not move is a live
 * privacy control, and in none of them was a carve-out granted.
 */
export const BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_SUPERSESSIONS = [
  {
    collisionIds: ['OD-C1', 'OD-C2'] as readonly string[],
    supersededDirection: 'TOTAL_ROWS_SCANNED = ALLOWED',
    supersededBy: 'TOTAL_ROWS_SCANNED = INTERNAL_EXECUTION_COUNTER_ONLY',
    rationale: [
      'the exact figure can exceed BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF',
      'its RENDERED representation collides with the VP digit-run rules',
      'no Agent 1 or product function requires it',
      'there is no reason to weaken BR-SOURCE-11A to preserve it',
    ] as readonly string[],
    whatDidNotMove: [
      'BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF',
      'VP-1',
      'VP-4',
      'br-receita-cnpj-full-join-output-sanitizer (BR-SOURCE-11A)',
    ] as readonly string[],
    decidedBy: 'project technical/product direction',
    isAHumanPrivacyApproval: false,
  },
  {
    collisionIds: ['OD-C3'] as readonly string[],
    supersededDirection: 'the § 7 residual bucket label is other_or_suppressed_small_cell',
    supersededBy: 'the § 7 residual bucket label is suppressed_other',
    rationale: [
      'the former contains `cell` and collides with the frozen forbidden-key rule',
      'a safe semantic name exists, so an exemption buys nothing',
    ] as readonly string[],
    whatDidNotMove: [
      'BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_GROUPS group 7',
      'the residual bucket obligations in BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_OBLIGATIONS',
    ] as readonly string[],
    decidedBy: 'project technical/product direction',
    isAHumanPrivacyApproval: false,
  },
] as const;

/**
 * 🔴 What `total_rows_scanned` IS, after the supersession, in the one word that matters: INTERNAL.
 *
 * An internal execution counter is not a quieter output. It is not emitted, not logged, not
 * rendered, not attached to an error, not carried in gate evidence and not shown in an operator
 * summary. `BRAZIL_RECEITA_GATE5_INTERNAL_ONLY_COUNTER_PERMITTED_SURFACES` is empty for that reason,
 * and it is empty as an assertion rather than as an oversight.
 */
export const BRAZIL_RECEITA_GATE5_TOTAL_ROWS_SCANNED_DISPOSITION =
  'INTERNAL_EXECUTION_COUNTER_ONLY' as const;

/** Every counter that lives inside an execution and reaches no surface. Closed. */
export const BRAZIL_RECEITA_GATE5_INTERNAL_ONLY_COUNTERS: readonly string[] = [
  'total_rows_scanned',
];

/** The surfaces an internal-only counter may reach. None, on purpose. */
export const BRAZIL_RECEITA_GATE5_INTERNAL_ONLY_COUNTER_PERMITTED_SURFACES: readonly string[] = [];

/**
 * 🔴 The claim this round most needs to be checkable: BR-SOURCE-11A was NOT weakened.
 *
 * Round 3 recorded the same value and this round preserves it while RESOLVING the collisions that
 * pressed on it. A resolved collision is exactly when an invariant is most likely to be quietly
 * relaxed, so the flag and a test over the 11A module both stay.
 */
export const BRAZIL_RECEITA_GATE5_11A_WEAKENED_BY_THIS_ROUND = false as const;

// ─── The output-key renames ───────────────────────────────────────────────────

/**
 * The § 6 output keys renamed away from a `row`-bearing spelling, with the reason and the historical
 * prose each rename leaves behind.
 *
 * 🔴 `historicalReferences` is the field that keeps this honest. `persisted_rows = 0` is named in
 * 10J § 12's safety-invariant set and quoted in 10K § 12's GATE-8 *Governs* clause. Those documents
 * are historical prose and are NOT edited: an approval record that rewrites itself is not a record.
 * The rename therefore carries a mapping, so a reader tracing `persisted_rows = 0` forward finds
 * `records_persisted` rather than a key that vanished.
 *
 * 🔴 Neither key was emitted by any production module before this rename —
 * `BRAZIL_RECEITA_GATE5_RENAMED_KEYS_HAD_A_PRODUCTION_EMITTER` records that as the reason the rename
 * is a contract change and not a breaking API change.
 */
export const BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES = [
  {
    from: 'persisted_rows',
    to: 'records_persisted',
    reason: 'group 7 substring-matches `row`; a safe semantic name exists',
    trippedDenylistGroup: 7,
    historicalReferences: [
      '10J § 12 safety invariants — persisted_rows = 0',
      '10K § 12 GATE-8 Governs clause — persisted_rows = 0',
    ] as readonly string[],
    historicalProseEdited: false,
  },
  {
    from: 'rows_seen_by_family',
    to: 'records_seen_by_family',
    reason: 'group 7 substring-matches `row`; a safe semantic name exists',
    trippedDenylistGroup: 7,
    historicalReferences: [
      '10O § 5.2 — named as an over-matched aggregate',
      '10O § 6 — listed in the proposed allowlist',
    ] as readonly string[],
    historicalProseEdited: false,
  },
] as const;

/** Neither renamed key was emitted by production code, so no runtime surface changed shape. */
export const BRAZIL_RECEITA_GATE5_RENAMED_KEYS_HAD_A_PRODUCTION_EMITTER = false as const;

/** Internal ENGINE variable names are out of scope: renaming for style is not a privacy change. */
export const BRAZIL_RECEITA_GATE5_RENAME_SCOPE = 'future_sanitized_output_contract_only' as const;
