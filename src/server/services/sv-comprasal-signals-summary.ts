/**
 * Read-only signals summary for COMPRASAL El Salvador (sv_comprasal).
 *
 * sv_comprasal is a weak commercial B2G signal — NOT a legal registry,
 * NOT a tax authority, does NOT validate NIT/NRC, and does NOT replace
 * Ministerio de Hacienda El Salvador or CNR / Registro de Comercio.
 *
 * Reads aggregates from source_company_signals (NEVER raw_data).
 * Never writes. Never calls COMPRASAL API at render time.
 * Never creates accounts or prospect_candidates.
 *
 * Guardrails:
 *   noComprasalApiRuntime   : never fetches from comprasal.gob.sv at render time
 *   noRawDataInResponse     : never returns raw_data fields to the UI
 *   noTaxIdFields           : never reads or exposes NIT / NRC
 *   noPostApprovalClaim     : does not claim post-approval is active
 *   noAutoMatchingClaim     : does not claim automatic matching exists
 *   noAccountsWrite         : never writes to accounts or prospect_candidates
 *   weakSignalOnly          : signal_strength = weak_name_only always
 *   humanReviewRequired     : human_review_required = true always
 *
 * Hito: Centroamérica.7E.3
 */

import { createClient } from '@supabase/supabase-js';

// ─── Constants ─────────────────────────────────────────────────────────────────

export const SV_SOURCE_KEY = 'sv_comprasal' as const;
export const SV_COUNTRY_CODE = 'SV' as const;

/** Signal strength is always weak_name_only for sv_comprasal. */
export const SV_SIGNAL_STRENGTH = 'weak_name_only' as const;
export const SV_MATCHING_MODE = 'name_only_review_required' as const;

/** Fallback when DB is unavailable. */
export const SV_AUDITED_SIGNAL_COUNT = 0;

// ─── Types ──────────────────────────────────────────────────────────────────

export type SvSignalsSummarySource = 'live_database' | 'audited_fallback';
export type SvSignalsSummaryReason = 'missing_env' | 'query_failed' | 'unknown';

export interface SvComprasalSignalsSummary {
  sourceKey: typeof SV_SOURCE_KEY;
  countryCode: typeof SV_COUNTRY_CODE;
  /** Total distinct signal rows in source_company_signals for sv_comprasal. */
  totalSignals: number;
  /** Distinct source_year values found. */
  sourceYears: number[];
  /** ISO timestamp of the latest imported_at among signals. */
  latestImportedAt: string | null;
  /** Always 'weak_name_only' for sv_comprasal. */
  signalStrength: typeof SV_SIGNAL_STRENGTH;
  /** Always 'name_only_review_required' for sv_comprasal. */
  matchingMode: typeof SV_MATCHING_MODE;
  /** Always true for sv_comprasal. */
  humanReviewRequired: true;
  /** NOT a fiscal or legal source. */
  isFiscalSource: false;
  /** Does NOT replace Ministerio de Hacienda El Salvador. */
  replacesMinisterioHacienda: false;
  /** Does NOT replace CNR / Registro de Comercio. */
  replacesCnr: false;
  /** No post-approval flow connected. */
  postApprovalConnected: false;
  /** No automatic matching by name. */
  automaticMatchingEnabled: false;
  dataSource: SvSignalsSummarySource;
  dataSourceReason?: SvSignalsSummaryReason;
}

// ─── DB row shape ──────────────────────────────────────────────────────────────

interface AggRow {
  total_signals: number;
  source_years: number[] | null;
  latest_imported_at: string | null;
}

// ─── Build helper ──────────────────────────────────────────────────────────────

function buildSummary(
  totalSignals: number,
  sourceYears: number[],
  latestImportedAt: string | null,
  dataSource: SvSignalsSummarySource,
  dataSourceReason?: SvSignalsSummaryReason,
): SvComprasalSignalsSummary {
  return {
    sourceKey: SV_SOURCE_KEY,
    countryCode: SV_COUNTRY_CODE,
    totalSignals,
    sourceYears,
    latestImportedAt,
    signalStrength: SV_SIGNAL_STRENGTH,
    matchingMode: SV_MATCHING_MODE,
    humanReviewRequired: true,
    isFiscalSource: false,
    replacesMinisterioHacienda: false,
    replacesCnr: false,
    postApprovalConnected: false,
    automaticMatchingEnabled: false,
    dataSource,
    ...(dataSourceReason ? { dataSourceReason } : {}),
  };
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns an aggregate summary of sv_comprasal signals from source_company_signals.
 * Never reads raw_data. Never returns NIT/NRC. Falls back to audited constants on error.
 */
export async function getSvComprasalSignalsSummary(): Promise<SvComprasalSignalsSummary> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return buildSummary(SV_AUDITED_SIGNAL_COUNT, [], null, 'audited_fallback', 'missing_env');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = createClient(url, key);

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      // Aggregate only — never reads raw_data or individual rows
      const { data, error } = await client
        .from('source_company_signals')
        .select('source_year, imported_at')
        .eq('source_key', SV_SOURCE_KEY)
        .eq('country_code', SV_COUNTRY_CODE)
        .abortSignal(controller.signal);

      clearTimeout(timeout);

      if (error) {
        if (attempt < MAX_RETRIES) continue;
        return buildSummary(SV_AUDITED_SIGNAL_COUNT, [], null, 'audited_fallback', 'query_failed');
      }

      if (!data || !Array.isArray(data) || data.length === 0) {
        return buildSummary(0, [], null, 'live_database');
      }

      const rows = data as { source_year: number; imported_at: string | null }[];
      const totalSignals = rows.length;
      const yearsSet = new Set<number>(rows.map((r) => r.source_year).filter(Boolean));
      const sourceYears = Array.from(yearsSet).sort();

      const allDates = rows
        .map((r) => r.imported_at)
        .filter((d): d is string => typeof d === 'string' && d.length > 0);
      const latestImportedAt = allDates.length > 0
        ? allDates.reduce((a, b) => (a > b ? a : b))
        : null;

      return buildSummary(totalSignals, sourceYears, latestImportedAt, 'live_database');
    } catch {
      clearTimeout(timeout);
      if (attempt < MAX_RETRIES) continue;
      return buildSummary(SV_AUDITED_SIGNAL_COUNT, [], null, 'audited_fallback', 'query_failed');
    }
  }

  return buildSummary(SV_AUDITED_SIGNAL_COUNT, [], null, 'audited_fallback', 'query_failed');
}
