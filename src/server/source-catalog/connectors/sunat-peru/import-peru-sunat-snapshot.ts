/**
 * Perú.5B-0 / Perú.5E — Offline SUNAT Snapshot Importer (resumible por chunks)
 *
 * Worker LOCAL que carga el snapshot pre-filtrado de RUC20 a Supabase.
 *
 * GUARDRAILS — este script NUNCA debe:
 * - Descargar el padrón SUNAT desde internet
 * - Descomprimir ningún archivo ZIP
 * - Llamar endpoints de SUNAT
 * - Llamar Migo API
 * - Llamar Tavily
 * - Insertar en tablas de candidatos o batches de prospección
 * - Ejecutarse en Vercel (detecta VERCEL / NEXT_RUNTIME)
 *
 * Uso:
 *   npm run sunat:peru:import-snapshot -- --dry-run --limit 100
 *   npm run sunat:peru:import-snapshot -- --apply --limit 100
 *   npm run sunat:peru:import-snapshot -- --dry-run --offset 1000 --limit 1000
 *   npm run sunat:peru:import-snapshot -- --apply --offset 1000 --limit 1000
 *
 * --dry-run es el default; requiere --apply para escribir.
 * --apply requiere --limit (máximo 1000 en este hito).
 * --offset salta N filas válidas/parseables antes de empezar a contar el limit.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { ensureNode20WebSocketShim } from '../../../../../scripts/peru/ensure-node20-websocket-shim';

// ── Constants ──────────────────────────────────────────────────

const SNAPSHOT_TABLE = 'peru_sunat_ruc_snapshot';
const SOURCE_KEY = 'pe_sunat_bulk';
const MAX_LIMIT_THIS_MILESTONE = 1000;
const UPSERT_BATCH_SIZE = 500;
const DEFAULT_SNAPSHOT_PATH = '.tmp/sunat-peru/ruc20-filtered-snapshot.txt';

// ── Types ──────────────────────────────────────────────────────

export interface ImportConfig {
  snapshotPath: string;
  dryRun: boolean;
  apply: boolean;
  limit: number | null;
  offset: number;
}

export interface ParsedSnapshotRow {
  ruc: string;
  legal_name: string;
  taxpayer_status: string | null;
  domicile_condition: string | null;
  ubigeo: string | null;
  department: null;
  province: null;
  district: null;
  address: string | null;
  source_key: string;
  snapshot_period: string | null;
  snapshot_loaded_at: string;
  is_active: boolean;
  is_habido: boolean;
  raw_line_hash: string;
}

export interface ParseResult {
  row: ParsedSnapshotRow | null;
  error: string | null;
}

export interface ImportReport {
  offset: number;
  rowsSeen: number;
  rowsSkippedByOffset: number;
  rowsRead: number;
  rowsParsed: number;
  rowsSkipped: number;
  rowsUpserted: number;
  invalidRows: number;
  duplicateRucs: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  applied: boolean;
  limit: number | null;
}

// ── Environment guards ─────────────────────────────────────────

export function assertNotVercel(): void {
  if (process.env.VERCEL || process.env.NEXT_RUNTIME) {
    throw new Error(
      'importer_vercel_blocked: This script must not run in Vercel environment.',
    );
  }
}

// ── CLI argument parsing ───────────────────────────────────────

/**
 * Perú.9I.1 — Strict integer parsing for CLI numeric args.
 *
 * `parseInt` is dangerously lenient: it stops at the first non-digit, so
 * `parseInt("1e+06", 10) === 1` and `parseInt("1000.5", 10) === 1000`. During
 * Perú.9I, macOS `seq` emitted offsets in scientific notation (`1e+06`,
 * `1.001e+06`), and the importer silently reinterpreted them as tiny offsets,
 * re-reading rows from the start of the snapshot.
 *
 * This helper accepts ONLY plain decimal non-negative integers:
 *   - matches /^\d+$/ (no sign, no decimal point, no exponent, no whitespace)
 *   - is a safe integer (rejects values beyond Number.MAX_SAFE_INTEGER)
 *   - is >= 0 (guaranteed by the regex, asserted defensively)
 *
 * Throws a clear error otherwise. Examples rejected: "1e+06", "1.001e+06",
 * "1000.5", "abc", "-1", "".
 */
export function parseStrictNonNegativeIntegerArg(
  value: string,
  argName: string,
): number {
  const isPlainNonNegativeInteger = /^\d+$/.test(value);
  const parsed = Number(value);

  if (
    !isPlainNonNegativeInteger ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    throw new Error(
      `Invalid ${argName}: expected a plain non-negative integer, received ${JSON.stringify(value)}`,
    );
  }

  return parsed;
}

export function parseCliArgs(argv: string[]): ImportConfig {
  const args = argv.slice(2);
  const dryRun = !args.includes('--apply');
  const apply = args.includes('--apply');

  const limitIdx = args.indexOf('--limit');
  const limitRaw = limitIdx !== -1 ? args[limitIdx + 1] : undefined;
  const limit =
    limitRaw !== undefined
      ? parseStrictNonNegativeIntegerArg(limitRaw, '--limit')
      : null;

  const offsetIdx = args.indexOf('--offset');
  const offsetRaw = offsetIdx !== -1 ? args[offsetIdx + 1] : undefined;
  const offset =
    offsetRaw !== undefined
      ? parseStrictNonNegativeIntegerArg(offsetRaw, '--offset')
      : 0;

  const snapshotPathIdx = args.indexOf('--snapshot');
  const snapshotPath =
    snapshotPathIdx !== -1
      ? (args[snapshotPathIdx + 1] ?? DEFAULT_SNAPSHOT_PATH)
      : DEFAULT_SNAPSHOT_PATH;

  return { snapshotPath, dryRun, apply, limit, offset };
}

export function validateConfig(config: ImportConfig): void {
  if (config.apply && config.limit === null) {
    throw new Error(
      'config_invalid: --apply requires --limit. Example: --apply --limit 100',
    );
  }

  if (config.limit !== null && config.limit > MAX_LIMIT_THIS_MILESTONE) {
    throw new Error(
      `config_invalid: --limit ${config.limit} exceeds maximum allowed in this milestone (${MAX_LIMIT_THIS_MILESTONE}).`,
    );
  }

  if (config.limit !== null && config.limit <= 0) {
    throw new Error(`config_invalid: --limit must be a positive integer.`);
  }

  if (isNaN(config.offset)) {
    throw new Error(`config_invalid: --offset must be a non-negative integer.`);
  }

  if (config.offset < 0) {
    throw new Error(`config_invalid: --offset must be a non-negative integer.`);
  }
}

// ── Snapshot parsing ───────────────────────────────────────────

/**
 * Snapshot columns (pipe-delimited):
 * 0: RUC
 * 1: NOMBRE O RAZÓN SOCIAL
 * 2: ESTADO DEL CONTRIBUYENTE
 * 3: CONDICIÓN DE DOMICILIO
 * 4: UBIGEO
 * 5: TIPO DE VÍA
 * 6: NOMBRE DE VÍA
 * 7: CÓDIGO DE ZONA
 * 8: TIPO DE ZONA
 * 9: NÚMERO
 * 10: INTERIOR
 * 11: LOTE
 * 12: DEPARTAMENTO (address component — apartment/unit, NOT geographic dept)
 * 13: MANZANA
 * 14: KILÓMETRO
 *
 * geographic department/province/district are NOT in this snapshot.
 * They are null here; a future hito can derive them from ubigeo.
 */
export function parseSnapshotLine(
  rawLine: string,
  snapshotPeriod: string | null,
  loadedAt: string,
): ParseResult {
  const hash = createHash('sha256').update(rawLine).digest('hex');

  const cols = rawLine.split('|');

  // Need at least RUC + legal_name
  if (cols.length < 2) {
    return { row: null, error: 'insufficient_columns' };
  }

  const ruc = (cols[0] ?? '').trim();
  const legalName = (cols[1] ?? '').trim();

  if (!/^\d{11}$/.test(ruc)) {
    return { row: null, error: `invalid_ruc:${ruc}` };
  }

  if (!legalName || legalName === '-') {
    return { row: null, error: `empty_legal_name:${ruc}` };
  }

  const taxpayerStatus = sanitizeField(cols[2]);
  const domicileCondition = sanitizeField(cols[3]);
  const ubigeo = sanitizeField(cols[4]);

  // Build address from address component columns (5–14), skipping "-" placeholders
  const addressParts = cols
    .slice(5, 15)
    .map((c) => c?.trim() ?? '')
    .filter((c) => c && c !== '-' && c !== '');
  const address = addressParts.length > 0 ? addressParts.join(' ') : null;

  const isActive = taxpayerStatus
    ? taxpayerStatus.toUpperCase().includes('ACTIVO') &&
      !taxpayerStatus.toUpperCase().includes('NO ACTIVO')
    : false;

  const isHabido = domicileCondition
    ? domicileCondition.toUpperCase().includes('HABIDO') &&
      !domicileCondition.toUpperCase().includes('NO HABIDO')
    : false;

  const row: ParsedSnapshotRow = {
    ruc,
    legal_name: legalName,
    taxpayer_status: taxpayerStatus,
    domicile_condition: domicileCondition,
    ubigeo,
    department: null,
    province: null,
    district: null,
    address,
    source_key: SOURCE_KEY,
    snapshot_period: snapshotPeriod,
    snapshot_loaded_at: loadedAt,
    is_active: isActive,
    is_habido: isHabido,
    raw_line_hash: hash,
  };

  return { row, error: null };
}

function sanitizeField(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === '-') return null;
  return trimmed;
}

// ── Supabase client ────────────────────────────────────────────

export function getServiceRoleClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error(
      'supabase_service_role_not_configured: Set SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
  }

  return createClient(url, key);
}

// ── Upsert batch ───────────────────────────────────────────────

export async function upsertBatch(
  supabase: SupabaseClient<any>,
  rows: ParsedSnapshotRow[],
): Promise<{ upserted: number; error: string | null }> {
  const { error } = await supabase.from(SNAPSHOT_TABLE).upsert(rows as unknown[], {
    onConflict: 'ruc',
    ignoreDuplicates: false,
  });

  if (error) {
    return { upserted: 0, error: error.message };
  }

  return { upserted: rows.length, error: null };
}

// ── Main importer ──────────────────────────────────────────────

export async function runImporter(
  config: ImportConfig,
): Promise<ImportReport> {
  assertNotVercel();
  validateConfig(config);

  const resolvedPath = path.resolve(config.snapshotPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`snapshot_not_found: ${resolvedPath}`);
  }

  const stat = statSync(resolvedPath);
  const snapshotPeriod = stat.mtime.toISOString().slice(0, 10);
  const loadedAt = new Date().toISOString();
  const startedAt = loadedAt;

  const report: Omit<ImportReport, 'finishedAt' | 'durationMs'> = {
    offset: config.offset,
    rowsSeen: 0,
    rowsSkippedByOffset: 0,
    rowsRead: 0,
    rowsParsed: 0,
    rowsSkipped: 0,
    rowsUpserted: 0,
    invalidRows: 0,
    duplicateRucs: 0,
    startedAt,
    dryRun: config.dryRun,
    applied: config.apply,
    limit: config.limit,
  };

  const seenRucs = new Set<string>();
  let batch: ParsedSnapshotRow[] = [];
  let done = false;

  const supabase = config.apply ? getServiceRoleClient() : null;

  const rl = createInterface({
    input: createReadStream(resolvedPath, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (done) break;

    // Skip header row
    if (report.rowsRead === 0 && line.startsWith('RUC|')) {
      report.rowsRead++;
      continue;
    }

    report.rowsRead++;
    const trimmed = line.trim();
    if (!trimmed) {
      report.rowsSkipped++;
      continue;
    }

    const { row, error } = parseSnapshotLine(trimmed, snapshotPeriod, loadedAt);

    if (!row || error) {
      report.invalidRows++;
      continue;
    }

    if (seenRucs.has(row.ruc)) {
      report.duplicateRucs++;
      continue;
    }
    seenRucs.add(row.ruc);
    report.rowsSeen++;

    // Skip valid rows until offset is satisfied
    if (report.rowsSeen <= config.offset) {
      report.rowsSkippedByOffset++;
      continue;
    }

    report.rowsParsed++;

    if (config.dryRun) {
      // dry-run: count only, no writes
    } else {
      batch.push(row);

      if (batch.length >= UPSERT_BATCH_SIZE) {
        const { upserted } = await upsertBatch(supabase!, batch);
        report.rowsUpserted += upserted;
        batch = [];
      }
    }

    if (config.limit !== null && report.rowsParsed >= config.limit) {
      done = true;
    }
  }

  // Flush remaining batch
  if (!config.dryRun && batch.length > 0 && supabase) {
    const { upserted } = await upsertBatch(supabase, batch);
    report.rowsUpserted += upserted;
  }

  const finishedAt = new Date().toISOString();
  const durationMs =
    new Date(finishedAt).getTime() - new Date(startedAt).getTime();

  return { ...report, finishedAt, durationMs };
}

// ── CLI entrypoint ─────────────────────────────────────────────

async function main() {
  // CLI-only: Node < 22 has no global WebSocket, which the Supabase client
  // (realtime-js) needs at construction in --apply mode. Applied here in the
  // CLI entrypoint so it never affects app/client bundles. No-op on Node 22+.
  ensureNode20WebSocketShim();

  let config: ImportConfig;
  try {
    config = parseCliArgs(process.argv);
  } catch (err) {
    // Fail fast on malformed --offset / --limit (e.g. scientific notation)
    // BEFORE reading any snapshot rows or touching Supabase.
    console.error('[sunat:importer] FATAL:', (err as Error).message);
    process.exit(1);
  }

  const mode = config.dryRun ? 'DRY-RUN' : `APPLY (limit=${config.limit})`;
  console.log(`[sunat:importer] Mode: ${mode}`);
  console.log(`[sunat:importer] Snapshot: ${config.snapshotPath}`);
  console.log(`[sunat:importer] Offset: ${config.offset}`);

  if (config.apply) {
    console.log(
      `[sunat:importer] WARNING: Writing up to ${config.limit} rows to Supabase (skipping first ${config.offset} valid rows).`,
    );
  }

  let report: ImportReport;
  try {
    report = await runImporter(config);
  } catch (err) {
    console.error('[sunat:importer] FATAL:', (err as Error).message);
    process.exit(1);
  }

  console.log('\n[sunat:importer] ── Report ──────────────────────────');
  console.log(`  offset:              ${report.offset}`);
  console.log(`  rowsRead:            ${report.rowsRead}`);
  console.log(`  rowsSeen:            ${report.rowsSeen}`);
  console.log(`  rowsSkippedByOffset: ${report.rowsSkippedByOffset}`);
  console.log(`  rowsParsed:          ${report.rowsParsed}`);
  console.log(`  rowsSkipped:         ${report.rowsSkipped}`);
  console.log(`  invalidRows:         ${report.invalidRows}`);
  console.log(`  duplicateRucs:       ${report.duplicateRucs}`);
  console.log(`  rowsUpserted:        ${report.rowsUpserted}`);
  console.log(`  dryRun:              ${report.dryRun}`);
  console.log(`  applied:             ${report.applied}`);
  console.log(`  limit:               ${report.limit ?? 'none'}`);
  console.log(`  startedAt:           ${report.startedAt}`);
  console.log(`  finishedAt:          ${report.finishedAt}`);
  console.log(`  durationMs:          ${report.durationMs}`);

  if (report.dryRun) {
    console.log('\n[sunat:importer] Dry-run complete. No rows written.');
    console.log(
      '[sunat:importer] To write rows: --apply --limit 100',
    );
  } else {
    console.log(`\n[sunat:importer] Upserted ${report.rowsUpserted} rows.`);
  }
}

// Guard: only run CLI when this file is the entry point, not when imported as a module.
const isDirectEntry =
  process.argv[1] != null &&
  (process.argv[1].endsWith('import-peru-sunat-snapshot.ts') ||
    process.argv[1].endsWith('import-peru-sunat-snapshot.js'));

if (isDirectEntry) {
  main();
}
