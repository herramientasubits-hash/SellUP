/**
 * Honduras Contrataciones Abiertas RTN Lookup Service — Centroamérica.8C.5B
 *
 * Looks up a Honduran company in source_company_snapshots using its RTN.
 * Reads ONLY from the pre-loaded hn_contrataciones_abiertas snapshot.
 * Never calls contratacionesabiertas.gob.hn or any OCDS endpoint.
 *
 * GUARDRAILS — this service must NEVER:
 * - Call contratacionesabiertas.gob.hn or the OCP Data Registry
 * - Call Tavily, Apollo, Lusha, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Touch source_coverage_summaries
 * - Be called for countries other than HN (enforced by caller guard)
 * - Validate RTN fiscal/legal status (not a fiscal source)
 * - Replace SAR (Servicio de Administración de Rentas) as tax registry
 *
 * Semantic obligations (enforced here by guardrail checks on raw_data):
 *   source_type: 'procurement_signal'    — HN is commercial signal, NOT legal/tax
 *   tax_identifier_type: 'RTN'
 *   legal_validation_status: 'not_applicable'
 *   human_review_required: true
 *   post_approval_enabled: false
 *   matching_automatic_enabled: false
 *   legal_entity_hint: 'likely_legal_entity'
 *   source: 'ocp_registry_jsonl'         — provenance is a trusted guardrail (8C.5B.1)
 *
 * Contract obligation (Centroamérica.8C.5B.1):
 *   Every `found: true` result MUST carry the semantic guardrails EXPLICITLY —
 *   source_type, legal_validation_status, human_review_required, post_approval_enabled,
 *   matching_automatic_enabled — plus an explicit `provenance` block. A consumer must
 *   NEVER be able to read `found === true` as company_verified / legal_identity_confirmed
 *   / fiscal_identity_confirmed. These fields are emitted as SAFE LITERALS, only after
 *   the 8 guardrails on raw_data pass; they are never echoed blindly from the DB row.
 *   The raw persistence payload (`raw_data`) is NOT part of the public result — it is
 *   parsed and validated internally only, to reduce coupling to the snapshot JSON shape.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeHondurasRtn,
  maskRtn,
} from '../source-catalog/connectors/hn-contrataciones-abiertas/hn-rtn-normalizer';

const SNAPSHOT_TABLE = 'source_company_snapshots';
const SOURCE_KEY = 'hn_contrataciones_abiertas';
const COUNTRY_CODE = 'HN';

// ── Safe semantic literals ───────────────────────────────────────────────────
// These NEVER come from the DB row; they are emitted only after guardrails pass.
const SOURCE_TYPE = 'procurement_signal' as const;
const LEGAL_VALIDATION_STATUS = 'not_applicable' as const;
const LEGAL_ENTITY_HINT = 'likely_legal_entity' as const;
const SNAPSHOT_SOURCE = 'ocp_registry_jsonl' as const;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface HnContratacionesLookupInput {
  rtn: string | null | undefined;
  year?: number;
}

export interface HnProcurementSignals {
  awards_count: number | null;
  tenders_count: number | null;
  contracts_count: number | null;
  total_award_amount: number | null;
  latest_date: string | null;
}

export type HnContratacionesLookupReason =
  | 'invalid_rtn'
  | 'environment_unavailable'
  | 'query_error'
  | 'not_found'
  | 'snapshot_guardrail_violation';

/**
 * Explicit provenance of a found snapshot. Built from validated literals only —
 * never inferred from an untrusted `raw_data.source`.
 */
export interface HnLookupProvenance {
  snapshot_source: typeof SNAPSHOT_SOURCE;
  legal_entity_hint: typeof LEGAL_ENTITY_HINT;
  source_year: number | null;
}

/**
 * Successful lookup. Carries the source's semantic guardrails EXPLICITLY so no
 * consumer can mistake `found: true` for a verified legal/fiscal identity.
 * `raw_data` is intentionally absent — it is an internal parsing detail only.
 */
export interface HnContratacionesLookupFound {
  found: true;

  source_key: typeof SOURCE_KEY;
  country_code: typeof COUNTRY_CODE;
  source_year: number | null;

  legal_name: string | null;

  normalized_rtn: string;
  masked_rtn: string;

  priority_score: number | null;
  procurement_signals: HnProcurementSignals | null;

  source_type: typeof SOURCE_TYPE;
  legal_validation_status: typeof LEGAL_VALIDATION_STATUS;
  human_review_required: true;
  post_approval_enabled: false;
  matching_automatic_enabled: false;

  provenance: HnLookupProvenance;

  reason: null;
}

export interface HnContratacionesLookupNotFound {
  found: false;
  normalized_rtn: string | null;
  masked_rtn: string | null;
  reason: HnContratacionesLookupReason;
  guardrail_field?: string;
}

export type HnContratacionesLookupResult =
  | HnContratacionesLookupFound
  | HnContratacionesLookupNotFound;

// ── Admin client ───────────────────────────────────────────────────────────────

function getAdminSupabase(): SupabaseClient | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(url, key);
}

// ── Guardrail verification ─────────────────────────────────────────────────────

type GuardrailResult =
  | { ok: true }
  | { ok: false; field: string };

function verifyGuardrails(rawData: Record<string, unknown>): GuardrailResult {
  if (rawData['source_type'] !== 'procurement_signal') {
    return { ok: false, field: 'source_type' };
  }
  if (rawData['tax_identifier_type'] !== 'RTN') {
    return { ok: false, field: 'tax_identifier_type' };
  }
  if (rawData['legal_validation_status'] !== 'not_applicable') {
    return { ok: false, field: 'legal_validation_status' };
  }
  if (rawData['human_review_required'] !== true) {
    return { ok: false, field: 'human_review_required' };
  }
  if (rawData['post_approval_enabled'] !== false) {
    return { ok: false, field: 'post_approval_enabled' };
  }
  if (rawData['matching_automatic_enabled'] !== false) {
    return { ok: false, field: 'matching_automatic_enabled' };
  }
  if (rawData['legal_entity_hint'] !== 'likely_legal_entity') {
    return { ok: false, field: 'legal_entity_hint' };
  }
  // Provenance guardrail (8C.5B.1): a row whose declared source is not the
  // OCP registry snapshot cannot back trusted `provenance` — reject it.
  if (rawData['source'] !== SNAPSHOT_SOURCE) {
    return { ok: false, field: 'source' };
  }
  return { ok: true };
}

// ── Signal extraction (safe) ───────────────────────────────────────────────────

function extractSignals(signals: Record<string, unknown>): HnProcurementSignals | null {
  try {
    function toNum(v: unknown): number | null {
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    // Counts are structurally non-negative upstream: the OCDS adapter builds them
    // from array lengths and `++` increments (never subtraction), so the mapper
    // writes counts >= 0. There is no explicit clamp upstream, and the lookup reads
    // a persisted JSON payload it does not own, so we harden conservatively here:
    // a negative count is meaningless → null (never flips found to false).
    function toCount(v: unknown): number | null {
      const n = toNum(v);
      if (n === null) return null;
      return n < 0 ? null : n;
    }
    function toStr(v: unknown): string | null {
      if (typeof v !== 'string') return null;
      // Validate date-like string loosely: non-empty string accepted
      return v.length > 0 ? v : null;
    }

    return {
      awards_count: toCount(signals['awards_count']),
      tenders_count: toCount(signals['tenders_count']),
      contracts_count: toCount(signals['contracts_count']),
      total_award_amount: toNum(signals['total_award_amount']),
      latest_date: toStr(signals['latest_date']),
    };
  } catch {
    return null;
  }
}

// ── Main lookup ────────────────────────────────────────────────────────────────

/**
 * Looks up a Honduran supplier in source_company_snapshots by normalized RTN.
 * If year is omitted, selects the most recent available year.
 * Never calls contratacionesabiertas.gob.hn — reads local snapshot only.
 * RTN is never logged in full; masked form used for diagnostics.
 */
export async function lookupHnContratacionesByRtn(
  input: HnContratacionesLookupInput,
  supabaseOverride?: SupabaseClient,
): Promise<HnContratacionesLookupResult> {
  const normalized = normalizeHondurasRtn(input.rtn);

  if (!normalized.isValid || !normalized.normalized) {
    return {
      found: false,
      normalized_rtn: null,
      masked_rtn: null,
      reason: 'invalid_rtn',
    };
  }

  const normalizedRtn = normalized.normalized;
  const maskedRtn = maskRtn(normalizedRtn);

  const sb = supabaseOverride ?? getAdminSupabase();
  if (!sb) {
    return {
      found: false,
      normalized_rtn: normalizedRtn,
      masked_rtn: maskedRtn,
      reason: 'environment_unavailable',
    };
  }

  try {
    let query = sb
      .from(SNAPSHOT_TABLE)
      .select('source_year, legal_name, normalized_tax_id, priority_score, signals, raw_data')
      .eq('source_key', SOURCE_KEY)
      .eq('country_code', COUNTRY_CODE)
      .eq('normalized_tax_id', normalizedRtn);

    if (input.year != null) {
      query = query.eq('source_year', input.year);
    } else {
      query = query.order('source_year', { ascending: false });
    }

    const { data, error } = await query.limit(1).maybeSingle();

    if (error) {
      return {
        found: false,
        normalized_rtn: normalizedRtn,
        masked_rtn: maskedRtn,
        reason: 'query_error',
      };
    }

    if (!data) {
      return {
        found: false,
        normalized_rtn: normalizedRtn,
        masked_rtn: maskedRtn,
        reason: 'not_found',
      };
    }

    const row = data as Record<string, unknown>;
    const rawData = (row['raw_data'] as Record<string, unknown>) ?? {};

    const guardrail = verifyGuardrails(rawData);
    if (!guardrail.ok) {
      return {
        found: false,
        normalized_rtn: normalizedRtn,
        masked_rtn: maskedRtn,
        reason: 'snapshot_guardrail_violation',
        guardrail_field: guardrail.field,
      };
    }

    const signals = (row['signals'] as Record<string, unknown>) ?? {};
    const procurementSignals = extractSignals(signals);

    const sourceYear =
      typeof row['source_year'] === 'number' ? row['source_year'] : null;
    const legalName =
      typeof row['legal_name'] === 'string' ? row['legal_name'] : null;
    const priorityScore =
      typeof row['priority_score'] === 'number' && Number.isFinite(row['priority_score'])
        ? row['priority_score']
        : null;

    // Guardrails passed. Emit semantic fields as SAFE LITERALS (not echoed from
    // the row) and build provenance only now that `source` has been validated.
    return {
      found: true,

      source_key: SOURCE_KEY,
      country_code: COUNTRY_CODE,
      source_year: sourceYear,

      legal_name: legalName,

      normalized_rtn: normalizedRtn,
      masked_rtn: maskedRtn,

      priority_score: priorityScore,
      procurement_signals: procurementSignals,

      source_type: SOURCE_TYPE,
      legal_validation_status: LEGAL_VALIDATION_STATUS,
      human_review_required: true,
      post_approval_enabled: false,
      matching_automatic_enabled: false,

      provenance: {
        snapshot_source: SNAPSHOT_SOURCE,
        legal_entity_hint: LEGAL_ENTITY_HINT,
        source_year: sourceYear,
      },

      reason: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Log masked RTN only — never the full identifier
    void msg; // consumed for type safety; caller receives generic error
    return {
      found: false,
      normalized_rtn: normalizedRtn,
      masked_rtn: maskedRtn,
      reason: 'query_error',
    };
  }
}
