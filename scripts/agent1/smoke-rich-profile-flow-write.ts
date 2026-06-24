#!/usr/bin/env tsx
/**
 * Smoke — Rich Profile Flow Write
 *
 * PROPÓSITO:
 *   Validar el flujo real de escritura de candidatos con rich_profile_enrichment
 *   activado por override, usando writeProspectingCandidates directamente con
 *   un pipelineOutput sintético.
 *
 * GARANTÍAS:
 *   - Máximo 1 Tavily call (hard cap + config.maxPerBatch=1)
 *   - 1 batch smoke insert en public.prospect_batches
 *   - 1 prospect_candidate smoke insert en public.prospect_candidates
 *   - 1 provider_usage_logs insert (loggeado internamente por writeProspectingCandidates)
 *   - 0 LLM calls
 *   - 0 discovery Tavily calls (web search skipped=true en pipeline output sintético)
 *   - 0 hard DELETE
 *   - DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled permanece false
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled permanece false
 *   - batch metadata: smoke_test=true, cleanup_mode=logical_only
 *
 * CANDIDATO:
 *   Configurable vía env vars (ver resolveWriteSmokeConfig).
 *   Defaults: Sofka | sofka.com.co | Colombia (backwards compat).
 *   Globant: usar npm run agent1:smoke:rich-profile-flow-write:globant
 *
 * EJECUCIÓN (requiere autorización explícita):
 *   npm run agent1:smoke:rich-profile-flow-write              ← Sofka (default)
 *   npm run agent1:smoke:rich-profile-flow-write:globant      ← Globant
 *
 * NOTA: Este script requiere que el usuario haya revisado y autorizado
 *       explícitamente el Preflight Report antes de ejecutar.
 */

import { execSync } from 'child_process';
import {
  writeProspectingCandidates,
} from '../../src/server/agents/prospecting-toolkit/candidate-writer';
import {
  DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
  type RichProfileEnrichmentConfig,
} from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment';
import { createTavilyRichProfileEnrichmentProvider } from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment-tavily';
import { createRichProfileEnrichmentUsageLoggerFn } from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment-usage-logging';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import { resolveWriteSmokeConfig } from '../../src/server/agents/prospecting-toolkit/rich-profile-calibration-config';
import type {
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
  CandidateWriterInput,
  SearchDepth,
} from '../../src/server/agents/prospecting-toolkit/types';

// ─── Resolve config from env vars ────────────────────────────────────────────

const CONFIG = resolveWriteSmokeConfig(process.env);

// Tavily uses 'basic'|'advanced'; pipeline SearchDepth is 'basic'|'standard'|'deep'
const PIPELINE_SEARCH_DEPTH: SearchDepth = CONFIG.searchDepth === 'advanced' ? 'deep' : 'basic';

// ─── Constants ────────────────────────────────────────────────────────────────

const SMOKE_TYPE = CONFIG.smokeType;
const SCRIPT_NAME = CONFIG.scriptName;
const UNIT_COST_USD = 0.008;         // Tavily basic search — per provider_pricing_config
const HARD_CAP_TAVILY_CALLS = 1;

// userId real — egarcia@ubits.co (verificado en preflight)
const AUTHORIZED_USER_ID = '5a8fb462-eecb-41f2-bfab-2c8fb6e3f73c';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function printPreflight(git: ReturnType<typeof getGitInfo>) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  PREFLIGHT — Rich Profile Flow Write Smoke                        ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  branch:                               ${git.branch}`);
  console.log(`  HEAD local:                           ${git.headLocal}`);
  console.log(`  HEAD origin/main:                     ${git.headRemote}`);
  console.log(`  working_tree:                         ${git.clean ? 'clean ✓' : 'DIRTY (continúa igual)'}`);
  console.log(`  smoke_type:                           ${SMOKE_TYPE}`);
  console.log(`  script_name:                          ${SCRIPT_NAME}`);
  console.log(`  DEFAULT_RICH_PROFILE.enabled:         ${DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled}`);
  console.log(`  DEFAULT_LINKEDIN.enabled:             ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);
  console.log(`  candidato:                            ${CONFIG.candidateName} | ${CONFIG.domain} | ${CONFIG.country}`);
  console.log(`  provider:                             tavily`);
  console.log(`  maxPerBatch:                          1`);
  console.log(`  maxQueriesPerCandidate:               1`);
  console.log(`  minConfidenceScore:                   60`);
  console.log(`  unit_cost_usd:                        ${UNIT_COST_USD}`);
  console.log(`  hard_cap_tavily_calls:                ${HARD_CAP_TAVILY_CALLS}`);
  console.log(`  max_results_per_query:                ${CONFIG.maxResults}`);
  console.log(`  search_depth:                         ${CONFIG.searchDepth}`);
  console.log(`  dryRun:                               false (WRITES REALES)`);
  console.log(`  userId:                               ${AUTHORIZED_USER_ID}`);
  console.log(`  discovery_tavily:                     0 (pipeline web search skipped)`);
  console.log(`  llm_calls:                            0`);
  console.log(`  hard_delete:                          false`);
  console.log(`  cleanup_mode:                         logical_only`);
  console.log('\n  Expected writes:');
  console.log(`    [1] INSERT prospect_batches (1 row, smoke_test=true)`);
  console.log(`    [2] INSERT prospect_candidates (1 row, ${CONFIG.candidateName}, smoke_test=true)`);
  console.log(`    [3] INSERT provider_usage_logs (1 row, via usageLoggerFn interna)`);
  console.log(`    [4] UPDATE prospect_batches metadata (rich_profile_enrichment summary)`);
  console.log('══════════════════════════════════════════════════════════════════\n');
}

function printInspectionSql(batchId: string) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  SQL DE INSPECCIÓN POST-RUN (copiar en Supabase Studio)           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  console.log('\n-- A. Batch smoke:');
  console.log(`SELECT
  id,
  name,
  status,
  created_at,
  estimated_cost_usd,
  metadata->>'smoke_test'                        AS smoke_test,
  metadata->>'smoke_type'                        AS smoke_type,
  metadata->'rich_profile_enrichment'            AS enrichment_summary,
  metadata->'logical_cleanup'                    AS logical_cleanup
FROM public.prospect_batches
WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'
ORDER BY created_at DESC
LIMIT 5;`);

  console.log('\n-- B. Candidato smoke:');
  console.log(`SELECT
  id,
  name,
  domain,
  status,
  review_status,
  duplicate_status,
  confidence_score,
  fit_score,
  metadata->'rich_profile'             AS rich_profile,
  metadata->'rich_profile_enrichment'  AS rich_profile_enrichment,
  metadata->>'smoke_test'              AS smoke_test,
  created_at
FROM public.prospect_candidates
WHERE batch_id = '${batchId}'
ORDER BY created_at DESC;`);

  console.log('\n-- C. Provider usage logs del batch:');
  console.log(`SELECT
  id,
  batch_id,
  provider_key,
  operation_key,
  usage_key,
  results_returned,
  estimated_cost_usd,
  status,
  triggered_by,
  metadata->>'candidate_name'   AS candidate_name,
  metadata->>'selected_status'  AS selected_status,
  metadata->>'selected_url'     AS selected_url,
  created_at
FROM public.provider_usage_logs
WHERE batch_id = '${batchId}'
ORDER BY created_at DESC;`);

  console.log('\n-- D. Cost summary:');
  console.log(`SELECT
  provider_key,
  operation_key,
  COUNT(*)                       AS calls,
  SUM(estimated_cost_usd)        AS total_estimated_usd
FROM public.provider_usage_logs
WHERE batch_id = '${batchId}'
GROUP BY provider_key, operation_key;`);

  console.log('\n══════════════════════════════════════════════════════════════════\n');
}

function printLogicalCleanupSql(batchId: string) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  SQL DE LIMPIEZA LÓGICA (NO ejecutado automáticamente)            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('  Ejecutar manualmente en Supabase Studio tras verificar el batch.\n');

  console.log('-- 1. Candidato smoke → duplicate (excluye de active_count):');
  console.log(`UPDATE public.prospect_candidates
SET
  status = 'duplicate',
  metadata = jsonb_set(
    metadata,
    '{logical_cleanup}',
    '{"cleanup_type":"${SMOKE_TYPE}","reason":"Smoke test completado; candidato debe ser ignorado en producción."}'::jsonb
  )
WHERE batch_id = '${batchId}'
  AND lower(domain) = '${CONFIG.domain}';`);

  console.log('\n-- 2. Batch smoke → completed + logical_cleanup:');
  console.log(`UPDATE public.prospect_batches
SET
  status = 'completed',
  metadata = jsonb_set(
    metadata,
    '{logical_cleanup}',
    '{"cleanup_type":"${SMOKE_TYPE}_cleanup","reason":"Smoke test completado; batch debe ser ignorado en producción."}'::jsonb
  )
WHERE id = '${batchId}'
  AND metadata->>'smoke_type' = '${SMOKE_TYPE}';`);

  console.log('\n  IMPORTANTE: No ejecutar DELETE. Solo updates lógicos.');
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {

  // ─── Guardrails ─────────────────────────────────────────────────────────────

  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) {
    console.error('[ABORT] TAVILY_API_KEY no configurado');
    process.exit(1);
  }

  if (DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled !== false) {
    console.error('[ABORT] DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled debe ser false — no fue modificado');
    process.exit(1);
  }

  if (DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled !== false) {
    console.error('[ABORT] DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled debe ser false — no fue modificado');
    process.exit(1);
  }

  if (!UNIT_COST_USD || UNIT_COST_USD <= 0) {
    console.error('[ABORT] UNIT_COST_USD no está definido correctamente');
    process.exit(1);
  }

  if (!AUTHORIZED_USER_ID) {
    console.error('[ABORT] AUTHORIZED_USER_ID no definido — resolver userId antes de ejecutar');
    process.exit(1);
  }

  const git = getGitInfo();
  printPreflight(git);

  // ─── Hard cap tracker ────────────────────────────────────────────────────────

  let tavilyCallCount = 0;

  // ─── Config override (NO modifica DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG) ────

  const smokeConfig: RichProfileEnrichmentConfig = {
    enabled: true,
    provider: 'tavily',
    maxPerBatch: 1,
    maxQueriesPerCandidate: 1,
    minConfidenceScore: 60,
    enrichCity: true,
    enrichSize: true,
    enrichDescription: true,
  };

  // ─── Provider con hard cap ────────────────────────────────────────────────────

  const baseProvider = createTavilyRichProfileEnrichmentProvider(
    CONFIG.maxResults,
    undefined,
    CONFIG.searchDepth,
  );

  const guardedProviderFn: typeof baseProvider = async (candidate, query) => {
    tavilyCallCount++;
    if (tavilyCallCount > HARD_CAP_TAVILY_CALLS) {
      console.error(
        `[HARD CAP] ABORTADO — intento de llamada Tavily #${tavilyCallCount} > cap=${HARD_CAP_TAVILY_CALLS}`,
      );
      process.exit(1);
    }
    console.log(`[tavily-smoke] Llamada #${tavilyCallCount}/${HARD_CAP_TAVILY_CALLS} real → ${candidate.name}`);
    return baseProvider(candidate, query);
  };

  // ─── Usage logger ─────────────────────────────────────────────────────────────

  const usageLoggerFn = createRichProfileEnrichmentUsageLoggerFn(AUTHORIZED_USER_ID);

  // ─── Candidato sintético ─────────────────────────────────────────────────────

  const nowIso = new Date().toISOString();

  const syntheticCandidate: ProspectingPipelineCandidate = {
    name: CONFIG.candidateName,
    website: CONFIG.website,
    domain: CONFIG.domain,
    country: CONFIG.country,
    countryCode: CONFIG.countryCode,
    industry: CONFIG.industry,
    sourceUrl: CONFIG.website,
    sourceTitle: `${CONFIG.candidateName} | ${CONFIG.industry} — ${CONFIG.country}`,
    sourceSnippet:
      `${CONFIG.candidateName} es una empresa de ${CONFIG.industry.toLowerCase()} con presencia B2B en ${CONFIG.country}. Candidato sintético para smoke test de rich profile enrichment.`,
    websiteVerification: {
      status: 'verified',
      website: CONFIG.website,
      domain: CONFIG.domain,
      finalUrl: CONFIG.website,
      finalDomain: CONFIG.domain,
      httpStatus: 200,
      redirected: false,
      redirectChain: [],
      confidence: 90,
      skipped: false,
      evidence: ['official_domain_match'],
    },
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 90,
      input: {
        name: CONFIG.candidateName,
        website: CONFIG.website,
        domain: CONFIG.domain,
        country: CONFIG.country,
        countryCode: CONFIG.countryCode,
      },
      matches: [],
      summary: `No duplicates found (smoke test ${SMOKE_TYPE})`,
      checkedSources: ['sellup', 'hubspot'],
    },
    scoring: {
      confidenceScore: 80,
      fitScore: 75,
      dataCompletenessScore: 70,
      qualityLabel: 'high_quality_new',
      recommendedAction: 'approve_for_review',
      breakdown: {
        existenceSignals: 30,
        websiteSignals: 20,
        duplicateSignals: 15,
        sourceSignals: 10,
        fitSignals: 5,
        completenessSignals: 5,
        penalties: 0,
      },
      reasons: ['official_domain', 'website_verified', 'smoke_test_synthetic'],
      warnings: [],
      blockers: [],
      fitBreakdown: {
        product_fit: 20,
        country_fit: 20,
        b2b_signal: 15,
        duplicate_penalty: 0,
        country_evidence_penalty: 0,
        generic_agency_penalty: 0,
        commercial_calibration_delta: 0,
        final_fit_score: 75,
        fit_label: 'medium',
        fit_reasons: ['tech_company', `${CONFIG.countryCode.toLowerCase()}_domain`, 'b2b_software'],
        fit_penalties: [],
      },
    },
  };

  // ─── Pipeline output sintético ────────────────────────────────────────────────

  const syntheticPipelineOutput: ProspectingPipelineOutput = {
    input: {
      country: CONFIG.country,
      countryCode: CONFIG.countryCode,
      industry: CONFIG.industry,
      searchDepth: PIPELINE_SEARCH_DEPTH,
      targetCount: 1,
      mode: 'single_query',
    },
    catalogContext: {
      country: CONFIG.country,
      countryCode: CONFIG.countryCode,
      industry: CONFIG.industry,
      searchDepth: PIPELINE_SEARCH_DEPTH,
      fiscalIdentifierLabel: CONFIG.countryCode === 'CO' ? 'NIT' : 'TIN',
      recommendedSources: [],
      sectorSources: [],
      risks: [],
      operatingRules: [],
      coverageNotes: [],
      promptContext: `smoke_test_${SMOKE_TYPE}`,
    },
    searchQuery: `empresas de ${CONFIG.industry.toLowerCase()} ${CONFIG.country} software B2B`,
    webSearch: {
      provider: 'mock',
      query: `empresas de ${CONFIG.industry.toLowerCase()} ${CONFIG.country} software B2B`,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: `smoke_test_synthetic_pipeline_${SMOKE_TYPE}`,
    },
    candidates: [syntheticCandidate],
    summary: {
      requested: 1,
      searched: 1,
      returned: 1,
      highQualityNew: 1,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [`smoke_test_synthetic_pipeline_${SMOKE_TYPE}`],
    metadata: {
      provider: 'mock',
      pipelineVersion: `${SMOKE_TYPE}-smoke`,
      search_mode: 'single_query',
      executedAt: nowIso,
    },
  };

  // ─── Extra batch metadata (smoke) ────────────────────────────────────────────

  const extraBatchMetadata = {
    smoke_test: true,
    smoke_type: SMOKE_TYPE,
    qa_only: true,
    do_not_use_for_sales: true,
    do_not_convert: true,
    created_by_script: SCRIPT_NAME,
    cleanup_mode: 'logical_only',
  };

  // ─── CandidateWriterInput ────────────────────────────────────────────────────

  const writerInput: CandidateWriterInput = {
    pipelineOutput: syntheticPipelineOutput,
    triggeredByUserId: AUTHORIZED_USER_ID,
    ownerId: AUTHORIZED_USER_ID,
    batchName: `SellUp Smoke Rich Profile Flow ${SMOKE_TYPE} — ${nowIso.slice(0, 19)}Z`,
    source: 'agent_1',
    dryRun: false,
    extraBatchMetadata,
    existingBatchId: null,
  };

  // ─── RichProfileEnrichmentOverride ───────────────────────────────────────────

  const richProfileEnrichmentOverride = {
    config: smokeConfig,
    providerFn: guardedProviderFn,
    unitCostUsd: UNIT_COST_USD,
    usageLoggerFn,
  };

  // ─── Ejecutar writeProspectingCandidates ──────────────────────────────────────

  console.log(`[smoke] Iniciando writeProspectingCandidates — candidato=${CONFIG.candidateName} smoke_type=${SMOKE_TYPE}`);
  console.log('[smoke] 1 Tavily call esperado (enrichment). 0 discovery. 0 LLM.\n');

  const startTs = Date.now();

  const writerOutput = await writeProspectingCandidates(
    writerInput,
    undefined,                       // adminClientOverride — usa env vars reales
    undefined,                       // linkedInSearchOverride — disabled
    richProfileEnrichmentOverride,
  );

  const elapsedMs = Date.now() - startTs;

  // ─── Reporte ──────────────────────────────────────────────────────────────────

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  REPORTE — Rich Profile Flow Write Smoke                          ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  console.log('\n--- Writer output ---');
  console.log('dryRun:              ', writerOutput.dryRun);
  console.log('status:              ', writerOutput.status);
  console.log('batchId:             ', writerOutput.batchId);
  console.log('candidatesCreated:   ', writerOutput.candidatesCreated);
  console.log('candidatesSkipped:   ', writerOutput.candidatesSkipped);
  console.log('createdCandidateIds: ', JSON.stringify(writerOutput.createdCandidateIds));
  console.log('errors:              ', JSON.stringify(writerOutput.errors));
  console.log('elapsed_ms:          ', elapsedMs);

  if (writerOutput.skipped.length > 0) {
    console.log('\n--- Candidatos skipped ---');
    for (const s of writerOutput.skipped) {
      console.log('  ', s.name, '→', s.reason);
    }
  }

  console.log('\n--- Tavily calls reales ---');
  console.log('Total Tavily calls:             ', tavilyCallCount);
  console.log('Hard cap:                       ', HARD_CAP_TAVILY_CALLS);
  console.log('DEFAULT_RICH_PROFILE.enabled:   ', DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, '(unchanged)');
  console.log('DEFAULT_LINKEDIN.enabled:       ', DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, '(unchanged)');

  if (writerOutput.status === 'failed') {
    console.error('\n[SMOKE] FAIL — writer retornó status=failed');
    if (writerOutput.errors.length > 0) {
      console.error('[SMOKE] Errores:', writerOutput.errors.join('\n'));
    }
    process.exit(1);
  }

  if (writerOutput.batchId) {
    printInspectionSql(writerOutput.batchId);
    printLogicalCleanupSql(writerOutput.batchId);
  }

  console.log(`=== FIN SMOKE ${SMOKE_TYPE} ===\n`);

} // end main

main().catch((err) => {
  console.error('[SMOKE ERROR]', err);
  process.exit(1);
});
