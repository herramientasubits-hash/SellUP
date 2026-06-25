/**
 * Prospect CTA Bridge — Agent 1 v1.16K-B
 *
 * Routing and input mapping for the "Generar con IA" CTA at /prospects.
 *
 * Feature flag: ENABLE_PROSPECTS_WRITER_PIPELINE_CTA
 *   false (default) → CTA routes to runProspectGenerationAgent (Apollo legacy)
 *   true            → CTA routes to runIncrementalProspectingSearch (writer pipeline / flujo B)
 *
 * Rules:
 *   - Pure mapping and flag-reading functions only — no side effects
 *   - No Tavily, no LLM, no Supabase, no Apollo calls in this module
 *   - Production caller (generateAIProspectBatch) passes webSearchProvider='tavily'
 *   - Tests override webSearchProvider='mock' to avoid external calls
 */

import type { IncrementalSearchInput, IncrementalSearchWebProvider } from './incremental-search-types';

// ─── Feature flag ─────────────────────────────────────────────────────────────

/** Env var name for the feature flag. Never use NEXT_PUBLIC_ prefix — server-only. */
export const WRITER_PIPELINE_CTA_FLAG = 'ENABLE_PROSPECTS_WRITER_PIPELINE_CTA';

/** Returns true when the writer pipeline CTA feature flag is explicitly enabled. */
export function isWriterPipelineCTAEnabled(): boolean {
  return process.env[WRITER_PIPELINE_CTA_FLAG] === 'true';
}

// ─── Input contract ───────────────────────────────────────────────────────────

/** Minimal fields from GenerateAIBatchInput needed by the bridge. */
export interface CTABridgeInput {
  country: string;
  countryCode: string;
  industry: string;
  targetCount: number;
  searchDepth: 'basic' | 'standard';
}

// ─── Input mapping ────────────────────────────────────────────────────────────

/**
 * Maps legacy CTA form input to IncrementalSearchInput for the writer pipeline.
 *
 * Field mapping:
 *   country / countryCode → preserved verbatim
 *   industry              → preserved verbatim
 *   targetCount           → targetInternal + targetPersistibleCandidates
 *   userId                → triggeredByUserId + ownerId
 *   batchName             → batchName
 *   webSearchProvider     → 'tavily' in production; 'mock' in tests
 */
export function buildIncrementalSearchInputFromCTAInput(
  input: CTABridgeInput,
  userId: string,
  batchName: string,
  webSearchProvider: IncrementalSearchWebProvider = 'tavily',
): IncrementalSearchInput {
  return {
    country: input.country,
    countryCode: input.countryCode,
    industry: input.industry,
    webSearchProvider,
    targetInternal: input.targetCount,
    targetPersistibleCandidates: input.targetCount,
    dryRun: false,
    triggeredByUserId: userId,
    ownerId: userId,
    batchName,
  };
}

// ─── Metadata markers ─────────────────────────────────────────────────────────

/**
 * Returns the extra batch metadata to stamp when the CTA uses the writer pipeline.
 * Merged into the batch's metadata.execution_path for traceability.
 */
export function buildWriterPipelineCTABatchMetadata(): Record<string, unknown> {
  return {
    execution_path: 'writer_pipeline_cta',
    legacy_apollo_bypassed: true,
    feature_flag: WRITER_PIPELINE_CTA_FLAG,
    icp_size_gate_enabled: true,
    employee_size_resolution_enabled: true,
    source_snippet_size_parser_enabled: true,
  };
}
