#!/usr/bin/env tsx
/**
 * Smoke — ICP Size Gate Write v1.16I-A
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  ICP SIZE GATE SMOKE — 0 API CALLS — 0 LLM — SUPABASE WRITES ONLY          │
 * │  WHEN AUTHORIZED                                                             │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * PROPÓSITO:
 *   Smoke controlado de escritura en Supabase para validar el comportamiento
 *   real del ICP Size Gate con 3 candidatos sintéticos.
 *
 * GARANTÍAS ABSOLUTAS:
 *   - 0 llamadas Tavily
 *   - 0 llamadas LLM
 *   - 0 provider_usage_logs
 *   - 0 discovery Tavily
 *   - 0 hard DELETE
 *   - DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled permanece false
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled permanece false
 *   - cleanup_mode=logical_only
 *
 * CANDIDATOS SINTÉTICOS:
 *   1. PASS    — domain: sellup-icp-pass-smoke.example    (size_range: "10001+")
 *   2. UNKNOWN — domain: sellup-icp-unknown-smoke.example (size_range: null)
 *   3. BLOCK   — domain: sellup-icp-block-smoke.example   (size_range: "51-200")
 *
 * EXPECTED WRITES (cuando se autorice):
 *   - 1 prospect_batch smoke insertado
 *   - 2 prospect_candidates smoke insertados (PASS + UNKNOWN)
 *   - 0 prospect_candidates bloqueados (BLOCK no se inserta)
 *   - 0 provider_usage_logs
 *   - 0 Tavily
 *   - 0 LLM
 *
 * PRECHECK DB (verificado el 2026-06-24):
 *   - sellup-icp-pass-smoke.example    → active_count=0, total_count=0
 *   - sellup-icp-unknown-smoke.example → active_count=0, total_count=0
 *   - sellup-icp-block-smoke.example   → active_count=0, total_count=0
 *
 * EJECUCIÓN (requiere autorización explícita):
 *   npm run agent1:smoke:icp-size-gate-write
 *
 * NOTA: Este script NO debe ejecutarse sin revisión y autorización explícita
 *       del Preflight Report de v1.16I-A.
 */

import { execSync } from 'child_process';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { writeProspectingCandidates } from '../../src/server/agents/prospecting-toolkit/candidate-writer';
import { DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG } from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import type { ProspectingPipelineOutput } from '../../src/server/agents/prospecting-toolkit/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const SMOKE_TYPE = 'icp_size_gate_v1_16i_a';
const SCRIPT_NAME = 'v1_16i_a_icp_size_gate_write_smoke';

// Dominios sintéticos verificados — active_count=0 en precheck 2026-06-24
const DOMAIN_PASS    = 'sellup-icp-pass-smoke.example';
const DOMAIN_UNKNOWN = 'sellup-icp-unknown-smoke.example';
const DOMAIN_BLOCK   = 'sellup-icp-block-smoke.example';

// userId real — egarcia@ubits.co
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

// ─── Synthetic Pipeline Output ────────────────────────────────────────────────

/**
 * Construye el pipelineOutput sintético con 3 candidatos QA.
 * No llama Tavily. No llama LLM. Puro en memoria.
 */
function buildSyntheticPipelineOutput(): ProspectingPipelineOutput {
  const baseCandidate = {
    website: null,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    websiteVerification: null,
    duplicateCheck: null,
    scoring: {
      confidenceScore: 75,
      fitScore: 75,
      dataCompletenessScore: 70,
      qualityLabel: 'high_quality_new' as const,
      recommendedAction: 'approve_for_review' as const,
      breakdown: {
        existenceSignals: 0,
        websiteSignals: 0,
        duplicateSignals: 0,
        sourceSignals: 0,
        fitSignals: 0,
        completenessSignals: 0,
        penalties: 0,
      },
      reasons: ['qa_smoke_candidate'] as string[],
      warnings: [] as string[],
      blockers: [] as string[],
    },
  };

  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'mock',
      mode: 'multi_query',
    },
    catalogContext: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      searchDepth: 'standard',
      fiscalIdentifierLabel: 'NIT',
      recommendedSources: [],
      sectorSources: [],
      risks: [],
      operatingRules: [],
      coverageNotes: [],
      promptContext: '',
    },
    searchQuery: 'smoke_icp_size_gate_v1_16i_a',
    webSearch: {
      provider: 'mock',
      query: 'smoke_icp_size_gate_v1_16i_a',
      results: [],
      resultsCount: 3,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates: [
      {
        ...baseCandidate,
        name: 'SellUp ICP Pass Smoke Co',
        domain: DOMAIN_PASS,
        // size_range "10001+" → ICP size gate: pass
        scoring: {
          ...baseCandidate.scoring,
          metadata: {
            qa_smoke: true,
            smoke_scenario: 'icp_pass',
            size_range: '10001+',
            expected_icp_size_gate: 'pass',
          },
        },
      },
      {
        ...baseCandidate,
        name: 'SellUp ICP Unknown Smoke Co',
        domain: DOMAIN_UNKNOWN,
        // size_range null → ICP size gate: needs_validation
        scoring: {
          ...baseCandidate.scoring,
          metadata: {
            qa_smoke: true,
            smoke_scenario: 'icp_unknown',
            size_range: null,
            expected_icp_size_gate: 'needs_validation',
          },
        },
      },
      {
        ...baseCandidate,
        name: 'SellUp ICP Block Smoke Co',
        domain: DOMAIN_BLOCK,
        // size_range "51-200" → ICP size gate: block (NO se inserta)
        scoring: {
          ...baseCandidate.scoring,
          metadata: {
            qa_smoke: true,
            smoke_scenario: 'icp_block',
            size_range: '51-200',
            expected_icp_size_gate: 'block',
          },
        },
      },
    ],
    summary: {
      requested: 3,
      searched: 3,
      returned: 3,
      highQualityNew: 2,
      needsReview: 1,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: {
      qa_smoke: true,
      smoke_type: SMOKE_TYPE,
      script: SCRIPT_NAME,
      provider: 'mock',
      tavily_calls: 0,
      llm_calls: 0,
    },
  };
}

// ─── Extra batch metadata ─────────────────────────────────────────────────────

const EXTRA_BATCH_METADATA: Record<string, unknown> = {
  smoke_test: true,
  smoke_type: SMOKE_TYPE,
  qa_only: true,
  do_not_use_for_sales: true,
  do_not_convert: true,
  created_by_script: SCRIPT_NAME,
  cleanup_mode: 'logical_only',
};

// ─── Preflight report ─────────────────────────────────────────────────────────

function printPreflight(git: ReturnType<typeof getGitInfo>) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  PREFLIGHT — ICP Size Gate Write Smoke v1.16I-A                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  branch:                               ${git.branch}`);
  console.log(`  HEAD local:                           ${git.headLocal}`);
  console.log(`  HEAD origin/main:                     ${git.headRemote}`);
  console.log(`  working_tree:                         ${git.clean ? 'clean ✓' : 'DIRTY'}`);
  console.log(`  smoke_type:                           ${SMOKE_TYPE}`);
  console.log(`  script:                               ${SCRIPT_NAME}`);
  console.log(`  DEFAULT_RICH_PROFILE.enabled:         ${DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled}`);
  console.log(`  DEFAULT_LINKEDIN.enabled:             ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);
  console.log(`  tavily_calls:                         0 (HARD GUARD)`);
  console.log(`  llm_calls:                            0 (HARD GUARD)`);
  console.log(`  provider_usage_logs:                  0 (HARD GUARD)`);
  console.log(`  dryRun:                               false (WRITES REALES)`);
  console.log(`  userId:                               ${AUTHORIZED_USER_ID}`);
  console.log(`  cleanup_mode:                         logical_only`);
  console.log(`\n  Dominios sintéticos (precheck 2026-06-24 → active_count=0):`);
  console.log(`    PASS:    ${DOMAIN_PASS}`);
  console.log(`    UNKNOWN: ${DOMAIN_UNKNOWN}`);
  console.log(`    BLOCK:   ${DOMAIN_BLOCK}`);
  console.log('\n  Expected writes cuando se autorice:');
  console.log('    [1] INSERT prospect_batches (1 row, smoke_test=true)');
  console.log('    [2] INSERT prospect_candidates PASS (1 row, status=needs_review, icp_size_gate.decision=pass)');
  console.log('    [3] INSERT prospect_candidates UNKNOWN (1 row, status=needs_review, icp_size_gate.decision=needs_validation, requires_human_review=true)');
  console.log('    [4] SKIP BLOCK (icp_size_below_threshold — NO se inserta)');
  console.log('    [0] INSERT provider_usage_logs → NONE');
  console.log('    [0] Tavily calls → NONE');
  console.log('    [0] LLM calls → NONE');
  console.log('\n  Expected batch icp_size_gate_summary:');
  console.log('    { threshold: 200, pass_count: 1, needs_validation_count: 1, blocked_count: 1 }');
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Cleanup SQL (solo imprimir — NO ejecutar) ────────────────────────────────

function printCleanupSql(batchId?: string | null) {
  const batchFilter = batchId
    ? `WHERE id = '${batchId}'`
    : `WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'`;

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  CLEANUP SQL PROPUESTO (copiar — NO ejecutar automáticamente)     ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('\n-- 1. Logical cleanup de candidatos smoke:');
  console.log(`UPDATE public.prospect_candidates
SET
  status = 'discarded',
  metadata = jsonb_set(
    COALESCE(metadata, '{}'),
    '{logical_cleanup}',
    '{"reason": "qa_smoke_icp_size_gate_v1_16i_a", "cleanup_mode": "logical_only"}'::jsonb
  )
WHERE lower(domain) IN (
  '${DOMAIN_PASS}',
  '${DOMAIN_UNKNOWN}',
  '${DOMAIN_BLOCK}'
)
AND status NOT IN ('discarded', 'rejected');`);

  console.log('\n-- 2. Logical cleanup del batch smoke:');
  console.log(`UPDATE public.prospect_batches
SET
  status = 'discarded',
  metadata = jsonb_set(
    COALESCE(metadata, '{}'),
    '{logical_cleanup}',
    '{"reason": "qa_smoke_icp_size_gate_v1_16i_a", "cleanup_mode": "logical_only"}'::jsonb
  )
${batchFilter}
AND status NOT IN ('discarded', 'rejected');`);

  console.log('\n-- 3. Inspección post-cleanup:');
  console.log(`SELECT id, domain, name, status, metadata->'icp_size_gate' AS icp_size_gate
FROM public.prospect_candidates
WHERE lower(domain) IN (
  '${DOMAIN_PASS}',
  '${DOMAIN_UNKNOWN}',
  '${DOMAIN_BLOCK}'
)
ORDER BY created_at DESC;`);
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Inspection SQL ───────────────────────────────────────────────────────────

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
  metadata->>'smoke_test'                         AS smoke_test,
  metadata->>'smoke_type'                         AS smoke_type,
  metadata->'icp_size_gate_summary'               AS icp_size_gate_summary,
  metadata->'logical_cleanup'                     AS logical_cleanup
FROM public.prospect_batches
WHERE id = '${batchId}';`);

  console.log('\n-- 2. Candidatos smoke:');
  console.log(`SELECT
  id,
  name,
  domain,
  status,
  metadata->>'icp_size_gate'                      AS icp_size_gate,
  metadata->'rich_profile'->'size'->'icp_size_gate' AS rich_profile_size_gate,
  requires_human_review,
  created_at
FROM public.prospect_candidates
WHERE lower(domain) IN (
  '${DOMAIN_PASS}',
  '${DOMAIN_UNKNOWN}',
  '${DOMAIN_BLOCK}'
)
ORDER BY created_at DESC;`);
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  ICP SIZE GATE SMOKE — 0 API CALLS — 0 LLM — SUPABASE WRITES ONLY          │');
  console.log('│  WHEN AUTHORIZED                                                             │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

  const git = getGitInfo();
  printPreflight(git);

  // Guard: confirmar que los defaults no fueron alterados
  if (DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled !== false) {
    throw new Error('[smoke] ABORT: DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled debe ser false');
  }
  if (DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled !== false) {
    throw new Error('[smoke] ABORT: DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled debe ser false');
  }

  const adminClient = getAdminClient();
  const pipelineOutput = buildSyntheticPipelineOutput();

  console.log('[smoke] Ejecutando writeProspectingCandidates con pipelineOutput sintético...');
  console.log('[smoke] Candidatos en pipeline:', pipelineOutput.candidates.length);
  console.log('[smoke] Dominios:', pipelineOutput.candidates.map((c) => c.domain).join(', '));

  const result = await writeProspectingCandidates(
    {
      pipelineOutput,
      triggeredByUserId: AUTHORIZED_USER_ID,
      ownerId: AUTHORIZED_USER_ID,
      batchName: `[SMOKE] ICP Size Gate v1.16I-A — ${new Date().toISOString().slice(0, 10)}`,
      source: 'agent_1',
      dryRun: false,
      extraBatchMetadata: EXTRA_BATCH_METADATA,
    },
    adminClient,
    // No LinkedIn override — feature disabled by default
    undefined,
    // No rich profile override — feature disabled by default
    undefined,
  );

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  RESULTADO                                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  status:              ${result.status}`);
  console.log(`  batchId:             ${result.batchId}`);
  console.log(`  candidatesCreated:   ${result.candidatesCreated}`);
  console.log(`  candidatesSkipped:   ${result.candidatesSkipped}`);
  console.log(`  createdIds:          ${result.createdCandidateIds.join(', ') || 'none'}`);
  if (result.skipped.length > 0) {
    console.log('  skipped:');
    for (const s of result.skipped) {
      console.log(`    - ${s.name} | reason: ${s.reason}`);
    }
  }
  if (result.errors.length > 0) {
    console.log('  errors:');
    for (const e of result.errors) {
      console.log(`    - ${e}`);
    }
  }
  console.log('══════════════════════════════════════════════════════════════════\n');

  if (result.batchId) {
    printInspectionSql(result.batchId);
  }
  printCleanupSql(result.batchId);

  // Verificaciones post-run
  const blockSkipped = result.skipped.find((s) => s.reason === 'icp_size_below_threshold');
  if (!blockSkipped) {
    console.warn('[smoke] WARNING: Se esperaba 1 candidato bloqueado por icp_size_below_threshold');
  } else {
    console.log('[smoke] ✓ Candidato BLOCK fue omitido correctamente (icp_size_below_threshold)');
  }

  if (result.candidatesCreated === 2) {
    console.log('[smoke] ✓ candidatesCreated=2 (PASS + UNKNOWN)');
  } else {
    console.warn(`[smoke] WARNING: Se esperaban 2 candidatos insertados, se insertaron ${result.candidatesCreated}`);
  }

  console.log('\n[smoke] Smoke completado. Revisar Supabase con los SQL de inspección.');
}

main().catch((err) => {
  console.error('\n[smoke] ERROR FATAL:', err);
  process.exit(1);
});
