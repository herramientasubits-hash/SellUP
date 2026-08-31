/**
 * BR Receita CNPJ — the COMPACT physical storage shape.
 * Milestone: BR-PROD-STORAGE-RIGHT-SIZING.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS MODULE IS PURE. No Supabase client, no SQL executor, no filesystem, no
 * network, no clock, no randomness, no env.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 *
 * The physical shape of a Brazil row was previously spread across four places:
 * the persistable column list in the gateway, the row bindings next to it, the
 * SELECT list in each reader, and the implicit assumption in every consumer that
 * `raw_data` held whatever the parser put there. That is four places to keep in
 * agreement and one of them is a string.
 *
 * Here it is one place. The column list, the write bindings and the read
 * reassembly are derived from a SINGLE table of column descriptors, so a column
 * cannot be written without being readable and cannot be read without being
 * written.
 *
 * ── 🔴 What LEAVES the row, and why that is not data loss ───────────────────
 *
 * Measured on real Receita 2026-07 rows, ~61% of the old jsonb's text was key
 * NAMES and punctuation, repeated on all 72,318,975 establishments. What the row
 * carried and no runtime reader consumed:
 *
 *   · `source_type` and `human_review_required` — CONSTANTS of this source. They
 *     are reconstructed here, not stored 72M times.
 *   · `parser_version`, `source_file_name`, `source_downloaded_at`,
 *     `import_batch_id` — provenance of the IMPORT, not of the company. They
 *     belong on `source_snapshot_runs.metadata`, once per run. See
 *     `BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS`.
 *   · `source_period` inside the jsonb — a duplicate of the column of the same
 *     name, which migration 127's CHECK forced the writer to restate.
 *   · `source_row_index` — the offset of a line in an input file. No reader has
 *     ever consulted it, and it cannot be reconciled against anything once the
 *     file is gone.
 *
 * Nothing an Agent1 consumer receives changes: `brReceitaRuntimeSignalsFromRow`
 * returns the same fourteen keys, with the same values, that the enrichment
 * adapter has always read.
 */

import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_PARSER_VERSION,
  BR_RECEITA_CNPJ_SOURCE_KEY,
  type BrReceitaCnpjSnapshotRawData,
} from './br-receita-cnpj-types';

/** The dedicated Brazil projection. LIST-partitioned by `snapshot_run_id`. */
export const BR_RECEITA_COMPACT_TABLE = 'br_receita_snapshots' as const;

/** Publication stays where migration 127 put it. There is no second run table. */
export const BR_RECEITA_SNAPSHOT_RUNS_TABLE = 'source_snapshot_runs' as const;

/**
 * The signals a runtime consumer receives for one establishment.
 *
 * 🔴 Deliberately NOT `BrReceitaCnpjSnapshotRawData`. That type is the PARSER's
 * output and carries import provenance; this one is the READ surface and carries
 * only what a consumer is entitled to. The parser type structurally satisfies
 * this one, so a test may still feed a parser row to a consumer.
 */
export interface BrReceitaCnpjRuntimeSignals {
  readonly source_type: 'official_registry';
  readonly human_review_required: true;
  readonly matrix_branch_flag: string | null;
  readonly company_size_code: string | null;
  readonly capital_social_value: string | null;
  readonly registration_status_code: string | null;
  readonly registration_status_label: string | null;
  readonly cnae_main_code: string | null;
  readonly cnae_main_label: string | null;
  readonly cnae_secondary_codes: readonly string[];
  readonly municipality_code: string | null;
  readonly municipality_name: string | null;
  readonly uf: string | null;
  readonly start_date: string | null;
}

/** The two values that are true of every Brazil row and are therefore not stored. */
export const BR_RECEITA_CONSTANT_SIGNALS = {
  source_type: 'official_registry',
  human_review_required: true,
} as const satisfies Pick<
  BrReceitaCnpjRuntimeSignals,
  'source_type' | 'human_review_required'
>;

/**
 * The raw_data keys that describe the IMPORT rather than the company, and that
 * therefore belong on the run once instead of on every row.
 *
 * 🔴 This is not a deletion of auditability. `source_snapshot_runs.metadata` is
 * the same jsonb it always was, on a table with one row per publication, and
 * `brReceitaRunProvenanceMetadata` builds exactly this object for it.
 */
export const BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS = [
  'parser_version',
  'source_file_name',
  'source_downloaded_at',
  'import_batch_id',
] as const;

export interface BrReceitaRunProvenance {
  readonly parser_version: string;
  readonly source_file_name?: string;
  readonly source_downloaded_at?: string;
  readonly import_batch_id?: string;
}

/** The run-level provenance object, for `source_snapshot_runs.metadata`. */
export function brReceitaRunProvenanceMetadata(
  provenance: BrReceitaRunProvenance,
): Record<string, string> {
  const metadata: Record<string, string> = { parser_version: provenance.parser_version };
  if (provenance.source_file_name !== undefined) {
    metadata.source_file_name = provenance.source_file_name;
  }
  if (provenance.source_downloaded_at !== undefined) {
    metadata.source_downloaded_at = provenance.source_downloaded_at;
  }
  if (provenance.import_batch_id !== undefined) {
    metadata.import_batch_id = provenance.import_batch_id;
  }
  return metadata;
}

/**
 * The run-level provenance a CALLER is allowed to supply.
 *
 * 🔴 Four OPTIONAL keys and nothing else — deliberately not `Record<string, unknown>`. The
 * persisted object is the one place a Brazil publication could grow a field nobody classified,
 * so the surface is an allowlist rather than a bag: a caller literally cannot hand over a CNPJ,
 * a legal name, a row, a local path, a contact or an address, because there is no key to put
 * one in.
 *
 * `parser_version` is optional HERE and mandatory in what is PERSISTED. The default is the
 * authoritative `BR_RECEITA_CNPJ_PARSER_VERSION` constant the parser already stamps rows with —
 * there is no second literal for it anywhere in this codebase.
 */
export interface BrReceitaRunProvenanceInput {
  readonly parser_version?: string;
  readonly source_file_name?: string;
  readonly source_downloaded_at?: string;
  readonly import_batch_id?: string;
}

/** A supplied optional value, kept only when it is a non-empty string. */
const suppliedText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

/**
 * Narrows a caller's provenance to the four allowed keys and guarantees `parser_version`.
 *
 * 🔴 Built key by key, never by spreading `input`. A spread is exactly how an unclassified field
 * would reach `source_snapshot_runs.metadata`, and metadata is jsonb — it would accept it.
 *
 * 🔴 An ABSENT `source_file_name` is a legitimate answer for the national producer, whose input is
 * ten multipart establishment files: naming one of them would claim a single file represents the
 * whole national dataset. Absent is honest; invented is not.
 */
export function brReceitaRunProvenanceForRun(
  input: BrReceitaRunProvenanceInput | undefined,
): Record<string, string> {
  const provenance: BrReceitaRunProvenance = {
    parser_version: suppliedText(input?.parser_version) ?? BR_RECEITA_CNPJ_PARSER_VERSION,
    source_file_name: suppliedText(input?.source_file_name),
    source_downloaded_at: suppliedText(input?.source_downloaded_at),
    import_batch_id: suppliedText(input?.import_batch_id),
  };
  return brReceitaRunProvenanceMetadata(provenance);
}

// ─── The signal columns ─────────────────────────────────────────────────────

/**
 * One descriptor per persisted signal column: how a parser value becomes a
 * column, and how a column becomes a consumer value again.
 *
 * 🔴 Both directions live on the SAME descriptor so they cannot drift. The
 * round-trip property this buys is asserted directly by the suite.
 */
interface BrReceitaSignalColumn<K extends keyof BrReceitaCnpjRuntimeSignals> {
  readonly column: K;
  readonly toColumn: (signals: BrReceitaCnpjRuntimeSignals) => string | null;
  readonly fromColumn: (value: unknown) => BrReceitaCnpjRuntimeSignals[K];
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const plain = <K extends Exclude<keyof BrReceitaCnpjRuntimeSignals, 'source_type' | 'human_review_required' | 'cnae_secondary_codes'>>(
  column: K,
): BrReceitaSignalColumn<K> => ({
  column,
  toColumn: (signals) => (signals[column] as string | null) ?? null,
  fromColumn: (value) => text(value) as BrReceitaCnpjRuntimeSignals[K],
});

/**
 * The secondary CNAE list, as one text column.
 *
 * 🔴 ',' is a safe separator here rather than by hope: the parser builds this
 * list by splitting on `[^A-Za-z0-9]+`, so no element can contain a comma. A
 * `text[]` would cost ~30 B/row of array overhead for a measured mean of 1.9
 * codes; this costs the codes plus one byte per gap.
 */
const CNAE_SECONDARY_SEPARATOR = ',' as const;

const cnaeSecondaryColumn: BrReceitaSignalColumn<'cnae_secondary_codes'> = {
  column: 'cnae_secondary_codes',
  toColumn: (signals) =>
    signals.cnae_secondary_codes.length === 0
      ? null
      : signals.cnae_secondary_codes.join(CNAE_SECONDARY_SEPARATOR),
  fromColumn: (value) => {
    const raw = text(value);
    return raw === null
      ? []
      : raw.split(CNAE_SECONDARY_SEPARATOR).filter((code) => code.length > 0);
  },
};

const SIGNAL_COLUMNS = [
  plain('matrix_branch_flag'),
  plain('company_size_code'),
  plain('capital_social_value'),
  plain('registration_status_code'),
  plain('registration_status_label'),
  plain('cnae_main_code'),
  plain('cnae_main_label'),
  cnaeSecondaryColumn,
  plain('municipality_code'),
  plain('municipality_name'),
  plain('uf'),
  plain('start_date'),
] as const satisfies readonly BrReceitaSignalColumn<keyof BrReceitaCnpjRuntimeSignals>[];

/** The signal column names, in physical order. */
export const BR_RECEITA_SIGNAL_COLUMNS: readonly string[] = SIGNAL_COLUMNS.map((c) => c.column);

/**
 * The column CUT C reads to break a tie between two establishments that share a
 * legal name. Named here so the resolver's SELECT and the writer's column list
 * are the same string.
 */
export const BR_RECEITA_MUNICIPALITY_NAME_COLUMN = 'municipality_name' as const;
export const BR_RECEITA_NORMALIZED_LEGAL_NAME_COLUMN = 'normalized_legal_name' as const;
export const BR_RECEITA_SNAPSHOT_RUN_ID_COLUMN = 'snapshot_run_id' as const;

// ─── The full persisted row ─────────────────────────────────────────────────

/**
 * Every column the writer persists, in the order the INSERT emits them.
 *
 * 🔴 What is NOT here is the point: no `id` surrogate (the natural key is the
 * primary key, which removes both a uuid from the heap and an entire index),
 * no `source_key` and no `country_code` (constants of a dedicated table, 31 B/row
 * of repetition), no `source_year` (a substring of `source_period`), no
 * `imported_at` (run-level), no `priority_score`, no `signals`, no `financials`,
 * no `tax_id`, no `record_identity_key`, no `raw_data`.
 */
export const BR_RECEITA_COMPACT_PERSISTED_COLUMNS: readonly string[] = [
  BR_RECEITA_SNAPSHOT_RUN_ID_COLUMN,
  'source_period',
  'normalized_tax_id',
  'legal_name',
  BR_RECEITA_NORMALIZED_LEGAL_NAME_COLUMN,
  ...BR_RECEITA_SIGNAL_COLUMNS,
] as const;

/**
 * The conflict target of the run-scoped upsert: the table's PRIMARY KEY.
 *
 * 🔴 Run-scoped, exactly as before, and now for a structural reason rather than
 * a documented one — the run id is the PARTITION key, so a row of run B cannot
 * physically land in run A's storage. The old five-column target existed to keep
 * `source_key`/`country_code`/`source_period` out of the arbiter's way; on a
 * dedicated per-run table those columns have nothing left to disambiguate.
 */
export const BR_RECEITA_COMPACT_CONFLICT_COLUMNS: readonly string[] = [
  BR_RECEITA_SNAPSHOT_RUN_ID_COLUMN,
  'normalized_tax_id',
] as const;

/**
 * The primary key is an ordinary (non-partial) unique index, so `ON CONFLICT`
 * needs no `WHERE` clause to infer it. Migration 127's partial index needed one;
 * this does not, and saying so explicitly is how the gateway knows not to emit a
 * predicate it would have to invent.
 */
export const BR_RECEITA_COMPACT_CONFLICT_IS_PARTIAL = false as const;

/** The columns the exact-lookup readers project. */
export const BR_RECEITA_COMPACT_READ_COLUMNS: readonly string[] = [
  'source_period',
  'legal_name',
  ...BR_RECEITA_SIGNAL_COLUMNS,
] as const;

/** The columns CUT C's name resolution projects. Two, not a whole row. */
export const BR_RECEITA_COMPACT_NAME_RESOLUTION_COLUMNS: readonly string[] = [
  'normalized_tax_id',
  BR_RECEITA_MUNICIPALITY_NAME_COLUMN,
] as const;

// ─── Write direction ────────────────────────────────────────────────────────

export interface BrReceitaCompactWriteRow {
  readonly snapshot_run_id: string;
  readonly source_period: string;
  readonly normalized_tax_id: string;
  readonly legal_name: string | null;
  readonly normalized_legal_name: string | null;
  readonly signals: BrReceitaCnpjRuntimeSignals;
}

/** The bind values for one row, positionally aligned with the column list. */
export function brReceitaCompactRowBindings(row: BrReceitaCompactWriteRow): unknown[] {
  return [
    row.snapshot_run_id,
    row.source_period,
    row.normalized_tax_id,
    row.legal_name,
    row.normalized_legal_name,
    ...SIGNAL_COLUMNS.map((descriptor) => descriptor.toColumn(row.signals)),
  ];
}

/** The `DO UPDATE SET` assignments: every non-key column. */
export function brReceitaCompactUpdateAssignments(): readonly string[] {
  return BR_RECEITA_COMPACT_PERSISTED_COLUMNS.filter(
    (column) => !BR_RECEITA_COMPACT_CONFLICT_COLUMNS.includes(column),
  ).map((column) => `${column} = EXCLUDED.${column}`);
}

// ─── Read direction ─────────────────────────────────────────────────────────

/**
 * Rebuild the consumer-facing signals from a persisted row.
 *
 * The two constants come back from `BR_RECEITA_CONSTANT_SIGNALS` rather than
 * from the row, which is why they no longer occupy 31 B on 72 million rows.
 */
export function brReceitaRuntimeSignalsFromRow(
  row: Record<string, unknown>,
): BrReceitaCnpjRuntimeSignals {
  const signals: Record<string, unknown> = { ...BR_RECEITA_CONSTANT_SIGNALS };
  for (const descriptor of SIGNAL_COLUMNS) {
    signals[descriptor.column] = descriptor.fromColumn(row[descriptor.column]);
  }
  return signals as unknown as BrReceitaCnpjRuntimeSignals;
}

/** Narrow a parser row's `raw_data` to the runtime read surface. */
export function brReceitaRuntimeSignalsFromRawData(
  rawData: BrReceitaCnpjSnapshotRawData,
): BrReceitaCnpjRuntimeSignals {
  return {
    ...BR_RECEITA_CONSTANT_SIGNALS,
    matrix_branch_flag: rawData.matrix_branch_flag,
    company_size_code: rawData.company_size_code,
    capital_social_value: rawData.capital_social_value,
    registration_status_code: rawData.registration_status_code,
    registration_status_label: rawData.registration_status_label,
    cnae_main_code: rawData.cnae_main_code,
    cnae_main_label: rawData.cnae_main_label,
    cnae_secondary_codes: [...rawData.cnae_secondary_codes],
    municipality_code: rawData.municipality_code,
    municipality_name: rawData.municipality_name,
    uf: rawData.uf,
    start_date: rawData.start_date,
  };
}

export const BR_RECEITA_COMPACT_STORAGE_CONTRACT = {
  milestone: 'BR-PROD-STORAGE-RIGHT-SIZING',
  appliesToSourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
  countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
  table: BR_RECEITA_COMPACT_TABLE,
  partitionedBy: BR_RECEITA_SNAPSHOT_RUN_ID_COLUMN,
  partitionStrategy: 'LIST',
  reusesSourceSnapshotRuns: true,
  createsASecondPublicationSystem: false,
  /** GATE-4A: exactly one, and it is a column name rather than a promise. */
  identityRepresentationCount: 1,
  identityRepresentationColumn: 'normalized_tax_id',
  /**
   * 🔴 The owner AMENDED GATE-4A's authorized location — and only the location — onto this table.
   * Recorded here as well as in `BRAZIL_RECEITA_GATE4A_LOCATION_AMENDMENT` so a reader of the
   * storage contract cannot conclude that the move was taken unilaterally by the code.
   */
  identityRepresentationQualifiedColumn: 'br_receita_snapshots.normalized_tax_id',
  identityRepresentationLocationAmendedByOwner: true,
  identityRepresentationLocationBeforeAmendment: 'source_company_snapshots.normalized_tax_id',
  gate4aAmendmentRecord: 'BRAZIL_RECEITA_GATE4A_LOCATION_AMENDMENT',
  gate4aPermissionWidened: false,
  persistsTaxId: false,
  persistsRecordIdentityKey: false,
  persistsJsonb: false,
  persistsSourceKeyPerRow: false,
  persistsCountryCodePerRow: false,
  persistsSourceYearPerRow: false,
  persistsSurrogateRowId: false,
  persistsImportProvenancePerRow: false,
  runLevelProvenanceKeys: BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS,
  runLevelProvenanceLivesOn: `${BR_RECEITA_SNAPSHOT_RUNS_TABLE}.metadata`,
  /**
   * 🔴 The run row is where the provenance ACTUALLY LANDS, not merely where it is documented to
   * belong. `planBrReceitaMonthlySnapshotWrite` builds it, `begin_period` carries it and the
   * gateway binds it into the run INSERT, so "moved to the run" is a write path rather than a
   * claim. The suite proves it by reading `source_snapshot_runs.metadata` back out of a real
   * PostgreSQL after a real publication.
   */
  runLevelProvenanceIsPersistedByTheWriter: true,
  runLevelProvenanceParserVersionIsMandatory: true,
  runLevelProvenanceAcceptsArbitraryCallerKeys: false,
  indexes: [
    { name: 'PRIMARY KEY', columns: BR_RECEITA_COMPACT_CONFLICT_COLUMNS, serves: ['exact_pinned_cnpj_lookup', 'one_row_per_identity_per_run', 'run_scoped_lifecycle'] },
    { name: 'br_receita_snapshots_name_idx', columns: [BR_RECEITA_SNAPSHOT_RUN_ID_COLUMN, BR_RECEITA_NORMALIZED_LEGAL_NAME_COLUMN], serves: ['exact_normalized_legal_name_lookup'] },
  ],
  cityDisambiguationIsInMemoryOverBoundedWindow: true,
  indexesNullPlaceholderColumns: false,
  copiesGenericSnapshotIndexes: false,
} as const;
