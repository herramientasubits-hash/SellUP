/**
 * Source Catalog — Ecuador (SCVS) batch validated-source enrichment — EC-SCVS-7
 *
 * Routes Ecuador prospect candidates through the generic validated-source
 * enrichment helper so the ec_scvs adapter is actually invoked at runtime.
 *
 * Why this exists:
 *   Ecuador prospect generation flows through the commercial (Apollo) path and
 *   never reaches the Colombia-only post-discovery enrichment block. The tax
 *   resolution dispatcher (enrichBatchCandidatesWithTaxResolution) also guards
 *   EC out by design (it is a CO/MX tax-grain resolver, not a validated-source
 *   enricher). So EC needs its own thin runtime hook. This helper is that hook.
 *
 * Contract (EC-SCVS series):
 *   - EC only. countryCode is hardcoded to 'EC'; it never touches CO/MX/CL.
 *   - Snapshot-backed, fail-soft: adapter errors never tumble the batch.
 *   - RUC multiplicity stays observable (no arbitrary row selection). The
 *     ec_scvs adapter surfaces multiplicity; this helper only persists what the
 *     adapter returns — it never collapses ambiguity to a single row.
 *   - Metadata lands under metadata.source_enrichment.ec_scvs (+ _summary).
 *   - No raw_data is persisted (the adapter never emits it) and no full RUC is
 *     ever logged.
 *   - Uses the existing validated-source helper + adapter registry; no
 *     tax-grain helpers, no single-row probes here (the ec_scvs adapter owns the
 *     snapshot read under NATIVE_RECORD_GRAIN).
 *
 * Only server-side. No use in Client Components.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichCandidatesWithValidatedSources } from './enrich-candidates-with-validated-sources';

const EC_COUNTRY_CODE = 'EC' as const;
const EC_SCVS_SOURCE_KEY = 'ec_scvs' as const;

export interface EcBatchValidatedSourceEnrichmentResult {
  attempted: boolean;
  candidatesProcessed: number;
  sourcesApplied: string[];
  matchedCount: number;
  ambiguousCount: number;
  noMatchCount: number;
  skippedCount: number;
  errorCount: number;
  warnings: string[];
  errors: string[];
}

function emptyResult(attempted: boolean): EcBatchValidatedSourceEnrichmentResult {
  return {
    attempted,
    candidatesProcessed: 0,
    sourcesApplied: [],
    matchedCount: 0,
    ambiguousCount: 0,
    noMatchCount: 0,
    skippedCount: 0,
    errorCount: 0,
    warnings: [],
    errors: [],
  };
}

/**
 * True when the ec_scvs adapter surfaced RUC multiplicity (multiple expedientes
 * for the same fiscal identity). The adapter reports this as status='no_match'
 * WITH signals.ruc_multiplicity='multiple' so ambiguity is never mistaken for a
 * validated single match.
 */
function isObservableAmbiguity(signals: unknown): boolean {
  if (!signals || typeof signals !== 'object') return false;
  return (signals as Record<string, unknown>)['ruc_multiplicity'] === 'multiple';
}

/**
 * Enriches all candidates of a batch with Ecuador validated sources (ec_scvs).
 *
 * Reads candidates for the batch, runs the country-aware validated-source
 * enrichment helper for EC, and persists the result under
 * metadata.source_enrichment.ec_scvs for each candidate. Fully fail-soft: any
 * error is captured and returned, never thrown.
 */
export async function enrichEcBatchWithValidatedSources(
  supabase: SupabaseClient,
  batchId: string,
): Promise<EcBatchValidatedSourceEnrichmentResult> {
  try {
    const { data: candidates, error } = await supabase
      .from('prospect_candidates')
      .select('id, name, legal_name, tax_identifier, sector_description, metadata')
      .eq('batch_id', batchId);

    if (error || !candidates || candidates.length === 0) {
      return emptyResult(true);
    }

    const enrichResult = await enrichCandidatesWithValidatedSources({
      candidates: candidates.map((c) => ({
        name: (c['name'] as string) ?? (c['legal_name'] as string) ?? '',
        taxId: (c['tax_identifier'] as string | null) ?? null,
        countryCode: EC_COUNTRY_CODE,
        sector: (c['sector_description'] as string | null) ?? null,
        existingMetadata: (c['metadata'] as Record<string, unknown>) ?? {},
      })),
      countryCode: EC_COUNTRY_CODE,
      stage: 'post_discovery_enrichment',
    });

    const result = emptyResult(true);
    result.sourcesApplied = enrichResult.sourcesApplied;
    result.warnings = enrichResult.warnings;
    result.errors = enrichResult.errors;

    const updateOps: Array<Promise<unknown>> = [];

    for (const r of enrichResult.results) {
      const candidate = candidates[r.candidateIndex];
      if (!candidate) continue;

      const existingMeta = (candidate['metadata'] as Record<string, unknown>) ?? {};
      const candidateId = candidate['id'] as string;

      const ecOutput = r.sourceEnrichments[EC_SCVS_SOURCE_KEY];
      const status = ecOutput?.status ?? 'skipped';
      const ambiguous = status === 'no_match' && isObservableAmbiguity(ecOutput?.signals);

      if (status === 'matched') result.matchedCount++;
      else if (ambiguous) result.ambiguousCount++;
      else if (status === 'no_match') result.noMatchCount++;
      else if (status === 'error') result.errorCount++;
      else result.skippedCount++;

      if (status !== 'skipped') result.candidatesProcessed++;

      const matched = status === 'matched';
      const summaryStatus = matched ? 'completed' : status === 'error' ? 'error' : 'no_match';

      const updatedMeta: Record<string, unknown> = {
        ...existingMeta,
        source_enrichment: {
          ...((existingMeta['source_enrichment'] as Record<string, unknown>) ?? {}),
          // Persist the full ec_scvs outcome (matched / no_match / skipped / error)
          // so ambiguity remains observable. The adapter never emits raw_data.
          ...r.enrichmentMetadata,
          _summary: {
            status: summaryStatus,
            enriched_at: new Date().toISOString(),
            country_code: EC_COUNTRY_CODE,
            source_keys_attempted: Object.keys(r.enrichmentMetadata),
            source_keys_matched: matched ? [EC_SCVS_SOURCE_KEY] : [],
            human_review_required: ambiguous,
            reason: matched ? null : (ecOutput?.reason ?? null),
          },
        },
      };

      updateOps.push(
        supabase
          .from('prospect_candidates')
          .update({ metadata: updatedMeta })
          .eq('id', candidateId) as unknown as Promise<unknown>,
      );
    }

    await Promise.allSettled(updateOps);

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const r = emptyResult(true);
    r.errors = [msg];
    return r;
  }
}
