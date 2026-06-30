/**
 * CLI — ChileCompra OCDS Snapshot ETL
 *
 * Ejecuta el ETL offline que lee licitaciones OCDS y agrega proveedores
 * adjudicados en source_company_snapshots.
 *
 * Usage (dry-run pequeño):
 *   npx tsx scripts/agent1/import-chilecompra-ocds-snapshot.ts --year=2026 --months=6 --max-processes-per-month=25 --dry-run=true
 *
 * Usage (año completo write):
 *   npx tsx scripts/agent1/import-chilecompra-ocds-snapshot.ts --year=2026 --dry-run=false
 *
 * Usage (write parcial explícito):
 *   npx tsx scripts/agent1/import-chilecompra-ocds-snapshot.ts --year=2026 --months=6 --dry-run=false --allow-partial-write=true
 *
 * Defaults seguros:
 *   --dry-run=true
 *   --allow-partial-write=false
 *   --months=1..12
 *   --offset=0
 */

import { runChileCompraOcdsSnapshotEtl } from '../../src/server/source-catalog/connectors/chilecompra-ocds/run-chilecompra-ocds-snapshot-etl';

// ─── Arg parsing ───────────────────────────────────────────────────────────────

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function parseMonths(raw: string): number[] {
  // Soporta "6" (un mes), "1,2,3" (lista), "1..12" (rango)
  if (raw.includes('..')) {
    const [startStr, endStr] = raw.split('..');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end) || start < 1 || end > 12 || start > end) {
      console.error(`[import-chilecompra-ocds] ERROR: invalid --months range: ${raw}`);
      process.exit(1);
    }
    const result: number[] = [];
    for (let m = start; m <= end; m++) result.push(m);
    return result;
  }
  if (raw.includes(',')) {
    return raw.split(',').map((s) => {
      const n = parseInt(s.trim(), 10);
      if (isNaN(n) || n < 1 || n > 12) {
        console.error(`[import-chilecompra-ocds] ERROR: invalid month value: ${s}`);
        process.exit(1);
      }
      return n;
    });
  }
  const single = parseInt(raw, 10);
  if (isNaN(single) || single < 1 || single > 12) {
    console.error(`[import-chilecompra-ocds] ERROR: invalid --months value: ${raw}`);
    process.exit(1);
  }
  return [single];
}

function parseBool(raw: string | null, defaultVal: boolean): boolean {
  if (raw === null) return defaultVal;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  console.error(`[import-chilecompra-ocds] ERROR: invalid boolean value: ${raw}`);
  process.exit(1);
}

function parsePositiveInt(name: string, raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 0) {
    console.error(`[import-chilecompra-ocds] ERROR: --${name} must be a non-negative integer`);
    process.exit(1);
  }
  return n;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const yearRaw = getArg('year');
  if (!yearRaw) {
    console.error('[import-chilecompra-ocds] ERROR: --year is required');
    process.exit(1);
  }
  const year = parseInt(yearRaw, 10);
  if (isNaN(year) || year < 2000 || year > 2100) {
    console.error(`[import-chilecompra-ocds] ERROR: invalid --year: ${yearRaw}`);
    process.exit(1);
  }

  const monthsRaw = getArg('months');
  const months = monthsRaw ? parseMonths(monthsRaw) : [1,2,3,4,5,6,7,8,9,10,11,12];

  const maxProcessesPerMonth = parsePositiveInt('max-processes-per-month', getArg('max-processes-per-month'));
  const offset = parsePositiveInt('offset', getArg('offset')) ?? 0;
  const dryRun = parseBool(getArg('dry-run'), true);
  const allowPartialWrite = parseBool(getArg('allow-partial-write'), false);

  console.log('[import-chilecompra-ocds] Iniciando ETL snapshot ChileCompra OCDS');
  console.log(`  year=${year}  months=${months.join(',')}  dryRun=${dryRun}  allowPartialWrite=${allowPartialWrite}`);
  if (maxProcessesPerMonth !== undefined) {
    console.log(`  maxProcessesPerMonth=${maxProcessesPerMonth}`);
  }
  if (offset > 0) console.log(`  offset=${offset}`);
  console.log('');

  const result = await runChileCompraOcdsSnapshotEtl({
    year,
    months,
    maxProcessesPerMonth,
    offset,
    dryRun,
    allowPartialWrite,
  });

  console.log('─── Resultado ─────────────────────────────────────────────');
  console.log(`  ok:                        ${result.ok}`);
  console.log(`  dry_run:                   ${result.dry_run}`);
  console.log(`  year:                      ${result.year}`);
  console.log(`  months:                    ${result.months.join(',')}`);
  console.log(`  processes_scanned:         ${result.processes_scanned}`);
  console.log(`  details_attempted:         ${result.details_attempted}`);
  console.log(`  details_success:           ${result.details_success}`);
  console.log(`  details_failed:            ${result.details_failed}`);
  console.log(`  awarded_processes:         ${result.awarded_processes}`);
  console.log(`  suppliers_unique:          ${result.suppliers_unique}`);
  console.log(`  records_found:             ${result.records_found}`);
  console.log(`  records_upserted:          ${result.records_upserted}`);
  console.log(`  writes_performed:          ${result.writes_performed}`);
  console.log(`  processes_without_award:   ${result.processes_without_award}`);
  console.log(`  awards_without_rut:        ${result.awards_without_supplier_rut}`);
  console.log(`  awards_missing_amount:     ${result.awards_with_missing_amount}`);
  console.log(`  awards_non_clp:            ${result.awards_in_non_clp_currency}`);
  console.log(`  currencies_seen:           ${result.currencies_seen.join(', ') || '(none)'}`);
  if (result.run_id) {
    console.log(`  run_id:                    ${result.run_id}`);
  }
  if (result.warnings.length > 0) {
    console.log('');
    console.log('  Warnings:');
    result.warnings.forEach((w) => console.log(`    ⚠  ${w}`));
  }
  if (result.errors.length > 0) {
    console.log('');
    console.log('  Errors:');
    result.errors.forEach((e) => console.error(`    ✗  ${e}`));
  }
  console.log('─────────────────────────────────────────────────────────');

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[import-chilecompra-ocds] Fatal error:', err);
  process.exit(1);
});
