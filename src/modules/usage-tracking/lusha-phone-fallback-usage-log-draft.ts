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
}

/** Whitelisted, PII-free metadata shape — see module doc for what is excluded. */
export interface LushaPhoneFallbackUsageLogMetadataDraft {
  candidate_id: string;
  actor_role: string;
  phone_source: 'lusha_reveal';
  confirm_cost: true;
  cost_source: LushaPhoneFallbackCostSource;
  reveal_phase: LushaPhoneFallbackRevealPhase;
}

/**
 * Pure builder — no DB call, no network call. Only assembles the whitelisted
 * metadata object; a future live implementation is responsible for actually
 * calling logProviderUsage() with this shape.
 */
export function buildLushaPhoneFallbackUsageLogMetadataDraft(
  input: LushaPhoneFallbackUsageLogMetadataDraftInput,
): LushaPhoneFallbackUsageLogMetadataDraft {
  return {
    candidate_id: input.candidateId,
    actor_role: input.actorRole,
    phone_source: 'lusha_reveal',
    confirm_cost: true,
    cost_source: input.costSource,
    reveal_phase: input.revealPhase,
  };
}
