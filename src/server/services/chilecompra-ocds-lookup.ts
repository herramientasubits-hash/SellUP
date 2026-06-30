/**
 * ChileCompra OCDS Post-Approval Lookup Service — v1.16CL-E
 *
 * Looks up a Chilean company in source_company_snapshots using its RUT.
 * Reads ONLY from the pre-loaded snapshot. Never calls ChileCompra API.
 *
 * GUARDRAILS — this service must NEVER:
 * - Call any ChileCompra / Mercado Público API endpoint
 * - Call Tavily, Apollo, Lusha, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Be called for countries other than CL (enforced by caller guard)
 * - Read from filesystem ChileCompra paths
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeRut } from '../source-catalog/connectors/chilecompra-ocds/normalizers';

const SNAPSHOT_TABLE = 'source_company_snapshots';
const SOURCE_KEY = 'cl_chilecompra_ocds';
const COUNTRY_CODE = 'CL';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChileCompraOcdsLookupInput {
  rut: string;
  year?: number;
}

export interface ChileCompraOcdsSignals {
  total_awarded_amount_clp: number | null;
  awards_count: number | null;
  last_award_date: string | null;
  buyer_names: string[];
  buyer_ruts: string[];
  unspsc_codes: string[];
  unspsc_descriptions: string[];
  ocids: string[];
  source_urls: string[];
  procurement_methods: string[];
  awards_with_missing_amount: number | null;
  awards_in_non_clp_currency: number | null;
  currencies_seen: string[];
}

export interface ChileCompraOcdsLookupResult {
  matched: boolean;
  source_year: number | null;
  legal_name: string | null;
  tax_id: string | null;
  normalized_tax_id: string | null;
  priority_score: number | null;
  signals: ChileCompraOcdsSignals | null;
  raw_data: Record<string, unknown> | null;
  reason: string | null;
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

function extractSignals(rawData: Record<string, unknown>): ChileCompraOcdsSignals {
  function toStrArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string');
  }
  function toNum(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  return {
    total_awarded_amount_clp: toNum(rawData.total_awarded_amount_clp),
    awards_count: toNum(rawData.awards_count),
    last_award_date: typeof rawData.last_award_date === 'string' ? rawData.last_award_date : null,
    buyer_names: toStrArray(rawData.buyer_names),
    buyer_ruts: toStrArray(rawData.buyer_ruts),
    unspsc_codes: toStrArray(rawData.unspsc_codes),
    unspsc_descriptions: toStrArray(rawData.unspsc_descriptions),
    ocids: toStrArray(rawData.ocids),
    source_urls: toStrArray(rawData.source_urls),
    procurement_methods: toStrArray(rawData.procurement_methods),
    awards_with_missing_amount: toNum(rawData.awards_with_missing_amount),
    awards_in_non_clp_currency: toNum(rawData.awards_in_non_clp_currency),
    currencies_seen: toStrArray(rawData.currencies_seen),
  };
}

// ── Main lookup ────────────────────────────────────────────────────────────────

/**
 * Looks up a supplier in source_company_snapshots by normalized RUT.
 * If year is omitted, selects the most recent available year.
 */
export async function lookupChileCompraOcdsByRut(
  input: ChileCompraOcdsLookupInput,
  supabaseOverride?: SupabaseClient,
): Promise<ChileCompraOcdsLookupResult> {
  const { normalizedTaxId } = normalizeRut(input.rut);

  if (!normalizedTaxId || normalizedTaxId.length === 0) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      tax_id: null,
      normalized_tax_id: null,
      priority_score: null,
      signals: null,
      raw_data: null,
      reason: 'invalid_rut_format',
    };
  }

  const sb = supabaseOverride ?? getAdminSupabase();
  if (!sb) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      tax_id: null,
      normalized_tax_id: normalizedTaxId,
      priority_score: null,
      signals: null,
      raw_data: null,
      reason: 'snapshot_unavailable',
    };
  }

  try {
    let query = sb
      .from(SNAPSHOT_TABLE)
      .select(
        'source_year, legal_name, tax_id, normalized_tax_id, priority_score, signals, raw_data',
      )
      .eq('source_key', SOURCE_KEY)
      .eq('country_code', COUNTRY_CODE)
      .eq('normalized_tax_id', normalizedTaxId);

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
        tax_id: null,
        normalized_tax_id: normalizedTaxId,
        priority_score: null,
        signals: null,
        raw_data: null,
        reason: 'snapshot_query_error',
      };
    }

    if (!data) {
      return {
        matched: false,
        source_year: null,
        legal_name: null,
        tax_id: null,
        normalized_tax_id: normalizedTaxId,
        priority_score: null,
        signals: null,
        raw_data: null,
        reason: 'no_snapshot_match_by_rut',
      };
    }

    const row = data as Record<string, unknown>;
    const rawData = (row.raw_data as Record<string, unknown>) ?? {};
    const signals = (row.signals as Record<string, unknown>) ?? rawData;

    return {
      matched: true,
      source_year: typeof row.source_year === 'number' ? row.source_year : null,
      legal_name: typeof row.legal_name === 'string' ? row.legal_name : null,
      tax_id: typeof row.tax_id === 'string' ? row.tax_id : null,
      normalized_tax_id: typeof row.normalized_tax_id === 'string' ? row.normalized_tax_id : normalizedTaxId,
      priority_score: typeof row.priority_score === 'number' ? row.priority_score : null,
      signals: extractSignals(signals),
      raw_data: rawData,
      reason: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      tax_id: null,
      normalized_tax_id: normalizedTaxId,
      priority_score: null,
      signals: null,
      raw_data: null,
      reason: `lookup_error: ${msg.slice(0, 200)}`,
    };
  }
}
