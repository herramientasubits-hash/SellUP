/**
 * DGCP RD Post-Approval Lookup Service — RepúblicaDominicana.2D
 *
 * Looks up a Dominican company in source_company_snapshots using its normalized RNC.
 * Reads ONLY from the pre-loaded do_dgcp snapshot. Never calls DGCP API.
 *
 * GUARDRAILS — this service must NEVER:
 * - Call datosabiertos.dgcp.gob.do or any DGCP endpoint
 * - Call Tavily, Apollo, Lusha, DGII external, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Touch source_coverage_summaries
 * - Be called for countries other than DO (enforced by caller guard)
 *
 * Semantic obligations (enforced here):
 *   source_type: 'procurement_signal'     — DGCP is commercial signal, NOT legal validation
 *   legal_validation_status: 'not_applicable'
 *   tax_validation_status: 'not_applicable'
 *   official_ciiu_available: false
 *   ciiu_status: 'unavailable_for_mvp'
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const SNAPSHOT_TABLE = 'source_company_snapshots';
const SOURCE_KEY = 'do_dgcp';
const COUNTRY_CODE = 'DO';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RdDgcpLookupInput {
  rnc: string;
  year?: number;
}

export interface RdDgcpLookupResult {
  matched: boolean;
  source_year: number | null;
  legal_name: string | null;
  normalized_tax_id: string | null;
  priority_score: number | null;
  total_contracts_year: number | null;
  total_awarded_amount_dop: number | null;
  last_award_date: string | null;
  currency: string | null;
  raw_data: Record<string, unknown> | null;
  reason: string | null;
}

// ── RNC normalization ──────────────────────────────────────────────────────────

/**
 * Normalizes a Dominican RNC to digits-only, stripped of dashes and spaces.
 * DGCP snapshots are keyed by normalized RNC in normalized_tax_id.
 */
export function normalizeDominicanRncForDgcp(rnc: string): string {
  return rnc.replace(/[\s-]/g, '').toUpperCase();
}

// ── Admin client ───────────────────────────────────────────────────────────────

function getAdminSupabase(): SupabaseClient | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(url, key);
}

// ── Signal extraction ──────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function extractProcurementSummary(rawData: Record<string, unknown>): {
  total_contracts_year: number | null;
  total_awarded_amount_dop: number | null;
  last_award_date: string | null;
  currency: string | null;
} {
  return {
    total_contracts_year: toNum(rawData.total_contracts_year),
    total_awarded_amount_dop: toNum(rawData.total_awarded_amount_dop),
    last_award_date: toStr(rawData.last_award_date),
    currency: toStr(rawData.currency) ?? 'DOP',
  };
}

// ── Main lookup ────────────────────────────────────────────────────────────────

/**
 * Looks up a Dominican supplier in source_company_snapshots (do_dgcp) by normalized RNC.
 * If year is omitted, selects the most recent available year.
 * Never calls DGCP API — reads local snapshot only.
 */
export async function lookupDominicanDgcpByRnc(
  input: RdDgcpLookupInput,
  supabaseOverride?: SupabaseClient,
): Promise<RdDgcpLookupResult> {
  const normalizedRnc = normalizeDominicanRncForDgcp(input.rnc);

  if (!normalizedRnc) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: null,
      priority_score: null,
      total_contracts_year: null,
      total_awarded_amount_dop: null,
      last_award_date: null,
      currency: null,
      raw_data: null,
      reason: 'invalid_rnc_format',
    };
  }

  const sb = supabaseOverride ?? getAdminSupabase();
  if (!sb) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: normalizedRnc,
      priority_score: null,
      total_contracts_year: null,
      total_awarded_amount_dop: null,
      last_award_date: null,
      currency: null,
      raw_data: null,
      reason: 'snapshot_unavailable',
    };
  }

  try {
    let query = sb
      .from(SNAPSHOT_TABLE)
      .select('source_year, legal_name, normalized_tax_id, priority_score, signals, raw_data')
      .eq('source_key', SOURCE_KEY)
      .eq('country_code', COUNTRY_CODE)
      .eq('normalized_tax_id', normalizedRnc);

    if (input.year != null) {
      query = query.eq('source_year', input.year);
    } else {
      query = query.order('source_year', { ascending: false });
    }

    const { data, error } = await query.limit(1).maybeSingle();

    if (error) {
      return {
        matched: false,
        source_year: null,
        legal_name: null,
        normalized_tax_id: normalizedRnc,
        priority_score: null,
        total_contracts_year: null,
        total_awarded_amount_dop: null,
        last_award_date: null,
        currency: null,
        raw_data: null,
        reason: 'snapshot_query_error',
      };
    }

    if (!data) {
      return {
        matched: false,
        source_year: null,
        legal_name: null,
        normalized_tax_id: normalizedRnc,
        priority_score: null,
        total_contracts_year: null,
        total_awarded_amount_dop: null,
        last_award_date: null,
        currency: null,
        raw_data: null,
        reason: 'no_snapshot_match_by_rnc',
      };
    }

    const row = data as Record<string, unknown>;
    const rawData = (row.raw_data as Record<string, unknown>) ?? {};
    const signals = (row.signals as Record<string, unknown>) ?? {};
    const summary = extractProcurementSummary(
      Object.keys(signals).length > 0 ? signals : rawData,
    );

    return {
      matched: true,
      source_year: toNum(row.source_year),
      legal_name: toStr(row.legal_name),
      normalized_tax_id: toStr(row.normalized_tax_id) ?? normalizedRnc,
      priority_score: toNum(row.priority_score),
      total_contracts_year: summary.total_contracts_year,
      total_awarded_amount_dop: summary.total_awarded_amount_dop,
      last_award_date: summary.last_award_date,
      currency: summary.currency,
      raw_data: rawData,
      reason: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: normalizedRnc,
      priority_score: null,
      total_contracts_year: null,
      total_awarded_amount_dop: null,
      last_award_date: null,
      currency: null,
      raw_data: null,
      reason: `lookup_error: ${msg.slice(0, 200)}`,
    };
  }
}
