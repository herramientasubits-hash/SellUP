/**
 * lusha-phone-fallback-usage-log-draft.ts — Pure metadata builder for the
 * FUTURE Lusha phone reveal fallback usage log (Agente 2A ·
 * LUSHA-PHONE-FALLBACK-1S).
 *
 * DRAFT ONLY: nothing here calls logProviderUsage() (src/modules/usage-tracking
 * /logging.ts) or writes to provider_usage_logs. No caller in this milestone
 * invokes this module. It exists so a future, explicitly authorized live
 * wiring reuses an already-reviewed, PII-free metadata shape instead of
 * improvising one under time pressure.
 *
 * operation_key/provider_key are DISTINCT from Apollo's
 * PHONE_REVEAL_OPERATION_KEY ('person_phone_reveal') / provider 'apollo' in
 * phone-reveal-core.ts — this is a separate operation, not a rename.
 *
 * Metadata is PII-free by contract: no phone, no email, no LinkedIn, no full
 * provider id, no raw provider payload. candidateId is SellUp's own internal
 * row id, never a Lusha contact id.
 */

import type { LushaPhoneFallbackCostSource } from '@/server/integrations/lusha-phone-fallback-response';

/** operation_key for this fallback in provider_usage_logs (draft only). */
export const LUSHA_PHONE_FALLBACK_OPERATION_KEY = 'lusha_person_phone_reveal' as const;

/** provider_key for this fallback in provider_usage_logs (draft only). */
export const LUSHA_PHONE_FALLBACK_PROVIDER_KEY = 'lusha' as const;

export type LushaPhoneFallbackRevealPhase = 'direct_enrich' | 'search_then_enrich';

export interface LushaPhoneFallbackUsageLogMetadataDraftInput {
  candidateId: string;
  actorRole: string;
  costSource: LushaPhoneFallbackCostSource;
  revealPhase: LushaPhoneFallbackRevealPhase;
  /**
   * `phone_reveal_waterfall_runs.id` when this reveal is the SECOND leg of an
   * Apollo → Lusha waterfall (AGENT2A-PHONE-WATERFALL-1). It is SellUp's own row
   * id — a correlation handle, never a provider id and never PII — and it is what
   * lets the Apollo leg's log and this Lusha leg's log be read as one authorized
   * action while their credits stay in SEPARATE rows (they are never summed).
   *
   * Optional and omitted entirely when absent, so the manual, non-waterfall
   * fallback keeps producing byte-for-byte the same metadata as before.
   */
  phoneRevealWaterfallId?: string | null;
}

/** Whitelisted, PII-free metadata shape — see module doc for what is excluded. */
export interface LushaPhoneFallbackUsageLogMetadataDraft {
  candidate_id: string;
  actor_role: string;
  phone_source: 'lusha_reveal';
  confirm_cost: true;
  cost_source: LushaPhoneFallbackCostSource;
  reveal_phase: LushaPhoneFallbackRevealPhase;
  /** Present ONLY for a waterfall second leg. See input doc above. */
  phone_reveal_waterfall_id?: string;
}

function cleanId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pure builder — no DB call, no network call. Only assembles the whitelisted
 * metadata object; a future live implementation is responsible for actually
 * calling logProviderUsage() with this shape.
 */
export function buildLushaPhoneFallbackUsageLogMetadataDraft(
  input: LushaPhoneFallbackUsageLogMetadataDraftInput,
): LushaPhoneFallbackUsageLogMetadataDraft {
  const waterfallId = cleanId(input.phoneRevealWaterfallId);
  return {
    candidate_id: input.candidateId,
    actor_role: input.actorRole,
    phone_source: 'lusha_reveal',
    confirm_cost: true,
    cost_source: input.costSource,
    reveal_phase: input.revealPhase,
    // Key omitted (not set to null/undefined) when there is no waterfall, so the
    // manual fallback's metadata shape stays exactly as it was.
    ...(waterfallId ? { phone_reveal_waterfall_id: waterfallId } : {}),
  };
}
