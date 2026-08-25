/**
 * BR Receita CNPJ — local/sample parser types.
 *
 * Hito: BR-SOURCE-2 — Receita CNPJ local/sample parser.
 *
 * Shapes for the raw source rows (EMPRESAS / ESTABELECIMENTOS / SIMPLES /
 * reference lookups) the local/sample parser consumes, plus the sanitized
 * snapshot output aligned with `source_company_snapshots` (data-contract § 5).
 *
 * The raw ESTABELECIMENTOS row DELIBERATELY declares the source's contact and
 * fine-grained-address fields so tests can prove the parser never maps them
 * into the output. SOCIOS/QSA/CPF are NOT modeled here at all — they are a
 * separate, categorically excluded file (§ 5.3); their presence is a
 * fail-closed error, not a field.
 */

import type { RecordIdentityKey } from '../../record-identity';

export const BR_RECEITA_CNPJ_SOURCE_KEY = 'br_receita_cnpj_dados_abertos' as const;
export const BR_RECEITA_CNPJ_COUNTRY_CODE = 'BR' as const;
export const BR_RECEITA_CNPJ_PARSER_VERSION = 'br-receita-cnpj-local-sample@1' as const;

// ─── Raw source rows (synthetic local/sample only) ──────────────────────────

/** EMPRESAS file — root (raiz) grain, company-level attributes. */
export interface BrReceitaEmpresaRow {
  cnpj_basico: string;
  razao_social?: string | null;
  natureza_juridica?: string | null;
  porte_empresa?: string | null;
  capital_social?: string | null;
}

/**
 * ESTABELECIMENTOS file — establishment grain (one row per full CNPJ).
 * Contact and fine-address fields are declared because the real source carries
 * them; the parser MUST exclude them from output (§ 5.3).
 */
export interface BrReceitaEstabelecimentoRow {
  cnpj_basico: string;
  cnpj_ordem: string;
  cnpj_dv: string;
  identificador_matriz_filial?: string | null;
  situacao_cadastral?: string | null;
  cnae_fiscal_principal?: string | null;
  cnae_fiscal_secundaria?: string | null;
  data_inicio_atividade?: string | null;
  municipio?: string | null;
  uf?: string | null;

  // Contact fields — EXCLUDED from output (§ 5.3). Present here only so tests
  // can assert they never leak.
  ddd_1?: string | null;
  telefone_1?: string | null;
  ddd_2?: string | null;
  telefone_2?: string | null;
  ddd_fax?: string | null;
  fax?: string | null;
  correio_eletronico?: string | null;

  // Fine-grained street address — EXCLUDED from output (§ 5.3, MVP = municipio/uf only).
  tipo_logradouro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cep?: string | null;
}

/** SIMPLES file — regime flags only (booleans/codes), never personal data. */
export interface BrReceitaSimplesRow {
  cnpj_basico: string;
  /** 'S' | 'N' as in the source. */
  opcao_simples?: string | null;
  /** 'S' | 'N' as in the source. */
  opcao_mei?: string | null;
}

/** Reference catalog row (CNAE / município / natureza jurídica code → label). */
export interface BrReceitaLookupRow {
  codigo: string;
  descricao: string;
}

// ─── Parser input ────────────────────────────────────────────────────────────

export interface BrReceitaCnpjParserInput {
  /**
   * Calendar year of the dataset — explicit input, never hardcoded (§ 7).
   *
   * 🔴 BR-SOURCE-FUNCTIONAL-CUT-A — `sourcePeriod` is now the AUTHORITY and this is the
   * subordinate. The generic table's `source_year int NOT NULL` predates the monthly grain and
   * still has to be populated, so the year survives — but the builder REJECTS an input whose year
   * disagrees with its period, and migration 126 pins the same equality as a CHECK. The two can be
   * supplied independently; they can never disagree silently.
   */
  sourceYear: number;
  /**
   * 🔴 REQUIRED monthly period, canonical `YYYY-MM` (BR-SOURCE-FUNCTIONAL-CUT-A).
   *
   * It was optional while it only decorated `raw_data`. It is now the physical identity dimension
   * of the row: `source_key` + `country_code` + `source_period` + the exact CNPJ is what makes one
   * logical monthly snapshot. A period-less Brazil row can no longer be built, which is the whole
   * point — a nullable period is what made the old uniqueness vacuous.
   */
  sourcePeriod: string;
  empresasRows: BrReceitaEmpresaRow[];
  estabelecimentosRows: BrReceitaEstabelecimentoRow[];
  simplesRows?: BrReceitaSimplesRow[];
  cnaesRows?: BrReceitaLookupRow[];
  municipiosRows?: BrReceitaLookupRow[];
  naturezasRows?: BrReceitaLookupRow[];
  // Provenance metadata (propagated to raw_data only if present).
  sourceFileName?: string;
  sourceDownloadedAt?: string;
  importBatchId?: string;
}

// ─── Sanitized snapshot output (allowlist only — data-contract § 5.2) ────────

export interface BrReceitaCnpjSnapshotRawData {
  source_type: 'official_registry';
  human_review_required: true;
  parser_version: typeof BR_RECEITA_CNPJ_PARSER_VERSION;
  /**
   * The period, as APPROVED GATE-3 provenance (`include_set` entry "source period") and GATE-5
   * output allowlist member. No longer nullable: the period is required.
   *
   * 🔴 This is provenance, NOT the identity. `BrReceitaCnpjSnapshotRow.source_period` is the
   * physical identity column and the authority. Both are written from the same validated value,
   * and migration 126 carries a CHECK that `raw_data->>'source_period' = source_period` for Brazil
   * rows, so the copy can never drift from the column that identifies the snapshot.
   */
  source_period: string;
  source_row_index: number;
  source_file_name?: string;
  source_downloaded_at?: string;
  import_batch_id?: string;

  // Hierarchy.
  //
  // 🔴 BR-SOURCE-GATE-ROUND-1 — `cnpj_root`, `cnpj_order` and `cnpj_dv` were REMOVED. This block is
  // labelled "sanitized snapshot output (allowlist only)" above, and that claim was false while it
  // carried them: `cnpj_root` IS the CNPJ básico, and the three together reconstruct the full
  // 14-position CNPJ exactly. The recorded GATE-3 field policy prohibits all three by name, plus
  // "reconstructable CNPJ parts".
  //
  // Nothing replaces them. No root surrogate, no bucket, no hash: the owners' include set names no
  // root grouping key, and inventing one would be an agent widening an allowlist.
  //
  // `matrix_branch_flag` STAYS. It comes from its own source column (identificador_matriz_filial)
  // and is not derived from the CNPJ — a matriz/filial marker is one bit about a record, not a
  // fragment of its identifier.
  //
  // 🔴 BR-SOURCE-GATE-ROUND-2 (RB-3) — it is now LABELLED `INCLUDED_OUTPUT` rather than merely
  // tolerated, and under the GATE-4 identity grain it is also the headquarters-versus-branch marker
  // a consumer needs to read. See `br-receita-cnpj-gate3-residual-field-classification.ts`.
  matrix_branch_flag: string | null; // identificador_matriz_filial (1=matriz/2=filial)

  // Company (from EMPRESAS + reference labels).
  //
  // 🔴 BR-SOURCE-GATE-ROUND-2 (RB-3) — `legal_nature_code` and `legal_nature_label` were REMOVED
  // from this block. The code is person-risk-BEARING (MEI and empresário individual are legal
  // natures) and is the input the R5 risk classifier reads, so it is now
  // `INTERNAL_PRIVACY_CONTROL_ONLY` and travels on `BrReceitaCnpjInternalControlSignals`. The label
  // is a legible rendering of the same semantics that no control consumes, so it is
  // `EXCLUDED_OUTPUT`. Neither is deleted from the pipeline; both leave the PERSISTED payload.
  company_size_code: string | null;
  capital_social_value: string | null;

  // Establishment status.
  registration_status_code: string | null;
  registration_status_label: string | null;

  // Activity.
  cnae_main_code: string | null;
  cnae_main_label: string | null;
  cnae_secondary_codes: string[];

  // Coarse location only.
  municipality_code: string | null;
  municipality_name: string | null;
  uf: string | null;

  start_date: string | null;

  // 🔴 BR-SOURCE-GATE-ROUND-2 (RB-3) — the regime flags (`simples_opt_in`, `simei_opt_in`) and the
  // MEI marker (`mei_flag`) were REMOVED from this block. All three are
  // `INTERNAL_PRIVACY_CONTROL_ONLY`: they are the machinery behind the R5 person-risk exclusion, not
  // business attributes, and no owner reason to publish a tax-regime flag was ever recorded.
  //
  // They are NOT deleted. They travel on `BrReceitaCnpjInternalControlSignals`, which is reachable
  // from the parser RESULT and deliberately NOT from the row — so a future writer building from a
  // row cannot persist them even by accident.
}

/**
 * The internal control signals for one accepted row (BR-SOURCE-GATE-ROUND-2, RB-3).
 *
 * 🔴 Deliberately NOT a member of `BrReceitaCnpjSnapshotRow` and NOT a member of
 * `BrReceitaCnpjSnapshotRawData`. That is the whole design: a writer is handed rows, so a signal
 * that is not ON a row cannot be persisted by a writer that forgets it should not be. Non-persistence
 * is structural here rather than a rule somebody has to remember.
 *
 * Correlation back to a row is by `source_row_index`, which the payload already carries as
 * provenance. In-memory, single-run, and never written anywhere.
 *
 * The R5 exclusion itself is NOT enforced from here — see
 * `BRAZIL_RECEITA_RB3_R5_ENFORCEMENT_POINT`. These are the signals; the control is the classifier.
 */
export interface BrReceitaCnpjInternalControlSignals {
  /** Correlates to `raw_data.source_row_index` of the accepted row. */
  source_row_index: number;
  /** natureza jurídica code — person-risk-bearing; the R5 risk classifier's input. */
  legal_nature_code: string | null;
  /** Rendering of the code above. `EXCLUDED_OUTPUT`; retained here only for operator diagnosis. */
  legal_nature_label: string | null;
  simples_opt_in: boolean | null;
  simei_opt_in: boolean | null;
  /** Controlled MEI marker (natural-person-equivalent); no personal data. */
  mei_flag: boolean;
}

/**
 * One accepted snapshot row — the IN-MEMORY parser shape.
 *
 * 🔴 BR-SOURCE-FUNCTIONAL-CUT-A — exactly ONE of the three identity fields is now persistable.
 *
 *   · `normalized_tax_id`   PERSISTED. The one internal exact-lookup representation authorized by
 *                           GATE-4 sub-decision 4A, as a narrow enumerated exception to GATE-1 R4.
 *   · `tax_id`              TRANSIENT_ONLY. A second representation of the same identity.
 *   · `record_identity_key` TRANSIENT_ONLY. Literally `tax:<normalized_14>` — a namespace prefix is
 *                           not a transformation, and it is also a second representation.
 *
 * The two refused fields stay ON the in-memory row because the parser needs them to detect
 * duplicates, and because deleting a field is a grain decision the owners have not made. They are
 * refused at the persistence boundary by `assertBrazilReceitaSnapshotRowIsPersistable`, and
 * migration 126 makes both NULL-for-Brazil a CHECK constraint — so "exactly one representation" is
 * enforced twice, in the guard and in the schema.
 *
 * 🔴 This shape is NOT what gets written. `toBrReceitaPersistedSnapshot`
 * (`br-receita-cnpj-monthly-snapshot-identity.ts`) projects it into
 * `BrReceitaPersistedSnapshot`, which structurally cannot carry the refused fields — a writer
 * handed the persisted shape has nowhere to put them.
 */
export interface BrReceitaCnpjSnapshotRow {
  source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  source_year: number;
  /**
   * 🔴 The physical monthly period, `YYYY-MM` (BR-SOURCE-FUNCTIONAL-CUT-A). PERSISTED, and the
   * identity dimension that makes two months of the same establishment two snapshots instead of
   * one overwrite.
   */
  source_period: string;
  /**
   * Raw CNPJ string as it appears in the source. TRANSIENT_ONLY — never persistable.
   * It is a SECOND representation of the identity, which is why it stays refused.
   */
  tax_id: string;
  /**
   * Normalized full 14-character CNPJ (§ 3.4) — alphanumeric-aware, DV-validated.
   *
   * 🔴 PERSISTED since BR-SOURCE-FUNCTIONAL-CUT-A: this is the ONE internal exact-lookup
   * representation GATE-4 sub-decision 4A authorized. Internal only — never printed, never logged,
   * never reported, and absent from every public projection.
   */
  normalized_tax_id: string;
  /** razão social; NEVER an identity (§ 5.3 MEI/EI caveat). */
  legal_name: string | null;
  raw_data: BrReceitaCnpjSnapshotRawData;
  /** `tax:<normalized_14>` on accepted rows. TRANSIENT_ONLY — never persistable (GATE-4). */
  record_identity_key: RecordIdentityKey;
}

// ─── Rejections (fail-closed) ────────────────────────────────────────────────

export type BrReceitaCnpjRejectionReason =
  | 'invalid_cnpj'
  | 'duplicate_record_identity_key'
  | 'missing_root_company'
  | 'incompatible_root_company';

export interface BrReceitaCnpjRejectedRow {
  sourceRowIndex: number;
  reasonCode: BrReceitaCnpjRejectionReason;
  /**
   * An execution-local ordinal derived from `sourceRowIndex` (RB-2, BR-SOURCE-GATE-ROUND-1). NEVER
   * a hash, truncation or fingerprint of the CNPJ, and never the CNPJ itself — GATE-1 R4 forbids
   * all three anywhere, including in a rejection diagnostic.
   */
  safeIdentifier: string;
  sourceFile: string | null;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface BrReceitaCnpjParserSummary {
  totalEstablishmentRows: number;
  acceptedRows: number;
  rejectedRows: number;
  rejectedInvalidCnpj: number;
  rejectedDuplicateRecordIdentity: number;
  rejectedMissingRootCompany: number;
  rejectedIncompatibleRootCompany: number;
  distinctRecordIdentityKeys: number;
  meiFlaggedRows: number;
  // Invariants — nothing is ever written in this hito.
  db_writes: 0;
  snapshot_writes: 0;
  dataset_downloads: 0;
}

export interface BrReceitaCnpjParserResult {
  snapshots: BrReceitaCnpjSnapshotRow[];
  rejected: BrReceitaCnpjRejectedRow[];
  summary: BrReceitaCnpjParserSummary;
  /**
   * Internal control signals, one entry per accepted row, in `snapshots` order
   * (BR-SOURCE-GATE-ROUND-2, RB-3).
   *
   * Parallel to `snapshots` rather than nested inside a row, so the persistable shape and the
   * control shape cannot be handed to a writer as one object.
   */
  internalControlSignals: BrReceitaCnpjInternalControlSignals[];
}
