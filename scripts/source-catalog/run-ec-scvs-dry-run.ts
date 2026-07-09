/**
 * EC SCVS — Dry-run desde CSV local
 *
 * Valida el pipeline completo en memoria: lectura CSV → normalización RUC →
 * adapter (sin dedup) → profiling de duplicados y anomalías.
 *
 * NO escribe en Supabase. NO crea snapshots. NO crea coverage.
 * NO descarga automáticamente — requiere --local-file.
 *
 * Uso:
 *   node --import tsx scripts/source-catalog/run-ec-scvs-dry-run.ts \
 *     --local-file "/ABSOLUTE/PATH/TO/bi_compania.csv"
 *
 * Fuente: SCVS Ecuador — bi_compania.csv (appscvsmovil.supercias.gob.ec).
 * Semántica: official_company_registry (NO government_supplier_registry).
 * NO implica validación SRI ni validación legal.
 *
 * Hito: Catálogo.EC.3 — dry-run duplicate profiling.
 */

import * as path from 'node:path';
import { readEcScvsCsv } from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-csv-reader';
import { adaptEcScvsRows } from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-adapter';
import {
  profileDuplicateRucGroups,
  classifyEcScvsRucAnomaly,
} from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-duplicate-profiler';
import { normalizeEcuadorRuc } from '../../src/server/source-catalog/connectors/ec-scvs/ec-ruc-normalizer';
import type { EcScvsAnomalyClass } from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-types';

interface EcScvsDryRunArgs {
  localFile: string;
}

function parseArgs(argv: string[]): EcScvsDryRunArgs {
  let localFile: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i]!;
    if (cur === '--local-file' && i + 1 < argv.length) {
      localFile = argv[i + 1]!;
      i++;
    } else if (cur.startsWith('--local-file=')) {
      localFile = cur.slice('--local-file='.length);
    }
  }

  if (!localFile || localFile.trim() === '') {
    throw new Error('local_file_required: --local-file=<absolute path> is required');
  }

  return { localFile };
}

async function main() {
  let args: EcScvsDryRunArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[error] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  const basename = path.basename(args.localFile);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(' EC SCVS — Dry-run duplicate profiling (bi_compania.csv)');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  source_key:    ec_scvs`);
  console.log(`  country_code:  EC`);
  console.log(`  file:          ${basename}`);
  console.log(`  mode:          ✓  DRY-RUN (sin escrituras DB)`);
  console.log('');
  console.log('  Guardrail semántico:');
  console.log('  bi_compania.csv es un registro societario, NO valida SRI ni estado legal.');
  console.log('  No implica compañía activa. No implica universo completo de empresas EC.');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ── 1. Leer CSV ───────────────────────────────────────────────────────────
  console.log(`[1/4] Leyendo CSV local: ${basename}`);
  const readResult = await readEcScvsCsv(args.localFile);

  if (!readResult.ok) {
    console.error(`[error] No se pudo leer el CSV: ${readResult.error}`);
    if (readResult.missingColumns.length > 0) {
      console.error(`        Columnas faltantes: ${readResult.missingColumns.join(', ')}`);
    }
    process.exit(1);
    return;
  }

  console.log(`      Columnas detectadas: ${readResult.detectedColumns.join(', ')}`);
  console.log(`      Filas leídas: ${readResult.rows.length}`);
  console.log(`      Filas malformadas (column count mismatch): ${readResult.malformedRowCount}`);

  // ── 2. Adapter (sin dedup) ────────────────────────────────────────────────
  console.log('\n[2/4] Normalizando RUC (sin deduplicar)...');
  const { candidates, invalidCandidates, stats } = adaptEcScvsRows(readResult.rows);

  // ── 3. Anomaly profiling (raw non-numeric RUC) ───────────────────────────
  console.log('\n[3/4] Perfilando anomalías de identificador (raw non-numeric)...');
  const anomalyCounts: Record<EcScvsAnomalyClass, number> = {
    A_PUNCTUATION_ONLY_RECOVERABLE: 0,
    B_ALPHABETIC_CONTAMINATION: 0,
    C_INVALID_LENGTH_AFTER_NORMALIZATION: 0,
    D_OTHER_INVALID_FORMAT: 0,
  };

  let rawNonNumericCount = 0;
  for (const invalid of invalidCandidates) {
    if (!invalid.rawRuc) continue;
    const normResult = normalizeEcuadorRuc(invalid.rawRuc);
    if (normResult.reason !== 'alphabetic_contamination') continue;
    rawNonNumericCount++;
    const anomalyClass = classifyEcScvsRucAnomaly(invalid.rawRuc);
    anomalyCounts[anomalyClass]++;
  }

  // ── 4. Duplicate profiling ────────────────────────────────────────────────
  console.log('\n[4/4] Perfilando grupos de RUC duplicado...');
  const duplicateProfile = profileDuplicateRucGroups(candidates);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─── Resumen ejecutivo ──────────────────────────────────────────────\n');

  const summaryRows: Array<[string, string | number]> = [
    ['file_name', basename],
    ['', ''],
    ['total_source_rows', stats.totalSourceRows],
    ['missing_ruc_rows', stats.missingRucRows],
    ['invalid_ruc_rows', stats.invalidRucRows],
    ['raw_non_numeric_ruc', rawNonNumericCount],
    ['', ''],
    ['recoverable_punctuation', anomalyCounts.A_PUNCTUATION_ONLY_RECOVERABLE],
    ['alphabetic_contamination', anomalyCounts.B_ALPHABETIC_CONTAMINATION],
    ['invalid_length_after_normalization', anomalyCounts.C_INVALID_LENGTH_AFTER_NORMALIZATION],
    ['other_invalid_format', anomalyCounts.D_OTHER_INVALID_FORMAT],
    ['', ''],
    ['accepted_pre_dedup_rows', stats.acceptedPreDedupRows],
    ['distinct_normalized_ruc', stats.distinctNormalizedRuc],
    ['duplicate_ruc_groups', stats.duplicateRucGroups],
    ['duplicate_rows_excess', stats.duplicateRowsExcess],
    ['', ''],
    ['max_group_size', duplicateProfile.maxGroupSize],
    ['groups_with_2_rows', duplicateProfile.groupsWithTwoRows],
    ['groups_with_3_rows', duplicateProfile.groupsWithThreeRows],
    ['groups_with_more_than_3_rows', duplicateProfile.groupsWithMoreThanThreeRows],
  ];

  for (const [k, v] of summaryRows) {
    if (k === '') {
      console.log('');
      continue;
    }
    console.log(`  ${String(k).padEnd(38)} ${v}`);
  }

  console.log('\n─── Duplicate class breakdown (sin RUC/nombres reales) ────────────');
  console.log('  Class'.padEnd(52) + 'Groups'.padStart(8) + 'Rows'.padStart(8) + 'Excess'.padStart(8));
  for (const cls of duplicateProfile.classSummary) {
    console.log(
      `  ${cls.duplicateClass}`.padEnd(52) +
        String(cls.groups).padStart(8) +
        String(cls.rows).padStart(8) +
        String(cls.excessRows).padStart(8),
    );
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  ✓ DRY-RUN completado.');
  console.log('  DB writes:      0');
  console.log('  Snapshot writes: 0');
  console.log('  Coverage writes: 0');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('[error fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
