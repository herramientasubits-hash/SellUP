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
import {
  SnapshotReadQueryError,
  readLatestTaxGrainSnapshotByTaxId,
  readTaxGrainSnapshotByTaxId,
  type SnapshotIdentityRow,
  type SnapshotReadClient,
} from '../source-catalog/snapshot-read/snapshot-read-contract';

const SOURCE_KEY = 'cl_chilecompra_ocds';
const COUNTRY_CODE = 'CL';

/**
 * Columns this reader projects out of source_company_snapshots. Includes
 * source_year, required by the latest-year cardinality-aware lookup.
 */
const SNAPSHOT_SELECT_COLUMNS =
  'source_year, legal_name, tax_id, normalized_tax_id, priority_score, signals, raw_data';

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

  // No-match / invalid-id envelope, shared across the several outcomes below so
  // the external result shape stays byte-identical to the pre-migration reader.
  function noMatch(reason: string): ChileCompraOcdsLookupResult {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      tax_id: null,
      normalized_tax_id: normalizedTaxId,
      priority_score: null,
      signals: null,
      raw_data: null,
      reason,
    };
  }

  try {
    const client = sb as unknown as SnapshotReadClient<SnapshotIdentityRow>;

    // Migrated to the cardinality-aware contract (EC4D5.APP-C4A): exact year
    // uses the source_year-pinned lookup, latest year uses the desc-ordered
    // lookup. Neither does `.limit(1).maybeSingle()`; 2 rows for one fiscal id
    // surface as a cardinality violation instead of an arbitrary silent pick.
    const result =
      input.year != null
        ? await readTaxGrainSnapshotByTaxId({
            client,
            sourceKey: SOURCE_KEY,
            countryCode: COUNTRY_CODE,
            sourceYear: input.year,
            normalizedTaxId,
            selectColumns: SNAPSHOT_SELECT_COLUMNS,
          })
        : await readLatestTaxGrainSnapshotByTaxId({
            client,
            sourceKey: SOURCE_KEY,
            countryCode: COUNTRY_CODE,
            normalizedTaxId,
            selectColumns: SNAPSHOT_SELECT_COLUMNS,
          });

    switch (result.status) {
      case 'RECORD_IDENTITY_NOT_FOUND':
        return noMatch('no_snapshot_match_by_rut');
      case 'IDENTITY_UNAVAILABLE':
        return noMatch('invalid_rut_format');
      case 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION':
      case 'MULTI_RECORD_SAME_FISCAL_IDENTITY':
        // Two+ rows for the same RUT within one source_year: refuse to pick one.
        return noMatch('snapshot_cardinality_violation');
      case 'FOUND': {
        const row = result.row as Record<string, unknown>;
        const rawData = (row.raw_data as Record<string, unknown>) ?? {};
        const signals = (row.signals as Record<string, unknown>) ?? rawData;

        return {
          matched: true,
          source_year: typeof row.source_year === 'number' ? row.source_year : null,
          legal_name: typeof row.legal_name === 'string' ? row.legal_name : null,
          tax_id: typeof row.tax_id === 'string' ? row.tax_id : null,
          normalized_tax_id:
            typeof row.normalized_tax_id === 'string' ? row.normalized_tax_id : normalizedTaxId,
          priority_score: typeof row.priority_score === 'number' ? row.priority_score : null,
          signals: extractSignals(signals),
          raw_data: rawData,
          reason: null,
        };
      }
    }
  } catch (err) {
    // A DB/transport failure surfaces as SnapshotReadQueryError from the
    // contract; preserve the pre-migration `snapshot_query_error` reason for it.
    if (err instanceof SnapshotReadQueryError) {
      return noMatch('snapshot_query_error');
    }
    const msg = err instanceof Error ? err.message : String(err);
    return noMatch(`lookup_error: ${msg.slice(0, 200)}`);
  }
}
