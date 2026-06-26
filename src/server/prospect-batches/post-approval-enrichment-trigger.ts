/**
 * Post-Approval Source Enrichment Trigger — v1.16K-D
 *
 * Called after a candidate is converted to account.
 * NIT-first strategy: only queues enrichment when tax_id is present.
 * Does NOT call LinkedIn, Tavily, LLM, or any name-based fuzzy matching.
 *
 * The trigger is non-blocking: it is wrapped in try-catch and must never
 * cause the approval to fail or surface errors to the user.
 *
 * Gap note: the actual adapter execution (via prospect_enrichment_jobs or a
 * separate source-enrichment cron) is out of scope for v1.16K-D. This module
 * records the enrichment intent in metadata so a future hito can pick it up.
 * The job-creation path was evaluated but skipped: the existing enrichment
 * worker calls enrichProspectCandidate (LLM), which is not the right executor
 * for NIT-adapter enrichment. A dedicated cron/worker is the correct follow-up.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PostApprovalEnrichmentMeta {
  requested: boolean;
  strategy: 'nit_first';
  trigger: 'candidate_approval';
  account_id: string;
  status: 'queued' | 'skipped' | 'trigger_failed';
  reason?: 'missing_tax_id' | 'country_not_supported_for_post_approval_source_enrichment';
  /** co_siis supports name fallback at ~0.60 confidence, but not auto-activated */
  name_fallback_available?: boolean;
  source_keys?: string[];
  nit?: string;
  error?: string;
  triggered_at: string;
}

export interface TriggerPostApprovalEnrichmentParams {
  /** Original candidate row as fetched from DB before approval */
  candidate: Record<string, unknown>;
  candidateId: string;
  batchId: string;
  accountId: string;
  internalUserId: string;
  supabase: SupabaseClient;
}

export interface TriggerPostApprovalEnrichmentResult {
  triggered: boolean;
  meta: PostApprovalEnrichmentMeta;
}

// ── Colombia NIT-safe sources ─────────────────────────────────────────────────

/**
 * Colombia source keys that require exact NIT match.
 * co_siis also listed: it has a snapshot requirement + name fallback, but
 * for post-approval NIT path, it is safe to plan for it.
 */
const CO_NIT_SAFE_SOURCE_KEYS: readonly string[] = [
  'co_personas_juridicas_cc',
  'co_secop2_proveedores',
  'co_minsalud_reps',
  'co_superfinanciera',
  'co_siis',
] as const;

// ── NIT extraction ────────────────────────────────────────────────────────────

/**
 * Extracts NIT / tax_id from a candidate row, checking all known locations.
 * Returns null if not found — never guesses or fuzzy-matches.
 */
export function extractNitFromCandidate(
  candidate: Record<string, unknown>,
): string | null {
  // Direct root fields
  if (typeof candidate.tax_id === 'string' && candidate.tax_id.trim()) {
    return candidate.tax_id.trim();
  }
  if (
    typeof candidate.tax_identifier === 'string' &&
    candidate.tax_identifier.trim()
  ) {
    return candidate.tax_identifier.trim();
  }

  // metadata.tax_id
  const meta = candidate.metadata as Record<string, unknown> | null | undefined;
  if (meta) {
    if (typeof meta.tax_id === 'string' && meta.tax_id.trim()) {
      return meta.tax_id.trim();
    }
    // metadata.rich_profile.tax_id
    const richProfile = meta.rich_profile as
      | Record<string, unknown>
      | null
      | undefined;
    if (
      richProfile &&
      typeof richProfile.tax_id === 'string' &&
      richProfile.tax_id.trim()
    ) {
      return richProfile.tax_id.trim();
    }
  }

  return null;
}

/**
 * Returns the planned NIT-safe Colombia source keys for post-approval enrichment.
 */
export function planNitFirstSourceKeys(): string[] {
  return [...CO_NIT_SAFE_SOURCE_KEYS];
}

// ── Main trigger ──────────────────────────────────────────────────────────────

/**
 * Records enrichment intent in candidate metadata after approval.
 * With NIT → status='queued', source_keys planned.
 * Without NIT → status='skipped', reason='missing_tax_id'.
 * On internal error → status='trigger_failed', approval is not affected.
 */
export async function triggerPostApprovalEnrichment(
  params: TriggerPostApprovalEnrichmentParams,
): Promise<TriggerPostApprovalEnrichmentResult> {
  const { candidate, candidateId, batchId, accountId, internalUserId, supabase } =
    params;
  const triggeredAt = new Date().toISOString();

  // Country guard: CO-only sources (co_siis, co_superfinanciera, etc.) must not
  // be queued for non-CO candidates.
  const candidateCountryCode = typeof candidate.country_code === 'string'
    ? candidate.country_code.toUpperCase()
    : null;

  if (candidateCountryCode !== 'CO') {
    const skippedMeta: PostApprovalEnrichmentMeta = {
      requested: false,
      strategy: 'nit_first',
      trigger: 'candidate_approval',
      account_id: accountId,
      status: 'skipped',
      reason: 'country_not_supported_for_post_approval_source_enrichment',
      triggered_at: triggeredAt,
    };
    return { triggered: false, meta: skippedMeta };
  }

  try {
    const nit = extractNitFromCandidate(candidate);

    let enrichMeta: PostApprovalEnrichmentMeta;

    if (nit) {
      enrichMeta = {
        requested: true,
        strategy: 'nit_first',
        trigger: 'candidate_approval',
        account_id: accountId,
        status: 'queued',
        nit,
        source_keys: planNitFirstSourceKeys(),
        triggered_at: triggeredAt,
      };
    } else {
      enrichMeta = {
        requested: false,
        strategy: 'nit_first',
        trigger: 'candidate_approval',
        account_id: accountId,
        status: 'skipped',
        reason: 'missing_tax_id',
        // co_siis supports name fallback (~0.60 confidence) but NOT auto-activated
        name_fallback_available: true,
        triggered_at: triggeredAt,
      };
    }

    // Re-fetch current metadata (post-approval write already committed) to avoid
    // overwriting the approval + hubspot_sync blocks written moments before.
    const { data: current } = await supabase
      .from('prospect_candidates')
      .select('metadata')
      .eq('id', candidateId)
      .single();

    const currentMeta = (current?.metadata as Record<string, unknown> | null) ?? {};

    await supabase
      .from('prospect_candidates')
      .update({
        metadata: { ...currentMeta, post_approval_enrichment: enrichMeta },
        updated_at: triggeredAt,
      })
      .eq('id', candidateId);

    // Audit — uses candidate_updated (existing DB constraint) with sub_action detail
    await supabase.from('prospect_candidate_audit').insert({
      batch_id: batchId,
      candidate_id: candidateId,
      actor_user_id: internalUserId,
      action_type: 'candidate_updated',
      details: {
        sub_action: nit
          ? 'post_approval_enrichment_queued'
          : 'post_approval_enrichment_skipped',
        account_id: accountId,
        strategy: 'nit_first',
        status: enrichMeta.status,
        ...(nit
          ? { nit_present: true, source_keys: enrichMeta.source_keys }
          : { reason: 'missing_tax_id' }),
      },
    });

    return { triggered: nit !== null, meta: enrichMeta };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(
      '[PostApprovalEnrichmentTrigger] Non-critical trigger error:',
      error,
    );

    // Best-effort: record trigger_failed in metadata
    try {
      const { data: current } = await supabase
        .from('prospect_candidates')
        .select('metadata')
        .eq('id', candidateId)
        .single();

      const currentMeta =
        (current?.metadata as Record<string, unknown> | null) ?? {};
      const failedMeta: PostApprovalEnrichmentMeta = {
        requested: false,
        strategy: 'nit_first',
        trigger: 'candidate_approval',
        account_id: accountId,
        status: 'trigger_failed',
        error: error.slice(0, 200),
        triggered_at: triggeredAt,
      };

      await supabase
        .from('prospect_candidates')
        .update({
          metadata: { ...currentMeta, post_approval_enrichment: failedMeta },
        })
        .eq('id', candidateId);

      await supabase.from('prospect_candidate_audit').insert({
        batch_id: batchId,
        candidate_id: candidateId,
        actor_user_id: internalUserId,
        action_type: 'candidate_updated',
        details: {
          sub_action: 'post_approval_enrichment_trigger_failed',
          account_id: accountId,
          error: error.slice(0, 200),
        },
      });
    } catch {
      // Inner failure is also non-critical
    }

    return {
      triggered: false,
      meta: {
        requested: false,
        strategy: 'nit_first',
        trigger: 'candidate_approval',
        account_id: accountId,
        status: 'trigger_failed',
        error: error.slice(0, 200),
        triggered_at: triggeredAt,
      },
    };
  }
}
