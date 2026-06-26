/**
 * Perú.7C — Bulk SUNAT snapshot expansion
 *
 * Expands peru_sunat_ruc_snapshot from ~50k → ~100k rows.
 * Reuses parseSnapshotLine from the existing importer.
 * No artificial 1k-row cap — this script is designed for Perú.7C bulk load.
 *
 * GUARDRAILS (inherited from existing importer):
 * - Never downloads padron_reducido_ruc.zip
 * - Never calls SUNAT, Migo, Tavily, or LinkedIn APIs
 * - Never writes to prospect_candidates or prospect_batches
 * - Never runs in Vercel environment
 * - Fully idempotent: upsert ON CONFLICT (ruc) DO NOTHING
 *
 * Usage:
 *   npm run sunat:peru:expand-7c -- --dry-run
 *   npm run sunat:peru:expand-7c -- --dry-run --offset 50000 --limit 50000
 *   npm run sunat:peru:expand-7c -- --apply --offset 50000 --limit 50000
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  parseSnapshotLine,
  type ParsedSnapshotRow,
} from '../../src/server/source-catalog/connectors/sunat-peru/import-peru-sunat-snapshot';

// ── Constants ──────────────────────────────────────────────────────────────

const SNAPSHOT_TABLE = 'peru_sunat_ruc_snapshot';
const UPSERT_BATCH_SIZE = 500;
const DEFAULT_SNAPSHOT_PATH = '.tmp/sunat-peru/ruc20-filtered-snapshot.txt';

// ── CLI args ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = !apply;

  const limitIdx = args.indexOf('--limit');
  const limitRaw = limitIdx !== -1 ? args[limitIdx + 1] : undefined;
  const limit = limitRaw !== undefined ? parseInt(limitRaw, 10) : null;

  const offsetIdx = args.indexOf('--offset');
  const offsetRaw = offsetIdx !== -1 ? args[offsetIdx + 1] : undefined;
  const offset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : 0;

  const snapshotIdx = args.indexOf('--snapshot');
  const snapshotPath =
    snapshotIdx !== -1 ? (args[snapshotIdx + 1] ?? DEFAULT_SNAPSHOT_PATH) : DEFAULT_SNAPSHOT_PATH;

  if (apply && limit === null) {
    console.error('[expand-7c] ERROR: --apply requires --limit');
    process.exit(1);
  }
  if (limit !== null && (isNaN(limit) || limit <= 0)) {
    console.error('[expand-7c] ERROR: --limit must be a positive integer');
    process.exit(1);
  }
  if (isNaN(offset) || offset < 0) {
    console.error('[expand-7c] ERROR: --offset must be a non-negative integer');
    process.exit(1);
  }

  return { apply, dryRun, limit, offset, snapshotPath };
}

// ── Supabase ───────────────────────────────────────────────────────────────

function getClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  }
  return createClient(url, key);
}

async function upsertBatch(
  supabase: ReturnType<typeof getClient>,
  rows: ParsedSnapshotRow[],
): Promise<{ upserted: number; error: string | null }> {
  const { error } = await supabase.from(SNAPSHOT_TABLE).upsert(rows as unknown[], {
    onConflict: 'ruc',
    ignoreDuplicates: true, // skip existing RUCs, insert only new ones
  });
  if (error) return { upserted: 0, error: error.message };
  return { upserted: rows.length, error: null };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (process.env.VERCEL || process.env.NEXT_RUNTIME) {
    console.error('[expand-7c] BLOCKED: must not run in Vercel environment');
    process.exit(1);
  }

  const { apply, dryRun, limit, offset, snapshotPath } = parseArgs(process.argv);

  const resolvedPath = path.resolve(snapshotPath);
  if (!existsSync(resolvedPath)) {
    console.error(`[expand-7c] FATAL: snapshot not found at ${resolvedPath}`);
    process.exit(1);
  }

  const stat = statSync(resolvedPath);
  const snapshotPeriod = stat.mtime.toISOString().slice(0, 10);
  const loadedAt = new Date().toISOString();

  const mode = dryRun ? 'DRY-RUN' : `APPLY (limit=${limit}, offset=${offset})`;
  console.log(`[expand-7c] Mode:     ${mode}`);
  console.log(`[expand-7c] Snapshot: ${resolvedPath}`);
  console.log(`[expand-7c] Offset:   ${offset} (skip first N valid parsed rows)`);
  console.log(`[expand-7c] Limit:    ${limit ?? 'none (unlimited)'}`);

  const supabase = apply ? getClient() : null;

  let rowsRead = 0;
  let rowsSeen = 0; // valid + unique parsed rows
  let rowsSkippedByOffset = 0;
  let rowsParsed = 0; // rows after offset (candidate for insert)
  let invalidRows = 0;
  let duplicateRucsInFile = 0;
  let rowsUpserted = 0;
  let upsertErrors = 0;
  const seenRucs = new Set<string>();
  let batch: ParsedSnapshotRow[] = [];
  let done = false;
  const startMs = Date.now();

  const rl = createInterface({
    input: createReadStream(resolvedPath, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (done) break;

    // Skip header
    if (rowsRead === 0 && line.startsWith('RUC|')) {
      rowsRead++;
      continue;
    }
    rowsRead++;

    const trimmed = line.trim();
    if (!trimmed) continue;

    const { row, error } = parseSnapshotLine(trimmed, snapshotPeriod, loadedAt);

    if (!row || error) {
      invalidRows++;
      continue;
    }

    if (seenRucs.has(row.ruc)) {
      duplicateRucsInFile++;
      continue;
    }
    seenRucs.add(row.ruc);
    rowsSeen++;

    // Skip until offset is satisfied
    if (rowsSeen <= offset) {
      rowsSkippedByOffset++;
      continue;
    }

    rowsParsed++;

    if (!dryRun && supabase) {
      batch.push(row);
      if (batch.length >= UPSERT_BATCH_SIZE) {
        const { upserted, error: upsertErr } = await upsertBatch(supabase, batch);
        rowsUpserted += upserted;
        if (upsertErr) {
          console.error(`[expand-7c] Upsert error: ${upsertErr}`);
          upsertErrors++;
        } else {
          process.stdout.write(`\r[expand-7c] Upserted: ${rowsUpserted}`);
        }
        batch = [];
      }
    }

    if (limit !== null && rowsParsed >= limit) {
      done = true;
    }
  }

  // Flush remainder
  if (!dryRun && supabase && batch.length > 0) {
    const { upserted, error: upsertErr } = await upsertBatch(supabase, batch);
    rowsUpserted += upserted;
    if (upsertErr) {
      console.error(`\n[expand-7c] Final batch upsert error: ${upsertErr}`);
      upsertErrors++;
    }
  }

  const durationMs = Date.now() - startMs;

  console.log('\n');
  console.log('[expand-7c] ── Report ────────────────────────────────────');
  console.log(`  rowsRead:              ${rowsRead}`);
  console.log(`  rowsSeen (valid/uniq): ${rowsSeen}`);
  console.log(`  rowsSkippedByOffset:   ${rowsSkippedByOffset}`);
  console.log(`  rowsParsed (target):   ${rowsParsed}`);
  console.log(`  invalidRows:           ${invalidRows}`);
  console.log(`  duplicateRucsInFile:   ${duplicateRucsInFile}`);
  console.log(`  rowsUpserted:          ${dryRun ? 'N/A (dry-run)' : rowsUpserted}`);
  console.log(`  upsertErrors:          ${dryRun ? 'N/A' : upsertErrors}`);
  console.log(`  durationMs:            ${durationMs}`);
  console.log(`  dryRun:                ${dryRun}`);

  if (dryRun) {
    console.log('\n[expand-7c] Dry-run complete. No rows written.');
    console.log(
      '[expand-7c] To apply: npm run sunat:peru:expand-7c -- --apply --offset 50000 --limit 50000',
    );
  } else {
    console.log(`\n[expand-7c] Done. Upserted ${rowsUpserted} rows.`);
  }
}

main().catch((err) => {
  console.error('[expand-7c] FATAL:', (err as Error).message);
  process.exit(1);
});
