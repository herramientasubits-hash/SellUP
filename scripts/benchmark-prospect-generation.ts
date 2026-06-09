#!/usr/bin/env tsx
/**
 * Benchmark de Generación de Prospectos — CLI (Hito 16AB.23)
 *
 * Ejecuta la solicitud canónica contra todos los proveedores configurados.
 * Genera resultados ciegos en scratch/prospect-benchmark/run-<timestamp>/
 *
 * Uso: npm run benchmark:prospects
 *      npx tsx scripts/benchmark-prospect-generation.ts
 *
 * Variables de entorno requeridas (al menos una para que algo ejecute):
 *   TAVILY_API_KEY + ANTHROPIC_API_KEY  → current_sellup (baseline)
 *   ANTHROPIC_API_KEY                   → anthropic_native_search
 *   OPENAI_API_KEY                      → openai_native_search
 *   GEMINI_API_KEY o GOOGLE_API_KEY     → gemini_native_search
 *
 * SEGURIDAD:
 * - No escribe en Supabase tablas productivas
 * - No escribe en HubSpot
 * - No expone API keys en logs
 * - Resultados solo en scratch/ (no entra a git)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ─── Carga .env.local si existe (antes de cualquier import que use env vars) ──

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eqIdx = trimmed.indexOf('=');
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = val.replace(/^["']|["']$/g, '');
    }
  }
}

const cwd = process.cwd();
loadEnvFile(join(cwd, '.env.local'));
loadEnvFile(join(cwd, '.env'));

// ─── Imports (después de cargar env vars) ────────────────────────────────────

import { CANONICAL_REQUEST } from '../src/server/benchmark/prospect-benchmark/canonical-request';
import { runBenchmark } from '../src/server/benchmark/prospect-benchmark/runner';
import { ensureOutputDir, printSummary, writeBlindOutputs } from '../src/server/benchmark/prospect-benchmark/output';
import type { BenchmarkProviderMode } from '../src/server/benchmark/prospect-benchmark/types';

// ─── Seguridad: confirmar que no estamos en producción ────────────────────────

if (process.env.NODE_ENV === 'production' && !process.env.BENCHMARK_ALLOW_PRODUCTION) {
  console.error('\n  ERROR: Este benchmark NO debe ejecutarse en producción.');
  console.error('  Para forzar en producción (no recomendado): BENCHMARK_ALLOW_PRODUCTION=1\n');
  process.exit(1);
}

// ─── Parse de argumentos opcionales ──────────────────────────────────────────

function parseArgs(): { modes?: BenchmarkProviderMode[] } {
  const args = process.argv.slice(2);
  const modesIdx = args.indexOf('--modes');
  if (modesIdx >= 0 && args[modesIdx + 1]) {
    const modes = args[modesIdx + 1].split(',').map((m) => m.trim()) as BenchmarkProviderMode[];
    return { modes };
  }
  return {};
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('  BENCHMARK DE GENERACIÓN DE PROSPECTOS — SellUp (16AB.23)');
  console.log('═'.repeat(70));
  console.log('\n  Solicitud canónica:');
  console.log(`    País:     ${CANONICAL_REQUEST.country} (${CANONICAL_REQUEST.country_code})`);
  console.log(`    Sector:   ${CANONICAL_REQUEST.industry}`);
  console.log(`    Cantidad: ${CANONICAL_REQUEST.requested_count} empresas`);
  console.log(`    Contexto: ${CANONICAL_REQUEST.commercial_context}`);
  console.log('');

  const { modes } = parseArgs();

  // Generar run ID basado en timestamp
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputDir = ensureOutputDir(cwd, runId);

  console.log(`  Run ID: ${runId}`);
  console.log(`  Output: ${outputDir}\n`);

  // Ejecutar benchmark
  const { results, metrics } = await runBenchmark(CANONICAL_REQUEST, modes);

  // Escribir salidas
  const completed = results.filter((r) => r.status !== 'skipped_not_configured');
  if (completed.length === 0) {
    console.log('\n  ATENCIÓN: Ningún proveedor pudo ejecutar.');
    console.log('  Verifica que al menos una variable de entorno de API esté configurada:');
    console.log('    TAVILY_API_KEY + ANTHROPIC_API_KEY → current_sellup');
    console.log('    ANTHROPIC_API_KEY → anthropic_native_search');
    console.log('    OPENAI_API_KEY → openai_native_search');
    console.log('    GEMINI_API_KEY → gemini_native_search\n');
    process.exit(0);
  }

  writeBlindOutputs(results, metrics, outputDir);
  printSummary(results, metrics, outputDir);
}

main().catch((err) => {
  console.error('\n  FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
