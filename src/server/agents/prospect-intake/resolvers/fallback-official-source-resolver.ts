/**
 * SOURCES-CO-RUES-LIVE-NIT-1 — two official sources for ONE country, tried in
 * order: the second is only asked when the first did not give a strong identity.
 *
 * The orchestrator (`selectResolver`) runs the FIRST resolver that accepts a
 * candidate and never falls through to another one of the same country. Colombia
 * now has two sources (Supersociedades snapshot → cámaras de comercio in vivo), so
 * this combinator presents them as a single resolver.
 *
 * Which result wins:
 *   1. primary strong (`matched`)           → primary (the secondary is never asked)
 *   2. secondary strong                     → secondary
 *   3. primary signal (`low_confidence_match`) → primary
 *   4. secondary signal                     → secondary
 *   5. otherwise                            → primary (its not_found / error)
 *
 * The secondary is best-effort: if it throws, the primary result stands.
 *
 * Pure: no I/O of its own; both resolvers arrive already built.
 */

import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialSourceResolverInput,
} from '../source-enrichment';

/** Confidence at or above which a `matched` result is a strong identity. */
const STRONG_CONFIDENCE = 0.85;

function isStrong(result: OfficialSourceEnrichmentResult): boolean {
  return (
    result.status === 'matched' &&
    typeof result.confidence === 'number' &&
    result.confidence >= STRONG_CONFIDENCE
  );
}

/** Combine two resolvers of the SAME country into one. */
export function createFallbackOfficialSourceResolver(
  primary: OfficialSourceResolver,
  secondary: OfficialSourceResolver,
): OfficialSourceResolver {
  return {
    countryCode: primary.countryCode,
    sourceKey: primary.sourceKey,

    canResolve(input: OfficialSourceResolverInput): boolean {
      return primary.canResolve(input);
    },

    async resolve(input: OfficialSourceResolverInput): Promise<OfficialSourceEnrichmentResult> {
      const first = await primary.resolve(input);
      if (isStrong(first)) return first;

      let second: OfficialSourceEnrichmentResult | null = null;
      try {
        second = secondary.canResolve(input) ? await secondary.resolve(input) : null;
      } catch {
        second = null;
      }
      if (second === null) return first;
      if (isStrong(second)) return second;
      if (first.status === 'low_confidence_match') return first;
      if (second.status === 'low_confidence_match') return second;
      return first;
    },
  };
}
