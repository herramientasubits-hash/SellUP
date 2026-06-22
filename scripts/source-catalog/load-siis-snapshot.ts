/**
 * Script de carga manual de snapshot SIIS.
 *
 * Uso:
 *   npm run source:siis:snapshot -- --year=2024 --limit=10000 --dry-run
 *   npm run source:siis:snapshot -- --year=2024 --limit=10000 --commit
 *   npm run source:siis:snapshot -- --year=2024 --file=siis_2024_10000.xlsx --dry-run
 *   npm run source:siis:snapshot -- --year=2024 --file=siis_2024_10000.xlsx --commit
 *
 * Con --file: carga desde archivo Excel local (sin depender del endpoint SIIS).
 * Sin --file: descarga remota desde endpoint SIIS (comportamiento actual).
 *
 * Requiere SUPABASE_SERVICE_ROLE_KEY en .env.local para commit real.
 * Dry-run no requiere claves de Supabase.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import fs from 'node:fs';
import path from 'node:path';

import { runSiisSnapshotEtl } from '../../src/server/source-catalog/connectors/siis-colombia/siis-snapshot-etl';

// ─── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];

// ─── CLI argument parser ─────────────────────────────────────────────────────

function parseArgs(): { year: number; limit: 1000 | 10000; commit: boolean; file?: string } {
  const args = process.argv.slice(2);
  let year = 2024;
  let limit: 1000 | 10000 = 10000;
  let commit = false;
  let file: string | undefined;

  for (const arg of args) {
    if (arg.startsWith('--year=')) {
      const v = parseInt(arg.replace('--year=', ''), 10);
      if (!isNaN(v)) year = v;
    } else if (arg.startsWith('--limit=')) {
      const v = parseInt(arg.replace('--limit=', ''), 10);
      if (v <= 1000) limit = 1000;
      else limit = 10000;
    } else if (arg === '--commit') {
      commit = true;
    } else if (arg.startsWith('--file=')) {
      file = arg.replace('--file=', '');
    }
  }

  return { year, limit, commit, file };
}

// ─── File validation ───────────────────────────────────────────────────────────

function validateFilePath(filePath: string): { resolved: string; relative: string } {
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    console.error('');
    console.error('  ✖ Error: Use remote download mode instead of --file for URLs.');
    console.error('    (Omit --file to download from the SIIS endpoint)');
    console.error('');
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), filePath);
  const ext = path.extname(resolved).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    console.error('');
    console.error(`  ✖ Error: Invalid file extension "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
    console.error('');
    process.exit(1);
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      console.error('');
      console.error(`  ✖ Error: Path is not a file: ${filePath}`);
      console.error('');
      process.exit(1);
    }
  } catch {
    console.error('');
    console.error(`  ✖ Error: File not found: ${filePath}`);
    console.error(`    Resolved: ${resolved}`);
    console.error('');
    process.exit(1);
  }

  return { resolved, relative: filePath };
}

function readExcelFile(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { year, limit, commit, file } = parseArgs();

  const sourceMode = file ? 'local_file' : 'remote_download';
  let excelBuffer: Buffer | undefined;
  let sourceFilePath: string | undefined;

  if (file) {
    const { resolved, relative } = validateFilePath(file);
    console.log('');
    console.log(`  Source mode:    local_file`);
    console.log(`  File:           ${relative}`);
    excelBuffer = readExcelFile(resolved);
    sourceFilePath = file; // relative path for metadata
  }

  console.log('');
  console.log('═'.repeat(60));
  console.log('  SIIS Snapshot Loader');
  console.log('═'.repeat(60));
  console.log(`  Año:            ${year}`);
  console.log(`  Límite:         ${limit}`);
  console.log(`  dryRun:         ${!commit}`);
  console.log(`  Source mode:    ${sourceMode}`);
  if (sourceMode === 'local_file') {
    console.log(`  File:           ${sourceFilePath}`);
  }
  if (commit) {
    console.log('  Supabase writes: enabled');
    console.log('  Requiere SUPABASE_SERVICE_ROLE_KEY');
  } else {
    console.log('  Supabase writes: disabled (No Supabase writes will be performed)');
  }
  console.log('─'.repeat(60));

  const result = await runSiisSnapshotEtl(year, limit, {
    dryRun: !commit,
    excelBuffer,
    sourceMode,
    sourceFilePath,
  });

  console.log('');
  console.log('  Resultado:');
  console.log(`  OK:             ${result.ok}`);
  console.log(`  Año:            ${result.year}`);
  console.log(`  Descargados:    ${result.recordsFound} filas (desde Excel)`);
  console.log(`  Válidos:        ${result.recordsFound}`);
  console.log(`  Omitidos:       ${result.recordsFound > 0 ? result.recordsFound - result.recordsUpserted : 0}`);
  console.log(`  Insertados:     ${result.recordsUpserted}`);
  console.log(`  Run ID:         ${result.runId ?? '(N/A — dry run)'}`);

  if (result.warnings.length > 0) {
    console.log('');
    console.log('  Advertencias:');
    result.warnings.forEach((w) => console.log(`  ⚠  ${w}`));
  }

  if (result.errors.length > 0) {
    console.log('');
    console.log('  Errores:');
    result.errors.forEach((e) => console.log(`  ✖  ${e}`));
  }

  console.log('─'.repeat(60));

  if (!commit && result.recordsFound > 0) {
    console.log('');
    console.log('  ✅ DRY RUN completado — No se escribió nada en Supabase.');
    console.log('  Para ejecutar commit real:');
    const extra = sourceMode === 'local_file' ? ` --file=${sourceFilePath}` : '';
    console.log(`  npm run source:siis:snapshot -- --year=${year} --limit=${limit}${extra} --commit`);
  }

  if (commit && result.ok && result.recordsUpserted > 0) {
    console.log('');
    console.log(`  ✅ COMMIT completado. ${result.recordsUpserted} registros insertados/actualizados.`);
  }

  console.log('═'.repeat(60));
  console.log('');

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
