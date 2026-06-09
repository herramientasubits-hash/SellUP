/**
 * Prospect Generation Benchmark — Runner (Hito 16AB.23)
 *
 * Orquesta la ejecución de todos los proveedores en secuencia.
 * Aplica Fase D (duplicados, read-only) y Fase E (diversificación) post-proveedor.
 * No escribe en DB. No escribe en HubSpot.
 */

import { checkCompanyDuplicate } from '@/server/agents/prospecting-toolkit/duplicate-checker';
import { computeDiversification, computeMetrics } from './scoring';
import { ALL_MODES, PROVIDER_RUNNERS } from './providers/index';
import type {
  BenchmarkCandidate,
  BenchmarkMetrics,
  BenchmarkProviderMode,
  DuplicatePhaseResult,
  ProviderRunResult,
} from './types';
import type { BenchmarkRequest } from './types';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';

// ─── Fase D: Duplicados (read-only) ──────────────────────────────────────────

async function runDuplicatePhase(
  candidates: BenchmarkCandidate[]
): Promise<DuplicatePhaseResult[]> {
  const results: DuplicatePhaseResult[] = [];
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();

  for (const c of candidates) {
    const domain = c.website ? normalizeDomain(c.website) : null;
    const normalName = (c.name ?? '').toLowerCase().trim();

    // Check duplicate inside result set first
    const isDupInternal =
      (domain && seenDomains.has(domain)) ||
      (normalName && seenNames.has(normalName));

    if (isDupInternal) {
      results.push({ candidate_name: c.name, status: 'duplicate_inside_result' });
      continue;
    }

    if (domain) seenDomains.add(domain);
    if (normalName) seenNames.add(normalName);

    // Read-only check against SellUp + HubSpot
    try {
      const dupResult = await checkCompanyDuplicate({
        name: c.name,
        website: c.website ?? undefined,
        domain: domain ?? undefined,
        country: c.country ?? undefined,
      });

      if (dupResult.status === 'existing_in_sellup') {
        results.push({ candidate_name: c.name, status: 'duplicate_sellup', matched_id: dupResult.matches[0]?.matchedId ?? undefined });
      } else if (dupResult.status === 'existing_in_hubspot') {
        results.push({ candidate_name: c.name, status: 'duplicate_hubspot', matched_id: dupResult.matches[0]?.matchedId ?? undefined });
      } else {
        results.push({ candidate_name: c.name, status: 'new_candidate' });
      }
    } catch {
      // If checkers not available (no DB/HubSpot), mark as unchecked — never as new_candidate
      results.push({ candidate_name: c.name, status: 'unchecked' });
    }
  }

  return results;
}

// ─── Estimación de costo previo ───────────────────────────────────────────────

function printCostEstimation(modes: BenchmarkProviderMode[]): void {
  console.log('\n  Estimación de costo (primera prueba):');
  const costTable: Record<BenchmarkProviderMode, string> = {
    current_sellup: '< $0.10 (Tavily + Haiku)',
    anthropic_native_search: '~$0.30-0.80 (Sonnet + web search)',
    openai_native_search: '~$0.20-0.50 (GPT-4o + web search)',
    gemini_native_search: '~$0.01-0.05 (Gemini 2.0 Flash)',
  };
  for (const mode of modes) {
    console.log(`    ${mode}: ${costTable[mode]}`);
  }
  console.log('    Límites: 1 solicitud, 10 resultados, 30 candidatos máx, 12 búsquedas máx\n');
}

// ─── Runner principal ─────────────────────────────────────────────────────────

export async function runBenchmark(
  request: BenchmarkRequest,
  modes: BenchmarkProviderMode[] = ALL_MODES
): Promise<{ results: ProviderRunResult[]; metrics: BenchmarkMetrics[] }> {

  printCostEstimation(modes);
  console.log('  Iniciando benchmark...\n');

  const results: ProviderRunResult[] = [];

  for (const mode of modes) {
    const runner = PROVIDER_RUNNERS[mode];
    console.log(`  [${mode}] Ejecutando...`);
    const start = Date.now();

    const result = await runner(request);
    const duration = ((Date.now() - start) / 1000).toFixed(1);

    if (result.status === 'skipped_not_configured') {
      console.log(`  [${mode}] OMITIDO — ${result.skip_reason}`);
    } else if (result.status === 'error') {
      const errMsg = result.errors[0]?.message ?? 'error desconocido';
      console.log(`  [${mode}] ERROR — ${errMsg}`);
    } else {
      console.log(`  [${mode}] ${result.candidates.length} candidatos en ${duration}s`);
    }

    // Fase D: duplicados (solo si hay candidatos)
    if (result.candidates.length > 0) {
      console.log(`  [${mode}] Verificando duplicados (read-only)...`);
      result.duplicate_results = await runDuplicatePhase(result.candidates);
      const dups = result.duplicate_results.filter((d) => d.status !== 'new_candidate' && d.status !== 'unchecked').length;
      if (dups > 0) {
        console.log(`  [${mode}] ${dups} posibles duplicados encontrados`);
      }
    }

    // Fase E: diversificación (análisis, no filtra)
    if (result.candidates.length > 0) {
      result.diversification = computeDiversification(result.candidates);
    }

    results.push(result);
  }

  // Calcular métricas para todos los proveedores
  const metrics: BenchmarkMetrics[] = results.map((r) => computeMetrics(r));

  return { results, metrics };
}
