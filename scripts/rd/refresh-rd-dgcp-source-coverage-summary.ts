/**
 * DGCP RD — Upsert source_coverage_summaries for do_dgcp.
 *
 * Modes:
 *   --from-known-values : writes verified values from hito RD.2E (pilot, 47 rows)
 *   --from-db-count     : reads actual count from source_company_snapshots and
 *                         writes operational summary (RD.2G, 53k+ rows)
 *
 * Guardrails:
 *   - Never reads from dgcp.gob.do, dgii.gov.do, Tavily, any LLM, or SUNAT
 *   - Never triggers the snapshot importer or ETL
 *   - Never inserts into candidates, accounts, or batch tables
 *   - Never writes to rd_dgii_bulk
 *   - The only write is an upsert into source_coverage_summaries for do_dgcp
 *   - Does not mark do_dgcp as complete_snapshot (pilot load only)
 *   - Does not change aiFlowStatus or connectionMode in source_catalog
 *
 * Run:
 *   npx tsx scripts/rd/refresh-rd-dgcp-source-coverage-summary.ts --from-known-values
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Known values — RepúblicaDominicana.2E controlled load (2026-07-01)
// ---------------------------------------------------------------------------

const KNOWN_VALUES = {
  source_key: 'do_dgcp',
  country_code: 'DO',
  coverage_kind: 'procurement_signal_snapshot',
  entity_label: 'proveedores B2G',
  // pilot_sample: carga controlada, NOT universo completo DGCP
  coverage_status: 'pilot_sample',
  loaded_rows: 47,
  audited_total_rows: 0,
  audited_active_habido_rows: 0,
  active_habido_rows: 0,
  active_no_habido_rows: 0,
  inactive_habido_rows: 0,
  inactive_no_habido_rows: 0,
  out_of_scope_entities: 0,
  next_recommended_offset: 0,
  refresh_source: 'rd_2e_controlled_load',
  coverage_breakdown: {
    source_type: 'procurement_signal',
    load_type: 'controlled_pilot',
    years_loaded: [2026],
    loaded_rows: 47,
    known_api_totals: {
      providers_total_reported_by_api: 126_412,
      contracts_total_reported_by_api: 654_167,
    },
    limitations: [
      'Carga piloto controlada, no universo completo',
      'Solo proveedores con contratos leídos en el rango aplicado (2 páginas x 100 contratos)',
      'DGCP es señal procurement B2G, no fuente legal ni tributaria',
      'RNC proviene de join RPE -> /proveedores DGCP API',
      'CIIU no disponible en DGCP — no se inventa',
      'No es fuente fiscal ni registro legal de empresas',
    ],
  },
  coverage_notes: {
    is_procurement_signal_only: true,
    is_fiscal_source: false,
    ciiu_status: 'unavailable_not_invented',
    complete_snapshot: false,
    connection_mode: 'not_connected',
    ai_flow_status: 'eligible_not_connected',
    snapshot_source: 'rd_2e_controlled_load',
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
    const msg = typeof error === 'object' && error !== null && 'message' in error
      ? (error as { message: string }).message
      : String(error);
    throw new Error(`upsert_failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Operational values — RepúblicaDominicana.2G bulk load (2026-07-02)
// ---------------------------------------------------------------------------

async function buildFromDbCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<Record<string, unknown>> {
  // HEAD count (no data transfer — only the count header)
  const { count, error: countErr } = await admin
    .from('source_company_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('source_key', 'do_dgcp')
    .eq('country_code', 'DO');

  if (countErr) {
    throw new Error(`Count query failed: ${countErr.message}`);
  }

  const loadedRows: number = typeof count === 'number' ? count : 0;

  // Years known from the RD.2G ETL run (2020-2026 filter applied)
  // PostgREST does not support DISTINCT — use ETL-known values
  const yearsLoaded = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

  return {
    source_key: 'do_dgcp',
    country_code: 'DO',
    coverage_kind: 'procurement_signal_snapshot',
    entity_label: 'proveedores B2G',
    // partial_snapshot: 2020-2026 loaded, pre-2020 historical data excluded
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
    refresh_source: 'rd_2g_bulk_load',
    coverage_breakdown: {
      source_type: 'procurement_signal',
      load_type: 'bulk_xlsx',
      load_mode: 'bulk_proveedores_contratos_xlsx_join',
      years_loaded: yearsLoaded,
      loaded_rows: loadedRows,
      known_api_totals: {
        providers_total_xlsx: 135_977,
        contracts_total_xlsx: 696_019,
        contracts_in_range_2020_2026: 513_824,
        snapshots_built: 53_973,
        skipped_invalid_rnc: 15_181,
      },
      limitations: [
        'Carga parcial: años 2020-2026 (histórico pre-2020 excluido)',
        '15.181 combinaciones RPE/año descartadas por RNC no dominicano (empresas extranjeras sin RNC de 9 dígitos)',
        'DGCP es señal procurement B2G, no fuente legal ni tributaria',
        'RNC proviene de campo NUMERO_DOCUMENTO en Proveedores.xlsx DGCP',
        'CIIU no disponible en DGCP — no se inventa',
        'No es fuente fiscal ni registro legal de empresas',
        'No valida RNC — esa responsabilidad es de DGII',
        'No reemplaza DGII para validación fiscal',
      ],
    },
    coverage_notes: {
      is_procurement_signal_only: true,
      is_fiscal_source: false,
      ciiu_status: 'unavailable_not_invented',
      complete_snapshot: false,
      connection_mode: 'not_connected',
      ai_flow_status: 'eligible_not_connected',
      snapshot_source: 'rd_2g_bulk_load',
      years_covered: yearsLoaded,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromKnown = args.includes('--from-known-values');
  const fromDbCount = args.includes('--from-db-count');

  if (!fromKnown && !fromDbCount) {
    console.error(
      'Usage:\n' +
      '  npx tsx scripts/rd/refresh-rd-dgcp-source-coverage-summary.ts --from-known-values\n' +
      '  npx tsx scripts/rd/refresh-rd-dgcp-source-coverage-summary.ts --from-db-count',
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createClient(url, key);

  console.log('Guardrails activos:');
  console.log('  ✓ No escribe en rd_dgii_bulk');
  console.log('  ✓ No escribe en accounts ni prospect_candidates');
  console.log('  ✓ coverage_status ≠ complete_snapshot');
  console.log('  ✓ No llama DGCP API, DGII, Tavily, LLM, SUNAT');
  console.log('');

  if (fromKnown) {
    console.log('Mode: --from-known-values (RepúblicaDominicana.2E — pilot 47 rows)');
    console.log('');
    await upsertSummary(admin, KNOWN_VALUES);
    console.log('Upserted source_coverage_summaries row:');
    console.log(`  source_key:      ${KNOWN_VALUES.source_key}`);
    console.log(`  coverage_status: ${KNOWN_VALUES.coverage_status}  ← NOT complete_snapshot`);
    console.log(`  loaded_rows:     ${KNOWN_VALUES.loaded_rows}`);
    console.log(`  refresh_source:  ${KNOWN_VALUES.refresh_source}`);
  } else {
    console.log('Mode: --from-db-count (RepúblicaDominicana.2G — bulk operational load)');
    console.log('Reading actual count from source_company_snapshots (do_dgcp)...');
    console.log('');
    const payload = await buildFromDbCount(admin);
    await upsertSummary(admin, payload);
    console.log('Upserted source_coverage_summaries row:');
    console.log(`  source_key:      do_dgcp`);
    console.log(`  coverage_status: ${String(payload.coverage_status)}  ← NOT complete_snapshot`);
    console.log(`  loaded_rows:     ${String(payload.loaded_rows)}`);
    console.log(`  refresh_source:  ${String(payload.refresh_source)}`);
    const bd = payload.coverage_breakdown as Record<string, unknown>;
    const yl = (bd?.years_loaded as number[]) ?? [];
    console.log(`  years_loaded:    ${yl.join(', ')}`);
  }

  console.log('');
  console.log('Done. Coverage summary para do_dgcp actualizado.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('refresh-rd-dgcp-source-coverage-summary failed:', msg);
  process.exit(1);
});
