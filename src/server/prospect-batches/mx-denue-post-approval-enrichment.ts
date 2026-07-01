/**
 * DENUE México Post-Approval Enrichment — México.2B
 *
 * Enriches a post-approval Mexico candidate with DENUE/INEGI API data.
 * Called from the post-approval worker when country_code === 'MX'.
 *
 * GUARDRAILS — this module must NEVER:
 * - Be called for countries other than MX (enforced by guard)
 * - Call SAT, IMSS, ISSSTE, or any Mexican fiscal/government API
 * - Validate RFC — DENUE does not contain RFC
 * - Invent CIIU codes — DENUE activity is free text, not CIIU
 * - Call Tavily, Apollo, Lusha, Migo, LLM, or any third-party service
 * - Insert into prospect_candidates, prospect_batches, or accounts directly
 * - Touch the wizard, contact enrichment, or HubSpot sync
 * - Set legal_validation_status to 'matched' or 'validated'
 * - Set tax_validation_status to 'matched' or 'validated'
 */

import { denueEnrichmentAdapter } from '../source-catalog/connectors/denue-mexico/denue-enrichment-adapter';
import type { SourceEnrichmentOutput } from '../source-catalog/enrichment/types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MxDenueEnrichmentInput {
  candidateId?: string;
  countryCode: string;
  candidateName: string;
  metadata?: Record<string, unknown>;
}

/**
 * Enrichment block stored at metadata.source_enrichment.mx_denue.
 *
 * Semantic rules (always enforced):
 * - source_type = 'official_business_directory' (DENUE is a business directory, not a fiscal registry)
 * - legal_validation_status = 'not_applicable' (DENUE cannot validate legal entity)
 * - tax_validation_status = 'not_applicable' (DENUE cannot validate RFC)
 * - official_ciiu_available = false (DENUE uses SCIAN, not CIIU)
 * - ciiu_status = 'unavailable_for_mvp'
 * - economic_activity_source = 'denue'
 * - sector_source = 'denue_activity_text'
 * - human_review_required = true (always — RFC resolution requires human review)
 */
export interface MxDenueEnrichmentBlock {
  status: 'matched' | 'ambiguous' | 'not_found' | 'skipped' | 'error';
  matched_by: string | null;
  confidence: number;
  source_key: 'mx_denue';
  country_code: 'MX';
  // Semantic guardrails
  source_type: 'official_business_directory';
  legal_validation_status: 'not_applicable';
  tax_validation_status: 'not_applicable';
  official_ciiu_available: false;
  ciiu_status: 'unavailable_for_mvp';
  economic_activity_source: 'denue';
  sector_source: 'denue_activity_text';
  human_review_required: true;
  // Adapter output (raw DENUE metadata)
  denue_metadata: Record<string, unknown> | null;
  reason: string | null;
  enriched_at: string;
}

export type MxDenueEnrichmentReason =
  | 'not_mx_country'
  | 'missing_candidate_name'
  | 'name_lookup_completed'
  | 'denue_error';

export interface MxDenueEnrichmentResult {
  enriched: boolean;
  countryCode: string;
  mx_denue: MxDenueEnrichmentBlock | null;
  reason: MxDenueEnrichmentReason;
}

/** Adapter fn type — injectable for tests */
export type DenueAdapterFn = (
  input: Parameters<typeof denueEnrichmentAdapter.enrichCandidate>[0],
) => Promise<SourceEnrichmentOutput>;

// ── Semantic guardrails constant ───────────────────────────────────────────────

const SEMANTIC_GUARDRAILS = {
  source_key: 'mx_denue',
  country_code: 'MX',
  source_type: 'official_business_directory',
  legal_validation_status: 'not_applicable',
  tax_validation_status: 'not_applicable',
  official_ciiu_available: false,
  ciiu_status: 'unavailable_for_mvp',
  economic_activity_source: 'denue',
  sector_source: 'denue_activity_text',
  human_review_required: true,
} as const;

// ── Block builders ─────────────────────────────────────────────────────────────

function buildBlockFromAdapterOutput(
  output: SourceEnrichmentOutput,
  enrichedAt: string,
): MxDenueEnrichmentBlock {
  const adapterMeta = output.metadata as Record<string, unknown> | undefined;
  // The DENUE adapter always returns status='matched' for both matched/ambiguous;
  // the true status lives in metadata.status.
  const metaStatus = typeof adapterMeta?.status === 'string' ? adapterMeta.status : null;
  const status =
    metaStatus === 'ambiguous' ? 'ambiguous'
    : metaStatus === 'matched' || output.status === 'matched' ? 'matched'
    : output.status === 'no_match' ? 'not_found'
    : output.status === 'skipped' ? 'skipped'
    : output.status === 'error' ? 'error'
    : 'not_found';

  const matchedBy =
    output.matchedBy ??
    (typeof adapterMeta?.matched_by === 'string' ? adapterMeta.matched_by : null);

  return {
    ...SEMANTIC_GUARDRAILS,
    status,
    matched_by: matchedBy,
    confidence: output.confidence ?? 0,
    denue_metadata: adapterMeta ?? null,
    reason: output.reason ?? null,
    enriched_at: enrichedAt,
  };
}

function buildSkippedBlock(reason: string, enrichedAt: string): MxDenueEnrichmentBlock {
  return {
    ...SEMANTIC_GUARDRAILS,
    status: 'skipped',
    matched_by: null,
    confidence: 0,
    denue_metadata: null,
    reason,
    enriched_at: enrichedAt,
  };
}

// ── Main enrichment function ───────────────────────────────────────────────────

/**
 * Enriches a post-approval Mexico candidate using the DENUE live API via the existing adapter.
 *
 * Behaviour by case:
 * - countryCode !== 'MX' → enriched=false, mx_denue=null
 * - missing/empty candidateName → skipped block with reason='missing_candidate_name'
 * - name present → DENUE API call (live, controlled), build matched/ambiguous/not_found block
 * - unexpected error → error block, never throws
 *
 * @param adapterFn - Injected for testing; defaults to denueEnrichmentAdapter.enrichCandidate
 */
export async function enrichMexicoCandidateWithDenue(
  input: MxDenueEnrichmentInput,
  adapterFn: DenueAdapterFn = denueEnrichmentAdapter.enrichCandidate.bind(denueEnrichmentAdapter),
): Promise<MxDenueEnrichmentResult> {
  const enrichedAt = new Date().toISOString();
  const countryCode = (input.countryCode ?? '').toUpperCase();

  if (countryCode !== 'MX') {
    return {
      enriched: false,
      countryCode: input.countryCode,
      mx_denue: null,
      reason: 'not_mx_country',
    };
  }

  const name = (input.candidateName ?? '').trim();
  if (!name) {
    return {
      enriched: true,
      countryCode,
      mx_denue: buildSkippedBlock('missing_candidate_name', enrichedAt),
      reason: 'missing_candidate_name',
    };
  }

  try {
    const output = await adapterFn({
      candidateName: name,
      candidateTaxId: null,
      countryCode: 'MX',
      sector: null,
      existingMetadata: input.metadata ?? {},
      capability: 'enrichment_after_discovery',
    });

    return {
      enriched: true,
      countryCode,
      mx_denue: buildBlockFromAdapterOutput(output, enrichedAt),
      reason: 'name_lookup_completed',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      enriched: true,
      countryCode,
      mx_denue: {
        ...SEMANTIC_GUARDRAILS,
        status: 'error',
        matched_by: null,
        confidence: 0,
        denue_metadata: null,
        reason: msg.slice(0, 200),
        enriched_at: enrichedAt,
      },
      reason: 'denue_error',
    };
  }
}
