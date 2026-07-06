/**
 * Read-only coverage summary for the Portal de Contrataciones Abiertas Honduras snapshot.
 *
 * Honduras (hn_contrataciones_abiertas) is a procurement B2G signal,
 * NOT a legal registry, NOT a tax authority, NOT a SAR Honduras replacement,
 * NOT a Registro Mercantil replacement.
 *
 * Post-approval is NOT enabled. Automatic matching is NOT enabled.
 * This service only reads source_coverage_summaries — no ETL, no writes.
 *
 * Guardrails (enforced by design):
 *   noOncaeApiRuntime   : never fetches from oncae.gob.hn at render time
 *   noOcpApiRuntime     : never fetches from OCP Data Registry at render time
 *   noBulkProcessing    : no ETL or bulk apply at runtime
 *   noLlmCalls          : no Tavily, LLM, or external enrichment
 *   noPostApproval      : post_approval_enabled is always false for this source
 *   noAutoMatching      : automatic matching is not enabled
 *   noAccountsWrite     : never writes to accounts or prospect_candidates
 *   noSnapshotWrite     : never writes to source_company_snapshots
 *   noSarClaim          : does not claim to replace SAR Honduras
 *   noRegistroMercantil : does not claim to replace Registro Mercantil Honduras
 *
 * Hito: Centroamérica.8C.4C
 */

import { createClient } from '@supabase/supabase-js';

// ─── Constants ─────────────────────────────────────────────────────────────────

export const HN_SOURCE_KEY = 'hn_contrataciones_abiertas' as const;

export const HN_COVERAGE_KIND = 'procurement_signal' as const;

/** Fallback loaded_rows when DB is unavailable. 0 means "unknown" — never show 72 hardcoded. */
export const HN_AUDITED_LOADED_ROWS = 0;

// ─── Output types ──────────────────────────────────────────────────────────────

export type HnCoverageSource = 'live_database' | 'audited_fallback';
export type HnCoverageSourceReason = 'missing_env' | 'query_failed' | 'row_not_found' | 'payload_invalid' | 'unknown';

export interface HnContratacionesCoverageBreakdown {
  source_year?: number | null;
  invalid_guardrail_rows?: number | null;
  pilot_scope?: boolean | null;
  human_review_required?: boolean | null;
  post_approval_enabled?: boolean | null;
}

export interface HnContratacionesCoverageSummary {
  sourceKey: typeof HN_SOURCE_KEY;
  loadedRows: number;
  coverageStatus: 'partial_snapshot' | 'complete_snapshot';
  coverageKind: typeof HN_COVERAGE_KIND;
  countryCode: string | null;
  refreshedAt: string | null;
  refreshSource: string | null;
  sourceYear: number | null;
  pilotScope: boolean;
  humanReviewRequired: boolean;
  /** Always false — post-approval is not enabled for Honduras. */
  postApprovalEnabled: false;
  coverageSource: HnCoverageSource;
  coverageSourceReason?: HnCoverageSourceReason;
  breakdown?: HnContratacionesCoverageBreakdown;
  /** NOT a fiscal source — does not validate RTN as tax authority. */
  isFiscalSource: false;
  /** Does NOT replace SAR Honduras. */
  replacesSarHonduras: false;
  /** Does NOT replace Registro Mercantil Honduras. */
  replacesRegistroMercantil: false;
}

// ─── DB row shape ──────────────────────────────────────────────────────────────

interface SummaryRow {
  source_key: string;
  loaded_rows: number;
  coverage_status: string;
  coverage_kind: string | null;
  country_code: string | null;
  refreshed_at: string | null;
  refresh_source: string | null;
  coverage_breakdown: Record<string, unknown> | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractBreakdown(raw: Record<string, unknown> | null): HnContratacionesCoverageBreakdown | undefined {
  if (!raw) return undefined;
  return {
    source_year: typeof raw.source_year === 'number' ? raw.source_year : null,
    invalid_guardrail_rows: typeof raw.invalid_guardrail_rows === 'number' ? raw.invalid_guardrail_rows : null,
    pilot_scope: typeof raw.pilot_scope === 'boolean' ? raw.pilot_scope : null,
    human_review_required: typeof raw.human_review_required === 'boolean' ? raw.human_review_required : null,
    post_approval_enabled: typeof raw.post_approval_enabled === 'boolean' ? raw.post_approval_enabled : null,
  };
}

function buildSummary(
  loadedRows: number,
  coverageSource: HnCoverageSource,
  coverageSourceReason?: HnCoverageSourceReason,
  opts?: {
    countryCode?: string | null;
    refreshedAt?: string | null;
    refreshSource?: string | null;
    sourceYear?: number | null;
    pilotScope?: boolean;
    humanReviewRequired?: boolean;
    breakdown?: HnContratacionesCoverageBreakdown;
    coverageStatus?: 'partial_snapshot' | 'complete_snapshot';
  },
): HnContratacionesCoverageSummary {
  return {
    sourceKey: HN_SOURCE_KEY,
    loadedRows,
    coverageStatus: opts?.coverageStatus ?? 'partial_snapshot',
    coverageKind: HN_COVERAGE_KIND,
    countryCode: opts?.countryCode ?? 'HN',
    refreshedAt: opts?.refreshedAt ?? null,
    refreshSource: opts?.refreshSource ?? null,
    sourceYear: opts?.sourceYear ?? null,
    pilotScope: opts?.pilotScope ?? true,
    humanReviewRequired: opts?.humanReviewRequired ?? true,
    postApprovalEnabled: false,
    coverageSource,
    ...(coverageSourceReason ? { coverageSourceReason } : {}),
    ...(opts?.breakdown ? { breakdown: opts.breakdown } : {}),
    isFiscalSource: false,
    replacesSarHonduras: false,
    replacesRegistroMercantil: false,
  };
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Reads coverage summary for hn_contrataciones_abiertas from source_coverage_summaries.
 * Falls back to safe defaults if the DB is unavailable.
 *
 * Never fetches from ONCAE, OCP Data Registry, Tavily, or any LLM.
 * Never writes to accounts, prospect_candidates, or source_company_snapshots.
 * postApprovalEnabled is always false regardless of DB state.
 */
export async function getHnContratacionesCoverageSummary(): Promise<HnContratacionesCoverageSummary> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return buildSummary(HN_AUDITED_LOADED_ROWS, 'audited_fallback', 'missing_env');
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
        .select(
          'source_key, loaded_rows, coverage_status, coverage_kind, country_code, refreshed_at, refresh_source, coverage_breakdown',
        )
        .eq('source_key', HN_SOURCE_KEY)
        .abortSignal(controller.signal)
        .maybeSingle();

      clearTimeout(timeout);

      if (error) {
        console.error('[hn-coverage] query_error source=hn_contrataciones_abiertas code=%s', error.code ?? 'unknown');
        if (attempt < MAX_RETRIES) continue;
        return buildSummary(HN_AUDITED_LOADED_ROWS, 'audited_fallback', 'query_failed');
      }

      if (!data) {
        console.warn('[hn-coverage] row_not_found source=hn_contrataciones_abiertas');
        return buildSummary(HN_AUDITED_LOADED_ROWS, 'audited_fallback', 'row_not_found');
      }

      const row = data as SummaryRow;
      const dbStatus = row.coverage_status === 'complete_snapshot' ? 'complete_snapshot' : 'partial_snapshot';
      const breakdown = extractBreakdown(row.coverage_breakdown);

      if (!breakdown && row.coverage_breakdown !== null) {
        console.warn('[hn-coverage] payload_invalid source=hn_contrataciones_abiertas');
        return buildSummary(HN_AUDITED_LOADED_ROWS, 'audited_fallback', 'payload_invalid');
      }

      return buildSummary(
        row.loaded_rows ?? HN_AUDITED_LOADED_ROWS,
        'live_database',
        undefined,
        {
          countryCode: row.country_code ?? 'HN',
          refreshedAt: row.refreshed_at ?? null,
          refreshSource: row.refresh_source ?? null,
          sourceYear: breakdown?.source_year ?? null,
          pilotScope: breakdown?.pilot_scope ?? true,
          humanReviewRequired: breakdown?.human_review_required ?? true,
          breakdown,
          coverageStatus: dbStatus,
        },
      );
    } catch {
      clearTimeout(timeout);
      if (attempt < MAX_RETRIES) continue;
      return buildSummary(HN_AUDITED_LOADED_ROWS, 'audited_fallback', 'query_failed');
    }
  }

  return buildSummary(HN_AUDITED_LOADED_ROWS, 'audited_fallback', 'query_failed');
}
