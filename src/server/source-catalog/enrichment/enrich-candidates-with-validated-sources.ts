/**
 * Source Catalog — Enrich Candidates with Validated Sources
 *
 * Hook genérico del wizard para enriquecer candidatos post-discovery.
 * Country-aware, never blocks (todas las fuentes son skip_without_blocking por defecto).
 *
 * Uso típico:
 *   const enriched = await enrichCandidatesWithValidatedSources({
 *     candidates: discoveredCandidates,
 *     countryCode: 'CO',
 *     stage: 'post_discovery_enrichment',
 *   });
 *
 * Solo server-side. No importar en Client Components.
 */

import type {
  EnrichCandidatesInput,
  EnrichCandidatesOutput,
  EnrichedCandidateResult,
  SourceCapability,
} from './types';
import { getValidatedSourcesForEnrichment } from './validated-source-configs';
import { ENRICHMENT_ADAPTER_REGISTRY } from './enrichment-adapter-registry';

export async function enrichCandidatesWithValidatedSources(
  input: EnrichCandidatesInput,
): Promise<EnrichCandidatesOutput> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const sourcesApplied: string[] = [];
  const sourcesSkipped: string[] = [];

  const capability: Extract<SourceCapability, 'enrichment_after_discovery' | 'prioritization'> =
    input.stage === 'prioritization' ? 'prioritization' : 'enrichment_after_discovery';

  // 1. Find applicable validated sources for this country + stage
  const applicableSources = getValidatedSourcesForEnrichment(input.countryCode, capability);

  if (applicableSources.length === 0) {
    return {
      results: input.candidates.map((c, i) => ({
        candidateIndex: i,
        candidateName: c.name,
        sourceEnrichments: {},
        priorityBoostTotal: 0,
        enrichmentMetadata: {},
      })),
      sourcesApplied: [],
      sourcesSkipped: [],
      warnings: [],
      errors: [],
    };
  }

  // 2. Resolve adapters — filter out missing ones.
  //
  // BR-SOURCE-FUNCTIONAL-CUT-B1: a caller may substitute the IMPLEMENTATION of an already-
  // applicable source through `adapterOverrides`, for sources whose adapter must be constructed
  // with run-level state the static registry cannot hold (Brazil's frozen monthly period). The
  // override is consulted AFTER `applicableSources` was computed from country + capability, so it
  // can only ever swap an adapter in — never add a source, never widen a country.
  const adapterOverrides = input.adapterOverrides ?? {};
  const adaptersToRun = applicableSources
    .map((sc) => ({
      config: sc,
      adapter: adapterOverrides[sc.adapterKey] ?? ENRICHMENT_ADAPTER_REGISTRY[sc.adapterKey],
    }))
    .filter(({ adapter }) => adapter != null);

  if (adaptersToRun.length === 0) {
    return {
      results: input.candidates.map((c, i) => ({
        candidateIndex: i,
        candidateName: c.name,
        sourceEnrichments: {},
        priorityBoostTotal: 0,
        enrichmentMetadata: {},
      })),
      sourcesApplied: [],
      sourcesSkipped: applicableSources.map((s) => s.sourceKey),
      warnings: ['No enrichment adapters found for applicable sources.'],
      errors: [],
    };
  }

  // 3. Enrich each candidate with all applicable adapters (parallel per candidate)
  const results: EnrichedCandidateResult[] = await Promise.all(
    input.candidates.map(async (candidate, i) => {
      const sourceEnrichments: EnrichedCandidateResult['sourceEnrichments'] = {};
      let priorityBoostTotal = 0;

      for (const { config, adapter } of adaptersToRun) {
        try {
          const output = await adapter.enrichCandidate({
            candidateName: candidate.name,
            candidateTaxId: candidate.taxId ?? null,
            countryCode: candidate.countryCode,
            sector: candidate.sector ?? null,
            existingMetadata: candidate.existingMetadata,
            capability,
          });
          sourceEnrichments[config.sourceKey] = output;
          if (output.priorityBoost) {
            priorityBoostTotal += output.priorityBoost;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Per fallbackBehavior: skip_without_blocking → never throw
          sourceEnrichments[config.sourceKey] = {
            sourceKey: config.sourceKey,
            status: 'error',
            matchedBy: null,
            confidence: 0,
            reason: msg,
          };
          if (config.fallbackBehavior === 'warn_but_continue') {
            warnings.push(
              `Source ${config.sourceKey} enrichment failed for "${candidate.name}": ${msg}`,
            );
          }
        }
      }

      // Build source_enrichment metadata block (compatible with existing metadata structure)
      const enrichmentMetadata: Record<string, unknown> = {};
      for (const [sourceKey, output] of Object.entries(sourceEnrichments)) {
        enrichmentMetadata[sourceKey] = {
          status: output.status,
          matched_by: output.matchedBy,
          confidence: output.confidence,
          source_year: output.sourceYear ?? null,
          signals: output.signals ?? {},
          financials: output.financials ?? {},
          priority_boost: output.priorityBoost ?? 0,
          reason: output.reason ?? null,
          // BR-SOURCE-FUNCTIONAL-CUT-B1: `SourceEnrichmentOutput.metadata` has always been part
          // of the adapter contract, but this builder dropped it — so anything an adapter placed
          // there never reached the persisted shape. Brazil needs it: `source_period` and
          // `snapshot_run_id` say WHICH monthly publication answered, and that provenance is not
          // a company signal, so it must not be smuggled into `signals` to survive.
          //
          // Defaulted to `{}` exactly like `signals` and `financials` above, so every source has
          // the same shape and an adapter that emits no metadata is indistinguishable from one
          // that emits an empty object — i.e. nothing changes for CO/MX/CL/EC.
          metadata: output.metadata ?? {},
        };
      }

      return {
        candidateIndex: i,
        candidateName: candidate.name,
        sourceEnrichments,
        priorityBoostTotal,
        enrichmentMetadata,
      };
    }),
  );

  // 4. Compute sources applied/skipped summary
  for (const { config } of adaptersToRun) {
    const anyMatched = results.some(
      (r) => r.sourceEnrichments[config.sourceKey]?.status === 'matched',
    );
    const allSkippedOrNoMatch = results.every(
      (r) =>
        r.sourceEnrichments[config.sourceKey]?.status === 'skipped' ||
        r.sourceEnrichments[config.sourceKey]?.status === 'no_match',
    );

    if (anyMatched) {
      sourcesApplied.push(config.sourceKey);
    } else if (allSkippedOrNoMatch) {
      sourcesSkipped.push(config.sourceKey);
    } else {
      // partial match or errors — count as applied
      sourcesApplied.push(config.sourceKey);
    }
  }

  return { results, sourcesApplied, sourcesSkipped, warnings, errors };
}
