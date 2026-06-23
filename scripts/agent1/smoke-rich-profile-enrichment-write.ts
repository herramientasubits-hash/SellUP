#!/usr/bin/env tsx
/**
 * Smoke — Rich Profile Enrichment Write v1.16D-B
 *
 * PROPÓSITO:
 *   Primer write controlado de rich_profile_enrichment con datos reales.
 *   1 Tavily call real. 1 batch smoke. 1 provider_usage_logs insert.
 *   0 candidate inserts. 0 LLM. 0 discovery Tavily. 0 DELETE.
 *
 * GARANTÍAS:
 *   - Máximo 1 Tavily call (hard cap + config.maxPerBatch=1)
 *   - 1 batch smoke insert en public.prospect_batches
 *   - 1 provider_usage_logs insert (via usageLoggerFn real)
 *   - 0 prospect_candidates inserts
 *   - 0 prospect_candidates updates
 *   - 0 LLM calls
 *   - 0 discovery Tavily calls
 *   - 0 hard DELETE
 *   - DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled permanece false
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled permanece false
 *   - batch metadata: smoke_test=true, cleanup_mode=logical_only
 *
 * CANDIDATO SINTÉTICO (en memoria — NO se inserta en DB):
 *   name: Globant | domain: globant.com | country: Argentina
 *
 * EJECUCIÓN (requiere autorización explícita):
 *   npm run agent1:smoke:rich-profile-enrichment-write
 *
 * NOTA: Este script requiere que el usuario haya revisado y autorizado
 *       explícitamente el Preflight Report de v1.16D-B antes de ejecutar.
 */

import { execSync } from 'child_process';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  runRichProfileEnrichmentBatch,
  buildRichProfileEnrichmentQuery,
  DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
  type RichProfileEnrichmentCandidate,
  type RichProfileEnrichmentConfig,
} from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment';
import { createTavilyRichProfileEnrichmentProvider } from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment-tavily';
import { createRichProfileEnrichmentUsageLoggerFn } from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment-usage-logging';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import type { CandidateRichProfileV1 } from '../../src/server/agents/prospecting-toolkit/candidate-rich-profile';

// ─── Constants ────────────────────────────────────────────────────────────────

const SMOKE_TYPE = 'rich_profile_enrichment_v1_16d_b';
const SCRIPT_NAME = 'v1_16d_b_rich_profile_enrichment_write_smoke';
const UNIT_COST_USD = 0.008;         // Tavily basic search — per provider_pricing_config
const MAX_RESULTS_PER_QUERY = 3;
const HARD_CAP_TAVILY_CALLS = 1;

// userId real — egarcia@ubits.co (verificado en preflight)
const AUTHORIZED_USER_ID = '5a8fb462-eecb-41f2-bfab-2c8fb6e3f73c';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('[smoke] Supabase service credentials not configured');
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

function printPreflight(expectedQuery: string, git: ReturnType<typeof getGitInfo>) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  PREFLIGHT — Rich Profile Enrichment Write Smoke v1.16D-B         ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  branch:                               ${git.branch}`);
  console.log(`  HEAD local:                           ${git.headLocal}`);
  console.log(`  HEAD origin/main:                     ${git.headRemote}`);
  console.log(`  working_tree:                         ${git.clean ? 'clean ✓' : 'DIRTY (continúa igual)'}`);
  console.log(`  smoke_type:                           ${SMOKE_TYPE}`);
  console.log(`  DEFAULT_RICH_PROFILE.enabled:         ${DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled}`);
  console.log(`  DEFAULT_LINKEDIN.enabled:             ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);
  console.log(`  provider:                             tavily`);
  console.log(`  maxPerBatch:                          1`);
  console.log(`  maxQueriesPerCandidate:               1`);
  console.log(`  minConfidenceScore:                   60`);
  console.log(`  unit_cost_usd:                        ${UNIT_COST_USD}`);
  console.log(`  hard_cap_tavily_calls:                ${HARD_CAP_TAVILY_CALLS}`);
  console.log(`  max_results_per_query:                ${MAX_RESULTS_PER_QUERY}`);
  console.log(`  dryRun:                               false (WRITES REALES)`);
  console.log(`  userId:                               ${AUTHORIZED_USER_ID}`);
  console.log(`  candidate_inserts:                    0`);
  console.log(`  discovery_tavily:                     0`);
  console.log(`  llm_calls:                            0`);
  console.log(`  hard_delete:                          false`);
  console.log(`  cleanup_mode:                         logical_only`);
  console.log(`\n  Query esperada:`);
  console.log(`    ${expectedQuery}`);
  console.log('\n  Expected writes:');
  console.log('    [1] INSERT prospect_batches (1 row, smoke_test=true)');
  console.log('    [2] UPDATE prospect_batches metadata (rich_profile_enrichment summary)');
  console.log('    [3] INSERT provider_usage_logs (1 row via usageLoggerFn)');
  console.log('    [0] INSERT prospect_candidates → NONE');
  console.log('══════════════════════════════════════════════════════════════════\n');
}

function printInspectionSql(batchId: string) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  SQL DE INSPECCIÓN POST-RUN (copiar en Supabase Studio)           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  console.log('\n-- 1. Batch smoke:');
  console.log(`SELECT
  id,
  name,
  status,
  created_at,
  metadata->>'smoke_test'                        AS smoke_test,
  metadata->>'smoke_type'                        AS smoke_type,
  metadata->'rich_profile_enrichment'            AS enrichment_summary,
  metadata->'logical_cleanup'                    AS logical_cleanup
FROM public.prospect_batches
WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'
ORDER BY created_at DESC
LIMIT 5;`);

  console.log('\n-- 2. Provider usage logs del batch:');
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

  console.log('\n-- 3. Cost summary:');
  console.log(`SELECT
  provider_key,
  operation_key,
  COUNT(*)                       AS calls,
  SUM(estimated_cost_usd)        AS total_estimated_usd
FROM public.provider_usage_logs
WHERE batch_id = '${batchId}'
GROUP BY provider_key, operation_key;`);

  console.log('\n-- 4. Batch específico (ID dinámico):');
  console.log(`SELECT id, name, status, metadata FROM public.prospect_batches WHERE id = '${batchId}';`);
  console.log('══════════════════════════════════════════════════════════════════\n');
}

function printLogicalCleanupSql(batchId: string) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  SQL DE LIMPIEZA LÓGICA (NO ejecutado automáticamente)            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('  Ejecutar manualmente en Supabase Studio tras verificar el batch.\n');

  console.log('-- Batch → completed + logical_cleanup:');
  console.log(`UPDATE public.prospect_batches
SET
  status = 'completed',
  metadata = jsonb_set(
    metadata,
    '{logical_cleanup}',
    '{"cleanup_type":"rich_profile_smoke_cleanup_v1_16d_b","reason":"Smoke test completed; batch debe ser ignorado en producción."}'::jsonb
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

  // ─── Candidato sintético (en memoria — NO se inserta en DB) ─────────────────

  const basicRichProfile: CandidateRichProfileV1 = {
    schema_version: 'candidate_rich_profile_v1',
    company: {
      name: 'Globant',
      website: 'https://www.globant.com',
      domain: 'globant.com',
      linkedin_url: null,
    },
    classification: {
      country: 'Argentina',
      country_code: 'AR',
      industry: 'Tecnología',
      subindustry: null,
      relationship_type: 'sales_prospect',
      not_sales_prospect: false,
    },
    location: {
      city: null,
      hq_country: null,
      source: 'unknown',
    },
    size: {
      estimated_range: null,
      status: 'unknown',
      source: 'unknown',
    },
    description: {
      short: null,
      source: 'unknown',
    },
    evidence: {
      primary_url: null,
      primary_source_type: 'unknown',
      evidence_summary: null,
      evidence_quality: 'unknown',
    },
    confidence: {
      confidence_score: 80,
      fit_score: 75,
      confidence_level: 'high',
    },
    notes: {
      requires_human_review: false,
      missing_fields: ['city', 'size'],
    },
    provenance: {
      generated_at: new Date().toISOString(),
      generated_by: 'agent_1',
      enrichment_level: 'basic',
      external_calls_used: false,
      cost_usd: 0,
    },
  };

  const syntheticCandidate: RichProfileEnrichmentCandidate = {
    name: 'Globant',
    domain: 'globant.com',
    website: 'https://www.globant.com',
    country: 'Argentina',
    countryCode: 'AR',
    industry: 'Tecnología',
    confidenceScore: 80,
    fitScore: 75,
    richProfile: basicRichProfile,
    isBlockedByDuplicateGuard: false,
    isBlockedByEvidencePolicy: false,
  };

  const expectedQuery = buildRichProfileEnrichmentQuery(syntheticCandidate);
  const git = getGitInfo();
  printPreflight(expectedQuery, git);

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

  const baseProvider = createTavilyRichProfileEnrichmentProvider(MAX_RESULTS_PER_QUERY);

  const guardedProviderFn: typeof baseProvider = async (candidate, config) => {
    tavilyCallCount++;
    if (tavilyCallCount > HARD_CAP_TAVILY_CALLS) {
      console.error(
        `[HARD CAP] ABORTADO — intento de llamada Tavily #${tavilyCallCount} > cap=${HARD_CAP_TAVILY_CALLS}`,
      );
      process.exit(1);
    }
    console.log(`[tavily-smoke] Llamada #${tavilyCallCount}/${HARD_CAP_TAVILY_CALLS} real`);
    return baseProvider(candidate, config);
  };

  // ─── Phase 1: Crear batch smoke en Supabase ───────────────────────────────────

  console.log('[smoke] Phase 1: Crear batch smoke en Supabase...');

  const admin = getAdminClient();
  const nowIso = new Date().toISOString();
  const batchName = `SellUp Smoke Rich Profile v1.16D-B — ${nowIso.slice(0, 19)}Z`;

  const batchMeta = {
    smoke_test: true,
    smoke_type: SMOKE_TYPE,
    qa_only: true,
    do_not_use_for_sales: true,
    do_not_convert: true,
    created_by_script: SCRIPT_NAME,
    cleanup_mode: 'logical_only',
  };

  const { data: batch, error: batchError } = await admin
    .from('prospect_batches')
    .insert({
      name: batchName,
      country: 'Argentina',
      country_code: 'AR',
      industry: 'Tecnología',
      target_count: 0,
      search_depth: 'basic',
      status: 'draft',
      source: 'agent_1',
      owner_id: null,
      created_by: AUTHORIZED_USER_ID,
      metadata: batchMeta,
    })
    .select('id, status, created_at, metadata')
    .single();

  if (batchError || !batch) {
    console.error('[smoke] FAIL: Error creando batch:', batchError?.message ?? 'unknown');
    process.exit(1);
  }

  const batchId = batch.id as string;
  console.log(`[smoke] Batch creado: id=${batchId} status=${batch.status}`);

  // ─── Phase 2: Rich Profile Enrichment (1 Tavily call real + 1 usage log) ─────

  console.log('\n[smoke] Phase 2: Rich Profile Enrichment (Tavily real + usage log)...');
  console.log('[smoke] 0 candidate inserts. 0 LLM. 0 discovery.\n');

  const usageLoggerFn = createRichProfileEnrichmentUsageLoggerFn(AUTHORIZED_USER_ID);

  const startTs = Date.now();

  const result = await runRichProfileEnrichmentBatch(
    [syntheticCandidate],
    {
      config: smokeConfig,
      providerFn: guardedProviderFn,
      unitCostUsd: UNIT_COST_USD,
      batchId,
      userId: AUTHORIZED_USER_ID,
      dryRun: false,
      usageLoggerFn,
    },
  );

  const elapsedMs = Date.now() - startTs;

  console.log(`\n[smoke] Rich Profile Enrichment completo. Tavily calls: ${tavilyCallCount}`);

  // ─── Phase 3: Update batch metadata con rich_profile_enrichment summary ───────

  console.log('\n[smoke] Phase 3: Actualizando metadata del batch con summary...');

  const meta = result.batchMetadata;

  const enrichmentSummary = {
    enabled: true,
    provider: smokeConfig.provider,
    attempted_count: meta.attempted_candidate_count,
    attempted_query_count: meta.attempted_query_count,
    found_count: meta.found_count,
    partial_count: meta.partial_count,
    not_found_count: meta.not_found_count,
    failed_count: meta.failed_count,
    skipped_count: meta.skipped_count,
    estimated_cost_usd: meta.estimated_cost_usd,
    usage_logged: meta.usage_logged,
    elapsed_ms: elapsedMs,
  };

  const { error: updateError } = await admin
    .from('prospect_batches')
    .update({
      status: 'ready_for_review',
      metadata: {
        ...batchMeta,
        rich_profile_enrichment: enrichmentSummary,
      },
    })
    .eq('id', batchId);

  if (updateError) {
    console.error('[smoke] WARN: Error actualizando batch metadata:', updateError.message);
  } else {
    console.log('[smoke] Batch metadata actualizado con rich_profile_enrichment summary.');
  }

  // ─── Reporte ──────────────────────────────────────────────────────────────────

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  REPORTE — Rich Profile Enrichment Write Smoke v1.16D-B           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  console.log('\n--- Batch ---');
  console.log('batch_id:              ', batchId);
  console.log('status final:          ', 'ready_for_review');

  console.log('\n--- Batch metadata ---');
  console.log('attempted_candidate_count:', meta.attempted_candidate_count);
  console.log('attempted_query_count:    ', meta.attempted_query_count);
  console.log('found_count:              ', meta.found_count);
  console.log('partial_count:            ', meta.partial_count);
  console.log('not_found_count:          ', meta.not_found_count);
  console.log('failed_count:             ', meta.failed_count);
  console.log('skipped_count:            ', meta.skipped_count);
  console.log('estimated_cost_usd:       ', meta.estimated_cost_usd);
  console.log('usage_logged:             ', meta.usage_logged);
  console.log('elapsed_ms:               ', elapsedMs);

  if (result.skipped.length > 0) {
    console.log('\n--- Candidatos skipped ---');
    for (const s of result.skipped) {
      console.log('  ', s.candidate.name, '→', s.reason);
    }
  }

  if (result.enrichedProfiles.length > 0) {
    const ep = result.enrichedProfiles[0];
    const pr = ep.providerResult;
    const afterProfile = ep.enrichedProfile;

    console.log('\n--- Provider result ---');
    console.log('status:         ', pr.status);
    console.log('city:           ', pr.city ?? null);
    console.log('hq_country:     ', pr.hq_country ?? null);
    console.log('size_range:     ', pr.size_range ?? null);
    console.log('evidence_url:   ', pr.evidence_url ?? null);
    console.log('description:    ', pr.description ? pr.description.slice(0, 120) + '...' : null);

    console.log('\n--- Rich profile AFTER (in-memory merge) ---');
    console.log('location.city:              ', afterProfile.location.city ?? null);
    console.log('location.hq_country:        ', afterProfile.location.hq_country ?? null);
    console.log('size.estimated_range:       ', afterProfile.size.estimated_range ?? null);
    console.log('size.status:                ', afterProfile.size.status);
    console.log('provenance.enrichment_level:', afterProfile.provenance.enrichment_level);
    console.log('provenance.external_calls:  ', afterProfile.provenance.external_calls_used);
    console.log('provenance.cost_usd:        ', afterProfile.provenance.cost_usd);
  }

  console.log('\n--- Usage payloads (count:', result.usagePayloads.length, ') ---');
  for (const p of result.usagePayloads) {
    console.log('  feature:              ', p.feature);
    console.log('  operation_key (feat): ', p.feature);
    console.log('  provider:             ', p.provider);
    console.log('  batch_id:             ', p.batch_id);
    console.log('  estimated_cost_usd:   ', p.estimated_cost_usd);
    console.log('  selected_status:      ', p.selected_status);
    console.log('  selected_url:         ', p.selected_url ?? null);
    console.log('  status:               ', p.status);
  }

  console.log('\n--- Tavily calls reales ---');
  console.log('Total Tavily calls:             ', tavilyCallCount);
  console.log('Hard cap:                       ', HARD_CAP_TAVILY_CALLS);
  console.log('DEFAULT_RICH_PROFILE.enabled:   ', DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, '(unchanged)');
  console.log('DEFAULT_LINKEDIN.enabled:       ', DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, '(unchanged)');

  printInspectionSql(batchId);
  printLogicalCleanupSql(batchId);

  console.log('=== FIN SMOKE v1.16D-B ===\n');

} // end main

main().catch((err) => {
  console.error('[SMOKE ERROR]', err);
  process.exit(1);
});
