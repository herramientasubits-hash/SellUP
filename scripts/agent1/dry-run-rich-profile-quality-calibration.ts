/**
 * Dry Run — Rich Profile Quality Calibration
 * Agent 1 v1.16H-D-pre
 *
 * Propósito:
 *   Calibrar max_results y observar el breakdown completo de resultados Tavily
 *   con quality tier, score, reasons y warnings por resultado.
 *   Dry run controlado: 0 Supabase writes, 0 LLM, 0 candidates/batches.
 *
 * Restricciones activas:
 *   - MAX 1 llamada Tavily real por ejecución
 *   - 0 Supabase writes
 *   - 0 provider_usage_logs inserts
 *   - 0 candidates/batches inserts
 *   - 0 LLM calls
 *   - 0 discovery Tavily
 *   - dryRun=true, usageLoggerFn=undefined
 *   - DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled debe ser false
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled debe ser false
 *
 * Candidato configurable vía env vars (defaults: Sofka):
 *   RICH_PROFILE_CANDIDATE_NAME, RICH_PROFILE_DOMAIN, RICH_PROFILE_WEBSITE,
 *   RICH_PROFILE_COUNTRY, RICH_PROFILE_COUNTRY_CODE, RICH_PROFILE_INDUSTRY,
 *   RICH_PROFILE_MAX_RESULTS, RICH_PROFILE_SEARCH_DEPTH
 *
 * Ejemplo Globant (NO ejecutar en este hito — solo preparado):
 *   npm run agent1:dry-run:rich-profile-quality-calibration:globant
 */

import {
  createTavilyRichProfileEnrichmentProvider,
  evaluateRichProfileResultQuality,
  selectBestRichProfileResult,
  type TavilySearchResult,
} from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment-tavily';

import {
  runRichProfileEnrichmentBatch,
  buildRichProfileEnrichmentQuery,
  DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
  type RichProfileEnrichmentCandidate,
} from '../../src/server/agents/prospecting-toolkit/rich-profile-enrichment';

import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';

import { resolveCalibrationConfig } from '../../src/server/agents/prospecting-toolkit/rich-profile-calibration-config';

// ── Configurable params (env var overrides) ───────────────────────────────────

const CONFIG = resolveCalibrationConfig(process.env);

// ── Guard visual ──────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  DRY RUN ONLY — max 1 Tavily call — 0 Supabase writes');
console.log('  Rich Profile Quality Calibration — Agent 1 v1.16H-D-pre');
console.log('════════════════════════════════════════════════════════════════\n');

// ── Precheck ──────────────────────────────────────────────────────────────────

const tavilyKey = process.env.TAVILY_API_KEY;
const tavilyAvailable = typeof tavilyKey === 'string' && tavilyKey.length > 0;

console.log('── PRECHECK ─────────────────────────────────────────────────────');
console.log(`  TAVILY_API_KEY available:                         ${tavilyAvailable}`);
console.log(`  DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled:  ${DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled}`);
console.log(`  DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled:           ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled}`);
console.log(`  candidateName:  ${CONFIG.candidateName}`);
console.log(`  domain:         ${CONFIG.domain}`);
console.log(`  website:        ${CONFIG.website}`);
console.log(`  country:        ${CONFIG.country} (${CONFIG.countryCode})`);
console.log(`  industry:       ${CONFIG.industry}`);
console.log(`  maxResults:     ${CONFIG.maxResults}`);
console.log(`  searchDepth:    ${CONFIG.searchDepth}${CONFIG.searchDepth === 'advanced' ? '  ⚠️  ADVANCED MODE' : ''}`);
console.log();

if (!tavilyAvailable) {
  console.error('ABORT: TAVILY_API_KEY not set. Stopping dry run.');
  process.exit(1);
}

if (DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled !== false) {
  console.error('ABORT: DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled is not false. Stopping.');
  process.exit(1);
}

if (DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled !== false) {
  console.error('ABORT: DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled is not false. Stopping.');
  process.exit(1);
}

console.log('  Prechecks OK ✓\n');

// ── Main (wraps async logic — required for CJS/tsx compat) ───────────────────

async function main() {

// ── Tavily transport — captures raw results for breakdown ─────────────────────

let tavilyCallCount = 0;
let capturedRawResults: TavilySearchResult[] = [];

async function tavilyTransport(opts: {
  api_key: string;
  query: string;
  search_depth: 'basic' | 'advanced';
  max_results: number;
  include_domains?: string[];
}) {
  tavilyCallCount++;
  if (tavilyCallCount > 1) {
    throw new Error('DRY_RUN_ABORT: exceeded max 1 Tavily call');
  }

  const { api_key, ...body } = opts;

  console.log(`── TAVILY CALL #${tavilyCallCount} ─────────────────────────────────────────`);
  console.log(`  Query:           ${body.query}`);
  console.log(`  max_results:     ${body.max_results}`);
  console.log(`  search_depth:    ${body.search_depth}`);
  if (body.include_domains) {
    console.log(`  include_domains: ${body.include_domains.join(', ')}`);
  }
  console.log();

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`tavily_http_error_${response.status}`);
  }

  const data = await response.json() as { results?: TavilySearchResult[]; error?: string; query?: string };
  capturedRawResults = data.results ?? [];
  return data as { query: string; results: TavilySearchResult[]; error?: string };
}

// ── Candidate in memory ───────────────────────────────────────────────────────

const candidate: RichProfileEnrichmentCandidate = {
  name: CONFIG.candidateName,
  domain: CONFIG.domain,
  website: CONFIG.website,
  country: CONFIG.country,
  countryCode: CONFIG.countryCode,
  industry: CONFIG.industry,
  confidenceScore: 80,
  fitScore: 75,
  richProfile: {
    schema_version: 'candidate_rich_profile_v1',
    company: {
      name: CONFIG.candidateName,
      website: CONFIG.website,
      domain: CONFIG.domain,
      linkedin_url: null,
    },
    classification: {
      country: CONFIG.country,
      country_code: CONFIG.countryCode,
      industry: CONFIG.industry,
      subindustry: null,
      relationship_type: 'sales_prospect',
      not_sales_prospect: false,
    },
    location: { city: null, hq_country: null, source: 'unknown' },
    size: { estimated_range: null, status: 'unknown', source: 'unknown', notes: null },
    description: { short: null, source: 'unknown' },
    evidence: {
      primary_url: null,
      primary_source_type: 'unknown',
      evidence_summary: null,
      evidence_quality: 'unknown',
      warnings: [],
    },
    confidence: {
      confidence_score: 80,
      fit_score: 75,
      confidence_level: 'high',
      reasons: [],
    },
    notes: {
      executive_note: null,
      review_note: null,
      missing_fields: ['city', 'size'],
      requires_human_review: false,
    },
    provenance: {
      generated_at: new Date().toISOString(),
      generated_by: 'agent_1',
      enrichment_level: 'basic',
      external_calls_used: false,
      cost_usd: 0,
    },
  },
  isBlockedByDuplicateGuard: false,
  isBlockedByEvidencePolicy: false,
};

// ── Override config ───────────────────────────────────────────────────────────

const overrideConfig = {
  enabled: true,
  provider: 'tavily' as const,
  maxPerBatch: 1,
  maxQueriesPerCandidate: 1,
  minConfidenceScore: 60,
  enrichCity: true,
  enrichSize: true,
  enrichDescription: true,
};

// ── Query preview ─────────────────────────────────────────────────────────────

const queryPreview = buildRichProfileEnrichmentQuery(candidate);
console.log('── QUERY ESPERADA ──────────────────────────────────────────────');
console.log(`  ${queryPreview}`);
console.log();

// ── Run enrichment ────────────────────────────────────────────────────────────

console.log('── EJECUTANDO DRY RUN ──────────────────────────────────────────');

const providerFn = createTavilyRichProfileEnrichmentProvider(
  CONFIG.maxResults,
  tavilyTransport,
  CONFIG.searchDepth,
);

const runnerOutput = await runRichProfileEnrichmentBatch(
  [candidate],
  {
    config: overrideConfig,
    providerFn,
    unitCostUsd: 0.008,
    batchId: 'dry-run-rich-profile-quality-calibration',
    userId: null,
    dryRun: true,
    usageLoggerFn: undefined,
  },
);

// ── REPORTE ───────────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  REPORTE — Rich Profile Quality Calibration Dry Run');
console.log('════════════════════════════════════════════════════════════════\n');

// 1. Precheck summary
console.log('1. PRECHECK');
console.log(`   TAVILY_API_KEY available:                        ${tavilyAvailable} ✓`);
console.log(`   DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled: ${DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled} ✓`);
console.log(`   DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled:          ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled} ✓`);
console.log();

// 2. Query ejecutada
console.log('2. QUERY EJECUTADA');
console.log(`   ${queryPreview}`);
console.log();

// 3. Total Tavily calls
console.log('3. TOTAL TAVILY CALLS REALES');
console.log(`   ${tavilyCallCount}`);
console.log();

// 4. Breakdown individual por resultado Tavily
console.log('4. BREAKDOWN INDIVIDUAL — RESULTADOS TAVILY');
console.log(`   Total resultados recibidos: ${capturedRawResults.length}`);
console.log();

if (capturedRawResults.length === 0) {
  console.log('   (sin resultados — Tavily no retornó nada)');
} else {
  // Compute selected result to mark selected=true/false
  const selectionForBreakdown = selectBestRichProfileResult(capturedRawResults, candidate);
  const selectedUrl = selectionForBreakdown?.result.url ?? null;

  capturedRawResults.forEach((r, idx) => {
    const assessment = evaluateRichProfileResultQuality(r, candidate);
    const isSelected = r.url === selectedUrl;

    console.log(`   ┌─ Resultado #${idx + 1} ─────────────────────────────────────`);
    console.log(`   │  index:         ${idx}`);
    console.log(`   │  url:           ${r.url}`);
    console.log(`   │  title:         ${r.title ? r.title.slice(0, 80) : '(vacío)'}`);
    console.log(`   │  tavily_score:  ${typeof r.score === 'number' ? r.score.toFixed(4) : 'n/a'}`);
    console.log(`   │  quality_tier:  ${assessment.quality}`);
    console.log(`   │  quality_score: ${assessment.score}`);
    console.log(`   │  reasons:       ${JSON.stringify(assessment.reasons)}`);
    console.log(`   │  warnings:      ${JSON.stringify(assessment.warnings)}`);
    console.log(`   │  selected:      ${isSelected}`);
    console.log(`   └─────────────────────────────────────────────────────────`);
    console.log();
  });
}

// 5. Provider result
const enriched = runnerOutput.enrichedProfiles[0];
const providerResult = enriched?.providerResult;
const skippedItem = runnerOutput.skipped[0];

console.log('5. PROVIDER RESULT');
if (providerResult) {
  console.log(`   selected_url:         ${providerResult.evidence_url ?? 'null'}`);
  console.log(`   selected_quality:     (ver breakdown arriba)`);
  console.log(`   provider status:      ${providerResult.status}`);
  console.log(`   city:                 ${providerResult.city ?? 'null'}`);
  console.log(`   hq_country:           ${providerResult.hq_country ?? 'null'}`);
  console.log(`   size_range:           ${providerResult.size_range ?? 'null'}`);
  console.log(`   description exists:   ${!!providerResult.description}`);
  if (providerResult.description) {
    console.log(`   description preview:  ${providerResult.description.slice(0, 120)}...`);
  }
  console.log(`   evidence_url:         ${providerResult.evidence_url ?? 'null'}`);
  console.log(`   confidence:           ${providerResult.confidence ?? 'null'}`);
  console.log(`   warnings:             ${JSON.stringify(providerResult.warnings ?? [])}`);
} else if (skippedItem) {
  console.log(`   SKIPPED — reason: ${skippedItem.reason}`);
} else {
  console.log('   No provider result (no enriched profiles, no skipped)');
}
console.log();

// 5b. Provenance del rich profile DESPUÉS de merge
console.log('5b. PROVENANCE POST-MERGE (enrichedProfile.provenance)');
const enrichedProfile = enriched?.enrichedProfile;
if (enrichedProfile) {
  const prov = enrichedProfile.provenance;
  console.log(`   generated_by:              ${prov.generated_by}`);
  console.log(`   enrichment_level:          ${prov.enrichment_level}`);
  console.log(`   external_calls_used:       ${prov.external_calls_used}`);
  console.log(`   cost_usd:                  ${prov.cost_usd}`);
  console.log(`   last_enrichment_at:        ${('last_enrichment_at' in prov ? (prov as Record<string, unknown>)['last_enrichment_at'] : 'n/a') ?? 'n/a'}`);
  const notes = enrichedProfile.notes;
  console.log(`   notes.requires_human_review: ${notes.requires_human_review}`);
  console.log(`   notes.missing_fields:        ${JSON.stringify(notes.missing_fields ?? [])}`);
  // Diagnosis: was enrichment_level correctly upgraded?
  if (prov.enrichment_level === 'basic' && prov.external_calls_used === false) {
    console.log('   ⚠️  DIAGNÓSTICO: enrichment_level=basic — merge no se ejecutó o external call no fue marcada.');
  } else if (prov.enrichment_level === 'controlled') {
    console.log('   ✅ enrichment_level=controlled — merge ejecutado correctamente.');
  }
} else if (skippedItem) {
  console.log(`   SKIPPED — provenance sin cambio (reason: ${skippedItem.reason})`);
} else {
  console.log('   (sin enrichedProfile)');
}
console.log();

// 6. Usage payload in memory
console.log('6. USAGE PAYLOAD (EN MEMORIA — NO INSERTADO)');
const usagePayload = runnerOutput.usagePayloads[0];
if (usagePayload) {
  console.log(`   usage_key:            ${usagePayload.usage_key}`);
  console.log(`   feature:              ${usagePayload.feature}`);
  console.log(`   provider:             ${usagePayload.provider}`);
  console.log(`   estimated_cost_usd:   $${usagePayload.estimated_cost_usd}`);
  console.log(`   selected_status:      ${usagePayload.selected_status}`);
  console.log(`   selected_url:         ${usagePayload.selected_url ?? 'null'}`);
  console.log(`   query_length:         ${usagePayload.query.length} chars`);
} else {
  console.log('   (sin usage payload — candidato skipped antes del provider call)');
}
console.log();

// 7. Batch metadata
const meta = runnerOutput.batchMetadata;
console.log('7. BATCH METADATA');
console.log(`   attempted_candidate_count: ${meta.attempted_candidate_count}`);
console.log(`   attempted_query_count:     ${meta.attempted_query_count}`);
console.log(`   found_count:               ${meta.found_count}`);
console.log(`   partial_count:             ${meta.partial_count}`);
console.log(`   not_found_count:           ${meta.not_found_count}`);
console.log(`   failed_count:              ${meta.failed_count}`);
console.log(`   estimated_cost_usd:        $${meta.estimated_cost_usd}`);
console.log();

// 8. Confirmación 0 writes
console.log('8. CONFIRMACIÓN DE 0 WRITES');
console.log('   Supabase writes:             0 ✓');
console.log('   provider_usage_logs inserts: 0 ✓');
console.log('   candidates inserts:          0 ✓');
console.log('   batches inserts:             0 ✓');
console.log('   LLM calls:                   0 ✓');
console.log('   discovery Tavily:            0 ✓');
console.log(`   dryRun=true, usageLoggerFn=undefined ✓`);
console.log(`   DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled: ${DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled} ✓`);
console.log(`   DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled:          ${DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled} ✓`);
console.log();

// 9. Recomendación
console.log('9. RECOMENDACIÓN');
if (providerResult) {
  if (providerResult.status === 'found' || providerResult.status === 'partial') {
    const url = providerResult.evidence_url ?? '';
    const isAboutOrRoot = !!url && (
      url.includes('/about') ||
      url.includes('/company') ||
      url.includes('/corporate') ||
      url.includes('/overview') ||
      url.includes('/nosotros') ||
      !url.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '')
    );
    if (isAboutOrRoot || providerResult.city || providerResult.size_range) {
      console.log('   ✅ Seleccionó about/root/official page o extrajo datos útiles.');
      console.log('   → LISTO para autorizar v1.16H-C real dry run.');
    } else {
      console.log('   ⚠️  Seleccionó página pero sin about/root claro o datos útiles.');
      console.log('   → REVISAR calidad de resultados antes de write smoke.');
    }
  } else if (providerResult.status === 'not_found') {
    console.log('   ⚠️  not_found — Tavily no extrajo city/size con este searchDepth/maxResults.');
    if (CONFIG.searchDepth === 'basic') {
      console.log('   → Considerar autorizar v1.16H-C advanced dry run (searchDepth=advanced).');
    } else {
      console.log('   → REVISAR breakdown arriba. Ajustar query o estrategia.');
    }
  } else if (providerResult.status === 'failed') {
    console.log('   ❌ failed — Error en llamada Tavily.');
    console.log('   → REVISAR error y reintentar.');
  }
} else if (skippedItem) {
  console.log(`   ⚠️  Candidato skipped — reason: ${skippedItem.reason}`);
  console.log('   → REVISAR override config.');
} else {
  console.log('   ⚠️  Sin resultado claro. Revisar output manual.');
}
console.log();

console.log('════════════════════════════════════════════════════════════════');
console.log('  FIN DRY RUN — Rich Profile Quality Calibration');
console.log(`  candidate=${CONFIG.candidateName}  domain=${CONFIG.domain}`);
console.log(`  searchDepth=${CONFIG.searchDepth}  maxResults=${CONFIG.maxResults}`);
console.log('════════════════════════════════════════════════════════════════\n');

} // end main

main().catch((e: unknown) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
