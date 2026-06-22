#!/usr/bin/env tsx
/**
 * Dry-run inspector — v1.12 Source-Guided Investigation
 *
 * Herramienta permanente de preflight para el Agente 1.
 *
 * NO llama Tavily. NO gasta APIs. NO llama LLM.
 * Usa webSearchProvider:'mock' + dryRun:true.
 * Reporte completo de query trace por ronda.
 *
 * Uso: npm run agent1:dry-run:source-guided
 */

import { runIncrementalProspectingSearch } from '../../src/server/agents/prospecting-toolkit/incremental-search';
import type {
  ProspectingPipelineOutput,
  CatalogContextResult,
} from '../../src/server/agents/prospecting-toolkit/types';
import type { SearchStrategyRuntimeMetadata, IncrementalSearchOutput } from '../../src/server/agents/prospecting-toolkit/incremental-search-types';

const FAKE_CATALOG: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Tecnología',
  searchDepth: 'standard',
  fiscalIdentifierLabel: null,
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

type PipelineInput = Parameters<typeof import('../../src/server/agents/prospecting-toolkit/prospecting-pipeline').runProspectingPipeline>[0];

// ─── Input exacto del usuario ────────────────────────────────────────────────

const INPUT = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Tecnología',
  subindustries: [
    'Software Empresarial (SaaS / ERP / CRM)',
    'Edtech: Plataformas de Aprendizaje',
  ],
  additionalCriteria: [
    'Empresas B2B en Colombia con operación real verificable.',
    'Priorizar proveedores de software empresarial, ERP, CRM, HR Tech, LMS,',
    'automatización o servicios tecnológicos corporativos.',
    'Excluir marketplaces, directorios, blogs, medios, foros, glosarios,',
    'páginas educativas genéricas, artículos informativos, páginas de partners,',
    'portales de noticias, comparadores de software, rankings, agregadores',
    'y landing pages que no representen una empresa prospecto real.',
    'Si el tamaño de empresa no se puede confirmar, permitir revisión humana',
    'pero marcar tamaño no confirmado.',
  ].join(' '),
  webSearchProvider: 'mock' as const,
  dryRun: true,
  maxRounds: 4,
  targetPersistibleCandidates: 100,
  targetInternal: 25,
};

// ─── Mock pipeline con captura de queries ────────────────────────────────────

const capturedQueries: Array<{ round: number; queries: string[]; beforeCap: string[] }> = [];

function makePipeline() {
  return async (input: PipelineInput): Promise<ProspectingPipelineOutput> => {
    const queries = input.queryOverrides ?? [];
    // we also want to know what was passed BEFORE the cap
    // but we only have access to post-cap data here
    return {
      input: {
        country: input.country,
        countryCode: input.countryCode ?? 'CO',
        industry: input.industry,
        webSearchProvider: 'mock',
        mode: 'multi_query',
      },
      catalogContext: FAKE_CATALOG,
      searchQuery: 'dry-run',
      webSearch: {
        provider: 'mock',
        query: 'dry-run',
        results: [],
        resultsCount: 1,
        skipped: false,
        estimatedCostUsd: null,
        metadata: { queries_executed: queries },
      },
      candidates: [],
      summary: {
        requested: 25, searched: 1, returned: 0,
        highQualityNew: 0, needsReview: 0, duplicates: 0,
        insufficientData: 0, discarded: 0, unchecked: 0,
      },
      warnings: [],
      metadata: {
        pipelineVersion: '0.4.0',
        executedAt: new Date().toISOString(),
        provider: 'mock',
        search_mode: 'multi_query',
        queries_executed: queries,
      },
    };
  };
}

function countByType(
  queries: string[],
  output: IncrementalSearchOutput,
): Record<string, number> {
  const sgiPacks = new Set(
    output.metadata.source_guided_investigation?.query_packs.map(q => q.query_text) ?? []
  );
  const subindustryTexts = [
    'EdTech',
    'edtech',
    'Software Empresarial',
    'SaaS / ERP / CRM',
    'Plataformas de Aprendizaje',
    'learning',
  ];

  let sourceGuided = 0;
  let staticGuided = 0;
  let subindustryCount = 0;
  let fallback = 0;

  for (const q of queries) {
    const isFromInvestigation = sgiPacks.has(q);
    if (isFromInvestigation) {
      sourceGuided++;
    } else if (
      q.includes('fintech') || q.includes('Colombia Fintech') ||
      q.includes('Fedesoft') || q.includes('SECOP') ||
      q.includes('software empresarial') && !q.includes('ERP Colombia clientes corporativos sitio oficial') ||
      (q.includes('empresa') && q.includes('ERP') && q.includes('CRM'))
    ) {
      staticGuided++;
    } else if (subindustryTexts.some(t => q.includes(t))) {
      subindustryCount++;
    } else if (q.includes('empresa') || q.includes('proveedor') || q.includes('consultor')) {
      fallback++;
    } else {
      fallback++;
    }
  }

  return {
    total: queries.length,
    source_guided_investigation: sourceGuided,
    static_source_guided: staticGuided,
    subindustry: subindustryCount,
    fallback_base: fallback,
  };
}

async function runDryRun(): Promise<void> {
  const pipeline = makePipeline();
  const capturedRounds: Array<{ round: number; preCapQueries: string[]; postCapQueries: string[] }> = [];
  let roundsSeen = 0;

  // Monkey-patch capture: pipeline override
  const capturedOutput = await runIncrementalProspectingSearch(
    INPUT,
    undefined,
    pipeline,
  );

  const output = capturedOutput;
  const meta = output.metadata;
  const runtime = output.searchStrategyRuntime as SearchStrategyRuntimeMetadata;
  const sgi = meta.source_guided_investigation;

  // ── 1. Confirmación dry-run ──────────────────────────────────────────
  console.log('='.repeat(72));
  console.log('DRY-RUN REPORT — v1.12 Source-Guided Investigation');
  console.log('='.repeat(72));
  console.log('');
  console.log('1. ✅ Confirmación: dryRun=true + webSearchProvider=mock');
  console.log('   - No se llama Tavily (provider=mock)');
  console.log('   - No se escribe en BD (dryRun=true)');
  console.log('   - No se llama LLM (pipeline determinístico)');
  console.log('   - Mock provider retorna $0, sin llamadas externas');
  console.log('');

  // ── 2. Query trace por ronda ─────────────────────────────────────────
  console.log('─'.repeat(72));
  console.log('3. QUERY TRACE POR RONDA');
  console.log('─'.repeat(72));

  const traceEntries: Array<{
    round_number: number;
    query_text: string;
    query_type: string;
    query_source_key: string | null;
    intent: string | null;
    priority: string | null;
    origin: string;
  }> = [];

  const sgiQueryMap = new Map<string, { intent: string; priority: string; source_key: string }>();
  if (sgi?.query_packs) {
    for (const q of sgi.query_packs) {
      sgiQueryMap.set(q.query_text, {
        intent: q.intent,
        priority: q.priority,
        source_key: q.source_key,
      });
    }
  }

  for (let r = 0; r < meta.rounds.length; r++) {
    const round = meta.rounds[r];
    const queries = round.queriesUsed ?? [];

    console.log(`\n  ── Round ${round.round} ──`);
    for (const q of queries) {
      let queryType = 'standard';
      let querySourceKey: string | null = null;
      let intent: string | null = null;
      let priority: string | null = null;
      let origin = 'fallback/base';

      const sgiMatch = sgiQueryMap.get(q);
      if (sgiMatch) {
        queryType = 'source_guided';
        querySourceKey = sgiMatch.source_key;
        intent = sgiMatch.intent;
        priority = sgiMatch.priority;
        origin = 'source_guided_investigation';
      } else if (q.includes('fintech') || q.includes('asociadas Colombia Fintech')) {
        queryType = 'source_guided';
        querySourceKey = 'co_colombia_fintech';
        origin = 'static_source_guided';
        intent = 'fintech_signal';
        priority = 'medium';
      } else if (q.includes('empresa software ERP Colombia') || q.includes('implementador ERP CRM')) {
        queryType = 'source_guided';
        querySourceKey = 'co_software_empresarial';
        origin = 'source_guided_investigation';
        intent = 'erp_crm_provider';
        priority = 'high';
      } else if (q.includes('EdTech') || q.includes('Edtech')) {
        origin = 'subindustry';
        intent = 'edtech_subindustry';
        queryType = 'standard';
      } else {
        origin = 'fallback/base';
      }

      traceEntries.push({
        round_number: round.round,
        query_text: q,
        query_type: queryType,
        query_source_key: querySourceKey,
        intent,
        priority,
        origin,
      });

      const sKey = querySourceKey ? ` (src: ${querySourceKey})` : '';
      const sIntent = intent ? ` intent="${intent}"` : '';
      const sPriority = priority ? ` pri=${priority}` : '';
      console.log(`   [${origin}]${sKey}${sIntent}${sPriority}`);
      console.log(`     → "${q}"`);
    }
  }

  // ── 4. Conteo por ronda ──────────────────────────────────────────────
  console.log('');
  console.log('─'.repeat(72));
  console.log('4. CONTEO POR RONDA');
  console.log('─'.repeat(72));

  for (const round of meta.rounds) {
    const queries = round.queriesUsed ?? [];
    const count = countByType(queries, output);
    console.log(`\n  Ronda ${round.round}:`);
    console.log(`    Total queries seleccionadas:      ${count.total}`);
    console.log(`    Source-guided investigation:      ${count.source_guided_investigation}`);
    console.log(`    Static source-guided:             ${count.static_source_guided}`);
    console.log(`    Subindustry:                      ${count.subindustry}`);
    console.log(`    Fallback/base:                    ${count.fallback_base}`);
  }

  // ── 5. Confirmar máximo 2 investigation per round ────────────────────
  console.log('');
  console.log('─'.repeat(72));
  console.log('5. MÁXIMO 2 INVESTIGATION QUERIES POR RONDA');
  console.log('─'.repeat(72));

  let maxInvestigationInRound = 0;
  for (const round of meta.rounds) {
    const queries = round.queriesUsed ?? [];
    const invCount = queries.filter(q => sgiQueryMap.has(q)).length;
    if (invCount > maxInvestigationInRound) maxInvestigationInRound = invCount;
    const status = invCount <= 2 ? '✅' : '❌';
    console.log(`  Ronda ${round.round}: ${invCount} investigation queries ${status}`);
  }
  const veredicto5 = maxInvestigationInRound <= 2 ? '✅ PASA' : '❌ FALLA';
  console.log(`  Veredicto: ${veredicto5} (máx observado: ${maxInvestigationInRound}, límite: 2)`);

  // ── 6. Confirmar total standard <= 16 ─────────────────────────────────
  console.log('');
  console.log('─'.repeat(72));
  console.log('6. QUERY CAP STANDARD ≤ 16');
  console.log('─'.repeat(72));

  const totalQueries = meta.rounds.reduce((sum, r) => sum + (r.queriesUsed ?? []).length, 0);
  const status6 = totalQueries <= 16 ? '✅' : '❌';
  console.log(`  Total queries ejecutadas: ${totalQueries} ${status6}`);
  console.log(`  Límite: 16`);
  const veredicto6 = totalQueries <= 16 ? '✅ PASA' : '❌ FALLA';
  console.log(`  Veredicto: ${veredicto6}`);

  // Per-round cap check
  for (const round of meta.rounds) {
    const qCount = (round.queriesUsed ?? []).length;
    const capStatus = qCount <= 4 ? '✅' : '❌';
    const capText = qCount <= 4 ? 'PASA' : 'FALLA';
    console.log(`  Ronda ${round.round}: ${qCount} queries (cap 4) ${capStatus}`);
  }

  // ── 7. Metadata source_guided_investigation ──────────────────────────
  console.log('');
  console.log('─'.repeat(72));
  console.log('7. METADATA source_guided_investigation');
  console.log('─'.repeat(72));

  if (sgi) {
    console.log(`  enabled:                    ${sgi.enabled}`);
    console.log(`  version:                    ${sgi.version}`);
    console.log(`  generated_query_count:      ${sgi.generated_query_count}`);
    console.log(`  selected_query_count:       ${sgi.selected_query_count}`);
    console.log(`  source_guided_selected_count: ${sgi.source_guided_selected_count}`);
    console.log(`  fallback_selected_count:    ${sgi.fallback_selected_count}`);
    console.log(`  blocked_source_query_count: ${sgi.blocked_source_query_count ?? 'N/A'}`);
    console.log(`  blocked_sources:            ${(sgi.blocked_sources ?? []).join(', ') || '(none)'}`);
    console.log(`\n  Query packs (${sgi.query_packs.length}):`);
    for (const pack of sgi.query_packs) {
      console.log(`    [${pack.priority}] [${pack.source_key}] ${pack.intent}`);
      console.log(`      → "${pack.query_text}"`);
    }
  } else {
    console.log('  ⚠️  source_guided_investigation metadata NO presente');
  }

  // ── 8. Metadata search_strategy_runtime ──────────────────────────────
  console.log('');
  console.log('─'.repeat(72));
  console.log('8. METADATA search_strategy_runtime');
  console.log('─'.repeat(72));

  if (runtime) {
    console.log(`  source_guided_queries_allowed:  ${runtime.source_guided_queries_allowed}`);
    console.log(`  fallback_queries_allowed:       ${runtime.fallback_queries_allowed}`);
    console.log(`  source_guided_queries_blocked:  ${runtime.source_guided_queries_blocked}`);
    console.log(`  blocked_samples (${runtime.blocked_samples?.length ?? 0}):`);
    for (const sample of runtime.blocked_samples ?? []) {
      console.log(`    [${sample.query_source_key}] "${sample.query_text}"`);
      console.log(`    reason: ${sample.reason}`);
    }
  } else {
    console.log('  ⚠️  search_strategy_runtime NO presente');
  }

  // ── 9. Confirmar fuentes prohibidas NO aparecen ──────────────────────
  console.log('');
  console.log('─'.repeat(72));
  console.log('9. VERIFICACIÓN DE FUENTES PROHIBIDAS');
  console.log('─'.repeat(72));

  const forbiddenKeys = [
    'co_rues',
    'co_personas_juridicas_cc',
    'co_siis',
    'co_secop2_proveedores',
    'co_colombia_fintech',
    'co_andicom',
  ];

  const executedQueries = meta.rounds.flatMap(r => r.queriesUsed ?? []);
  const allSourceKeys = executedQueries.map(q => {
    const m = sgiQueryMap.get(q);
    if (m) return m.source_key;
    if (q.includes('fintech') && q.includes('asociadas Colombia Fintech')) return 'co_colombia_fintech';
    return null;
  }).filter(Boolean);

  const blockedInRuntime = new Set((runtime?.blocked_samples ?? []).map(s => s.query_source_key));

  for (const key of forbiddenKeys) {
    const inExecuted = allSourceKeys.includes(key);
    const inBlocked = blockedInRuntime.has(key);
    if (inExecuted) {
      console.log(`  ❌ ${key}: APARECE como query ejecutable`);
    } else if (inBlocked) {
      console.log(`  ✅ ${key}: bloqueado por search strategy (blocked_samples)`);
    } else {
      console.log(`  ✅ ${key}: NO aparece como query ejecutable`);
    }
  }

  // ── Check B2G: sin señal B2G, co_secop2_proveedores no debe aparecer ─
  const hasB2G = (INPUT.additionalCriteria ?? '').toLowerCase().includes('gobierno')
    || (INPUT.additionalCriteria ?? '').toLowerCase().includes('publico')
    || (INPUT.additionalCriteria ?? '').toLowerCase().includes('b2g')
    || (INPUT.additionalCriteria ?? '').toLowerCase().includes('licitacion');
  if (!hasB2G) {
    const secopInPacks = sgi?.query_packs.some(q => q.source_key === 'co_secop2_proveedores') ?? false;
    if (secopInPacks) {
      console.log(`  ⚠️  co_secop2_proveedores: GENERADO sin señal B2G (revisar detección)`);
    } else {
      console.log(`  ✅ co_secop2_proveedores: correctamente no generado (sin señal B2G)`);
    }
  }

  // ── 10. Veredicto ────────────────────────────────────────────────────
  console.log('');
  console.log('='.repeat(72));
  console.log('10. VEREDICTO');
  console.log('='.repeat(72));

  const veredictos: string[] = [];
  if (maxInvestigationInRound <= 2) veredictos.push('✅ Máx 2 investigation/round: OK');
  else veredictos.push('❌ Máx 2 investigation/round: FALLA');
  
  if (totalQueries <= 16) veredictos.push('✅ Query cap ≤ 16: OK');
  else veredictos.push('❌ Query cap ≤ 16: FALLA');

  const forbiddenPresent = forbiddenKeys.filter(k => {
    if (k === 'co_secop2_proveedores') return false; // checked separately
    return allSourceKeys.includes(k);
  });
  if (forbiddenPresent.length === 0) veredictos.push('✅ Fuentes prohibidas: no aparecen');
  else veredictos.push(`❌ Fuentes prohibidas: ${forbiddenPresent.join(', ')} aparecen`);

  if (sgi?.enabled) veredictos.push('✅ Source-guided investigation: enabled');
  else veredictos.push('⚠️  Source-guided investigation: disabled');

  const secopInRuntime = blockedInRuntime.has('co_secop2_proveedores') || allSourceKeys.includes('co_secop2_proveedores') === false;
  if (!hasB2G && sgi && !sgi.query_packs.some(q => q.source_key === 'co_secop2_proveedores')) {
    veredictos.push('✅ co_secop2_proveedores: correctamente excluido (sin señal B2G)');
  }
  if (!hasB2G && sgi && !sgi.query_packs.some(q => q.source_key === 'co_colombia_fintech')) {
    veredictos.push('✅ co_colombia_fintech: correctamente excluido (sin señal fintech)');
  }
  if (!hasB2G && sgi && !sgi.query_packs.some(q => q.source_key === 'co_andicom')) {
    veredictos.push('✅ co_andicom: correctamente excluido (sin mención ANDICOM explícita)');
  }

  for (const v of veredictos) {
    console.log(`  ${v}`);
  }

  const allPass = veredictos.every(v => v.startsWith('✅'));
  console.log('');
  if (allPass) {
    console.log('  ✅ LISTO PARA CORRIDA REAL — El mix de queries está validado.');
    console.log('     Puedes ejecutar con webSearchProvider:tavily y dryRun:false.');
  } else {
    console.log('  ⚠️  REQUIERE AJUSTES — Revisa los puntos rojos antes de corrida real.');
  }
  console.log('');
}

runDryRun().catch(err => {
  console.error('❌ Dry-run error:', err);
  process.exit(1);
});
