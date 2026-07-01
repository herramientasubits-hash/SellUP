/**
 * DGCP República Dominicana Post-Approval Enrichment — RepúblicaDominicana.2D
 *
 * Enriches a post-approval Dominican Republic candidate with DGCP procurement
 * signal data from the local do_dgcp snapshot in source_company_snapshots.
 * Called from the post-approval worker when country_code === 'DO', after DGII.
 *
 * GUARDRAILS — this module must NEVER:
 * - Be called for countries other than DO (enforced by guard)
 * - Call datosabiertos.dgcp.gob.do or any DGCP API endpoint
 * - Call Tavily, Apollo, Lusha, DGII external, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Touch source_coverage_summaries
 * - Touch the wizard, contact enrichment, or HubSpot sync
 * - Validate RNC (that is DGII's responsibility)
 * - Invent CIIU codes (official_ciiu_available is always false)
 * - Overwrite existing rd_dgii_bulk, pe_sunat_bulk, cl_chilecompra_ocds,
 *   mx_denue, or any other source_enrichment keys
 *
 * Semantic obligations (always enforced):
 *   source_type: 'procurement_signal'     — DGCP is commercial signal, NOT legal
 *   legal_validation_status: 'not_applicable'
 *   tax_validation_status: 'not_applicable'
 *   official_ciiu_available: false
 *   ciiu_status: 'unavailable_for_mvp'
 *   human_review_required: true
 */

import {
  lookupDominicanDgcpByRnc,
  normalizeDominicanRncForDgcp,
  type RdDgcpLookupResult,
} from '../services/rd-dgcp-lookup';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DominicanDgcpEnrichmentInput {
  candidateId?: string;
  accountId?: string;
  countryCode: string;
  taxId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DgcpProcurementSummary {
  total_contracts_year: number | null;
  total_awarded_amount_dop: number | null;
  last_award_date: string | null;
  currency: string;
}

/**
 * Enrichment block stored at metadata.source_enrichment.do_dgcp.
 *
 * Semantic rules (always enforced):
 * - source_type = 'procurement_signal'  — DGCP is NOT a legal/tax registry
 * - legal_validation_status = 'not_applicable'
 * - tax_validation_status = 'not_applicable'
 * - official_ciiu_available = false
 * - ciiu_status = 'unavailable_for_mvp'
 * - human_review_required = true
 */
export interface DgcpEnrichmentBlock {
  source_key: 'do_dgcp';
  country_code: 'DO';
  source_type: 'procurement_signal';
  status: 'matched' | 'not_found' | 'skipped' | 'error';
  matched_by: 'tax_id' | null;
  confidence: number;
  legal_validation_status: 'not_applicable';
  tax_validation_status: 'not_applicable';
  official_ciiu_available: false;
  ciiu_status: 'unavailable_for_mvp';
  sector_source: 'procurement_category_or_not_official';
  human_review_required: true;
  priority_boost: boolean;
  snapshot_source: 'source_company_snapshots';
  source_year: number | null;
  procurement_summary: DgcpProcurementSummary | null;
  reason: string | null;
  enriched_at: string;
}

export type DominicanDgcpEnrichmentReason =
  | 'not_do_country'
  | 'missing_rnc'
  | 'rnc_lookup_completed';

export interface DominicanDgcpEnrichmentResult {
  enriched: boolean;
  countryCode: string;
  rnc: string | null;
  do_dgcp: DgcpEnrichmentBlock | null;
  reason: DominicanDgcpEnrichmentReason;
}

// ── Semantic guardrails constant ───────────────────────────────────────────────

const SEMANTIC_GUARDRAILS = {
  source_key: 'do_dgcp',
  country_code: 'DO',
  source_type: 'procurement_signal',
  legal_validation_status: 'not_applicable',
  tax_validation_status: 'not_applicable',
  official_ciiu_available: false,
  ciiu_status: 'unavailable_for_mvp',
  sector_source: 'procurement_category_or_not_official',
  human_review_required: true,
  snapshot_source: 'source_company_snapshots',
} as const;

// ── RNC resolution ─────────────────────────────────────────────────────────────

/**
 * Resolves RNC from input fields in priority order:
 *   1. input.taxId
 *   2. input.metadata.tax_id
 *   3. input.metadata.rnc
 */
export function resolveRncFromDgcpInput(
  input: DominicanDgcpEnrichmentInput,
): string | null {
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
  result: RdDgcpLookupResult,
  enrichedAt: string,
): DgcpEnrichmentBlock {
  const procurementSummary: DgcpProcurementSummary = {
    total_contracts_year: result.total_contracts_year,
    total_awarded_amount_dop: result.total_awarded_amount_dop,
    last_award_date: result.last_award_date,
    currency: result.currency ?? 'DOP',
  };

  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'matched',
    matched_by: 'tax_id',
    confidence: 1,
    priority_boost: true,
    source_year: result.source_year,
    procurement_summary: procurementSummary,
    reason: null,
    enriched_at: enrichedAt,
  };
}

function buildNotFoundBlock(enrichedAt: string): DgcpEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'not_found',
    matched_by: null,
    confidence: 0,
    priority_boost: false,
    source_year: null,
    procurement_summary: null,
    reason: 'no_snapshot_match_by_rnc',
    enriched_at: enrichedAt,
  };
}

function buildSkippedBlock(
  reason: string,
  enrichedAt: string,
): DgcpEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'skipped',
    matched_by: null,
    confidence: 0,
    priority_boost: false,
    source_year: null,
    procurement_summary: null,
    reason,
    enriched_at: enrichedAt,
  };
}

function buildErrorBlock(reason: string, enrichedAt: string): DgcpEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'error',
    matched_by: null,
    confidence: 0,
    priority_boost: false,
    source_year: null,
    procurement_summary: null,
    reason,
    enriched_at: enrichedAt,
  };
}

// ── Main enrichment function ───────────────────────────────────────────────────

/**
 * Enriches a post-approval Dominican Republic candidate with DGCP procurement signal.
 *
 * Behaviour by case:
 * - countryCode !== 'DO' → enriched=false, do_dgcp=null
 * - no RNC → skipped block with reason='missing_rnc'
 * - RNC present → lookup local snapshot, build matched/not_found block
 * - error in lookup → error block, never throws
 *
 * Never calls DGCP API. Query is local source_company_snapshots only.
 *
 * @param lookupFn - Injected for testing; defaults to lookupDominicanDgcpByRnc
 */
export async function enrichDominicanCandidateWithDgcp(
  input: DominicanDgcpEnrichmentInput,
  lookupFn: (
    input: { rnc: string },
    sb?: SupabaseClient,
  ) => Promise<RdDgcpLookupResult> = lookupDominicanDgcpByRnc,
): Promise<DominicanDgcpEnrichmentResult> {
  const enrichedAt = new Date().toISOString();
  const countryCode = (input.countryCode ?? '').toUpperCase();

  if (countryCode !== 'DO') {
    return {
      enriched: false,
      countryCode: input.countryCode,
      rnc: null,
      do_dgcp: null,
      reason: 'not_do_country',
    };
  }

  const rawRnc = resolveRncFromDgcpInput(input);

  if (!rawRnc) {
    return {
      enriched: true,
      countryCode,
      rnc: null,
      do_dgcp: buildSkippedBlock('missing_rnc', enrichedAt),
      reason: 'missing_rnc',
    };
  }

  const normalizedRnc = normalizeDominicanRncForDgcp(rawRnc);

  try {
    const result = await lookupFn({ rnc: normalizedRnc });

    const block = result.matched
      ? buildMatchedBlock(result, enrichedAt)
      : buildNotFoundBlock(enrichedAt);

    return {
      enriched: true,
      countryCode,
      rnc: normalizedRnc,
      do_dgcp: block,
      reason: 'rnc_lookup_completed',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      enriched: true,
      countryCode,
      rnc: normalizedRnc,
      do_dgcp: buildErrorBlock(msg.slice(0, 200), enrichedAt),
      reason: 'rnc_lookup_completed',
    };
  }
}
