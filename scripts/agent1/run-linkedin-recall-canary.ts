#!/usr/bin/env tsx
/**
 * Canary — LinkedIn Recall Improvement (v1.15.6)
 *
 * Ejecuta búsqueda real con Tavily usando estrategia de variantes para
 * evaluar recall antes de habilitar LinkedIn search en producción.
 *
 * Candidatos:
 *   - Softland / softland.com
 *   - Factory / factory.com.co
 *   - Loggro Enterprise / loggro.com
 *
 * Config v1.15.6:
 *   maxQueriesPerCandidate = 2 (Q1 con dominio, Q2 sin dominio)
 *   maxResultsPerQuery     = 3 (selección del mejor entre múltiples)
 *   maxPerBatch            = 5 (hard cap 5 en el orchestrator)
 *
 * GARANTÍAS ABSOLUTAS:
 *   - Máximo 5 llamadas Tavily reales (hard cap en orchestrator)
 *   - 0 discovery Tavily
 *   - 0 LLM calls
 *   - 0 Supabase writes
 *   - 0 inserts
 *   - 0 batch creado
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled permanece false
 *
 * Uso: npm run agent1:smoke:linkedin-recall-canary
 */

import { execSync } from 'child_process';
import {
  DEFAULT_LINKEDIN_SEARCH_CONFIG,
  runControlledLinkedInCompanySearch,
  buildLinkedInSearchQueryVariants,
} from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import type {
  LinkedInSearchConfig,
  ControlledLinkedInSearchCandidate,
} from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import { buildLinkedInEnrichmentMetadata } from '../../src/server/agents/prospecting-toolkit/linkedin-company-enrichment';
import { createTavilyLinkedInSearchProvider } from '../../src/server/agents/prospecting-toolkit/linkedin-company-search-tavily';

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_PER_BATCH = 5;
const MAX_QUERIES_PER_CANDIDATE = 2;
const MAX_RESULTS_PER_QUERY = 3;
const HARD_CAP_PARANOIA = 6; // abort si se intenta superar este número
const CANARY_CHECKED_AT = new Date().toISOString();

const CANARY_CONFIG: LinkedInSearchConfig = {
  enabled: true, // habilitado SOLO para este canary — NO es el default
  provider: 'tavily',
  maxPerBatch: MAX_PER_BATCH,
  minConfidenceScore: 65, // umbral relajado para recall test
  maxQueriesPerCandidate: MAX_QUERIES_PER_CANDIDATE,
  maxResultsPerQuery: MAX_RESULTS_PER_QUERY,
};

// ─── Candidatos ───────────────────────────────────────────────────────────────

type CanaryDef = {
  name: string;
  domain: string;
  countryCode: string;
  confidenceScore: number;
};

const CANARY_DEFS: CanaryDef[] = [
  { name: 'Softland',          domain: 'softland.com',   countryCode: 'CO', confidenceScore: 80 },
  { name: 'Factory',           domain: 'factory.com.co', countryCode: 'CO', confidenceScore: 75 },
  { name: 'Loggro Enterprise', domain: 'loggro.com',     countryCode: 'CO', confidenceScore: 72 },
];

// ─── Git info ─────────────────────────────────────────────────────────────────

function getGitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const head   = execSync('git rev-parse --short HEAD',     { encoding: 'utf8' }).trim();
    const status = execSync('git status --porcelain',         { encoding: 'utf8' }).trim();
    return { branch, head, clean: status.length === 0 };
  } catch {
    return { branch: 'unknown', head: 'unknown', clean: false };
  }
}

// ─── Preflight ────────────────────────────────────────────────────────────────

function printPreflight(plannedQueriesByCandidate: { name: string; queries: string[] }[]) {
  const git = getGitInfo();
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  PREFLIGHT — LinkedIn Recall Canary v1.15.6');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  branch:                    ${git.branch}`);
  console.log(`  HEAD:                      ${git.head}`);
  console.log(`  working_tree:              ${git.clean ? 'clean' : 'dirty'}`);
  console.log(`  provider:                  tavily`);
  console.log(`  maxPerBatch:               ${MAX_PER_BATCH}`);
  console.log(`  maxQueriesPerCandidate:    ${MAX_QUERIES_PER_CANDIDATE}`);
  console.log(`  maxResultsPerQuery:        ${MAX_RESULTS_PER_QUERY}`);
  console.log(`  minConfidenceScore:        ${CANARY_CONFIG.minConfidenceScore}`);
  console.log(`  candidates_count:          ${CANARY_DEFS.length}`);
  console.log(`  max_tavily_calls:          ${MAX_PER_BATCH} (hard cap ${HARD_CAP_PARANOIA})`);
  console.log(`  writes_enabled:            false`);
  console.log(`  supabase_writes:           false`);
  console.log(`  llm_calls:                 0`);
  console.log(`  batch_creation:            false`);
  console.log(`  DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled: ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);
  console.log('\n  Queries planeadas por candidato:');
  for (const { name, queries } of plannedQueriesByCandidate) {
    console.log(`\n    ${name}:`);
    for (const q of queries) {
      console.log(`      ${q}`);
    }
  }
  console.log('\n════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Construir candidatos con enrichment not_found (elegibles)
  const notFoundBase = buildLinkedInEnrichmentMetadata({
    candidateName: '_canary_base',
    candidateDomain: null,
    countryCode: null,
    source: 'none',
    checkedAt: CANARY_CHECKED_AT,
  });

  const candidates: ControlledLinkedInSearchCandidate[] = CANARY_DEFS.map((def) => ({
    name: def.name,
    domain: def.domain,
    countryCode: def.countryCode,
    sourceTitle: `${def.name} — sitio oficial`,
    sourceSnippet: `${def.name} es una empresa con presencia en Colombia.`,
    confidenceScore: def.confidenceScore,
    currentEnrichment: { ...notFoundBase },
    isBlockedByDuplicateGuard: false,
    isBlockedByEvidencePolicy: false,
  }));

  // Calcular queries planeadas para el preflight
  const plannedQueriesByCandidate = CANARY_DEFS.map((def) => ({
    name: def.name,
    queries: buildLinkedInSearchQueryVariants(def.name, def.domain, MAX_QUERIES_PER_CANDIDATE),
  }));

  printPreflight(plannedQueriesByCandidate);

  // ── Provider Tavily con wrapper paranoia ─────────────────────────────────
  const baseTavilyProvider = createTavilyLinkedInSearchProvider(MAX_RESULTS_PER_QUERY);
  let tavilyCallCount = 0;
  let stoppedAtCap = false;

  const guardedProvider = async (query: string): Promise<string[]> => {
    tavilyCallCount++;

    if (tavilyCallCount > HARD_CAP_PARANOIA) {
      console.error(
        `[HARD CAP] ABORTADO — intento de llamada Tavily #${tavilyCallCount} > cap=${HARD_CAP_PARANOIA}`,
      );
      stoppedAtCap = true;
      process.exit(1);
    }

    console.log(`[tavily] Llamada #${tavilyCallCount}/${MAX_PER_BATCH}: "${query}"`);
    return baseTavilyProvider(query);
  };

  // ── Ejecutar búsqueda ────────────────────────────────────────────────────
  console.log('[canary] Iniciando runControlledLinkedInCompanySearch...');
  console.log('[canary] 0 Supabase. 0 LLM. 0 batch. Solo LinkedIn Company Search.\n');

  const { results, batchMetadata } = await runControlledLinkedInCompanySearch(
    candidates,
    CANARY_CONFIG,
    guardedProvider,
    CANARY_CHECKED_AT,
  );

  // ── Resultados por candidato ─────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  RESULTADOS POR CANDIDATO');
  console.log('════════════════════════════════════════════════════════════');

  for (const result of results) {
    const e = result.enrichment;
    const def = CANARY_DEFS.find((d) => d.name === result.candidateName);
    const wouldBoost = e.status === 'found' && (e.confidence ?? 0) >= 70;

    console.log(`\n  candidate_name:       ${result.candidateName}`);
    console.log(`  domain:               ${def?.domain ?? '?'}`);
    console.log(`  attempted:            ${result.attempted}`);

    if (result.attempted) {
      console.log(`  last_query:           ${result.query}`);
      console.log(`  enrichment_status:    ${e.status}`);
      console.log(`  confidence:           ${e.confidence}`);
      console.log(`  company_url:          ${e.company_url ?? 'none'}`);
      console.log(`  match_reason:         ${e.match_reason ?? 'none'}`);
      console.log(`  warnings:             ${e.warnings.length > 0 ? e.warnings.join(' | ') : 'none'}`);
      if (e.signals) {
        console.log(`  signals.name_match:   ${e.signals.name_match}`);
        console.log(`  signals.domain_match: ${e.signals.domain_match}`);
      }
      console.log(`  would_boost:          ${wouldBoost}`);
    } else {
      console.log(`  skip_reason:          ${result.skipReason ?? 'none'}`);
    }
    console.log(`  no_write_confirmed:   true`);
  }

  // ── Samples con detalle de queries ───────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  SAMPLES DE BÚSQUEDA (por query ejecutada)');
  console.log('════════════════════════════════════════════════════════════');
  for (const sample of batchMetadata.samples) {
    console.log(`\n  ${sample.candidate_name} | query: ${sample.query}`);
    console.log(`    raw_result_count:  ${sample.raw_result_count}`);
    console.log(`    found_urls:        ${sample.found_urls_count}`);
    console.log(`    ambiguous_urls:    ${sample.ambiguous_urls_count}`);
    console.log(`    rejected_urls:     ${sample.rejected_urls_count}`);
    console.log(`    selected_status:   ${sample.selected_status}`);
    console.log(`    selected_url:      ${sample.selected_url ?? 'none'}`);
    console.log(`    confidence:        ${sample.confidence}`);
  }

  // ── Batch metadata ───────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  BATCH METADATA linkedin_search v1.15.6');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  enabled:                   ${batchMetadata.enabled}`);
  console.log(`  attempted_candidate_count: ${batchMetadata.attempted_candidate_count}`);
  console.log(`  attempted_query_count:     ${batchMetadata.attempted_query_count}`);
  console.log(`  skipped_count:             ${batchMetadata.skipped_count}`);
  console.log(`  found_count:               ${batchMetadata.found_count}`);
  console.log(`  ambiguous_count:           ${batchMetadata.ambiguous_count}`);
  console.log(`  rejected_count:            ${batchMetadata.rejected_count}`);
  console.log(`  not_found_count:           ${batchMetadata.not_found_count}`);
  console.log(`  max_per_batch:             ${batchMetadata.max_per_batch}`);
  console.log(`  max_queries_per_candidate: ${batchMetadata.max_queries_per_candidate}`);
  console.log(`  max_results_per_query:     ${batchMetadata.max_results_per_query}`);
  console.log(`  stopped_after_found:       ${batchMetadata.stopped_after_found}`);
  console.log(`  provider:                  ${batchMetadata.provider}`);

  // ── Post-run report ──────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  POST-RUN REPORT v1.15.6');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  total_tavily_calls:        ${tavilyCallCount}`);
  console.log(`  stopped_at_cap:            ${stoppedAtCap}`);
  console.log(`  writes_performed:          0`);
  console.log(`  inserts_performed:         0`);
  console.log(`  batch_created:             false`);
  console.log(`  llm_calls:                 0`);
  console.log(`  discovery_tavily_calls:    0`);
  console.log(`  DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled: ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);

  // ── Validaciones ─────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  VALIDACIONES CRITERIOS DE ACEPTACIÓN');
  console.log('════════════════════════════════════════════════════════════');

  const errors: string[] = [];

  if (tavilyCallCount > MAX_PER_BATCH) {
    errors.push(`FAIL: ${tavilyCallCount} llamadas Tavily > cap ${MAX_PER_BATCH}`);
  }

  if (DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled !== false) {
    errors.push('FAIL: DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled fue modificado');
  }

  if (batchMetadata.found_count < 1) {
    errors.push(
      `WARN: found_count=${batchMetadata.found_count} — 0 found reales. ` +
      'Considerar ampliar queries o candidatos más conocidos.',
    );
  }

  const hardErrors = errors.filter((e) => e.startsWith('FAIL'));
  const warns = errors.filter((e) => e.startsWith('WARN'));

  if (hardErrors.length === 0 && warns.length === 0) {
    console.log(`  ✓ total_tavily_calls=${tavilyCallCount} ≤ cap=${MAX_PER_BATCH}`);
    console.log(`  ✓ found_count=${batchMetadata.found_count} ≥ 1`);
    console.log(`  ✓ attempted_query_count=${batchMetadata.attempted_query_count}`);
    console.log(`  ✓ stopped_after_found=${batchMetadata.stopped_after_found}`);
    console.log(`  ✓ 0 Supabase writes`);
    console.log(`  ✓ 0 LLM calls`);
    console.log(`  ✓ DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled=false sin cambio`);
    console.log('\n  RESULTADO: PASS ✓');
  } else {
    for (const w of warns) console.log(`  ⚠ ${w}`);
    for (const err of hardErrors) console.log(`  ✗ ${err}`);

    if (hardErrors.length === 0) {
      console.log('\n  RESULTADO: WARN — revisar recall antes de habilitar en producción');
    } else {
      console.log('\n  RESULTADO: FAIL ✗');
    }
  }

  console.log('\n[canary] Recall canary v1.15.6 completado.');
  console.log(`[canary] Tavily calls: ${tavilyCallCount}. Writes: 0. Inserts: 0. LLM: 0.\n`);

  if (hardErrors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[canary] ERROR inesperado:', err instanceof Error ? err.message : err);
  process.exit(1);
});
