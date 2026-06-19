/**
 * Script de carga manual de snapshot SIIS.
 *
 * Uso:
 *   npm run source:siis:snapshot -- --year=2024 --limit=10000 --dry-run
 *   npm run source:siis:snapshot -- --year=2024 --limit=10000 --commit
 *
 * Requiere SUPABASE_SERVICE_ROLE_KEY en .env.local para commit real.
 * Dry-run no requiere claves de Supabase.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { runSiisSnapshotEtl } from '../../src/server/source-catalog/connectors/siis-colombia/siis-snapshot-etl';

// ─── CLI argument parser ─────────────────────────────────────────────────────

function parseArgs(): { year: number; limit: 1000 | 10000; commit: boolean } {
  const args = process.argv.slice(2);
  let year = 2024;
  let limit: 1000 | 10000 = 10000;
  let commit = false;

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
    }
  }

  return { year, limit, commit };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { year, limit, commit } = parseArgs();

  console.log('');
  console.log('═'.repeat(60));
  console.log('  SIIS Snapshot Loader');
  console.log('═'.repeat(60));
  console.log(`  Año:            ${year}`);
  console.log(`  Límite:         ${limit}`);
  console.log(`  dryRun:         ${!commit}`);
  if (commit) {
    console.log('  Supabase writes: enabled');
    console.log('  Requiere SUPABASE_SERVICE_ROLE_KEY');
  } else {
    console.log('  Supabase writes: disabled (No Supabase writes will be performed)');
  }
  console.log('─'.repeat(60));

  const result = await runSiisSnapshotEtl(year, limit, { dryRun: !commit });

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
    console.log(`  npm run source:siis:snapshot -- --year=${year} --limit=${limit} --commit`);
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
