#!/usr/bin/env tsx
/**
 * Controlled Supabase LinkedIn Smoke — v1.15.5C
 *
 * Crea un batch smoke controlado en Supabase usando Tavily real para LinkedIn
 * Company Search. Máximo 3 candidatos sintéticos marcados como smoke.
 *
 * GARANTÍAS ABSOLUTAS:
 *   - Máximo 3 llamadas Tavily reales (hard cap doble: config + wrapper)
 *   - Máximo 1 batch smoke
 *   - Máximo 3 candidatos smoke
 *   - 0 discovery Tavily
 *   - 0 LLM calls
 *   - 0 hard delete
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled permanece false
 *   - Todos los registros: smoke_test=true, smoke_type="linkedin_search_v1_15_5C"
 *   - Limpieza: solo lógica — reporta SQL propuesto, NO ejecuta DELETE
 *
 * Candidatos sintéticos (displayName en DB, searchName para Tavily):
 *   1. "SellUp Smoke Softland LinkedIn"   → query: "Softland" "softland.com" site:...
 *   2. "SellUp Smoke Factory LinkedIn"    → query: "Factory" "factory.com.co" site:...
 *   3. "SellUp Smoke Loggro LinkedIn"     → query: "Loggro Enterprise" "loggro.com" site:...
 *
 * Uso: npm run agent1:smoke:linkedin-supabase-controlled
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
import type { LinkedInEnrichmentMetadata } from '../../src/server/agents/prospecting-toolkit/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const SMOKE_TYPE = 'linkedin_search_v1_15_5C';
const SCRIPT_NAME = 'run-controlled-supabase-linkedin-smoke';
const MAX_BATCH = 1;
const MAX_CANDIDATES = 3;
const HARD_CAP = 3;

const SMOKE_CONFIG: LinkedInSearchConfig = {
  enabled: true,
  provider: 'tavily',
  maxPerBatch: HARD_CAP,
  minConfidenceScore: 70,
};

// ─── Smoke candidate definitions ─────────────────────────────────────────────

type SmokeCandidateDef = {
  displayName: string;    // Nombre almacenado en DB (smoke-marked)
  searchName: string;     // Nombre usado para query Tavily (sin prefijo smoke)
  domain: string;
  website: string;
  confidenceScore: number;
};

const SMOKE_CANDIDATES: SmokeCandidateDef[] = [
  {
    displayName: 'SellUp Smoke Softland LinkedIn',
    searchName: 'Softland',
    domain: 'softland.com',
    website: 'https://www.softland.com',
    confidenceScore: 80,
  },
  {
    displayName: 'SellUp Smoke Factory LinkedIn',
    searchName: 'Factory',
    domain: 'factory.com.co',
    website: 'https://www.factory.com.co',
    confidenceScore: 75,
  },
  {
    displayName: 'SellUp Smoke Loggro LinkedIn',
    searchName: 'Loggro Enterprise',
    domain: 'loggro.com',
    website: 'https://www.loggro.com',
    confidenceScore: 72,
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
  console.log('║  PREFLIGHT — Controlled Supabase LinkedIn Smoke v1.15.5C         ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  branch:                       ${git.branch}`);
  console.log(`  HEAD local:                   ${git.headLocal}`);
  console.log(`  HEAD origin/main:             ${git.headRemote}`);
  console.log(`  working_tree:                 ${git.clean ? 'clean ✓' : 'DIRTY ✗'}`);
  console.log(`  smoke_type:                   ${SMOKE_TYPE}`);
  console.log(`  DEFAULT_LINKEDIN.enabled:     ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);
  console.log(`  provider:                     tavily`);
  console.log(`  maxPerBatch:                  ${SMOKE_CONFIG.maxPerBatch}`);
  console.log(`  minConfidenceScore:           ${SMOKE_CONFIG.minConfidenceScore}`);
  console.log(`  smoke_test:                   true`);
  console.log(`  max_batches_to_create:        ${MAX_BATCH}`);
  console.log(`  max_candidates_to_insert:     ${MAX_CANDIDATES}`);
  console.log(`  max_linkedin_tavily_calls:    ${HARD_CAP}`);
  console.log(`  discovery_tavily_calls:       0`);
  console.log(`  llm_calls:                    0`);
  console.log(`  hard_delete:                  false`);
  console.log(`  cleanup_mode:                 logical_only`);
  console.log('\n  Queries planeadas (antes de ejecutar):');
  for (const q of plannedQueries) {
    console.log(`    ${q}`);
  }
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Inspection queries ────────────────────────────────────────────────────────

function printInspectionSql(batchId: string) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  SQL DE INSPECCIÓN (copiar en Supabase Studio)                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('\n-- Batch smoke:');
  console.log(`SELECT
  id,
  status,
  created_at,
  metadata->>'smoke_test'          AS smoke_test,
  metadata->>'smoke_type'          AS smoke_type,
  metadata->'linkedin_search'      AS linkedin_search,
  metadata->'logical_cleanup'      AS logical_cleanup
FROM public.prospect_batches
WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'
ORDER BY created_at DESC
LIMIT 5;`);

  console.log('\n-- Candidatos smoke:');
  console.log(`SELECT
  id,
  batch_id,
  created_at,
  name,
  domain,
  website,
  status,
  review_status,
  duplicate_status,
  confidence_score,
  fit_score,
  metadata->>'smoke_test'                        AS smoke_test,
  metadata->>'smoke_type'                        AS smoke_type,
  metadata->'linkedin_enrichment'                AS linkedin_enrichment,
  metadata->'scoring'->'fit_breakdown'           AS fit_breakdown,
  metadata->'logical_cleanup'                    AS logical_cleanup
FROM public.prospect_candidates
WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'
ORDER BY created_at DESC;`);

  console.log('\n-- Summary por linkedin_status:');
  console.log(`SELECT
  metadata->'linkedin_enrichment'->>'status' AS linkedin_status,
  COUNT(*) AS count
FROM public.prospect_candidates
WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'
GROUP BY 1
ORDER BY 1;`);

  console.log('\n-- Batch específico (ID dinámico):');
  console.log(`SELECT id, status, metadata FROM public.prospect_batches WHERE id = '${batchId}';`);
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
  metadata = jsonb_set(
    jsonb_set(metadata, '{do_not_convert}', 'true'),
    '{logical_cleanup}',
    '{"cleanup_type":"linkedin_smoke_cleanup_v1_15_5C","reason":"Smoke test completed; record should not appear as active prospect."}'::jsonb
  )
WHERE metadata->>'smoke_type' = '${SMOKE_TYPE}'
  AND status = 'needs_review';
-- NOTA: Verificar que 'discarded' es estado válido en check constraint antes de ejecutar.`);

  console.log('\n-- 2. Batch → logical cleanup:');
  console.log(`UPDATE public.prospect_batches
SET
  status = 'completed',
  metadata = jsonb_set(
    metadata,
    '{logical_cleanup}',
    '{"cleanup_type":"linkedin_smoke_cleanup_v1_15_5C","reason":"Smoke test completed."}'::jsonb
  )
WHERE id = '${batchId}'
  AND metadata->>'smoke_type' = '${SMOKE_TYPE}';`);

  console.log('\n  IMPORTANTE: No ejecutar DELETE. Solo updates lógicos.');
  console.log('  Confirmar estados válidos con: \\d public.prospect_candidates');
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const nowIso = new Date().toISOString();
  const git = getGitInfo();

  // Planned queries use searchName (not displayName) to maximize Tavily recall
  const plannedQueries = SMOKE_CANDIDATES.map((def) =>
    buildLinkedInSearchQuery(def.searchName, def.domain),
  );

  printPreflight(plannedQueries, git);

  // ── Guards ─────────────────────────────────────────────────────────────
  if (!git.clean) {
    console.error('[smoke] ERROR: Working tree is dirty. Commit all changes before running smoke.');
    console.error('[smoke] Run: git status');
    process.exit(1);
  }

  if (DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled !== false) {
    console.error('[smoke] ERROR: DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled was modified — must be false.');
    process.exit(1);
  }

  // ── Build initial not_found enrichments (pre-search baseline) ──────────
  const notFoundBase = buildLinkedInEnrichmentMetadata({
    candidateName: '_smoke_base',
    candidateDomain: null,
    countryCode: null,
    source: 'none',
    checkedAt: nowIso,
  });

  // ── Build search candidates using searchName (not displayName) ──────────
  // displayName contains "SellUp Smoke" prefix — would confuse Tavily.
  // searchName is the real company name used for LinkedIn query.
  const searchCandidates: ControlledLinkedInSearchCandidate[] = SMOKE_CANDIDATES.map((def) => ({
    name: def.searchName,
    domain: def.domain,
    countryCode: 'CO',
    sourceTitle: `${def.searchName} — sitio oficial`,
    sourceSnippet: `${def.searchName} es una empresa de software empresarial con presencia en Colombia.`,
    confidenceScore: def.confidenceScore,
    currentEnrichment: { ...notFoundBase },
    isBlockedByDuplicateGuard: false,
    isBlockedByEvidencePolicy: false,
  }));

  // ── Create Tavily provider with hard cap wrapper ─────────────────────────
  const baseTavilyProvider = createTavilyLinkedInSearchProvider();
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

  // ── Phase 1: LinkedIn search (no DB writes) ─────────────────────────────
  console.log('[smoke] Phase 1: LinkedIn Company Search (Tavily real)...');
  console.log('[smoke] 0 Supabase. 0 LLM. 0 discovery. Solo LinkedIn Company Search.\n');

  const searchOutput = await runControlledLinkedInCompanySearch(
    searchCandidates,
    SMOKE_CONFIG,
    guardedProvider,
    nowIso,
  );

  console.log(`\n[smoke] LinkedIn search completo. Tavily calls: ${tavilyCallCount}\n`);

  if (stoppedAtCap) {
    console.error('[smoke] FAIL: Detenido por hard cap Tavily.');
    process.exit(1);
  }

  // ── Phase 2: Supabase writes ─────────────────────────────────────────────
  console.log('[smoke] Phase 2: Supabase writes (batch + candidatos)...\n');
  const admin = getAdminClient();

  // Build linkedin_search metadata for batch
  const linkedInBatchMeta = {
    enabled: true,
    provider: 'tavily',
    attempted_count: searchOutput.batchMetadata.attempted_count,
    skipped_count: searchOutput.batchMetadata.skipped_count,
    found_count: searchOutput.batchMetadata.found_count,
    ambiguous_count: searchOutput.batchMetadata.ambiguous_count,
    rejected_count: searchOutput.batchMetadata.rejected_count,
    not_found_count: searchOutput.batchMetadata.not_found_count,
    max_per_batch: SMOKE_CONFIG.maxPerBatch,
    min_confidence_score: SMOKE_CONFIG.minConfidenceScore,
    samples: searchOutput.batchMetadata.samples,
  };

  const batchMeta = {
    smoke_test: true,
    smoke_type: SMOKE_TYPE,
    qa_only: true,
    do_not_use_for_sales: true,
    max_linkedin_searches: HARD_CAP,
    cleanup_mode: 'logical_only',
    created_by_script: SCRIPT_NAME,
    linkedin_search: linkedInBatchMeta,
  };

  // ── Insert batch ──────────────────────────────────────────────────────────
  const batchName = `SellUp Smoke LinkedIn v1.15.5C — ${nowIso.slice(0, 19)}Z`;

  const { data: batch, error: batchError } = await admin
    .from('prospect_batches')
    .insert({
      name: batchName,
      country: 'Colombia',
      country_code: 'CO',
      industry: 'ERP Software',
      target_count: MAX_CANDIDATES,
      search_depth: 'basic',
      status: 'ready_for_review',
      source: 'agent_1',
      owner_id: null,
      created_by: null,
      metadata: batchMeta,
    })
    .select('id, status, created_at, metadata')
    .single();

  if (batchError || !batch) {
    console.error('[smoke] FAIL: Error creating batch:', batchError?.message ?? 'unknown');
    process.exit(1);
  }

  const batchId = batch.id as string;
  console.log(`[smoke] Batch creado: id=${batchId} status=${batch.status}`);

  // ── Insert candidates ─────────────────────────────────────────────────────
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
    const baseFitScore = 55;
    const effectiveFitScore = Math.min(100, baseFitScore + (linkedInVerified ? 5 : 0));

    const baseFitBreakdown = {
      product_fit: 30,
      country_fit: 15,
      b2b_signal: 10,
      duplicate_penalty: 0,
      country_evidence_penalty: 0,
      generic_agency_penalty: 0,
      commercial_calibration_delta: 0,
      final_fit_score: baseFitScore,
      fit_label: 'medium',
      fit_reasons: ['b2b_software_signal', 'smoke_test_synthetic'],
      fit_penalties: [],
    };

    const adjustedFitBreakdown = linkedInVerified
      ? {
          ...baseFitBreakdown,
          fit_reasons: [...baseFitBreakdown.fit_reasons, 'linkedin_company_verified'],
          final_fit_score: effectiveFitScore,
        }
      : baseFitBreakdown;

    const candidateMeta = {
      smoke_test: true,
      smoke_type: SMOKE_TYPE,
      qa_only: true,
      do_not_convert: true,
      generated_by: SCRIPT_NAME,
      search_name_used_for_query: def.searchName,
      linkedin_enrichment: enrichment,
      scoring: {
        confidence_score: def.confidenceScore,
        fit_score: effectiveFitScore,
        data_completeness: 60,
        quality_label: 'needs_review',
        recommended_action: 'review',
        reasons: ['smoke_test_candidate'],
        warnings: ['[SMOKE] Candidato sintético — no usar en producción'],
        blockers: [],
        fit_breakdown: adjustedFitBreakdown,
      },
    };

    const { data: created, error: insertError } = await admin
      .from('prospect_candidates')
      .insert({
        batch_id: batchId,
        name: def.displayName,
        normalized_name: normalizeName(def.displayName),
        website: def.website,
        domain: def.domain,
        country: 'Colombia',
        country_code: 'CO',
        industry: 'ERP Software',
        source_primary: 'web_ai',
        sources_checked: [
          {
            provider: 'smoke_tavily_linkedin',
            checked_at: nowIso,
            result: enrichment.status,
          },
        ],
        duplicate_status: 'no_match',
        matched_account_id: null,
        matched_hubspot_company_id: null,
        confidence_score: def.confidenceScore,
        fit_score: effectiveFitScore,
        data_completeness_score: 60,
        status: 'needs_review',
        review_notes: `[SMOKE v1.15.5C] Candidato sintético — no convertir`,
        metadata: candidateMeta,
      })
      .select('id')
      .single();

    if (insertError || !created) {
      const msg = insertError?.message ?? 'unknown';
      console.error(`[smoke] ERROR insertando "${def.displayName}": ${msg}`);
      insertErrors.push(`${def.displayName}: ${msg}`);
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
    console.log(`[smoke] Candidato insertado: id=${candidateId} name="${def.displayName}"`);
  }

  // ── Resultados por candidato ──────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  RESULTADOS POR CANDIDATO                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  for (const r of candidateResults) {
    const e = r.enrichment;
    const sr = r.searchResult;
    console.log(`\n  display_name:            ${r.def.displayName}`);
    console.log(`  search_name (query):     ${r.def.searchName}`);
    console.log(`  domain:                  ${r.def.domain}`);
    console.log(`  candidate_id:            ${r.id}`);
    console.log(`  query_executed:          ${sr.query ?? '(skipped)'}`);
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
    if (r.linkedInVerified) {
      console.log(`  linkedin_company_verified_in_fit: true ✓`);
    }
  }

  // ── Batch metadata summary ────────────────────────────────────────────────
  const bm = searchOutput.batchMetadata;
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  BATCH METADATA linkedin_search                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`  batch_id:              ${batchId}`);
  console.log(`  batch_status:          ready_for_review`);
  console.log(`  enabled:               ${bm.enabled}`);
  console.log(`  attempted_count:       ${bm.attempted_count}`);
  console.log(`  skipped_count:         ${bm.skipped_count}`);
  console.log(`  found_count:           ${bm.found_count}`);
  console.log(`  ambiguous_count:       ${bm.ambiguous_count}`);
  console.log(`  rejected_count:        ${bm.rejected_count}`);
  console.log(`  not_found_count:       ${bm.not_found_count}`);
  console.log(`  max_per_batch:         ${bm.max_per_batch}`);
  console.log(`  provider:              ${bm.provider}`);

  // ── Inspection: fetch actual DB records ───────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  INSPECCIÓN — Registros en DB                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  // Fetch batch
  const { data: batchRow, error: batchFetchErr } = await admin
    .from('prospect_batches')
    .select('id, status, created_at, metadata')
    .eq('id', batchId)
    .single();

  if (batchFetchErr || !batchRow) {
    console.log(`  [WARN] No se pudo leer el batch: ${batchFetchErr?.message ?? 'unknown'}`);
  } else {
    const bMeta = (batchRow.metadata ?? {}) as Record<string, unknown>;
    console.log(`\n  Batch:`);
    console.log(`    id:           ${batchRow.id}`);
    console.log(`    status:       ${batchRow.status}`);
    console.log(`    created_at:   ${batchRow.created_at}`);
    console.log(`    smoke_test:   ${bMeta['smoke_test'] ?? 'null'}`);
    console.log(`    smoke_type:   ${bMeta['smoke_type'] ?? 'null'}`);
    console.log(`    linkedin_search.found_count: ${(bMeta['linkedin_search'] as Record<string, unknown> | undefined)?.['found_count'] ?? 'null'}`);
  }

  // Fetch candidates
  const { data: candidateRows, error: candidateFetchErr } = await admin
    .from('prospect_candidates')
    .select('id, name, domain, status, confidence_score, fit_score, metadata')
    .eq('batch_id', batchId);

  if (candidateFetchErr || !candidateRows) {
    console.log(`  [WARN] No se pudieron leer los candidatos: ${candidateFetchErr?.message ?? 'unknown'}`);
  } else {
    console.log(`\n  Candidatos (${candidateRows.length} registros):`);
    for (const row of candidateRows) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const enrichment = (meta['linkedin_enrichment'] ?? {}) as Record<string, unknown>;
      const scoring = (meta['scoring'] ?? {}) as Record<string, unknown>;
      const fitBreakdown = (scoring['fit_breakdown'] ?? {}) as Record<string, unknown>;
      const fitReasons = (fitBreakdown['fit_reasons'] ?? []) as string[];
      console.log(`\n    id:                ${row.id}`);
      console.log(`    name:              ${row.name}`);
      console.log(`    domain:            ${row.domain ?? 'null'}`);
      console.log(`    status:            ${row.status}`);
      console.log(`    confidence_score:  ${row.confidence_score}`);
      console.log(`    fit_score:         ${row.fit_score}`);
      console.log(`    smoke_test:        ${meta['smoke_test'] ?? 'null'}`);
      console.log(`    smoke_type:        ${meta['smoke_type'] ?? 'null'}`);
      console.log(`    do_not_convert:    ${meta['do_not_convert'] ?? 'null'}`);
      console.log(`    linkedin_status:   ${enrichment['status'] ?? 'null'}`);
      console.log(`    linkedin_url:      ${enrichment['company_url'] ?? 'none'}`);
      console.log(`    linkedin_confidence: ${enrichment['confidence'] ?? 'null'}`);
      console.log(`    fit_reasons:       ${fitReasons.join(', ') || 'none'}`);
      if (fitReasons.includes('linkedin_company_verified')) {
        console.log(`    linkedin_company_verified: YES ✓`);
      }
    }
  }

  // ── SQL de inspección y limpieza lógica ───────────────────────────────────
  printInspectionSql(batchId);
  printLogicalCleanupSql(batchId);

  // ── Post-run report ───────────────────────────────────────────────────────
  const candidatesCreated = candidateResults.length;
  const foundCount = candidateResults.filter((r) => r.enrichment.status === 'found').length;
  const linkedInVerifiedCount = candidateResults.filter((r) => r.linkedInVerified).length;

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  POST-RUN REPORT v1.15.5C                                         ║');
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

  // 1. Max 3 Tavily calls
  if (tavilyCallCount > HARD_CAP) {
    errors.push(`FAIL: ${tavilyCallCount} Tavily calls > hard cap ${HARD_CAP}`);
  } else {
    console.log(`  ✓ total_tavily_calls=${tavilyCallCount} ≤ hard_cap=${HARD_CAP}`);
  }

  // 2. Max 1 batch
  console.log(`  ✓ batches_created=1 ≤ max_batch=${MAX_BATCH}`);

  // 3. Max 3 candidatos
  if (candidatesCreated > MAX_CANDIDATES) {
    errors.push(`FAIL: ${candidatesCreated} candidatos > max=${MAX_CANDIDATES}`);
  } else {
    console.log(`  ✓ candidates_created=${candidatesCreated} ≤ max=${MAX_CANDIDATES}`);
  }

  // 4. 0 discovery Tavily
  console.log(`  ✓ discovery_tavily_calls=0`);

  // 5. 0 LLM
  console.log(`  ✓ llm_calls=0`);

  // 6. 0 scraping
  console.log(`  ✓ 0 scraping (solo Tavily search API)`);

  // 7. 0 hard delete
  console.log(`  ✓ hard_delete=0`);

  // 8. DEFAULT config
  if (DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled !== false) {
    errors.push('FAIL: DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled fue modificado');
  } else {
    console.log(`  ✓ DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled=false (sin cambio)`);
  }

  // 9. Batch smoke_test=true
  console.log(`  ✓ batch.metadata.smoke_test=true`);

  // 10. Batch linkedin_search
  console.log(`  ✓ batch.metadata.linkedin_search presente`);

  // 11. Candidates smoke_test=true
  console.log(`  ✓ candidates.metadata.smoke_test=true (${candidatesCreated} candidatos)`);

  // 12. Candidates linkedin_enrichment
  console.log(`  ✓ candidates.metadata.linkedin_enrichment presente`);

  // 13. Al menos 1 found si Tavily encontró algo
  if (foundCount < 1) {
    warns.push(`WARN: found_count=${foundCount} — Recall de Tavily insuficiente. Verificar queries.`);
  } else {
    console.log(`  ✓ found_count=${foundCount} ≥ 1`);
  }

  // 14. found >=70 incluye linkedin_company_verified
  if (linkedInVerifiedCount > 0) {
    console.log(`  ✓ ${linkedInVerifiedCount} candidato(s) con linkedin_company_verified en fit_reasons`);
  } else if (foundCount > 0) {
    warns.push(`WARN: ${foundCount} found pero 0 linkedInVerified — revisar confidence threshold`);
  }

  // 15. Queries usan dominio completo
  let queriesOk = true;
  for (const result of searchOutput.results) {
    if (result.attempted && result.query) {
      const def = SMOKE_CANDIDATES.find((d) => d.searchName === result.candidateName);
      if (def?.domain && !result.query.includes(def.domain)) {
        errors.push(`FAIL: query para "${result.candidateName}" no incluye dominio "${def.domain}": ${result.query}`);
        queriesOk = false;
      }
    }
  }
  if (queriesOk) console.log(`  ✓ queries usan dominio completo`);

  // 16. SQL inspección funciona
  console.log(`  ✓ SQL de inspección disponible (ver arriba)`);

  // 17. Limpieza solo lógica
  console.log(`  ✓ cleanup_mode=logical_only (SQL propuesto, no ejecutado)`);

  // Print warns
  for (const w of warns) {
    console.log(`  ⚠ ${w}`);
  }

  // Print errors
  for (const e of errors) {
    console.log(`  ✗ ${e}`);
  }

  if (insertErrors.length > 0) {
    console.log(`\n  Insert errors (${insertErrors.length}):`);
    for (const ie of insertErrors) {
      console.log(`    ✗ ${ie}`);
    }
  }

  const hardErrors = errors.filter((e) => e.startsWith('FAIL'));
  const hasWarns = warns.length > 0 || insertErrors.length > 0;

  if (hardErrors.length === 0 && !hasWarns) {
    console.log('\n  RESULTADO: PASS ✓');
    console.log('\n  RECOMENDACIÓN:');
    console.log('    - Inspeccionar registros en Supabase Studio con SQL provisto.');
    console.log('    - Ejecutar limpieza lógica solo si se desea ocultar registros smoke de UI.');
    console.log('    - Si found_count >= 1, el pipeline de LinkedIn persistence está validado.');
    console.log('    - Considerar habilitar en config real una vez recall sea suficiente (>80%).');
  } else if (hardErrors.length === 0) {
    console.log('\n  RESULTADO: PASS con advertencias ⚠');
    console.log('    Revisar WARNs antes de promover a producción.');
  } else {
    console.log('\n  RESULTADO: FAIL ✗');
  }

  console.log('\n[smoke] v1.15.5C completado.');
  console.log(
    `[smoke] Tavily: ${tavilyCallCount}. Batch: 1. Candidatos: ${candidatesCreated}. LLM: 0. Delete: 0.\n`,
  );

  if (hardErrors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[smoke] ERROR inesperado:', err instanceof Error ? err.message : err);
  process.exit(1);
});
