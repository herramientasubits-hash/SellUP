/**
 * ChileCompra OCDS Post-Approval Enrichment — v1.16CL-E
 *
 * Enriches a post-approval Chile candidate with ChileCompra OCDS snapshot data.
 * Called from the post-approval worker when country_code === 'CL'.
 *
 * GUARDRAILS — this module must NEVER:
 * - Be called for countries other than CL (enforced by guard)
 * - Call any ChileCompra / Mercado Público API endpoint
 * - Call Tavily, Apollo, Lusha, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Touch the wizard, contact enrichment, or HubSpot sync
 * - Modify tsconfig.json or package.json
 */

import {
  lookupChileCompraOcdsByRut,
  type ChileCompraOcdsLookupResult,
} from '../services/chilecompra-ocds-lookup';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChileEnrichmentInput {
  candidateId?: string;
  accountId?: string;
  countryCode: string;
  taxId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ChileCompraOcdsEnrichmentBlock {
  status: 'matched' | 'no_match' | 'error';
  matched_by: 'tax_id' | null;
  confidence: number;
  source_year: number | null;
  source: 'source_company_snapshots';
  signals: Record<string, unknown>;
  priority_boost: number;
  reason: string | null;
  enriched_at: string;
  // Semantic guardrails — ChileCompra is procurement evidence, not legal validation
  source_key: 'cl_chilecompra_ocds';
  country_code: 'CL';
  source_type: 'procurement_signal';
  legal_validation_status: 'not_applicable';
  official_ciiu_available: false;
  ciiu_status: 'unavailable_for_mvp';
  sector_source: 'not_official_legal_source';
  human_review_required: true;
}

export type ChileEnrichmentReason =
  | 'not_cl_country'
  | 'missing_tax_id'
  | 'rut_lookup_completed';

export interface ChileEnrichmentResult {
  enriched: boolean;
  countryCode: string;
  rut: string | null;
  cl_chilecompra_ocds: ChileCompraOcdsEnrichmentBlock | null;
  reason: ChileEnrichmentReason;
}

// ── RUT resolution ─────────────────────────────────────────────────────────────

/**
 * Resolves RUT from input fields in priority order:
 *   1. input.taxId
 *   2. input.metadata.tax_id
 *   3. input.metadata.rut
 */
export function resolveRutFromInput(input: ChileEnrichmentInput): string | null {
  if (typeof input.taxId === 'string' && input.taxId.trim()) {
    return input.taxId.trim();
  }
  const meta = input.metadata;
  if (meta) {
    if (typeof meta.tax_id === 'string' && (meta.tax_id as string).trim()) {
      return (meta.tax_id as string).trim();
    }
    if (typeof meta.rut === 'string' && (meta.rut as string).trim()) {
      return (meta.rut as string).trim();
    }
  }
  return null;
}

// ── Priority boost derivation ──────────────────────────────────────────────────

/**
 * Derives a priority_boost integer from priority_score.
 * priority_score is a float in [0,1] from the ETL; we map to [0,3].
 */
export function derivePriorityBoost(priorityScore: number | null): number {
  if (priorityScore == null || !Number.isFinite(priorityScore)) return 0;
  if (priorityScore >= 0.8) return 3;
  if (priorityScore >= 0.5) return 2;
  if (priorityScore > 0) return 1;
  return 0;
}

// ── Block builders ─────────────────────────────────────────────────────────────

const SEMANTIC_GUARDRAILS = {
  source_key: 'cl_chilecompra_ocds',
  country_code: 'CL',
  source_type: 'procurement_signal',
  legal_validation_status: 'not_applicable',
  official_ciiu_available: false,
  ciiu_status: 'unavailable_for_mvp',
  sector_source: 'not_official_legal_source',
  human_review_required: true,
} as const;

function buildMatchBlock(
  result: ChileCompraOcdsLookupResult,
  enrichedAt: string,
): ChileCompraOcdsEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'matched',
    matched_by: 'tax_id',
    confidence: 1,
    source_year: result.source_year,
    source: 'source_company_snapshots',
    signals: result.signals ? (result.signals as unknown as Record<string, unknown>) : {},
    priority_boost: derivePriorityBoost(result.priority_score),
    reason: null,
    enriched_at: enrichedAt,
  };
}

function buildNoMatchBlock(
  reason: string,
  sourceYear: number | null,
  enrichedAt: string,
): ChileCompraOcdsEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'no_match',
    matched_by: null,
    confidence: 0,
    source_year: sourceYear,
    source: 'source_company_snapshots',
    signals: {},
    priority_boost: 0,
    reason,
    enriched_at: enrichedAt,
  };
}

function buildErrorBlock(reason: string, enrichedAt: string): ChileCompraOcdsEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'error',
    matched_by: null,
    confidence: 0,
    source_year: null,
    source: 'source_company_snapshots',
    signals: {},
    priority_boost: 0,
    reason,
    enriched_at: enrichedAt,
  };
}

// ── Main enrichment function ───────────────────────────────────────────────────

/**
 * Enriches a post-approval Chile candidate from ChileCompra OCDS snapshot.
 *
 * Behaviour by case:
 * - countryCode !== 'CL' → enriched=false, cl_chilecompra_ocds=null
 * - no RUT → no_match block with reason='missing_tax_id'
 * - RUT present → lookup snapshot, build matched/no_match block
 * - error in lookup → error block, never throws
 *
 * @param lookupFn - Injected for testing; defaults to lookupChileCompraOcdsByRut
 */
export async function enrichChileCandidateWithChileCompraOcds(
  input: ChileEnrichmentInput,
  lookupFn: (
    input: { rut: string; year?: number },
    sb?: SupabaseClient,
  ) => Promise<ChileCompraOcdsLookupResult> = lookupChileCompraOcdsByRut,
): Promise<ChileEnrichmentResult> {
  const enrichedAt = new Date().toISOString();
  const countryCode = (input.countryCode ?? '').toUpperCase();

  if (countryCode !== 'CL') {
    return {
      enriched: false,
      countryCode: input.countryCode,
      rut: null,
      cl_chilecompra_ocds: null,
      reason: 'not_cl_country',
    };
  }

  const rut = resolveRutFromInput(input);

  if (!rut) {
    return {
      enriched: true,
      countryCode,
      rut: null,
      cl_chilecompra_ocds: buildNoMatchBlock('missing_tax_id', null, enrichedAt),
      reason: 'missing_tax_id',
    };
  }

  try {
    const result = await lookupFn({ rut });

    const block = result.matched
      ? buildMatchBlock(result, enrichedAt)
      : buildNoMatchBlock(result.reason ?? 'no_snapshot_match_by_rut', result.source_year, enrichedAt);

    return {
      enriched: true,
      countryCode,
      rut,
      cl_chilecompra_ocds: block,
      reason: 'rut_lookup_completed',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      enriched: true,
      countryCode,
      rut,
      cl_chilecompra_ocds: buildErrorBlock(msg.slice(0, 200), enrichedAt),
      reason: 'rut_lookup_completed',
    };
  }
}
