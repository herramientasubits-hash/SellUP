import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCandidateTaxIdentifierForColombia } from './resolve-candidate-tax-identifier-colombia';
import { enrichCandidatesWithValidatedSources } from '@/server/source-catalog/enrichment/enrich-candidates-with-validated-sources';
import type { TaxIdentifierResolutionBatchMetadata } from './types';

async function resolveAndPersistForCandidate(
  supabase: SupabaseClient,
  candidate: Record<string, unknown>,
): Promise<{ taxId: string | null; resolutionMeta: Record<string, unknown> | null }> {
  const name = (candidate['name'] as string) ?? (candidate['legal_name'] as string) ?? '';
  const existingTaxId = (candidate['tax_identifier'] as string | null) ?? null;

  if (existingTaxId && existingTaxId.trim().length > 0) {
    return { taxId: existingTaxId, resolutionMeta: null };
  }

  const result = await resolveCandidateTaxIdentifierForColombia({
    name,
    domain: (candidate['domain'] as string | null) ?? null,
    website: (candidate['website'] as string | null) ?? null,
    countryCode: 'CO',
    sector: (candidate['sector_description'] as string | null) ?? null,
    existingMetadata: (candidate['metadata'] as Record<string, unknown>) ?? {},
  });

  if (result.status === 'error') {
    return {
      taxId: null,
      resolutionMeta: {
        tax_identifier_resolution: {
          status: 'error',
          confidence: 0,
          warning: result.metadata?.warning ?? 'Resolver error',
        },
      },
    };
  }

  if (result.status === 'skipped') {
    return {
      taxId: null,
      resolutionMeta: {
        tax_identifier_resolution: {
          status: 'skipped',
          confidence: 0,
          warning: result.metadata?.warning ?? null,
        },
      },
    };
  }

  if (result.status === 'not_found') {
    return {
      taxId: null,
      resolutionMeta: {
        tax_identifier_resolution: {
          status: 'not_found',
          confidence: 0,
          normalized_search_name: result.metadata?.normalizedSearchName ?? null,
        },
      },
    };
  }

  if (result.status === 'ambiguous') {
    return {
      taxId: null,
      resolutionMeta: {
        tax_identifier_resolution: {
          status: 'ambiguous',
          confidence: result.confidence,
          matched_by: result.matchedBy ?? null,
          source_key: result.sourceKey ?? null,
          candidates: (result.candidates ?? []).map(c => ({
            tax_identifier: c.taxIdentifier,
            legal_name: c.legalName,
            source_key: c.sourceKey,
            confidence: c.confidence,
            reason: c.reason,
          })),
          normalized_search_name: result.metadata?.normalizedSearchName ?? null,
          warning: result.metadata?.warning ?? null,
        },
      },
    };
  }

  if (result.status === 'resolved' && result.confidence >= 0.85 && result.taxIdentifier) {
    await supabase
      .from('prospect_candidates')
      .update({ tax_identifier: result.taxIdentifier })
      .eq('id', candidate['id'] as string);

    return {
      taxId: result.taxIdentifier,
      resolutionMeta: {
        tax_identifier_resolution: {
          status: 'resolved',
          tax_identifier: result.taxIdentifier,
          confidence: result.confidence,
          matched_by: result.matchedBy ?? null,
          source_key: result.sourceKey ?? null,
          matched_legal_name: result.metadata?.matchedLegalName ?? null,
          source_year: result.metadata?.sourceYear ?? null,
        },
      },
    };
  }

  return { taxId: null, resolutionMeta: null };
}

export async function resolveAndPersistTaxIdentifiersForBatch(
  supabase: SupabaseClient,
  batchId: string,
  countryCode: string,
): Promise<{
  candidates: Array<Record<string, unknown>>;
  resolutionMetaMap: Map<string, Record<string, unknown>>;
  batchStatus: TaxIdentifierResolutionBatchMetadata;
}> {
  const empty: TaxIdentifierResolutionBatchMetadata = {
    attempted: false,
    candidates_processed: 0,
    resolved_count: 0,
    ambiguous_count: 0,
    not_found_count: 0,
    skipped_count: 0,
    errors: [],
  };

  if (countryCode !== 'CO') {
    return { candidates: [], resolutionMetaMap: new Map(), batchStatus: empty };
  }

  const { data: candidates, error } = await supabase
    .from('prospect_candidates')
    .select('id, name, legal_name, tax_identifier, domain, website, sector_description, metadata')
    .eq('batch_id', batchId);

  if (error || !candidates || candidates.length === 0) {
    return { candidates: [], resolutionMetaMap: new Map(), batchStatus: { ...empty, attempted: true } };
  }

  const resolutionMetaMap = new Map<string, Record<string, unknown>>();
  const batchStatus: TaxIdentifierResolutionBatchMetadata = {
    attempted: true,
    candidates_processed: candidates.length,
    resolved_count: 0,
    ambiguous_count: 0,
    not_found_count: 0,
    skipped_count: 0,
    errors: [],
  };

  for (const candidate of candidates) {
    try {
      const { taxId, resolutionMeta } = await resolveAndPersistForCandidate(supabase, candidate);
      if (resolutionMeta) {
        resolutionMetaMap.set(candidate['id'] as string, resolutionMeta);
        const resolution = resolutionMeta['tax_identifier_resolution'] as Record<string, unknown> | undefined;
        const rstatus = resolution?.['status'] as string | undefined;
        if (rstatus === 'resolved') batchStatus.resolved_count++;
        else if (rstatus === 'ambiguous') batchStatus.ambiguous_count++;
        else if (rstatus === 'not_found') batchStatus.not_found_count++;
        else if (rstatus === 'skipped' || rstatus === 'error') batchStatus.skipped_count++;
      }

      if (taxId) {
        (candidate as Record<string, unknown>)['tax_identifier'] = taxId;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      batchStatus.errors.push(msg);
    }
  }

  return { candidates: candidates as Array<Record<string, unknown>>, resolutionMetaMap, batchStatus };
}

export async function enrichBatchCandidatesWithTaxResolution(
  supabase: SupabaseClient,
  batchId: string,
  countryCode: string,
): Promise<{
  candidatesProcessed: number;
  sourcesApplied: string[];
  warnings: string[];
  errors: string[];
  taxResolutionStatus: TaxIdentifierResolutionBatchMetadata;
}> {
  if (countryCode !== 'CO') {
    return {
      candidatesProcessed: 0,
      sourcesApplied: [],
      warnings: [],
      errors: [],
      taxResolutionStatus: {
        attempted: false,
        candidates_processed: 0,
        resolved_count: 0,
        ambiguous_count: 0,
        not_found_count: 0,
        skipped_count: 0,
        errors: [],
      },
    };
  }

  try {
    const { candidates, resolutionMetaMap, batchStatus } =
      await resolveAndPersistTaxIdentifiersForBatch(supabase, batchId, countryCode);

    if (candidates.length === 0) {
      return {
        candidatesProcessed: 0,
        sourcesApplied: [],
        warnings: [],
        errors: [],
        taxResolutionStatus: batchStatus,
      };
    }

    const enrichResult = await enrichCandidatesWithValidatedSources({
      candidates: candidates.map((c) => ({
        name: (c['name'] as string) ?? (c['legal_name'] as string) ?? '',
        taxId: (c['tax_identifier'] as string | null) ?? null,
        countryCode: 'CO',
        sector: (c['sector_description'] as string | null) ?? null,
        existingMetadata: (c['metadata'] as Record<string, unknown>) ?? {},
      })),
      countryCode: 'CO',
      stage: 'post_discovery_enrichment',
    });

    const updateOps: Array<Promise<unknown>> = [];

    for (const r of enrichResult.results) {
      const candidate = candidates[r.candidateIndex];
      if (!candidate) continue;

      const existingMeta = (candidate['metadata'] as Record<string, unknown>) ?? {};
      const candidateId = candidate['id'] as string;
      const resolutionMeta = resolutionMetaMap.get(candidateId);

      const newSourceEnrichment = Object.fromEntries(
        Object.entries(r.enrichmentMetadata).filter(
          ([, v]) => (v as Record<string, unknown>)['status'] !== 'skipped',
        ),
      );

      const updatedMeta: Record<string, unknown> = {
        ...existingMeta,
      };

      if (resolutionMeta) {
        Object.assign(updatedMeta, resolutionMeta);
      }

      if (Object.keys(newSourceEnrichment).length > 0) {
        updatedMeta['source_enrichment'] = {
          ...((existingMeta['source_enrichment'] as Record<string, unknown>) ?? {}),
          ...newSourceEnrichment,
        };
      }

      if (Object.keys(updatedMeta).length > Object.keys(existingMeta).length) {
        const op = supabase
          .from('prospect_candidates')
          .update({ metadata: updatedMeta })
          .eq('id', candidateId);
        updateOps.push(op as unknown as Promise<unknown>);
      }
    }

    await Promise.allSettled(updateOps);

    const nonSkippedCount = enrichResult.results.filter(
      (r) => Object.values(r.sourceEnrichments).some((e) => e.status !== 'skipped'),
    ).length;

    return {
      candidatesProcessed: nonSkippedCount,
      sourcesApplied: enrichResult.sourcesApplied,
      warnings: enrichResult.warnings,
      errors: enrichResult.errors,
      taxResolutionStatus: batchStatus,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      candidatesProcessed: 0,
      sourcesApplied: [],
      warnings: [],
      errors: [msg],
      taxResolutionStatus: {
        attempted: true,
        candidates_processed: 0,
        resolved_count: 0,
        ambiguous_count: 0,
        not_found_count: 0,
        skipped_count: 0,
        errors: [msg],
      },
    };
  }
}
