/**
 * Backfill record_identity_key — dry-run CLI (EC4D5.H)
 *
 * Prints projected SQL for coverage / canonical-collision / invariant
 * checks on `source_company_snapshots`. NEVER connects to a database,
 * NEVER reads .env.local, NEVER creates a Supabase client, and NEVER
 * executes anything against production. Safe by default: the only
 * documented flags are read-only.
 *
 * Uso:
 *   node --import tsx scripts/source-catalog/backfill-record-identity-dry-run.ts
 *   node --import tsx scripts/source-catalog/backfill-record-identity-dry-run.ts --source-key co_siis
 *   node --import tsx scripts/source-catalog/backfill-record-identity-dry-run.ts --format json
 *
 * Explicitly rejected (fail-closed, no write path exists):
 *   --apply --write --backfill --execute-update --allow-db-read
 *
 * Hito: EC4D5.H — OPS-B backfill dry-run tooling
 */

import { parseCliArgs, formatDryRunReport } from './backfill-record-identity-dry-run-core';

function main(): void {
  const options = parseCliArgs(process.argv.slice(2));
  const report = formatDryRunReport(options);
  console.log(report);
}

try {
  main();
} catch (err) {
  console.error('[error fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
