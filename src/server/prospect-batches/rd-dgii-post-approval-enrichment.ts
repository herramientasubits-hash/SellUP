/**
 * DGII República Dominicana Post-Approval Enrichment — Centroamérica.1A.4
 *
 * Enriches a post-approval Dominican Republic candidate with DGII snapshot data.
 * Called from the post-approval worker when country_code === 'DO'.
 *
 * GUARDRAILS — this module must NEVER:
 * - Be called for countries other than DO (enforced by guard)
 * - Call api-dgii.dominicantechnology.com, wsMovilDGII, or any DGII endpoint
 * - Use __VIEWSTATE / __EVENTVALIDATION (WebForms)
 * - Call Tavily, Apollo, Lusha, Migo, SUNAT, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Touch the wizard, contact enrichment, or HubSpot sync
 * - Invent CIIU codes (official_ciiu_available is always false for DGII bulk)
 * - Persist cédulas (11-digit identifiers are rejected before lookup)
 */

import {
  lookupDominicanDgiiByRnc,
  type RdDgiiLookupResult,
} from '../services/rd-dgii-lookup';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RdEnrichmentInput {
  candidateId?: string;
  accountId?: string;
  countryCode: string;
  taxId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Enrichment block stored at metadata.source_enrichment.rd_dgii_bulk.
 *
 * Semantic rules (always enforced):
 * - source_type = 'legal_registry' (DGII is the official Dominican tax registry)
 * - legal_validation_status = matched / not_found / skipped
 * - official_ciiu_available = false (DGII bulk does not provide CIIU codes)
 * - ciiu_status = 'unavailable_for_mvp'
 * - economic_activity_source = 'dgii_text' (free text, not normalized)
 * - sector_source = 'dgii_economic_activity_text'
 * - human_review_required = true
 */
export interface RdDgiiEnrichmentBlock {
  status: 'matched' | 'not_found' | 'skipped' | 'error';
  matched_by: 'tax_id' | null;
  confidence: number;
  source_year: number | null;
  source: 'source_company_snapshots';
  source_key: 'rd_dgii_bulk';
  country_code: 'DO';
  // Semantic guardrails
  source_type: 'legal_registry';
  legal_validation_status: 'matched' | 'not_found' | 'skipped';
  official_ciiu_available: false;
  ciiu_status: 'unavailable_for_mvp';
  economic_activity_source: 'dgii_text';
  sector_source: 'dgii_economic_activity_text';
  human_review_required: true;
  // Snapshot fields — present when matched, null otherwise
  rnc: string | null;
  legal_name: string | null;
  trade_name: string | null;
  taxpayer_status: string | null;
  normalized_status: string | null;
  is_active_taxpayer: boolean | null;
  economic_activity_text: string | null;
  registration_date: string | null;
  // Metadata
  reason: string | null;
  enriched_at: string;
}

export type RdEnrichmentReason =
  | 'not_do_country'
  | 'missing_tax_id'
  | 'person_identifier_out_of_scope'
  | 'rnc_lookup_completed';

export interface RdEnrichmentResult {
  enriched: boolean;
  countryCode: string;
  rnc: string | null;
  rd_dgii_bulk: RdDgiiEnrichmentBlock | null;
  reason: RdEnrichmentReason;
}

// ── Semantic guardrails constant ───────────────────────────────────────────────

const SEMANTIC_GUARDRAILS = {
  source_key: 'rd_dgii_bulk',
  country_code: 'DO',
  source_type: 'legal_registry',
  official_ciiu_available: false,
  ciiu_status: 'unavailable_for_mvp',
  economic_activity_source: 'dgii_text',
  sector_source: 'dgii_economic_activity_text',
  human_review_required: true,
} as const;

// ── RNC resolution ─────────────────────────────────────────────────────────────

/**
 * Resolves RNC from input fields in priority order:
 *   1. input.taxId
 *   2. input.metadata.tax_id
 *   3. input.metadata.rnc
 */
export function resolveRncFromInput(input: RdEnrichmentInput): string | null {
  if (typeof input.taxId === 'string' && input.taxId.trim()) {
    return input.taxId.trim();
  }
  const meta = input.metadata;
  if (meta) {
    if (typeof meta.tax_id === 'string' && (meta.tax_id as string).trim()) {
      return (meta.tax_id as string).trim();
    }
    if (typeof meta.rnc === 'string' && (meta.rnc as string).trim()) {
      return (meta.rnc as string).trim();
    }
  }
  return null;
}

// ── Block builders ─────────────────────────────────────────────────────────────

function buildMatchedBlock(
  result: RdDgiiLookupResult,
  enrichedAt: string,
): RdDgiiEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'matched',
    matched_by: 'tax_id',
    confidence: 1,
    source_year: result.source_year,
    source: 'source_company_snapshots',
    legal_validation_status: 'matched',
    rnc: result.normalized_rnc,
    legal_name: result.legal_name,
    trade_name: result.trade_name,
    taxpayer_status: result.taxpayer_status,
    normalized_status: result.normalized_status,
    is_active_taxpayer: result.is_active_taxpayer,
    economic_activity_text: result.economic_activity_text,
    registration_date: result.registration_date,
    reason: null,
    enriched_at: enrichedAt,
  };
}

function buildNotFoundBlock(
  normalizedRnc: string | null,
  reason: string,
  enrichedAt: string,
): RdDgiiEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'not_found',
    matched_by: null,
    confidence: 0,
    source_year: null,
    source: 'source_company_snapshots',
    legal_validation_status: 'not_found',
    rnc: normalizedRnc,
    legal_name: null,
    trade_name: null,
    taxpayer_status: null,
    normalized_status: null,
    is_active_taxpayer: null,
    economic_activity_text: null,
    registration_date: null,
    reason,
    enriched_at: enrichedAt,
  };
}

function buildSkippedBlock(
  reason: string,
  enrichedAt: string,
): RdDgiiEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'skipped',
    matched_by: null,
    confidence: 0,
    source_year: null,
    source: 'source_company_snapshots',
    legal_validation_status: 'skipped',
    rnc: null,
    legal_name: null,
    trade_name: null,
    taxpayer_status: null,
    normalized_status: null,
    is_active_taxpayer: null,
    economic_activity_text: null,
    registration_date: null,
    reason,
    enriched_at: enrichedAt,
  };
}

function buildErrorBlock(
  reason: string,
  enrichedAt: string,
): RdDgiiEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'error',
    matched_by: null,
    confidence: 0,
    source_year: null,
    source: 'source_company_snapshots',
    legal_validation_status: 'skipped',
    rnc: null,
    legal_name: null,
    trade_name: null,
    taxpayer_status: null,
    normalized_status: null,
    is_active_taxpayer: null,
    economic_activity_text: null,
    registration_date: null,
    reason,
    enriched_at: enrichedAt,
  };
}

// ── Main enrichment function ───────────────────────────────────────────────────

/**
 * Enriches a post-approval Dominican Republic candidate from DGII snapshot.
 *
 * Behaviour by case:
 * - countryCode !== 'DO' → enriched=false, rd_dgii_bulk=null
 * - no RNC → skipped block with reason='missing_tax_id'
 * - RNC has 11 digits (cédula) → skipped / person_identifier_out_of_scope
 * - RNC present → lookup snapshot, build matched/not_found block
 * - error in lookup → error block, never throws
 *
 * @param lookupFn - Injected for testing; defaults to lookupDominicanDgiiByRnc
 */
export async function enrichDominicanCandidateWithDgii(
  input: RdEnrichmentInput,
  lookupFn: (
    input: { rnc: string },
    sb?: SupabaseClient,
  ) => Promise<RdDgiiLookupResult> = lookupDominicanDgiiByRnc,
): Promise<RdEnrichmentResult> {
  const enrichedAt = new Date().toISOString();
  const countryCode = (input.countryCode ?? '').toUpperCase();

  if (countryCode !== 'DO') {
    return {
      enriched: false,
      countryCode: input.countryCode,
      rnc: null,
      rd_dgii_bulk: null,
      reason: 'not_do_country',
    };
  }

  const rnc = resolveRncFromInput(input);

  if (!rnc) {
    return {
      enriched: true,
      countryCode,
      rnc: null,
      rd_dgii_bulk: buildSkippedBlock('missing_tax_id', enrichedAt),
      reason: 'missing_tax_id',
    };
  }

  // Reject cédulas (11 digits) — person identifiers are out of scope
  const digits = rnc.replace(/\D/g, '');
  if (digits.length === 11) {
    return {
      enriched: true,
      countryCode,
      rnc: null,
      rd_dgii_bulk: buildSkippedBlock('person_identifier_out_of_scope', enrichedAt),
      reason: 'person_identifier_out_of_scope',
    };
  }

  try {
    const result = await lookupFn({ rnc });

    if (result.legal_validation_status === 'skipped') {
      return {
        enriched: true,
        countryCode,
        rnc: null,
        rd_dgii_bulk: buildSkippedBlock(result.reason ?? 'rnc_not_valid', enrichedAt),
        reason: 'person_identifier_out_of_scope',
      };
    }

    const block = result.matched
      ? buildMatchedBlock(result, enrichedAt)
      : buildNotFoundBlock(
          result.normalized_rnc,
          result.reason ?? 'no_snapshot_match_by_rnc',
          enrichedAt,
        );

    return {
      enriched: true,
      countryCode,
      rnc: result.normalized_rnc ?? rnc,
      rd_dgii_bulk: block,
      reason: 'rnc_lookup_completed',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      enriched: true,
      countryCode,
      rnc,
      rd_dgii_bulk: buildErrorBlock(msg.slice(0, 200), enrichedAt),
      reason: 'rnc_lookup_completed',
    };
  }
}
