/**
 * Read-only coverage summary for the PanamaCompra Convenio Marco procurement snapshot.
 *
 * PanamaCompra Convenio Marco is a commercial B2G signal,
 * NOT a legal registry, NOT a tax authority, NOT a RUC validator,
 * NOT a DGI Panamá replacement, NOT a Registro Público replacement,
 * and does NOT cover all public procurement in Panama.
 *
 * Guardrails (enforced by design):
 *   noPanamaCompraApiRuntime : never fetches from panamacompra.gob.pa at render time
 *   noDgiRuntime             : never fetches from DGI Panamá
 *   noRegistroPublicoRuntime : never fetches from Registro Público Panamá
 *   noBulkProcessing         : no ETL or bulk apply at runtime
 *   noLlmCalls               : no Tavily, LLM, or external enrichment
 *   noPilotRepresentedFull   : coverage_status never uses complete_snapshot
 *   noRucValidation          : does not validate RUC Panamá
 *   noAccountsWrite          : never writes to accounts or prospect_candidates
 *
 * Hito: Centroamérica.5C
 */

import { createClient } from '@supabase/supabase-js';

// ─── Constants ─────────────────────────────────────────────────────────────────

export const PA_SOURCE_KEY = 'pa_panamacompra_convenio' as const;

/** Coverage kind for PanamaCompra (procurement signal, not business registry). */
export const PA_COVERAGE_KIND = 'procurement_signal_snapshot' as const;

/** Fallback row count when DB is unavailable (from 5C pilot load). */
export const PA_AUDITED_LOADED_ROWS = 0;

// ─── Output types ──────────────────────────────────────────────────────────────

export type PaCoverageSource = 'live_database' | 'audited_fallback';
export type PaCoverageSourceReason = 'missing_env' | 'query_failed' | 'unknown';

export interface PaPanamaCompraConvenioCoverageSummary {
  sourceKey: typeof PA_SOURCE_KEY;
  loadedRows: number;
  /**
   * Coverage status. Never 'complete_snapshot'.
   * 'pilot_sample' = small controlled pilot of Convenio Marco providers.
   */
  coverageStatus: 'pilot_sample';
  coverageKind: typeof PA_COVERAGE_KIND;
  coverageSource: PaCoverageSource;
  coverageSourceReason?: PaCoverageSourceReason;
  /** PanamaCompra Convenio Marco is procurement signal only. */
  isProcurementSignalOnly: true;
  /** NOT a fiscal source — does not validate RUC. */
  isFiscalSource: false;
  /** Does NOT replace DGI Panamá. */
  replacesDgiPanama: false;
  /** Does NOT replace Registro Público Panamá. */
  replacesRegistroPublico: false;
  /** Coverage scope: only Convenio Marco providers. */
  coverageScope: 'convenio_marco';
}

// ─── DB row shape ──────────────────────────────────────────────────────────────

interface SummaryRow {
  source_key: string;
  loaded_rows: number;
  coverage_status: string;
  coverage_kind: string | null;
}

// ─── Build helper ──────────────────────────────────────────────────────────────

function buildSummary(
  loadedRows: number,
  coverageSource: PaCoverageSource,
  coverageSourceReason?: PaCoverageSourceReason,
): PaPanamaCompraConvenioCoverageSummary {
  return {
    sourceKey: PA_SOURCE_KEY,
    loadedRows,
    coverageStatus: 'pilot_sample',
    coverageKind: PA_COVERAGE_KIND,
    coverageSource,
    ...(coverageSourceReason ? { coverageSourceReason } : {}),
    isProcurementSignalOnly: true,
    isFiscalSource: false,
    replacesDgiPanama: false,
    replacesRegistroPublico: false,
    coverageScope: 'convenio_marco',
  };
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Reads coverage summary from source_coverage_summaries with retry on transient failures.
 * Falls back to audited constants if the DB is unavailable.
 *
 * Never fetches from PanamaCompra API, DGI, Registro Público, Tavily, or LLM.
 * Never writes to accounts or prospect_candidates.
 */
export async function getPaPanamaCompraConvenioCoverageSummary(): Promise<PaPanamaCompraConvenioCoverageSummary> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return buildSummary(PA_AUDITED_LOADED_ROWS, 'audited_fallback', 'missing_env');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = createClient(url, key);

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const { data, error } = await client
        .from('source_coverage_summaries')
        .select('source_key, loaded_rows, coverage_status, coverage_kind')
        .eq('source_key', PA_SOURCE_KEY)
        .abortSignal(controller.signal)
        .maybeSingle();

      clearTimeout(timeout);

      if (error) {
        if (attempt < MAX_RETRIES) continue;
        return buildSummary(PA_AUDITED_LOADED_ROWS, 'audited_fallback', 'query_failed');
      }

      if (!data) {
        return buildSummary(PA_AUDITED_LOADED_ROWS, 'audited_fallback', 'unknown');
      }

      const row = data as SummaryRow;
      return buildSummary(row.loaded_rows ?? PA_AUDITED_LOADED_ROWS, 'live_database');
    } catch {
      clearTimeout(timeout);
      if (attempt < MAX_RETRIES) continue;
      return buildSummary(PA_AUDITED_LOADED_ROWS, 'audited_fallback', 'query_failed');
    }
  }

  return buildSummary(PA_AUDITED_LOADED_ROWS, 'audited_fallback', 'query_failed');
}
