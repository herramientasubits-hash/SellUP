/**
 * Read-only coverage summary for the Costa Rica SICOP procurement snapshot.
 *
 * SICOP (Sistema Costarricense de Contratación Pública) is a commercial B2G signal,
 * NOT a legal registry, NOT a tax authority source, NOT a cédula jurídica validator,
 * and NOT a CIIU source.
 *
 * Guardrails (enforced by design):
 *   noSicopApiRuntime      : never fetches from sicop.go.cr or datos.go.cr at render time
 *   noHaciendaRuntime      : never fetches from api.hacienda.go.cr
 *   noBulkProcessing       : no ETL or bulk apply at runtime
 *   noLlmCalls             : no Tavily, LLM, or external enrichment
 *   noCiiuInvented         : CIIU is not available — not invented
 *   noPilotRepresentedFull : coverage_status never uses complete_snapshot
 *   noHaciendaWrite        : never writes to cr_hacienda_contribuyentes
 *   noCedulaValidation     : does not validate cédula jurídica
 */

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Audited constants — Centroamérica.4B (2026-07-02 pilot load)
// ---------------------------------------------------------------------------

/** Proveedores SICOP loaded in the 4B pilot load. */
export const AUDITED_SICOP_LOADED_ROWS = 160;

/** Source key constant. */
export const SICOP_COVERAGE_SOURCE_KEY = 'cr_sicop' as const;

/** Coverage kind for SICOP (procurement signal, not business registry). */
export const SICOP_COVERAGE_KIND = 'procurement_signal_snapshot' as const;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type SicopCoverageSource = 'live_database' | 'audited_fallback';
export type SicopCoverageSourceReason = 'missing_env' | 'query_failed' | 'unknown';

export interface SicopSourceCoverageSummary {
  sourceKey: 'cr_sicop';
  /** Proveedores SICOP loaded in source_company_snapshots. */
  loadedRows: number;
  /**
   * Coverage status. Never 'complete_snapshot' — SICOP is a pilot signal only.
   * 'pilot_sample' = 1.000 rows sampled from 565.864-row dataset.
   */
  coverageStatus: 'pilot_sample';
  /** Coverage kind identifier. */
  coverageKind: typeof SICOP_COVERAGE_KIND;
  /** Whether we read from the summary table or fell back to audited constants. */
  coverageSource: SicopCoverageSource;
  /** Present only when coverageSource is 'audited_fallback'. */
  coverageSourceReason?: SicopCoverageSourceReason;
  /** SICOP is procurement signal only — NOT a legal registry. */
  isProcurementSignalOnly: true;
  /** SICOP does NOT provide CIIU — not invented. */
  ciiuStatus: 'unavailable_not_invented';
  /** SICOP is NOT a tax authority or fiscal source. */
  isFiscalSource: false;
  /** SICOP does NOT validate cédula jurídica. */
  validatesCedulaJuridica: false;
  /** SICOP does NOT replace Hacienda CR. */
  replacesHaciendaCr: false;
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

function buildFromSummaryRow(row: SummaryRow): SicopSourceCoverageSummary {
  return {
    sourceKey: 'cr_sicop',
    loadedRows: row.loaded_rows,
    coverageStatus: 'pilot_sample',
    coverageKind: SICOP_COVERAGE_KIND,
    coverageSource: 'live_database',
    isProcurementSignalOnly: true,
    ciiuStatus: 'unavailable_not_invented',
    isFiscalSource: false,
    validatesCedulaJuridica: false,
    replacesHaciendaCr: false,
  };
}

function buildFromAuditedFallback(
  reason: SicopCoverageSourceReason,
): SicopSourceCoverageSummary {
  return {
    sourceKey: 'cr_sicop',
    loadedRows: AUDITED_SICOP_LOADED_ROWS,
    coverageStatus: 'pilot_sample',
    coverageKind: SICOP_COVERAGE_KIND,
    coverageSource: 'audited_fallback',
    coverageSourceReason: reason,
    isProcurementSignalOnly: true,
    ciiuStatus: 'unavailable_not_invented',
    isFiscalSource: false,
    validatesCedulaJuridica: false,
    replacesHaciendaCr: false,
  };
}

// ---------------------------------------------------------------------------
// Public entry point — called at render time
// ---------------------------------------------------------------------------

/**
 * Returns coverage summary for cr_sicop.
 *
 * Resolution order:
 *   1. source_coverage_summaries table (fast, no COUNT)
 *   2. Direct COUNT from source_company_snapshots (slower, but accurate)
 *   3. Audited fallback constants (always available)
 *
 * Never throws — errors collapse to audited fallback.
 * Never calls SICOP API, Hacienda CR, Tavily, LLM, or any external service.
 */
export async function getSicopSourceCoverageSummary(): Promise<SicopSourceCoverageSummary> {
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
      .eq('source_key', SICOP_COVERAGE_SOURCE_KEY)
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
      .eq('source_key', SICOP_COVERAGE_SOURCE_KEY)
      .abortSignal(controller.signal);

    clearTimeout(timer);

    if (!error && typeof count === 'number') {
      return {
        sourceKey: 'cr_sicop',
        loadedRows: count,
        coverageStatus: 'pilot_sample',
        coverageKind: SICOP_COVERAGE_KIND,
        coverageSource: 'live_database',
        isProcurementSignalOnly: true,
        ciiuStatus: 'unavailable_not_invented',
        isFiscalSource: false,
        validatesCedulaJuridica: false,
        replacesHaciendaCr: false,
      };
    }
  } catch {
    // fall through to audited fallback
  }

  // --- Pass 3: audited constants ---
  return buildFromAuditedFallback('query_failed');
}
