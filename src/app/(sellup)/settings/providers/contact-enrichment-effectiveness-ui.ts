// Q3F-11C — contact-enrichment effectiveness UI wiring
//
// Pure helpers gating and classifying the read-only provider-effectiveness
// read model (src/modules/provider-effectiveness/) for the provider
// workspace. No metric recomputation — only a supported-provider gate and a
// UI-state classifier derived from the model's own coverage/maturity counts.

import type {
  EffectivenessProviderKey,
  ProviderEffectivenessProviderSummary,
} from '@/modules/provider-effectiveness/types';

/** Mirrors the exact EffectivenessProviderKey union from the read model — do not diverge. */
const SUPPORTED_EFFECTIVENESS_PROVIDER_KEYS = new Set<string>(['apollo', 'lusha']);

export function isEffectivenessSupportedProvider(
  providerKey: string,
): providerKey is EffectivenessProviderKey {
  return SUPPORTED_EFFECTIVENESS_PROVIDER_KEYS.has(providerKey);
}

export type ContactEnrichmentEffectivenessUiState = 'no_evidence' | 'pending_review' | 'mature';

/**
 * Classifies which UI state the contact-enrichment outcome section should
 * render, using only the model's own coverage/maturity counts — never an
 * invented sample-size threshold.
 */
export function resolveContactEnrichmentEffectivenessUiState(
  summary: ProviderEffectivenessProviderSummary,
): ContactEnrichmentEffectivenessUiState {
  if (summary.coverage.attributedRunCount === 0) return 'no_evidence';
  if (summary.coverage.outcomeMatureRunCount === 0) return 'pending_review';
  return 'mature';
}
