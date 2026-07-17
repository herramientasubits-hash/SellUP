/**
 * Cardinality-aware snapshot read contract for source_company_snapshots.
 * Hito: EC4D5.APP-C3 — Snapshot read contract implementation.
 *
 * These are the safe lookup primitives that APP-C4/APP-C5 will migrate the
 * existing readers onto. They do NOT touch any current reader, writer, DB
 * schema or migration — they only add new, well-typed read paths.
 *
 * WHY THIS EXISTS
 * ----------------
 * Today many readers do `.limit(1).maybeSingle()` on normalized_tax_id. Once
 * the old tax unique index is dropped (DB-D), a fiscal id can legitimately
 * (NATIVE_RECORD_GRAIN) or illegitimately (TAX_GRAIN invariant break) map to
 * more than one row, and `.limit(1)` would silently truncate to ONE arbitrary
 * row with NO error. Each contract below refuses to pick silently:
 *
 * - readSnapshotByRecordIdentityKey: exact record identity (CN1 guarantees
 *   zero-or-one), so maybeSingle is safe.
 * - readTaxGrainSnapshotByTaxId: TAX_GRAIN only. Probes with `.limit(2)` and
 *   flags 2 rows as a family invariant violation instead of hiding it.
 * - probeNativeSnapshotsByTaxId: NATIVE_RECORD_GRAIN only. Probes a bounded
 *   window and reports multiplicity instead of collapsing it.
 *
 * Source family is looked up fail-closed via getSourceFamily: an unknown
 * source_key throws, and a contract used against the wrong family throws.
 * DB/transport errors are never converted into RECORD_IDENTITY_NOT_FOUND —
 * they surface as a thrown SnapshotReadQueryError.
 */

import { getSourceFamily } from '../record-identity/source-family-registry';
import {
  normalizeRecordIdentityPart,
  validateRecordIdentityKey,
} from '../record-identity/record-identity-key';
import type { SnapshotReadResult } from './snapshot-read-types';

/** The only table these contracts read. */
export const SNAPSHOT_TABLE = 'source_company_snapshots' as const;

/**
 * Explicit, testable default projection. We deliberately do not chase a
 * curated column list until readers migrate (APP-C4/C5) and pin exactly what
 * they consume; callers may override via `selectColumns`. Kept as a named
 * constant so the default is greppable and asserted in tests.
 */
export const DEFAULT_SNAPSHOT_SELECT_COLUMNS = '*' as const;

/**
 * Native probe default window. Bounds both the query and the reported
 * `recordIdentityKeys`, so a pathological fiscal id can never return a huge
 * payload. Callers can raise/lower it per call.
 */
export const DEFAULT_NATIVE_PROBE_LIMIT = 10;

/** Upper bound on `recordIdentityKeys` echoed back on multiplicity. */
export const MAX_REPORTED_RECORD_IDENTITY_KEYS = 25;

// ── Minimal PostgREST client surface ────────────────────────────────────────
// Structural subset of the supabase-js query builder that both the real client
// and the APP-C2 fake satisfy. Intentionally tiny: only what these contracts
// call. `order` exists solely for the latest-year TAX_GRAIN lookup (APP-C3B),
// which sorts by source_year desc; the source_year-pinned lookups never use it.

/** PostgREST-shaped error. Only truthiness (and `code`) is load-bearing here. */
export interface SnapshotReadPostgrestError {
  readonly code?: string;
  readonly message?: string;
  readonly details?: string | null;
  readonly hint?: string | null;
}

export interface SnapshotReadListResponse<TRow> {
  readonly data: TRow[] | null;
  readonly error: SnapshotReadPostgrestError | null;
}

export interface SnapshotReadSingleResponse<TRow> {
  readonly data: TRow | null;
  readonly error: SnapshotReadPostgrestError | null;
}

export interface SnapshotReadFilterableQuery<TRow>
  extends PromiseLike<SnapshotReadListResponse<TRow>> {
  eq(column: string, value: unknown): SnapshotReadFilterableQuery<TRow>;
  order(
    column: string,
    options?: { ascending?: boolean },
  ): SnapshotReadFilterableQuery<TRow>;
  limit(count: number): SnapshotReadFilterableQuery<TRow>;
  maybeSingle(): Promise<SnapshotReadSingleResponse<TRow>>;
}

export interface SnapshotReadTableQuery<TRow> {
  select(columns?: string): SnapshotReadFilterableQuery<TRow>;
}

export interface SnapshotReadClient<TRow> {
  from(table: string): SnapshotReadTableQuery<TRow>;
}

/** Minimal identity-bearing shape a snapshot row exposes to the contract. */
export interface SnapshotIdentityRow {
  readonly record_identity_key?: string | null;
  readonly normalized_tax_id?: string | null;
  readonly [column: string]: unknown;
}

/**
 * Thrown on any unexpected DB/PostgREST failure. This is deliberately OUTSIDE
 * SnapshotReadResult: infrastructure errors must never masquerade as a domain
 * "not found".
 */
export class SnapshotReadQueryError extends Error {
  readonly code?: string;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    options: { code?: string; context?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'SnapshotReadQueryError';
    this.code = options.code;
    this.context = Object.freeze({ ...(options.context ?? {}) });
  }
}

// ── shared parameter shapes ─────────────────────────────────────────────────

interface CommonSnapshotKey {
  readonly sourceKey: string;
  readonly countryCode: string;
  readonly sourceYear: number;
}

export interface ReadSnapshotByRecordIdentityKeyParams<TRow> extends CommonSnapshotKey {
  readonly client: SnapshotReadClient<TRow>;
  readonly recordIdentityKey: string;
  readonly selectColumns?: string;
}

export interface ReadTaxGrainSnapshotByTaxIdParams<TRow> extends CommonSnapshotKey {
  readonly client: SnapshotReadClient<TRow>;
  readonly normalizedTaxId: string | null | undefined;
  readonly selectColumns?: string;
}

/**
 * Latest-year TAX_GRAIN lookup: deliberately has NO `sourceYear`. It resolves
 * the most recent source_year for a fiscal id within (source_key,
 * country_code), which is why it cannot extend CommonSnapshotKey.
 */
export interface ReadLatestTaxGrainSnapshotByTaxIdParams<TRow> {
  readonly client: SnapshotReadClient<TRow>;
  readonly sourceKey: string;
  readonly countryCode: string;
  readonly normalizedTaxId: string | null | undefined;
  readonly selectColumns?: string;
}

export interface ProbeNativeSnapshotsByTaxIdParams<TRow> extends CommonSnapshotKey {
  readonly client: SnapshotReadClient<TRow>;
  readonly normalizedTaxId: string | null | undefined;
  readonly probeLimit?: number;
  readonly selectColumns?: string;
}

/**
 * Latest-year NATIVE_RECORD_GRAIN probe: deliberately has NO `sourceYear`. It
 * resolves the MOST RECENT source_year for a fiscal id within (source_key,
 * country_code), which is why it cannot extend CommonSnapshotKey.
 */
export interface ProbeLatestNativeSnapshotsByTaxIdParams<TRow> {
  readonly client: SnapshotReadClient<TRow>;
  readonly sourceKey: string;
  readonly countryCode: string;
  readonly normalizedTaxId: string | null | undefined;
  readonly selectColumns?: string;
}

// ── internal helpers ────────────────────────────────────────────────────────

function baseIdentityQuery<TRow>(
  client: SnapshotReadClient<TRow>,
  key: CommonSnapshotKey,
  selectColumns: string,
): SnapshotReadFilterableQuery<TRow> {
  return client
    .from(SNAPSHOT_TABLE)
    .select(selectColumns)
    .eq('source_key', key.sourceKey)
    .eq('country_code', key.countryCode)
    .eq('source_year', key.sourceYear);
}

function throwOnQueryError(
  error: SnapshotReadPostgrestError | null,
  context: Record<string, unknown>,
): void {
  if (error) {
    throw new SnapshotReadQueryError(
      `Snapshot read failed${error.code ? ` (${error.code})` : ''}`,
      { code: error.code, context },
    );
  }
}

/** Reads a finite numeric source_year off a row, or null if unusable. */
function readNumericSourceYear(row: SnapshotIdentityRow): number | null {
  const value = row.source_year;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collectBoundedRecordIdentityKeys<TRow extends SnapshotIdentityRow>(
  rows: readonly TRow[],
): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    const key = normalizeRecordIdentityPart(row.record_identity_key);
    if (key !== null) {
      keys.push(key);
      if (keys.length >= MAX_REPORTED_RECORD_IDENTITY_KEYS) {
        break;
      }
    }
  }
  return keys;
}

// ── 1. exact record identity lookup ─────────────────────────────────────────

/**
 * Reads the single snapshot row for an exact record identity within
 * (source_key, country_code, source_year, record_identity_key).
 *
 * CN1 guarantees zero-or-one row for this tuple, so `maybeSingle` is the
 * correct cardinality primitive here. An unexpected >1 (CN1 breach) surfaces
 * as a thrown SnapshotReadQueryError via PostgREST, never as a silent pick.
 */
export async function readSnapshotByRecordIdentityKey<
  TRow extends SnapshotIdentityRow = SnapshotIdentityRow,
>(
  params: ReadSnapshotByRecordIdentityKeyParams<TRow>,
): Promise<SnapshotReadResult<TRow>> {
  const {
    client,
    sourceKey,
    countryCode,
    sourceYear,
    recordIdentityKey,
    selectColumns = DEFAULT_SNAPSHOT_SELECT_COLUMNS,
  } = params;

  const validation = validateRecordIdentityKey(recordIdentityKey);
  if (!validation.valid) {
    return { status: 'IDENTITY_UNAVAILABLE', reason: validation.reason };
  }

  const { data, error } = await baseIdentityQuery(
    client,
    { sourceKey, countryCode, sourceYear },
    selectColumns,
  )
    .eq('record_identity_key', recordIdentityKey)
    .maybeSingle();

  throwOnQueryError(error, {
    lookup: 'readSnapshotByRecordIdentityKey',
    sourceKey,
    countryCode,
    sourceYear,
    recordIdentityKey,
  });

  if (data === null) {
    return { status: 'RECORD_IDENTITY_NOT_FOUND' };
  }

  return { status: 'FOUND', row: data };
}

// ── 2. tax-grain lookup by normalized tax id ────────────────────────────────

/**
 * Reads the single TAX_GRAIN snapshot row for a normalized tax id within
 * (source_key, country_code, source_year). Fails closed if `sourceKey` is not
 * TAX_GRAIN.
 *
 * Probes with `.limit(2)` (NEVER `.limit(1).maybeSingle()`): two rows for the
 * same fiscal id within one source_year is a family invariant violation and is
 * reported as such, not collapsed to an arbitrary row.
 */
export async function readTaxGrainSnapshotByTaxId<
  TRow extends SnapshotIdentityRow = SnapshotIdentityRow,
>(
  params: ReadTaxGrainSnapshotByTaxIdParams<TRow>,
): Promise<SnapshotReadResult<TRow>> {
  const {
    client,
    sourceKey,
    countryCode,
    sourceYear,
    normalizedTaxId,
    selectColumns = DEFAULT_SNAPSHOT_SELECT_COLUMNS,
  } = params;

  const family = getSourceFamily(sourceKey);
  if (family !== 'TAX_GRAIN') {
    throw new SnapshotReadQueryError(
      `readTaxGrainSnapshotByTaxId called for non-TAX_GRAIN source "${sourceKey}" (${family})`,
      { context: { sourceKey, family } },
    );
  }

  const normalized = normalizeRecordIdentityPart(normalizedTaxId);
  if (normalized === null) {
    return { status: 'IDENTITY_UNAVAILABLE', reason: 'missing_tax_id' };
  }

  const { data, error } = await baseIdentityQuery(
    client,
    { sourceKey, countryCode, sourceYear },
    selectColumns,
  )
    .eq('normalized_tax_id', normalized)
    .limit(2);

  throwOnQueryError(error, {
    lookup: 'readTaxGrainSnapshotByTaxId',
    sourceKey,
    countryCode,
    sourceYear,
    normalizedTaxId: normalized,
  });

  if (data === null) {
    // List queries return an array on success; a null payload with no error is
    // an unexpected transport state, not a domain "not found".
    throw new SnapshotReadQueryError('Snapshot read returned no data and no error', {
      context: {
        lookup: 'readTaxGrainSnapshotByTaxId',
        sourceKey,
        countryCode,
        sourceYear,
        normalizedTaxId: normalized,
      },
    });
  }

  if (data.length === 0) {
    return { status: 'RECORD_IDENTITY_NOT_FOUND' };
  }

  if (data.length === 1) {
    return { status: 'FOUND', row: data[0] };
  }

  return {
    status: 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION',
    sourceKey,
    countryCode,
    sourceYear,
    normalizedTaxId: normalized,
    recordCount: data.length,
  };
}

// ── 2b. latest-year tax-grain lookup by normalized tax id ───────────────────

/**
 * Reads the TAX_GRAIN snapshot row for a normalized tax id at its MOST RECENT
 * source_year within (source_key, country_code). Fails closed if `sourceKey`
 * is not TAX_GRAIN.
 *
 * This is the safe replacement for the legacy
 * `order('source_year', desc).limit(1).maybeSingle()` "latest available year"
 * pattern. It orders by source_year desc and probes with `.limit(2)` (NEVER
 * `.limit(1).maybeSingle()`):
 *
 * - The two most-recent rows share the same source_year → the latest year is
 *   ambiguous, i.e. more than one row for the fiscal id within that year. That
 *   is a TAX_GRAIN family invariant violation, reported as such — never an
 *   arbitrary silent pick.
 * - They differ → `data[0]` is unambiguously the latest year, returned FOUND.
 *
 * `selectColumns` must include `source_year` (the default `*` does). If it is
 * absent from both probed rows the contract throws rather than guess.
 */
export async function readLatestTaxGrainSnapshotByTaxId<
  TRow extends SnapshotIdentityRow = SnapshotIdentityRow,
>(
  params: ReadLatestTaxGrainSnapshotByTaxIdParams<TRow>,
): Promise<SnapshotReadResult<TRow>> {
  const {
    client,
    sourceKey,
    countryCode,
    normalizedTaxId,
    selectColumns = DEFAULT_SNAPSHOT_SELECT_COLUMNS,
  } = params;

  const family = getSourceFamily(sourceKey);
  if (family !== 'TAX_GRAIN') {
    throw new SnapshotReadQueryError(
      `readLatestTaxGrainSnapshotByTaxId called for non-TAX_GRAIN source "${sourceKey}" (${family})`,
      { context: { sourceKey, family } },
    );
  }

  const normalized = normalizeRecordIdentityPart(normalizedTaxId);
  if (normalized === null) {
    return { status: 'IDENTITY_UNAVAILABLE', reason: 'missing_tax_id' };
  }

  const { data, error } = await client
    .from(SNAPSHOT_TABLE)
    .select(selectColumns)
    .eq('source_key', sourceKey)
    .eq('country_code', countryCode)
    .eq('normalized_tax_id', normalized)
    .order('source_year', { ascending: false })
    .limit(2);

  throwOnQueryError(error, {
    lookup: 'readLatestTaxGrainSnapshotByTaxId',
    sourceKey,
    countryCode,
    normalizedTaxId: normalized,
  });

  if (data === null) {
    throw new SnapshotReadQueryError('Snapshot read returned no data and no error', {
      context: {
        lookup: 'readLatestTaxGrainSnapshotByTaxId',
        sourceKey,
        countryCode,
        normalizedTaxId: normalized,
      },
    });
  }

  if (data.length === 0) {
    return { status: 'RECORD_IDENTITY_NOT_FOUND' };
  }

  if (data.length === 1) {
    return { status: 'FOUND', row: data[0] };
  }

  // Two rows probed, already ordered by source_year desc.
  const latestYear = readNumericSourceYear(data[0]);
  const runnerUpYear = readNumericSourceYear(data[1]);

  if (latestYear === null || runnerUpYear === null) {
    throw new SnapshotReadQueryError(
      'readLatestTaxGrainSnapshotByTaxId cannot determine source_year for the latest row',
      {
        context: {
          lookup: 'readLatestTaxGrainSnapshotByTaxId',
          sourceKey,
          countryCode,
          normalizedTaxId: normalized,
          hint: 'selectColumns must include source_year',
        },
      },
    );
  }

  if (latestYear === runnerUpYear) {
    // Ambiguous latest year: >1 row for the fiscal id within the most recent
    // source_year. Report the violation, never pick arbitrarily.
    return {
      status: 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION',
      sourceKey,
      countryCode,
      sourceYear: latestYear,
      normalizedTaxId: normalized,
      recordCount: data.length,
    };
  }

  return { status: 'FOUND', row: data[0] };
}

// ── 3. native-grain multiplicity probe by normalized tax id ─────────────────

/**
 * Probes NATIVE_RECORD_GRAIN snapshots for a normalized tax id within
 * (source_key, country_code, source_year). Fails closed if `sourceKey` is not
 * NATIVE_RECORD_GRAIN.
 *
 * For these sources the same fiscal id may legitimately span multiple records,
 * so this NEVER picks one silently. It reads a bounded window (`probeLimit`)
 * and reports multiplicity with bounded `recordIdentityKeys`. Status-only in
 * APP-C3: it does not migrate any reader.
 */
export async function probeNativeSnapshotsByTaxId<
  TRow extends SnapshotIdentityRow = SnapshotIdentityRow,
>(
  params: ProbeNativeSnapshotsByTaxIdParams<TRow>,
): Promise<SnapshotReadResult<TRow>> {
  const {
    client,
    sourceKey,
    countryCode,
    sourceYear,
    normalizedTaxId,
    probeLimit = DEFAULT_NATIVE_PROBE_LIMIT,
    selectColumns = DEFAULT_SNAPSHOT_SELECT_COLUMNS,
  } = params;

  const family = getSourceFamily(sourceKey);
  if (family !== 'NATIVE_RECORD_GRAIN') {
    throw new SnapshotReadQueryError(
      `probeNativeSnapshotsByTaxId called for non-NATIVE_RECORD_GRAIN source "${sourceKey}" (${family})`,
      { context: { sourceKey, family } },
    );
  }

  const normalized = normalizeRecordIdentityPart(normalizedTaxId);
  if (normalized === null) {
    return { status: 'IDENTITY_UNAVAILABLE', reason: 'missing_tax_id' };
  }

  // At least 2 rows must be observable to distinguish FOUND from multiplicity,
  // regardless of the caller's probeLimit.
  const effectiveLimit = Math.max(2, Math.floor(probeLimit));

  const { data, error } = await baseIdentityQuery(
    client,
    { sourceKey, countryCode, sourceYear },
    selectColumns,
  )
    .eq('normalized_tax_id', normalized)
    .limit(effectiveLimit);

  throwOnQueryError(error, {
    lookup: 'probeNativeSnapshotsByTaxId',
    sourceKey,
    countryCode,
    sourceYear,
    normalizedTaxId: normalized,
  });

  if (data === null) {
    throw new SnapshotReadQueryError('Snapshot read returned no data and no error', {
      context: {
        lookup: 'probeNativeSnapshotsByTaxId',
        sourceKey,
        countryCode,
        sourceYear,
        normalizedTaxId: normalized,
      },
    });
  }

  if (data.length === 0) {
    return { status: 'RECORD_IDENTITY_NOT_FOUND' };
  }

  if (data.length === 1) {
    return { status: 'FOUND', row: data[0] };
  }

  return {
    status: 'MULTI_RECORD_SAME_FISCAL_IDENTITY',
    sourceKey,
    countryCode,
    sourceYear,
    normalizedTaxId: normalized,
    recordCount: data.length,
    recordIdentityKeys: collectBoundedRecordIdentityKeys(data),
  };
}

// ── 3b. native-grain latest-year multiplicity probe by normalized tax id ─────

/**
 * Probes NATIVE_RECORD_GRAIN snapshots for a normalized tax id at its MOST
 * RECENT source_year within (source_key, country_code). Fails closed if
 * `sourceKey` is not NATIVE_RECORD_GRAIN.
 *
 * This is the native-family counterpart of readLatestTaxGrainSnapshotByTaxId
 * and the safe replacement for the legacy "use the latest available year"
 * reader shape (`order('source_year', desc).limit(1)`) on native sources whose
 * caller passes NO `sourceYear`. It orders by source_year desc and probes with
 * `.limit(2)` (NEVER `.limit(1).maybeSingle()`):
 *
 * - The two most-recent rows differ in source_year → `data[0]` is unambiguously
 *   the latest year, returned FOUND. A duplicate in an OLDER year is irrelevant
 *   to "latest available year".
 * - They share the same source_year → the same fiscal id legitimately maps to
 *   more than one record within the most recent year. For NATIVE_RECORD_GRAIN
 *   that is not an invariant breach but genuine multiplicity, reported as
 *   MULTI_RECORD_SAME_FISCAL_IDENTITY (with bounded recordIdentityKeys) — never
 *   an arbitrary silent pick.
 *
 * `selectColumns` must include `source_year` (the default `*` does). If it is
 * absent from both probed rows the contract throws rather than guess.
 */
export async function probeLatestNativeSnapshotsByTaxId<
  TRow extends SnapshotIdentityRow = SnapshotIdentityRow,
>(
  params: ProbeLatestNativeSnapshotsByTaxIdParams<TRow>,
): Promise<SnapshotReadResult<TRow>> {
  const {
    client,
    sourceKey,
    countryCode,
    normalizedTaxId,
    selectColumns = DEFAULT_SNAPSHOT_SELECT_COLUMNS,
  } = params;

  const family = getSourceFamily(sourceKey);
  if (family !== 'NATIVE_RECORD_GRAIN') {
    throw new SnapshotReadQueryError(
      `probeLatestNativeSnapshotsByTaxId called for non-NATIVE_RECORD_GRAIN source "${sourceKey}" (${family})`,
      { context: { sourceKey, family } },
    );
  }

  const normalized = normalizeRecordIdentityPart(normalizedTaxId);
  if (normalized === null) {
    return { status: 'IDENTITY_UNAVAILABLE', reason: 'missing_tax_id' };
  }

  const { data, error } = await client
    .from(SNAPSHOT_TABLE)
    .select(selectColumns)
    .eq('source_key', sourceKey)
    .eq('country_code', countryCode)
    .eq('normalized_tax_id', normalized)
    .order('source_year', { ascending: false })
    .limit(2);

  throwOnQueryError(error, {
    lookup: 'probeLatestNativeSnapshotsByTaxId',
    sourceKey,
    countryCode,
    normalizedTaxId: normalized,
  });

  if (data === null) {
    throw new SnapshotReadQueryError('Snapshot read returned no data and no error', {
      context: {
        lookup: 'probeLatestNativeSnapshotsByTaxId',
        sourceKey,
        countryCode,
        normalizedTaxId: normalized,
      },
    });
  }

  if (data.length === 0) {
    return { status: 'RECORD_IDENTITY_NOT_FOUND' };
  }

  if (data.length === 1) {
    return { status: 'FOUND', row: data[0] };
  }

  // Two rows probed, already ordered by source_year desc.
  const latestYear = readNumericSourceYear(data[0]);
  const runnerUpYear = readNumericSourceYear(data[1]);

  if (latestYear === null || runnerUpYear === null) {
    throw new SnapshotReadQueryError(
      'probeLatestNativeSnapshotsByTaxId cannot determine source_year for the latest row',
      {
        context: {
          lookup: 'probeLatestNativeSnapshotsByTaxId',
          sourceKey,
          countryCode,
          normalizedTaxId: normalized,
          hint: 'selectColumns must include source_year',
        },
      },
    );
  }

  if (latestYear === runnerUpYear) {
    // Ambiguous latest year: >1 native record for the fiscal id within the most
    // recent source_year. Report the multiplicity, never pick arbitrarily.
    return {
      status: 'MULTI_RECORD_SAME_FISCAL_IDENTITY',
      sourceKey,
      countryCode,
      sourceYear: latestYear,
      normalizedTaxId: normalized,
      recordCount: data.length,
      recordIdentityKeys: collectBoundedRecordIdentityKeys(data),
    };
  }

  return { status: 'FOUND', row: data[0] };
}
