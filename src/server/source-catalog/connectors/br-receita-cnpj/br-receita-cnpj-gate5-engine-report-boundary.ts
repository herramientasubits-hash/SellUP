/**
 * BR Receita CNPJ — the GATE-5 / legacy engine-report CONTRACT BOUNDARY
 * (BR-SOURCE-FAST-TRACK-6, FINAL BOUNDARY CORRECTION).
 *
 * `BrazilReceitaFullJoinEnginePublicReport` (BR-SOURCE-11A / 14B) predates the frozen GATE-5 output
 * contract and carries keys GATE-5 refuses — `rows_emitted`, `raw_rows_printed` and
 * `zero_output_rows_enforced` all trip § 5.2 group 7's `raw` / `row` substrings and none is named in
 * the § 6 allowlist. This module records where the two contracts meet, and it does so WITHOUT
 * touching either of them.
 *
 * ── 🔴 The word `PublicReport` is a MISNOMER, and it is the dangerous one ────
 *
 * It means "the non-private half of the engine's output" — the counterpart to the private operator
 * measurement artifact. It has never meant "approved for public emission", and it long predates
 * GATE-5. `BRAZIL_RECEITA_GATE5_LEGACY_REPORT_NAME_IMPLIES_APPROVAL` is `false` because a reader who
 * takes the name as the approval will conclude this object is already cleared for every surface, and
 * it is cleared for none of them.
 *
 * ── 🔴 What was NOT done, and why that is the correct outcome ────────────────
 *
 * The historical shape is NOT renamed. That is not deference to age — it is what the consumer evidence
 * requires. `BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CONSUMERS` enumerates the real consumers found
 * by inspection, and `raw_rows_printed` in particular is a SAFETY FACT asserted `false` across the
 * dry-run runner, the output-sanitizer suite, three operator scripts and seven decision records.
 * Renaming any of the three would alter a pre-existing contract and break existing tests, so
 * `BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_SHAPE_CHANGED` is `false`.
 *
 * ── 🔴 The open defect this module REFUSES to hide ──────────────────────────
 *
 * A direct emitter EXISTS today. It is enumerated in
 * `BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_KNOWN_DIRECT_EMITTERS` with its exact chain, and the
 * round's suite asserts the set has not GROWN rather than asserting it is empty — because an
 * assertion of zero that is false is worse than no assertion, and excluding the file to make a test
 * green would be hiding the defect behind an allowlist.
 *
 * The emitter passes BR-SOURCE-11A and fails GATE-5, and that asymmetry is the whole finding: 11A is
 * a DENYLIST over dataset-looking content, so it has no opinion about a key nobody reviewed. Only the
 * § 6 allowlist refuses a novel key, and it is not on that path.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - imports, re-exports, widens, narrows or otherwise touches the legacy engine report, the 11A
 *     sanitizer, the GATE-5 allowlist, the GATE-5 denylist or any group in it. It DESCRIBES a
 *     boundary between contracts it does not own.
 *   - approves a gate, resolves the defect it records, or authorizes a projection implementation.
 *   - authorizes a run, a rehearsal, a benchmark, real-data access, an import, a Supabase write, a
 *     migration, a runtime path, Agent 1, Agent 2A or a provider call.
 *   - invents a GATE-5 output key to preserve a legacy name.
 */

// ─── The classification ───────────────────────────────────────────────────────

/**
 * What the legacy object IS. One label, chosen so that neither half of it can be dropped in a
 * summary: it is LEGACY, it is ENGINE-scoped, it has been through the 11A SANITIZER, and it is a
 * SHAPE rather than an approved emission.
 */
export const BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CLASSIFICATION =
  'LEGACY_ENGINE_SANITIZED_REPORT_SHAPE' as const;

/** The object this classification governs, named as data so a test can locate it. */
export const BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_SUBJECT = {
  type: 'BrazilReceitaFullJoinEnginePublicReport',
  builder: 'buildBrazilReceitaFullJoinEnginePublicReport',
  owningModule: 'br-receita-cnpj-full-join-engine-report',
  introducedBy: 'BR-SOURCE-11A / 14B',
  predatesGate5: true,
} as const;

/**
 * 🔴 It is NOT, by itself, an approved GATE-5 external emission. This is the single most important
 * constant in the module.
 */
export const BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_IS_AN_APPROVED_EMISSION = false as const;

/** 🔴 And the historical name is not evidence that it is. See the header. */
export const BRAZIL_RECEITA_GATE5_LEGACY_REPORT_NAME_IMPLIES_APPROVAL = false as const;

/**
 * What it MAY be used as: internal, pre-projection input to a future GATE-5 report emitter. That is
 * the whole permitted use, and it is stated positively so the boundary is not only a list of refusals.
 */
export const BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_PERMITTED_USE =
  'internal_or_pre_projection_input_only' as const;

/**
 * The surfaces it must never be serialized onto WITHOUT passing the GATE-5 closed allowlist /
 * projection contract. Deliberately the full twelve — GATE-5 § 4 grants no surface an exception, no
 * debug mode and no verbose flag, and a shorter list here would invent one.
 */
export const BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_FORBIDDEN_DIRECT_SURFACES: readonly string[] =
  [
    'cli_stdout',
    'cli_stderr',
    'json_report_file',
    'human_readable_report_file',
    'logs',
    'error_messages',
    'thrown_exceptions',
    'gate_evidence_packet',
    'operator_summary',
    'future_audit_artifacts',
    'future_ci_test_output',
    'screenshots_or_copied_terminal_output',
  ];

// ─── Why the shape was not renamed: the consumer evidence ─────────────────────

/**
 * The real consumers of the legacy shape, found by inspection rather than assumed. This is the
 * evidence the correction asked for BEFORE any rename, and it is the reason no rename happened.
 *
 * 🔴 `raw_rows_printed` is the decisive one. It is not an incidental field name — it is a privacy
 * SAFETY FACT asserted `false`, and the assertion is relied upon by the dry-run runner's own safety
 * block, by the 11A output-sanitizer suite, by three operator scripts and by seven decision records.
 * Renaming it would not tidy a legacy name; it would rewrite a claim other code checks.
 */
export const BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_CONSUMERS = [
  {
    consumer: 'br-receita-cnpj-full-join-engine',
    kind: 'builds_it_and_exposes_it_as_publicReport',
    renameWouldBreak: true,
  },
  {
    consumer: 'br-receita-cnpj-real-full-scan-benchmark',
    kind: 'embeds_it_whole_as_engine_report_after_the_11A_sanitizer',
    renameWouldBreak: true,
  },
  {
    consumer: 'br-receita-cnpj-14b0i-synthetic-throughput-harness',
    kind: 'passes_it_to_the_11A_sanitizer_and_keeps_only_the_boolean_verdict',
    renameWouldBreak: true,
  },
  {
    consumer: '__tests__/br-receita-cnpj-14b0h-abort-instrumentation',
    kind: 'builds_it_and_asserts_the_released_object_identity',
    renameWouldBreak: true,
  },
  {
    consumer: '__tests__/br-receita-cnpj-full-join-engine-envelope',
    kind: 'asserts_rows_emitted_and_zero_output_rows_enforced_by_name',
    renameWouldBreak: true,
  },
  {
    consumer: '__tests__/br-receita-cnpj-real-full-scan-execution-path',
    kind: 'asserts_publicReport_fields_by_name',
    renameWouldBreak: true,
  },
] as const;

/**
 * 🔴 The historical shape is UNCHANGED by this correction. Recorded as data because "we preserved the
 * legacy contract" is a claim a reader should be able to check without reading a diff.
 */
export const BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_SHAPE_CHANGED = false as const;

/** Whether a rename was demonstrated contract-safe. It was not — every consumer above would break. */
export const BRAZIL_RECEITA_GATE5_LEGACY_RENAME_PROVEN_CONTRACT_SAFE = false as const;

// ─── The three keys, classified ───────────────────────────────────────────────

/**
 * What a legacy engine key is allowed to be. One value, because the boundary needs exactly one:
 * a fact the ENGINE records about its own safety, which may live in the legacy object and may not
 * survive to a GATE-5 surface.
 */
export type BrazilReceitaGate5LegacyKeyDisposition = 'LEGACY_ENGINE_INTERNAL_SAFETY_FACT';

export interface BrazilReceitaGate5LegacyKeyRecord {
  readonly key: string;
  readonly disposition: BrazilReceitaGate5LegacyKeyDisposition;
  /** The § 5.2 group the key trips. Every one of the three trips group 7. */
  readonly tripsDenylistGroup: number;
  /** Whether the key is named in the frozen § 6 allowlist. None of the three is. */
  readonly gate5Allowlisted: false;
  /** May it remain in the legacy object for backward compatibility? Yes — that is the whole point. */
  readonly mayRemainInLegacyObject: true;
  /** May it survive, as-is, to a GATE-5 external surface? Never. */
  readonly maySurviveToGate5Surface: false;
  /**
   * The already-approved GATE-5 key this translates to, or `null` when no existing contract PROVES
   * the equivalence. `null` means "omit from external GATE-5 output", never "invent a key".
   */
  readonly translatesToApprovedGate5Key: string | null;
}

/**
 * The three keys, each classified.
 *
 * 🔴 `rows_emitted` translates to NOTHING, and the temptation to map it to `records_persisted` is why
 * this field is `null` rather than absent. **Emitted and persisted are not the same semantic.**
 * `rows_emitted` is a count of rows the engine handed to its sink; `records_persisted` is a count of
 * records durably written. Under `maxOutputRows = 0` and a null sink both happen to read zero today,
 * and a coincidence of value at one operating point is not an equivalence of meaning — it is exactly
 * how a wrong mapping survives review. No existing contract proves the equivalence, so none is
 * asserted.
 *
 * 🔴 The other two are BOOLEAN safety facts with no counting semantics at all, so a numeric GATE-5
 * key could not carry them even if one existed. `safety` is the § 6 key that carries safety booleans,
 * and whether these two belong inside it is a projection-design question this round does not answer —
 * see `BRAZIL_RECEITA_GATE5_ENGINE_REPORT_PROJECTION_REQUIRED`.
 */
export const BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_KEY_RECORDS: readonly BrazilReceitaGate5LegacyKeyRecord[] =
  [
    {
      key: 'rows_emitted',
      disposition: 'LEGACY_ENGINE_INTERNAL_SAFETY_FACT',
      tripsDenylistGroup: 7,
      gate5Allowlisted: false,
      mayRemainInLegacyObject: true,
      maySurviveToGate5Surface: false,
      translatesToApprovedGate5Key: null,
    },
    {
      key: 'raw_rows_printed',
      disposition: 'LEGACY_ENGINE_INTERNAL_SAFETY_FACT',
      tripsDenylistGroup: 7,
      gate5Allowlisted: false,
      mayRemainInLegacyObject: true,
      maySurviveToGate5Surface: false,
      translatesToApprovedGate5Key: null,
    },
    {
      key: 'zero_output_rows_enforced',
      disposition: 'LEGACY_ENGINE_INTERNAL_SAFETY_FACT',
      tripsDenylistGroup: 7,
      gate5Allowlisted: false,
      mayRemainInLegacyObject: true,
      maySurviveToGate5Surface: false,
      translatesToApprovedGate5Key: null,
    },
  ];

/**
 * 🔴 The mapping this module explicitly REFUSES to make, recorded so a future author finds the refusal
 * before re-deriving the temptation.
 */
export const BRAZIL_RECEITA_GATE5_REFUSED_LEGACY_KEY_MAPPINGS = [
  {
    from: 'rows_emitted',
    to: 'records_persisted',
    refused: true,
    reason:
      'emitted and persisted are different semantics; both read zero under maxOutputRows = 0 and a null sink, and a coincidence of value at one operating point is not an equivalence of meaning',
    provenByAnExistingContract: false,
  },
] as const;

/** No new GATE-5 output key was invented to preserve a legacy name. */
export const BRAZIL_RECEITA_GATE5_NEW_KEY_INVENTED_FOR_A_LEGACY_NAME = false as const;

// ─── The required projection ──────────────────────────────────────────────────

/** Any future full-join report implementation MUST project. Not "should". */
export const BRAZIL_RECEITA_GATE5_ENGINE_REPORT_PROJECTION_REQUIRED = true as const;

/**
 * The required pipeline, as ORDERED data so a future implementation can be checked against it rather
 * than compared to prose.
 *
 * 🔴 The forbidden shortcut is named separately below, because the pipeline being written down does
 * not by itself forbid bypassing it.
 */
export const BRAZIL_RECEITA_GATE5_REQUIRED_PROJECTION_PIPELINE: readonly string[] = [
  'engine_observations',
  'legacy_engine_report_or_internal_safety_facts',
  'gate5_projection',
  'gate5_closed_allowlist',
  'gate5_denylist_and_value_guards',
  'external_output',
];

/** The shortcut that is forbidden, stated as its own constant so it is assertable. */
export const BRAZIL_RECEITA_GATE5_FORBIDDEN_PROJECTION_SHORTCUT: readonly string[] = [
  'legacy_engine_report',
  'external_output',
];

/**
 * The projection is NOT implemented here, and that is deliberate rather than unfinished. GATE-5's
 * *Allows* clause covers writing its contract and its tests; a report emitter is runner code, and
 * 10K § 4 forbids writing any while a gate is unapproved.
 */
export const BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTED = false as const;
export const BRAZIL_RECEITA_GATE5_PROJECTION_IMPLEMENTATION_AUTHORIZED_NOW = false as const;

// ─── 🔴 The open defect: a direct emitter EXISTS ───────────────────────────────

export interface BrazilReceitaGate5LegacyEmitterRecord {
  /** The file that performs the serialization. */
  readonly emittingModule: string;
  /** The GATE-5 surface it reaches. */
  readonly surface: string;
  /** The serialization mechanism, named rather than described. */
  readonly mechanism: string;
  /** The chain from the engine to the surface, in order. */
  readonly chain: readonly string[];
  /** Whether the legacy object passes the 11A sanitizer on this path. It does. */
  readonly passesSanitizer11A: true;
  /** Whether it passes the GATE-5 closed allowlist on this path. It does not. */
  readonly passesGate5Allowlist: false;
  /** What stands between this emitter and an operator today. */
  readonly reachabilityGates: readonly string[];
  readonly isALiveRuntimePath: false;
  readonly resolvedByThisRound: false;
}

/**
 * 🔴 THE FINDING. One emitter, enumerated with its exact chain, and NOT resolved by this round.
 *
 * The correction that produced this module asked for a negative test proving no production path
 * serializes the legacy report onto a GATE-5 surface, and said: if one exists, HARD STOP, report it,
 * do not hide it with an allowlist. One exists. It is reported here, it is surfaced in the human
 * packet, and the round's suite asserts this set has not GROWN — never that it is empty.
 *
 * Why it survives 11A: 11A is a DENYLIST over values that look like dataset content. `rows_emitted: 0`
 * and `raw_rows_printed: false` look like nothing at all, so 11A returns `ok` and has no opinion about
 * whether anybody reviewed the keys. Only the § 6 allowlist refuses a key by ABSENCE, and the § 6
 * allowlist is not on this path. Running the GATE-5 guard over the same three keys returns six
 * findings — three `KEY-ALLOWLIST`, three `KEY-DENYLIST` group 7 — and the round's suite proves both
 * halves of that asymmetry by execution.
 *
 * Why it is not fixed here: the fix is a projection, the projection is a report emitter, and a report
 * emitter is runner code that 10K § 4 forbids while any gate is unapproved. Changing the benchmark's
 * own public-report shape instead would alter a second pre-existing contract to work around the first.
 */
export const BRAZIL_RECEITA_GATE5_LEGACY_ENGINE_REPORT_KNOWN_DIRECT_EMITTERS: readonly BrazilReceitaGate5LegacyEmitterRecord[] =
  [
    {
      emittingModule: 'scripts/source-catalog/run-br-receita-cnpj-real-full-scan-resource-benchmark.ts',
      surface: 'cli_stdout',
      mechanism: 'process.stdout.write of JSON.stringify(outcome.publicReport)',
      chain: [
        'br-receita-cnpj-full-join-engine builds the legacy engine report',
        'br-receita-cnpj-real-full-scan-benchmark passes it through applyBrazilReceitaRealFullScanReportSanitizer (11A)',
        'the sanitizer releases the WHOLE object as releasedEngineReport when its verdict is ok',
        'br-receita-cnpj-real-full-scan-benchmark embeds it whole as BrazilReceitaRealFullScanPublicReport.engine_report',
        'the benchmark script serializes that outer report to stdout',
      ],
      passesSanitizer11A: true,
      passesGate5Allowlist: false,
      reachabilityGates: [
        'the attempt-limit wall: attempt #3 is refused unconditionally',
        'the second-attempt wall: a real attempt beyond the first needs a recorded owner decision',
        'three process-scoped operator approvals, each from its own CLI flag',
      ],
      isALiveRuntimePath: false,
      resolvedByThisRound: false,
    },
  ];

/**
 * 🔴 Whether a direct emitter exists. `true`, and the constant is named for the question rather than
 * the hope, so no report can round it down.
 */
export const BRAZIL_RECEITA_GATE5_DIRECT_ENGINE_REPORT_EXTERNAL_EMITTER = true as const;

/**
 * 🔴 Whether the BOUNDARY is resolved — and this is deliberately TWO questions, not one.
 *
 * The CONTRACT half is resolved: the classification, the key dispositions, the required projection and
 * the forbidden shortcut are all recorded, and no invariant was weakened to record them. The
 * ENGINEERING half is not: an emitter exists. Collapsing the two into a single boolean is how "we
 * documented it" becomes "we fixed it", so the two are separate and the overall verdict is derived
 * from both rather than stated.
 */
export const BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_CONTRACT_RECORDED = true as const;
export const BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_ENGINEERING_CLEAR = false as const;

/** The overall verdict, DERIVED so it cannot disagree with its two halves. */
export function brazilReceitaGate5EngineReportBoundaryResolved(): boolean {
  return (
    BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_CONTRACT_RECORDED &&
    BRAZIL_RECEITA_GATE5_ENGINE_REPORT_BOUNDARY_ENGINEERING_CLEAR
  );
}

/**
 * The remaining ENGINEERING blocker, in the words the human packet must use. Not a gate blocker and
 * not a signature — a piece of work, owned by engineering, that no human approval discharges.
 */
export const BRAZIL_RECEITA_GATE5_REMAINING_ENGINEERING_BLOCKER = {
  blocker:
    'the benchmark path serializes the legacy engine public report to cli_stdout without passing the GATE-5 closed allowlist',
  owner: 'engineering',
  dischargedByAHumanApproval: false,
  dischargedByThisRound: false,
  fixShape:
    'project the legacy report through the GATE-5 allowlist before it is embedded, OR stop embedding it whole — both are report-emitter work that 10K § 4 defers until the gates are approved',
} as const;

/**
 * 🔴 Consequently: it is NOT true today that five gates wait only on a named human's answer.
 *
 * Five gates DO wait on human answers, and separately one engineering blocker stands outside that
 * set. The human packet says both, because an approver who is told "nothing else is outstanding" is
 * being asked to approve an incomplete picture of the architecture.
 */
export const BRAZIL_RECEITA_GATE5_FIVE_GATES_WAIT_ONLY_ON_HUMANS = false as const;
