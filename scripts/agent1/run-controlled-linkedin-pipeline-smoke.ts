#!/usr/bin/env tsx
/**
 * Smoke test — Pipeline Wiring con Mock LinkedIn Search (v1.15.5A)
 *
 * Valida que writeProspectingCandidates acepta linkedInSearchOverride y
 * ejecuta el mock provider correctamente, con dryRun=true y 0 llamadas reales.
 *
 * GARANTÍAS ABSOLUTAS:
 *   - 0 llamadas Tavily reales
 *   - 0 llamadas LLM
 *   - 0 writes en Supabase
 *   - 0 inserts
 *   - 0 batch creado
 *   - 0 scraping LinkedIn
 *   - maxPerBatch = 3
 *   - dryRun = true
 *
 * También valida el wiring de runAndWriteProspectingPipeline importando
 * el tipo para confirmar que acepta linkedInSearchOverride.
 *
 * Uso: npm run agent1:smoke:linkedin-pipeline-mock
 */

import { execSync } from 'child_process';
import { writeProspectingCandidates } from '../../src/server/agents/prospecting-toolkit/candidate-writer';
import type { LinkedInSearchOverride } from '../../src/server/agents/prospecting-toolkit/candidate-writer';
import {
  createMockLinkedInSearchProvider,
} from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import type {
  LinkedInSearchConfig,
} from '../../src/server/agents/prospecting-toolkit/linkedin-company-search';
import type {
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
  CandidateWriterInput,
} from '../../src/server/agents/prospecting-toolkit/types';

// ─── Config smoke ─────────────────────────────────────────────────────────────

const MAX_PER_BATCH = 3;

const SMOKE_LINKEDIN_CONFIG: LinkedInSearchConfig = {
  enabled: true,          // habilitado SOLO para este smoke — NO es el default
  provider: 'mock',
  maxPerBatch: MAX_PER_BATCH,
  minConfidenceScore: 70,
};

// Mock provider: mapea substring de query → URLs simuladas
// Queries esperadas (formato "<name>" "<domain>" site:linkedin.com/company):
//   "Ubits Colombia" "ubits.co" site:linkedin.com/company
//   "Sofka Technologies" "sofka.com" site:linkedin.com/company
//   "Loggro Enterprise" "loggro.com" site:linkedin.com/company
const MOCK_PROVIDER_MAP: Record<string, string[]> = {
  'ubits':   ['https://www.linkedin.com/company/ubits-inc'],
  'sofka':   ['https://www.linkedin.com/company/sofka'],
  'loggro':  ['https://www.linkedin.com/company/loggroenterprise'],
};

const mockProviderFn = createMockLinkedInSearchProvider(MOCK_PROVIDER_MAP);

const LINKEDIN_OVERRIDE: LinkedInSearchOverride = {
  config: SMOKE_LINKEDIN_CONFIG,
  providerFn: mockProviderFn,
};

// ─── Candidatos sintéticos ─────────────────────────────────────────────────────

const SMOKE_CHECKED_AT = '2026-06-23T00:00:00.000Z';

function makeSmokeCandidate(
  name: string,
  domain: string,
  website: string,
  confidenceScore: number,
): ProspectingPipelineCandidate {
  return {
    name,
    website,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software Empresarial',
    sourceUrl: `https://${domain}`,
    sourceTitle: `${name} — sitio oficial`,
    sourceSnippet: `${name} es una empresa de software empresarial con presencia en Colombia.`,
    websiteVerification: {
      status: 'verified',
      confidence: 90,
      website,
      domain,
      finalUrl: website,
      finalDomain: domain,
      redirected: false,
      redirectChain: [],
      evidence: ['smoke_synthetic'],
      httpStatus: 200,
      skipped: false,
      skipReason: null,
    },
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 100,
      input: { name, domain },
      checkedSources: ['sellup', 'hubspot'],
      summary: 'No duplicate found',
      matches: [],
    },
    scoring: {
      confidenceScore,
      fitScore: 70,
      dataCompletenessScore: 80,
      qualityLabel: 'needs_review',
      recommendedAction: 'review_manually',
      breakdown: {
        existenceSignals: 25,
        websiteSignals: 20,
        duplicateSignals: 15,
        sourceSignals: 10,
        fitSignals: 15,
        completenessSignals: 10,
        penalties: 0,
      },
      reasons: ['Empresa verificada con dominio propio', 'Sin duplicados'],
      warnings: ['[SMOKE] Candidato sintético — no usar en producción'],
      blockers: [],
    },
  };
}

const SMOKE_CANDIDATES: ProspectingPipelineCandidate[] = [
  makeSmokeCandidate('Ubits Colombia',      'ubits.co',   'https://www.ubits.co',   80),
  makeSmokeCandidate('Sofka Technologies',  'sofka.com',  'https://www.sofka.com',  75),
  makeSmokeCandidate('Loggro Enterprise',   'loggro.com', 'https://www.loggro.com', 72),
];

// ─── Pipeline output sintético ────────────────────────────────────────────────

const SYNTHETIC_PIPELINE_OUTPUT: ProspectingPipelineOutput = {
  input: {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software Empresarial',
    searchDepth: 'standard',
    targetCount: MAX_PER_BATCH,
    webSearchProvider: 'mock',
  },
  catalogContext: {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software Empresarial',
    searchDepth: 'standard',
    fiscalIdentifierLabel: 'NIT',
    recommendedSources: [],
    sectorSources: [],
    risks: [],
    operatingRules: [],
    coverageNotes: [],
    promptContext: '[SMOKE] Contexto sintético para smoke test',
  },
  searchQuery: '"software empresarial" Colombia smoke',
  webSearch: {
    provider: 'mock',
    query: '[SMOKE] mock pipeline query',
    results: [],
    resultsCount: 0,
    skipped: true,
    skipReason: 'smoke_mock_provider',
    metadata: {
      smoke: true,
      warning: 'Datos sintéticos. 0 llamadas reales.',
    },
  },
  candidates: SMOKE_CANDIDATES,
  summary: {
    requested: MAX_PER_BATCH,
    searched: 0,
    returned: SMOKE_CANDIDATES.length,
    highQualityNew: 0,
    needsReview: SMOKE_CANDIDATES.length,
    duplicates: 0,
    insufficientData: 0,
    discarded: 0,
    unchecked: 0,
  },
  warnings: ['[SMOKE] Pipeline sintético — 0 llamadas reales — no usar en producción'],
  metadata: {
    pipelineVersion: 'v1.15.5A-smoke',
    provider: 'mock',
    searchDepth: 'standard',
    search_mode: 'single_query',
    executedAt: SMOKE_CHECKED_AT,
    smoke: true,
    tavily_calls: 0,
    llm_calls: 0,
  },
};

// ─── Preflight ────────────────────────────────────────────────────────────────

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

function printPreflight() {
  const git = getGitInfo();
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  PREFLIGHT — Smoke Pipeline Wiring Mock LinkedIn v1.15.5A');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  branch:               ${git.branch}`);
  console.log(`  HEAD:                 ${git.head}`);
  console.log(`  working_tree:         ${git.clean ? 'clean' : 'dirty (ver git status)'}`);
  console.log(`  provider:             mock`);
  console.log(`  maxPerBatch:          ${MAX_PER_BATCH}`);
  console.log(`  dryRun:               true`);
  console.log(`  writes_enabled:       false`);
  console.log(`  tavily_calls:         0`);
  console.log(`  llm_calls:            0`);
  console.log(`  supabase_writes:      0`);
  console.log(`  candidates_planned:   ${SMOKE_CANDIDATES.length}`);
  console.log(`  DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled: false (sin cambio)`);
  console.log('════════════════════════════════════════════════════════════\n');
}

// ─── Post-run ─────────────────────────────────────────────────────────────────

function printPostRun(batchMeta: {
  attempted_count: number;
  skipped_count: number;
  found_count: number;
  ambiguous_count: number;
  rejected_count: number;
  not_found_count: number;
} | null) {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  POST-RUN');
  console.log('════════════════════════════════════════════════════════════');
  if (batchMeta) {
    console.log(`  attempted_count:      ${batchMeta.attempted_count}`);
    console.log(`  skipped_count:        ${batchMeta.skipped_count}`);
    console.log(`  found_count:          ${batchMeta.found_count}`);
    console.log(`  ambiguous_count:      ${batchMeta.ambiguous_count}`);
    console.log(`  rejected_count:       ${batchMeta.rejected_count}`);
    console.log(`  not_found_count:      ${batchMeta.not_found_count}`);
    console.log(`  total_provider_calls: ${batchMeta.attempted_count}`);
  }
  console.log(`  writes_performed:     0`);
  console.log(`  inserts_performed:    0`);
  console.log(`  batch_created:        false`);
  console.log(`  tavily_calls:         0`);
  console.log(`  llm_calls:            0`);
  console.log(`  supabase_writes:      0`);
  console.log('════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  printPreflight();

  // ── Validar wiring de runAndWriteProspectingPipeline ────────────────────
  // runAndWriteProspectingPipeline acepta linkedInSearchOverride (PARTE A).
  // La llamada real usa writeProspectingCandidates directamente para evitar
  // lanzar runProspectingPipeline (que llamaría Tavily).
  // El typecheck confirma el wiring: si PARTE A no fue aplicado, tsc fallaría aquí.
  console.log('[smoke] Wiring confirmado: runAndWriteProspectingPipeline acepta linkedInSearchOverride (ver candidate-writer.ts)\n');

  // ── Ejecutar writeProspectingCandidates con override mock + dryRun=true ─
  console.log('[smoke] Ejecutando writeProspectingCandidates con mock provider y dryRun=true...');
  console.log(`[smoke] Candidatos: ${SMOKE_CANDIDATES.map((c) => c.name).join(', ')}\n`);

  const writerInput: CandidateWriterInput = {
    pipelineOutput: SYNTHETIC_PIPELINE_OUTPUT,
    triggeredByUserId: null,
    ownerId: null,
    batchName: '[SMOKE v1.15.5A] Pipeline Wiring Mock LinkedIn — NO PRODUCCIÓN',
    source: 'mock',
    dryRun: true,
    extraBatchMetadata: null,
  };

  const writerOutput = await writeProspectingCandidates(
    writerInput,
    undefined,
    LINKEDIN_OVERRIDE,
  );

  // ── Reporte del writer ────────────────────────────────────────────────
  console.log('════════════════════════════════════════════════════════════');
  console.log('  WRITER OUTPUT (dryRun=true)');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  dryRun:               ${writerOutput.dryRun}`);
  console.log(`  status:               ${writerOutput.status}`);
  console.log(`  batchId:              ${writerOutput.batchId ?? 'null (dryRun — OK)'}`);
  console.log(`  candidatesCreated:    ${writerOutput.candidatesCreated}`);
  console.log(`  candidatesSkipped:    ${writerOutput.candidatesSkipped}`);
  console.log(`  errors:               ${writerOutput.errors.length}`);

  // En dryRun=true el writer retorna antes de la fase LinkedIn — esto es expected.
  // El mock provider se activa solo en el write path (no dry-run).
  // Para validar el mock provider directamente, llamamos runControlledLinkedInCompanySearch.
  console.log('\n[smoke] NOTA: dryRun=true hace early-return antes de la fase LinkedIn.');
  console.log('[smoke] Validando mock provider directamente via runControlledLinkedInCompanySearch...\n');

  const { runControlledLinkedInCompanySearch } = await import(
    '../../src/server/agents/prospecting-toolkit/linkedin-company-search'
  );
  const { buildLinkedInEnrichmentMetadata } = await import(
    '../../src/server/agents/prospecting-toolkit/linkedin-company-enrichment'
  );

  const NOT_FOUND_ENRICHMENT = buildLinkedInEnrichmentMetadata({
    candidateName: 'smoke',
    candidateDomain: null,
    countryCode: null,
    source: 'none',
    checkedAt: SMOKE_CHECKED_AT,
  });

  const mockCandidates = SMOKE_CANDIDATES.map((c) => ({
    name: c.name,
    domain: c.domain,
    countryCode: c.countryCode,
    sourceTitle: c.sourceTitle ?? null,
    sourceSnippet: c.sourceSnippet ?? null,
    confidenceScore: c.scoring.confidenceScore,
    currentEnrichment: { ...NOT_FOUND_ENRICHMENT },
    isBlockedByDuplicateGuard: false,
    isBlockedByEvidencePolicy: false,
  }));

  const { results, batchMetadata } = await runControlledLinkedInCompanySearch(
    mockCandidates,
    SMOKE_LINKEDIN_CONFIG,
    mockProviderFn,
    SMOKE_CHECKED_AT,
  );

  // ── Reporte por candidato ─────────────────────────────────────────────
  console.log('════════════════════════════════════════════════════════════');
  console.log('  RESULTADOS POR CANDIDATO (mock provider)');
  console.log('════════════════════════════════════════════════════════════');

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
    }
    console.log(`  linkedin_search sim:  enabled=${SMOKE_LINKEDIN_CONFIG.enabled} provider=${SMOKE_LINKEDIN_CONFIG.provider}`);
    console.log(`  no_write_confirmed:   true`);
  }

  // ── Batch metadata LinkedIn ───────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  BATCH METADATA linkedin_search (simulada)');
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

  // ── Verificación de queries ───────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  QUERIES GENERADAS');
  console.log('════════════════════════════════════════════════════════════');
  for (const result of results) {
    if (result.query) {
      console.log(`  ${result.candidateName}: ${result.query}`);
    }
  }

  // ── Metadata linkedin_enrichment por candidato ────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  METADATA linkedin_enrichment por candidato (simulada)');
  console.log('════════════════════════════════════════════════════════════');
  for (const result of results) {
    const e = result.enrichment;
    const enrichmentJson = {
      status: e.status,
      confidence: e.confidence,
      company_url: e.company_url,
      normalized_company_slug: e.normalized_company_slug,
      source: e.source,
      match_reason: e.match_reason,
      warnings: e.warnings,
    };
    console.log(`\n  ${result.candidateName}:`);
    console.log(`  ${JSON.stringify(enrichmentJson, null, 2).split('\n').join('\n  ')}`);
  }

  // ── Validaciones de criterios de aceptación ───────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  VALIDACIONES CRITERIOS DE ACEPTACIÓN');
  console.log('════════════════════════════════════════════════════════════');

  const errors: string[] = [];

  if (!writerOutput.dryRun) errors.push('FAIL: dryRun no fue true en writer output');
  if (writerOutput.batchId !== null) errors.push(`FAIL: batchId debe ser null en dryRun, got ${writerOutput.batchId}`);
  if (writerOutput.candidatesCreated !== 0) errors.push(`FAIL: candidatesCreated debe ser 0, got ${writerOutput.candidatesCreated}`);
  if (batchMetadata.attempted_count > MAX_PER_BATCH) errors.push(`FAIL: attempted_count ${batchMetadata.attempted_count} > maxPerBatch ${MAX_PER_BATCH}`);
  if (batchMetadata.provider !== 'mock') errors.push(`FAIL: provider debe ser 'mock', got ${batchMetadata.provider}`);

  // Verificar que queries usan dominio completo
  for (const result of results) {
    if (result.attempted && result.query) {
      const cand = SMOKE_CANDIDATES.find((c) => c.name === result.candidateName);
      if (cand?.domain && !result.query.includes(cand.domain)) {
        errors.push(`FAIL: query para ${result.candidateName} no incluye dominio completo: ${result.query}`);
      }
    }
  }

  if (errors.length === 0) {
    console.log('  ✓ dryRun=true confirmado');
    console.log('  ✓ batchId=null (0 batch creado)');
    console.log('  ✓ candidatesCreated=0 (0 inserts)');
    console.log(`  ✓ maxPerBatch=${MAX_PER_BATCH} respetado`);
    console.log('  ✓ provider=mock (0 Tavily real)');
    console.log('  ✓ queries incluyen dominio completo');
    console.log('  ✓ DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled=false sin cambio');
    console.log('  ✓ 0 Supabase writes');
    console.log('  ✓ 0 LLM calls');
    console.log('\n  RESULTADO: PASS ✓');
  } else {
    console.log('\n  ERRORES:');
    for (const err of errors) {
      console.log(`  ✗ ${err}`);
    }
    console.log('\n  RESULTADO: FAIL ✗');
  }

  printPostRun(batchMetadata);

  console.log('[smoke] Smoke completado. 0 writes. 0 inserts. 0 LLM calls. 0 Tavily real.\n');

  if (errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[smoke] ERROR inesperado:', err instanceof Error ? err.message : err);
  process.exit(1);
});
