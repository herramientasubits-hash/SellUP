/**
 * Read-only coverage summary for the República Dominicana DGII RNC snapshot.
 *
 * Guardrails (enforced by design):
 *   noDgiiWebRuntime       : never fetches from dgii.gov.do
 *   noApiBulkProcessing    : no bulk file processing at runtime
 *   noLlmCalls             : no Tavily, LLM, or external enrichment
 *   noOfficialCiiuForMvp   : CIIU is not available in this snapshot
 *   sectorIsTextFree       : sector is the raw text from DGII padrón
 *   noCedulasScope         : cédulas (11-digit) are excluded by design
 */

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Audited constants — verified in Centroamérica.1A.2D (2026-06-30)
// ---------------------------------------------------------------------------

/** Total RNC jurídicos (9-digit) loaded in the snapshot. */
export const AUDITED_RD_LOADED_RNC = 493_548;

/**
 * Cédulas/personas físicas (11-digit identifiers) discarded during import.
 * These are out-of-scope for the business registry use case.
 */
export const AUDITED_RD_OUT_OF_SCOPE = 287_169;

/** Snapshot coverage kind identifier. */
export const RD_COVERAGE_KIND = 'business_registry_snapshot' as const;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type RdCoverageSource = 'live_database' | 'audited_fallback';
export type RdCoverageSourceReason = 'missing_env' | 'query_failed' | 'unknown';

export interface RdSourceCoverageSummary {
  sourceKey: 'rd_dgii_bulk';
  /** RNC jurídicos loaded in the snapshot (9-digit identifiers). */
  loadedRnc: number;
  /** Cédulas/personas físicas discarded (11-digit — out of scope). */
  outOfScopeIdentifiers: number;
  /** Coverage status: 'complete_snapshot' or 'partial_snapshot'. */
  coverageStatus: 'complete_snapshot' | 'partial_snapshot';
  /** Whether we read from the summary table or fell back to audited constants. */
  coverageSource: RdCoverageSource;
  /** Present only when coverageSource is 'audited_fallback'. */
  coverageSourceReason?: RdCoverageSourceReason;
  /** CIIU availability for this MVP snapshot. Always 'unavailable_for_mvp'. */
  ciiuStatus: 'unavailable_for_mvp';
  /** Whether this snapshot includes cédulas (personas físicas). Always false. */
  includesCedulas: false;
}

// ---------------------------------------------------------------------------
// Summary row shape from source_coverage_summaries
// ---------------------------------------------------------------------------

interface SummaryRow {
  source_key: string;
  loaded_rows: number;
  out_of_scope_entities: number | null;
  coverage_status: string;
  coverage_kind: string | null;
}

// ---------------------------------------------------------------------------
// Build result
// ---------------------------------------------------------------------------

function buildFromSummaryRow(row: SummaryRow): RdSourceCoverageSummary {
  return {
    sourceKey: 'rd_dgii_bulk',
    loadedRnc: row.loaded_rows,
    outOfScopeIdentifiers: row.out_of_scope_entities ?? AUDITED_RD_OUT_OF_SCOPE,
    coverageStatus: row.coverage_status === 'complete_snapshot'
      ? 'complete_snapshot'
      : 'partial_snapshot',
    coverageSource: 'live_database',
    ciiuStatus: 'unavailable_for_mvp',
    includesCedulas: false,
  };
}

function buildFromAuditedFallback(
  reason: RdCoverageSourceReason,
): RdSourceCoverageSummary {
  return {
    sourceKey: 'rd_dgii_bulk',
    loadedRnc: AUDITED_RD_LOADED_RNC,
    outOfScopeIdentifiers: AUDITED_RD_OUT_OF_SCOPE,
    coverageStatus: 'complete_snapshot',
    coverageSource: 'audited_fallback',
    coverageSourceReason: reason,
    ciiuStatus: 'unavailable_for_mvp',
    includesCedulas: false,
  };
}

// ---------------------------------------------------------------------------
// Public entry point — called at Vercel render time
// ---------------------------------------------------------------------------

/**
 * Returns coverage summary for rd_dgii_bulk.
 *
 * Resolution order:
 *   1. source_coverage_summaries table (fast, no COUNT)
 *   2. Direct COUNT from source_company_snapshots (slower, but accurate)
 *   3. Audited fallback constants (always available)
 *
 * Never throws — errors collapse to audited fallback.
 */
export async function getRdSourceCoverageSummary(): Promise<RdSourceCoverageSummary> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return buildFromAuditedFallback('missing_env');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createClient(url, key);

  // --- Pass 1: summary table ---
  try {
    const { data, error } = await admin
      .from('source_coverage_summaries')
      .select('source_key, loaded_rows, out_of_scope_entities, coverage_status, coverage_kind')
      .eq('source_key', 'rd_dgii_bulk')
      .maybeSingle();

    if (!error && data) {
      return buildFromSummaryRow(data as SummaryRow);
    }
  } catch {
    // fall through to live count
  }

  // --- Pass 2: live COUNT from snapshot table (read-only) ---
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const { count, error } = await admin
      .from('source_company_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('source_key', 'rd_dgii_bulk')
      .abortSignal(controller.signal);

    clearTimeout(timer);

    if (!error && typeof count === 'number') {
      return {
        sourceKey: 'rd_dgii_bulk',
        loadedRnc: count,
        outOfScopeIdentifiers: AUDITED_RD_OUT_OF_SCOPE,
        coverageStatus: count >= AUDITED_RD_LOADED_RNC ? 'complete_snapshot' : 'partial_snapshot',
        coverageSource: 'live_database',
        ciiuStatus: 'unavailable_for_mvp',
        includesCedulas: false,
      };
    }
  } catch {
    // fall through to audited fallback
  }

  // --- Pass 3: audited constants ---
  return buildFromAuditedFallback('query_failed');
}
