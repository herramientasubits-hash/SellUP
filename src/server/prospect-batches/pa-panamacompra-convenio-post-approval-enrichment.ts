/**
 * PanamaCompra Convenio Marco Post-Approval Enrichment — Centroamérica.5F
 *
 * Enriches a post-approval Panamá candidate with PanamaCompra Convenio Marco
 * procurement signal data from the local pa_panamacompra_convenio snapshot
 * in source_company_snapshots.
 * Called from the post-approval worker when country_code === 'PA'.
 *
 * GUARDRAILS — this module must NEVER:
 * - Be called for countries other than PA (enforced by guard)
 * - Call PanamaCompra API (listaProveedor, ObtenerInfoProveedor, ListarActosParametros, searchOrderList)
 * - Call DGI Panamá or any Hacienda Panamá endpoint
 * - Call Registro Público Panamá
 * - Call Tavily, Apollo, Lusha, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts (only update)
 * - Touch source_coverage_summaries
 * - Touch the wizard, contact enrichment, or HubSpot sync
 * - Validate RUC legally (not a fiscal/legal registry)
 * - Replace DGI Panamá as legal/tax registry
 * - Replace Registro Público Panamá
 * - Invent CIIU codes (official_ciiu_available is always false)
 * - Overwrite existing cr_sicop, rd_dgii_bulk, rd_dgcp, pe_sunat_bulk,
 *   cl_chilecompra_ocds, mx_denue, or any other source_enrichment keys
 *
 * Semantic obligations (always enforced):
 *   source_key: 'pa_panamacompra_convenio'
 *   source_type: 'procurement_signal'    — NOT legal/tax
 *   coverage_scope: 'convenio_marco'     — only Convenio Marco, not all contracting
 *   legal_validation_status: 'not_applicable'
 *   tax_validation_status: 'not_applicable'
 *   official_ciiu_available: false
 *   ciiu_status: 'unavailable_for_mvp'
 *   sector_source: 'not_provided_by_panamacompra'
 *   human_review_required: true
 */

import {
  lookupPanamaCompraConvenioByRuc,
  type PaPanamaCompraLookupResult,
  type PaPanamaCompraProcurementSummary,
} from '../services/pa-panamacompra-convenio-lookup';
import { normalizePanamaRuc } from '../source-catalog/connectors/panamacompra-pa/panamacompra-pa-normalizer';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PanamaCompraConvenioEnrichmentInput {
  candidateId?: string;
  accountId?: string;
  countryCode: string;
  taxId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Enrichment block stored at metadata.source_enrichment.pa_panamacompra_convenio.
 *
 * Semantic rules (always enforced):
 * - source_type = 'procurement_signal'  — NOT a legal/tax registry
 * - coverage_scope = 'convenio_marco'   — only Convenio Marco, not all contracting
 * - legal_validation_status = 'not_applicable'
 * - tax_validation_status = 'not_applicable'
 * - official_ciiu_available = false
 * - ciiu_status = 'unavailable_for_mvp'
 * - sector_source = 'not_provided_by_panamacompra'
 * - human_review_required = true
 */
export interface PanamaCompraConvenioEnrichmentBlock {
  source_key: 'pa_panamacompra_convenio';
  country_code: 'PA';
  source_type: 'procurement_signal';
  coverage_scope: 'convenio_marco';
  status: 'matched' | 'not_found' | 'skipped' | 'error';
  matched_by: 'tax_id' | null;
  confidence: number;
  legal_validation_status: 'not_applicable';
  tax_validation_status: 'not_applicable';
  official_ciiu_available: false;
  ciiu_status: 'unavailable_for_mvp';
  sector_source: 'not_provided_by_panamacompra';
  human_review_required: true;
  priority_boost: boolean;
  snapshot_source: 'source_company_snapshots';
  source_year: number | null;
  procurement_summary: PaPanamaCompraProcurementSummary | null;
  reason: string | null;
  enriched_at: string;
}

export type PanamaCompraConvenioEnrichmentReason =
  | 'not_pa_country'
  | 'missing_ruc'
  | 'ruc_lookup_completed';

export interface PanamaCompraConvenioEnrichmentResult {
  enriched: boolean;
  countryCode: string;
  ruc: string | null;
  pa_panamacompra_convenio: PanamaCompraConvenioEnrichmentBlock | null;
  reason: PanamaCompraConvenioEnrichmentReason;
}

// ── Semantic guardrails constant ───────────────────────────────────────────────

const SEMANTIC_GUARDRAILS = {
  source_key: 'pa_panamacompra_convenio',
  country_code: 'PA',
  source_type: 'procurement_signal',
  coverage_scope: 'convenio_marco',
  legal_validation_status: 'not_applicable',
  tax_validation_status: 'not_applicable',
  official_ciiu_available: false,
  ciiu_status: 'unavailable_for_mvp',
  sector_source: 'not_provided_by_panamacompra',
  human_review_required: true,
  snapshot_source: 'source_company_snapshots',
} as const;

// ── RUC resolution ─────────────────────────────────────────────────────────────

/**
 * Resolves RUC from input fields in priority order:
 *   1. input.taxId
 *   2. input.metadata.tax_id
 *   3. input.metadata.ruc
 */
export function resolveRucFromPanamaInput(
  input: PanamaCompraConvenioEnrichmentInput,
): string | null {
  if (typeof input.taxId === 'string' && input.taxId.trim()) {
    return input.taxId.trim();
  }
  const meta = input.metadata;
  if (meta) {
    if (typeof meta.tax_id === 'string' && (meta.tax_id as string).trim()) {
      return (meta.tax_id as string).trim();
    }
    if (typeof meta.ruc === 'string' && (meta.ruc as string).trim()) {
      return (meta.ruc as string).trim();
    }
  }
  return null;
}

// ── Block builders ─────────────────────────────────────────────────────────────

function buildMatchedBlock(
  result: PaPanamaCompraLookupResult,
  enrichedAt: string,
): PanamaCompraConvenioEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'matched',
    matched_by: 'tax_id',
    confidence: 1,
    priority_boost: true,
    source_year: result.source_year,
    procurement_summary: result.procurement_summary,
    reason: null,
    enriched_at: enrichedAt,
  };
}

function buildNotFoundBlock(enrichedAt: string): PanamaCompraConvenioEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'not_found',
    matched_by: null,
    confidence: 0,
    priority_boost: false,
    source_year: null,
    procurement_summary: null,
    reason: 'no_snapshot_match_by_ruc',
    enriched_at: enrichedAt,
  };
}

function buildSkippedBlock(
  reason: string,
  enrichedAt: string,
): PanamaCompraConvenioEnrichmentBlock {
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

function buildErrorBlock(
  reason: string,
  enrichedAt: string,
): PanamaCompraConvenioEnrichmentBlock {
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
 * Enriches a post-approval Panamá candidate with PanamaCompra Convenio Marco
 * procurement signal.
 *
 * Behaviour by case:
 * - countryCode !== 'PA' → enriched=false, pa_panamacompra_convenio=null
 * - no RUC → skipped block with reason='missing_ruc'
 * - RUC present → lookup local snapshot, build matched/not_found block
 * - error in lookup → error block, never throws
 *
 * Never calls PanamaCompra API, DGI Panamá, or Registro Público.
 * Query is local source_company_snapshots only.
 *
 * @param lookupFn - Injected for testing; defaults to lookupPanamaCompraConvenioByRuc
 */
export async function runPanamaCompraConvenioEnrichmentForCandidate(
  input: PanamaCompraConvenioEnrichmentInput,
  lookupFn: (
    input: { ruc: string },
    sb?: SupabaseClient,
  ) => Promise<PaPanamaCompraLookupResult> = lookupPanamaCompraConvenioByRuc,
): Promise<PanamaCompraConvenioEnrichmentResult> {
  const enrichedAt = new Date().toISOString();
  const countryCode = (input.countryCode ?? '').toUpperCase();

  if (countryCode !== 'PA') {
    return {
      enriched: false,
      countryCode: input.countryCode,
      ruc: null,
      pa_panamacompra_convenio: null,
      reason: 'not_pa_country',
    };
  }

  const rawRuc = resolveRucFromPanamaInput(input);

  if (!rawRuc) {
    return {
      enriched: true,
      countryCode,
      ruc: null,
      pa_panamacompra_convenio: buildSkippedBlock('missing_ruc', enrichedAt),
      reason: 'missing_ruc',
    };
  }

  // Normalize RUC — does NOT validate legally
  const rucResult = normalizePanamaRuc(rawRuc);
  const normalizedRuc = rucResult.valid ? rucResult.normalized : rawRuc.trim();

  try {
    const result = await lookupFn({ ruc: normalizedRuc });

    const block = result.matched
      ? buildMatchedBlock(result, enrichedAt)
      : buildNotFoundBlock(enrichedAt);

    return {
      enriched: true,
      countryCode,
      ruc: normalizedRuc,
      pa_panamacompra_convenio: block,
      reason: 'ruc_lookup_completed',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      enriched: true,
      countryCode,
      ruc: normalizedRuc,
      pa_panamacompra_convenio: buildErrorBlock(msg.slice(0, 200), enrichedAt),
      reason: 'ruc_lookup_completed',
    };
  }
}
