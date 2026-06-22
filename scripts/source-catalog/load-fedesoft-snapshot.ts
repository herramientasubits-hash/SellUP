import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { runFedesoftSnapshotEtl } from '../../src/server/source-catalog/connectors/fedesoft-colombia/fedesoft-snapshot-etl';

function parseArgs(): { sourceYear: number; commit: boolean } {
  const args = process.argv.slice(2);
  let sourceYear = 2025;
  let commit = false;

  for (const arg of args) {
    if (arg.startsWith('--source-year=')) {
      const v = parseInt(arg.replace('--source-year=', ''), 10);
      if (!isNaN(v)) sourceYear = v;
    } else if (arg === '--commit') {
      commit = true;
    } else if (arg === '--dry-run') {
      commit = false;
    }
  }

  return { sourceYear, commit };
}

async function main() {
  const { sourceYear, commit } = parseArgs();

  console.log('');
  console.log('═'.repeat(60));
  console.log('  Fedesoft Snapshot Loader');
  console.log('═'.repeat(60));
  console.log(`  sourceYear:     ${sourceYear}`);
  console.log(`  dryRun:         ${!commit}`);
  if (commit) {
    console.log('  Supabase writes: enabled');
    console.log('  Requiere SUPABASE_SERVICE_ROLE_KEY');
  } else {
    console.log('  Supabase writes: disabled');
  }
  console.log('─'.repeat(60));

  const result = await runFedesoftSnapshotEtl(sourceYear, { dryRun: !commit });

  console.log('');
  console.log('  Resultado:');
  console.log(`  Listings REST:  ${result.listingsCount}`);
  console.log(`  Members table:  ${result.membersCount}`);
  console.log(`  Categories:     ${result.categoriesCount}`);
  console.log(`  Locations:      ${result.locationsCount}`);
  console.log(`  Companies built: ${result.companiesBuilt}`);
  console.log(`  Matched:        ${result.matchedDirectoryAndMemberTable}`);
  console.log(`  Directory only: ${result.directoryOnly}`);
  console.log(`  Member table only: ${result.memberTableOnly}`);
  console.log(`  With NIT:       ${result.withNit}`);
  console.log(`  Without NIT:    ${result.withoutNit}`);
  console.log(`  Inserted/Upserted: ${result.recordsUpserted}`);
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

  if (!commit && result.companiesBuilt > 0) {
    console.log('');
    console.log('  ✅ DRY RUN completado — No se escribió nada en Supabase.');
    console.log('  Para ejecutar commit real:');
    console.log(`  npm run source:fedesoft:snapshot -- --source-year=${sourceYear} --commit`);
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
