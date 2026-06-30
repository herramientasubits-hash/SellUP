/**
 * Read-only coverage summary for Peru SUNAT snapshot and Migo fallback.
 *
 * Guardrails (enforced by design — no external calls, no writes):
 *   noSunatWebRuntime      : this module never fetches from sunat.gob.pe
 *   noVercelZipProcessing  : no zip/bulk-file processing at runtime
 *   noMigoDiscovery        : Migo check is vault-presence only, no API call
 *   noOfficialCiiuForMvp   : CIIU is not available in this snapshot
 *   sectorIsInferredByWebAi: sector is inferred by web/AI, not from SUNAT
 */

import { createClient } from '@supabase/supabase-js';

import { hasMigoApiKey } from './migo-connection';

// ---------------------------------------------------------------------------
// Audited constants
// Source: AUDITORIA-FUENTES-IA.md — Hito Perú.7F (2026-06-26)
// ---------------------------------------------------------------------------

export interface SunatSnapshotCounts {
  total: number;
  activeHabido: number;
  activeNotHabido: number;
  inactiveHabido: number;
  inactiveNotHabido: number;
}

/** Origin of the SUNAT coverage numbers shown in the indicator. */
export type CoverageSource = 'live_database' | 'audited_fallback';

/**
 * Safe, secret-free explanation for why the indicator fell back to audited
 * constants instead of reading live. Surfaced discreetly in the UI for
 * traceability — never carries raw errors, URLs, keys, or payloads.
 *
 *   missing_env  : SUPABASE_SERVICE_ROLE_KEY not present in this runtime.
 *   query_failed : the read-only COUNT query threw (e.g. statement timeout).
 *   unknown      : the dynamic read returned no counts for an unclassified reason.
 */
export type CoverageSourceReason = 'missing_env' | 'query_failed' | 'unknown';

/** Last confirmed snapshot distribution (Perú.7F, 2026-06-26). */
export const AUDITED_SUNAT_SNAPSHOT: SunatSnapshotCounts = {
  total: 100_000,
  activeHabido: 14_221,
  activeNotHabido: 1_199,
  inactiveHabido: 48_188,
  inactiveNotHabido: 36_392,
};

/**
 * Audited RUC-20 denominators from the local SUNAT Padrón snapshot.
 * Source: AUDITORIA-FUENTES-IA.md — Hito Perú.9G (2026-06-26).
 *
 *   AUDITED_TOTAL_RUC20_ROWS        = full RUC-20 universe (active + inactive).
 *   AUDITED_ACTIVE_HABIDO_RUC20_ROWS = subset that is ACTIVO + HABIDO (legally
 *                                      valid companies usable in the lookup).
 *
 * These are two DIFFERENT universes. Coverage of the loaded snapshot must use
 * the full universe; coverage of legally-valid companies must use the
 * active+habido universe. Mixing them (the pre-9G bug) overstated coverage and
 * could exceed 100% as more rows load.
 */
export const AUDITED_TOTAL_RUC20_ROWS = 2_317_298;
export const AUDITED_ACTIVE_HABIDO_RUC20_ROWS = 851_883;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface SunatCoverage {
  sourceKey: 'pe_sunat_bulk';
  loadedRows: number;
  activeHabidoRows: number;
  activeNotHabidoRows: number;
  inactiveHabidoRows: number;
  inactiveNotHabidoRows: number;
  nextRecommendedOffset: number;
  coverageLabel: 'partial_snapshot' | 'complete_snapshot';
  /** Audited full RUC-20 universe (active + inactive). Denominator for loaded coverage. */
  auditedTotalRuc20Rows: number;
  /** Audited ACTIVO + HABIDO RUC-20 universe. Denominator for active+habido coverage. */
  auditedActiveHabidoRuc20Rows: number;
  /** loadedRows / auditedTotalRuc20Rows, percent rounded to 1 decimal. */
  loadedRowsCoveragePercent: number;
  /** activeHabidoRows / auditedActiveHabidoRuc20Rows, percent rounded to 1 decimal. */
  activeHabidoCoveragePercent: number;
  /**
   * @deprecated Pre-9G field kept for backwards compatibility only. Maps to
   * `loadedRowsCoveragePercent`. Do NOT surface this label visually — use the
   * two explicit coverage fields instead.
   */
  coveragePercent: number;
  coverageSource: CoverageSource;
  /**
   * Present only when coverageSource is 'audited_fallback'. Safe, secret-free
   * classification of why the live read was unavailable. Omitted on success.
   */
  coverageSourceReason?: CoverageSourceReason;
  officialLegalValidation: true;
  providesCiiu: false;
  providesOfficialSector: false;
}

export interface MigoCoverage {
  sourceKey: 'pe_migo_api';
  role: 'legal_api_fallback';
  configured: boolean | 'unknown';
  providesCiiu: false;
  providesOfficialSector: false;
  performsDiscovery: false;
}

export interface PeruGuardrails {
  noSunatWebRuntime: true;
  noVercelZipProcessing: true;
  noMigoDiscovery: true;
  noOfficialCiiuForMvp: true;
  sectorIsInferredByWebAi: true;
}

export interface PeruSourceCoverageSummary {
  countryCode: 'PE';
  sunat: SunatCoverage;
  migo: MigoCoverage;
  guardrails: PeruGuardrails;
}

// ---------------------------------------------------------------------------
// Pure builders (no I/O — fully testable without mocks)
// ---------------------------------------------------------------------------

/**
 * Builds the SUNAT coverage block from provided row counts.
 * nextRecommendedOffset = loadedRows (resume point for next import batch).
 *
 * @param coverageSource Whether the counts came from a live DB read or the
 *                       audited fallback. Defaults to 'audited_fallback' so
 *                       pure callers and existing tests stay backwards-safe.
 */
export function buildSunatCoverage(
  counts: SunatSnapshotCounts,
  coverageSource: CoverageSource = 'audited_fallback',
  coverageSourceReason?: CoverageSourceReason,
): SunatCoverage {
  const loadedRowsCoveragePercent =
    Math.round((counts.total / AUDITED_TOTAL_RUC20_ROWS) * 1000) / 10;
  const activeHabidoCoveragePercent =
    Math.round((counts.activeHabido / AUDITED_ACTIVE_HABIDO_RUC20_ROWS) * 1000) / 10;

  return {
    sourceKey: 'pe_sunat_bulk',
    loadedRows: counts.total,
    activeHabidoRows: counts.activeHabido,
    activeNotHabidoRows: counts.activeNotHabido,
    inactiveHabidoRows: counts.inactiveHabido,
    inactiveNotHabidoRows: counts.inactiveNotHabido,
    nextRecommendedOffset: counts.total,
    coverageLabel: counts.total >= AUDITED_TOTAL_RUC20_ROWS ? 'complete_snapshot' : 'partial_snapshot',
    auditedTotalRuc20Rows: AUDITED_TOTAL_RUC20_ROWS,
    auditedActiveHabidoRuc20Rows: AUDITED_ACTIVE_HABIDO_RUC20_ROWS,
    loadedRowsCoveragePercent,
    activeHabidoCoveragePercent,
    // Deprecated compat alias → loaded-snapshot coverage, never the old 851_883 math.
    coveragePercent: loadedRowsCoveragePercent,
    coverageSource,
    // Only attach a reason on fallback; success stays clean (field omitted).
    ...(coverageSource === 'audited_fallback' && coverageSourceReason
      ? { coverageSourceReason }
      : {}),
    officialLegalValidation: true,
    providesCiiu: false,
    providesOfficialSector: false,
  };
}

/** Builds the Migo coverage block. Never reads the API key value. */
export function buildMigoCoverage(configured: boolean | 'unknown'): MigoCoverage {
  return {
    sourceKey: 'pe_migo_api',
    role: 'legal_api_fallback',
    configured,
    providesCiiu: false,
    providesOfficialSector: false,
    performsDiscovery: false,
  };
}

/** Returns the static guardrail flags. */
export function buildGuardrails(): PeruGuardrails {
  return {
    noSunatWebRuntime: true,
    noVercelZipProcessing: true,
    noMigoDiscovery: true,
    noOfficialCiiuForMvp: true,
    sectorIsInferredByWebAi: true,
  };
}

/** Assembles the full summary from pre-fetched parts. */
export function buildPeruCoverageSummary(
  counts: SunatSnapshotCounts,
  migoConfigured: boolean | 'unknown',
  coverageSource: CoverageSource = 'audited_fallback',
  coverageSourceReason?: CoverageSourceReason,
): PeruSourceCoverageSummary {
  return {
    countryCode: 'PE',
    sunat: buildSunatCoverage(counts, coverageSource, coverageSourceReason),
    migo: buildMigoCoverage(migoConfigured),
    guardrails: buildGuardrails(),
  };
}

// ---------------------------------------------------------------------------
// Dynamic read-only SUNAT counts (server-side only)
// ---------------------------------------------------------------------------

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SNAPSHOT_TABLE = 'peru_sunat_ruc_snapshot';
const COVERAGE_SUMMARY_TABLE = 'source_coverage_summaries';

// ---------------------------------------------------------------------------
// Summary-table read (Perú.9M.1 — primary path, avoids COUNT(*) at render)
// ---------------------------------------------------------------------------

/**
 * Row shape returned by source_coverage_summaries for pe_sunat_bulk.
 * Only the fields we consume — extra columns are ignored.
 */
interface CoverageSummaryRow {
  loaded_rows: number;
  next_recommended_offset: number;
  audited_total_rows: number;
  audited_active_habido_rows: number;
  active_habido_rows: number;
  active_no_habido_rows: number;
  inactive_habido_rows: number;
  inactive_no_habido_rows: number;
}

/**
 * Reads the pre-computed summary row for pe_sunat_bulk from
 * source_coverage_summaries. Returns null when absent or on any error —
 * caller falls back to the dynamic COUNT path. Never throws. Never writes.
 */
export async function getSunatCoverageSummaryRow(): Promise<CoverageSummaryRow | null> {
  if (!supabaseServiceKey) return null;

  let admin;
  try {
    admin = createClient(supabaseUrl, supabaseServiceKey);
  } catch {
    return null;
  }

  try {
    const { data, error } = await admin
      .from(COVERAGE_SUMMARY_TABLE)
      .select(
        'loaded_rows,next_recommended_offset,audited_total_rows,audited_active_habido_rows,' +
        'active_habido_rows,active_no_habido_rows,inactive_habido_rows,inactive_no_habido_rows',
      )
      .eq('source_key', 'pe_sunat_bulk')
      .single();

    if (error || !data) return null;

    const row = data as unknown as CoverageSummaryRow;

    // Sanity: loaded_rows must be positive and breakdown must sum exactly.
    if (row.loaded_rows <= 0) return null;
    const sum =
      row.active_habido_rows +
      row.active_no_habido_rows +
      row.inactive_habido_rows +
      row.inactive_no_habido_rows;
    if (sum !== row.loaded_rows) return null;

    return row;
  } catch {
    return null;
  }
}

/** Boolean columns used to bucket the snapshot distribution. */
type SnapshotBoolColumn = 'is_active' | 'is_habido';

/**
 * Read-only row counter. Receives a list of (column, value) equality filters
 * and returns the exact row count. Injectable so the distribution math can be
 * tested without a live Supabase connection.
 */
export type SnapshotCountQuery = (
  filters: ReadonlyArray<readonly [SnapshotBoolColumn, boolean]>,
) => Promise<number>;

/**
 * Computes the five snapshot buckets by issuing read-only COUNT queries.
 * Pure orchestration over the injected counter — no I/O of its own.
 */
export async function computeDynamicCounts(
  countRows: SnapshotCountQuery,
): Promise<SunatSnapshotCounts> {
  const [total, activeHabido, activeNotHabido, inactiveHabido, inactiveNotHabido] =
    await Promise.all([
      countRows([]),
      countRows([
        ['is_active', true],
        ['is_habido', true],
      ]),
      countRows([
        ['is_active', true],
        ['is_habido', false],
      ]),
      countRows([
        ['is_active', false],
        ['is_habido', true],
      ]),
      countRows([
        ['is_active', false],
        ['is_habido', false],
      ]),
    ]);

  return { total, activeHabido, activeNotHabido, inactiveHabido, inactiveNotHabido };
}

/**
 * Reads the SUNAT snapshot distribution directly from Supabase, read-only.
 *
 * Uses `select(..., { count: 'exact', head: true })`, which issues a COUNT
 * over the table and returns ZERO rows — no payloads, no writes. Returns null
 * when the service role key is absent, when the client cannot be created, or
 * when any count query fails, so callers can fall back to audited constants.
 *
 * Server-side only: relies on SUPABASE_SERVICE_ROLE_KEY which is never exposed
 * to the browser bundle.
 */
/**
 * Per-attempt ceiling for a single COUNT. Set ABOVE the database statement
 * timeout on purpose: an exact count over a multi-million-row table can legitimately
 * take several seconds, so this only guards against a truly hung connection — it
 * must never abort a slow-but-successful count (which would force a needless
 * fallback). A genuinely slow query is ended by the DB's own timeout and then
 * retried below.
 */
const COUNT_QUERY_TIMEOUT_MS = 10_000;

/** How many times to attempt the full distribution read before giving up. */
const DYNAMIC_READ_MAX_ATTEMPTS = 3;

export async function getDynamicSunatCoverageCounts(): Promise<SunatSnapshotCounts | null> {
  if (!supabaseServiceKey) return null;

  let admin;
  try {
    admin = createClient(supabaseUrl, supabaseServiceKey);
  } catch {
    return null;
  }

  const countRows: SnapshotCountQuery = async (filters) => {
    let query = admin
      .from(SNAPSHOT_TABLE)
      .select('ruc', { count: 'exact', head: true })
      .abortSignal(AbortSignal.timeout(COUNT_QUERY_TIMEOUT_MS));
    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  };

  // Read-only retry: the exact COUNT intermittently times out on a cold
  // connection, which previously surfaced as a silent audited_fallback even
  // though 1.75M rows are loaded. Retrying the read-only counts (never a write)
  // makes the live read reliable on Vercel. On persistent failure, return null
  // so the caller falls back to audited constants with a traceable reason.
  for (let attempt = 1; attempt <= DYNAMIC_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await computeDynamicCounts(countRows);
    } catch {
      if (attempt === DYNAMIC_READ_MAX_ATTEMPTS) return null;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }

  return null;
}

/**
 * Resolves the SUNAT counts plus their provenance.
 * Tries the dynamic read first; on null or any thrown error, falls back to the
 * audited constants. Injectable for testing.
 */
export async function resolveSunatCounts(
  fetchDynamic: () => Promise<SunatSnapshotCounts | null> = getDynamicSunatCoverageCounts,
): Promise<{
  counts: SunatSnapshotCounts;
  coverageSource: CoverageSource;
  coverageSourceReason?: CoverageSourceReason;
}> {
  try {
    const dynamic = await fetchDynamic();
    if (dynamic) {
      return { counts: dynamic, coverageSource: 'live_database' };
    }
    // Reader returned no counts: distinguish a missing env from an unclassified
    // miss so the fallback is traceable. No secrets — only presence is checked.
    const reason: CoverageSourceReason = supabaseServiceKey ? 'unknown' : 'missing_env';
    return { counts: AUDITED_SUNAT_SNAPSHOT, coverageSource: 'audited_fallback', coverageSourceReason: reason };
  } catch {
    // Read threw (e.g. statement timeout) → safe audited fallback, traceable.
    return {
      counts: AUDITED_SUNAT_SNAPSHOT,
      coverageSource: 'audited_fallback',
      coverageSourceReason: 'query_failed',
    };
  }
}

// ---------------------------------------------------------------------------
// I/O helpers (async, injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Resolves whether the Migo API key is stored in Vault.
 * Returns 'unknown' when SUPABASE_SERVICE_ROLE_KEY is absent (cannot query).
 * Never reads or exposes the Migo key value itself.
 */
export async function resolveMigoConfigured(): Promise<boolean | 'unknown'> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return 'unknown';
  try {
    return await hasMigoApiKey();
  } catch {
    return 'unknown';
  }
}

/**
 * Returns a full, read-only coverage summary.
 *
 * Resolution order (Perú.9M.1):
 *   1. source_coverage_summaries table (fast, no COUNT(*))    → live_database
 *   2. Dynamic COUNT(*) on peru_sunat_ruc_snapshot (slow)     → live_database
 *   3. Audited constants fallback                             → audited_fallback
 *
 * When `counts` is provided explicitly it is used verbatim — useful for tests
 * and callers that already hold audited counts.
 *
 * @param counts   Provide to override with explicit audited counts.
 *                 Omit to resolve dynamically with safe fallback.
 */
export async function getPeruSourceCoverageSummary(
  counts?: SunatSnapshotCounts
): Promise<PeruSourceCoverageSummary> {
  const migoConfigured = await resolveMigoConfigured();

  if (counts) {
    return buildPeruCoverageSummary(counts, migoConfigured, 'audited_fallback');
  }

  // --- Path 1: pre-computed summary table (Perú.9M.1) ---
  const summaryRow = await getSunatCoverageSummaryRow();
  if (summaryRow) {
    const counts: SunatSnapshotCounts = {
      total: summaryRow.loaded_rows,
      activeHabido: summaryRow.active_habido_rows,
      activeNotHabido: summaryRow.active_no_habido_rows,
      inactiveHabido: summaryRow.inactive_habido_rows,
      inactiveNotHabido: summaryRow.inactive_no_habido_rows,
    };
    // buildSunatCoverage uses AUDITED_TOTAL_RUC20_ROWS / AUDITED_ACTIVE_HABIDO_RUC20_ROWS
    // from module-level constants; the summary row's audited_* columns are stored for
    // traceability but we keep the canonical constants to avoid drift.
    return buildPeruCoverageSummary(counts, migoConfigured, 'live_database');
  }

  // --- Path 2: dynamic COUNT(*) (original path, retained as fallback) ---
  const { counts: resolvedCounts, coverageSource, coverageSourceReason } =
    await resolveSunatCounts();
  return buildPeruCoverageSummary(
    resolvedCounts,
    migoConfigured,
    coverageSource,
    coverageSourceReason,
  );
}
