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

export interface PaPanamaCompraCoverageBreakdown {
  coverage_scope?: string;
  convenios_read?: number | null;
  providers_found?: number | null;
  unique_providers?: number | null;
  providers_with_ruc?: number | null;
  snapshots_built?: number | null;
  limitations?: string[];
}

export interface PaPanamaCompraConvenioCoverageSummary {
  sourceKey: typeof PA_SOURCE_KEY;
  loadedRows: number;
  /**
   * Coverage status. Never 'complete_snapshot'.
   * 'pilot_sample'    = small controlled pilot (5C).
   * 'partial_snapshot' = operational broad load (5E).
   */
  coverageStatus: 'pilot_sample' | 'partial_snapshot';
  coverageKind: typeof PA_COVERAGE_KIND;
  coverageSource: PaCoverageSource;
  coverageSourceReason?: PaCoverageSourceReason;
  refreshSource?: string;
  breakdown?: PaPanamaCompraCoverageBreakdown;
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
  refresh_source: string | null;
  coverage_breakdown: Record<string, unknown> | null;
}

// ─── Build helper ──────────────────────────────────────────────────────────────

function buildSummary(
  loadedRows: number,
  coverageSource: PaCoverageSource,
  coverageSourceReason?: PaCoverageSourceReason,
  refreshSource?: string,
  breakdown?: PaPanamaCompraCoverageBreakdown,
  coverageStatus: 'pilot_sample' | 'partial_snapshot' = 'pilot_sample',
): PaPanamaCompraConvenioCoverageSummary {
  return {
    sourceKey: PA_SOURCE_KEY,
    loadedRows,
    coverageStatus,
    coverageKind: PA_COVERAGE_KIND,
    coverageSource,
    ...(coverageSourceReason ? { coverageSourceReason } : {}),
    ...(refreshSource ? { refreshSource } : {}),
    ...(breakdown ? { breakdown } : {}),
    isProcurementSignalOnly: true,
    isFiscalSource: false,
    replacesDgiPanama: false,
    replacesRegistroPublico: false,
    coverageScope: 'convenio_marco',
  };
}

function extractBreakdown(raw: Record<string, unknown> | null): PaPanamaCompraCoverageBreakdown | undefined {
  if (!raw) return undefined;
  return {
    coverage_scope: typeof raw.coverage_scope === 'string' ? raw.coverage_scope : undefined,
    convenios_read: typeof raw.convenios_read === 'number' ? raw.convenios_read : null,
    providers_found: typeof raw.providers_found === 'number' ? raw.providers_found : null,
    unique_providers: typeof raw.unique_providers === 'number' ? raw.unique_providers : null,
    providers_with_ruc: typeof raw.providers_with_ruc === 'number' ? raw.providers_with_ruc : null,
    snapshots_built: typeof raw.snapshots_built === 'number' ? raw.snapshots_built : null,
    limitations: Array.isArray(raw.limitations) ? (raw.limitations as string[]) : undefined,
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
        .select('source_key, loaded_rows, coverage_status, coverage_kind, refresh_source, coverage_breakdown')
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
      const dbStatus = row.coverage_status === 'partial_snapshot' ? 'partial_snapshot' : 'pilot_sample';
      return buildSummary(
        row.loaded_rows ?? PA_AUDITED_LOADED_ROWS,
        'live_database',
        undefined,
        row.refresh_source ?? undefined,
        extractBreakdown(row.coverage_breakdown),
        dbStatus,
      );
    } catch {
      clearTimeout(timeout);
      if (attempt < MAX_RETRIES) continue;
      return buildSummary(PA_AUDITED_LOADED_ROWS, 'audited_fallback', 'query_failed');
    }
  }

  return buildSummary(PA_AUDITED_LOADED_ROWS, 'audited_fallback', 'query_failed');
}
