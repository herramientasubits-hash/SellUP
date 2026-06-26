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
  coverageLabel: 'partial_snapshot';
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
    coverageLabel: 'partial_snapshot',
    auditedTotalRuc20Rows: AUDITED_TOTAL_RUC20_ROWS,
    auditedActiveHabidoRuc20Rows: AUDITED_ACTIVE_HABIDO_RUC20_ROWS,
    loadedRowsCoveragePercent,
    activeHabidoCoveragePercent,
    // Deprecated compat alias → loaded-snapshot coverage, never the old 851_883 math.
    coveragePercent: loadedRowsCoveragePercent,
    coverageSource,
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
  coverageSource: CoverageSource = 'audited_fallback'
): PeruSourceCoverageSummary {
  return {
    countryCode: 'PE',
    sunat: buildSunatCoverage(counts, coverageSource),
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
      .select('ruc', { count: 'exact', head: true });
    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  };

  try {
    return await computeDynamicCounts(countRows);
  } catch {
    return null;
  }
}

/**
 * Resolves the SUNAT counts plus their provenance.
 * Tries the dynamic read first; on null or any thrown error, falls back to the
 * audited constants. Injectable for testing.
 */
export async function resolveSunatCounts(
  fetchDynamic: () => Promise<SunatSnapshotCounts | null> = getDynamicSunatCoverageCounts,
): Promise<{ counts: SunatSnapshotCounts; coverageSource: CoverageSource }> {
  try {
    const dynamic = await fetchDynamic();
    if (dynamic) {
      return { counts: dynamic, coverageSource: 'live_database' };
    }
  } catch {
    // Any failure → safe audited fallback below.
  }
  return { counts: AUDITED_SUNAT_SNAPSHOT, coverageSource: 'audited_fallback' };
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
 * When `counts` is provided, it is used verbatim (audited_fallback provenance)
 * — useful for tests and callers that already hold counts. When omitted, the
 * service attempts a dynamic read-only DB read (coverageSource = live_database)
 * and falls back to the audited constants (coverageSource = audited_fallback)
 * if Supabase is unavailable, the env is missing, or any query fails.
 *
 * @param counts   Provide to override with explicit audited counts.
 *                 Omit to read dynamically with safe fallback.
 */
export async function getPeruSourceCoverageSummary(
  counts?: SunatSnapshotCounts
): Promise<PeruSourceCoverageSummary> {
  const migoConfigured = await resolveMigoConfigured();

  if (counts) {
    return buildPeruCoverageSummary(counts, migoConfigured, 'audited_fallback');
  }

  const { counts: resolvedCounts, coverageSource } = await resolveSunatCounts();
  return buildPeruCoverageSummary(resolvedCounts, migoConfigured, coverageSource);
}
