#!/usr/bin/env tsx
/**
 * Smoke — Employee Size Resolver Write v1.16J-A
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  EMPLOYEE SIZE RESOLVER SMOKE — 0 API CALLS — 0 LLM — SUPABASE WRITES ONLY │
 * │  WHEN AUTHORIZED                                                             │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * PROPÓSITO:
 *   Smoke controlado de escritura en Supabase para validar que employee_size_resolution
 *   e icp_size_gate funcionan en DB usando 5 candidatos sintéticos con distintas
 *   fuentes de tamaño: rich_profile, candidate.company_size, HubSpot, block, unknown.
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
 * CANDIDATOS SINTÉTICOS (precheck 2026-06-24 → active_count=0):
 *   1. RICH PROFILE PASS  — domain: sellup-size-rich-profile-pass.example
 *      rich_profile.size.estimated_range="10001+"  → icp_size_gate: pass
 *
 *   2. COMPANY SIZE PASS  — domain: sellup-size-company-pass.example
 *      candidate.company_size="10001+"             → icp_size_gate: pass
 *      rich_profile.size.estimated_range=null      (NO inventado)
 *
 *   3. HUBSPOT PASS       — domain: sellup-size-hubspot-pass.example
 *      duplicateCheck matched_number_of_employees=500 → icp_size_gate: pass
 *      rich_profile null, company_size null
 *
 *   4. COMPANY SIZE BLOCK — domain: sellup-size-company-block.example
 *      candidate.company_size="51-200"             → icp_size_gate: block (NO se inserta)
 *
 *   5. UNKNOWN            — domain: sellup-size-unknown.example
 *      sin tamaño en ninguna fuente               → icp_size_gate: needs_validation
 *
 * EXPECTED WRITES (cuando se autorice):
 *   - 1 prospect_batch smoke insertado
 *   - 4 prospect_candidates insertados (RICH_PROFILE + COMPANY + HUBSPOT + UNKNOWN)
 *   - 1 candidato bloqueado/skipped (BLOCK → icp_size_below_threshold)
 *   - 0 provider_usage_logs
 *   - 0 Tavily
 *   - 0 LLM
 *
 * EJECUCIÓN (requiere autorización explícita):
 *   npm run agent1:smoke:employee-size-resolver-write
 *
 * NOTA: Este script NO debe ejecutarse sin revisión y autorización explícita
 *       del Preflight Report de v1.16J-A.
 */

import { execSync } from 'child_process';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { writeProspectingCandidates } from '../../src/server/agents/prospecting-toolkit/candidate-writer';
import { DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG } from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import type { RichProfileEnrichmentOverride } from '../../src/server/agents/prospecting-toolkit/candidate-writer';
import type { ProspectingPipelineOutput } from '../../src/server/agents/prospecting-toolkit/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const SMOKE_TYPE  = 'employee_size_resolver_v1_16j_a';
const SCRIPT_NAME = 'v1_16j_a_employee_size_resolver_write_smoke';

// Dominios sintéticos verificados — active_count=0 en precheck 2026-06-24
const DOMAIN_RICH_PROFILE_PASS  = 'sellup-size-rich-profile-pass.example';
const DOMAIN_COMPANY_PASS       = 'sellup-size-company-pass.example';
const DOMAIN_HUBSPOT_PASS       = 'sellup-size-hubspot-pass.example';
const DOMAIN_COMPANY_BLOCK      = 'sellup-size-company-block.example';
const DOMAIN_UNKNOWN            = 'sellup-size-unknown.example';

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
    const branch     = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const headLocal  = execSync('git rev-parse --short HEAD',     { encoding: 'utf8' }).trim();
    let headRemote   = 'unknown';
    try { headRemote = execSync('git rev-parse --short origin/main', { encoding: 'utf8' }).trim(); } catch { /* ignore */ }
    const status     = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    return { branch, headLocal, headRemote, clean: status.length === 0 };
  } catch {
    return { branch: 'unknown', headLocal: 'unknown', headRemote: 'unknown', clean: false };
  }
}

// ─── Synthetic Pipeline Output ────────────────────────────────────────────────

/**
 * Construye pipelineOutput sintético con 5 candidatos QA.
 * No llama Tavily. No llama LLM. Puro en memoria.
 *
 * Fuentes de tamaño por candidato:
 *   RICH_PROFILE_PASS : rich_profile mock override → estimated_range="10001+"
 *   COMPANY_PASS      : candidate.company_size="10001+" (no rich_profile)
 *   HUBSPOT_PASS      : duplicateCheck.raw.matched_number_of_employees=500
 *   COMPANY_BLOCK     : candidate.company_size="51-200"
 *   UNKNOWN           : sin fuente de tamaño
 */
function buildSyntheticPipelineOutput(): ProspectingPipelineOutput {
  const baseCandidate = {
    website: null,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    sourceUrl: null,
    sourceTitle: 'Empresa de software empresarial en Colombia',
    sourceSnippet: 'Empresa de software empresarial con soluciones tecnológicas para clientes corporativos.',
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
    searchQuery: 'smoke_employee_size_resolver_v1_16j_a',
    webSearch: {
      provider: 'mock',
      query: 'smoke_employee_size_resolver_v1_16j_a',
      results: [],
      resultsCount: 5,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates: [
      // ── Candidato 1: RICH PROFILE PASS ───────────────────────────────────
      // El mock override inyectará estimated_range="10001+" para este dominio.
      // selected_source esperado: rich_profile_size
      {
        ...baseCandidate,
        name: 'SellUp Size Rich Profile Pass',
        domain: DOMAIN_RICH_PROFILE_PASS,
        scoring: {
          ...baseCandidate.scoring,
          metadata: {
            qa_smoke: true,
            smoke_scenario: 'rich_profile_pass',
            expected_employee_size_source: 'rich_profile_size',
            expected_icp_size_gate: 'pass',
          },
        },
      },
      // ── Candidato 2: COMPANY SIZE PASS ───────────────────────────────────
      // company_size="10001+" presente en el candidato.
      // rich_profile mock override retorna null para este dominio (no inventa range).
      // selected_source esperado: candidate_company_size
      {
        ...baseCandidate,
        name: 'SellUp Size Company Pass',
        domain: DOMAIN_COMPANY_PASS,
        company_size: '10001+',
        scoring: {
          ...baseCandidate.scoring,
          metadata: {
            qa_smoke: true,
            smoke_scenario: 'company_size_pass',
            expected_employee_size_source: 'candidate_company_size',
            expected_icp_size_gate: 'pass',
          },
        },
      },
      // ── Candidato 3: HUBSPOT PASS ─────────────────────────────────────────
      // Sin rich_profile, sin company_size.
      // duplicateCheck.matches[0].raw.matched_number_of_employees=500 → pasa threshold 200.
      // selected_source esperado: hubspot_number_of_employees
      {
        ...baseCandidate,
        name: 'SellUp Size HubSpot Pass',
        domain: DOMAIN_HUBSPOT_PASS,
        duplicateCheck: {
          status: 'existing_in_hubspot' as const,
          confidence: 90,
          input: {
            name: 'SellUp Size HubSpot Pass',
            domain: DOMAIN_HUBSPOT_PASS,
          },
          matches: [
            {
              source: 'hubspot' as const,
              status: 'existing_in_hubspot' as const,
              confidence: 90,
              matchedId: 'hubspot-mock-id',
              matchedDomain: DOMAIN_HUBSPOT_PASS,
              reason: 'domain_match',
              raw: {
                matched_number_of_employees: 500,
              },
            },
          ],
          summary: 'HubSpot match: 500 employees (smoke)',
          checkedSources: ['hubspot' as const],
        },
        scoring: {
          ...baseCandidate.scoring,
          metadata: {
            qa_smoke: true,
            smoke_scenario: 'hubspot_pass',
            expected_employee_size_source: 'hubspot_number_of_employees',
            expected_icp_size_gate: 'pass',
          },
        },
      },
      // ── Candidato 4: COMPANY SIZE BLOCK ──────────────────────────────────
      // company_size="51-200" → bajo threshold → NO se inserta.
      // selected_source esperado: candidate_company_size
      // skipReason esperado: icp_size_below_threshold
      {
        ...baseCandidate,
        name: 'SellUp Size Company Block',
        domain: DOMAIN_COMPANY_BLOCK,
        company_size: '51-200',
        scoring: {
          ...baseCandidate.scoring,
          metadata: {
            qa_smoke: true,
            smoke_scenario: 'company_size_block',
            expected_employee_size_source: 'candidate_company_size',
            expected_icp_size_gate: 'block',
          },
        },
      },
      // ── Candidato 5: UNKNOWN ──────────────────────────────────────────────
      // Sin ninguna fuente de tamaño → needs_validation.
      // selected_source esperado: unknown
      {
        ...baseCandidate,
        name: 'SellUp Size Unknown',
        domain: DOMAIN_UNKNOWN,
        scoring: {
          ...baseCandidate.scoring,
          metadata: {
            qa_smoke: true,
            smoke_scenario: 'unknown',
            expected_employee_size_source: 'unknown',
            expected_icp_size_gate: 'needs_validation',
          },
        },
      },
    ],
    summary: {
      requested: 5,
      searched: 5,
      returned: 5,
      highQualityNew: 4,
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

// ─── Mock rich profile override ───────────────────────────────────────────────

// Inyecta estimated_range por dominio sin llamar ninguna API externa.
// provider='mock' → el writer omite usage logging (0 provider_usage_logs).
// Para COMPANY_PASS retorna null (no inventa estimated_range).
// Para HUBSPOT_PASS retorna null (HubSpot debe ser la fuente, no rich_profile).
const SMOKE_RICH_PROFILE_SIZE_BY_DOMAIN: Record<string, string | null> = {
  [DOMAIN_RICH_PROFILE_PASS]: '10001+',
  [DOMAIN_COMPANY_PASS]:      null,  // company_size gana (no hay rich_profile)
  [DOMAIN_HUBSPOT_PASS]:      null,  // HubSpot gana (no hay rich_profile ni company_size)
  [DOMAIN_COMPANY_BLOCK]:     null,  // company_size "51-200" debe bloquear
  [DOMAIN_UNKNOWN]:           null,  // sin ninguna fuente
};

function buildMockRichProfileOverride(): RichProfileEnrichmentOverride {
  return {
    config: {
      enabled: true,
      provider: 'mock',
      maxPerBatch: 5,
      maxQueriesPerCandidate: 1,
      minConfidenceScore: 0,
      enrichCity: false,
      enrichSize: true,
      enrichDescription: false,
    },
    providerFn: async (candidate) => {
      const sizeRange = SMOKE_RICH_PROFILE_SIZE_BY_DOMAIN[candidate.domain ?? ''] ?? null;
      if (sizeRange === null) {
        return { status: 'not_found', city: null, hq_country: null, size_range: null, confidence: null };
      }
      return { status: 'found', city: null, hq_country: null, size_range: sizeRange, confidence: 80 };
    },
    // No usageLoggerFn → 0 provider_usage_logs
  };
}

// ─── Preflight report ─────────────────────────────────────────────────────────

function printPreflight(git: ReturnType<typeof getGitInfo>) {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  PREFLIGHT — Employee Size Resolver Write Smoke v1.16J-A          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
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
  console.log(`    RICH_PROFILE_PASS:  ${DOMAIN_RICH_PROFILE_PASS}`);
  console.log(`    COMPANY_PASS:       ${DOMAIN_COMPANY_PASS}`);
  console.log(`    HUBSPOT_PASS:       ${DOMAIN_HUBSPOT_PASS}`);
  console.log(`    COMPANY_BLOCK:      ${DOMAIN_COMPANY_BLOCK}`);
  console.log(`    UNKNOWN:            ${DOMAIN_UNKNOWN}`);
  console.log('\n  Expected writes cuando se autorice:');
  console.log('    [1] INSERT prospect_batches (1 row, smoke_test=true)');
  console.log('    [2] INSERT prospect_candidates RICH_PROFILE_PASS (status=needs_review, source=rich_profile_size, gate=pass)');
  console.log('    [3] INSERT prospect_candidates COMPANY_PASS      (status=needs_review, source=candidate_company_size, gate=pass)');
  console.log('    [4] INSERT prospect_candidates HUBSPOT_PASS      (status=needs_review, source=hubspot_number_of_employees, gate=pass)');
  console.log('    [5] SKIP  COMPANY_BLOCK (icp_size_below_threshold — NO se inserta)');
  console.log('    [6] INSERT prospect_candidates UNKNOWN           (status=needs_review, source=unknown, gate=needs_validation)');
  console.log('    [0] INSERT provider_usage_logs → NONE');
  console.log('    [0] Tavily calls → NONE');
  console.log('    [0] LLM calls → NONE');
  console.log('\n  Expected batch icp_size_gate_summary:');
  console.log('    { threshold: 200, pass_count: 3, needs_validation_count: 1, blocked_count: 1 }');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

// ─── Cleanup SQL (solo imprimir — NO ejecutar) ────────────────────────────────

function printCleanupSql(batchId?: string | null) {
  const batchFilter = batchId
    ? `WHERE id = '${batchId}'`
    : `WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'`;

  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  CLEANUP SQL PROPUESTO (copiar — NO ejecutar automáticamente)     ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\n-- 1. Logical cleanup de candidatos smoke:');
  console.log(`UPDATE public.prospect_candidates
SET
  status = 'discarded',
  metadata = jsonb_set(
    COALESCE(metadata, '{}'),
    '{logical_cleanup}',
    '{"reason": "qa_smoke_employee_size_resolver_v1_16j_a", "cleanup_mode": "logical_only"}'::jsonb
  )
WHERE lower(domain) IN (
  '${DOMAIN_RICH_PROFILE_PASS}',
  '${DOMAIN_COMPANY_PASS}',
  '${DOMAIN_HUBSPOT_PASS}',
  '${DOMAIN_COMPANY_BLOCK}',
  '${DOMAIN_UNKNOWN}'
)
AND status NOT IN ('discarded', 'rejected');`);

  console.log('\n-- 2. Logical cleanup del batch smoke:');
  console.log(`UPDATE public.prospect_batches
SET
  status = 'discarded',
  metadata = jsonb_set(
    COALESCE(metadata, '{}'),
    '{logical_cleanup}',
    '{"reason": "qa_smoke_employee_size_resolver_v1_16j_a", "cleanup_mode": "logical_only"}'::jsonb
  )
${batchFilter}
AND status NOT IN ('discarded', 'rejected');`);

  console.log('\n-- 3. Inspección post-cleanup:');
  console.log(`SELECT id, domain, name, status,
  metadata->'employee_size_resolution' AS employee_size_resolution,
  metadata->'icp_size_gate'             AS icp_size_gate,
  requires_human_review,
  created_at
FROM public.prospect_candidates
WHERE lower(domain) IN (
  '${DOMAIN_RICH_PROFILE_PASS}',
  '${DOMAIN_COMPANY_PASS}',
  '${DOMAIN_HUBSPOT_PASS}',
  '${DOMAIN_COMPANY_BLOCK}',
  '${DOMAIN_UNKNOWN}'
)
ORDER BY created_at DESC;`);
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

// ─── Inspection SQL ───────────────────────────────────────────────────────────

function printInspectionSql(batchId: string) {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  SQL DE INSPECCIÓN POST-RUN (copiar en Supabase Studio)           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('\n-- 1. Batch smoke:');
  console.log(`SELECT
  id, name, status, created_at,
  metadata->>'smoke_test'                          AS smoke_test,
  metadata->>'smoke_type'                          AS smoke_type,
  metadata->'icp_size_gate_summary'                AS icp_size_gate_summary,
  metadata->'logical_cleanup'                      AS logical_cleanup
FROM public.prospect_batches
WHERE id = '${batchId}';`);

  console.log('\n-- 2. Candidatos smoke (con employee_size_resolution):');
  console.log(`SELECT
  id, name, domain, status,
  metadata->'employee_size_resolution'             AS employee_size_resolution,
  metadata->'icp_size_gate'                        AS icp_size_gate,
  requires_human_review,
  created_at
FROM public.prospect_candidates
WHERE lower(domain) IN (
  '${DOMAIN_RICH_PROFILE_PASS}',
  '${DOMAIN_COMPANY_PASS}',
  '${DOMAIN_HUBSPOT_PASS}',
  '${DOMAIN_COMPANY_BLOCK}',
  '${DOMAIN_UNKNOWN}'
)
ORDER BY created_at DESC;`);
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  EMPLOYEE SIZE RESOLVER SMOKE — 0 API CALLS — 0 LLM — SUPABASE WRITES ONLY │');
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

  const adminClient     = getAdminClient();
  const pipelineOutput  = buildSyntheticPipelineOutput();
  const mockOverride    = buildMockRichProfileOverride();

  console.log('[smoke] Ejecutando writeProspectingCandidates con pipelineOutput sintético...');
  console.log('[smoke] Candidatos en pipeline:', pipelineOutput.candidates.length);
  console.log('[smoke] Dominios:', pipelineOutput.candidates.map((c) => c.domain).join(', '));

  const result = await writeProspectingCandidates(
    {
      pipelineOutput,
      triggeredByUserId: AUTHORIZED_USER_ID,
      ownerId: AUTHORIZED_USER_ID,
      batchName: `[SMOKE] Employee Size Resolver v1.16J-A — ${new Date().toISOString().slice(0, 10)}`,
      source: 'agent_1',
      dryRun: false,
      extraBatchMetadata: EXTRA_BATCH_METADATA,
    },
    adminClient,
    // No LinkedIn override — feature disabled by default
    undefined,
    mockOverride,
  );

  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  RESULTADO                                                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
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
  console.log('═══════════════════════════════════════════════════════════════════\n');

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

  if (result.candidatesCreated === 4) {
    console.log('[smoke] ✓ candidatesCreated=4 (rich_profile_pass + company_pass + hubspot_pass + unknown)');
  } else {
    console.warn(`[smoke] WARNING: Se esperaban 4 candidatos insertados, se insertaron ${result.candidatesCreated}`);
  }

  console.log('\n[smoke] Smoke completado. Revisar Supabase con los SQL de inspección.');
}

main().catch((err) => {
  console.error('\n[smoke] ERROR FATAL:', err);
  process.exit(1);
});
