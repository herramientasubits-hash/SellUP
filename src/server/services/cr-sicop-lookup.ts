/**
 * SICOP Costa Rica Post-Approval Lookup Service — Centroamérica.4F
 *
 * Looks up a Costa Rican company in source_company_snapshots using its
 * normalized cédula jurídica. Reads ONLY from the pre-loaded cr_sicop snapshot.
 * Never calls datos.go.cr, CKAN, or any SICOP API endpoint.
 *
 * GUARDRAILS — this service must NEVER:
 * - Call datos.go.cr or any SICOP/CKAN API endpoint
 * - Call api.hacienda.go.cr or any Hacienda CR endpoint
 * - Call Tavily, Apollo, Lusha, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Touch source_coverage_summaries
 * - Be called for countries other than CR (enforced by caller guard)
 * - Validate cédula jurídica (not a fiscal source)
 * - Replace Hacienda CR as legal/tax registry
 *
 * Semantic obligations (enforced here):
 *   source_type: 'procurement_signal'    — SICOP is commercial signal, NOT legal/tax
 *   legal_validation_status: 'not_applicable'
 *   tax_validation_status: 'not_applicable'
 *   official_ciiu_available: false
 *   ciiu_status: 'unavailable_for_mvp'
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const SNAPSHOT_TABLE = 'source_company_snapshots';
const SOURCE_KEY = 'cr_sicop';
const COUNTRY_CODE = 'CR';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CrSicopLookupInput {
  cedula: string;
  year?: number;
}

export interface CrSicopLookupResult {
  matched: boolean;
  source_year: number | null;
  legal_name: string | null;
  normalized_tax_id: string | null;
  priority_score: number | null;
  total_records_year: number | null;
  datasets_seen: string[] | null;
  last_event_date: string | null;
  raw_data: Record<string, unknown> | null;
  reason: string | null;
}

// ── Cédula jurídica normalization ──────────────────────────────────────────────

/**
 * Normalizes a Costa Rican cédula jurídica by stripping dashes, dots, and spaces.
 * SICOP snapshots are keyed by normalized cedula in normalized_tax_id.
 *
 * Cédulas jurídicas in CR typically start with 3 and have 10 digits.
 * This function only strips separators — it does NOT validate the identifier.
 */
export function normalizeCostaRicaCedulaForSicop(raw: string): string {
  return raw.replace(/[\s\-.]/g, '');
}

/**
 * Returns true if the normalized identifier looks like a cédula jurídica
 * (persona jurídica starts with 3, typically 10 digits).
 * Non-company identifiers (cédulas físicas starting with 1/2/etc) return false.
 *
 * This is a heuristic filter only — NOT legal validation.
 * SICOP does not validate cédulas jurídicas.
 * This check avoids clearly non-company identifiers being looked up.
 */
export function isLikelyCostaRicaLegalEntity(normalized: string): boolean {
  return /^\d{10}$/.test(normalized) && normalized.startsWith('3');
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

function toStrArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === 'string');
}

// ── Main lookup ────────────────────────────────────────────────────────────────

/**
 * Looks up a Costa Rican supplier in source_company_snapshots (cr_sicop) by normalized cédula.
 * If year is omitted, selects the most recent available year.
 * Never calls datos.go.cr or any CKAN/SICOP API — reads local snapshot only.
 */
export async function lookupCostaRicaSicopByCedula(
  input: CrSicopLookupInput,
  supabaseOverride?: SupabaseClient,
): Promise<CrSicopLookupResult> {
  const normalizedCedula = normalizeCostaRicaCedulaForSicop(input.cedula);

  if (!normalizedCedula) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: null,
      priority_score: null,
      total_records_year: null,
      datasets_seen: null,
      last_event_date: null,
      raw_data: null,
      reason: 'invalid_cedula_format',
    };
  }

  const sb = supabaseOverride ?? getAdminSupabase();
  if (!sb) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: normalizedCedula,
      priority_score: null,
      total_records_year: null,
      datasets_seen: null,
      last_event_date: null,
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
      .eq('normalized_tax_id', normalizedCedula);

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
        normalized_tax_id: normalizedCedula,
        priority_score: null,
        total_records_year: null,
        datasets_seen: null,
        last_event_date: null,
        raw_data: null,
        reason: 'snapshot_query_error',
      };
    }

    if (!data) {
      return {
        matched: false,
        source_year: null,
        legal_name: null,
        normalized_tax_id: normalizedCedula,
        priority_score: null,
        total_records_year: null,
        datasets_seen: null,
        last_event_date: null,
        raw_data: null,
        reason: 'no_snapshot_match_by_cedula',
      };
    }

    const row = data as Record<string, unknown>;
    const rawData = (row.raw_data as Record<string, unknown>) ?? {};
    const signals = (row.signals as Record<string, unknown>) ?? {};

    const totalRecordsYear =
      toNum(signals.total_records_year) ?? toNum(rawData.total_records_year);
    const datasetsSeen =
      toStrArray(signals.datasets_seen) ?? toStrArray(rawData.datasets_seen);
    const lastEventDate =
      toStr(signals.last_event_date) ?? toStr(rawData.last_event_date);

    return {
      matched: true,
      source_year: toNum(row.source_year),
      legal_name: toStr(row.legal_name),
      normalized_tax_id: toStr(row.normalized_tax_id) ?? normalizedCedula,
      priority_score: toNum(row.priority_score),
      total_records_year: totalRecordsYear,
      datasets_seen: datasetsSeen,
      last_event_date: lastEventDate,
      raw_data: rawData,
      reason: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: normalizedCedula,
      priority_score: null,
      total_records_year: null,
      datasets_seen: null,
      last_event_date: null,
      raw_data: null,
      reason: `lookup_error: ${msg.slice(0, 200)}`,
    };
  }
}
