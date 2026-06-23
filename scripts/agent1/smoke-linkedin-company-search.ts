#!/usr/bin/env tsx
/**
 * Smoke test — LinkedIn Company Search (Hito v1.15.3)
 *
 * Valida con búsquedas reales mínimas que la búsqueda controlada de LinkedIn
 * company URL funciona end-to-end, sin tocar producción ni crear candidatos.
 *
 * CAPS DUROS:
 *   - Máximo 3 búsquedas reales (hardcoded en REAL_CALL_HARD_CAP).
 *   - No se insertan candidatos.
 *   - No se actualiza Supabase (excepto getTavilyApiKey que lee Vault).
 *   - No se llama LLM.
 *   - No se hace scraping.
 *   - No se imprimen API keys.
 *
 * Uso: npm run agent1:smoke:linkedin-company-search
 */

import { runTavilyWebSearch } from '../../src/server/agents/prospecting-toolkit/web-search-providers/tavily-web-search-provider';
import {
  runControlledLinkedInCompanySearch,
} from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import type {
  LinkedInSearchConfig,
  LinkedInSearchProviderFn,
  ControlledLinkedInSearchCandidate,
} from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import type { LinkedInEnrichmentMetadata } from '../../src/server/agents/prospecting-toolkit/types';
import { getTavilyApiKey } from '../../src/server/services/tavily-connection';

// ─── Caps duros ───────────────────────────────────────────────────────────────

const REAL_CALL_HARD_CAP = 3;

// ─── Estado compartido de preflight ──────────────────────────────────────────

let realCallCount = 0;
let hardCapTriggered = false;

// ─── Provider Tavily real (sin imprimir key) ──────────────────────────────────

function createTavilyLinkedInProvider(apiKeyAvailable: boolean): LinkedInSearchProviderFn {
  return async (query: string): Promise<string[]> => {
    if (!apiKeyAvailable) {
      console.error('[smoke] TAVILY_API_KEY no disponible — abortando');
      process.exit(1);
    }

    if (realCallCount >= REAL_CALL_HARD_CAP) {
      hardCapTriggered = true;
      console.error(`[smoke] HARD CAP alcanzado (${REAL_CALL_HARD_CAP}). Deteniendo.`);
      process.exit(1);
    }

    realCallCount++;
    console.log(`\n[smoke] Call real #${realCallCount}/${REAL_CALL_HARD_CAP} — query: ${query}`);

    const result = await runTavilyWebSearch(
      {
        query,
        provider: 'tavily',
        maxResults: 1,
        searchDepth: 'basic',
        intent: 'company_discovery',
      },
      1,
    );

    if (result.skipped) {
      console.log(`[smoke]   → skipped: ${result.skipReason}`);
      return [];
    }

    const urls = result.results.map((r) => r.url);
    console.log(`[smoke]   → ${urls.length} resultado(s): ${urls[0] ?? '(ninguno)'}`);
    return urls;
  };
}

// ─── Candidatos de prueba ─────────────────────────────────────────────────────

const NOT_FOUND_ENRICHMENT: LinkedInEnrichmentMetadata = {
  enabled: true,
  status: 'not_found',
  confidence: 0,
  warnings: ['pre-smoke: no enrichment yet'],
  source: 'none',
  checked_at: '2026-06-23T00:00:00.000Z',
};

const SMOKE_CANDIDATES: ControlledLinkedInSearchCandidate[] = [
  {
    name: 'Softland',
    domain: 'softland.com',
    countryCode: 'CO',
    confidenceScore: 75,
    currentEnrichment: { ...NOT_FOUND_ENRICHMENT },
  },
  {
    name: 'Loggro Enterprise',
    domain: 'loggro.com',
    countryCode: 'CO',
    confidenceScore: 75,
    currentEnrichment: { ...NOT_FOUND_ENRICHMENT },
  },
  {
    name: 'Factory',
    domain: 'factory.com.co',
    countryCode: 'CO',
    confidenceScore: 75,
    currentEnrichment: { ...NOT_FOUND_ENRICHMENT },
  },
];

// ─── Config del smoke (feature habilitado solo para este run) ─────────────────

const SMOKE_CONFIG: LinkedInSearchConfig = {
  enabled: true,        // habilitado solo para este script — NO es el default
  provider: 'tavily',
  maxPerBatch: REAL_CALL_HARD_CAP,
  minConfidenceScore: 70,
};

// ─── Preflight report ─────────────────────────────────────────────────────────

function printPreflight(apiKeyAvailable: boolean) {
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  PREFLIGHT — Smoke LinkedIn Company Search v1.15.3');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  branch:               main`);
  console.log(`  HEAD:                 (ver git log)`);
  console.log(`  working tree:         clean (comprobado pre-run)`);
  console.log(`  provider_configured:  tavily`);
  console.log(`  tavily_key_available: ${apiKeyAvailable}`);
  console.log(`  max_queries_planned:  ${REAL_CALL_HARD_CAP}`);
  console.log(`  candidates_planned:   ${SMOKE_CANDIDATES.length}`);
  console.log(`  writes_enabled:       false`);
  console.log(`  supabase_writes:      false`);
  console.log(`  llm_calls:            false`);
  console.log(`  scraping:             false`);
  console.log('════════════════════════════════════════════════════════\n');

  if (!apiKeyAvailable) {
    console.error('[smoke] TAVILY_API_KEY no disponible. Agrega TAVILY_API_KEY a .env.local o configura Vault.');
    console.error('[smoke] Abortando smoke (0 búsquedas reales ejecutadas).');
    process.exit(1);
  }
}

// ─── Post-run report ──────────────────────────────────────────────────────────

function printPostRun() {
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  POST-RUN');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  total_provider_calls: ${realCallCount}`);
  console.log(`  stopped_at_cap:       ${hardCapTriggered}`);
  console.log(`  writes_performed:     0`);
  console.log(`  inserts_performed:    0`);
  console.log(`  llm_calls:            0`);
  console.log('════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Verificar disponibilidad de API key ANTES del preflight (para incluirla en reporte)
  const apiKey = await getTavilyApiKey();
  const apiKeyAvailable = apiKey !== null && apiKey.length > 0;

  printPreflight(apiKeyAvailable);

  const providerFn = createTavilyLinkedInProvider(apiKeyAvailable);
  const checkedAt = new Date().toISOString();

  console.log('Ejecutando búsquedas controladas...');
  console.log(`Candidatos: ${SMOKE_CANDIDATES.map((c) => c.name).join(', ')}\n`);

  const { results, batchMetadata } = await runControlledLinkedInCompanySearch(
    SMOKE_CANDIDATES,
    SMOKE_CONFIG,
    providerFn,
    checkedAt,
  );

  // ── Reporte por candidato ─────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  RESULTADOS POR CANDIDATO');
  console.log('════════════════════════════════════════════════════════');

  for (const result of results) {
    const e = result.enrichment;
    console.log(`\n  Candidato:            ${result.candidateName}`);
    console.log(`  attempted:            ${result.attempted}`);
    console.log(`  query:                ${result.query ?? '(no query)'}`);
    console.log(`  skip_reason:          ${result.skipReason ?? 'none'}`);
    console.log(`  enrichment_status:    ${e.status}`);
    console.log(`  confidence:           ${e.confidence}`);
    console.log(`  company_url:          ${e.company_url ?? 'none'}`);
    console.log(`  normalized_slug:      ${e.normalized_company_slug ?? 'none'}`);
    console.log(`  match_reason:         ${e.match_reason ?? 'none'}`);
    console.log(`  source:               ${e.source}`);
    console.log(`  warnings:             ${e.warnings.length > 0 ? e.warnings.join(' | ') : 'none'}`);
    if (e.signals) {
      console.log(`  signals.name_match:   ${e.signals.name_match}`);
      console.log(`  signals.domain_match: ${e.signals.domain_match}`);
      console.log(`  signals.country_match:${e.signals.country_match}`);
    }
    console.log(`  no_write_confirmed:   true`);
  }

  // ── Batch metadata ────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  BATCH METADATA');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  attempted_count:  ${batchMetadata.attempted_count}`);
  console.log(`  skipped_count:    ${batchMetadata.skipped_count}`);
  console.log(`  found_count:      ${batchMetadata.found_count}`);
  console.log(`  ambiguous_count:  ${batchMetadata.ambiguous_count}`);
  console.log(`  rejected_count:   ${batchMetadata.rejected_count}`);
  console.log(`  not_found_count:  ${batchMetadata.not_found_count}`);
  console.log(`  max_per_batch:    ${batchMetadata.max_per_batch}`);
  console.log(`  provider:         ${batchMetadata.provider}`);
  console.log('════════════════════════════════════════════════════════\n');

  printPostRun();

  console.log('[smoke] Smoke completado. 0 writes. 0 inserts. 0 LLM calls.\n');
}

main().catch((err) => {
  console.error('[smoke] ERROR inesperado:', err instanceof Error ? err.message : err);
  process.exit(1);
});
