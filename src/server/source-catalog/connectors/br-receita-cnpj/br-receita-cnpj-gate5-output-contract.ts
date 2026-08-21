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
 * ── 🔴 Two collisions the owner values create, recorded and NOT resolved here ─
 *
 * `TOTAL_ROWS_SCANNED = ALLOWED` collides with two invariants that already exist and that this
 * round deliberately does not weaken. Both are recorded in
 * `BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS` and both are owner decisions:
 *
 *   · `BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF` (BR-SOURCE-11A) rejects any numeric leaf beyond
 *     9,999,999. A national row total is larger than that by an order of magnitude.
 *   · `VP-1` / `VP-4` reject digit runs of 8 and of more than 14 positions. A national row total
 *     RENDERED into the JSON surface is an 8-digit run, and the rendered-output check sees it.
 *
 * Neither is a defect in this contract or in 11A. They are the same fact twice: an exact
 * dataset-scale figure and a rule against long digit runs cannot both hold on the same surface. The
 * approvers choose — a bucket, or an explicit carve-out for one named key. This module refuses to
 * choose, and the guard fails CLOSED in the meantime.
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

/** The single residual label a suppressed family may merge into (10O § 7). Nothing else. */
export const BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL = 'other_or_suppressed_small_cell' as const;

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
  | 'excluded'
  | 'prohibited';

export const BRAZIL_RECEITA_GATE5_AGGREGATE_DISPOSITIONS: Readonly<
  Record<string, BrazilReceitaGate5AggregateDisposition>
> = {
  total_rows_scanned: 'allowed',
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
 * The two collisions the owner values create with invariants that already exist. Recorded as data,
 * unresolved on purpose, and named by their REAL owning symbols rather than by a shorthand.
 */
export const BRAZIL_RECEITA_GATE5_OWNER_DIRECTION_COLLISIONS = [
  {
    id: 'OD-C1',
    ownerDirection: 'TOTAL_ROWS_SCANNED = ALLOWED',
    collidesWith: 'BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF',
    owningModule: 'br-receita-cnpj-full-join-output-sanitizer (BR-SOURCE-11A)',
    detail:
      'the 11A sanitizer rejects any numeric leaf beyond 9,999,999 as oversized_numeric_value; a national row total exceeds it',
    resolvedByThisRound: false,
    weakenedByThisRound: false,
    ownerChoice:
      'report total_rows_scanned as a bucket, OR record an explicit named-key carve-out from the numeric ceiling',
  },
  {
    id: 'OD-C2',
    ownerDirection: 'TOTAL_ROWS_SCANNED = ALLOWED',
    collidesWith: 'VP-1 and VP-4',
    owningModule: 'this contract, § 5.3 of BR-SOURCE-10O',
    detail:
      'an exact national row total rendered onto the JSON surface is a digit run the digit-run rules reject; the rendered-output check sees the rendered form, not the integer',
    resolvedByThisRound: false,
    weakenedByThisRound: false,
    ownerChoice:
      'report total_rows_scanned as a bucket, OR record an explicit named-key carve-out from the digit-run rules on the rendered surface',
  },
  {
    id: 'OD-C3',
    ownerDirection: 'the § 7 residual bucket label is other_or_suppressed_small_cell',
    collidesWith: 'the § 5.2 closed denylist, group 7',
    owningModule: 'this contract — 10O § 7 names the label, 10O § 5.2 group 7 forbids the substring',
    detail:
      "group 7 substring-matches `cell`, and the mandated residual label contains it; the one label small-cell suppression is REQUIRED to emit is refused by the same record's key rule",
    resolvedByThisRound: false,
    weakenedByThisRound: false,
    ownerChoice:
      'rename the residual label to a cell-free form, OR record it as a contract-named exemption — this round admits it under the allowlist-governs precedence and changes neither list',
  },
] as const;

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
 * 🔴 Groups 4 and 7 over-match on purpose. `cnpj_root_count` and `rows_seen_by_family` are caught.
 * The resolution 10O § 5.2 records is to RENAME the aggregate, never to weaken the matcher — and
 * structurally it does not matter, because § 6 is an allowlist and admission comes from being named
 * there. Where allowlist and denylist disagree about a key in neither, the key is forbidden.
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
 * Groups 4 and 7 over-match on purpose, and three keys the frozen § 6 allowlist REQUIRES —
 * `persisted_rows`, `rows_seen_by_family` and `total_rows_scanned` — trip group 7's `row` substring.
 * Without this precedence the contract's two halves refuse each other and the frozen report is
 * un-emittable by its own rules.
 *
 * 🔴 Note which key is in that set: `total_rows_scanned`, the same field `OD-C1` and `OD-C2` already
 * name. It is refused by three separate rules of the record that allows it. Three independent
 * refusals of one owner-allowed field is a signal about the field, and the approvers should read it
 * that way rather than as three separate carve-outs to grant.
 */
export const BRAZIL_RECEITA_GATE5_ALLOWLIST_GOVERNS = true as const;

/**
 * The allowlisted keys that trip a denylist group, enumerated. Not an exception list the guard reads
 * — the precedence above handles them structurally — but the EVIDENCE that the precedence is
 * load-bearing rather than theoretical, and the set the approvers should look at.
 */
export const BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST: readonly string[] = [
  'persisted_rows',
  'rows_seen_by_family',
  'total_rows_scanned',
];

// ─── § 6 the closed aggregate allowlist ───────────────────────────────────────

/**
 * The frozen allowlist. A key absent from this set is FORBIDDEN even when it survives every
 * denylist rule — which is what makes `OS-A08` the load-bearing assertion 10O § 5.4 says it is.
 *
 * 🔴 Three keys 10O § 6 listed are deliberately ABSENT: `capital_social_bucket_counts`,
 * `opened_at_bucket_counts` and `municipality_count_distribution`. The owner excluded those
 * breakdowns, so their absence is the exclusion being enforced rather than an omission.
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
  'persisted_rows',
  'safety',
  // Volume and provenance counters
  'files_seen',
  'file_family_counts',
  'file_families_accepted',
  'file_families_rejected',
  'rows_seen_by_family',
  'total_rows_scanned',
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
  'rows_seen_by_family',
];

/**
 * Run-level fields suppression does NOT touch: they describe the run, not the records (10O § 7).
 * Listing them is what stops a future author suppressing `persisted_rows: 0` as a "small cell".
 */
export const BRAZIL_RECEITA_GATE5_SUPPRESSION_EXEMPT_KEYS: readonly string[] = [
  'persisted_rows',
  'safety',
  'duration_ms',
  'total_rows_scanned',
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
