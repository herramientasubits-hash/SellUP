/**
 * Post-Approval NIT Enrichment Worker — v1.16K-E
 *
 * Processes candidates with:
 *   metadata.post_approval_enrichment.status = 'queued'
 *   metadata.post_approval_enrichment.strategy = 'nit_first'
 *   status = 'converted_to_account' AND converted_account_id IS NOT NULL
 *
 * Runs Colombia NIT-first source adapters via ENRICHMENT_ADAPTER_REGISTRY.
 * NO LLM. NO Tavily. NO LinkedIn. NO Sales Navigator.
 *
 * Design notes:
 * - Separate from enrichment-worker.ts which calls enrichProspectCandidate (LLM).
 * - Adapters are called directly from ENRICHMENT_ADAPTER_REGISTRY.
 * - Any adapter failure is captured; remaining adapters continue.
 * - metadata.approval, metadata.rich_profile, and all prior blocks are preserved.
 * - Default limit: 5 candidates per run.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ENRICHMENT_ADAPTER_REGISTRY } from '@/server/source-catalog/enrichment/enrichment-adapter-registry';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentOutput,
} from '@/server/source-catalog/enrichment/types';
import { enrichPeruCandidateWithSunatLegalLookup } from './peru-sunat-post-approval-enrichment';
import type { PeruSunatLegalLookupResult } from '../services/peru-sunat-legal-lookup';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PostApprovalNitWorkerParams {
  maxCandidates?: number;
  supabase?: SupabaseClient;
  /** For testing only — overrides ENRICHMENT_ADAPTER_REGISTRY. */
  adapterRegistryOverride?: Record<string, SourceEnrichmentAdapter>;
  /** For testing only — overrides lookupPeruSunatByRuc for PE enrichment. */
  peruLookupFnOverride?: (ruc: string) => Promise<PeruSunatLegalLookupResult>;
  /** For smoke/testing only — limits processing to a single candidate by id. */
  candidateId?: string;
}

export interface PostApprovalNitEnrichmentStats {
  queued_found: number;
  processed: number;
  completed: number;
  completed_with_warnings: number;
  errors: number;
  skipped: number;
  duration_ms: number;
}

type CandidateFinalStatus = 'completed' | 'completed_with_warnings' | 'error';

export interface CandidateRow {
  id: string;
  batch_id: string | null;
  name: string;
  status: string;
  converted_account_id: string | null;
  tax_identifier: string | null;
  country_code: string | null;
  sector_code: string | null;
  sector_description: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AdapterRunResult {
  sourceKey: string;
  output: SourceEnrichmentOutput;
}

export interface PersistResult {
  finalStatus: CandidateFinalStatus;
  processedSourceKeys: string[];
  matchedSourceKeys: string[];
  noMatchSourceKeys: string[];
  skippedSourceKeys: string[];
  failedSourceKeys: string[];
  priorityBoostTotal: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CANDIDATES = 5;

// Colombia NIT-safe source keys — mirrors CO_NIT_SAFE_SOURCE_KEYS in trigger
export const CO_NIT_SAFE_SOURCE_KEYS: readonly string[] = [
  'co_personas_juridicas_cc',
  'co_secop2_proveedores',
  'co_minsalud_reps',
  'co_superfinanciera',
  'co_siis',
] as const;

// ── Admin client ───────────────────────────────────────────────────────────────

function getAdminSupabase(): SupabaseClient {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServiceKey) {
    throw new Error(
      'post_approval_nit_enrichment_unavailable (SUPABASE_SERVICE_ROLE_KEY not configured)',
    );
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}

// ── Candidate selection ────────────────────────────────────────────────────────

/**
 * Fetches converted candidates with post_approval_enrichment.status='queued'
 * and strategy='nit_first' and a non-null NIT.
 *
 * Queries by status at DB level, then applies precise JS filter for the
 * metadata state to avoid complex JSONB query syntax.
 */
export async function selectQueuedCandidates(
  supabase: SupabaseClient,
  limit: number,
): Promise<CandidateRow[]> {
  // Fetch a batch larger than limit to account for JS filter
  const fetchLimit = Math.min(limit * 6, 60);

  const { data, error } = await supabase
    .from('prospect_candidates')
    .select(
      'id, batch_id, name, status, converted_account_id, tax_identifier, country_code, sector_code, sector_description, metadata',
    )
    .eq('status', 'converted_to_account')
    .not('converted_account_id', 'is', null)
    .limit(fetchLimit);

  if (error) throw error;

  const rows = (data ?? []) as CandidateRow[];

  return rows
    .filter((c) => {
      const meta = c.metadata as Record<string, unknown> | null;
      const pae = meta?.post_approval_enrichment as
        | Record<string, unknown>
        | undefined;
      return (
        pae?.status === 'queued' &&
        pae?.strategy === 'nit_first' &&
        typeof pae?.nit === 'string' &&
        (pae.nit as string).trim().length > 0
      );
    })
    .slice(0, limit);
}

// ── Adapter execution ──────────────────────────────────────────────────────────

/**
 * Executes NIT-safe CO source adapters for a single candidate.
 * Filters source_keys to only CO_NIT_SAFE_SOURCE_KEYS.
 * Captures per-adapter errors — never throws.
 */
export async function executeNitAdapters(params: {
  candidateName: string;
  nit: string;
  countryCode: string;
  sector: string | null;
  existingMetadata: Record<string, unknown>;
  sourceKeys: string[];
  registry?: Record<string, SourceEnrichmentAdapter>;
}): Promise<AdapterRunResult[]> {
  const {
    candidateName,
    nit,
    countryCode,
    sector,
    existingMetadata,
    sourceKeys,
    registry = ENRICHMENT_ADAPTER_REGISTRY,
  } = params;

  // Guard: only CO NIT-safe keys
  const allowedKeys = sourceKeys.filter((k) =>
    CO_NIT_SAFE_SOURCE_KEYS.includes(k),
  );

  const results: AdapterRunResult[] = [];

  for (const sourceKey of allowedKeys) {
    const adapter = registry[sourceKey];

    if (!adapter) {
      results.push({
        sourceKey,
        output: {
          sourceKey,
          status: 'skipped',
          matchedBy: null,
          confidence: 0,
          reason: 'adapter_not_registered',
        },
      });
      continue;
    }

    try {
      const output = await adapter.enrichCandidate({
        candidateName,
        candidateTaxId: nit,
        countryCode,
        sector: sector ?? null,
        existingMetadata,
        capability: 'enrichment_after_discovery',
      });
      results.push({ sourceKey, output });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[PostApprovalNitWorker] Adapter ${sourceKey} failed: ${msg}`,
      );
      results.push({
        sourceKey,
        output: {
          sourceKey,
          status: 'error',
          matchedBy: null,
          confidence: 0,
          reason: msg.slice(0, 200),
        },
      });
    }
  }

  return results;
}

// ── Status determination ───────────────────────────────────────────────────────

/**
 * completed             — no adapter errored
 * completed_with_warnings — at least one errored, at least one did not
 * error                 — all adapters errored or no adapters ran
 */
export function determineFinalStatus(
  results: AdapterRunResult[],
): CandidateFinalStatus {
  if (results.length === 0) return 'error';
  const errorCount = results.filter((r) => r.output.status === 'error').length;
  if (errorCount === 0) return 'completed';
  if (errorCount < results.length) return 'completed_with_warnings';
  return 'error';
}

// ── Metadata persistence ───────────────────────────────────────────────────────

/**
 * Merges adapter results into candidate metadata without losing existing blocks.
 *
 * Preserves:
 *   metadata.approval, metadata.hubspot_sync, metadata.rich_profile,
 *   metadata.employee_size_resolution, metadata.icp_size_gate, etc.
 *
 * Updates:
 *   metadata.source_enrichment[sourceKey]
 *   metadata.enrichment.status / completed_at / priority_boost_total
 *   metadata.post_approval_enrichment.status / completed_at / processed/failed/...
 */
export async function persistEnrichmentResults(
  params: {
    candidateId: string;
    adapterResults: AdapterRunResult[];
    existingMetadata: Record<string, unknown>;
    paeBlock: Record<string, unknown>;
  },
  supabase: SupabaseClient,
): Promise<PersistResult> {
  const { candidateId, adapterResults, existingMetadata, paeBlock } = params;
  const completedAt = new Date().toISOString();

  const sourceEnrichmentUpdate: Record<string, unknown> = {};
  const processedSourceKeys: string[] = [];
  const matchedSourceKeys: string[] = [];
  const noMatchSourceKeys: string[] = [];
  const skippedSourceKeys: string[] = [];
  const failedSourceKeys: string[] = [];
  let priorityBoostTotal = 0;

  for (const { sourceKey, output } of adapterResults) {
    processedSourceKeys.push(sourceKey);
    sourceEnrichmentUpdate[sourceKey] = {
      status: output.status,
      matched_by: output.matchedBy,
      confidence: output.confidence,
      source_year: output.sourceYear ?? null,
      signals: output.signals ?? {},
      financials: output.financials ?? {},
      priority_boost: output.priorityBoost ?? 0,
      reason: output.reason ?? null,
      enriched_at: completedAt,
    };
    if (output.priorityBoost) priorityBoostTotal += output.priorityBoost;

    switch (output.status) {
      case 'matched':
        matchedSourceKeys.push(sourceKey);
        break;
      case 'no_match':
        noMatchSourceKeys.push(sourceKey);
        break;
      case 'skipped':
        skippedSourceKeys.push(sourceKey);
        break;
      case 'error':
        failedSourceKeys.push(sourceKey);
        break;
    }
  }

  const finalStatus = determineFinalStatus(adapterResults);

  const existingSourceEnrichment =
    (existingMetadata.source_enrichment as Record<string, unknown> | null) ?? {};
  const existingEnrichment =
    (existingMetadata.enrichment as Record<string, unknown> | null) ?? {};

  const updatedMeta: Record<string, unknown> = {
    ...existingMetadata,
    source_enrichment: {
      ...existingSourceEnrichment,
      ...sourceEnrichmentUpdate,
    },
    enrichment: {
      ...existingEnrichment,
      status: finalStatus,
      completed_at: completedAt,
      ...(priorityBoostTotal > 0 ? { priority_boost_total: priorityBoostTotal } : {}),
    },
    post_approval_enrichment: {
      ...paeBlock,
      status: finalStatus,
      completed_at: completedAt,
      processed_source_keys: processedSourceKeys,
      matched_source_keys: matchedSourceKeys,
      no_match_source_keys: noMatchSourceKeys,
      skipped_source_keys: skippedSourceKeys,
      failed_source_keys: failedSourceKeys,
    },
  };

  await supabase
    .from('prospect_candidates')
    .update({
      metadata: updatedMeta,
      updated_at: completedAt,
    })
    .eq('id', candidateId);

  return {
    finalStatus,
    processedSourceKeys,
    matchedSourceKeys,
    noMatchSourceKeys,
    skippedSourceKeys,
    failedSourceKeys,
    priorityBoostTotal,
  };
}

// ── Audit trail ────────────────────────────────────────────────────────────────

export async function insertPostApprovalAuditTrail(
  params: {
    candidateId: string;
    batchId: string | null;
    accountId: string;
    finalStatus: CandidateFinalStatus;
    processedSourceKeys: string[];
    matchedSourceKeys: string[];
    noMatchSourceKeys: string[];
    skippedSourceKeys: string[];
    failedSourceKeys: string[];
  },
  supabase: SupabaseClient,
): Promise<void> {
  const subAction =
    params.finalStatus === 'completed'
      ? 'post_approval_enrichment_completed'
      : params.finalStatus === 'completed_with_warnings'
        ? 'post_approval_enrichment_completed_with_warnings'
        : 'post_approval_enrichment_error';

  await supabase.from('prospect_candidate_audit').insert({
    batch_id: params.batchId,
    candidate_id: params.candidateId,
    actor_user_id: null,
    action_type: 'candidate_updated',
    details: {
      sub_action: subAction,
      account_id: params.accountId,
      source_keys_attempted: params.processedSourceKeys,
      source_keys_matched: params.matchedSourceKeys,
      source_keys_no_match: params.noMatchSourceKeys,
      source_keys_skipped: params.skippedSourceKeys,
      source_keys_error: params.failedSourceKeys,
    },
  });
}

// ── Peru SUNAT enrichment step ─────────────────────────────────────────────────

/**
 * Runs SUNAT snapshot lookup for PE candidates and saves pe_sunat_bulk block.
 * Non-critical: errors are logged and swallowed — they do not affect CO enrichment.
 * Only called when candidate.country_code === 'PE'.
 */
async function runPeruSunatEnrichmentForCandidate(
  candidate: CandidateRow,
  existingMeta: Record<string, unknown>,
  supabase: SupabaseClient,
  peruLookupFnOverride?: (ruc: string) => Promise<PeruSunatLegalLookupResult>,
): Promise<void> {
  try {
    const peResult = await enrichPeruCandidateWithSunatLegalLookup(
      {
        candidateId: candidate.id,
        countryCode: candidate.country_code ?? '',
        taxId: candidate.tax_identifier,
        metadata: existingMeta,
      },
      peruLookupFnOverride,
    );

    if (!peResult.enriched || !peResult.pe_sunat_bulk) return;

    // Re-fetch metadata to avoid overwriting concurrent updates
    const { data: current } = await supabase
      .from('prospect_candidates')
      .select('metadata')
      .eq('id', candidate.id)
      .single();

    const currentMeta = (current?.metadata as Record<string, unknown>) ?? {};
    const currentSourceEnrichment =
      (currentMeta.source_enrichment as Record<string, unknown>) ?? {};

    await supabase
      .from('prospect_candidates')
      .update({
        metadata: {
          ...currentMeta,
          source_enrichment: {
            ...currentSourceEnrichment,
            pe_sunat_bulk: peResult.pe_sunat_bulk,
          },
        },
        updated_at: peResult.pe_sunat_bulk.enriched_at,
      })
      .eq('id', candidate.id);
  } catch (err) {
    console.warn(
      `[PostApprovalNitWorker] Peru SUNAT enrichment non-critical error for ${candidate.id}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ── Single candidate processing ────────────────────────────────────────────────

async function processCandidateNitEnrichment(
  candidate: CandidateRow,
  supabase: SupabaseClient,
  adapterRegistryOverride?: Record<string, SourceEnrichmentAdapter>,
  peruLookupFnOverride?: (ruc: string) => Promise<PeruSunatLegalLookupResult>,
): Promise<{ candidateId: string; finalStatus: CandidateFinalStatus }> {
  const meta = (candidate.metadata as Record<string, unknown> | null) ?? {};
  const paeBlock = (meta.post_approval_enrichment as Record<string, unknown>) ?? {};
  const nit = paeBlock.nit as string;
  const sourceKeys = Array.isArray(paeBlock.source_keys)
    ? (paeBlock.source_keys as string[])
    : [];
  const accountId = candidate.converted_account_id ?? '';

  const adapterResults = await executeNitAdapters({
    candidateName: candidate.name,
    nit,
    countryCode: candidate.country_code ?? 'CO',
    sector: candidate.sector_code ?? candidate.sector_description ?? null,
    existingMetadata: meta,
    sourceKeys,
    registry: adapterRegistryOverride,
  });

  const persistResult = await persistEnrichmentResults(
    {
      candidateId: candidate.id,
      adapterResults,
      existingMetadata: meta,
      paeBlock,
    },
    supabase,
  );

  // Peru SUNAT enrichment — conditional, non-blocking, does not affect CO result
  if ((candidate.country_code ?? '').toUpperCase() === 'PE') {
    await runPeruSunatEnrichmentForCandidate(
      candidate,
      meta,
      supabase,
      peruLookupFnOverride,
    );
  }

  try {
    await insertPostApprovalAuditTrail(
      {
        candidateId: candidate.id,
        batchId: candidate.batch_id,
        accountId,
        finalStatus: persistResult.finalStatus,
        processedSourceKeys: persistResult.processedSourceKeys,
        matchedSourceKeys: persistResult.matchedSourceKeys,
        noMatchSourceKeys: persistResult.noMatchSourceKeys,
        skippedSourceKeys: persistResult.skippedSourceKeys,
        failedSourceKeys: persistResult.failedSourceKeys,
      },
      supabase,
    );
  } catch (auditErr) {
    // Audit failure is non-critical
    console.warn(
      `[PostApprovalNitWorker] Audit insert failed for ${candidate.id}:`,
      auditErr instanceof Error ? auditErr.message : String(auditErr),
    );
  }

  return { candidateId: candidate.id, finalStatus: persistResult.finalStatus };
}

// ── Main worker entry point ────────────────────────────────────────────────────

export async function runPostApprovalNitEnrichmentWorker(
  params: PostApprovalNitWorkerParams = {},
): Promise<PostApprovalNitEnrichmentStats> {
  const startTime = Date.now();
  const maxCandidates = params.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const supabase = params.supabase ?? getAdminSupabase();

  const stats: PostApprovalNitEnrichmentStats = {
    queued_found: 0,
    processed: 0,
    completed: 0,
    completed_with_warnings: 0,
    errors: 0,
    skipped: 0,
    duration_ms: 0,
  };

  let queued = await selectQueuedCandidates(supabase, maxCandidates);
  // Smoke/test guard — restrict to a single candidate when candidateId is set
  if (params.candidateId) {
    queued = queued.filter((c) => c.id === params.candidateId);
  }
  stats.queued_found = queued.length;

  for (const candidate of queued) {
    try {
      const result = await processCandidateNitEnrichment(
        candidate,
        supabase,
        params.adapterRegistryOverride,
        params.peruLookupFnOverride,
      );
      stats.processed++;

      switch (result.finalStatus) {
        case 'completed':
          stats.completed++;
          break;
        case 'completed_with_warnings':
          stats.completed_with_warnings++;
          break;
        case 'error':
          stats.errors++;
          break;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[PostApprovalNitWorker] Unhandled error for candidate ${candidate.id}:`,
        errMsg,
      );
      stats.errors++;
    }
  }

  stats.duration_ms = Date.now() - startTime;
  return stats;
}
