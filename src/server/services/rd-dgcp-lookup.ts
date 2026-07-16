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
import {
  SnapshotReadQueryError,
  readLatestTaxGrainSnapshotByTaxId,
  readTaxGrainSnapshotByTaxId,
  type SnapshotIdentityRow,
  type SnapshotReadClient,
} from '../source-catalog/snapshot-read/snapshot-read-contract';

const SOURCE_KEY = 'do_dgcp';
const COUNTRY_CODE = 'DO';

/**
 * Columns this reader projects out of source_company_snapshots. Includes
 * source_year, required by the latest-year cardinality-aware lookup.
 */
const SNAPSHOT_SELECT_COLUMNS =
  'source_year, legal_name, normalized_tax_id, priority_score, signals, raw_data';

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

  // No-match / invalid-id envelope, shared across the several outcomes below so
  // the external result shape stays byte-identical to the pre-migration reader.
  function noMatch(reason: string): RdDgcpLookupResult {
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
      reason,
    };
  }

  try {
    const client = sb as unknown as SnapshotReadClient<SnapshotIdentityRow>;

    // Migrated to the cardinality-aware contract (EC4D5.APP-C4B): exact year
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
            normalizedTaxId: normalizedRnc,
            selectColumns: SNAPSHOT_SELECT_COLUMNS,
          })
        : await readLatestTaxGrainSnapshotByTaxId({
            client,
            sourceKey: SOURCE_KEY,
            countryCode: COUNTRY_CODE,
            normalizedTaxId: normalizedRnc,
            selectColumns: SNAPSHOT_SELECT_COLUMNS,
          });

    switch (result.status) {
      case 'RECORD_IDENTITY_NOT_FOUND':
        return noMatch('no_snapshot_match_by_rnc');
      case 'IDENTITY_UNAVAILABLE':
        return noMatch('invalid_rnc_format');
      case 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION':
      case 'MULTI_RECORD_SAME_FISCAL_IDENTITY':
        // Two+ rows for the same RNC within one source_year: refuse to pick one.
        return noMatch('snapshot_cardinality_violation');
      case 'FOUND': {
        const row = result.row as Record<string, unknown>;
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
