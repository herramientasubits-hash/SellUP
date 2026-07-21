/**
 * EC SCVS — Apply/Import CLI (production write path behind explicit approval)
 *
 * CLI productivo para importar snapshots de Ecuador SCVS (bi_compania.csv) a
 * `source_company_snapshots`. Está SEPARADO del dry-run
 * (`run-ec-scvs-dry-run.ts`), que permanece dry-run only y NO gana flags de
 * escritura por este hito.
 *
 * Este CLI SÍ puede ejecutar el writer con `dryRun=false`, por lo que está
 * blindado con guardrails explícitos implementados en el helper puro
 * `ec-scvs-apply-import.ts`:
 *
 *   - `--source-year` DEBE ser exactamente 2026 (EC-SCVS SOURCE_YEAR 2026 APROBADO).
 *   - `--confirm` DEBE coincidir EXACTAMENTE con la frase de confirmación.
 *   - Ningún flag de bypass genérico (`--force`/`--yes`/`--unsafe`).
 *   - El archivo local debe existir y su header debe ser el esperado.
 *   - Un dry-run interno debe pasar ANTES de crear el cliente Supabase admin.
 *   - El cliente admin (`createSupabaseAdminClient`) se crea SOLO tras el gate.
 *
 * El cliente admin usa el factory canónico fail-closed del repo
 * (`src/lib/supabase/admin.ts`): nunca cae a un proyecto hardcodeado, falla
 * cerrado si el entorno resuelve a producción de forma insegura. Este script
 * NO lee env values directamente, NO imprime URL/keys, NO imprime RUC completos
 * ni payloads.
 *
 * Uso (apply real — requiere autorización operativa y entorno con service role):
 *   node --env-file=.env.local --import tsx \
 *     scripts/source-catalog/apply-ec-scvs-import.ts \
 *     --local-file "/ABSOLUTE/PATH/bi_compania.csv" \
 *     --source-year 2026 \
 *     --source-file-name bi_compania.csv \
 *     --confirm "EC-SCVS PRODUCTION IMPORT APROBADO" \
 *     [--batch-size 500] \
 *     [--source-downloaded-at 2026-07-21] \
 *     [--import-batch-id <id>]
 *
 * Guardrails de seguridad (NO ejecuta):
 *   - NO ejecuta DDL, SQL manual, deletes ni truncate.
 *   - NO recrea constraints ni toca old tax unique.
 *   - NO llama proveedores ni APIs externas.
 *   - NO crea reader ni integra prospección.
 *
 * Hito: EC-SCVS-6C — Production apply/import CLI behind explicit approval.
 */

import * as path from 'node:path';

import { readEcScvsCsv } from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-csv-reader';
import { runEcScvsSnapshotImport } from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-snapshot-writer';
import {
  parseEcScvsApplyImportArgs,
  runEcScvsApplyImport,
  EC_SCVS_APPLY_CONFIRM_PHRASE,
  type EcScvsApplyImportArgs,
} from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-apply-import';
import { createSupabaseAdminClient } from '../../src/lib/supabase/admin';

function printHeader(args: EcScvsApplyImportArgs): void {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(' EC SCVS — Apply/Import (bi_compania.csv) — EC-SCVS-6C');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  source_key:    ec_scvs`);
  console.log(`  country_code:  EC`);
  console.log(`  file:          ${path.basename(args.localFile)}`);
  console.log(`  source_year:   ${args.sourceYear}`);
  console.log(`  mode:          ⚠️  APPLY (escribe en source_company_snapshots)`);
  console.log('');
  console.log('  Guardrail semántico:');
  console.log('  bi_compania.csv es un registro societario, NO valida SRI ni estado legal.');
  console.log('  Identidad de registro = expediente (NUNCA el RUC).');
  console.log('  Conflict target = RECORD_IDENTITY_ON_CONFLICT.');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

async function main(): Promise<void> {
  let args: EcScvsApplyImportArgs;
  try {
    args = parseEcScvsApplyImportArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`\n[error] ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      `\n  Recordatorio: el apply exige --source-year 2026 y ` +
        `--confirm "${EC_SCVS_APPLY_CONFIRM_PHRASE}".`,
    );
    process.exit(1);
    return;
  }

  printHeader(args);

  const outcome = await runEcScvsApplyImport(args, {
    readCsv: readEcScvsCsv,
    runImport: runEcScvsSnapshotImport,
    // El cliente admin se crea SOLO cuando el orquestador lo invoca (post-gate).
    createSupabaseClient: createSupabaseAdminClient,
    log: (message) => console.log(message),
  });

  if (!outcome.ok) {
    console.error(`\n[abort] stage=${outcome.stage} code=${outcome.code}`);
    console.error(`        ${outcome.message}`);
    console.error('\n  No se creó cliente Supabase / no se escribió en producción.');
    process.exit(1);
    return;
  }

  // ── Reporte final seguro (solo conteos, sin secrets ni RUC completos) ──────
  const r = outcome.report;
  console.log('\n─── EC-SCVS-6C — Apply summary (safe) ──────────────────────────────\n');
  const rows: Array<[string, string | number]> = [
    ['file_name', r.fileName],
    ['source_key', r.sourceKey],
    ['country_code', r.countryCode],
    ['source_year', r.sourceYear],
    ['', ''],
    ['parsed_rows', r.parsedRows],
    ['malformed_rows', r.malformedRows],
    ['snapshot_accepted_rows', r.snapshotAcceptedRows],
    ['snapshot_rejected_rows', r.snapshotRejectedRows],
    ['', ''],
    ['dry_run_status', r.dryRunStatus],
    ['dry_run_valid_rows', r.dryRunValidRows],
    ['dry_run_rejected_rows', r.dryRunRejectedRows],
    ['dry_run_errors', r.dryRunErrors],
    ['', ''],
    ['apply_status', r.applyStatus],
    ['apply_total_rows', r.applyTotalRows],
    ['apply_valid_rows', r.applyValidRows],
    ['apply_upserted_rows', r.applyUpsertedRows],
    ['apply_rejected_rows', r.applyRejectedRows],
    ['apply_batches', r.applyBatches],
    ['apply_errors', r.applyErrors],
    ['', ''],
    ['conflict_target', r.conflictTarget],
  ];
  for (const [k, v] of rows) {
    if (k === '') {
      console.log('');
      continue;
    }
    console.log(`  ${String(k).padEnd(28)} ${v}`);
  }

  console.log('\n─── Advertencias ───────────────────────────────────────────────────');
  console.log('  - ~18 filas sin RUC esperado es admisible (identidad = expediente).');
  console.log('  - duplicate RUC es informativo; nunca es identidad de registro.');

  console.log('\n─── Verificación manual sugerida (ejecutar aparte) ─────────────────');
  console.log('  - Contar filas ec_scvs source_year=2026 en source_company_snapshots.');
  console.log('  - Verificar distinct record_identity_key = filas insertadas.');
  console.log('  - Confirmar 0 filas con conflict target de grain fiscal legacy.');

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`  apply_status: ${r.applyStatus}  upserted_rows: ${r.applyUpsertedRows}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (r.applyStatus !== 'success') {
    process.exit(1);
  }
}

// Guard: ejecutar main solo cuando este archivo es el entry point directo.
const callerFile = process.argv[1] ?? '';
if (callerFile.includes('apply-ec-scvs-import')) {
  main().catch((err) => {
    console.error('[error fatal]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
