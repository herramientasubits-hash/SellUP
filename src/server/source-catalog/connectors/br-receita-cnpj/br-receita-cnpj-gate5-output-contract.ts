/**
 * BR Receita CNPJ — the FROZEN GATE-5 output sanitization contract (BR-SOURCE-GATE-ROUND-3).
 *
 * GATE-5 is the output sanitization gate (10K § 9). BR-SOURCE-10O assembled a twelve-surface
 * contract for it and was explicit about its own two limits: the small-cell threshold `k` and the
 * string-length ceiling `VP-8` were left to the approvers, so `OS-A19` and `OS-A10` were
 * unenforceable, and 10O wrote no test.
 *
 * This module is the contract with the owner's values supplied, expressed as DATA so that
 * `br-receita-cnpj-gate5-output-guard` can execute it and a suite can consume it mechanically.
 * It is the closed enumeration; the guard is the matcher; the recorded record is the gate status.
 *
 * ── 🔴 What the owner direction CHANGED about 10O § 6 ─────────────────────────
 *
 * 10O § 6 listed `capital_social_bucket_counts`, `opened_at_bucket_counts` and
 * `municipality_count_distribution` as allowable subject to GATE-5 fixing their bucket boundaries
 * (10M § 13). The owner direction EXCLUDES all three breakdowns from the v1 report instead. That is
 * a narrowing, not a deferral: with the breakdown excluded there are no boundaries left to fix, so
 * the 10M § 13 item is discharged by exclusion rather than by a boundary table. The three keys are
 * therefore ABSENT from the frozen allowlist below, and `OS-A08` makes an absent key forbidden.
 *
 * ── 🔴 What BR-SOURCE-FAST-TRACK-6 SUPERSEDED, and what it refused to weaken ──
 *
 * Round 3 recorded three collisions between the owner's values and invariants that already existed,
 * and left all three to the approvers. A later technical/product direction superseded the owner
 * direction that caused them rather than carving exceptions out of the invariants. Every
 * supersession is recorded in `BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_SUPERSESSIONS`; the original
 * collisions stay in `BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS` with their resolution
 * attached, because a collision deleted is a collision nobody can audit.
 *
 *   · `OD-C1` / `OD-C2` — `TOTAL_ROWS_SCANNED = ALLOWED` is SUPERSEDED by
 *     `TOTAL_ROWS_SCANNED = INTERNAL_EXECUTION_COUNTER_ONLY`. The counter still exists inside an
 *     execution; it is emitted on NO surface. `BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF` and the
 *     `VP-1` / `VP-4` digit-run rules are untouched, and BR-SOURCE-11A is not weakened by one
 *     character — `BRAZIL_RECEITA_GATE5_11A_WEAKENED_BY_THIS_ROUND` says so as data.
 *   · `OD-C3` — the residual label `other_or_suppressed_small_cell` is SUPERSEDED by
 *     `suppressed_other`. The mandated label no longer contains the `cell` substring group 7
 *     forbids, so the one label small-cell suppression is REQUIRED to emit is no longer refused by
 *     the same record's key rule. Group 7 is unchanged.
 *
 * ── 🔴 Two output keys RENAMED, and why a carve-out was the wrong fix ────────
 *
 * `persisted_rows` and `rows_seen_by_family` were admitted only by the allowlist-governs precedence,
 * because group 7 substring-matches `row`. A safe semantic name existed in both cases, so they are
 * RENAMED — `records_persisted` and `records_seen_by_family` — rather than left resting on a
 * precedence carve-out. `BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES` records each rename with the
 * historical prose that still uses the old spelling, so the rename cannot silently orphan the
 * 10J § 12 / 10K § 12 safety invariant that names `persisted_rows = 0`.
 *
 * The precedence itself is UNCHANGED and still authoritative. What changed is that nothing needs it:
 * `BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST` is now EMPTY.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - approves a gate. GATE-5's status lives in the recorded record, and it is not `approved`.
 *   - authorizes a run, a benchmark, real-data access, a report emission, snapshot persistence, an
 *     import, a Supabase write, a migration, a runtime path, Agent 1, Agent 2A or a provider call.
 *   - carries a literal CNPJ, CNPJ básico, CPF, personal name, address, contact value or real path.
 *     Every pattern below is a quantifier; no identifier of any length appears in this source.
 */

// ─── Owner technical direction ────────────────────────────────────────────────

/** The version marker this contract binds. 10O § 6 proposed the field; this freezes its value. */
export const BRAZIL_RECEITA_GATE5_OUTPUT_SANITIZATION_VERSION =
  'br_receita_cnpj_output_sanitization_v1' as const;

/**
 * The minimum cell size below which a bucket is never disclosed (10O § 7). The owner set `k = 10`,
 * which is the value 10O proposed as a floor (`k >= 10`) rather than a different one.
 *
 * 🔴 Setting `k` is what makes `OS-A19` enforceable at all. 10O § 7 recorded that the assertion
 * "cannot be checked without a threshold" and that "GATE-5 cannot pass on it" until one exists.
 */
export const BRAZIL_RECEITA_GATE5_SMALL_CELL_K = 10 as const;

/** The `VP-8` ceiling. The owner took 10O § 5.3's proposed starting point rather than another. */
export const BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH = 64 as const;

/**
 * The single residual label a suppressed family may merge into (10O § 7). Nothing else.
 *
 * 🔴 SUPERSEDED VALUE. 10O § 7 mandated `other_or_suppressed_small_cell`, and `OD-C3` recorded that
 * the mandated label contains `cell` — the substring § 5.2 group 7 forbids — so the one label
 * suppression is REQUIRED to emit was refused by the same record's key rule. BR-SOURCE-FAST-TRACK-6
 * supersedes the LABEL rather than the group: `suppressed_other` carries the same meaning, survives
 * group 7 on its own, and needs no exemption. Group 7 is not weakened, and the label's obligations
 * are unchanged — see `BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_OBLIGATIONS`.
 */
export const BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL = 'suppressed_other' as const;

/** The label 10O § 7 mandated, kept so the supersession is auditable rather than invisible. */
export const BRAZIL_RECEITA_GATE5_SUPERSEDED_RESIDUAL_BUCKET_LABEL =
  'other_or_suppressed_small_cell' as const;

/**
 * What the residual bucket must remain, whatever it is called. Renaming a label is the kind of change
 * that quietly relaxes what the label may carry, so the obligations are stated as data next to it.
 *
 * 🔴 `mergedBucketCountDisclosed: false` is the one most easily lost. The NUMBER of buckets merged
 * into the residual is itself a disclosure about the family's tail, which is why the suppression
 * outcome carries one count and no tally.
 */
export const BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_OBLIGATIONS = {
  aggregateOnly: true,
  mergedBucketCountDisclosed: false,
  originalLabelsDisclosed: false,
  originalSmallCountsDisclosed: false,
  reconstructableBySubtraction: false,
} as const;

/**
 * Complementary suppression: when exactly one bucket in a family is suppressed its count is
 * recoverable by subtraction, so the next smallest is suppressed with it (10O § 7).
 */
export const BRAZIL_RECEITA_GATE5_COMPLEMENTARY_SUPPRESSION_REQUIRED = true as const;

/** Cross-tabulations. 10O § 7 proposed the stronger, simpler rule; the owner adopted it. */
export const BRAZIL_RECEITA_GATE5_CROSS_TABULATIONS_PERMITTED = false as const;

/** Named municipality counts. 10O § 6 recommended against; the owner prohibited. */
export const BRAZIL_RECEITA_GATE5_NAMED_MUNICIPALITY_COUNTS_PERMITTED = false as const;

/** Stack emission. 10O `OS-A34` proposed the narrowing; the owner adopted it. */
export const BRAZIL_RECEITA_GATE5_STACK_OUTPUT_PERMITTED = false as const;

/**
 * The four aggregates 10O § 6 left "approvable but unapproved", plus the three breakdowns the owner
 * excluded, as one closed disposition table. A reader looking for "what did GATE-5 actually decide"
 * reads this and nothing else.
 */
export type BrazilReceitaGate5AggregateDisposition =
  | 'allowed'
  | 'allowed_with_small_cell_suppression'
  | 'internal_execution_counter_only'
  | 'excluded'
  | 'prohibited';

export const BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS: Readonly<
  Record<string, BrazilReceitaGate5AggregateDisposition>
> = {
  // 🔴 SUPERSEDED from `allowed`. See BRAZIL_RECEITA_GATE5_TOTAL_ROWS_SCANNED_DISPOSITION: the
  // counter exists inside an execution and is emitted on no surface at all.
  total_rows_scanned: 'internal_execution_counter_only',
  cnae_section_counts: 'allowed_with_small_cell_suppression',
  uf_counts: 'allowed_with_small_cell_suppression',
  named_municipality_counts: 'prohibited',
  capital_social_bucket_counts: 'excluded',
  opened_at_bucket_counts: 'excluded',
  municipality_count_distribution: 'excluded',
  cross_tabulations: 'prohibited',
  raw_row_output: 'prohibited',
  raw_cell_output: 'prohibited',
  identity_key_output: 'prohibited',
  stack_output: 'prohibited',
};

/**
 * The owner-direction decision log — the three collisions, the two supersessions, the two renames,
 * and the "11A was not weakened" claim — re-exported from the module that owns it.
 *
 * It lives in `br-receita-cnpj-gate5-owner-direction-log` because it answers a different question
 * from this contract: this file says what an output may carry, that one says who changed which value
 * and in which direction. Re-exported here so a consumer of the contract still finds it in one place.
 */
export {
  BRAZIL_RECEITA_GATE5_11A_WEAKENED_BY_THIS_ROUND,
  BRAZIL_RECEITA_GATE5_INTERNAL_ONLY_COUNTERS,
  BRAZIL_RECEITA_GATE5_INTERNAL_ONLY_COUNTER_PERMITTED_SURFACES,
  BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES,
  BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS,
  BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_SUPERSESSIONS,
  BRAZIL_RECEITA_GATE5_RENAMED_KEYS_HAD_A_PRODUCTION_EMITTER,
  BRAZIL_RECEITA_GATE5_RENAME_SCOPE,
  BRAZIL_RECEITA_GATE5_TOTAL_ROWS_SCANNED_DISPOSITION,
} from './br-receita-cnpj-gate5-owner-direction-log';

// ─── § 4 output surfaces ──────────────────────────────────────────────────────

/** The twelve surfaces (10O § 4). The universal forbidden set applies to every one, with no mode. */
export const BRAZIL_RECEITA_GATE5_OUTPUT_SURFACES = [
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
] as const;

export type BrazilReceitaGate5OutputSurface =
  (typeof BRAZIL_RECEITA_GATE5_OUTPUT_SURFACES)[number];

/** No surface has an exception, a debug mode, a verbose flag, an env var, or an override. */
export const BRAZIL_RECEITA_GATE5_SURFACE_EXEMPTIONS: readonly BrazilReceitaGate5OutputSurface[] =
  [];

/**
 * The one surface no assertion can reach. 10O § 4 surface L is mitigated by GATE-7's operator
 * behaviour rules, not by code, and saying otherwise would be the most comfortable lie available.
 */
export const BRAZIL_RECEITA_GATE5_MACHINE_UNDETECTABLE_SURFACE: BrazilReceitaGate5OutputSurface =
  'screenshots_or_copied_terminal_output';

// ─── § 5.2 the closed forbidden key-name list ─────────────────────────────────

/**
 * How a group's entries are matched against a normalized key name.
 *
 * `substring`         — the entry appears anywhere in the normalized name.
 * `whole`             — the entry IS the normalized name.
 * `whole_or_ordinal`  — the entry is the normalized name, or the name with a trailing `_<digits>`
 *                       positional suffix removed (10O § 5.2, group 2).
 */
export type BrazilReceitaGate5KeyMatchMode = 'substring' | 'whole' | 'whole_or_ordinal';

export interface BrazilReceitaGate5ForbiddenKeyGroup {
  readonly group: number;
  readonly label: string;
  readonly matchMode: BrazilReceitaGate5KeyMatchMode;
  readonly names: readonly string[];
}

/**
 * The closed enumeration, group by group, exactly as 10O § 5.2 froze it. It REPLACES the 10J § 15
 * "and equivalents" prose tail: there is no tail, and there is deliberately no way to add one — a
 * consumer reads this array or it reads nothing.
 *
 * 🔴 Groups 4 and 7 over-match on purpose. `cnpj_root_count` and the pre-rename `rows_seen_by_family`
 * are both caught. The resolution 10O § 5.2 records is to RENAME the aggregate, never to weaken the
 * matcher — and BR-SOURCE-FAST-TRACK-6 took exactly that route for the two § 6 keys that needed it
 * (`BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES`). No group here is edited, narrowed, or given an
 * exemption. Where allowlist and denylist disagree about a key in neither, the key is forbidden.
 */
export const BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_GROUPS: readonly BrazilReceitaGate5ForbiddenKeyGroup[] =
  [
    {
      group: 1,
      label: 'person / partner',
      matchMode: 'substring',
      names: [
        'socio',
        'socios',
        'qsa',
        'cpf',
        'representante',
        'representantes',
        'faixa_etaria',
        'nome_socio',
        'qualificacao_socio',
        'pais_origem_socio',
        'representante_legal',
        'nome_representante',
      ],
    },
    {
      group: 2,
      label: 'contact',
      matchMode: 'whole_or_ordinal',
      names: [
        'telefone',
        'telefone_1',
        'telefone_2',
        'fax',
        'ddd',
        'ddd_1',
        'ddd_2',
        'ddd_fax',
        'correio_eletronico',
        'email',
      ],
    },
    {
      group: 3,
      label: 'fine-grained address',
      matchMode: 'whole',
      names: [
        'logradouro',
        'tipo_logradouro',
        'numero',
        'complemento',
        'bairro',
        'cep',
      ],
    },
    {
      group: 4,
      label: 'fiscal identifiers',
      matchMode: 'substring',
      names: ['cnpj', 'cnpj_basico', 'cnpj_ordem', 'cnpj_dv'],
    },
    {
      group: 5,
      label: 'company naming',
      matchMode: 'whole',
      names: ['razao_social', 'nome_fantasia', 'nome_empresarial'],
    },
    {
      group: 6,
      label: 'key and derivation containers',
      matchMode: 'whole',
      names: [
        'join_key',
        'record_identity_key',
        'normalized_tax_id',
        'row_hash',
        'identifier_hash',
        'hash12',
        'masked_identifier',
        'sample_identifier',
        'safe_sample_identifier',
      ],
    },
    {
      group: 7,
      label: 'raw containers',
      matchMode: 'substring',
      names: [
        'raw',
        'sample',
        'example',
        'debug',
        'payload',
        'row',
        'cell',
        'offset',
      ],
    },
  ];

/** The list is closed but not final: only a recorded owner decision may add or remove an entry. */
export const BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_LIST_IS_CLOSED = true as const;
export const BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_LIST_HAS_EQUIVALENTS_TAIL = false as const;

/**
 * 🔴 THE PRECEDENCE, stated as data because it is the single rule most consequential to get right.
 *
 * 10O § 5.2: "The allowlist governs; the denylist is a second, independent net. Where the two
 * disagree about a key that is in neither, the key is forbidden."
 *
 * The precedence STAYS, and stays authoritative. What changed in BR-SOURCE-FAST-TRACK-6 is that
 * nothing in the frozen contract needs it any more: the three keys that used to rest on it —
 * `persisted_rows`, `rows_seen_by_family` and `total_rows_scanned` — were renamed twice over and
 * superseded once, so `BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST` is EMPTY.
 *
 * 🔴 An empty carve-out set is not a reason to delete the precedence. It is the rule that decides
 * what happens the next time a § 6 key and a denylist group disagree, and the safe answer to that
 * question must exist BEFORE the disagreement, not after it. The precedence is kept as the standing
 * tie-break; the empty set is the evidence that no key is currently relying on it.
 */
export const BRAZIL_RECEITA_GATE5_ALLOWLIST_GOVERNS = true as const;

/**
 * The allowlisted keys that trip a denylist group, enumerated. Not an exception list the guard reads
 * — the precedence above handles them structurally — but the EVIDENCE of how much the precedence is
 * currently carrying.
 *
 * 🔴 EMPTY, and empty as a FINDING rather than by omission. Round 3 carried three entries here and
 * recorded that the resolution was to rename rather than to weaken the matcher. This round performed
 * the renames (`records_persisted`, `records_seen_by_family`) and superseded the third key into an
 * internal-only counter. No denylist group was edited to achieve it.
 *
 * A future author adding a § 6 key that trips a group must add it HERE and record the owner decision
 * that admits it. The round's suite fails if this list and the real allowlist disagree, so the set
 * cannot silently grow a fourth member.
 */
export const BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST: readonly string[] = [];

/**
 * 🔴 Whether any § 6 key remains admitted ONLY by the precedence carve-out. It does not.
 *
 * Stated as its own boolean because "the list is empty" and "no key depends on the carve-out" are
 * the same fact today and could drift apart the moment somebody adds an entry without updating the
 * flag — so the suite derives one from the other rather than trusting either.
 */
export const BRAZIL_RECEITA_GATE5_ANY_KEY_DEPENDS_ON_ALLOWLIST_CARVE_OUT = false as const;

/**
 * 🔴 Whether an authoritative immutable key forced a carve-out to survive. None did.
 *
 * The task that superseded `OD-C1` … `OD-C3` asked for exactly this to be reported if it happened:
 * a key that could not be renamed because it is fixed historical API. Neither renamed key had a
 * production emitter (`BRAZIL_RECEITA_GATE5_RENAMED_KEYS_HAD_A_PRODUCTION_EMITTER` is `false`), and
 * the two documents that name `persisted_rows` name it in PROSE about an invariant, not as a wire
 * format. So the answer is `null`: no immutable key blocked the cleanup.
 */
export const BRAZIL_RECEITA_GATE5_IMMUTABLE_KEY_FORCING_A_CARVE_OUT: string | null = null;

// ─── § 6 the closed aggregate allowlist ───────────────────────────────────────

/**
 * The frozen allowlist. A key absent from this set is FORBIDDEN even when it survives every
 * denylist rule — which is what makes `OS-A08` the load-bearing assertion 10O § 5.4 says it is.
 *
 * 🔴 Three keys 10O § 6 listed are deliberately ABSENT: `capital_social_bucket_counts`,
 * `opened_at_bucket_counts` and `municipality_count_distribution`. The owner excluded those
 * breakdowns, so their absence is the exclusion being enforced rather than an omission.
 *
 * 🔴 A FOURTH key is now absent for a different reason: `total_rows_scanned`. It is not excluded from
 * the report because the breakdown was refused — it is not a report field at all any more. See
 * `BRAZIL_RECEITA_GATE5_TOTAL_ROWS_SCANNED_DISPOSITION`. Keeping the two reasons apart matters: an
 * EXCLUDED breakdown could be re-proposed with boundaries; an INTERNAL-ONLY counter has no surface
 * to be re-proposed onto.
 */
export const BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS: readonly string[] = [
  // Run identity and mode
  'mode',
  'ok',
  'source_key',
  'country_code',
  'source_period',
  'source_year',
  'official_layout_mode',
  // Scope and safety invariants
  'full_dataset_processed',
  'coverage_is_representative',
  'import_executed',
  'supabase_write',
  'runtime_integration',
  'agent1_integration',
  'hubspot_write',
  'slack_write',
  // 🔴 RENAMED from `persisted_rows` (group 7 `row`). The 10J § 12 invariant it carries is unchanged;
  // BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES maps the old spelling forward.
  'records_persisted',
  'safety',
  // Volume and provenance counters
  'files_seen',
  'file_family_counts',
  'file_families_accepted',
  'file_families_rejected',
  // 🔴 RENAMED from `rows_seen_by_family` (group 7 `row`).
  'records_seen_by_family',
  // 🔴 `total_rows_scanned` is deliberately ABSENT. It is an INTERNAL_EXECUTION_COUNTER_ONLY after
  // the OD-C1 / OD-C2 supersession, and § 6 absence is what makes `OS-A08` refuse it on every
  // surface. Its absence is the supersession being enforced, not an omission.
  'companies_seen',
  'establishments_seen',
  // Join outcome counters
  'joined_establishments_count',
  'missing_company_context_count',
  'join_outcome_counts',
  // Eligibility aggregates
  'eligibility_status_counts',
  'eligibility_reason_counts',
  'exclusion_reason_counts',
  // Classification bucket aggregates that survived the owner direction
  'legal_nature_bucket_counts',
  'cnae_section_counts',
  'uf_counts',
  'registration_status_bucket_counts',
  'porte_bucket_counts',
  'establishment_type_bucket_counts',
  // Privacy and guardrail aggregates
  'guardrail_counts',
  'excluded_person_or_pii_risk',
  'excluded_forbidden_token',
  'excluded_forbidden_file_family',
  'needs_legal_review',
  'eligible_for_future_import_candidates',
  // Run outcome
  'cleanup_status',
  'duration_ms',
  'resource_usage_bucket',
  'warnings',
  'errors',
  'failed_stage',
  // Contract markers
  'field_allowlist_version',
  'record_identity_grain_decision',
  'temporary_storage_mode',
  'output_sanitization_version',
];

/** The bucket families small-cell suppression governs (10O § 7 scope clause). */
export const BRAZIL_RECEITA_GATE5_SUPPRESSED_BUCKET_FAMILIES: readonly string[] = [
  'legal_nature_bucket_counts',
  'cnae_section_counts',
  'uf_counts',
  'registration_status_bucket_counts',
  'porte_bucket_counts',
  'establishment_type_bucket_counts',
  'eligibility_status_counts',
  'eligibility_reason_counts',
  'exclusion_reason_counts',
  'guardrail_counts',
  'join_outcome_counts',
  'file_family_counts',
  'records_seen_by_family',
];

/**
 * Run-level fields suppression does NOT touch: they describe the run, not the records (10O § 7).
 * Listing them is what stops a future author suppressing `records_persisted: 0` as a "small cell".
 */
export const BRAZIL_RECEITA_GATE5_SUPPRESSION_EXEMPT_KEYS: readonly string[] = [
  'records_persisted',
  'safety',
  'duration_ms',
  // 🔴 `total_rows_scanned` is NOT listed. It is not exempt from suppression — it is absent from the
  // output entirely, and listing it here would imply a surface it may reach. An internal-only
  // counter belongs to neither the suppressed set nor the exempt set.
  'files_seen',
  'companies_seen',
  'establishments_seen',
  'joined_establishments_count',
  'missing_company_context_count',
];

// ─── § 8.2 the sanitized error envelope ───────────────────────────────────────

/** The only fields an error may carry, on any surface (10O § 8.2). Closed. */
export const BRAZIL_RECEITA_GATE5_ERROR_ENVELOPE_FIELDS = [
  'error_code',
  'failed_stage',
  'safe_counts',
  'file_family',
  'gate_name',
  'safety_flags',
  'cleanup_status',
] as const;

export type BrazilReceitaGate5ErrorEnvelopeField =
  (typeof BRAZIL_RECEITA_GATE5_ERROR_ENVELOPE_FIELDS)[number];

/**
 * The closed controlled error codes. `unclassified_failure` is the fail-closed catch-all 10O § 8.4
 * requires: an error the boundary cannot classify becomes this, never a pass-through.
 */
export const BRAZIL_RECEITA_GATE5_ERROR_CODES = [
  'forbidden_output_detected',
  'forbidden_key_detected',
  'forbidden_value_detected',
  'allowlist_violation',
  'small_cell_suppression_failed',
  'cross_tabulation_attempted',
  'manifest_invalid',
  'layout_mismatch',
  'forbidden_file_family',
  'resource_cap_exceeded',
  'cleanup_failed',
  'gate_preflight_failed',
  'operator_cancelled',
  'unclassified_failure',
] as const;

export type BrazilReceitaGate5ErrorCode = (typeof BRAZIL_RECEITA_GATE5_ERROR_CODES)[number];

export const BRAZIL_RECEITA_GATE5_GENERIC_ERROR_CODE: BrazilReceitaGate5ErrorCode =
  'unclassified_failure';

/** Sanitization happens at CONSTRUCTION, never at print time (`OS-A35`). */
export const BRAZIL_RECEITA_GATE5_SANITIZE_AT_CONSTRUCTION = true as const;

/** The boundary never reports its own input (10O § 8.3). It reports a code and a count. */
export const BRAZIL_RECEITA_GATE5_SANITIZER_REPORTS_ITS_INPUT = false as const;

// ─── § 11 the closed log field set ────────────────────────────────────────────

/** The only keys a log event may carry (10O § 11). There is no free-form message field. */
export const BRAZIL_RECEITA_GATE5_LOG_EVENT_FIELDS = [
  'stage',
  'safe_enum',
  'aggregate_count',
  'elapsed_ms',
  'resource_usage_bucket',
  'safety_flag',
  'error_code',
  'cleanup_status',
  'gate_name',
] as const;

export type BrazilReceitaGate5LogEventField =
  (typeof BRAZIL_RECEITA_GATE5_LOG_EVENT_FIELDS)[number];

/** Log cardinality is per-stage, never per-record: the count itself is a disclosure (10O § 11). */
export const BRAZIL_RECEITA_GATE5_PER_RECORD_LOG_LINES_PERMITTED = false as const;

/** No format-string interpolation of source-derived variables. The mechanism is what is forbidden. */
export const BRAZIL_RECEITA_GATE5_LOG_INTERPOLATION_PERMITTED = false as const;

// ─── § 12 the gate evidence contract ──────────────────────────────────────────

/** What gate evidence and operator summaries may carry (10O § 12). Closed. */
export const BRAZIL_RECEITA_GATE5_EVIDENCE_ALLOWED_CONTENT = [
  'aggregate_report',
  'gate_status_list',
  'safety_booleans_all_false',
  'validation_command_names',
  'non_dataset_derived_checksums',
  'proof_of_no_writes',
  'assertion_ids_and_pass_state',
] as const;

/** What it may never carry. A leak in evidence resets the affected gates (10O § 12). */
export const BRAZIL_RECEITA_GATE5_EVIDENCE_FORBIDDEN_CONTENT = [
  'sample_rows',
  'screenshots_with_raw_values',
  'copied_terminal_rows',
  'identifiers',
  'identifier_hashes_or_truncations',
  'real_manifest',
  'join_key_samples',
  'identity_key_samples',
  'raw_command_output',
  'paths',
  'raw_exceptions',
  'stack_traces',
] as const;

/** Evidence is assembled only from artifacts that already passed the report and log contracts. */
export const BRAZIL_RECEITA_GATE5_EVIDENCE_ASSEMBLED_FROM_PASSED_ARTIFACTS_ONLY = true as const;

// ─── The frozen GATE-5 contract, after the cleanup ────────────────────────────

/**
 * The whole GATE-5 contract in one closed table, as the approvers must review it.
 *
 * 🔴 This is a VIEW assembled for review, and every row is DERIVED from the constant that owns it
 * rather than restated — the round's suite asserts each derivation, so this table cannot claim a
 * value the contract does not hold. A summary that can disagree with its source is worse than no
 * summary, because it is the one a reviewer reads.
 */
export const BRAZIL_RECEITA_GATE5_FROZEN_CONTRACT = {
  SMALL_CELL_K: BRAZIL_RECEITA_GATE5_SMALL_CELL_K,
  MAX_OUTPUT_STRING_LENGTH: BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH,
  CROSS_TABULATIONS: 'PROHIBITED',
  NAMED_MUNICIPALITIES: 'PROHIBITED',
  TOTAL_ROWS_SCANNED: 'INTERNAL_ONLY',
  CNAE_SECTION_COUNTS: 'ALLOWED_WITH_SMALL_CELL_SUPPRESSION',
  UF_COUNTS: 'ALLOWED_WITH_SMALL_CELL_SUPPRESSION',
  CAPITAL_SOCIAL_BREAKDOWN: 'EXCLUDED',
  OPENED_AT_BREAKDOWN: 'EXCLUDED',
  MUNICIPALITY_BREAKDOWN: 'EXCLUDED',
  STACK_OUTPUT: 'PROHIBITED',
  RAW_ROWS: 'PROHIBITED',
  RAW_CELLS: 'PROHIBITED',
  IDENTITY_KEYS: 'PROHIBITED',
  RECORDS_PERSISTED_OUTPUT_KEY: 'records_persisted',
  RECORDS_SEEN_BY_FAMILY_OUTPUT_KEY: 'records_seen_by_family',
  SMALL_CELL_RESIDUAL_KEY: BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL,
} as const;

/**
 * The two halves stay two halves. Recorded as data because "simplify by merging them" is the single
 * most plausible future refactor and the one that would remove the property that makes the contract
 * work: an allowlist cannot be evaded by novelty, a denylist cannot be evaded by a name nobody
 * thought of, and neither substitutes for the other.
 */
export const BRAZIL_RECEITA_GATE5_LIST_INDEPENDENCE = {
  allowlistIsAuthoritative: true,
  denylistIsAnIndependentSecondNet: true,
  listsMergedIntoOne: false,
  unnecessaryExceptionsBetweenThem: 0,
} as const;

// ─── The digit-run safety layers, kept separate on purpose ────────────────────

/**
 * Which authoritative layer fails a digit run of each length CLOSED.
 *
 * 🔴 The two contracts are NOT merged into one regex, and this table is not a merged regex either —
 * it is a map from a run length to the layer that already refuses it. 10O § 5.3 froze `VP-1` … `VP-4`
 * at exactly 8, 11, 14 and >14 positions and warned that widening them indiscriminately manufactures
 * false positives. BR-SOURCE-11A's `LONG_DIGIT_RUN` independently matches 8-or-more. Together they
 * leave no length uncovered; separately, each keeps its own frozen wording and its own authority.
 *
 * 🔴 `gate5VpRules` being empty for 9, 10, 12 and 13 is the RESIDUAL GAP, not a bug — and 11A being
 * the only cover for those four lengths is exactly why 11A is load-bearing rather than redundant. The
 * round's suite asserts every length below fails through at least one layer by EXECUTING both, never
 * by reading this table.
 */
export const BRAZIL_RECEITA_GATE5_DIGIT_RUN_SAFETY_LAYERS = [
  { runLength: 8, gate5VpRules: ['VP-1'] as readonly string[], sanitizer11ALongDigitRun: true },
  { runLength: 9, gate5VpRules: [] as readonly string[], sanitizer11ALongDigitRun: true },
  { runLength: 10, gate5VpRules: [] as readonly string[], sanitizer11ALongDigitRun: true },
  { runLength: 11, gate5VpRules: ['VP-2'] as readonly string[], sanitizer11ALongDigitRun: true },
  { runLength: 12, gate5VpRules: [] as readonly string[], sanitizer11ALongDigitRun: true },
  { runLength: 13, gate5VpRules: [] as readonly string[], sanitizer11ALongDigitRun: true },
  { runLength: 14, gate5VpRules: ['VP-3'] as readonly string[], sanitizer11ALongDigitRun: true },
  { runLength: 15, gate5VpRules: ['VP-4'] as readonly string[], sanitizer11ALongDigitRun: true },
] as const;

/** The frozen VP rules are not widened here, and the two contracts are not merged. */
export const BRAZIL_RECEITA_GATE5_VP_RULES_WIDENED_BY_THIS_ROUND = false as const;
export const BRAZIL_RECEITA_GATE5_DIGIT_RUN_CONTRACTS_MERGED = false as const;
