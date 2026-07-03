/**
 * PanamaCompra Panamá — Upsert source_coverage_summaries for pa_panamacompra_convenio.
 *
 * Guardrails:
 *   - Never reads from panamacompra.gob.pa, DGI Panamá, Registro Público, Tavily, LLM
 *   - Never triggers the snapshot importer or ETL
 *   - Never inserts into candidates, accounts, or batch tables
 *   - The only write is an upsert into source_coverage_summaries for pa_panamacompra_convenio
 *   - Does not mark pa_panamacompra_convenio as complete_snapshot
 *   - Does not change aiFlowStatus or connectionMode in source_catalog
 *   - Does not validate RUC Panamá
 *   - Does not replace DGI Panamá or Registro Público
 *   - coverage_status = partial_snapshot (NOT complete_snapshot) — updated in 5E
 *
 * Run:
 *   npx tsx scripts/pa/refresh-pa-panamacompra-convenio-source-coverage-summary.ts
 *
 * Hito: Centroamérica.5C (piloto) / 5E (operativo amplio)
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';

// ─── Source constants ──────────────────────────────────────────────────────────

const SOURCE_KEY = 'pa_panamacompra_convenio' as const;
const COUNTRY_CODE = 'PA' as const;
const REFRESH_SOURCE = 'pa_5e_operational_load' as const;

// ─── Coverage breakdown ────────────────────────────────────────────────────────

const COVERAGE_LIMITATIONS = [
  'Snapshot operativo parcial de proveedores de Convenio Marco',
  'No cubre adjudicaciones generales de PanamaCompra',
  'No cubre todos los proveedores del Estado panameño',
  'No es fuente legal ni tributaria para Panamá',
  'No valida RUC Panamá ni reemplaza DGI Panamá',
  'No reemplaza Registro Público de Panamá',
  'CIIU no disponible en PanamaCompra — no se inventa',
] as const;

// ─── Upsert ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertSummary(
  admin: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  loadedRows: number,
  etlStats?: {
    conveniosAvailable?: number;
    conveniosRead?: number;
    providersFound?: number;
    uniqueProviders?: number;
    providersWithRuc?: number;
    providersWithoutRuc?: number;
    snapshotsBuilt?: number;
  },
): Promise<void> {
  const coverageBreakdown = {
    source_type: 'procurement_signal',
    coverage_scope: 'convenio_marco',
    load_type: 'operational_partial',
    convenios_available: etlStats?.conveniosAvailable ?? null,
    convenios_read: etlStats?.conveniosRead ?? null,
    providers_found: etlStats?.providersFound ?? loadedRows,
    unique_providers: etlStats?.uniqueProviders ?? loadedRows,
    providers_with_ruc: etlStats?.providersWithRuc ?? null,
    providers_without_ruc: etlStats?.providersWithoutRuc ?? null,
    snapshots_built: etlStats?.snapshotsBuilt ?? loadedRows,
    loaded_rows: loadedRows,
    limitations: [...COVERAGE_LIMITATIONS],
  };

  const coverageNotes = {
    is_procurement_signal_only: true,
    is_fiscal_source: false,
    ruc_validation_status: 'not_applicable',
    complete_snapshot: false,
    connection_mode: 'not_connected',
    ai_flow_status: 'eligible_not_connected',
    validates_ruc_panama: false,
    replaces_dgi_panama: false,
    replaces_registro_publico: false,
    snapshot_source: 'pa_5e_operational_load',
  };

  const row = {
    source_key: SOURCE_KEY,
    country_code: COUNTRY_CODE,
    coverage_kind: 'procurement_signal_snapshot',
    coverage_status: 'partial_snapshot',
    loaded_rows: loadedRows,
    audited_total_rows: 0,
    audited_active_habido_rows: 0,
    active_habido_rows: 0,
    active_no_habido_rows: 0,
    inactive_habido_rows: 0,
    inactive_no_habido_rows: 0,
    out_of_scope_entities: 0,
    next_recommended_offset: 0,
    refresh_source: REFRESH_SOURCE,
    coverage_breakdown: coverageBreakdown,
    coverage_notes: coverageNotes,
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

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createClient(url, key);

  console.log('Guardrails activos:');
  console.log('  ✓ No escribe en accounts ni prospect_candidates');
  console.log('  ✓ coverage_status = partial_snapshot (≠ complete_snapshot)');
  console.log('  ✓ No llama panamacompra.gob.pa, DGI, Registro Público, Tavily, LLM');
  console.log('  ✓ No valida RUC Panamá');
  console.log('  ✓ No reemplaza DGI Panamá ni Registro Público');
  console.log('  ✓ No cambia aiFlowStatus ni connectionMode en source_catalog');
  console.log('');

  // Leer count real de DB
  const { count: dbCount, error: countError } = await admin
    .from('source_company_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('source_key', SOURCE_KEY);

  if (countError) {
    const msg =
      typeof countError === 'object' && countError !== null && 'message' in countError
        ? (countError as { message: string }).message
        : String(countError);
    console.warn(`⚠ No se pudo leer el count de source_company_snapshots: ${msg}`);
    console.warn('  Usando loaded_rows = 0 como base.');
  }

  const loadedRows = typeof dbCount === 'number' ? dbCount : 0;
  console.log(`  Filas en source_company_snapshots para ${SOURCE_KEY}: ${loadedRows}`);
  console.log('');

  await upsertSummary(admin, loadedRows);

  console.log('Upserted source_coverage_summaries:');
  console.log(`  source_key:      ${SOURCE_KEY}`);
  console.log(`  country_code:    ${COUNTRY_CODE}`);
  console.log(`  coverage_status: partial_snapshot  ← NOT complete_snapshot`);
  console.log(`  coverage_kind:   procurement_signal_snapshot`);
  console.log(`  loaded_rows:     ${loadedRows}`);
  console.log(`  refresh_source:  ${REFRESH_SOURCE}`);
  console.log('');
  console.log('Limitaciones registradas:');
  for (const lim of COVERAGE_LIMITATIONS) {
    console.log(`  - ${lim}`);
  }
  console.log('');
  console.log('Done. Coverage summary para pa_panamacompra_convenio actualizado.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('refresh-pa-panamacompra-convenio-source-coverage-summary failed:', msg);
  process.exit(1);
});
