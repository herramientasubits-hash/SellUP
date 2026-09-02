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

/**
 * The SHAPES a provenance value is allowed to have.
 *
 * 🔴 Allowlists, not repairs. A value that does not match is OMITTED — never trimmed, never
 * `basename()`d, never otherwise laundered. Basenaming `/Users/ana/Downloads/receita.csv` would
 * turn an operator's home directory into a plausible-looking filename and then persist it, which
 * is the disclosure this closes rather than a fix for it. Absent is honest; repaired is not.
 *
 * 🔴 `/` and `\` are outside every charset by CONSTRUCTION, so no POSIX path, no Windows path,
 * no `..` traversal and no URL can match. Whitespace is outside them too, so free-text prose
 * cannot ride in on `parser_version` or `import_batch_id` either.
 */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** A version token: `br-receita-cnpj-local-sample@1`, `v9`, `1.2.3+build`. */
const SAFE_VERSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._+@-]{0,63}$/;
/** An opaque batch token: `national-2026-07`, a canonical uuid. */
const SAFE_OPAQUE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A canonical instant, e.g. `2026-07-12T09:18:00.000Z`, with its calendar fields captured. */
const CANONICAL_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * A CNPJ-shaped unformatted identifier: fourteen or more consecutive digits.
 *
 * 🔴 GATE-4A allows the source exactly ONE persisted exact CNPJ representation, and it is
 * `br_receita_snapshots.normalized_tax_id`. `source_snapshot_runs.metadata` is not it. Shape
 * validation alone does not close that: an unformatted CNPJ is fourteen digits and nothing else,
 * so it satisfies `SAFE_FILE_NAME`, `SAFE_VERSION_TOKEN` and `SAFE_OPAQUE_TOKEN` on its own and
 * rides into jsonb inside an APPROVED key. The key allowlist cannot see it; only a rule about the
 * VALUE can.
 *
 * 🔴 Deliberately NOT check-digit validated. A módulo-11 filter would admit every
 * DV-invalid fourteen-digit run — which is still a real CNPJ typed with one wrong character, or a
 * real one at all if the DV algorithm is ever wrong about it — and this is a privacy boundary, so
 * the conservative answer is to omit anything CNPJ-SHAPED rather than to persist whatever survives
 * a checksum. `containsBrazilCnpjLikeIdentifier` is the right tool for REPORT sanitisation, where
 * false positives make output unusable; it is the wrong one here, where a false positive costs an
 * absent provenance field and a false negative costs a persisted identifier.
 *
 * ⚪ `\d{14}` is unanchored on purpose: it also catches a run of fifteen or more, and a CNPJ
 * embedded inside an otherwise shape-valid token (`br-receita-cnpj-<14 digits>@1`). The FORMATTED
 * mask cannot arrive here at all — `.`/`/`/`-` punctuation puts a `/` in the value and no safe
 * charset contains one. A canonical UUID's longest digit run is its twelve-character final group,
 * so `33333333-3333-4333-8333-333333333333` is untouched by this rule.
 */
const CNPJ_SHAPED_DIGIT_RUN = /\d{14}/;

/**
 * A CNPJ-shaped ALPHANUMERIC identifier: the § 3.1 grammar in force from July 2026 — twelve
 * `[A-Za-z0-9]` identity positions (raiz + ordem) followed by two NUMERIC check digits — isolated
 * as a run of EXACTLY fourteen alphanumerics.
 *
 * 🔴 Why the digit rule above cannot see it. `\d{14}` requires fourteen DIGITS, and an alphanumeric
 * CNPJ contains letters — which are inside every safe charset above. So `12ABC345ABCD35` satisfies
 * `SAFE_FILE_NAME`, `SAFE_VERSION_TOKEN` and `SAFE_OPAQUE_TOKEN`, matches no digit rule, and would
 * ride into `source_snapshot_runs.metadata` as a SECOND persisted exact CNPJ representation —
 * precisely the thing GATE-4A allows exactly once, in `identityRepresentationQualifiedColumn`.
 *
 * 🔴 Boundary-delimited, unlike the digit rule, and the difference is deliberate rather than an
 * oversight. A fourteen-DIGIT run is unambiguous, so the digit rule stays unanchored and also
 * catches one embedded in a longer token. An alphanumeric run is NOT unambiguous: searching it
 * unanchored would match a fourteen-character window inside any long hex digest that happens to end
 * in two digits, and would then drop a legitimate `import_batch_id` on every write. Requiring the
 * run to be exactly fourteen with no adjacent alphanumeric keeps a 32-character digest, a
 * 40-character digest and a canonical UUID (longest run: twelve) outside the rule entirely.
 *
 * 🔴 Still NOT check-digit validated, for the same reason the digit rule is not: at a PERSISTENCE
 * boundary a false positive costs one absent optional provenance field, while a false negative
 * persists an identifier for as long as the run row lives. `containsBrazilCnpjLikeIdentifier`
 * (DV-filtered) is the right tool for REPORT surfaces, where false positives make output unusable;
 * it stays the wrong one here.
 *
 * ⚪ The recorded residual: an alphanumeric CNPJ GLUED to further alphanumerics with no separator
 * (`brreceita12ABC345ABCD35`) is not refused, because nothing distinguishes it from a token that
 * merely ends in a CNPJ-shaped tail. Every carrier the shapes above admit separates its segments
 * with `.`, `-`, `_`, `+` or `@`, so the realistic carrier IS delimited and IS refused.
 */
const CNPJ_SHAPED_ALPHANUMERIC_RUN = /(?<![A-Za-z0-9])[A-Za-z0-9]{12}[0-9]{2}(?![A-Za-z0-9])/g;

/** A run must carry a LETTER to be this rule's business; the all-digit case is the digit rule's. */
const RUN_CARRIES_A_LETTER = /[A-Za-z]/;

function containsCnpjShapedAlphanumericRun(value: string): boolean {
  for (const match of value.matchAll(CNPJ_SHAPED_ALPHANUMERIC_RUN)) {
    if (RUN_CARRIES_A_LETTER.test(match[0])) return true;
  }
  return false;
}

/**
 * True when `value` carries a CNPJ-shaped identifier — an unformatted DIGIT run, or the § 3.1
 * ALPHANUMERIC shape — and therefore may not be persisted into run metadata under any key. Never
 * normalises, never repairs and never returns the offending value — the caller's only move is to
 * OMIT.
 */
export function containsForbiddenCnpjIdentifierShape(value: string): boolean {
  return CNPJ_SHAPED_DIGIT_RUN.test(value) || containsCnpjShapedAlphanumericRun(value);
}

/**
 * A supplied optional value, kept only when it is a string of the required shape AND carries no
 * CNPJ-shaped identifier.
 *
 * 🔴 The semantic guard lives HERE, on the one combinator the three token validators share,
 * rather than being repeated at each call site — so `parser_version`, `source_file_name` and
 * `import_batch_id` are all covered by construction and none can be added later without it.
 * `safeInstant` does not go through `shaped`, which is exactly why the canonical timestamp is
 * excluded from this rule by CONSTRUCTION rather than by a remembered exception.
 */
const shaped =
  (pattern: RegExp) =>
  (value: unknown): string | undefined =>
    typeof value === 'string' && pattern.test(value) && !containsForbiddenCnpjIdentifierShape(value)
      ? value
      : undefined;

const safeFileName = shaped(SAFE_FILE_NAME);
const safeVersionToken = shaped(SAFE_VERSION_TOKEN);
const safeOpaqueToken = shaped(SAFE_OPAQUE_TOKEN);

/**
 * A timestamp kept only when it is canonical AND denotes a real instant.
 *
 * 🔴 The shape alone is not enough, and neither is `Date.parse`: `2026-02-30T00:00:00Z` matches
 * the shape and `Date.parse` ROLLS IT OVER to March 2nd rather than rejecting it, so a shape-only
 * check would persist a date that does not exist. The calendar fields are therefore compared back
 * against the instant they were used to build. Free text of any kind — `'ayer por la tarde'` —
 * fails the shape and never reaches that comparison.
 */
const safeInstant = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const match = CANONICAL_INSTANT.exec(value);
  if (match === null || !Number.isFinite(Date.parse(value))) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const roundTrips =
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hour &&
    at.getUTCMinutes() === minute &&
    at.getUTCSeconds() === second;
  return roundTrips ? value : undefined;
};

/**
 * Narrows a caller's provenance to the four allowed keys, VALIDATES each value's shape, and
 * guarantees `parser_version`.
 *
 * 🔴 The ONE authoritative narrower, called at BOTH ends of the write path: the planner builds
 * `begin_period.metadata` with it, and the SQL gateway runs the operation's metadata back through
 * it before binding the run INSERT. Two call sites, no second mapper — a runtime caller that
 * hands `beginPeriodRun` a cast object never reaches jsonb with it, and there is no narrowing
 * rule that can drift between the two boundaries because there is only one rule.
 *
 * 🔴 Built key by key, never by spreading `input`. A spread is exactly how an unclassified field
 * would reach `source_snapshot_runs.metadata`, and metadata is jsonb — it would accept it.
 *
 * 🔴 Key-level narrowing is not sufficient on its own: an allowed KEY can carry a disallowed
 * VALUE. `source_file_name: '/Users/ana/receita.csv'` names an operator's home directory, and
 * `parser_version` / `import_batch_id` are free-text carriers if nothing constrains them. Each
 * value must therefore match its shape, and a value that does not is dropped rather than fixed.
 *
 * 🔴 Nor is SHAPE validation sufficient on its own. An unformatted CNPJ is fourteen digits
 * and nothing else, so it satisfies every safe-token charset above and would travel into
 * `source_snapshot_runs.metadata` inside an approved key. GATE-4A allows exactly ONE persisted
 * exact CNPJ representation — `br_receita_snapshots.normalized_tax_id` — and run metadata is not
 * it, so a CNPJ-shaped value is refused SEMANTICALLY as well: see `containsForbiddenCnpjIdentifierShape`.
 * The canonical timestamp is out of that rule's scope by construction, not by exception.
 *
 * 🔴 An ABSENT `source_file_name` is a legitimate answer for the national producer, whose input is
 * ten multipart establishment files: naming one of them would claim a single file represents the
 * whole national dataset. Absent is honest; invented is not.
 */
export function brReceitaRunProvenanceForRun(
  input: BrReceitaRunProvenanceInput | undefined,
): Record<string, string> {
  const provenance: BrReceitaRunProvenance = {
    parser_version: safeVersionToken(input?.parser_version) ?? BR_RECEITA_CNPJ_PARSER_VERSION,
    source_file_name: safeFileName(input?.source_file_name),
    source_downloaded_at: safeInstant(input?.source_downloaded_at),
    import_batch_id: safeOpaqueToken(input?.import_batch_id),
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
  /**
   * 🔴 The narrowing happens at the SQL WRITE BOUNDARY as well as in the planner. The gateway
   * runs `operation.metadata` back through the same `brReceitaRunProvenanceForRun` before binding
   * it, so a direct runtime caller of `beginPeriodRun` — one that bypasses the planner and casts
   * its metadata — cannot widen what lands in jsonb.
   */
  runLevelProvenanceIsRenarrowedAtTheSqlBoundary: true,
  /** Allowed KEY, disallowed VALUE: a path, free text or a malformed instant does not persist. */
  runLevelProvenanceValuesAreShapeValidated: true,
  /** And an unsafe value is OMITTED, never basenamed, trimmed or otherwise laundered into one. */
  runLevelProvenanceRepairsUnsafeValues: false,
  /**
   * 🔴 GATE-4A, at the VALUE level. A shape-valid token that carries a CNPJ-shaped
   * unformatted digit run is refused in every provenance key, so the one persisted exact CNPJ
   * representation stays `identityRepresentationQualifiedColumn` and cannot be a second one hiding
   * in `parser_version`, `source_file_name` or `import_batch_id`.
   */
  runLevelProvenanceRefusesCnpjShapedValues: true,
  /** Refusal is by SHAPE, never by check digit — a DV-invalid fourteen-digit run is refused too. */
  runLevelProvenanceCnpjRefusalIsCheckDigitIndependent: true,
  /**
   * 🔴 And the shape rule covers the § 3.1 ALPHANUMERIC CNPJ in force from July 2026, not only
   * digit runs. Letters are inside every safe provenance charset, so before this an alphanumeric
   * CNPJ was the one CNPJ that could reach `source_snapshot_runs.metadata` under an approved key.
   */
  runLevelProvenanceRefusesAlphanumericCnpjShapedValues: true,
  /** The alphanumeric half is boundary-delimited, so a long hex digest is not a false positive. */
  runLevelProvenanceAlphanumericRefusalIsBoundaryDelimited: true,
  indexes: [
    { name: 'PRIMARY KEY', columns: BR_RECEITA_COMPACT_CONFLICT_COLUMNS, serves: ['exact_pinned_cnpj_lookup', 'one_row_per_identity_per_run', 'run_scoped_lifecycle'] },
    { name: 'br_receita_snapshots_name_idx', columns: [BR_RECEITA_SNAPSHOT_RUN_ID_COLUMN, BR_RECEITA_NORMALIZED_LEGAL_NAME_COLUMN], serves: ['exact_normalized_legal_name_lookup'] },
  ],
  cityDisambiguationIsInMemoryOverBoundedWindow: true,
  indexesNullPlaceholderColumns: false,
  copiesGenericSnapshotIndexes: false,
} as const;
