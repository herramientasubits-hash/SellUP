/**
 * BR Receita CNPJ — GATE-3 residual blocker RB-3: the four unlabelled fields, LABELLED
 * (BR-SOURCE-GATE-ROUND-2).
 *
 * BR-SOURCE-GATE-ROUND-1 recorded the GATE-3 field policy and left RB-3 open: five payload keys
 * (`legal_nature_code`, `legal_nature_label`, `matrix_branch_flag`, `simples_opt_in`,
 * `simei_opt_in`, `mei_flag` — counted as four items in that record because two pairs travel
 * together) were emitted by the sanitized snapshot output but named nowhere in the owners' include
 * set. 10K § 7's pass criteria require **nothing unlabelled**, so the gate could not pass while
 * they sat between the include set and the denylist.
 *
 * This module labels them. It is the RB-3 closure and nothing more.
 *
 * ── 🔴 The claim this module CORRECTS ────────────────────────────────────────
 *
 * Round 1 declined to touch these fields with a stated reason:
 *
 *   > `mei_flag` is the § 5 R5 control marker, and removing a privacy control for being absent from
 *   > an include list of privacy-relevant output would weaken the very thing the list protects.
 *
 * The caution was right; the premise was **false**, and it was checked rather than assumed.
 * `raw_data.mei_flag` enforces nothing. Its only non-test consumer in the entire repository is a
 * COUNT (`meiFlaggedRows` in the parser summary). The R5 person-risk exclusion is enforced somewhere
 * else entirely: `br-receita-cnpj-privacy-safe-classifier.ts` reads *natureza jurídica* straight off
 * the EMPRESAS source row and maps `mei_or_individual_entrepreneur_signal` →
 * `excluded_person_or_pii_risk` through `classifyLegalNatureRiskClass`. That path never reads the
 * snapshot payload, so taking these keys out of the persisted business payload cannot weaken it.
 *
 * `BRAZIL_RECEITA_RB3_R5_ENFORCEMENT_POINT` records where the control actually lives, so the next
 * reader does not have to re-discover it, and a test asserts the enforcement module still owns it.
 *
 * ── The principle applied ────────────────────────────────────────────────────
 *
 * A privacy/control field used only to EXCLUDE risky entities does not become a business-facing
 * snapshot attribute merely because the parser computes it. Fields in that class are kept
 * INTERNAL — computable, countable, and reachable by the controls that need them — and removed from
 * the persisted business payload. Nothing is deleted to make a checklist green: every classification
 * below either keeps the field's control role or states, on the record, that no control consumes it.
 *
 * ── Authority, stated precisely ──────────────────────────────────────────────
 *
 * These are PRODUCT / DATA classifications, made under the product-data half of GATE-3's joint
 * approval. They are NOT legal/privacy determinations, and this module records none: see
 * `BRAZIL_RECEITA_RB3_CLASSIFICATION_AUTHORITY`. Where a field could only be *widened* into output
 * by a legal/privacy judgment, the fail-closed direction is taken instead — 10K § 7's own rule is
 * "free-text fields fail closed — not on the allowlist means excluded".
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - approves a gate. RB-3 closure is one of GATE-3's pass criteria, not the gate.
 *   - widens the owners' include set with a field the owners excluded.
 *   - authorizes persistence, an import, a Supabase write, a migration, a runtime path, Agent 1,
 *     Agent 2A or a provider call.
 *   - carries a personal name, a signature, a mail address, a real path, a CNPJ or a CPF.
 */

// ─── The four dispositions ────────────────────────────────────────────────────

/**
 * The only four labels RB-3 may end on. Deliberately closed: a fifth would be the "unlabelled"
 * state RB-3 exists to eliminate, wearing a name.
 *
 * `INCLUDED_OUTPUT`                — survives into the persisted business payload.
 * `INTERNAL_PRIVACY_CONTROL_ONLY`  — computed and reachable by controls, never persisted as a
 *                                    business attribute.
 * `EXCLUDED_OUTPUT`                — not persisted and consumed by no control; excluded outright.
 * `NOT_IMPLEMENTED`                — the parser does not produce it at all.
 */
export type BrazilReceitaRb3Classification =
  | 'INCLUDED_OUTPUT'
  | 'INTERNAL_PRIVACY_CONTROL_ONLY'
  | 'EXCLUDED_OUTPUT'
  | 'NOT_IMPLEMENTED';

export const BRAZIL_RECEITA_RB3_CLASSIFICATIONS: readonly BrazilReceitaRb3Classification[] = [
  'INCLUDED_OUTPUT',
  'INTERNAL_PRIVACY_CONTROL_ONLY',
  'EXCLUDED_OUTPUT',
  'NOT_IMPLEMENTED',
] as const;

/**
 * Who decided, and who did not. GATE-3 needs a product/data owner AND a legal/privacy owner
 * jointly; this module carries only the first half, and says so rather than letting a reader infer
 * a completed joint decision from a completed classification.
 */
export const BRAZIL_RECEITA_RB3_CLASSIFICATION_AUTHORITY = {
  decidedBy: 'product_data_owner',
  legalPrivacyDeterminationRecorded: false,
  decidedByAgent: false,
  recordedDate: '2026-08-21',
} as const;

/**
 * Where the GATE-1 R5 person-risk exclusion is ACTUALLY enforced. Recorded as data so the Round-1
 * premise cannot be reintroduced by a reader who assumes the payload flag is load-bearing.
 */
export const BRAZIL_RECEITA_RB3_R5_ENFORCEMENT_POINT = {
  module: 'br-receita-cnpj-privacy-safe-classifier',
  entryPoint: 'classifyLegalNatureRiskClass',
  readsFrom: 'empresas_source_row_natureza_juridica',
  readsSnapshotPayload: false,
  terminalDisposition: 'excluded_person_or_pii_risk',
} as const;

/** The only non-test consumer `raw_data.mei_flag` ever had. Kept, and it needs no payload key. */
export const BRAZIL_RECEITA_RB3_MEI_FLAG_ONLY_CONSUMER =
  'parser_summary_mei_flagged_rows_count' as const;

// ─── The classifications ──────────────────────────────────────────────────────

export interface BrazilReceitaRb3FieldClassification {
  /** The payload key as the parser emitted it before this round. */
  readonly field: string;
  readonly classification: BrazilReceitaRb3Classification;
  /** Why this label and not another. Never a summary — a summarized reason is how a bound drifts. */
  readonly reason: string;
  /** True when a control genuinely reads this field after this round. */
  readonly consumedByControl: boolean;
}

/**
 * RB-3, closed. Six payload keys, six labels, no gaps.
 *
 * The two `legal_nature_*` keys land on DIFFERENT labels on purpose, and that asymmetry is the one
 * judgment in this table most worth reading twice:
 *
 *   - `legal_nature_code` is what a risk classifier consumes. It is also person-risk-BEARING: MEI
 *     and empresário individual ARE legal natures, so the code can say "this entity is a natural
 *     person in commercial clothing". Keeping it internal preserves the control and publishes
 *     nothing.
 *   - `legal_nature_label` is a human rendering of that same code. No control reads it, and it
 *     carries the identical person-risk semantics in a more legible form. It is not on the owners'
 *     include set, 10M leaves company-context fields `needs_legal_review`, and 10K § 7 says
 *     unallowlisted means excluded. So it is excluded, not quietly promoted.
 *
 * `matrix_branch_flag` is the only one that becomes business-facing, and it is the one field here
 * with no person-risk semantics at all: it comes from its own source column
 * (`identificador_matriz_filial`), it is never derived from the CNPJ, and under the identity grain
 * recorded in GATE-4 it is the marker that tells a consumer whether an operational unit is the
 * headquarters or a branch. That is a company attribute, and it is the grain's own signal.
 */
export const BRAZIL_RECEITA_RB3_FIELD_CLASSIFICATIONS = [
  {
    field: 'legal_nature_code',
    classification: 'INTERNAL_PRIVACY_CONTROL_ONLY',
    reason:
      'natureza jurídica code: the input the R5 person-risk classifier reads, and itself person-risk-bearing because MEI and empresário individual are legal natures. Kept reachable by the control, removed from the persisted business payload.',
    consumedByControl: true,
  },
  {
    field: 'legal_nature_label',
    classification: 'EXCLUDED_OUTPUT',
    reason:
      'a human rendering of a person-risk-bearing code that no control consumes. Absent from the owners include set, and 10M leaves company-context fields needs_legal_review, so 10K § 7 fail-closed excludes it rather than an agent widening the allowlist.',
    consumedByControl: false,
  },
  {
    field: 'matrix_branch_flag',
    classification: 'INCLUDED_OUTPUT',
    reason:
      'identificador_matriz_filial: its own source column, never derived from the CNPJ, carrying no person-risk semantics, and the headquarters-versus-branch marker the recorded identity grain needs a consumer to be able to read. A company attribute.',
    consumedByControl: false,
  },
  {
    field: 'simples_opt_in',
    classification: 'INTERNAL_PRIVACY_CONTROL_ONLY',
    reason:
      'SIMPLES regime flag: one of the two inputs behind the MEI determination. No owner reason to expose a tax-regime flag as a business attribute was recorded, and exposing one without an explicit owner reason is exactly what this round refuses to do.',
    consumedByControl: true,
  },
  {
    field: 'simei_opt_in',
    classification: 'INTERNAL_PRIVACY_CONTROL_ONLY',
    reason:
      'SIMEI regime flag: the second input behind the MEI determination, and the nearer of the two to a natural-person signal. Same disposition as simples_opt_in, for the stronger version of the same reason.',
    consumedByControl: true,
  },
  {
    field: 'mei_flag',
    classification: 'INTERNAL_PRIVACY_CONTROL_ONLY',
    reason:
      'the GATE-1 R5 marker. It stays computed and stays counted; it leaves the persisted business payload. Enforcement was never here — see BRAZIL_RECEITA_RB3_R5_ENFORCEMENT_POINT — so removing the payload key weakens no control.',
    consumedByControl: true,
  },
] as const satisfies readonly BrazilReceitaRb3FieldClassification[];

/**
 * No RB-3 field is `NOT_IMPLEMENTED`, and that is a finding rather than an omission: all six are
 * implemented and populated by the parser today. `NOT_IMPLEMENTED` stays in the vocabulary because
 * the GATE-3 policy already uses that shape elsewhere (`trade_name` is
 * `EXCLUDED_NOT_IMPLEMENTED`), and a classification set that could not express it would push a
 * future unimplemented field back into the unlabelled state RB-3 just closed.
 */
export const BRAZIL_RECEITA_RB3_UNUSED_CLASSIFICATIONS: readonly BrazilReceitaRb3Classification[] =
  ['NOT_IMPLEMENTED'] as const;

// ─── Mechanical completeness ──────────────────────────────────────────────────

/**
 * The owners' include set is a list of DATA SIGNALS in prose — "CNAE approved fields", "provenance",
 * "company size" — not payload keys. The Round-1 record admitted as much and carried the delta as an
 * open item. That prose-to-key gap is why "nothing unlabelled" could not be CHECKED, only argued.
 *
 * This map closes it: every key the sanitized payload emits is bound either to the include-set entry
 * that covers it or to its RB-3 classification. A test walks the real emitted payload against this
 * map, so a key added later without a label fails a test instead of passing a review.
 */
export type BrazilReceitaPayloadKeyDisposition =
  | { readonly via: 'include_set'; readonly entry: string }
  | { readonly via: 'rb3'; readonly classification: BrazilReceitaRb3Classification }
  | { readonly via: 'provenance'; readonly entry: 'provenance' };

export const BRAZIL_RECEITA_GATE3_PAYLOAD_KEY_DISPOSITION: Readonly<
  Record<string, BrazilReceitaPayloadKeyDisposition>
> = {
  // Provenance, named as a GROUP by the owners.
  source_type: { via: 'provenance', entry: 'provenance' },
  human_review_required: { via: 'provenance', entry: 'provenance' },
  parser_version: { via: 'provenance', entry: 'provenance' },
  source_row_index: { via: 'provenance', entry: 'provenance' },
  source_file_name: { via: 'provenance', entry: 'provenance' },
  source_downloaded_at: { via: 'provenance', entry: 'provenance' },
  import_batch_id: { via: 'provenance', entry: 'provenance' },

  // Named include-set entries.
  source_period: { via: 'include_set', entry: 'source period' },
  company_size_code: { via: 'include_set', entry: 'company size' },
  capital_social_value: { via: 'include_set', entry: 'capital_social_value' },
  registration_status_code: { via: 'include_set', entry: 'registration status' },
  registration_status_label: { via: 'include_set', entry: 'registration status' },
  cnae_main_code: { via: 'include_set', entry: 'CNAE approved fields' },
  cnae_main_label: { via: 'include_set', entry: 'CNAE approved fields' },
  cnae_secondary_codes: { via: 'include_set', entry: 'CNAE approved fields' },
  municipality_code: { via: 'include_set', entry: 'municipality' },
  municipality_name: { via: 'include_set', entry: 'municipality' },
  uf: { via: 'include_set', entry: 'UF' },
  start_date: { via: 'include_set', entry: 'opened_at' },

  // RB-3, now labelled. Only the INCLUDED_OUTPUT one still appears in the payload.
  matrix_branch_flag: { via: 'rb3', classification: 'INCLUDED_OUTPUT' },
} as const;

/**
 * The RB-3 keys that must NO LONGER appear in the persisted business payload after this round.
 * Derived from the classifications rather than hand-listed, so the two cannot drift apart.
 */
export const BRAZIL_RECEITA_RB3_KEYS_REMOVED_FROM_PAYLOAD: readonly string[] =
  BRAZIL_RECEITA_RB3_FIELD_CLASSIFICATIONS.filter(
    (entry) => entry.classification !== 'INCLUDED_OUTPUT',
  ).map((entry) => entry.field);

/** The RB-3 keys that survive into the persisted business payload. */
export const BRAZIL_RECEITA_RB3_KEYS_KEPT_IN_PAYLOAD: readonly string[] =
  BRAZIL_RECEITA_RB3_FIELD_CLASSIFICATIONS.filter(
    (entry) => entry.classification === 'INCLUDED_OUTPUT',
  ).map((entry) => entry.field);

export type BrazilReceitaPayloadLabelFinding = {
  readonly key: string;
  readonly problem: 'unlabelled' | 'labelled_but_must_not_be_emitted';
};

/**
 * Checks a set of emitted payload keys against the disposition map. Pure, and the only thing that
 * makes 10K § 7's "nothing unlabelled" criterion assertable rather than arguable.
 *
 * Two failure modes, kept apart because they need different fixes: a key nobody labelled, and a key
 * that WAS labelled as non-output yet is still being emitted.
 */
export function findBrazilReceitaUnlabelledPayloadKeys(
  emittedKeys: readonly string[],
): readonly BrazilReceitaPayloadLabelFinding[] {
  const findings: BrazilReceitaPayloadLabelFinding[] = [];
  const removed = new Set(BRAZIL_RECEITA_RB3_KEYS_REMOVED_FROM_PAYLOAD);

  for (const key of emittedKeys) {
    if (removed.has(key)) {
      findings.push({ key, problem: 'labelled_but_must_not_be_emitted' });
      continue;
    }
    if (BRAZIL_RECEITA_GATE3_PAYLOAD_KEY_DISPOSITION[key] === undefined) {
      findings.push({ key, problem: 'unlabelled' });
    }
  }

  return findings;
}

/** Convenience predicate: is RB-3 discharged for this emitted key set? */
export function brazilReceitaRb3IsClosedForPayload(emittedKeys: readonly string[]): boolean {
  return findBrazilReceitaUnlabelledPayloadKeys(emittedKeys).length === 0;
}
