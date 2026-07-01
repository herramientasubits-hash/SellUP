/**
 * Centroamérica.1A.3 — Upsert the source_coverage_summaries row for rd_dgii_bulk.
 *
 * Mode:
 *   --from-known-values : writes the verified values from hito Centroamérica.1A.2D
 *
 * Guardrails:
 *   - Never reads from dgii.gov.do, Tavily, any LLM, or SUNAT
 *   - Never triggers the snapshot importer
 *   - Never inserts into candidates, accounts, or batch tables
 *   - The only write is an upsert into source_coverage_summaries
 *   - Does not load additional snapshot rows
 *
 * Run:
 *   npm run refresh:rd:source-coverage-summary -- --from-known-values
 */

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Audited constants — Centroamérica.1A.2D (verified 2026-06-30)
// ---------------------------------------------------------------------------

const KNOWN_VALUES = {
  source_key: 'rd_dgii_bulk',
  loaded_rows: 493_548,
  next_recommended_offset: 0,
  audited_total_rows: 0,
  audited_active_habido_rows: 0,
  active_habido_rows: 0,
  active_no_habido_rows: 0,
  inactive_habido_rows: 0,
  inactive_no_habido_rows: 0,
  coverage_status: 'complete_snapshot',
  refresh_source: 'rd_1a2d_verified_load',
  coverage_kind: 'business_registry_snapshot',
  entity_label: 'RNC jurídicos',
  country_code: 'DO',
  out_of_scope_entities: 287_169,
  coverage_breakdown: {
    rnc_juridicos_loaded: 493_548,
    cedulas_personas_fisicas_out_of_scope: 287_169,
    invalid_identifiers: 0,
    identifier_length_11_persisted: 0,
    note: 'Solo RNC jurídicos (9 dígitos). Cédulas/personas físicas descartadas por diseño.',
  },
  coverage_notes: {
    ciiu_status: 'unavailable_for_mvp',
    sector_source: 'texto_libre_dgii',
    includes_cedulas: false,
    snapshot_source: 'centroamerica_1a2d',
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
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromKnown = args.includes('--from-known-values');

  if (!fromKnown) {
    console.error('Usage: npm run refresh:rd:source-coverage-summary -- --from-known-values');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createClient(url, key);

  console.log('Mode: --from-known-values (Centroamérica.1A.2D verified values)');
  console.log('');
  console.log('Writing to source_coverage_summaries...');

  await upsertSummary(admin, KNOWN_VALUES);

  console.log('');
  console.log('Upserted source_coverage_summaries row:');
  console.log(`  source_key:                  rd_dgii_bulk`);
  console.log(`  loaded_rows:                 ${KNOWN_VALUES.loaded_rows.toLocaleString('es-DO')} RNC jurídicos`);
  console.log(`  out_of_scope_entities:       ${KNOWN_VALUES.out_of_scope_entities.toLocaleString('es-DO')} cédulas descartadas`);
  console.log(`  coverage_status:             ${KNOWN_VALUES.coverage_status}`);
  console.log(`  coverage_kind:               ${KNOWN_VALUES.coverage_kind}`);
  console.log(`  entity_label:                ${KNOWN_VALUES.entity_label}`);
  console.log(`  country_code:                ${KNOWN_VALUES.country_code}`);
  console.log(`  refresh_source:              ${KNOWN_VALUES.refresh_source}`);
  console.log(`  identifier_length_11:        0 (cédulas excluidas por diseño)`);
  console.log(`  ciiu_status:                 unavailable_for_mvp`);
  console.log('');
  console.log('Done. Card will read from summary table on next render.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('refresh-rd-source-coverage-summary failed:', msg);
  process.exit(1);
});
