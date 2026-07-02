/**
 * Read-only coverage summary for the República Dominicana DGCP procurement snapshot.
 *
 * DGCP (Dirección General de Contrataciones Públicas) is a commercial B2G signal,
 * NOT a legal registry, NOT a tax authority source, and NOT a CIIU source.
 *
 * Guardrails (enforced by design):
 *   noDgcpApiRuntime       : never fetches from dgcp.gob.do at render time
 *   noDgiiRuntime          : never fetches from dgii.gov.do
 *   noApiBulkProcessing    : no bulk API processing at runtime
 *   noLlmCalls             : no Tavily, LLM, or external enrichment
 *   noCiiuInvented         : CIIU is not available — not invented
 *   noPilotRepresentedFull : coverage_status never uses complete_snapshot
 *   noDgiiWrite            : never writes to rd_dgii_bulk
 */

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Audited constants — RepúblicaDominicana.2E (2026-07-01 controlled load)
// ---------------------------------------------------------------------------

/** Proveedores B2G loaded after the 2E controlled load. */
export const AUDITED_DGCP_LOADED_ROWS = 47;

/**
 * Known API total from DGCP /contratos pagination (as of 2026-07-01).
 * 654,167 contratos reported. 126,412 known providers in DGCP universe.
 * These are NOT loaded — this is a pilot sample only.
 */
export const KNOWN_DGCP_CONTRACTS_TOTAL = 654_167;
export const KNOWN_DGCP_PROVIDERS_TOTAL = 126_412;

/** Source key constant. */
export const DGCP_COVERAGE_SOURCE_KEY = 'do_dgcp' as const;

/** Coverage kind for DGCP (procurement signal, not business registry). */
export const DGCP_COVERAGE_KIND = 'procurement_signal_snapshot' as const;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type DgcpCoverageSource = 'live_database' | 'audited_fallback';
export type DgcpCoverageSourceReason = 'missing_env' | 'query_failed' | 'unknown';

export interface DgcpSourceCoverageSummary {
  sourceKey: 'do_dgcp';
  /** Proveedores B2G loaded in source_company_snapshots. */
  loadedRows: number;
  /**
   * Coverage status. Never 'complete_snapshot' — DGCP is a pilot/partial signal.
   * 'pilot_sample' = controlled load, far from complete universe.
   */
  coverageStatus: 'pilot_sample' | 'partial_snapshot';
  /** Coverage kind identifier. */
  coverageKind: typeof DGCP_COVERAGE_KIND;
  /** Whether we read from the summary table or fell back to audited constants. */
  coverageSource: DgcpCoverageSource;
  /** Present only when coverageSource is 'audited_fallback'. */
  coverageSourceReason?: DgcpCoverageSourceReason;
  /** DGCP is procurement signal only — NOT a legal registry. */
  isProcurementSignalOnly: true;
  /** DGCP does NOT provide CIIU — not invented. */
  ciiuStatus: 'unavailable_not_invented';
  /** DGCP is NOT a tax authority or fiscal source. */
  isFiscalSource: false;
}

// ---------------------------------------------------------------------------
// Summary row shape from source_coverage_summaries
// ---------------------------------------------------------------------------

interface SummaryRow {
  source_key: string;
  loaded_rows: number;
  coverage_status: string;
  coverage_kind: string | null;
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

function buildFromSummaryRow(row: SummaryRow): DgcpSourceCoverageSummary {
  return {
    sourceKey: 'do_dgcp',
    loadedRows: row.loaded_rows,
    coverageStatus: 'pilot_sample',
    coverageKind: DGCP_COVERAGE_KIND,
    coverageSource: 'live_database',
    isProcurementSignalOnly: true,
    ciiuStatus: 'unavailable_not_invented',
    isFiscalSource: false,
  };
}

function buildFromAuditedFallback(
  reason: DgcpCoverageSourceReason,
): DgcpSourceCoverageSummary {
  return {
    sourceKey: 'do_dgcp',
    loadedRows: AUDITED_DGCP_LOADED_ROWS,
    coverageStatus: 'pilot_sample',
    coverageKind: DGCP_COVERAGE_KIND,
    coverageSource: 'audited_fallback',
    coverageSourceReason: reason,
    isProcurementSignalOnly: true,
    ciiuStatus: 'unavailable_not_invented',
    isFiscalSource: false,
  };
}

// ---------------------------------------------------------------------------
// Public entry point — called at render time
// ---------------------------------------------------------------------------

/**
 * Returns coverage summary for do_dgcp.
 *
 * Resolution order:
 *   1. source_coverage_summaries table (fast, no COUNT)
 *   2. Direct COUNT from source_company_snapshots (slower, but accurate)
 *   3. Audited fallback constants (always available)
 *
 * Never throws — errors collapse to audited fallback.
 * Never calls DGCP API, DGII, Tavily, LLM, SUNAT, or any external service.
 */
export async function getDgcpSourceCoverageSummary(): Promise<DgcpSourceCoverageSummary> {
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
      .select('source_key, loaded_rows, coverage_status, coverage_kind')
      .eq('source_key', DGCP_COVERAGE_SOURCE_KEY)
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
      .eq('source_key', DGCP_COVERAGE_SOURCE_KEY)
      .abortSignal(controller.signal);

    clearTimeout(timer);

    if (!error && typeof count === 'number') {
      return {
        sourceKey: 'do_dgcp',
        loadedRows: count,
        coverageStatus: 'pilot_sample',
        coverageKind: DGCP_COVERAGE_KIND,
        coverageSource: 'live_database',
        isProcurementSignalOnly: true,
        ciiuStatus: 'unavailable_not_invented',
        isFiscalSource: false,
      };
    }
  } catch {
    // fall through to audited fallback
  }

  // --- Pass 3: audited constants ---
  return buildFromAuditedFallback('query_failed');
}
