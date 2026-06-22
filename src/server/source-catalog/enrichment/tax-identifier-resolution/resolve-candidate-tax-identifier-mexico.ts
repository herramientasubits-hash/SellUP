import type {
  ResolveTaxIdentifierInput,
  ResolveTaxIdentifierOutput,
} from './types';

export async function resolveCandidateTaxIdentifierForMexico(
  input: ResolveTaxIdentifierInput,
): Promise<ResolveTaxIdentifierOutput> {
  if (input.countryCode !== 'MX') {
    return {
      status: 'skipped',
      confidence: 0,
      metadata: { warning: 'Country code is not MX' },
    };
  }

  return {
    status: 'not_resolvable_automatically',
    taxIdentifier: undefined,
    confidence: 0,
    sourceKey: 'mx_rfc_manual_review',
    metadata: {
      human_review_required: true,
      reason: 'Mexico RFC cannot be resolved automatically from public MVP sources',
      recommended_next_step: 'Human reviewer must provide RFC before fiscal enrichment or HubSpot sync',
      contextual_sources_available: ['mx_denue'],
    },
  };
}
