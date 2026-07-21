/**
 * EC SCVS — Dry-run desde CSV local
 *
 * Valida el pipeline completo en memoria en dos etapas:
 *   1) Profiling (EC.3 / EC.3B): lectura CSV → normalización RUC → adapter
 *      (sin dedup) → profiling de duplicados, anomalías y expediente.
 *   2) Writer-path (EC-SCVS-3B-R): buildEcScvsSnapshotRows →
 *      runEcScvsSnapshotImport(dryRun=true) → resumen local de cobertura/calidad.
 *
 * NO escribe en Supabase. NO crea snapshots. NO crea coverage (el summary es
 * SOLO en memoria, nunca persistido). NO crea cliente Supabase. NO lee
 * env/secrets. NO descarga automáticamente — requiere --local-file. NO existe
 * modo apply/write/commit/upsert/import: es dry-run only.
 *
 * Uso:
 *   node --import tsx scripts/source-catalog/run-ec-scvs-dry-run.ts \
 *     --local-file "/ABSOLUTE/PATH/TO/bi_compania.csv" \
 *     --source-year 2025 \
 *     [--source-file-name bi_compania.csv] \
 *     [--source-downloaded-at 2026-07-21] \
 *     [--import-batch-id <id>]
 *
 * Inputs:
 *   --local-file          (obligatorio) ruta absoluta al CSV bi_compania.csv.
 *   --source-year         (obligatorio) año de la fuente, entero positivo.
 *   --source-file-name    (opcional) metadata de procedencia.
 *   --source-downloaded-at(opcional) metadata de procedencia.
 *   --import-batch-id     (opcional) metadata de procedencia.
 *
 * Métricas a revisar (go/no-go antes de un import real futuro):
 *   - snapshot_accepted vs rejected (missing_expediente, duplicate identity).
 *   - writer dry-run: status=dry_run, upserts=0, batches=0.
 *   - rows con/sin normalized_tax_id válido; rows con/sin legal_name.
 *   - duplicate RUC groups (INFORMATIVO) vs duplicate record_identity_key
 *     (BLOQUEANTE): el RUC nunca es identidad.
 *   - distribución por provincia / tipo / pro_codigo (top N).
 *
 * Advertencias:
 *   - Este script NO escribe en la base de datos.
 *   - Este script NO es un import de producción.
 *   - bi_compania.csv es un registro societario; NO valida SRI ni estado legal.
 *
 * Fuente: SCVS Ecuador — bi_compania.csv (appscvsmovil.supercias.gob.ec).
 * Semántica: official_company_registry (NO government_supplier_registry).
 * NO implica validación SRI ni validación legal.
 *
 * Hito: Catálogo.EC.3 (profiling) + EC-SCVS-3B-R (writer-path dry-run summary).
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
import {
  profileExpedienteGlobal,
  profileExpedienteRucCardinality,
  profileDuplicateExpedienteGroups,
  crossReferenceRucExpedienteCollisions,
} from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-expediente-profiler';
import {
  parseEcScvsDryRunArgs,
  summarizeEcScvsDryRunWriterPath,
  type EcScvsDryRunArgs,
  type EcScvsDryRunDistribution,
} from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-dry-run-summary';

async function main() {
  let args: EcScvsDryRunArgs;
  try {
    args = parseEcScvsDryRunArgs(process.argv.slice(2));
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
  console.log(`  source_year:   ${args.sourceYear}`);
  console.log(`  mode:          ✓  DRY-RUN (sin escrituras DB, sin cliente Supabase)`);
  console.log('');
  console.log('  Guardrail semántico:');
  console.log('  bi_compania.csv es un registro societario, NO valida SRI ni estado legal.');
  console.log('  No implica compañía activa. No implica universo completo de empresas EC.');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ── 1. Leer CSV ───────────────────────────────────────────────────────────
  console.log(`[1/6] Leyendo CSV local: ${basename}`);
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
  console.log('\n[2/6] Normalizando RUC (sin deduplicar)...');
  const { candidates, invalidCandidates, stats } = adaptEcScvsRows(readResult.rows);

  // ── 3. Anomaly profiling (raw non-numeric RUC) ───────────────────────────
  console.log('\n[3/6] Perfilando anomalías de identificador (raw non-numeric)...');
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
  console.log('\n[4/6] Perfilando grupos de RUC duplicado...');
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

  // ── 5. Catálogo.EC.3B — Expediente identity profiling (experimental) ─────
  console.log('\n[5/6] Perfilando "expediente" como candidato a source-record identity...');

  const expedienteGlobal = profileExpedienteGlobal(readResult.rows);
  const expedienteCardinality = profileExpedienteRucCardinality(readResult.rows);
  const expedienteDuplicates = profileDuplicateExpedienteGroups(readResult.rows);
  const rucExpedienteCrossRef = crossReferenceRucExpedienteCollisions(candidates);

  console.log('\n─── EC.3B — Raw/trimmed expediente profile (sin exponer valores) ──\n');
  const expedienteRows: Array<[string, string | number]> = [
    ['expediente_total_rows', expedienteGlobal.totalRows],
    ['expediente_non_null', expedienteGlobal.nonNullCount],
    ['expediente_null', expedienteGlobal.nullCount],
    ['expediente_empty_after_trim', expedienteGlobal.emptyAfterTrimCount],
    ['expediente_distinct_raw', expedienteGlobal.distinctRawCount],
    ['expediente_distinct_trimmed', expedienteGlobal.distinctTrimmedCount],
    ['expediente_duplicate_raw_groups', expedienteGlobal.duplicateRawGroups],
    ['expediente_duplicate_trimmed_groups', expedienteGlobal.duplicateTrimmedGroups],
    ['expediente_duplicate_rows_excess', expedienteGlobal.duplicateRowsExcess],
    ['expediente_min_length', expedienteGlobal.minLength ?? 'n/a'],
    ['expediente_max_length', expedienteGlobal.maxLength ?? 'n/a'],
    ['expediente_numeric_only', expedienteGlobal.numericOnlyCount],
    ['expediente_alphanumeric', expedienteGlobal.alphanumericCount],
    ['expediente_punctuation', expedienteGlobal.punctuationCount],
    ['expediente_leading_zeros', expedienteGlobal.leadingZeroCount],
  ];
  for (const [k, v] of expedienteRows) {
    console.log(`  ${String(k).padEnd(38)} ${v}`);
  }

  console.log('\n─── EC.3B — Length distribution ────────────────────────────────────');
  for (const entry of expedienteGlobal.lengthDistribution) {
    console.log(`  length=${String(entry.length).padEnd(6)} count=${entry.count}`);
  }

  console.log('\n─── EC.3B — Expediente ↔ RUC cardinality ───────────────────────────\n');
  const cardinalityRows: Array<[string, string | number]> = [
    ['usable_expediente_rows', expedienteCardinality.usableExpedienteRows],
    ['rows_without_usable_expediente', expedienteCardinality.rowsWithoutUsableExpediente],
    [
      'rows_without_expediente_but_valid_ruc',
      expedienteCardinality.rowsWithoutUsableExpedienteButValidRuc,
    ],
    ['expedientes_with_zero_valid_ruc', expedienteCardinality.expedientesWithZeroValidRuc],
    ['expedientes_with_exactly_1_ruc', expedienteCardinality.expedientesWithExactlyOneRuc],
    ['expedientes_with_more_than_1_ruc', expedienteCardinality.expedientesWithMoreThanOneRuc],
    ['max_distinct_ruc_per_expediente', expedienteCardinality.maxDistinctRucPerExpediente],
    ['ruc_with_exactly_1_expediente', expedienteCardinality.rucWithExactlyOneExpediente],
    ['ruc_with_more_than_1_expediente', expedienteCardinality.rucWithMoreThanOneExpediente],
    ['max_expedientes_per_ruc', expedienteCardinality.maxExpedientesPerRuc],
    ['relationship_class', expedienteCardinality.relationshipClass],
  ];
  for (const [k, v] of cardinalityRows) {
    console.log(`  ${String(k).padEnd(38)} ${v}`);
  }

  console.log('\n─── EC.3B — Duplicate expediente groups (X1–X6) ────────────────────');
  console.log('  Class'.padEnd(40) + 'Groups'.padStart(8) + 'Rows'.padStart(8) + 'Excess'.padStart(8));
  for (const cls of expedienteDuplicates.classSummary) {
    console.log(
      `  ${cls.duplicateClass}`.padEnd(40) +
        String(cls.groups).padStart(8) +
        String(cls.rows).padStart(8) +
        String(cls.excessRows).padStart(8),
    );
  }
  console.log(
    `\n  max_group_size=${expedienteDuplicates.maxGroupSize} groups_2=${expedienteDuplicates.groupsWithTwoRows} groups_3=${expedienteDuplicates.groupsWithThreeRows} groups_gt3=${expedienteDuplicates.groupsWithMoreThanThreeRows}`,
  );

  console.log('\n─── EC.3B — Cruce EC.3 duplicate-RUC groups (C/F) ↔ expediente ─────\n');
  console.log(
    `  class_C groups=${rucExpedienteCrossRef.classC.groups} all_distinct=${rucExpedienteCrossRef.classC.groupsWithAllDistinctExpediente} shared_within_group=${rucExpedienteCrossRef.classC.groupsWithSharedExpedienteWithinGroup} reused_elsewhere=${rucExpedienteCrossRef.classC.expedienteReusedElsewhereCount}`,
  );
  console.log(
    `  class_F groups=${rucExpedienteCrossRef.classF.groups} all_distinct=${rucExpedienteCrossRef.classF.groupsWithAllDistinctExpediente} shared_within_group=${rucExpedienteCrossRef.classF.groupsWithSharedExpedienteWithinGroup} reused_elsewhere=${rucExpedienteCrossRef.classF.expedienteReusedElsewhereCount}`,
  );
  console.log(
    `\n  SCVS_EXPEDIENTE_RESOLVES_RUC_COLLISIONS=${rucExpedienteCrossRef.resolvesRucCollisions} (unresolved_groups=${rucExpedienteCrossRef.totalUnresolvedGroups}, unresolved_excess_rows=${rucExpedienteCrossRef.totalUnresolvedExcessRows})`,
  );

  // ── 6. EC-SCVS-3B-R — Writer-path dry-run summary ────────────────────────
  console.log('\n[6/6] Ejercitando writer-path en dry-run (build → import dryRun=true)...');

  const writerSummary = await summarizeEcScvsDryRunWriterPath({
    rows: readResult.rows,
    sourceYear: args.sourceYear,
    ...(args.sourceFileName !== undefined ? { sourceFileName: args.sourceFileName } : {}),
    ...(args.sourceDownloadedAt !== undefined
      ? { sourceDownloadedAt: args.sourceDownloadedAt }
      : {}),
    ...(args.importBatchId !== undefined ? { importBatchId: args.importBatchId } : {}),
  });

  console.log('\n─── EC-SCVS-3B-R — Writer-path dry-run summary ─────────────────────\n');
  const writerRows: Array<[string, string | number]> = [
    ['source_year', writerSummary.sourceYear],
    ['total_raw_rows', writerSummary.totalRawRows],
    ['', ''],
    ['snapshot_accepted_rows', writerSummary.snapshotAcceptedRows],
    ['snapshot_rejected_rows', writerSummary.snapshotRejectedRows],
    ['rejected_missing_expediente', writerSummary.rejectedMissingExpediente],
    ['rejected_duplicate_record_identity', writerSummary.rejectedDuplicateRecordIdentity],
    ['', ''],
    ['writer_status', writerSummary.writerStatus],
    ['writer_dry_run', String(writerSummary.writerDryRun)],
    ['writer_valid_rows', writerSummary.writerValidRows],
    ['writer_rejected_rows', writerSummary.writerRejectedRows],
    ['writer_upserted_rows', writerSummary.writerUpsertedRows],
    ['writer_batches', writerSummary.writerBatches],
    ['', ''],
    ['rows_with_valid_normalized_tax_id', writerSummary.rowsWithValidNormalizedTaxId],
    ['rows_without_valid_normalized_tax_id', writerSummary.rowsWithoutValidNormalizedTaxId],
    ['rows_with_legal_name', writerSummary.rowsWithLegalName],
    ['rows_without_legal_name', writerSummary.rowsWithoutLegalName],
    ['distinct_record_identity_keys', writerSummary.distinctRecordIdentityKeys],
    ['distinct_normalized_tax_ids', writerSummary.distinctNormalizedTaxIds],
    ['', ''],
    ['duplicate_ruc_groups (informativo)', writerSummary.duplicateRucGroupsInformative],
    ['duplicate_ruc_rows_excess (informativo)', writerSummary.duplicateRucRowsExcessInformative],
    [
      'duplicate_record_identity_groups (BLOQUEANTE)',
      writerSummary.duplicateRecordIdentityGroupsBlocking,
    ],
  ];
  for (const [k, v] of writerRows) {
    if (k === '') {
      console.log('');
      continue;
    }
    console.log(`  ${String(k).padEnd(46)} ${v}`);
  }

  const printDistribution = (label: string, dist: EcScvsDryRunDistribution) => {
    console.log(
      `\n  ${label} — distinct=${dist.distinctValues} null_or_empty=${dist.nullOrEmptyCount} (top ${writerSummary.topN})`,
    );
    if (dist.top.length === 0) {
      console.log('    (sin valores)');
      return;
    }
    for (const entry of dist.top) {
      console.log(`    ${entry.key.padEnd(30)} ${entry.count}`);
    }
  };

  console.log('\n─── EC-SCVS-3B-R — Distribuciones de cobertura (top N) ─────────────');
  printDistribution('provincia', writerSummary.provinceDistribution);
  printDistribution('tipo', writerSummary.typeDistribution);
  printDistribution('pro_codigo', writerSummary.proCodigoDistribution);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  ✓ DRY-RUN completado (EC.3 + EC.3B profiling + EC-SCVS-3B-R writer-path).');
  console.log(`  DB writes:       ${writerSummary.dbWrites}`);
  console.log(`  Snapshot writes: ${writerSummary.snapshotWrites}`);
  console.log(`  Coverage writes: 0  (coverage_persisted=${String(writerSummary.coveragePersisted)})`);
  console.log('  Advertencia: este script NO escribe DB y NO es un import de producción.');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('[error fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
