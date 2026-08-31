/**
 * BR Receita CNPJ — monthly persisted snapshot identity, payload and projections.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-A — monthly Receita snapshot identity foundation.
 *
 * This module is the boundary between what the PARSER holds in memory and what a WRITER may ever
 * see. Nothing here touches Supabase, the filesystem, the network or a provider: it is a pure
 * transform, and the write PLAN that consumes it
 * (`br-receita-cnpj-monthly-snapshot-write-plan.ts`) is pure too.
 *
 * ── Why the split exists at all ─────────────────────────────────────────────
 *
 * `BrReceitaCnpjSnapshotRow` carries three CNPJ representations, because the parser needs all
 * three in memory: the raw string, the normalized 14-character form, and `tax:<normalized_14>` for
 * duplicate detection. Exactly ONE of them may be persisted (GATE-4 sub-decision 4A). A writer
 * handed that row could persist any of them by accident.
 *
 * So the row is projected into `BrReceitaPersistedSnapshot`, which has NOWHERE to put the other
 * two. That is the same structural technique `BrReceitaCnpjInternalControlSignals` already uses for
 * the privacy-control fields: non-persistence is a property of the SHAPE, not a rule somebody has
 * to remember. The guard still runs first — belt and braces — but the shape is what makes the
 * mistake unrepresentable.
 *
 * ── The identity ────────────────────────────────────────────────────────────
 *
 *   source_key + country_code + source_period + normalized_tax_id
 *
 * `source_period` (YYYY-MM) is the dimension that makes two months of the same establishment two
 * snapshots rather than one overwrite. `normalized_tax_id` is the single internal exact-lookup
 * representation of the establishment CNPJ — 14 CHARACTERS, alphanumeric-aware, DV-validated.
 *
 * `source_year` travels in the identity as a COORDINATE, not as an identity dimension: the generic
 * table's column is NOT NULL and predates the monthly grain. The period is authoritative and the
 * year is derived from it here, so the two cannot be supplied independently and drift.
 *
 * ── The CNPJ root is context, never identity ────────────────────────────────
 *
 * 🔴 There is deliberately NO function in this module that extracts, returns or accepts the CNPJ
 * básico (raiz). GATE-1 R4 forbids the básico anywhere, and the operational grain is the
 * establishment. A root-shaped value simply fails identity validation like any other non-CNPJ
 * string, which is the only treatment it needs.
 *
 * ── Privacy ─────────────────────────────────────────────────────────────────
 *
 * `normalized_tax_id` is authorized for STORAGE and internal LOOKUP only. It never appears in a
 * public projection, in `raw_data`, in a report, in a log line, in an error message or in a plan
 * summary. `toBrReceitaPublicSnapshotProjection` is the shape a consumer may see, and it has no
 * identity field at all.
 */

import {
  assertBrazilReceitaPersistedIdentityIsValid,
  BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION,
} from './br-receita-cnpj-gate4-recorded-identity-grain';
import {
  BR_RECEITA_CNPJ_SOURCE_KEY,
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  type BrReceitaCnpjSnapshotRow,
} from './br-receita-cnpj-types';
import {
  BR_RECEITA_COMPACT_TABLE,
  brReceitaRuntimeSignalsFromRawData,
  type BrReceitaCnpjRuntimeSignals,
} from './br-receita-cnpj-compact-storage';
import { assertValidSourcePeriod, sourcePeriodYear } from '../../source-period';

/**
 * The physical table Brazil monthly snapshots live in.
 *
 * 🔴 No longer the generic `source_company_snapshots`. BR-PROD-STORAGE-RIGHT-SIZING measured the
 * generic projection at 1409 B/row all-in — 94.9 GB for one national month — and moved Brazil to a
 * dedicated, LIST-partitioned table at 408 B/row. The other ten connectors keep the generic table
 * unchanged; see `br-receita-cnpj-compact-storage.ts`.
 */
export const BR_RECEITA_SNAPSHOT_TABLE = BR_RECEITA_COMPACT_TABLE;

/**
 * The identity half of a persisted Brazil snapshot.
 *
 * 🔴 `normalized_tax_id` is INTERNAL. Never render it, never log it, never put it in a report and
 * never return it to a caller outside the persistence/lookup boundary.
 */
export interface BrReceitaSnapshotIdentity {
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  /** The identity dimension: canonical `YYYY-MM`. */
  readonly source_period: string;
  /** Coordinate only, derived from `source_period`. The generic column is NOT NULL. */
  readonly source_year: number;
  /** The ONE internal exact-lookup representation (GATE-4 4A). Never printed. */
  readonly normalized_tax_id: string;
}

/**
 * The approved business payload. GATE-3's closed allowlist governs the signals; not widened here.
 *
 * 🔴 `signals` rather than `raw_data`. The parser's `raw_data` also carried import provenance
 * (`parser_version`, `source_file_name`, `source_downloaded_at`, `import_batch_id`), a duplicate
 * of `source_period`, a `source_row_index` no reader ever consulted, and two constants. Those
 * describe the IMPORT, not the company, and they now live once on the run instead of 72 million
 * times on the rows. The twelve business signals are unchanged.
 */
export interface BrReceitaSnapshotPayload {
  readonly legal_name: string | null;
  readonly signals: BrReceitaCnpjRuntimeSignals;
}

/** Identity + payload. This is the only shape a writer may be handed. */
export interface BrReceitaPersistedSnapshot {
  readonly identity: BrReceitaSnapshotIdentity;
  readonly payload: BrReceitaSnapshotPayload;
}

/**
 * The shape a consumer may see. Deliberately has NO identity field: not the CNPJ, not a root, not
 * a hash of either. A caller that needs to FIND a row uses the internal lookup path with an
 * identity it already holds; it never receives one back.
 */
export interface BrReceitaPublicSnapshotProjection {
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  readonly legal_name: string | null;
  readonly signals: BrReceitaCnpjRuntimeSignals;
}

/**
 * Projects an in-memory parser row into the persisted shape.
 *
 * 🔴 It validates with `assertBrazilReceitaPersistedIdentityIsValid` — the REQUIREMENT half of the
 * GATE-4 guard — and not with the full row guard. That is deliberate and it is the distinction that
 * makes this projection possible at all: the incoming row legitimately carries `tax_id` and
 * `record_identity_key`, and DROPPING them is precisely this function's job. Using the full row
 * guard here would refuse every real row and make the sanctioned path unreachable.
 *
 * The refusal half is not weakened: `assertBrazilReceitaSnapshotRowIsPersistable` still refuses a
 * RAW row at any persistence boundary, for a writer that skips this projection.
 *
 * @throws {BrazilReceitaGate4NonPersistableRowError} if the row lacks its one permitted identity or
 * lacks a valid period.
 */
export function toBrReceitaPersistedSnapshot(
  row: BrReceitaCnpjSnapshotRow,
): BrReceitaPersistedSnapshot {
  assertBrazilReceitaPersistedIdentityIsValid(row);

  const sourcePeriod = assertValidSourcePeriod(row.source_period);

  return {
    identity: {
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
      source_period: sourcePeriod,
      // Derived, never taken from the row: the period is the authority, so the year cannot drift.
      source_year: sourcePeriodYear(sourcePeriod),
      normalized_tax_id: row.normalized_tax_id,
    },
    payload: {
      legal_name: row.legal_name,
      // 🔴 Narrowing, not copying: the projection has nowhere to put the import provenance the
      // parser row carries, so it cannot reach a row even by accident.
      signals: brReceitaRuntimeSignalsFromRawData(row.raw_data),
    },
  };
}

/** Strips the internal identity. What a consumer may see. */
export function toBrReceitaPublicSnapshotProjection(
  snapshot: BrReceitaPersistedSnapshot,
): BrReceitaPublicSnapshotProjection {
  return {
    source_key: snapshot.identity.source_key,
    country_code: snapshot.identity.country_code,
    source_period: snapshot.identity.source_period,
    legal_name: snapshot.payload.legal_name,
    signals: snapshot.payload.signals,
  };
}

/**
 * The logical identity of a snapshot, as a comparable string.
 *
 * 🔴 INTERNAL AND TRANSIENT. It is never persisted, never logged, never reported and never
 * returned to a consumer — it exists so in-batch deduplication can compare identities, and so a
 * test can assert that "same CNPJ + same period" is one identity while "same CNPJ + next period"
 * is two. It is NOT a second persisted representation: nothing writes it anywhere.
 *
 * The separator cannot occur inside any component — `source_key` and `country_code` are fixed
 * literals, a period is `YYYY-MM`, and a normalized CNPJ is `[A-Z0-9]{12}[0-9]{2}` — so the
 * concatenation is unambiguous without escaping.
 */
export function brReceitaLogicalSnapshotIdentity(identity: BrReceitaSnapshotIdentity): string {
  return [
    identity.source_key,
    identity.country_code,
    identity.source_period,
    identity.normalized_tax_id,
  ].join('|');
}

/**
 * The exact-lookup coordinates a period-aware reader needs, as data.
 *
 * 🔴 Recorded here rather than implemented as a reader, because the five primitives in
 * `snapshot-read/` are all `source_year`-scoped and Brazil puts twelve periods inside one year. A
 * year-scoped read of one Brazilian fiscal identity legitimately sees more than one row and would
 * report a cardinality violation. The period-aware primitive is CUT B's, and this constant is what
 * it must filter on so the shape cannot be guessed wrong.
 */
export const BR_RECEITA_PERIOD_EXACT_LOOKUP_COLUMNS: readonly string[] = [
  'source_key',
  'country_code',
  'source_period',
  'normalized_tax_id',
] as const;

/** Re-exported so a caller reading this module sees the bounds it operates under. */
export const BR_RECEITA_MONTHLY_IDENTITY_AUTHORIZATION =
  BRAZIL_RECEITA_CUT_A_MONTHLY_IDENTITY_AUTHORIZATION;
