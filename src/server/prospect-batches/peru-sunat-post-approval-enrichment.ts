/**
 * Perú SUNAT Post-Approval Legal Enrichment — Perú.5C
 *
 * Enriches a post-approval Peru candidate with SUNAT snapshot legal data.
 * Called from the post-approval NIT enrichment worker when country_code === 'PE'.
 *
 * GUARDRAILS — this module must NEVER:
 * - Be called for countries other than PE (enforced by guard in enrichment fn)
 * - Download padron_reducido_ruc.zip
 * - Read from .tmp/sunat-peru/ filesystem paths
 * - Call SUNAT API directly (no fetch('http://www2.sunat...'))
 * - Call Migo API (no MIGO_API_KEY usage)
 * - Call Tavily or any web search API
 * - Insert into prospect_candidates or prospect_batches
 * - Mark sector as official CIIU (confidence_label is always 'sector_inferred')
 * - Set official_ciiu_available to true
 *
 * All reads come from the pre-loaded Supabase snapshot only.
 * See docs/PERU_MVP_ACTIVATION_PLAN.md §2.4, §7, §9.
 */

import {
  lookupPeruSunatByRuc,
  type PeruSunatLegalLookupResult,
} from '../services/peru-sunat-legal-lookup';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PeruSunatEnrichmentInput {
  candidateId?: string;
  accountId?: string;
  countryCode: string;
  /** Direct RUC field */
  ruc?: string | null;
  /** tax_id or tax_identifier column from prospect_candidates */
  taxId?: string | null;
  legalName?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Stored at metadata.source_enrichment.pe_sunat_bulk after enrichment.
 * Always includes Peru sector invariants (sector is inferred, never CIIU).
 */
export interface PeruSunatEnrichmentBlock {
  legal_validation_status: string;
  legal_validation_reason: string;
  ruc: string | null;
  legal_name: string | null;
  taxpayer_status: string | null;
  domicile_condition: string | null;
  ubigeo: string | null;
  is_active: boolean | null;
  is_habido: boolean | null;
  source_key: 'pe_sunat_bulk';
  enriched_at: string;
  // Peru sector invariants — sector is always inferred, never CIIU official
  sector_source: 'inferred_web_ai';
  confidence_label: 'sector_inferred';
  ciiu_status: 'unavailable_for_mvp';
  official_ciiu_available: false;
  human_review_required: true;
}

export type PeruSunatEnrichmentReason =
  | 'not_pe_country'
  | 'no_ruc'
  | 'ruc_lookup_completed';

export interface PeruSunatEnrichmentResult {
  enriched: boolean;
  countryCode: string;
  ruc: string | null;
  /** pe_sunat_bulk block to merge into metadata.source_enrichment — null for non-PE */
  pe_sunat_bulk: PeruSunatEnrichmentBlock | null;
  reason: PeruSunatEnrichmentReason;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Invariants present in every Peru enrichment block. Sector is never CIIU. */
const PE_SECTOR_INVARIANTS = {
  sector_source: 'inferred_web_ai' as const,
  confidence_label: 'sector_inferred' as const,
  ciiu_status: 'unavailable_for_mvp' as const,
  official_ciiu_available: false as const,
  human_review_required: true as const,
};

// ── RUC resolution ─────────────────────────────────────────────────────────────

/**
 * Resolves RUC from enrichment input, checking fields in priority order:
 *   1. input.ruc
 *   2. input.taxId  (maps to tax_id / tax_identifier column)
 *   3. input.metadata.ruc
 *   4. input.metadata.tax_id
 *
 * Never guesses or infers from legal name. Returns null if no RUC found.
 */
export function resolveRucFromInput(input: PeruSunatEnrichmentInput): string | null {
  if (typeof input.ruc === 'string' && input.ruc.trim()) {
    return input.ruc.trim();
  }
  if (typeof input.taxId === 'string' && input.taxId.trim()) {
    return input.taxId.trim();
  }
  const meta = input.metadata;
  if (meta) {
    if (typeof meta.ruc === 'string' && (meta.ruc as string).trim()) {
      return (meta.ruc as string).trim();
    }
    if (typeof meta.tax_id === 'string' && (meta.tax_id as string).trim()) {
      return (meta.tax_id as string).trim();
    }
  }
  return null;
}

// ── Block builders ─────────────────────────────────────────────────────────────

function buildMissingRucBlock(enrichedAt: string): PeruSunatEnrichmentBlock {
  return {
    legal_validation_status: 'pending_snapshot_validation',
    legal_validation_reason: 'missing_ruc',
    ruc: null,
    legal_name: null,
    taxpayer_status: null,
    domicile_condition: null,
    ubigeo: null,
    is_active: null,
    is_habido: null,
    source_key: 'pe_sunat_bulk',
    enriched_at: enrichedAt,
    ...PE_SECTOR_INVARIANTS,
  };
}

function buildFromLookupResult(
  result: PeruSunatLegalLookupResult,
  enrichedAt: string,
): PeruSunatEnrichmentBlock {
  return {
    legal_validation_status: result.status,
    legal_validation_reason: result.reason,
    ruc: result.ruc,
    legal_name: result.legalName,
    taxpayer_status: result.taxpayerStatus,
    domicile_condition: result.domicileCondition,
    ubigeo: result.ubigeo,
    is_active: result.isActive,
    is_habido: result.isHabido,
    source_key: 'pe_sunat_bulk',
    enriched_at: enrichedAt,
    ...PE_SECTOR_INVARIANTS,
  };
}

// ── Main enrichment function ───────────────────────────────────────────────────

/**
 * Enriches a post-approval Peru candidate with SUNAT snapshot legal data.
 *
 * Behaviour by case:
 * - countryCode !== 'PE' → enriched=false, reason='not_pe_country', pe_sunat_bulk=null
 * - countryCode === 'PE', no RUC → pending_snapshot_validation + missing_ruc
 * - countryCode === 'PE', RUC present → calls lookupFn, maps result to enrichment block
 *
 * The returned pe_sunat_bulk block is meant to be stored at:
 *   metadata.source_enrichment.pe_sunat_bulk
 *
 * @param lookupFn - Injected for testing; defaults to lookupPeruSunatByRuc
 */
export async function enrichPeruCandidateWithSunatLegalLookup(
  input: PeruSunatEnrichmentInput,
  lookupFn: (ruc: string) => Promise<PeruSunatLegalLookupResult> = lookupPeruSunatByRuc,
): Promise<PeruSunatEnrichmentResult> {
  const enrichedAt = new Date().toISOString();
  const countryCode = (input.countryCode ?? '').toUpperCase();

  // Guard: no-op for non-Peru countries — NEVER consult SUNAT for CO/MX/CL/etc.
  if (countryCode !== 'PE') {
    return {
      enriched: false,
      countryCode: input.countryCode,
      ruc: null,
      pe_sunat_bulk: null,
      reason: 'not_pe_country',
    };
  }

  const ruc = resolveRucFromInput(input);

  if (!ruc) {
    return {
      enriched: true,
      countryCode,
      ruc: null,
      pe_sunat_bulk: buildMissingRucBlock(enrichedAt),
      reason: 'no_ruc',
    };
  }

  const lookupResult = await lookupFn(ruc);

  return {
    enriched: true,
    countryCode,
    ruc,
    pe_sunat_bulk: buildFromLookupResult(lookupResult, enrichedAt),
    reason: 'ruc_lookup_completed',
  };
}
