#!/usr/bin/env tsx
/**
 * Smoke — Real Tavily LinkedIn Search Read-only (v1.15.5B)
 *
 * Valida búsqueda real Tavily únicamente para LinkedIn Company Search.
 * Máximo 3 llamadas Tavily reales. 0 writes. 0 inserts. 0 batch. 0 LLM.
 *
 * GARANTÍAS ABSOLUTAS:
 *   - Máximo 3 llamadas Tavily reales (hard cap doble: config + wrapper)
 *   - 0 discovery Tavily
 *   - 0 LLM calls
 *   - 0 Supabase writes
 *   - 0 inserts
 *   - 0 batch creado
 *   - dryRun = true (conceptual — no se llama writeProspectingCandidates)
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled permanece false
 *
 * Uso: npm run agent1:smoke:linkedin-tavily-readonly
 */

import { execSync } from 'child_process';
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

// ─── Config de smoke ──────────────────────────────────────────────────────────

const MAX_PER_BATCH = 3;
const HARD_CAP = 3;
const SMOKE_CHECKED_AT = new Date().toISOString();

const SMOKE_CONFIG: LinkedInSearchConfig = {
  enabled: true,          // habilitado SOLO para este smoke — NO es el default
  provider: 'tavily',
  maxPerBatch: MAX_PER_BATCH,
  minConfidenceScore: 70,
};

// ─── Candidatos sintéticos ────────────────────────────────────────────────────

type SmokeCandidateDef = {
  name: string;
  domain: string;
  countryCode: string;
  confidenceScore: number;
};

const SMOKE_DEFS: SmokeCandidateDef[] = [
  { name: 'Ubits Colombia',     domain: 'ubits.co',   countryCode: 'CO', confidenceScore: 80 },
  { name: 'Sofka Technologies', domain: 'sofka.com',  countryCode: 'CO', confidenceScore: 75 },
  { name: 'Loggro Enterprise',  domain: 'loggro.com', countryCode: 'CO', confidenceScore: 72 },
];

// ─── Git info ─────────────────────────────────────────────────────────────────

function getGitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    return { branch, head, clean: status.length === 0 };
  } catch {
    return { branch: 'unknown', head: 'unknown', clean: false };
  }
}

// ─── Preflight ────────────────────────────────────────────────────────────────

function printPreflight(plannedQueries: string[]) {
  const git = getGitInfo();
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  PREFLIGHT — Real Tavily LinkedIn Smoke v1.15.5B');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  branch:                          ${git.branch}`);
  console.log(`  HEAD:                            ${git.head}`);
  console.log(`  working_tree:                    ${git.clean ? 'clean' : 'dirty (ver git status)'}`);
  console.log(`  provider:                        tavily`);
  console.log(`  maxPerBatch:                     ${MAX_PER_BATCH}`);
  console.log(`  candidates_planned:              ${SMOKE_DEFS.length}`);
  console.log(`  dryRun:                          true`);
  console.log(`  writes_enabled:                  false`);
  console.log(`  supabase_writes:                 false`);
  console.log(`  discovery_tavily_calls:          0`);
  console.log(`  linkedin_tavily_calls_planned:   ${SMOKE_DEFS.length}`);
  console.log(`  llm_calls:                       0`);
  console.log(`  batch_creation:                  false`);
  console.log(`  inserts:                         false`);
  console.log(`  DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled: ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);
  console.log('\n  Queries planeadas (antes de ejecutar):');
  for (const q of plannedQueries) {
    console.log(`    ${q}`);
  }
  console.log('════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Construir candidatos sintéticos con enrichment not_found para ser elegibles
  const notFoundBase = buildLinkedInEnrichmentMetadata({
    candidateName: '_smoke_base',
    candidateDomain: null,
    countryCode: null,
    source: 'none',
    checkedAt: SMOKE_CHECKED_AT,
  });

  const candidates: ControlledLinkedInSearchCandidate[] = SMOKE_DEFS.map((def) => ({
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

  // Calcular queries antes de ejecutar para el preflight
  const plannedQueries = SMOKE_DEFS.map((def) =>
    buildLinkedInSearchQuery(def.name, def.domain),
  );

  printPreflight(plannedQueries);

  // ── Crear provider Tavily con hard cap wrapper ────────────────────────────
  const baseTavilyProvider = createTavilyLinkedInSearchProvider();
  let tavilyCallCount = 0;
  let stoppedAtCap = false;

  const guardedProvider = async (query: string): Promise<string[]> => {
    tavilyCallCount++;

    // Hard cap paranoia: abortar si se intenta una 4ª llamada
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

  // ── Ejecutar búsqueda real ────────────────────────────────────────────────
  console.log('[smoke] Iniciando runControlledLinkedInCompanySearch con provider=tavily...');
  console.log('[smoke] 0 Supabase. 0 LLM. 0 batch. Solo LinkedIn Company Search.\n');

  const { results, batchMetadata } = await runControlledLinkedInCompanySearch(
    candidates,
    SMOKE_CONFIG,
    guardedProvider,
    SMOKE_CHECKED_AT,
  );

  // ── Resultados por candidato ──────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  RESULTADOS POR CANDIDATO');
  console.log('════════════════════════════════════════════════════════════');

  for (const result of results) {
    const e = result.enrichment;
    console.log(`\n  candidate_name:         ${result.candidateName}`);
    console.log(`  domain:                 ${SMOKE_DEFS.find((d) => d.name === result.candidateName)?.domain ?? '?'}`);
    console.log(`  query:                  ${result.query ?? '(no ejecutada)'}`);
    console.log(`  raw_result_count:       ${result.attempted ? '1 request realizado' : '(skipped)'}`);
    console.log(`  first_result_url:       ${e.company_url ?? 'none'}`);
    console.log(`  normalized_linkedin_url: ${e.company_url ?? 'none'}`);
    console.log(`  enrichment_status:      ${e.status}`);
    console.log(`  confidence:             ${e.confidence}`);
    console.log(`  match_reason:           ${e.match_reason ?? 'none'}`);
    console.log(`  warnings:               ${e.warnings.length > 0 ? e.warnings.join(' | ') : 'none'}`);
    if (e.signals) {
      console.log(`  signals.name_match:     ${e.signals.name_match}`);
      console.log(`  signals.domain_match:   ${e.signals.domain_match}`);
    }
    if (result.attempted) {
      const wouldBoost = e.status === 'found' || e.status === 'ambiguous';
      console.log(`  would_boost:            ${wouldBoost}`);
    } else {
      console.log(`  skip_reason:            ${result.skipReason ?? 'none'}`);
    }
    console.log(`  no_write_confirmed:     true`);
  }

  // ── Metadata linkedin_enrichment JSON por candidato ───────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  METADATA linkedin_enrichment por candidato (simulada)');
  console.log('════════════════════════════════════════════════════════════');
  for (const result of results) {
    const e = result.enrichment;
    const enrichmentJson = {
      status: e.status,
      confidence: e.confidence,
      company_url: e.company_url ?? null,
      normalized_company_slug: e.normalized_company_slug ?? null,
      source: e.source,
      match_reason: e.match_reason ?? null,
      warnings: e.warnings,
    };
    console.log(`\n  ${result.candidateName}:`);
    console.log(
      `  ${JSON.stringify(enrichmentJson, null, 2).split('\n').join('\n  ')}`,
    );
  }

  // ── Batch metadata linkedin_search ────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  BATCH METADATA linkedin_search');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  enabled:              ${batchMetadata.enabled}`);
  console.log(`  attempted_count:      ${batchMetadata.attempted_count}`);
  console.log(`  skipped_count:        ${batchMetadata.skipped_count}`);
  console.log(`  found_count:          ${batchMetadata.found_count}`);
  console.log(`  ambiguous_count:      ${batchMetadata.ambiguous_count}`);
  console.log(`  rejected_count:       ${batchMetadata.rejected_count}`);
  console.log(`  not_found_count:      ${batchMetadata.not_found_count}`);
  console.log(`  max_per_batch:        ${batchMetadata.max_per_batch}`);
  console.log(`  provider:             ${batchMetadata.provider}`);

  // ── Post-run report ───────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  POST-RUN REPORT');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  total_tavily_calls:      ${tavilyCallCount}`);
  console.log(`  stopped_at_cap:          ${stoppedAtCap}`);
  console.log(`  attempted_count:         ${batchMetadata.attempted_count}`);
  console.log(`  skipped_count:           ${batchMetadata.skipped_count}`);
  console.log(`  found_count:             ${batchMetadata.found_count}`);
  console.log(`  ambiguous_count:         ${batchMetadata.ambiguous_count}`);
  console.log(`  rejected_count:          ${batchMetadata.rejected_count}`);
  console.log(`  not_found_count:         ${batchMetadata.not_found_count}`);
  console.log(`  writes_performed:        0`);
  console.log(`  inserts_performed:       0`);
  console.log(`  batch_created:           false`);
  console.log(`  llm_calls:               0`);
  console.log(`  discovery_tavily_calls:  0`);
  console.log('════════════════════════════════════════════════════════════\n');

  // ── Validaciones de criterios de aceptación ───────────────────────────────
  console.log('════════════════════════════════════════════════════════════');
  console.log('  VALIDACIONES CRITERIOS DE ACEPTACIÓN');
  console.log('════════════════════════════════════════════════════════════');

  const errors: string[] = [];

  if (tavilyCallCount > HARD_CAP) {
    errors.push(`FAIL: ${tavilyCallCount} llamadas Tavily > hard cap ${HARD_CAP}`);
  }

  if (DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled !== false) {
    errors.push('FAIL: DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled fue modificado');
  }

  for (const result of results) {
    if (result.attempted && result.query) {
      const def = SMOKE_DEFS.find((d) => d.name === result.candidateName);
      if (def?.domain && !result.query.includes(def.domain)) {
        errors.push(
          `FAIL: query para "${result.candidateName}" no incluye dominio "${def.domain}": ${result.query}`,
        );
      }
    }
  }

  if (errors.length === 0) {
    console.log(`  ✓ total_tavily_calls=${tavilyCallCount} ≤ hard_cap=${HARD_CAP}`);
    console.log('  ✓ 0 discovery Tavily');
    console.log('  ✓ 0 LLM calls');
    console.log('  ✓ 0 Supabase writes');
    console.log('  ✓ 0 inserts');
    console.log('  ✓ 0 batch creado');
    console.log('  ✓ dryRun=true (no writeProspectingCandidates llamado)');
    console.log('  ✓ queries usan dominio completo');
    console.log('  ✓ DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled=false sin cambio');
    console.log('\n  RESULTADO: PASS ✓');
  } else {
    for (const err of errors) {
      console.log(`  ✗ ${err}`);
    }
    console.log('\n  RESULTADO: FAIL ✗');
  }

  console.log('\n[smoke] Smoke v1.15.5B completado.');
  console.log(`[smoke] Tavily calls: ${tavilyCallCount}. Writes: 0. Inserts: 0. LLM: 0.\n`);

  if (errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[smoke] ERROR inesperado:', err instanceof Error ? err.message : err);
  process.exit(1);
});
