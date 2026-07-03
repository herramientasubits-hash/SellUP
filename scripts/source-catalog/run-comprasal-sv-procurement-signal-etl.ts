#!/usr/bin/env npx tsx
/**
 * COMPRASAL El Salvador — ETL con adaptador source_company_signals
 *
 * Flags:
 *   --pages=N                              páginas a leer (default 2)
 *   --per-page=N                           adjudicaciones por página (default 20, max 200)
 *   --year=YYYY                            año fuente (default año actual)
 *   --dry-run                              modo dry-run (default seguro)
 *   --apply --confirm-source-company-signals-write  escribe en source_company_signals
 *
 * Solo escribe en source_company_signals. No toca source_company_snapshots.
 * No toca accounts ni prospect_candidates.
 *
 * Hito: Centroamérica.7E.2B
 */

import { createClient } from '@supabase/supabase-js';
import { fetchAllAdjudicaciones } from '../../src/server/source-catalog/connectors/comprasal-sv/comprasal-sv-client';
import { normalizeAdjudicacion } from '../../src/server/source-catalog/connectors/comprasal-sv/comprasal-sv-normalizer';
import {
  buildProcurementSignals,
  buildDryRunSummary,
} from '../../src/server/source-catalog/connectors/comprasal-sv/comprasal-sv-signal-builder';
import { adaptComprasalSignals } from '../../src/server/source-catalog/connectors/comprasal-sv/comprasal-sv-source-company-signal-adapter';
import { upsertSourceCompanySignals } from '../../src/server/source-catalog/signals/source-company-signals-writer';

// ─── Parseo de args ─────────────────────────────────────────────────────────────

function parseArg(name: string, defaultValue: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return defaultValue;
  const val = parseInt(arg.split('=')[1]!, 10);
  return isNaN(val) ? defaultValue : val;
}

const hasDryRun = process.argv.includes('--dry-run');
const hasApply = process.argv.includes('--apply');
const hasConfirm = process.argv.includes('--confirm-source-company-signals-write');

if (hasApply && !hasConfirm) {
  console.error('');
  console.error('❌  --apply requiere confirmación explícita.');
  console.error('   Debes pasar también: --confirm-source-company-signals-write');
  console.error('');
  process.exit(1);
}

// dry-run es el default seguro; apply solo si se pasaron ambos flags
const isDryRun = !(hasApply && hasConfirm) || hasDryRun;

const MAX_PAGES = parseArg('pages', 2);
const PER_PAGE = Math.min(parseArg('per-page', 20), 200);
const SOURCE_YEAR = parseArg('year', new Date().getFullYear());

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('🇸🇻  COMPRASAL El Salvador — ETL source_company_signals');
  console.log(`   Fuente: sv_comprasal`);
  console.log(`   Año fuente: ${SOURCE_YEAR}`);
  console.log(`   Base: https://www.comprasal.gob.sv/api/v1/publico/`);
  console.log(`   Páginas: ${MAX_PAGES}, por página: ${PER_PAGE}`);
  console.log(`   Modo: ${isDryRun ? 'DRY-RUN (0 writes a DB)' : 'APPLY'}`);
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

  // Fase 1: señales de procurement (formato 7C)
  const procurementSignals = buildProcurementSignals(normalized);
  const legacySummary = buildDryRunSummary(procurementSignals, pagesRead, adjudicacionesRaw.length, errors);

  // Fase 2: adaptación a source_company_signals (formato 7E)
  const { adapted, skipped: adapterSkipped } = adaptComprasalSignals(procurementSignals, SOURCE_YEAR);

  console.log(`✓ Señales adaptadas a source_company_signals: ${adapted.length}`);
  if (adapterSkipped.length > 0) {
    console.log(`  Descartadas por adaptador: ${adapterSkipped.length}`);
    adapterSkipped.forEach((s) => console.log(`    - ${s.reason}`));
  }

  // Fase 3: writer — dry-run por default; apply solo con flags explícitos
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isDryRun && (!supabaseUrl || !supabaseKey)) {
    console.error('❌  NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos para --apply.');
    process.exit(1);
  }
  const supabaseClient = isDryRun
    ? ({} as Parameters<typeof upsertSourceCompanySignals>[0]['supabase'])
    : createClient(supabaseUrl!, supabaseKey!);

  const writerResult = await upsertSourceCompanySignals({
    supabase: supabaseClient,
    signals: adapted,
    dryRun: isDryRun,
  });

  console.log('');
  console.log('── Resumen ETL ───────────────────────────────────────────────');
  console.log(`   Páginas leídas:                  ${legacySummary.pages_read}`);
  console.log(`   Adjudicaciones leídas:           ${legacySummary.adjudicaciones_read}`);
  console.log(`   Proveedores únicos por nombre:   ${legacySummary.unique_suppliers}`);
  console.log(`   Con nombre comercial:            ${legacySummary.suppliers_with_commercial_name}`);
  console.log(`   Monto total adjudicado:          $${legacySummary.total_awarded_amount.toLocaleString()}`);
  console.log(`   Fecha más reciente:              ${legacySummary.latest_award_date ?? 'n/a'}`);
  console.log(`   Señales procurement construidas: ${legacySummary.signals_built}`);
  console.log('');
  console.log(`   — Adaptador source_company_signals —`);
  console.log(`   Señales adaptadas:               ${writerResult.valid}`);
  console.log(`   Señales inválidas/descartadas:   ${writerResult.invalid + adapterSkipped.length}`);
  console.log(`   Writes realizados:               ${writerResult.insertedOrUpdated} ✓`);
  console.log(`   dryRun:                          ${writerResult.dryRun}`);
  if (writerResult.errors.length > 0) {
    console.log(`   Errores writer:`);
    writerResult.errors.forEach((e) => console.log(`     [${e.index}] ${e.reason}`));
  }
  console.log('─────────────────────────────────────────────────────────────');

  if (procurementSignals.length > 0) {
    console.log('');
    console.log('── Muestra de señales adaptadas (primeras 3) ────────────────');
    adapted.slice(0, 3).forEach((sig, i) => {
      console.log(`  [${i + 1}] ${sig.supplier_name}`);
      if (sig.supplier_commercial_name) {
        console.log(`       Comercial: ${sig.supplier_commercial_name}`);
      }
      const s = sig.signals as Record<string, unknown>;
      console.log(`       Platform ID: ${sig.supplier_platform_id} | Awards: ${s['awards_count']} | Total: $${Number(s['total_awarded_amount']).toLocaleString()}`);
      console.log(`       Fecha: ${s['latest_award_date'] ?? 'n/a'} | strength: ${sig.signal_strength} | human_review: ${sig.human_review_required}`);
    });
    console.log('─────────────────────────────────────────────────────────────');
  }

  console.log('');
  if (isDryRun) {
    console.log('✅  ETL completado. Writes = 0. Supabase no tocado.');
  } else {
    console.log(`✅  ETL completado. Filas upserted: ${writerResult.insertedOrUpdated}. Solo source_company_signals.`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
