#!/usr/bin/env tsx
/**
 * Benchmark de Generación de Prospectos — CLI (Hito 16AB.23.3)
 *
 * Ejecuta la solicitud canónica contra los proveedores seleccionados.
 * Genera resultados en scratch/prospect-benchmark/run-<timestamp>/
 *
 * Uso:
 *   npm run benchmark:prospects
 *   npm run benchmark:prospects -- --providers=anthropic_native_search
 *   npm run benchmark:prospects -- --resume=<run-id>
 *   npm run benchmark:prospects -- --modes=anthropic_native_search   (alias)
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

// ─── Carga .env.local si existe ───────────────────────────────────────────────

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
import type { BenchmarkProviderMode, BenchmarkRunOptions } from '../src/server/benchmark/prospect-benchmark/types';

// ─── Seguridad: confirmar que no estamos en producción ────────────────────────

if (process.env.NODE_ENV === 'production' && !process.env.BENCHMARK_ALLOW_PRODUCTION) {
  console.error('\n  ERROR: Este benchmark NO debe ejecutarse en producción.');
  console.error('  Para forzar en producción (no recomendado): BENCHMARK_ALLOW_PRODUCTION=1\n');
  process.exit(1);
}

// ─── Parse de argumentos ──────────────────────────────────────────────────────

type ParsedArgs = {
  modes?: BenchmarkProviderMode[];
  resumeRunId?: string;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const result: ParsedArgs = {};

  for (const arg of args) {
    // --providers=a,b,c  OR  --modes=a,b,c  (alias)
    if (arg.startsWith('--providers=') || arg.startsWith('--modes=')) {
      const val = arg.split('=', 2)[1] ?? '';
      result.modes = val.split(',').map((m) => m.trim()) as BenchmarkProviderMode[];
      continue;
    }

    // --resume=<run-id>
    if (arg.startsWith('--resume=')) {
      result.resumeRunId = arg.split('=', 2)[1]?.trim();
      continue;
    }

    // Legacy positional --modes <value>
    if (arg === '--modes' || arg === '--providers') {
      const idx = args.indexOf(arg);
      const next = args[idx + 1];
      if (next && !next.startsWith('--')) {
        result.modes = next.split(',').map((m) => m.trim()) as BenchmarkProviderMode[];
      }
    }
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log('  BENCHMARK DE GENERACIÓN DE PROSPECTOS — SellUp (16AB.23.3)');
  console.log('═'.repeat(70));
  console.log('\n  Solicitud canónica:');
  console.log(`    País:     ${CANONICAL_REQUEST.country} (${CANONICAL_REQUEST.country_code})`);
  console.log(`    Sector:   ${CANONICAL_REQUEST.industry}`);
  console.log(`    Cantidad: ${CANONICAL_REQUEST.requested_count} empresas`);
  console.log(`    Contexto: ${CANONICAL_REQUEST.commercial_context}`);
  console.log('');

  const { modes, resumeRunId } = parseArgs();

  // ─── Resolve run ID and output dir ─────────────────────────────────────────

  let runId: string;
  let outputDir: string;

  if (resumeRunId) {
    runId = resumeRunId;
    outputDir = ensureOutputDir(cwd, runId, true);
    if (!existsSync(outputDir)) {
      console.error(`\n  ERROR: No se encontró el run ${resumeRunId} en scratch/prospect-benchmark/`);
      console.error('  Verifica el run ID e intenta de nuevo.\n');
      process.exit(1);
    }
    console.log(`  Reanudando run: ${runId}`);
  } else {
    runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    outputDir = ensureOutputDir(cwd, runId, false);
    console.log(`  Nuevo run: ${runId}`);
  }

  console.log(`  Output: ${outputDir}\n`);

  const runOptions: BenchmarkRunOptions = {
    outputDir,
    resumeRunId,
  };

  // ─── Ejecutar benchmark ─────────────────────────────────────────────────────

  const { results, metrics } = await runBenchmark(CANONICAL_REQUEST, modes, runOptions);

  // ─── Escribir salidas ───────────────────────────────────────────────────────

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

  console.log(`\n  Para reanudar si se interrumpió:`);
  console.log(`    npm run benchmark:prospects -- --resume=${runId}`);
  console.log(`    npm run benchmark:prospects -- --providers=anthropic_native_search --resume=${runId}\n`);
}

main().catch((err) => {
  console.error('\n  FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
