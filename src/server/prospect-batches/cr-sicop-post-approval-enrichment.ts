/**
 * SICOP Costa Rica Post-Approval Enrichment — Centroamérica.4F
 *
 * Enriches a post-approval Costa Rica candidate with SICOP procurement
 * signal data from the local cr_sicop snapshot in source_company_snapshots.
 * Called from the post-approval worker when country_code === 'CR'.
 *
 * GUARDRAILS — this module must NEVER:
 * - Be called for countries other than CR (enforced by guard)
 * - Call datos.go.cr or any CKAN/SICOP API endpoint
 * - Call api.hacienda.go.cr or any Hacienda CR endpoint
 * - Call Tavily, Apollo, Lusha, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Touch source_coverage_summaries
 * - Touch the wizard, contact enrichment, or HubSpot sync
 * - Validate cédula jurídica (not a fiscal/legal registry)
 * - Replace Hacienda CR as legal/tax registry
 * - Invent CIIU codes (official_ciiu_available is always false)
 * - Overwrite existing rd_dgii_bulk, rd_dgcp, pe_sunat_bulk, cl_chilecompra_ocds,
 *   mx_denue, or any other source_enrichment keys
 *
 * Semantic obligations (always enforced):
 *   source_type: 'procurement_signal'    — SICOP is commercial signal, NOT legal/tax
 *   legal_validation_status: 'not_applicable'
 *   tax_validation_status: 'not_applicable'
 *   official_ciiu_available: false
 *   ciiu_status: 'unavailable_for_mvp'
 *   human_review_required: true
 */

import {
  lookupCostaRicaSicopByCedula,
  normalizeCostaRicaCedulaForSicop,
  isLikelyCostaRicaLegalEntity,
  type CrSicopLookupResult,
} from '../services/cr-sicop-lookup';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CostaRicaSicopEnrichmentInput {
  candidateId?: string;
  accountId?: string;
  countryCode: string;
  taxId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SicopProcurementSummary {
  dataset: string;
  total_records_year: number | null;
  sample_records: unknown[];
}

/**
 * Enrichment block stored at metadata.source_enrichment.cr_sicop.
 *
 * Semantic rules (always enforced):
 * - source_type = 'procurement_signal'  — SICOP is NOT a legal/tax registry
 * - legal_validation_status = 'not_applicable'
 * - tax_validation_status = 'not_applicable'
 * - official_ciiu_available = false
 * - ciiu_status = 'unavailable_for_mvp'
 * - human_review_required = true
 */
export interface SicopEnrichmentBlock {
  source_key: 'cr_sicop';
  country_code: 'CR';
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
  procurement_summary: SicopProcurementSummary | null;
  reason: string | null;
  enriched_at: string;
}

export type CostaRicaSicopEnrichmentReason =
  | 'not_cr_country'
  | 'missing_legal_id'
  | 'non_company_identifier'
  | 'cedula_lookup_completed';

export interface CostaRicaSicopEnrichmentResult {
  enriched: boolean;
  countryCode: string;
  cedula: string | null;
  cr_sicop: SicopEnrichmentBlock | null;
  reason: CostaRicaSicopEnrichmentReason;
}

// ── Semantic guardrails constant ───────────────────────────────────────────────

const SEMANTIC_GUARDRAILS = {
  source_key: 'cr_sicop',
  country_code: 'CR',
  source_type: 'procurement_signal',
  legal_validation_status: 'not_applicable',
  tax_validation_status: 'not_applicable',
  official_ciiu_available: false,
  ciiu_status: 'unavailable_for_mvp',
  sector_source: 'procurement_category_or_not_official',
  human_review_required: true,
  snapshot_source: 'source_company_snapshots',
} as const;

// ── Cédula resolution ─────────────────────────────────────────────────────────

/**
 * Resolves cédula jurídica from input fields in priority order:
 *   1. input.taxId
 *   2. input.metadata.tax_id
 *   3. input.metadata.cedula
 */
export function resolveCedulaFromSicopInput(
  input: CostaRicaSicopEnrichmentInput,
): string | null {
  if (typeof input.taxId === 'string' && input.taxId.trim()) {
    return input.taxId.trim();
  }
  const meta = input.metadata;
  if (meta) {
    if (typeof meta.tax_id === 'string' && (meta.tax_id as string).trim()) {
      return (meta.tax_id as string).trim();
    }
    if (typeof meta.cedula === 'string' && (meta.cedula as string).trim()) {
      return (meta.cedula as string).trim();
    }
  }
  return null;
}

// ── Block builders ─────────────────────────────────────────────────────────────

function buildMatchedBlock(
  result: CrSicopLookupResult,
  enrichedAt: string,
): SicopEnrichmentBlock {
  const procurementSummary: SicopProcurementSummary = {
    dataset: 'ofertas_2024',
    total_records_year: result.total_records_year,
    sample_records: [],
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

function buildNotFoundBlock(enrichedAt: string): SicopEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'not_found',
    matched_by: null,
    confidence: 0,
    priority_boost: false,
    source_year: null,
    procurement_summary: null,
    reason: 'no_snapshot_match_by_cedula',
    enriched_at: enrichedAt,
  };
}

function buildSkippedBlock(
  reason: string,
  enrichedAt: string,
): SicopEnrichmentBlock {
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

function buildErrorBlock(reason: string, enrichedAt: string): SicopEnrichmentBlock {
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
 * Enriches a post-approval Costa Rica candidate with SICOP procurement signal.
 *
 * Behaviour by case:
 * - countryCode !== 'CR' → enriched=false, cr_sicop=null
 * - no cédula → skipped block with reason='missing_legal_id'
 * - cédula not a legal entity → skipped block with reason='non_company_identifier'
 * - cédula present → lookup local snapshot, build matched/not_found block
 * - error in lookup → error block, never throws
 *
 * Never calls datos.go.cr or Hacienda CR. Query is local source_company_snapshots only.
 *
 * @param lookupFn - Injected for testing; defaults to lookupCostaRicaSicopByCedula
 */
export async function enrichCostaRicaCandidateWithSicop(
  input: CostaRicaSicopEnrichmentInput,
  lookupFn: (
    input: { cedula: string },
    sb?: SupabaseClient,
  ) => Promise<CrSicopLookupResult> = lookupCostaRicaSicopByCedula,
): Promise<CostaRicaSicopEnrichmentResult> {
  const enrichedAt = new Date().toISOString();
  const countryCode = (input.countryCode ?? '').toUpperCase();

  if (countryCode !== 'CR') {
    return {
      enriched: false,
      countryCode: input.countryCode,
      cedula: null,
      cr_sicop: null,
      reason: 'not_cr_country',
    };
  }

  const rawCedula = resolveCedulaFromSicopInput(input);

  if (!rawCedula) {
    return {
      enriched: true,
      countryCode,
      cedula: null,
      cr_sicop: buildSkippedBlock('missing_legal_id', enrichedAt),
      reason: 'missing_legal_id',
    };
  }

  const normalizedCedula = normalizeCostaRicaCedulaForSicop(rawCedula);

  if (!isLikelyCostaRicaLegalEntity(normalizedCedula)) {
    return {
      enriched: true,
      countryCode,
      cedula: normalizedCedula,
      cr_sicop: buildSkippedBlock('non_company_identifier', enrichedAt),
      reason: 'non_company_identifier',
    };
  }

  try {
    const result = await lookupFn({ cedula: normalizedCedula });

    const block = result.matched
      ? buildMatchedBlock(result, enrichedAt)
      : buildNotFoundBlock(enrichedAt);

    return {
      enriched: true,
      countryCode,
      cedula: normalizedCedula,
      cr_sicop: block,
      reason: 'cedula_lookup_completed',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      enriched: true,
      countryCode,
      cedula: normalizedCedula,
      cr_sicop: buildErrorBlock(msg.slice(0, 200), enrichedAt),
      reason: 'cedula_lookup_completed',
    };
  }
}
