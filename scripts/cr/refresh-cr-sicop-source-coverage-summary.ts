/**
 * SICOP CR — Upsert source_coverage_summaries for cr_sicop.
 *
 * Guardrails:
 *   - Never reads from sicop.go.cr, datos.go.cr, api.hacienda.go.cr, Tavily, LLM, or SUNAT
 *   - Never triggers the snapshot importer or ETL
 *   - Never inserts into candidates, accounts, or batch tables
 *   - Never writes to cr_hacienda_contribuyentes
 *   - The only write is an upsert into source_coverage_summaries for cr_sicop
 *   - Does not mark cr_sicop as complete_snapshot (pilot load only)
 *   - Does not change aiFlowStatus or connectionMode in source_catalog
 *   - Does not validate cédula jurídica
 *   - Does not replace Hacienda CR
 *
 * Run:
 *   npx tsx scripts/cr/refresh-cr-sicop-source-coverage-summary.ts
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Known values — Centroamérica.4B pilot load (2026-07-02)
// ---------------------------------------------------------------------------

const KNOWN_VALUES = {
  source_key: 'cr_sicop',
  country_code: 'CR',
  coverage_kind: 'procurement_signal_snapshot',
  entity_label: 'proveedores SICOP CR',
  // pilot_sample: 160 proveedores from 1.000-row sample of 565.864-row dataset
  coverage_status: 'pilot_sample',
  loaded_rows: 160,
  audited_total_rows: 0,
  audited_active_habido_rows: 0,
  active_habido_rows: 0,
  active_no_habido_rows: 0,
  inactive_habido_rows: 0,
  inactive_no_habido_rows: 0,
  out_of_scope_entities: 0,
  next_recommended_offset: 0,
  refresh_source: 'cr_4c_pilot_load',
  coverage_breakdown: {
    source_type: 'procurement_signal',
    load_type: 'pilot_sample',
    dataset: 'ofertas_2024',
    years_loaded: [2024],
    processed_rows: 1000,
    source_file_rows: 565_864,
    loaded_rows: 160,
    valid_identifiers: 906,
    skipped_non_company: 94,
    limitations: [
      'Carga piloto controlada, no universo completo SICOP',
      'Solo muestra de 1.000 filas del dataset Ofertas 2024',
      'SICOP es señal procurement B2G, no fuente legal ni tributaria',
      'No valida cédula jurídica ni reemplaza Hacienda CR',
      'CIIU no disponible en SICOP — no se inventa',
    ],
  },
  coverage_notes: {
    is_procurement_signal_only: true,
    is_fiscal_source: false,
    ciiu_status: 'unavailable_not_invented',
    complete_snapshot: false,
    connection_mode: 'not_connected',
    ai_flow_status: 'eligible_not_connected',
    validates_cedula_juridica: false,
    replaces_hacienda_cr: false,
    snapshot_source: 'cr_4b_pilot_xlsx_load',
  },
} as const;

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

async function upsertSummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  payload: Record<string, unknown>,
): Promise<void> {
  const row = {
    ...payload,
    refreshed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from('source_coverage_summaries')
    .upsert(row, { onConflict: 'source_key' });

  if (error) {
    const msg =
      typeof error === 'object' && error !== null && 'message' in error
        ? (error as { message: string }).message
        : String(error);
    throw new Error(`upsert_failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createClient(url, key);

  console.log('Guardrails activos:');
  console.log('  ✓ No escribe en cr_hacienda_contribuyentes');
  console.log('  ✓ No escribe en accounts ni prospect_candidates');
  console.log('  ✓ coverage_status ≠ complete_snapshot');
  console.log('  ✓ No llama SICOP API, Hacienda CR, Tavily, LLM, SUNAT');
  console.log('  ✓ No valida cédula jurídica');
  console.log('  ✓ No reemplaza Hacienda CR');
  console.log('');

  // Read actual count from DB to confirm
  const { count: dbCount } = await admin
    .from('source_company_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('source_key', 'cr_sicop');

  const actualRows = typeof dbCount === 'number' ? dbCount : KNOWN_VALUES.loaded_rows;
  if (actualRows !== KNOWN_VALUES.loaded_rows) {
    console.warn(
      `⚠ DB count (${actualRows}) differs from known value (${KNOWN_VALUES.loaded_rows}). Using DB count.`,
    );
  }

  const payload: Record<string, unknown> = {
    ...KNOWN_VALUES,
    loaded_rows: actualRows,
    coverage_breakdown: {
      ...(KNOWN_VALUES.coverage_breakdown as Record<string, unknown>),
      loaded_rows: actualRows,
    },
  };

  console.log('Mode: pilot load (Centroamérica.4B — 160 proveedores SICOP CR)');
  console.log('');
  await upsertSummary(admin, payload);

  console.log('Upserted source_coverage_summaries row:');
  console.log(`  source_key:      ${String(payload.source_key)}`);
  console.log(`  country_code:    ${String(payload.country_code)}`);
  console.log(`  coverage_status: ${String(payload.coverage_status)}  ← NOT complete_snapshot`);
  console.log(`  coverage_kind:   ${String(payload.coverage_kind)}`);
  console.log(`  loaded_rows:     ${String(payload.loaded_rows)}`);
  console.log(`  refresh_source:  ${String(payload.refresh_source)}`);
  const bd = payload.coverage_breakdown as Record<string, unknown>;
  const yl = (bd?.years_loaded as number[]) ?? [];
  console.log(`  years_loaded:    ${yl.join(', ')}`);
  console.log('');
  console.log('Done. Coverage summary para cr_sicop actualizado.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('refresh-cr-sicop-source-coverage-summary failed:', msg);
  process.exit(1);
});
