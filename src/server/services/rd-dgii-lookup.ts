/**
 * DGII República Dominicana Post-Approval Lookup Service — Centroamérica.1A.4
 *
 * Looks up a Dominican company in source_company_snapshots using its RNC.
 * Reads ONLY from the pre-loaded snapshot. Never calls DGII API, WebForms, or SOAP.
 *
 * GUARDRAILS — this service must NEVER:
 * - Call api-dgii.dominicantechnology.com or any live DGII endpoint
 * - Call wsMovilDGII or any DGII WebService / SOAP endpoint
 * - Use __VIEWSTATE / __EVENTVALIDATION (WebForms)
 * - Call Tavily, Apollo, Lusha, Migo, SUNAT, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Be called for countries other than DO (enforced by caller guard)
 * - Process cédulas (11-digit identifiers — out of scope for jurídicos)
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const SNAPSHOT_TABLE = 'source_company_snapshots';
const SOURCE_KEY = 'rd_dgii_bulk' as const;
const COUNTRY_CODE = 'DO' as const;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RdDgiiLookupInput {
  rnc: string;
}

export type RdDgiiLegalValidationStatus =
  | 'matched'
  | 'not_found'
  | 'skipped';

export type RdDgiiSkipReason =
  | 'missing_tax_identifier'
  | 'person_identifier_out_of_scope';

export interface RdDgiiLookupResult {
  matched: boolean;
  source_year: number | null;
  legal_name: string | null;
  trade_name: string | null;
  normalized_rnc: string | null;
  taxpayer_status: string | null;
  normalized_status: string | null;
  is_active_taxpayer: boolean | null;
  economic_activity_text: string | null;
  registration_date: string | null;
  raw_data: Record<string, unknown> | null;
  legal_validation_status: RdDgiiLegalValidationStatus;
  skip_reason: RdDgiiSkipReason | null;
  reason: string | null;
}

// ── RNC normalization ──────────────────────────────────────────────────────────

/**
 * Normalizes a Dominican RNC: strips non-digit characters, returns null if
 * the result is not exactly 9 digits.
 * Cédulas (11 digits) are rejected — they are out of scope for jurídico lookup.
 */
export function normalizeDominicanRncForLookup(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) return digits;
  return null;
}

/**
 * Returns true when the raw tax_id looks like a cédula (11 digits after stripping).
 * Used to emit a precise skip_reason rather than a generic not_found.
 */
export function isDominicanCedulaIdentifier(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11;
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

// ── Main lookup ────────────────────────────────────────────────────────────────

/**
 * Looks up a Dominican company by RNC in source_company_snapshots.
 *
 * Behaviour by case:
 * - RNC empty or missing → skipped / missing_tax_identifier
 * - RNC has 11 digits (cédula) → skipped / person_identifier_out_of_scope
 * - RNC not 9 digits after normalizing → skipped / person_identifier_out_of_scope
 * - No snapshot row found → not_found
 * - Snapshot row found → matched
 *
 * Never calls DGII API, WebForms, SOAP, or any external service.
 */
export async function lookupDominicanDgiiByRnc(
  input: RdDgiiLookupInput,
  sb?: SupabaseClient,
): Promise<RdDgiiLookupResult> {
  const supabase = sb ?? getAdminSupabase();

  if (!supabase) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      trade_name: null,
      normalized_rnc: null,
      taxpayer_status: null,
      normalized_status: null,
      is_active_taxpayer: null,
      economic_activity_text: null,
      registration_date: null,
      raw_data: null,
      legal_validation_status: 'skipped',
      skip_reason: 'missing_tax_identifier',
      reason: 'supabase_client_unavailable',
    };
  }

  const rawRnc = input.rnc?.trim() ?? '';

  if (!rawRnc) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      trade_name: null,
      normalized_rnc: null,
      taxpayer_status: null,
      normalized_status: null,
      is_active_taxpayer: null,
      economic_activity_text: null,
      registration_date: null,
      raw_data: null,
      legal_validation_status: 'skipped',
      skip_reason: 'missing_tax_identifier',
      reason: 'empty_rnc',
    };
  }

  if (isDominicanCedulaIdentifier(rawRnc)) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      trade_name: null,
      normalized_rnc: null,
      taxpayer_status: null,
      normalized_status: null,
      is_active_taxpayer: null,
      economic_activity_text: null,
      registration_date: null,
      raw_data: null,
      legal_validation_status: 'skipped',
      skip_reason: 'person_identifier_out_of_scope',
      reason: 'cedula_11_digits_out_of_scope',
    };
  }

  const normalized = normalizeDominicanRncForLookup(rawRnc);

  if (!normalized) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      trade_name: null,
      normalized_rnc: null,
      taxpayer_status: null,
      normalized_status: null,
      is_active_taxpayer: null,
      economic_activity_text: null,
      registration_date: null,
      raw_data: null,
      legal_validation_status: 'skipped',
      skip_reason: 'person_identifier_out_of_scope',
      reason: 'rnc_not_9_digits_after_normalizing',
    };
  }

  const { data, error } = await supabase
    .from(SNAPSHOT_TABLE)
    .select(
      'source_year, legal_name, normalized_tax_id, raw_data',
    )
    .eq('source_key', SOURCE_KEY)
    .eq('country_code', COUNTRY_CODE)
    .eq('normalized_tax_id', normalized)
    .order('source_year', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`rd_dgii_lookup_db_error: ${error.message}`);
  }

  if (!data) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      trade_name: null,
      normalized_rnc: normalized,
      taxpayer_status: null,
      normalized_status: null,
      is_active_taxpayer: null,
      economic_activity_text: null,
      registration_date: null,
      raw_data: null,
      legal_validation_status: 'not_found',
      skip_reason: null,
      reason: 'no_snapshot_match_by_rnc',
    };
  }

  const raw = (data.raw_data as Record<string, unknown> | null) ?? {};

  return {
    matched: true,
    source_year: typeof data.source_year === 'number' ? data.source_year : null,
    legal_name: typeof data.legal_name === 'string' ? data.legal_name : null,
    trade_name: typeof raw.trade_name === 'string' ? raw.trade_name : null,
    normalized_rnc: normalized,
    taxpayer_status: typeof raw.taxpayer_status === 'string' ? raw.taxpayer_status : null,
    normalized_status: typeof raw.normalized_status === 'string' ? raw.normalized_status : null,
    is_active_taxpayer: typeof raw.is_active_taxpayer === 'boolean' ? raw.is_active_taxpayer : null,
    economic_activity_text:
      typeof raw.economic_activity_text === 'string' ? raw.economic_activity_text : null,
    registration_date:
      typeof raw.registration_date === 'string' ? raw.registration_date : null,
    raw_data: raw,
    legal_validation_status: 'matched',
    skip_reason: null,
    reason: null,
  };
}
