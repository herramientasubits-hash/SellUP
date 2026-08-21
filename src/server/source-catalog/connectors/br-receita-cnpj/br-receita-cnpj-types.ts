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
 *
 * ⚠️ BR-SOURCE-GATE3-CNPJ-OUTPUT-HARDENING — the output shapes below DIVERGE from
 * data-contract § 5.1/§ 5.2 on purpose. The contract lists eight fixed columns
 * including `tax_id`, `normalized_tax_id` and `record_identity_key`, and a
 * `raw_data` allowlist including `cnpj_basico`/`cnpj_ordem`/`cnpj_dv`. Every one of
 * those is full-CNPJ or CNPJ-básico material, which the GATE-1 owner approval
 * record (R4) makes categorically non-persistible. GATE-3 (field allowlist) and
 * GATE-4 (identity grain) are both `not_started`, so no APPROVED contract requires
 * their persistence and the fail-closed reading is to drop them. Restoring any of
 * them is a GATE-3 / GATE-4 owner decision, recorded in a decision record.
 */

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
  /** Snapshot year of the monthly dataset — explicit input, never hardcoded (§ 7). */
  sourceYear: number;
  /** Optional monthly period tag (e.g. "2026-07") propagated to raw_data. */
  sourcePeriod?: string;
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
  source_period: string | null;
  source_row_index: number;
  source_file_name?: string;
  source_downloaded_at?: string;
  import_batch_id?: string;

  /**
   * Hierarchy marker only. `cnpj_root` (the CNPJ básico), `cnpj_order` and
   * `cnpj_dv` were REMOVED by BR-SOURCE-GATE3-CNPJ-OUTPUT-HARDENING: `cnpj_root`
   * IS the CNPJ básico, and the three fields recombine into the full CNPJ. Both
   * are categorically non-persistible under the GATE-1 owner approval record, R4.
   * The parser still resolves the full CNPJ INTERNALLY for DV validation and
   * duplicate rejection; it no longer carries any part of it out.
   */
  matrix_branch_flag: string | null; // identificador_matriz_filial (1=matriz/2=filial)

  // Company (from EMPRESAS + reference labels).
  legal_nature_code: string | null;
  legal_nature_label: string | null;
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

  // Regime flags.
  simples_opt_in: boolean | null;
  simei_opt_in: boolean | null;
  /** Controlled MEI marker (natural-person-equivalent); no personal data. */
  mei_flag: boolean;
}

/**
 * The materialized snapshot row.
 *
 * BR-SOURCE-GATE3-CNPJ-OUTPUT-HARDENING removed `tax_id` (the raw full CNPJ),
 * `normalized_tax_id` (the normalized full CNPJ) and `record_identity_key`
 * (`tax:<normalized_14>`, which embeds the full CNPJ verbatim). All three are full
 * CNPJ material, and the GATE-1 owner approval record (R4) makes full CNPJ
 * categorically non-printable and non-persistible — including as a hash,
 * truncation or fingerprint.
 *
 * ⚠️ Consequence, stated rather than hidden: this row now carries NO identity
 * column. That is deliberate and it is an OPEN GATE-3 / GATE-4 owner question, not
 * a settled design: which identity a persisted Brazil snapshot may carry is a
 * field-allowlist (GATE-3) and identity-grain (GATE-4) decision, and both gates are
 * `not_started`. Until one of them is approved, the safe state is to carry none.
 * The parser's own dedup is unaffected: it resolves `tax:<normalized_14>` in memory
 * and rejects duplicates exactly as before.
 */
export interface BrReceitaCnpjSnapshotRow {
  source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  source_year: number;
  /** razão social; NEVER an identity (§ 5.3 MEI/EI caveat). */
  legal_name: string | null;
  raw_data: BrReceitaCnpjSnapshotRawData;
}

// ─── Rejections (fail-closed) ────────────────────────────────────────────────

export type BrReceitaCnpjRejectionReason =
  | 'invalid_cnpj'
  | 'duplicate_record_identity_key'
  | 'missing_root_company'
  | 'incompatible_root_company';

/**
 * A rejection. It names the REASON and the SOURCE ROW, never the record.
 *
 * BR-SOURCE-GATE3-CNPJ-OUTPUT-HARDENING removed `safeIdentifier`, which carried a
 * truncated SHA-256 of the full CNPJ. A truncated hash of a CNPJ is exactly what
 * the GATE-1 owner approval record (R4) forbids — "no hash, truncation or
 * fingerprint of either, anywhere" — so "safe because it is hashed" was never an
 * exemption. `sourceRowIndex` already locates the offending row for an operator
 * without naming the company.
 */
export interface BrReceitaCnpjRejectedRow {
  sourceRowIndex: number;
  reasonCode: BrReceitaCnpjRejectionReason;
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
}
