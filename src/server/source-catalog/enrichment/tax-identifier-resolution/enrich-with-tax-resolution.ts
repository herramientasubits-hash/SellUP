import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCandidateTaxIdentifierForColombia } from './resolve-candidate-tax-identifier-colombia';
import { resolveCandidateTaxIdentifierForMexico } from './resolve-candidate-tax-identifier-mexico';
import { enrichCandidatesWithValidatedSources } from '@/server/source-catalog/enrichment/enrich-candidates-with-validated-sources';
import type { TaxIdentifierResolutionBatchMetadata, ResolveTaxIdentifierOutput } from './types';

async function resolveForCandidateByCountry(
  name: string,
  candidate: Record<string, unknown>,
  countryCode: string,
) {
  if (countryCode === 'MX') {
    return resolveCandidateTaxIdentifierForMexico({
      name,
      domain: (candidate['domain'] as string | null) ?? null,
      website: (candidate['website'] as string | null) ?? null,
      countryCode: 'MX',
      sector: (candidate['sector_description'] as string | null) ?? null,
      existingMetadata: (candidate['metadata'] as Record<string, unknown>) ?? {},
    });
  }

  // CL (RUT), PE (RUC), EC (RUC): no dedicated resolver yet — return explicit skip.
  // This prevents these countries from silently hitting the Colombia NIT resolver.
  if (countryCode === 'CL' || countryCode === 'PE' || countryCode === 'EC') {
    const skipped: ResolveTaxIdentifierOutput = { status: 'not_found', confidence: 0 };
    return skipped;
  }

  // Unknown country: also skip rather than silently apply Colombia logic.
  if (countryCode !== 'CO') {
    const skipped: ResolveTaxIdentifierOutput = { status: 'not_found', confidence: 0 };
    return skipped;
  }

  return resolveCandidateTaxIdentifierForColombia({
    name,
    domain: (candidate['domain'] as string | null) ?? null,
    website: (candidate['website'] as string | null) ?? null,
    countryCode: 'CO',
    sector: (candidate['sector_description'] as string | null) ?? null,
    existingMetadata: (candidate['metadata'] as Record<string, unknown>) ?? {},
  });
}

async function resolveAndPersistForCandidate(
  supabase: SupabaseClient,
  candidate: Record<string, unknown>,
  countryCode: string,
): Promise<{ taxId: string | null; resolutionMeta: Record<string, unknown> | null }> {
  const name = (candidate['name'] as string) ?? (candidate['legal_name'] as string) ?? '';
  const existingTaxId = (candidate['tax_identifier'] as string | null) ?? null;

  if (existingTaxId && existingTaxId.trim().length > 0) {
    return { taxId: existingTaxId, resolutionMeta: null };
  }

  const result = await resolveForCandidateByCountry(name, candidate, countryCode);

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

  if (result.status === 'not_resolvable_automatically') {
    return {
      taxId: null,
      resolutionMeta: {
        tax_identifier_resolution: {
          status: 'not_resolvable_automatically',
          confidence: 0,
          source_key: 'mx_rfc_manual_review',
          human_review_required: true,
          reason: result.metadata?.reason ?? 'Mexico RFC cannot be resolved automatically from public MVP sources',
          recommended_next_step: result.metadata?.recommended_next_step ?? 'Human reviewer must provide RFC before fiscal enrichment or HubSpot sync',
          contextual_sources_available: result.metadata?.contextual_sources_available ?? ['mx_denue'],
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
    not_resolvable_automatically_count: 0,
    human_review_required_count: 0,
    errors: [],
  };

  if (countryCode !== 'CO' && countryCode !== 'MX') {
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
    not_resolvable_automatically_count: 0,
    human_review_required_count: 0,
    errors: [],
  };

  for (const candidate of candidates) {
    try {
      const { taxId, resolutionMeta } = await resolveAndPersistForCandidate(supabase, candidate, countryCode);
      if (resolutionMeta) {
        resolutionMetaMap.set(candidate['id'] as string, resolutionMeta);
        const resolution = resolutionMeta['tax_identifier_resolution'] as Record<string, unknown> | undefined;
        const rstatus = resolution?.['status'] as string | undefined;
        const humanReviewRequired = resolution?.['human_review_required'] as boolean | undefined;
        if (rstatus === 'resolved') batchStatus.resolved_count++;
        else if (rstatus === 'ambiguous') batchStatus.ambiguous_count++;
        else if (rstatus === 'not_found') batchStatus.not_found_count++;
        else if (rstatus === 'skipped' || rstatus === 'error') batchStatus.skipped_count++;
        else if (rstatus === 'not_resolvable_automatically') batchStatus.not_resolvable_automatically_count++;
        if (humanReviewRequired) batchStatus.human_review_required_count++;
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

function emptyBatchStatus(): TaxIdentifierResolutionBatchMetadata {
  return {
    attempted: false,
    candidates_processed: 0,
    resolved_count: 0,
    ambiguous_count: 0,
    not_found_count: 0,
    skipped_count: 0,
    not_resolvable_automatically_count: 0,
    human_review_required_count: 0,
    errors: [],
  };
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
  // Chile: INAPI signal enrichment only (no tax resolution, no discovery)
  if (countryCode === 'CL') {
    try {
      const { data: candidates, error } = await supabase
        .from('prospect_candidates')
        .select('id, name, legal_name, metadata, sector_description')
        .eq('batch_id', batchId);

      if (error || !candidates || candidates.length === 0) {
        return {
          candidatesProcessed: 0,
          sourcesApplied: [],
          warnings: [],
          errors: [],
          taxResolutionStatus: emptyBatchStatus(),
        };
      }

      const { inapiChileEnrichmentAdapter } = await import(
        '../../enrichment/adapters/cl-inapi'
      );

      const updateOps: Array<Promise<unknown>> = [];
      let processedCount = 0;

      for (const candidate of candidates) {
        const existingMeta = (candidate['metadata'] as Record<string, unknown>) ?? {};
        const candidateId = candidate['id'] as string;
        const candidateName = (candidate['name'] as string) ?? (candidate['legal_name'] as string) ?? '';

        const updatedMeta: Record<string, unknown> = { ...existingMeta };

        let inapiOutputMeta: Record<string, unknown> | null = null;
        let inapiError = false;
        try {
          const inapiOutput = await inapiChileEnrichmentAdapter.enrichCandidate({
            candidateName,
            candidateTaxId: null,
            countryCode: 'CL',
            sector: (candidate['sector_description'] as string | null) ?? null,
            existingMetadata: existingMeta,
            capability: 'manual_signal',
          });

          processedCount++;
          if (inapiOutput.metadata) {
            inapiOutputMeta = inapiOutput.metadata as Record<string, unknown>;
          }
        } catch {
          // INAPI never breaks the pipeline
          inapiError = true;
        }

        // CL query selects id/name/legal_name/metadata/sector_description only — tax_identifier not fetched
        const taxIdForCL: string | null = null;
        updatedMeta['source_enrichment'] = {
          ...((existingMeta['source_enrichment'] as Record<string, unknown>) ?? {}),
          ...(inapiOutputMeta ? { cl_inapi: inapiOutputMeta } : {}),
          _summary: {
            status: inapiError ? 'error' : inapiOutputMeta ? 'completed' : 'no_match',
            enriched_at: new Date().toISOString(),
            country_code: 'CL',
            source_keys_attempted: ['cl_inapi'],
            source_keys_matched: inapiOutputMeta ? ['cl_inapi'] : [],
            tax_resolution_status: taxIdForCL ? 'resolved' : 'skipped',
            tax_identifier: taxIdForCL,
            tax_identifier_type: 'RUT',
            reason: inapiError ? 'inapi_error' : !inapiOutputMeta ? 'no_inapi_output' : null,
          },
        };

        const op = supabase
          .from('prospect_candidates')
          .update({ metadata: updatedMeta })
          .eq('id', candidateId);
        updateOps.push(op as unknown as Promise<unknown>);
      }

      await Promise.allSettled(updateOps);

      return {
        candidatesProcessed: processedCount,
        sourcesApplied: processedCount > 0 ? ['cl_inapi'] : [],
        warnings: [],
        errors: [],
        taxResolutionStatus: emptyBatchStatus(),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        candidatesProcessed: 0,
        sourcesApplied: [],
        warnings: [],
        errors: [msg],
        taxResolutionStatus: emptyBatchStatus(),
      };
    }
  }

  if (countryCode !== 'CO' && countryCode !== 'MX') {
    return {
      candidatesProcessed: 0,
      sourcesApplied: [],
      warnings: [],
      errors: [],
      taxResolutionStatus: emptyBatchStatus(),
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

    if (countryCode === 'MX') {
      const { denueEnrichmentAdapter } = await import(
        '../../connectors/denue-mexico/denue-enrichment-adapter'
      );

      const updateOps: Array<Promise<unknown>> = [];

      for (const candidate of candidates) {
        const existingMeta = (candidate['metadata'] as Record<string, unknown>) ?? {};
        const candidateId = candidate['id'] as string;
        const resolutionMeta = resolutionMetaMap.get(candidateId);
        const candidateName = (candidate['name'] as string) ?? (candidate['legal_name'] as string) ?? '';

        const updatedMeta: Record<string, unknown> = { ...existingMeta };

        if (resolutionMeta) {
          Object.assign(updatedMeta, resolutionMeta);
        }

        let denueOutputMeta: Record<string, unknown> | null = null;
        try {
          const denueOutput = await denueEnrichmentAdapter.enrichCandidate({
            candidateName,
            candidateTaxId: null,
            countryCode: 'MX',
            sector: (candidate['sector_description'] as string | null) ?? null,
            existingMetadata: existingMeta,
            capability: 'enrichment_after_discovery',
          });

          if (denueOutput.metadata) {
            denueOutputMeta = denueOutput.metadata as Record<string, unknown>;
          }
        } catch {
          // DENUE enrichment never breaks pipeline
        }

        const taxIdForMX = (candidate['tax_identifier'] as string | null) ?? null;
        updatedMeta['source_enrichment'] = {
          ...((existingMeta['source_enrichment'] as Record<string, unknown>) ?? {}),
          ...(denueOutputMeta ? { mx_denue: denueOutputMeta } : {}),
          _summary: {
            status: denueOutputMeta ? 'completed' : 'no_match',
            enriched_at: new Date().toISOString(),
            country_code: 'MX',
            source_keys_attempted: ['mx_denue'],
            source_keys_matched: denueOutputMeta ? ['mx_denue'] : [],
            tax_resolution_status: taxIdForMX ? 'resolved' : 'not_found',
            tax_identifier: taxIdForMX,
            tax_identifier_type: 'RFC',
            reason: !denueOutputMeta ? 'no_denue_output' : null,
          },
        };

        const op = supabase
          .from('prospect_candidates')
          .update({ metadata: updatedMeta })
          .eq('id', candidateId);
        updateOps.push(op as unknown as Promise<unknown>);
      }

      await Promise.allSettled(updateOps);

      return {
        candidatesProcessed: batchStatus.candidates_processed,
        sourcesApplied: ['mx_tax_resolution', 'mx_denue'],
        warnings: [],
        errors: batchStatus.errors,
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

      const sourceKeysAttempted = Object.keys(r.enrichmentMetadata);
      const sourceKeysMatched = Object.keys(newSourceEnrichment);
      const taxIdForCO = (candidate['tax_identifier'] as string | null) ?? null;
      updatedMeta['source_enrichment'] = {
        ...((existingMeta['source_enrichment'] as Record<string, unknown>) ?? {}),
        ...newSourceEnrichment,
        _summary: {
          status: sourceKeysMatched.length > 0 ? 'completed' : 'no_match',
          enriched_at: new Date().toISOString(),
          country_code: 'CO',
          source_keys_attempted: sourceKeysAttempted,
          source_keys_matched: sourceKeysMatched,
          tax_resolution_status: taxIdForCO ? 'resolved' : 'not_found',
          tax_identifier: taxIdForCO,
          tax_identifier_type: 'NIT',
          reason: sourceKeysMatched.length === 0 ? 'no_source_match' : null,
        },
      };

      const op = supabase
        .from('prospect_candidates')
        .update({ metadata: updatedMeta })
        .eq('id', candidateId);
      updateOps.push(op as unknown as Promise<unknown>);
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
        not_resolvable_automatically_count: 0,
        human_review_required_count: 0,
        errors: [msg],
      },
    };
  }
}
