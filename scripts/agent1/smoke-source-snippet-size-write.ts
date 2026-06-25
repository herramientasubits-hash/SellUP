#!/usr/bin/env tsx
/**
 * Smoke — Source Snippet Size Write v1.16K-A
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  SOURCE SNIPPET SIZE SMOKE — 0 API CALLS — 0 LLM — SUPABASE WRITES ONLY   │
 * │  WHEN AUTHORIZED                                                             │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * PROPÓSITO:
 *   Smoke controlado de escritura en Supabase para validar que el tamaño detectado
 *   desde sourceTitle/sourceSnippet llega hasta:
 *     - rich_profile.size.estimated_range
 *     - metadata.employee_size_resolution.selected_source = rich_profile_size
 *     - metadata.icp_size_gate.decision
 *     - icp_size_gate_summary del batch
 *
 *   sin Tavily, sin LLM, sin richProfileEnrichmentOverride, sin provider_usage_logs.
 *
 * GARANTÍAS ABSOLUTAS:
 *   - 0 llamadas Tavily
 *   - 0 llamadas LLM
 *   - 0 provider_usage_logs
 *   - 0 richProfileEnrichmentOverride
 *   - 0 hard DELETE
 *   - DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled permanece false
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled permanece false
 *   - cleanup_mode=logical_only
 *
 * CANDIDATOS SINTÉTICOS (4):
 *   1. SNIPPET PASS    — domain: sellup-snippet-pass-smoke.example
 *      snippet: "Somos una compañía con más de 500 colaboradores en Latinoamérica."
 *      → rich_profile.size="501-1000" → icp_size_gate.decision=pass → SE INSERTA
 *
 *   2. SNIPPET BLOCK   — domain: sellup-snippet-block-smoke.example
 *      snippet: "Empresa con 51-200 empleados en Colombia."
 *      → rich_profile.size="51-200" → icp_size_gate.decision=block → NO SE INSERTA
 *
 *   3. FALSE POSITIVE  — domain: sellup-snippet-false-positive-smoke.example
 *      snippet: "Atendemos a más de 500 clientes en la región."
 *      → rich_profile.size=null (clientes≠empleados) → needs_validation → SE INSERTA
 *
 *   4. NO SIZE         — domain: sellup-snippet-no-size-smoke.example
 *      snippet: "Empresa de tecnología enfocada en transformación digital."
 *      → rich_profile.size=null → needs_validation → SE INSERTA
 *
 * EXPECTED WRITES (cuando se autorice):
 *   - 1 prospect_batch smoke insertado
 *   - 3 prospect_candidates smoke insertados (PASS + FALSE_POSITIVE + NO_SIZE)
 *   - 1 candidato bloqueado/skipped (BLOCK)
 *   - 0 provider_usage_logs
 *   - 0 Tavily
 *   - 0 LLM
 *
 * PRECHECK DB (verificado el 2026-06-24):
 *   - sellup-snippet-pass-smoke.example          → active_count=0, total_count=0
 *   - sellup-snippet-block-smoke.example         → active_count=0, total_count=0
 *   - sellup-snippet-false-positive-smoke.example → active_count=0, total_count=0
 *   - sellup-snippet-no-size-smoke.example        → active_count=0, total_count=0
 *
 * EJECUCIÓN (requiere autorización explícita):
 *   NODE_ENV=development node --env-file=.env.local --import tsx \
 *     scripts/agent1/smoke-source-snippet-size-write.ts
 *
 * NOTA: Este script NO debe ejecutarse sin revisión y autorización explícita
 *       del Preflight Report de v1.16K-A.
 */

import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { writeProspectingCandidates } from '../../src/server/agents/prospecting-toolkit/candidate-writer';
import { DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG } from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import type { ProspectingPipelineOutput } from '../../src/server/agents/prospecting-toolkit/types';

// ─── Constants (exported for tests) ──────────────────────────────────────────

export const SMOKE_TYPE = 'source_snippet_size_v1_16k_a';
export const SCRIPT_NAME = 'v1_16k_a_source_snippet_size_write_smoke';

// Dominios sintéticos verificados — active_count=0 en precheck 2026-06-24
// Patrón: domain normalizado contiene company name normalizado → pasa company_ownership gate
export const DOMAIN_PASS           = 'sellup-snippet-pass-smoke.example';
export const DOMAIN_BLOCK          = 'sellup-snippet-block-smoke.example';
export const DOMAIN_FALSE_POSITIVE = 'sellup-snippet-false-positive-smoke.example';
export const DOMAIN_UNKNOWN        = 'sellup-snippet-no-size-smoke.example';

// userId real — egarcia@ubits.co
const AUTHORIZED_USER_ID = '5a8fb462-eecb-41f2-bfab-2c8fb6e3f73c';

// ─── Scenario Config (exported for tests) ────────────────────────────────────

export type SmokeScenario = {
  scenario: string;
  domain: string;
  name: string;
  sourceTitle: string;
  sourceSnippet: string;
  expectedSizeRange: string | null;
  expectedIcpDecision: 'pass' | 'block' | 'needs_validation';
  expectedInserted: boolean;
  expectedSkipReason?: string;
};

export const SMOKE_SCENARIOS: readonly SmokeScenario[] = [
  {
    scenario: 'snippet_pass',
    domain: DOMAIN_PASS,
    name: 'SellUp Snippet Pass Smoke',
    sourceTitle: 'Empresa tecnológica con más de 500 colaboradores en Colombia',
    sourceSnippet: 'Somos una compañía con más de 500 colaboradores en Latinoamérica. Ofrecemos soluciones de software empresarial a clientes en Colombia y la región.',
    expectedSizeRange: '501-1000',
    expectedIcpDecision: 'pass',
    expectedInserted: true,
  },
  {
    scenario: 'snippet_block',
    domain: DOMAIN_BLOCK,
    name: 'SellUp Snippet Block Smoke',
    sourceTitle: 'Empresa de software con 51-200 empleados en Colombia',
    sourceSnippet: 'Empresa con 51-200 empleados en Colombia, especializada en soluciones de gestión empresarial para el mercado local.',
    expectedSizeRange: '51-200',
    expectedIcpDecision: 'block',
    expectedInserted: false,
    expectedSkipReason: 'icp_size_below_threshold',
  },
  {
    scenario: 'false_positive_clients',
    domain: DOMAIN_FALSE_POSITIVE,
    name: 'SellUp Snippet False Positive Smoke',
    sourceTitle: 'Plataforma de servicios empresariales en Colombia',
    sourceSnippet: 'Atendemos a más de 500 clientes corporativos en la región. Empresa de tecnología en Colombia.',
    expectedSizeRange: null,
    expectedIcpDecision: 'needs_validation',
    expectedInserted: true,
  },
  {
    scenario: 'no_size_evidence',
    domain: DOMAIN_UNKNOWN,
    name: 'SellUp Snippet No Size Smoke',
    sourceTitle: 'Empresa de tecnología en Colombia',
    sourceSnippet: 'Empresa de tecnología enfocada en transformación digital para el mercado empresarial colombiano.',
    expectedSizeRange: null,
    expectedIcpDecision: 'needs_validation',
    expectedInserted: true,
  },
] as const;

// ─── Expected Writes (exported for tests) ────────────────────────────────────

export const EXPECTED_WRITES = {
  batch: 1,
  candidates: 3,
  skipped: 1,
  provider_usage_logs: 0,
  tavily: 0,
  llm: 0,
} as const;

// ─── Extra batch metadata (exported for tests) ────────────────────────────────

export const EXTRA_BATCH_METADATA: Record<string, unknown> = {
  smoke_test: true,
  smoke_type: SMOKE_TYPE,
  qa_only: true,
  do_not_use_for_sales: true,
  do_not_convert: true,
  created_by_script: SCRIPT_NAME,
  cleanup_mode: 'logical_only',
};

// ─── Cleanup SQL (exported for tests) ────────────────────────────────────────

export function buildCleanupSql(batchId?: string | null): string {
  const batchFilter = batchId
    ? `WHERE id = '${batchId}'`
    : `WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'`;

  const domainList = [DOMAIN_PASS, DOMAIN_BLOCK, DOMAIN_FALSE_POSITIVE, DOMAIN_UNKNOWN]
    .map((d) => `'${d}'`)
    .join(',\n  ');

  return `-- 1. Logical cleanup de candidatos smoke:
UPDATE public.prospect_candidates
SET
  status = 'discarded',
  metadata = jsonb_set(
    COALESCE(metadata, '{}'),
    '{logical_cleanup}',
    '{"reason": "qa_smoke_${SMOKE_TYPE}", "cleanup_mode": "logical_only"}'::jsonb
  )
WHERE lower(domain) IN (
  ${domainList}
)
AND status NOT IN ('discarded', 'rejected');

-- 2. Logical cleanup del batch smoke:
UPDATE public.prospect_batches
SET
  status = 'completed',
  metadata = jsonb_set(
    COALESCE(metadata, '{}'),
    '{logical_cleanup}',
    '{"reason": "qa_smoke_${SMOKE_TYPE}", "cleanup_mode": "logical_only"}'::jsonb
  )
${batchFilter}
AND status NOT IN ('completed');

-- 3. Inspección post-cleanup:
SELECT id, domain, name, status,
  metadata->'rich_profile'->'size' AS rich_profile_size,
  metadata->'icp_size_gate' AS icp_size_gate,
  metadata->'employee_size_resolution' AS employee_size_resolution,
  created_at
FROM public.prospect_candidates
WHERE lower(domain) IN (
  ${domainList}
)
ORDER BY created_at DESC;`;
}

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
 * Construye el pipelineOutput sintético con 4 candidatos QA.
 *
 * IMPORTANTE: No usa richProfileEnrichmentOverride.
 * El tamaño de empresa se detecta desde sourceSnippet por buildCandidateRichProfileV1
 * vía parseEmployeeSizeFromText. 0 API calls. 0 LLM.
 */
export function buildSyntheticPipelineOutput(): ProspectingPipelineOutput {
  const baseScoring = {
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
    searchQuery: `smoke_${SMOKE_TYPE}`,
    webSearch: {
      provider: 'mock',
      query: `smoke_${SMOKE_TYPE}`,
      results: [],
      resultsCount: SMOKE_SCENARIOS.length,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates: SMOKE_SCENARIOS.map((s) => ({
      name: s.name,
      website: null,
      domain: s.domain,
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      sourceUrl: null,
      sourceTitle: s.sourceTitle,
      sourceSnippet: s.sourceSnippet,
      websiteVerification: null,
      duplicateCheck: null,
      scoring: {
        ...baseScoring,
        metadata: {
          qa_smoke: true,
          smoke_scenario: s.scenario,
          expected_size_range: s.expectedSizeRange,
          expected_icp_decision: s.expectedIcpDecision,
        },
      },
    })),
    summary: {
      requested: SMOKE_SCENARIOS.length,
      searched: SMOKE_SCENARIOS.length,
      returned: SMOKE_SCENARIOS.length,
      highQualityNew: EXPECTED_WRITES.candidates,
      needsReview: 0,
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
      // No richProfileEnrichmentOverride — size comes from sourceSnippet natively
      rich_profile_enrichment_override: false,
    },
  };
}

// ─── Preflight report ─────────────────────────────────────────────────────────

function printPreflight(git: ReturnType<typeof getGitInfo>) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  PREFLIGHT — Source Snippet Size Write Smoke v1.16K-A            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  branch:                               ${git.branch}`);
  console.log(`  HEAD local:                           ${git.headLocal}`);
  console.log(`  HEAD origin/main:                     ${git.headRemote}`);
  console.log(`  working_tree:                         ${git.clean ? 'clean ✓' : 'DIRTY'}`);
  console.log(`  smoke_type:                           ${SMOKE_TYPE}`);
  console.log(`  script:                               ${SCRIPT_NAME}`);
  console.log(`  DEFAULT_RICH_PROFILE.enabled:         ${DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled}`);
  console.log(`  DEFAULT_LINKEDIN.enabled:             ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);
  console.log(`  richProfileEnrichmentOverride:        NONE (size comes from sourceSnippet)`);
  console.log(`  tavily_calls:                         0 (HARD GUARD)`);
  console.log(`  llm_calls:                            0 (HARD GUARD)`);
  console.log(`  provider_usage_logs:                  0 (HARD GUARD)`);
  console.log(`  dryRun:                               false (WRITES REALES)`);
  console.log(`  userId:                               ${AUTHORIZED_USER_ID}`);
  console.log(`  cleanup_mode:                         logical_only`);
  console.log('\n  Dominios sintéticos (precheck 2026-06-24 → active_count=0):');
  for (const s of SMOKE_SCENARIOS) {
    const label = s.scenario.toUpperCase().padEnd(22);
    console.log(`    ${label} → ${s.domain}`);
  }
  console.log('\n  Expected writes cuando se autorice:');
  console.log(`    [1] INSERT prospect_batches (1 row, smoke_test=true)`);
  for (const s of SMOKE_SCENARIOS) {
    if (s.expectedInserted) {
      console.log(`    [✓] INSERT ${s.name} → icp_size_gate.decision=${s.expectedIcpDecision}`);
    } else {
      console.log(`    [✗] SKIP   ${s.name} → ${s.expectedSkipReason}`);
    }
  }
  console.log(`    [0] INSERT provider_usage_logs → NONE`);
  console.log(`    [0] Tavily calls → NONE`);
  console.log(`    [0] LLM calls → NONE`);
  console.log('\n  Expected batch icp_size_gate_summary:');
  console.log('    { threshold: 200, pass_count: 1, needs_validation_count: 2, blocked_count: 1 }');
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Inspection SQL ───────────────────────────────────────────────────────────

function printInspectionSql(batchId: string) {
  const domainList = [DOMAIN_PASS, DOMAIN_BLOCK, DOMAIN_FALSE_POSITIVE, DOMAIN_UNKNOWN]
    .map((d) => `'${d}'`)
    .join(',\n  ');

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  SQL DE INSPECCIÓN POST-RUN (copiar en Supabase Studio)           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('\n-- 1. Batch smoke:');
  console.log(`SELECT
  id,
  name,
  status,
  created_at,
  metadata->>'smoke_test'                              AS smoke_test,
  metadata->>'smoke_type'                              AS smoke_type,
  metadata->'icp_size_gate_summary'                    AS icp_size_gate_summary,
  metadata->'logical_cleanup'                          AS logical_cleanup
FROM public.prospect_batches
WHERE id = '${batchId}';`);

  console.log('\n-- 2. Candidatos smoke:');
  console.log(`SELECT
  id,
  name,
  domain,
  status,
  metadata->'rich_profile'->'size'                     AS rich_profile_size,
  metadata->'rich_profile'->'size'->'icp_size_gate'    AS icp_size_gate,
  metadata->'employee_size_resolution'                 AS employee_size_resolution,
  requires_human_review,
  created_at
FROM public.prospect_candidates
WHERE lower(domain) IN (
  ${domainList}
)
ORDER BY created_at DESC;`);
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Cleanup SQL printer ──────────────────────────────────────────────────────

function printCleanupSqlSection(batchId?: string | null) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  CLEANUP SQL PROPUESTO (copiar — NO ejecutar automáticamente)     ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  console.log(buildCleanupSql(batchId));
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  SOURCE SNIPPET SIZE SMOKE — 0 API CALLS — 0 LLM — SUPABASE WRITES ONLY   │');
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
  console.log('[smoke] richProfileEnrichmentOverride: NONE (size comes from sourceSnippet natively)');

  // IMPORTANTE: NO se pasa richProfileEnrichmentOverride.
  // El tamaño de empresa se detecta desde sourceSnippet vía parseEmployeeSizeFromText
  // dentro de buildCandidateRichProfileV1. 0 API calls. 0 LLM.
  const result = await writeProspectingCandidates(
    {
      pipelineOutput,
      triggeredByUserId: AUTHORIZED_USER_ID,
      ownerId: AUTHORIZED_USER_ID,
      batchName: `[SMOKE] Source Snippet Size v1.16K-A — ${new Date().toISOString().slice(0, 10)}`,
      source: 'agent_1',
      dryRun: false,
      extraBatchMetadata: EXTRA_BATCH_METADATA,
    },
    adminClient,
    // No LinkedIn override — feature disabled by default
    undefined,
    // No richProfileEnrichmentOverride — this smoke validates the base buildCandidateRichProfile,
    // not the enrichment mock. Size comes from sourceSnippet natively.
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
  printCleanupSqlSection(result.batchId);

  // Post-run verifications
  const blockSkipped = result.skipped.find((s) => s.reason === 'icp_size_below_threshold');
  if (!blockSkipped) {
    console.warn('[smoke] WARNING: Se esperaba 1 candidato bloqueado por icp_size_below_threshold');
  } else {
    console.log('[smoke] ✓ BLOCK fue omitido correctamente (icp_size_below_threshold)');
  }

  if (result.candidatesCreated === EXPECTED_WRITES.candidates) {
    console.log(`[smoke] ✓ candidatesCreated=${result.candidatesCreated} (PASS + FALSE_POSITIVE + NO_SIZE)`);
  } else {
    console.warn(`[smoke] WARNING: Se esperaban ${EXPECTED_WRITES.candidates} candidatos, se insertaron ${result.candidatesCreated}`);
  }

  console.log('\n[smoke] Smoke completado. Revisar Supabase con los SQL de inspección.');
}

// Only execute when run directly — not when imported by tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('\n[smoke] ERROR FATAL:', err);
    process.exit(1);
  });
}
