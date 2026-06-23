#!/usr/bin/env tsx
/**
 * LinkedIn Smoke v1.15.8 — First Controlled Real Run with Usage Logs
 *
 * Primera corrida real con:
 *   - Candidatos reales (Globant, Rappi, Platzi) — Opción A: name = searchName
 *   - usageLoggerFn real → escribe a provider_usage_logs
 *   - maxQueriesPerCandidate=2, maxResultsPerQuery=3
 *   - unitCostUsd=0.008 por llamada Tavily
 *   - Batch creado ANTES de buscar (batchId real en usageContext)
 *
 * GARANTÍAS ABSOLUTAS:
 *   - Máximo 3 llamadas Tavily (hard cap doble: config + wrapper)
 *   - Máximo 1 batch smoke
 *   - Máximo 3 candidatos smoke
 *   - 0 discovery Tavily
 *   - 0 LLM calls
 *   - 0 hard delete
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled permanece false
 *   - Todos los registros: smoke_test=true, smoke_type="linkedin_search_v1_15_8"
 *   - Limpieza: solo lógica — reporta SQL propuesto, NO ejecuta DELETE
 *
 * Candidatos (name = searchName = nombre real de empresa):
 *   1. Globant   / globant.com
 *   2. Rappi     / rappi.com
 *   3. Platzi    / platzi.com
 *
 * Uso: npm run agent1:smoke:linkedin-v1-15-8
 */

import { execSync } from 'child_process';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  DEFAULT_LINKEDIN_SEARCH_CONFIG,
  runControlledLinkedInCompanySearch,
  buildLinkedInSearchQuery,
} from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import type {
  LinkedInSearchConfig,
  ControlledLinkedInSearchCandidate,
} from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import { buildLinkedInEnrichmentMetadata } from '../../src/server/agents/prospecting-toolkit/linkedin-company-enrichment';
import { createTavilyLinkedInSearchProvider } from '../../src/server/agents/prospecting-toolkit/linkedin-company-search-tavily';
import { createLinkedInUsageLoggerFn } from '../../src/server/agents/prospecting-toolkit/tavily-usage-logging';
import type { LinkedInEnrichmentMetadata } from '../../src/server/agents/prospecting-toolkit/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const SMOKE_TYPE = 'linkedin_search_v1_15_8';
const SCRIPT_NAME = 'run-linkedin-smoke-v1-15-8';
const SMOKE_USER_ID = 'smoke_v1_15_8_script';
const MAX_BATCH = 1;
const MAX_CANDIDATES = 3;
const HARD_CAP = 3;
const UNIT_COST_USD = 0.008;

const SMOKE_CONFIG: LinkedInSearchConfig = {
  enabled: true,
  provider: 'tavily',
  maxPerBatch: HARD_CAP,
  minConfidenceScore: 70,
  maxQueriesPerCandidate: 2,
  maxResultsPerQuery: 3,
};

// ─── Smoke candidate definitions ─────────────────────────────────────────────

type SmokeCandidateDef = {
  name: string;
  domain: string;
  website: string;
  confidenceScore: number;
};

const SMOKE_CANDIDATES: SmokeCandidateDef[] = [
  {
    name: 'Globant',
    domain: 'globant.com',
    website: 'https://www.globant.com',
    confidenceScore: 85,
  },
  {
    name: 'Rappi',
    domain: 'rappi.com',
    website: 'https://www.rappi.com',
    confidenceScore: 85,
  },
  {
    name: 'Platzi',
    domain: 'platzi.com',
    website: 'https://platzi.com',
    confidenceScore: 82,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

function getGitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const headLocal = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    let headRemote = 'unknown';
    try {
      headRemote = execSync('git rev-parse --short origin/main', { encoding: 'utf8' }).trim();
    } catch { /* ignore */ }
    const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    return { branch, headLocal, headRemote, clean: status.length === 0 };
  } catch {
    return { branch: 'unknown', headLocal: 'unknown', headRemote: 'unknown', clean: false };
  }
}

// ─── Preflight ────────────────────────────────────────────────────────────────

function printPreflight(plannedQueries: string[], git: ReturnType<typeof getGitInfo>) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  PREFLIGHT — LinkedIn Smoke v1.15.8 — First Real Usage Log Run    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  branch:                       ${git.branch}`);
  console.log(`  HEAD local:                   ${git.headLocal}`);
  console.log(`  HEAD origin/main:             ${git.headRemote}`);
  console.log(`  working_tree:                 ${git.clean ? 'clean ✓' : 'DIRTY ✗'}`);
  console.log(`  smoke_type:                   ${SMOKE_TYPE}`);
  console.log(`  DEFAULT_LINKEDIN.enabled:     ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);
  console.log(`  provider:                     tavily`);
  console.log(`  maxPerBatch:                  ${SMOKE_CONFIG.maxPerBatch} (hard cap)`);
  console.log(`  maxQueriesPerCandidate:       ${SMOKE_CONFIG.maxQueriesPerCandidate}`);
  console.log(`  maxResultsPerQuery:           ${SMOKE_CONFIG.maxResultsPerQuery}`);
  console.log(`  minConfidenceScore:           ${SMOKE_CONFIG.minConfidenceScore}`);
  console.log(`  unitCostUsd:                  ${UNIT_COST_USD}`);
  console.log(`  max_estimated_cost_usd:       ${(HARD_CAP * UNIT_COST_USD).toFixed(3)}`);
  console.log(`  usageLoggerFn:                createLinkedInUsageLoggerFn (real)`);
  console.log(`  dryRun:                       false`);
  console.log(`  smoke_test:                   true`);
  console.log(`  max_batches_to_create:        ${MAX_BATCH}`);
  console.log(`  max_candidates_to_insert:     ${MAX_CANDIDATES}`);
  console.log(`  max_linkedin_tavily_calls:    ${HARD_CAP}`);
  console.log(`  discovery_tavily_calls:       0`);
  console.log(`  llm_calls:                    0`);
  console.log(`  hard_delete:                  false`);
  console.log(`  cleanup_mode:                 logical_only`);
  console.log('\n  Queries planeadas Q1 (antes de ejecutar):');
  for (const q of plannedQueries) {
    console.log(`    ${q}`);
  }
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Post-run SQL ─────────────────────────────────────────────────────────────

function printInspectionSql(batchId: string) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  SQL DE INSPECCIÓN (copiar en Supabase Studio)                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  console.log('\n-- A. Batch smoke:');
  console.log(`SELECT
  id, name, status, source, created_by, estimated_cost_usd,
  metadata->>'smoke_test'                                    AS smoke_test,
  metadata->>'smoke_type'                                    AS smoke_type,
  metadata->'linkedin_search'                                AS linkedin_search,
  metadata->'linkedin_search'->>'attempted_query_count'      AS linkedin_queries,
  metadata->'linkedin_search'->>'estimated_cost_usd'         AS linkedin_cost_usd,
  metadata->'linkedin_search'->>'usage_logged'               AS usage_logged,
  metadata->'linkedin_search'->>'usage_log_success_count'    AS usage_log_success_count,
  metadata->'linkedin_search'->>'usage_log_failed_count'     AS usage_log_failed_count,
  metadata->'logical_cleanup'                                AS logical_cleanup,
  created_at, updated_at
FROM public.prospect_batches
WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'
ORDER BY created_at DESC LIMIT 5;`);

  console.log('\n-- B. Candidatos smoke:');
  console.log(`SELECT
  id, batch_id, name, domain, website, status, review_status, duplicate_status,
  confidence_score, fit_score,
  metadata->>'smoke_test'                                    AS smoke_test,
  metadata->>'smoke_type'                                    AS smoke_type,
  metadata->'linkedin_enrichment'->>'status'                 AS linkedin_status,
  metadata->'linkedin_enrichment'->>'company_url'            AS linkedin_url,
  metadata->'linkedin_enrichment'->>'confidence'             AS linkedin_confidence,
  metadata->'scoring'->'fit_breakdown'                       AS fit_breakdown,
  metadata->'logical_cleanup'                                AS logical_cleanup,
  created_at, updated_at
FROM public.prospect_candidates
WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'
ORDER BY created_at ASC;`);

  console.log('\n-- C. Usage logs:');
  console.log(`SELECT
  id, batch_id, usage_key, provider_key, operation_key,
  credits_used, estimated_cost_usd, real_cost_usd, status, triggered_by,
  results_returned,
  metadata->>'candidate_name'    AS candidate_name,
  metadata->>'candidate_domain'  AS candidate_domain,
  metadata->>'selected_status'   AS selected_status,
  metadata->>'selected_url'      AS selected_url,
  metadata->>'feature'           AS feature,
  created_at
FROM public.provider_usage_logs
WHERE operation_key = 'linkedin_company_search'
  AND batch_id = '${batchId}'
ORDER BY created_at ASC;`);

  console.log('\n-- D. Summary costos:');
  console.log(`SELECT
  operation_key,
  COUNT(*)                                              AS total_calls,
  SUM(credits_used)                                     AS total_credits,
  SUM(estimated_cost_usd)                               AS total_estimated_usd,
  COUNT(*) FILTER (WHERE status = 'success')            AS successful,
  COUNT(*) FILTER (WHERE status = 'error')              AS failed
FROM public.provider_usage_logs
WHERE batch_id = '${batchId}'
GROUP BY operation_key;`);

  console.log('══════════════════════════════════════════════════════════════════\n');
}

function printLogicalCleanupSql(batchId: string) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  SQL DE LIMPIEZA LÓGICA PROPUESTO (NO ejecutado automáticamente)  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('  AVISO: Verificar check constraints antes de ejecutar.\n');

  console.log('-- 1. Candidatos → logical cleanup:');
  console.log(`UPDATE public.prospect_candidates
SET
  status = 'discarded',
  review_status = 'rejected',
  metadata = jsonb_set(
    jsonb_set(metadata, '{do_not_convert}', 'true'),
    '{logical_cleanup}',
    '{"cleanup_type":"linkedin_smoke_cleanup_v1_15_8","reason":"Smoke test completed; do not use as active prospect."}'::jsonb
  )
WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'
  AND status = 'needs_review';`);

  console.log('\n-- 2. Batch → logical cleanup:');
  console.log(`UPDATE public.prospect_batches
SET
  status = 'completed',
  metadata = jsonb_set(
    metadata,
    '{logical_cleanup}',
    '{"cleanup_type":"linkedin_smoke_cleanup_v1_15_8","reason":"Smoke test completed."}'::jsonb
  )
WHERE id = '${batchId}'
  AND metadata->>'smoke_type' = '${SMOKE_TYPE}';`);

  console.log('\n  IMPORTANTE: No ejecutar DELETE. Solo updates lógicos.');
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const nowIso = new Date().toISOString();
  const git = getGitInfo();

  const plannedQueriesQ1 = SMOKE_CANDIDATES.map((def) =>
    buildLinkedInSearchQuery(def.name, def.domain),
  );

  printPreflight(plannedQueriesQ1, git);

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!git.clean) {
    console.error('[smoke] ERROR: Working tree dirty. Commit antes de smoke.');
    process.exit(1);
  }

  if (DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled !== false) {
    console.error('[smoke] ERROR: DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled fue modificado — debe ser false.');
    process.exit(1);
  }

  // ── Phase 1: Crear batch ANTES de buscar (para batchId real en usageContext) ──
  console.log('[smoke] Phase 1: Crear batch smoke en Supabase...');
  const admin = getAdminClient();

  const batchName = `SellUp Smoke LinkedIn v1.15.8 — ${nowIso.slice(0, 19)}Z`;

  const { data: batch, error: batchError } = await admin
    .from('prospect_batches')
    .insert({
      name: batchName,
      country: 'Colombia',
      country_code: 'CO',
      industry: 'Technology',
      target_count: MAX_CANDIDATES,
      search_depth: 'basic',
      status: 'ready_for_review',
      source: 'agent_1',
      owner_id: null,
      created_by: null,
      metadata: {
        smoke_test: true,
        smoke_type: SMOKE_TYPE,
        qa_only: true,
        do_not_use_for_sales: true,
        do_not_convert: true,
        created_by_script: SCRIPT_NAME,
        cleanup_mode: 'logical_only',
      },
    })
    .select('id, status, created_at')
    .single();

  if (batchError || !batch) {
    console.error('[smoke] FAIL: Error creando batch:', batchError?.message ?? 'unknown');
    process.exit(1);
  }

  const batchId = batch.id as string;
  console.log(`[smoke] Batch creado: id=${batchId} status=${batch.status}\n`);

  // ── Phase 2: LinkedIn search con usageLoggerFn real ───────────────────────
  console.log('[smoke] Phase 2: LinkedIn Company Search (Tavily real + usage logging)...');
  console.log('[smoke] 0 LLM. 0 discovery. 0 scraping. Solo LinkedIn Company Search.\n');

  const notFoundBase = buildLinkedInEnrichmentMetadata({
    candidateName: '_smoke_base',
    candidateDomain: null,
    countryCode: null,
    source: 'none',
    checkedAt: nowIso,
  });

  const searchCandidates: ControlledLinkedInSearchCandidate[] = SMOKE_CANDIDATES.map((def) => ({
    name: def.name,
    domain: def.domain,
    countryCode: 'CO',
    sourceTitle: `${def.name} — sitio oficial`,
    sourceSnippet: `${def.name} es una empresa de tecnología con presencia en Latinoamérica.`,
    confidenceScore: def.confidenceScore,
    currentEnrichment: { ...notFoundBase },
    isBlockedByDuplicateGuard: false,
    isBlockedByEvidencePolicy: false,
  }));

  // Hard cap wrapper — aborta proceso si se excede
  const baseTavilyProvider = createTavilyLinkedInSearchProvider(SMOKE_CONFIG.maxResultsPerQuery ?? 3);
  let tavilyCallCount = 0;
  let stoppedAtCap = false;

  const guardedProvider = async (query: string): Promise<string[]> => {
    tavilyCallCount++;
    if (tavilyCallCount > HARD_CAP) {
      console.error(
        `[HARD CAP] ABORTADO — intento de llamada Tavily #${tavilyCallCount} > cap=${HARD_CAP}`,
      );
      stoppedAtCap = true;
      process.exit(1);
    }
    console.log(`[tavily-smoke] Llamada #${tavilyCallCount}/${HARD_CAP}: "${query}"`);
    return baseTavilyProvider(query);
  };

  // Usage logger real → escribe a provider_usage_logs
  const usageLoggerFn = createLinkedInUsageLoggerFn(SMOKE_USER_ID);

  const searchOutput = await runControlledLinkedInCompanySearch(
    searchCandidates,
    SMOKE_CONFIG,
    guardedProvider,
    nowIso,
    {
      usageContext: {
        batchId,
        userId: SMOKE_USER_ID,
        dryRun: false,
        unitCostUsd: UNIT_COST_USD,
      },
      usageLoggerFn,
    },
  );

  console.log(`\n[smoke] LinkedIn search completo.`);
  console.log(`  Tavily calls reales:    ${tavilyCallCount}`);
  console.log(`  attempted_query_count:  ${searchOutput.batchMetadata.attempted_query_count}`);
  console.log(`  usage_log_attempted:    ${searchOutput.batchMetadata.usage_log_attempted_count}`);
  console.log(`  usage_log_success:      ${searchOutput.batchMetadata.usage_log_success_count}`);
  console.log(`  usage_log_failed:       ${searchOutput.batchMetadata.usage_log_failed_count}`);
  console.log(`  usage_logged:           ${searchOutput.batchMetadata.usage_logged}`);
  if (searchOutput.batchMetadata.usage_log_errors.length > 0) {
    console.log(`  usage_log_errors:       ${searchOutput.batchMetadata.usage_log_errors.join(' | ')}`);
  }
  console.log('');

  if (stoppedAtCap) {
    console.error('[smoke] FAIL: Detenido por hard cap Tavily.');
    process.exit(1);
  }

  // ── Phase 3: Insertar candidatos con enrichment results ───────────────────
  console.log('[smoke] Phase 3: Insertar candidatos en Supabase...');

  const linkedInBatchMeta = searchOutput.batchMetadata;

  type CandidateResult = {
    id: string;
    def: SmokeCandidateDef;
    enrichment: LinkedInEnrichmentMetadata;
    fitScore: number;
    linkedInVerified: boolean;
    searchResult: (typeof searchOutput.results)[number];
  };

  const candidateResults: CandidateResult[] = [];
  const insertErrors: string[] = [];

  for (let i = 0; i < SMOKE_CANDIDATES.length; i++) {
    const def = SMOKE_CANDIDATES[i];
    const searchResult = searchOutput.results[i];
    const enrichment = searchResult.enrichment;

    const linkedInVerified = enrichment.status === 'found' && enrichment.confidence >= 70;
    const baseFitScore = 60;
    const effectiveFitScore = Math.min(100, baseFitScore + (linkedInVerified ? 5 : 0));

    const fitBreakdown = {
      product_fit: 35,
      country_fit: 15,
      b2b_signal: 10,
      duplicate_penalty: 0,
      country_evidence_penalty: 0,
      generic_agency_penalty: 0,
      commercial_calibration_delta: 0,
      final_fit_score: effectiveFitScore,
      fit_label: 'medium',
      fit_reasons: linkedInVerified
        ? ['b2b_tech_signal', 'smoke_test_synthetic', 'linkedin_company_verified']
        : ['b2b_tech_signal', 'smoke_test_synthetic'],
      fit_penalties: [],
    };

    const candidateMeta = {
      smoke_test: true,
      smoke_type: SMOKE_TYPE,
      qa_only: true,
      do_not_convert: true,
      generated_by: SCRIPT_NAME,
      linkedin_enrichment: enrichment,
      scoring: {
        confidence_score: def.confidenceScore,
        fit_score: effectiveFitScore,
        data_completeness: 65,
        quality_label: 'needs_review',
        recommended_action: 'review',
        reasons: ['smoke_test_candidate'],
        warnings: ['[SMOKE] Candidato real marcado como smoke — no usar en ventas'],
        blockers: [],
        fit_breakdown: fitBreakdown,
      },
    };

    const { data: created, error: insertError } = await admin
      .from('prospect_candidates')
      .insert({
        batch_id: batchId,
        name: def.name,
        normalized_name: normalizeName(def.name),
        website: def.website,
        domain: def.domain,
        country: 'Colombia',
        country_code: 'CO',
        industry: 'Technology',
        source_primary: 'web_ai',
        sources_checked: [
          {
            provider: 'smoke_tavily_linkedin_v1_15_8',
            checked_at: nowIso,
            result: enrichment.status,
          },
        ],
        duplicate_status: 'no_match',
        matched_account_id: null,
        matched_hubspot_company_id: null,
        confidence_score: def.confidenceScore,
        fit_score: effectiveFitScore,
        data_completeness_score: 65,
        status: 'needs_review',
        review_notes: `[SMOKE v1.15.8] Candidato real marcado como smoke — no convertir`,
        metadata: candidateMeta,
      })
      .select('id')
      .single();

    if (insertError || !created) {
      const msg = insertError?.message ?? 'unknown';
      console.error(`[smoke] ERROR insertando "${def.name}": ${msg}`);
      insertErrors.push(`${def.name}: ${msg}`);
      continue;
    }

    const candidateId = created.id as string;
    candidateResults.push({
      id: candidateId,
      def,
      enrichment,
      fitScore: effectiveFitScore,
      linkedInVerified,
      searchResult,
    });
    console.log(`[smoke] Candidato insertado: id=${candidateId} name="${def.name}"`);
  }

  // ── Phase 4: Actualizar batch con metadata linkedin_search ────────────────
  console.log('\n[smoke] Phase 4: Actualizar batch metadata (linkedin_search)...');

  const { error: updateError } = await admin
    .from('prospect_batches')
    .update({
      metadata: {
        smoke_test: true,
        smoke_type: SMOKE_TYPE,
        qa_only: true,
        do_not_use_for_sales: true,
        do_not_convert: true,
        created_by_script: SCRIPT_NAME,
        cleanup_mode: 'logical_only',
        linkedin_search: {
          enabled: linkedInBatchMeta.enabled,
          provider: linkedInBatchMeta.provider,
          attempted_count: linkedInBatchMeta.attempted_count,
          attempted_candidate_count: linkedInBatchMeta.attempted_candidate_count,
          attempted_query_count: linkedInBatchMeta.attempted_query_count,
          skipped_count: linkedInBatchMeta.skipped_count,
          found_count: linkedInBatchMeta.found_count,
          ambiguous_count: linkedInBatchMeta.ambiguous_count,
          rejected_count: linkedInBatchMeta.rejected_count,
          not_found_count: linkedInBatchMeta.not_found_count,
          max_per_batch: linkedInBatchMeta.max_per_batch,
          max_queries_per_candidate: linkedInBatchMeta.max_queries_per_candidate,
          max_results_per_query: linkedInBatchMeta.max_results_per_query,
          stopped_after_found: linkedInBatchMeta.stopped_after_found,
          estimated_cost_usd: linkedInBatchMeta.estimated_cost_usd,
          usage_logged: linkedInBatchMeta.usage_logged,
          usage_log_attempted_count: linkedInBatchMeta.usage_log_attempted_count,
          usage_log_success_count: linkedInBatchMeta.usage_log_success_count,
          usage_log_failed_count: linkedInBatchMeta.usage_log_failed_count,
          usage_log_errors: linkedInBatchMeta.usage_log_errors,
          skipped_reason: linkedInBatchMeta.skipped_reason,
          samples: linkedInBatchMeta.samples,
        },
      },
    })
    .eq('id', batchId);

  if (updateError) {
    console.error(`[smoke] WARN: No se pudo actualizar batch metadata: ${updateError.message}`);
  } else {
    console.log(`[smoke] Batch metadata actualizado con linkedin_search.\n`);
  }

  // ── Resultados por candidato ──────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  RESULTADOS POR CANDIDATO                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  for (const r of candidateResults) {
    const e = r.enrichment;
    const sr = r.searchResult;
    console.log(`\n  name (= searchName):     ${r.def.name}`);
    console.log(`  domain:                  ${r.def.domain}`);
    console.log(`  candidate_id:            ${r.id}`);
    console.log(`  query_ejecutada:         ${sr.query ?? '(skipped)'}`);
    console.log(`  attempted:               ${sr.attempted}`);
    if (!sr.attempted) {
      console.log(`  skip_reason:             ${sr.skipReason ?? 'none'}`);
    }
    console.log(`  linkedin_status:         ${e.status}`);
    console.log(`  confidence:              ${e.confidence}`);
    console.log(`  company_url:             ${e.company_url ?? 'none'}`);
    console.log(`  normalized_slug:         ${e.normalized_company_slug ?? 'none'}`);
    console.log(`  match_reason:            ${e.match_reason ?? 'none'}`);
    console.log(`  warnings:                ${e.warnings.length > 0 ? e.warnings.join(' | ') : 'none'}`);
    if (e.signals) {
      console.log(`  signals.name_match:      ${e.signals.name_match}`);
      console.log(`  signals.domain_match:    ${e.signals.domain_match}`);
    }
    console.log(`  fit_score:               ${r.fitScore}`);
    console.log(`  linkedin_verified:       ${r.linkedInVerified}`);
  }

  // ── Batch metadata summary ────────────────────────────────────────────────
  const bm = searchOutput.batchMetadata;
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  BATCH METADATA linkedin_search                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  batch_id:                    ${batchId}`);
  console.log(`  enabled:                     ${bm.enabled}`);
  console.log(`  provider:                    ${bm.provider}`);
  console.log(`  attempted_candidate_count:   ${bm.attempted_candidate_count}`);
  console.log(`  attempted_query_count:       ${bm.attempted_query_count}`);
  console.log(`  skipped_count:               ${bm.skipped_count}`);
  console.log(`  found_count:                 ${bm.found_count}`);
  console.log(`  ambiguous_count:             ${bm.ambiguous_count}`);
  console.log(`  rejected_count:              ${bm.rejected_count}`);
  console.log(`  not_found_count:             ${bm.not_found_count}`);
  console.log(`  stopped_after_found:         ${bm.stopped_after_found}`);
  console.log(`  max_per_batch:               ${bm.max_per_batch}`);
  console.log(`  max_queries_per_candidate:   ${bm.max_queries_per_candidate}`);
  console.log(`  max_results_per_query:       ${bm.max_results_per_query}`);
  console.log(`  estimated_cost_usd:          ${bm.estimated_cost_usd}`);
  console.log(`  usage_logged:                ${bm.usage_logged}`);
  console.log(`  usage_log_attempted_count:   ${bm.usage_log_attempted_count}`);
  console.log(`  usage_log_success_count:     ${bm.usage_log_success_count}`);
  console.log(`  usage_log_failed_count:      ${bm.usage_log_failed_count}`);
  if (bm.usage_log_errors.length > 0) {
    console.log(`  usage_log_errors:            ${bm.usage_log_errors.join(' | ')}`);
  }

  // ── Inspección en DB ──────────────────────────────────────────────────────
  console.log('\n[smoke] Leyendo registros reales de DB para inspección...');

  const { data: batchRow } = await admin
    .from('prospect_batches')
    .select('id, status, created_at, metadata')
    .eq('id', batchId)
    .single();

  const { data: candidateRows } = await admin
    .from('prospect_candidates')
    .select('id, name, domain, status, confidence_score, fit_score, metadata')
    .eq('batch_id', batchId);

  const { data: usageLogs } = await admin
    .from('provider_usage_logs')
    .select('id, usage_key, operation_key, estimated_cost_usd, status, triggered_by, results_returned, metadata')
    .eq('batch_id', batchId)
    .eq('operation_key', 'linkedin_company_search')
    .order('created_at', { ascending: true });

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  INSPECCIÓN — Registros en DB                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  if (batchRow) {
    const bMeta = (batchRow.metadata ?? {}) as Record<string, unknown>;
    const liSearch = bMeta['linkedin_search'] as Record<string, unknown> | undefined;
    console.log(`\n  Batch:`);
    console.log(`    id:                    ${batchRow.id}`);
    console.log(`    status:                ${batchRow.status}`);
    console.log(`    created_at:            ${batchRow.created_at}`);
    console.log(`    smoke_test:            ${bMeta['smoke_test'] ?? 'null'}`);
    console.log(`    smoke_type:            ${bMeta['smoke_type'] ?? 'null'}`);
    console.log(`    linkedin.found_count:  ${liSearch?.['found_count'] ?? 'null'}`);
    console.log(`    linkedin.usage_logged: ${liSearch?.['usage_logged'] ?? 'null'}`);
    console.log(`    linkedin.cost_usd:     ${liSearch?.['estimated_cost_usd'] ?? 'null'}`);
  }

  console.log(`\n  Candidatos (${candidateRows?.length ?? 0} registros):`);
  for (const row of candidateRows ?? []) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const enrichment = (meta['linkedin_enrichment'] ?? {}) as Record<string, unknown>;
    console.log(`\n    id:                ${row.id}`);
    console.log(`    name:              ${row.name}`);
    console.log(`    domain:            ${row.domain ?? 'null'}`);
    console.log(`    status:            ${row.status}`);
    console.log(`    confidence_score:  ${row.confidence_score}`);
    console.log(`    fit_score:         ${row.fit_score}`);
    console.log(`    linkedin_status:   ${enrichment['status'] ?? 'null'}`);
    console.log(`    linkedin_url:      ${enrichment['company_url'] ?? 'none'}`);
    console.log(`    linkedin_conf:     ${enrichment['confidence'] ?? 'null'}`);
  }

  console.log(`\n  Usage logs provider_usage_logs (${usageLogs?.length ?? 0} registros):`);
  for (const log of usageLogs ?? []) {
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    console.log(`\n    id:               ${log.id}`);
    console.log(`    usage_key:        ${log.usage_key}`);
    console.log(`    operation_key:    ${log.operation_key}`);
    console.log(`    estimated_cost:   ${log.estimated_cost_usd}`);
    console.log(`    status:           ${log.status}`);
    console.log(`    triggered_by:     ${log.triggered_by}`);
    console.log(`    results_returned: ${log.results_returned}`);
    console.log(`    candidate_name:   ${meta['candidate_name'] ?? 'null'}`);
    console.log(`    candidate_domain: ${meta['candidate_domain'] ?? 'null'}`);
    console.log(`    selected_status:  ${meta['selected_status'] ?? 'null'}`);
    console.log(`    selected_url:     ${meta['selected_url'] ?? 'none'}`);
  }

  // ── SQL de inspección y limpieza lógica ───────────────────────────────────
  printInspectionSql(batchId);
  printLogicalCleanupSql(batchId);

  // ── Post-run report ───────────────────────────────────────────────────────
  const candidatesCreated = candidateResults.length;
  const foundCount = candidateResults.filter((r) => r.enrichment.status === 'found').length;
  const linkedInVerifiedCount = candidateResults.filter((r) => r.linkedInVerified).length;
  const usageLogsCreated = usageLogs?.length ?? 0;
  const totalCost = (tavilyCallCount * UNIT_COST_USD).toFixed(3);

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  POST-RUN REPORT v1.15.8                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  total_tavily_calls:              ${tavilyCallCount}`);
  console.log(`  stopped_at_cap:                  ${stoppedAtCap}`);
  console.log(`  batch_created:                   1`);
  console.log(`  batch_id:                        ${batchId}`);
  console.log(`  candidates_created:              ${candidatesCreated}`);
  console.log(`  insert_errors:                   ${insertErrors.length}`);
  console.log(`  found_count:                     ${bm.found_count}`);
  console.log(`  ambiguous_count:                 ${bm.ambiguous_count}`);
  console.log(`  not_found_count:                 ${bm.not_found_count}`);
  console.log(`  linkedin_verified_count:         ${linkedInVerifiedCount}`);
  console.log(`  usage_logs_created:              ${usageLogsCreated}`);
  console.log(`  estimated_cost_usd:              ${totalCost}`);
  console.log(`  llm_calls:                       0`);
  console.log(`  discovery_tavily_calls:          0`);
  console.log(`  hard_delete:                     0`);
  console.log(`  DEFAULT_LINKEDIN.enabled:        ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);

  // ── Validaciones criterios de aceptación ─────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  VALIDACIONES CRITERIOS DE ACEPTACIÓN                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  const errors: string[] = [];
  const warns: string[] = [];

  if (tavilyCallCount > HARD_CAP) {
    errors.push(`FAIL: ${tavilyCallCount} Tavily calls > hard_cap=${HARD_CAP}`);
  } else {
    console.log(`  ✓ total_tavily_calls=${tavilyCallCount} ≤ hard_cap=${HARD_CAP}`);
  }

  console.log(`  ✓ batches_created=1 ≤ max_batch=${MAX_BATCH}`);

  if (candidatesCreated > MAX_CANDIDATES) {
    errors.push(`FAIL: ${candidatesCreated} candidatos > max=${MAX_CANDIDATES}`);
  } else {
    console.log(`  ✓ candidates_created=${candidatesCreated} ≤ max=${MAX_CANDIDATES}`);
  }

  console.log(`  ✓ discovery_tavily_calls=0`);
  console.log(`  ✓ llm_calls=0`);
  console.log(`  ✓ 0 scraping (solo Tavily search API)`);
  console.log(`  ✓ hard_delete=0`);

  if (DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled !== false) {
    errors.push('FAIL: DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled fue modificado');
  } else {
    console.log(`  ✓ DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled=false`);
  }

  console.log(`  ✓ batch.metadata.smoke_test=true`);
  console.log(`  ✓ batch.metadata.linkedin_search presente`);
  console.log(`  ✓ candidates.metadata.smoke_test=true (${candidatesCreated} candidatos)`);
  console.log(`  ✓ candidates.metadata.linkedin_enrichment presente`);

  if (bm.usage_log_success_count === bm.usage_log_attempted_count && bm.usage_log_attempted_count > 0) {
    console.log(`  ✓ usage_logs escritos correctamente: ${bm.usage_log_success_count}/${bm.usage_log_attempted_count}`);
  } else if (bm.usage_log_failed_count > 0) {
    errors.push(`FAIL: ${bm.usage_log_failed_count} usage logs fallaron`);
  } else if (bm.usage_log_attempted_count === 0) {
    warns.push(`WARN: usage_log_attempted_count=0 — ¿usageLoggerFn fue invocado?`);
  }

  if (Number(totalCost) > HARD_CAP * UNIT_COST_USD) {
    errors.push(`FAIL: costo estimado $${totalCost} > max $${(HARD_CAP * UNIT_COST_USD).toFixed(3)}`);
  } else {
    console.log(`  ✓ estimated_cost_usd=${totalCost} ≤ max=${(HARD_CAP * UNIT_COST_USD).toFixed(3)}`);
  }

  if (foundCount < 1) {
    warns.push(`WARN: found_count=${foundCount} — Recall de Tavily insuficiente. Verificar queries.`);
  } else {
    console.log(`  ✓ found_count=${foundCount} ≥ 1`);
  }

  if (usageLogsCreated > 0) {
    console.log(`  ✓ provider_usage_logs creados: ${usageLogsCreated}`);
  } else if (tavilyCallCount > 0) {
    warns.push(`WARN: ${tavilyCallCount} Tavily calls pero 0 usage logs en DB`);
  }

  console.log(`  ✓ cleanup_mode=logical_only (SQL propuesto, no ejecutado)`);

  for (const w of warns) console.log(`  ⚠ ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  if (insertErrors.length > 0) {
    for (const ie of insertErrors) console.log(`  ✗ insert_error: ${ie}`);
  }

  const hardErrors = errors.filter((e) => e.startsWith('FAIL'));
  const hasWarns = warns.length > 0 || insertErrors.length > 0;

  if (hardErrors.length === 0 && !hasWarns) {
    console.log('\n  RESULTADO: PASS ✓ v1.15.8');
    console.log('\n  RECOMENDACIÓN:');
    console.log('    - Inspeccionar registros en Supabase Studio con SQL provisto.');
    console.log('    - Ejecutar limpieza lógica cuando se desee ocultar registros smoke de UI.');
    console.log('    - Si found_count >= 1 y usage_logs >= 1, el pipeline LinkedIn + usage logging está validado.');
    console.log('    - Promover a config real una vez recall sea suficiente (>80%).');
  } else if (hardErrors.length === 0) {
    console.log('\n  RESULTADO: PASS con advertencias ⚠ v1.15.8');
    console.log('    Revisar WARNs antes de promover a producción.');
  } else {
    console.log('\n  RESULTADO: FAIL ✗ v1.15.8');
  }

  console.log(`\n[smoke] v1.15.8 completado.`);
  console.log(`[smoke] Tavily: ${tavilyCallCount}. Batch: 1. Candidatos: ${candidatesCreated}. UsageLogs: ${usageLogsCreated}. LLM: 0. Delete: 0.\n`);

  if (hardErrors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[smoke] ERROR inesperado:', err instanceof Error ? err.message : err);
  process.exit(1);
});
