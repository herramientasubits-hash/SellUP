#!/usr/bin/env npx tsx
/**
 * COMPRASAL El Salvador — ETL Dry-Run
 *
 * Flags:
 *   --pages=N         páginas a leer (default 2)
 *   --per-page=N      adjudicaciones por página (default 20, max 200)
 *   --dry-run         modo dry-run (obligatorio en Centroamérica.7C)
 *
 * --apply está BLOQUEADO en este hito:
 *   Apply is intentionally disabled in Centroamérica.7C. Use future hito 7D.
 *
 * No escribe en Supabase. No toca source_company_snapshots.
 * No toca accounts ni prospect_candidates.
 *
 * Hito: Centroamérica.7C
 */

import { fetchAllAdjudicaciones } from '../../src/server/source-catalog/connectors/comprasal-sv/comprasal-sv-client';
import { normalizeAdjudicacion } from '../../src/server/source-catalog/connectors/comprasal-sv/comprasal-sv-normalizer';
import {
  buildProcurementSignals,
  buildDryRunSummary,
} from '../../src/server/source-catalog/connectors/comprasal-sv/comprasal-sv-signal-builder';

// ─── Parseo de args ─────────────────────────────────────────────────────────────

function parseArg(name: string, defaultValue: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return defaultValue;
  const val = parseInt(arg.split('=')[1]!, 10);
  return isNaN(val) ? defaultValue : val;
}

const hasDryRun = process.argv.includes('--dry-run');
const hasApply = process.argv.includes('--apply');

if (hasApply) {
  console.error('');
  console.error('❌  --apply está bloqueado en Centroamérica.7C.');
  console.error('   Apply is intentionally disabled in Centroamérica.7C. Use future hito 7D.');
  console.error('');
  process.exit(1);
}

if (!hasDryRun) {
  console.error('');
  console.error('❌  Debes pasar --dry-run explícitamente en este hito.');
  console.error('   Ejemplo: npx tsx scripts/source-catalog/run-comprasal-sv-procurement-signal-etl.ts --pages=2 --per-page=20 --dry-run');
  console.error('');
  process.exit(1);
}

const MAX_PAGES = parseArg('pages', 2);
const PER_PAGE = Math.min(parseArg('per-page', 20), 200);

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('🇸🇻  COMPRASAL El Salvador — Dry-Run ETL');
  console.log(`   Fuente: sv_comprasal`);
  console.log(`   Base: https://www.comprasal.gob.sv/api/v1/publico/`);
  console.log(`   Páginas: ${MAX_PAGES}, por página: ${PER_PAGE}`);
  console.log(`   Modo: DRY-RUN (0 writes a DB)`);
  console.log('');

  const errors: string[] = [];
  let adjudicacionesRaw: Awaited<ReturnType<typeof fetchAllAdjudicaciones>> = [];
  let pagesRead = 0;

  try {
    adjudicacionesRaw = await fetchAllAdjudicaciones({ maxPages: MAX_PAGES, perPage: PER_PAGE });
    pagesRead = adjudicacionesRaw.length > 0 ? Math.ceil(adjudicacionesRaw.length / PER_PAGE) : 0;
    console.log(`✓ Adjudicaciones leídas: ${adjudicacionesRaw.length}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`fetch error: ${msg}`);
    console.error(`✗ Error al leer COMPRASAL: ${msg}`);
    console.error('');
    console.error('  Si el endpoint falla, reportar error exacto y no intentar scraping alternativo.');
    console.error('');
    process.exit(1);
  }

  const normalized = adjudicacionesRaw
    .map(normalizeAdjudicacion)
    .filter((a): a is NonNullable<typeof a> => a !== null);

  console.log(`✓ Adjudicaciones normalizadas: ${normalized.length}`);

  const signals = buildProcurementSignals(normalized);
  const summary = buildDryRunSummary(signals, pagesRead, adjudicacionesRaw.length, errors);

  console.log('');
  console.log('── Resumen Dry-Run ───────────────────────────────────────────');
  console.log(`   Páginas leídas:                ${summary.pages_read}`);
  console.log(`   Adjudicaciones leídas:         ${summary.adjudicaciones_read}`);
  console.log(`   Proveedores únicos por nombre: ${summary.unique_suppliers}`);
  console.log(`   Con nombre comercial:          ${summary.suppliers_with_commercial_name}`);
  console.log(`   Monto total adjudicado:        $${summary.total_awarded_amount.toLocaleString()}`);
  console.log(`   Fecha más reciente:            ${summary.latest_award_date ?? 'n/a'}`);
  console.log(`   Señales construidas:           ${summary.signals_built}`);
  console.log(`   Writes a DB:                   ${summary.db_writes} ✓`);
  console.log(`   Errores:                       ${summary.errors.length}`);
  if (summary.errors.length > 0) {
    summary.errors.forEach((e) => console.log(`     - ${e}`));
  }
  console.log('─────────────────────────────────────────────────────────────');

  if (signals.length > 0) {
    console.log('');
    console.log('── Muestra de señales (primeras 3) ──────────────────────────');
    signals.slice(0, 3).forEach((sig, i) => {
      console.log(`  [${i + 1}] ${sig.supplier_name}`);
      if (sig.supplier_commercial_name) {
        console.log(`       Comercial: ${sig.supplier_commercial_name}`);
      }
      console.log(`       Platform ID: ${sig.supplier_platform_id} | Awards: ${sig.awards_count} | Total: $${sig.total_awarded_amount.toLocaleString()}`);
      console.log(`       Fecha: ${sig.latest_award_date ?? 'n/a'} | signal_strength: ${sig.signal_strength}`);
    });
    console.log('─────────────────────────────────────────────────────────────');
  }

  console.log('');
  console.log('✅  Dry-run completado. Writes = 0. Supabase no tocado.');
  console.log('');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
