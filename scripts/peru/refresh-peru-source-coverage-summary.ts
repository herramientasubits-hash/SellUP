/**
 * Perú.9M.1 — Refresh the source_coverage_summaries row for pe_sunat_bulk.
 *
 * Modes:
 *   --from-known-values : writes the verified values from hito Perú.9M directly (fast, safe)
 *   --from-live-counts  : recomputes breakdown by running read-only COUNTs on the big table (slow)
 *
 * Guardrails:
 *   - Never reads from SUNAT web, Migo API, Tavily, or any LLM
 *   - Never triggers the snapshot importer
 *   - Never inserts into candidates, accounts, or batch tables
 *   - The only write is an upsert into source_coverage_summaries
 *
 * Run:
 *   npm run refresh:peru:source-coverage-summary -- --from-known-values
 *   npm run refresh:peru:source-coverage-summary -- --from-live-counts
 */

import { ensureNode20WebSocketShim } from './ensure-node20-websocket-shim';
import { createClient } from '@supabase/supabase-js';

ensureNode20WebSocketShim();

// ---------------------------------------------------------------------------
// Audited constants for Perú.9M (verified 2026-06-30)
// ---------------------------------------------------------------------------

const KNOWN_VALUES = {
  source_key: 'pe_sunat_bulk',
  loaded_rows: 2_250_000,
  next_recommended_offset: 2_250_000,
  audited_total_rows: 2_317_298,
  audited_active_habido_rows: 851_883,
  active_habido_rows: 800_692,
  active_no_habido_rows: 17_946,
  inactive_habido_rows: 1_003_569,
  inactive_no_habido_rows: 427_793,
  coverage_status: 'partial_snapshot',
  refresh_source: 'peru_9m_verified_values',
} as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateBreakdownSum(values: typeof KNOWN_VALUES): void {
  const sum =
    values.active_habido_rows +
    values.active_no_habido_rows +
    values.inactive_habido_rows +
    values.inactive_no_habido_rows;

  if (sum !== values.loaded_rows) {
    throw new Error(
      `breakdown_sum_mismatch: ${values.active_habido_rows} + ${values.active_no_habido_rows} + ` +
      `${values.inactive_habido_rows} + ${values.inactive_no_habido_rows} = ${sum}, ` +
      `expected ${values.loaded_rows}`,
    );
  }

  console.log(
    `Breakdown sum validated: ${values.active_habido_rows} + ${values.active_no_habido_rows} + ` +
    `${values.inactive_habido_rows} + ${values.inactive_no_habido_rows} = ${sum} ✓`,
  );
}

// ---------------------------------------------------------------------------
// Live counts (read-only, from the big snapshot table)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function computeLiveCounts(admin: any): Promise<{
  active_habido_rows: number;
  active_no_habido_rows: number;
  inactive_habido_rows: number;
  inactive_no_habido_rows: number;
  loaded_rows: number;
}> {
  const SNAPSHOT_TABLE = 'peru_sunat_ruc_snapshot';

  const count = async (filters: [string, boolean][]): Promise<number> => {
    let q = admin.from(SNAPSHOT_TABLE).select('ruc', { count: 'exact', head: true });
    for (const [col, val] of filters) {
      q = q.eq(col, val);
    }
    const { count: c, error } = await q;
    if (error) throw new Error(`count_query_failed: ${error.message}`);
    return c ?? 0;
  };

  console.log('Reading live counts from Supabase (read-only)...');
  const [total, ah, anh, ih, inh] = await Promise.all([
    count([]),
    count([['is_active', true], ['is_habido', true]]),
    count([['is_active', true], ['is_habido', false]]),
    count([['is_active', false], ['is_habido', true]]),
    count([['is_active', false], ['is_habido', false]]),
  ]);

  return {
    loaded_rows: total,
    active_habido_rows: ah,
    active_no_habido_rows: anh,
    inactive_habido_rows: ih,
    inactive_no_habido_rows: inh,
  };
}

// ---------------------------------------------------------------------------
// Upsert into source_coverage_summaries
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
  const fromLive = args.includes('--from-live-counts');

  if (!fromKnown && !fromLive) {
    console.error('Usage: --from-known-values | --from-live-counts');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createClient(url, key);

  if (fromKnown) {
    console.log('Mode: --from-known-values (Perú.9M verified values)');
    validateBreakdownSum(KNOWN_VALUES);

    await upsertSummary(admin, KNOWN_VALUES);

    console.log('');
    console.log('Upserted source_coverage_summaries row:');
    console.log(`  source_key:                pe_sunat_bulk`);
    console.log(`  loaded_rows:               ${KNOWN_VALUES.loaded_rows.toLocaleString('en-US')}`);
    console.log(`  next_recommended_offset:   ${KNOWN_VALUES.next_recommended_offset.toLocaleString('en-US')}`);
    console.log(`  active_habido_rows:        ${KNOWN_VALUES.active_habido_rows.toLocaleString('en-US')}`);
    console.log(`  active_no_habido_rows:     ${KNOWN_VALUES.active_no_habido_rows.toLocaleString('en-US')}`);
    console.log(`  inactive_habido_rows:      ${KNOWN_VALUES.inactive_habido_rows.toLocaleString('en-US')}`);
    console.log(`  inactive_no_habido_rows:   ${KNOWN_VALUES.inactive_no_habido_rows.toLocaleString('en-US')}`);
    console.log(`  coverage_status:           ${KNOWN_VALUES.coverage_status}`);
    console.log(`  refresh_source:            ${KNOWN_VALUES.refresh_source}`);
    console.log('');
    console.log('Done. Card will now read from summary table instead of running COUNT(*).');
    return;
  }

  // --from-live-counts
  console.log('Mode: --from-live-counts (reads the big snapshot table, read-only)');
  const liveCounts = await computeLiveCounts(admin);

  const payload = {
    source_key: 'pe_sunat_bulk',
    ...liveCounts,
    next_recommended_offset: liveCounts.loaded_rows,
    audited_total_rows: KNOWN_VALUES.audited_total_rows,
    audited_active_habido_rows: KNOWN_VALUES.audited_active_habido_rows,
    coverage_status: 'partial_snapshot',
    refresh_source: 'from_live_counts',
  };

  // Validate breakdown sum from live counts
  const liveSum =
    liveCounts.active_habido_rows +
    liveCounts.active_no_habido_rows +
    liveCounts.inactive_habido_rows +
    liveCounts.inactive_no_habido_rows;

  if (liveSum !== liveCounts.loaded_rows) {
    throw new Error(
      `live_breakdown_mismatch: sum of buckets (${liveSum}) !== total (${liveCounts.loaded_rows}). ` +
      `This may indicate a transient COUNT inconsistency. Retry or use --from-known-values.`,
    );
  }

  console.log(`Breakdown sum validated: ${liveSum} ✓`);
  await upsertSummary(admin, payload);

  console.log('');
  console.log('Upserted source_coverage_summaries row from live counts:');
  console.log(`  loaded_rows:             ${liveCounts.loaded_rows.toLocaleString('en-US')}`);
  console.log(`  active_habido_rows:      ${liveCounts.active_habido_rows.toLocaleString('en-US')}`);
  console.log(`  active_no_habido_rows:   ${liveCounts.active_no_habido_rows.toLocaleString('en-US')}`);
  console.log(`  inactive_habido_rows:    ${liveCounts.inactive_habido_rows.toLocaleString('en-US')}`);
  console.log(`  inactive_no_habido_rows: ${liveCounts.inactive_no_habido_rows.toLocaleString('en-US')}`);
  console.log('Done.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('refresh-peru-source-coverage-summary failed:', msg);
  process.exit(1);
});
