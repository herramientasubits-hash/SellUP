/**
 * GT RGAE — Snapshot ETL
 *
 * Lee el XLSX de proveedores RGAE (MINFIN Guatemala) desde --local-file,
 * normaliza, deduplica, y (con --apply + confirmación) escribe snapshots
 * en source_company_snapshots y cobertura en source_coverage_summaries.
 *
 * Dry-run (default, sin --apply):
 *   - 0 writes
 *   - Valida pipeline completo en memoria
 *   - Reporta summary con drift gate
 *
 * Apply:
 *   Requiere --apply + --confirm-gt-rgae-snapshot-write + SUPABASE_SERVICE_ROLE_KEY
 *
 * Uso (dry-run):
 *   node --import tsx scripts/source-catalog/run-gt-rgae-snapshot-etl.ts \
 *     --year 2025 \
 *     --local-file "/ABSOLUTE/PATH/operaciones_registrales_2025.xlsx"
 *
 * Uso (apply — hito separado):
 *   node --env-file=.env.local --import tsx \
 *     scripts/source-catalog/run-gt-rgae-snapshot-etl.ts \
 *     --year 2025 \
 *     --local-file "/ABSOLUTE/PATH/operaciones_registrales_2025.xlsx" \
 *     --apply \
 *     --confirm-gt-rgae-snapshot-write
 *
 * Guardrails:
 *   - --local-file requerido (no auto-download, no Cloudflare)
 *   - --year requerido y solo 2025 en v1
 *   - --apply sin --confirm-gt-rgae-snapshot-write → confirmation_required (exit 1)
 *   - --apply requiere SUPABASE_SERVICE_ROLE_KEY → service_role_required
 *   - economic_capacity_unparsed > 0 → economic_capacity_unparsed_blocking (exit 1)
 *   - invariant_violations > 0 → snapshot_invariant_violation (exit 1)
 *   - candidate_count === 0 → zero_candidates (exit 1)
 *   - drift > 5% en rows_read/sociedades_rows/unique_nit → dry_run_audit_drift (exit 1)
 *
 * Semántica de la fuente:
 *   gt_rgae_proveedores no valida NIT fiscalmente ante SAT Guatemala.
 *   No valida identidad legal ante Registro Mercantil.
 *   Es señal de registro estatal: empresa proveedora del Estado guatemalteco.
 *   human_review_required=true. post_approval_enabled=false.
 *
 * Hito: Centroamérica.7G.3 — snapshot write path.
 */

import * as path from 'node:path';

import { readGtRgaeXlsx } from '../../src/server/source-catalog/connectors/gt-rgae/gt-rgae-xlsx-reader';
import { adaptRgaeRows } from '../../src/server/source-catalog/connectors/gt-rgae/gt-rgae-adapter';
import { runGtRgaeSnapshotWriter } from '../../src/server/source-catalog/connectors/gt-rgae/gt-rgae-snapshot-writer';
import { GT_NIT_MIN_LENGTH, GT_NIT_MAX_LENGTH } from '../../src/server/source-catalog/connectors/gt-rgae/gt-rgae-types';
import type { GtRgaeDryRunSummary } from '../../src/server/source-catalog/connectors/gt-rgae/gt-rgae-types';

// ─── Baseline aprobada (7G dry-run auditado) ───────────────────────────────────

const BASELINE = {
  rows_read: 137753,
  sociedades_rows: 8854,
  sociedades_unique_nit: 6245,
} as const;

const DRIFT_THRESHOLD_PERCENT = 5;

// ─── CLI args ──────────────────────────────────────────────────────────────────

export const GT_RGAE_SUPPORTED_YEARS_ETL = [2025] as const;
export type GtRgaeEtlSupportedYear = (typeof GT_RGAE_SUPPORTED_YEARS_ETL)[number];

export interface GtRgaeEtlArgs {
  year: GtRgaeEtlSupportedYear;
  localFile: string;
  apply: boolean;
  confirmGtRgaeSnapshotWrite: boolean;
}

export function parseGtRgaeEtlArgs(argv: string[]): GtRgaeEtlArgs {
  let year: number | null = null;
  let localFile: string | null = null;
  let apply = false;
  let confirmGtRgaeSnapshotWrite = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === '--year' && argv[i + 1]) {
      year = parseInt(argv[++i]!, 10);
    } else if (arg.startsWith('--year=')) {
      year = parseInt(arg.slice('--year='.length), 10);
    } else if (arg === '--local-file' && argv[i + 1]) {
      localFile = argv[++i]!.trim() || null;
    } else if (arg.startsWith('--local-file=')) {
      const val = arg.slice('--local-file='.length).trim();
      localFile = val || null;
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--confirm-gt-rgae-snapshot-write') {
      confirmGtRgaeSnapshotWrite = true;
    }
  }

  if (year === null || isNaN(year)) {
    throw new Error('year_required: --year <YYYY> es requerido');
  }

  if (!GT_RGAE_SUPPORTED_YEARS_ETL.includes(year as GtRgaeEtlSupportedYear)) {
    throw new Error(
      `unsupported_year: ${year} no soportado en v1. Soportados: ${GT_RGAE_SUPPORTED_YEARS_ETL.join(', ')}`,
    );
  }

  if (!localFile) {
    throw new Error('local_file_required: --local-file <path absoluto> es requerido');
  }

  return {
    year: year as GtRgaeEtlSupportedYear,
    localFile,
    apply,
    confirmGtRgaeSnapshotWrite,
  };
}

// ─── Guardrails apply ──────────────────────────────────────────────────────────

export type GtRgaeApplyValidation = { ok: true } | { ok: false; reason: string; code: string };

export function validateGtRgaeApplyArgs(args: GtRgaeEtlArgs): GtRgaeApplyValidation {
  if (!args.apply) return { ok: true };

  if (!args.confirmGtRgaeSnapshotWrite) {
    return {
      ok: false,
      code: 'confirmation_required',
      reason:
        '[guardrail] confirmation_required\n' +
        '  --apply requiere --confirm-gt-rgae-snapshot-write.\n' +
        '  Comando correcto:\n' +
        '    node --env-file=.env.local --import tsx \\\n' +
        '      scripts/source-catalog/run-gt-rgae-snapshot-etl.ts \\\n' +
        '      --year 2025 --local-file "<PATH>" \\\n' +
        '      --apply --confirm-gt-rgae-snapshot-write',
    };
  }

  if (!process.env['SUPABASE_SERVICE_ROLE_KEY']) {
    return {
      ok: false,
      code: 'service_role_required',
      reason:
        '[guardrail] service_role_required\n' +
        '  --apply requiere SUPABASE_SERVICE_ROLE_KEY en el entorno.\n' +
        '  Usar: node --env-file=.env.local --import tsx ...',
    };
  }

  return { ok: true };
}

// ─── Drift gate ────────────────────────────────────────────────────────────────

export type GtRgaeDriftCheck = { ok: true } | { ok: false; reason: string; drifts: string[] };

export function checkDriftVsBaseline(summary: GtRgaeDryRunSummary): GtRgaeDriftCheck {
  const drifts: string[] = [];

  const checks: Array<{ label: string; actual: number; baseline: number }> = [
    { label: 'rows_read', actual: summary.rows_read, baseline: BASELINE.rows_read },
    { label: 'sociedades_rows', actual: summary.sociedades_rows, baseline: BASELINE.sociedades_rows },
    { label: 'sociedades_unique_nit', actual: summary.sociedades_unique_nit, baseline: BASELINE.sociedades_unique_nit },
  ];

  for (const { label, actual, baseline } of checks) {
    if (baseline === 0) continue;
    const deltaPct = (Math.abs(actual - baseline) / baseline) * 100;
    if (deltaPct > DRIFT_THRESHOLD_PERCENT) {
      drifts.push(
        `${label}: actual=${actual} baseline=${baseline} delta=${deltaPct.toFixed(1)}% (max ${DRIFT_THRESHOLD_PERCENT}%)`,
      );
    }
  }

  if (drifts.length > 0) {
    return {
      ok: false,
      reason: `[guardrail] dry_run_audit_drift: El dataset difiere > ${DRIFT_THRESHOLD_PERCENT}% de la baseline auditada. Verificar fuente antes de apply.`,
      drifts,
    };
  }

  return { ok: true };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let args: GtRgaeEtlArgs;
  try {
    args = parseGtRgaeEtlArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`\n[error] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Validar flags de apply antes de cualquier IO
  const applyValidation = validateGtRgaeApplyArgs(args);
  if (!applyValidation.ok) {
    console.error('\n' + applyValidation.reason);
    process.exit(1);
  }

  // --confirm-gt-rgae-snapshot-write sin --apply: continúa como dry-run
  const dryRun = !args.apply;
  const modeLabel = dryRun
    ? 'DRY-RUN (0 writes)'
    : '⚠️  APPLY (escribe en Supabase)';

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Guatemala RGAE — Snapshot ETL 7G.3');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  source_key:    gt_rgae_proveedores`);
  console.log(`  country_code:  GT`);
  console.log(`  year:          ${args.year}`);
  console.log(`  local_file:    ${path.basename(args.localFile)}`);
  console.log(`  mode:          ${modeLabel}`);
  console.log('');
  console.log('  Guardrail: gt_rgae_proveedores no valida NIT ante SAT Guatemala.');
  console.log('  No valida identidad legal ante Registro Mercantil.');
  console.log('  human_review_required=true. post_approval_enabled=false.');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── 1. Leer XLSX ────────────────────────────────────────────────────────────
  console.log('[1/5] Leyendo XLSX local…');
  let rawRows: Awaited<ReturnType<typeof readGtRgaeXlsx>>;
  try {
    rawRows = readGtRgaeXlsx(args.localFile);
  } catch (err) {
    console.error(
      `\n[error] No se pudo leer el XLSX: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(`  Archivo: ${args.localFile}`);
    process.exit(1);
  }
  console.log(`      ${rawRows.rows.length} filas leídas de hoja: ${rawRows.sheetName}\n`);

  // ── 2. Adaptar + normalizar ─────────────────────────────────────────────────
  console.log('[2/5] Normalizando y deduplicando candidatos…');
  const { candidates, stats } = adaptRgaeRows(rawRows.rows);
  console.log(`      ${candidates.length} candidatos normalizados (Sociedades con NIT válido)\n`);

  // Construir summary compatible con GtRgaeDryRunSummary
  const dryRunSummary: GtRgaeDryRunSummary = {
    year: args.year,
    file_name: path.basename(args.localFile),
    sheet_name: rawRows.sheetName ?? '',
    rows_read: stats.totalRows,
    persona_individual_rows: stats.personaIndividual,
    sociedades_rows: stats.sociedades,
    comerciante_individual_rows: stats.comercianteIndividual,
    ong_rows: stats.ong,
    asociacion_rows: stats.asociacion,
    other_type_rows: stats.otherType,
    missing_type_rows: stats.missingType,
    sociedades_with_valid_nit: stats.sociedadesValidNit,
    sociedades_invalid_nit: stats.sociedadesInvalidNit,
    sociedades_unique_nit: stats.sociedadesUniqueNit,
    duplicate_sociedad_rows: stats.duplicateSociedadRows,
    dedup_replacements: stats.dedupReplacements,
    resolution_date_invalid: stats.resolutionDateInvalid,
    resolution_number_invalid: stats.resolutionNumberInvalid,
    economic_capacity_not_applicable: stats.economicCapacityNotApplicable,
    economic_capacity_direct_purchase: stats.economicCapacityDirectPurchase,
    economic_capacity_numeric: stats.economicCapacityNumeric,
    economic_capacity_unparsed: stats.economicCapacityUnparsed,
    supplier_name_missing: stats.supplierNameMissing,
    supplier_name_normalization_collisions: stats.supplierNameNormalizationCollisions,
    normalized_candidates: candidates.length,
    invariant_violations: 0,
    db_writes: 0,
    snapshot_writes: 0,
    coverage_writes: 0,
  };

  // ── 3. Drift gate ───────────────────────────────────────────────────────────
  console.log('[3/5] Verificando drift vs baseline auditada…');
  const driftCheck = checkDriftVsBaseline(dryRunSummary);
  if (!driftCheck.ok) {
    for (const d of driftCheck.drifts) console.log(`      ⚠ ${d}`);
    if (!dryRun) {
      console.error(`\n${driftCheck.reason}`);
      process.exit(1);
    } else {
      console.log(`      ADVERTENCIA: drift detectado (dry-run continúa, apply será bloqueado)`);
    }
  } else {
    console.log(`      OK — sin drift significativo\n`);
  }

  // ── 4. Guardrails adicionales (apply) ────────────────────────────────────────
  if (!dryRun) {
    if (stats.economicCapacityUnparsed > 0) {
      console.error(
        `\n[guardrail] economic_capacity_unparsed_blocking: ${stats.economicCapacityUnparsed} filas con CAPACIDAD_ECONOMICA no parseada. Revisar parser antes de apply.`,
      );
      process.exit(1);
    }
    if (candidates.length === 0) {
      console.error('\n[guardrail] zero_candidates: 0 candidatos normalizados. Apply abortado.');
      process.exit(1);
    }
  }

  // ── 5. Writer ────────────────────────────────────────────────────────────────
  const stepLabel = dryRun
    ? 'Preparando snapshots (dry-run, 0 writes)'
    : 'Escribiendo snapshots (apply)';
  console.log(`[4/5] ${stepLabel}…`);

  let writerResult: Awaited<ReturnType<typeof runGtRgaeSnapshotWriter>>;
  try {
    writerResult = await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun,
      dryRunSummary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n[error] Writer falló: ${msg}`);
    process.exit(1);
  }

  if (writerResult.invariantViolations > 0) {
    console.error(
      `\n[guardrail] snapshot_invariant_violation: ${writerResult.invariantViolations} violations. Ninguna fila escrita.`,
    );
    process.exit(1);
  }

  console.log(`      snapshot_rows_prepared:  ${writerResult.snapshotRowsPrepared}`);
  console.log(`      invariant_violations:     ${writerResult.invariantViolations}`);
  if (!dryRun) {
    console.log(`      rows_written:             ${writerResult.rowsWritten}`);
    console.log(`      coverage_written:         ${String(writerResult.coverageWritten)}`);
    if (writerResult.preflight) {
      console.log(`      preflight.existing_rows:  ${writerResult.preflight.existingSnapshotRows}`);
      console.log(`      preflight.coverage_found: ${String(writerResult.preflight.existingCoverageFound)}`);
    }
  }
  console.log('');

  // ── 6. Resumen ───────────────────────────────────────────────────────────────
  console.log('[5/5] Resumen\n');
  console.log('═══════════════════════════════════════════════════════════════');

  const summary = {
    rows_read:                     dryRunSummary.rows_read,
    persona_individual_rows:       dryRunSummary.persona_individual_rows,
    sociedades_rows:               dryRunSummary.sociedades_rows,
    comerciante_individual_rows:   dryRunSummary.comerciante_individual_rows,
    ong_rows:                      dryRunSummary.ong_rows,
    asociacion_rows:               dryRunSummary.asociacion_rows,
    other_type_rows:               dryRunSummary.other_type_rows,
    sociedades_with_valid_nit:     dryRunSummary.sociedades_with_valid_nit,
    sociedades_invalid_nit:        dryRunSummary.sociedades_invalid_nit,
    sociedades_unique_nit:         dryRunSummary.sociedades_unique_nit,
    duplicate_sociedad_rows:       dryRunSummary.duplicate_sociedad_rows,
    dedup_replacements:            dryRunSummary.dedup_replacements,
    economic_capacity_direct_purchase: dryRunSummary.economic_capacity_direct_purchase,
    economic_capacity_numeric:     dryRunSummary.economic_capacity_numeric,
    economic_capacity_unparsed:    dryRunSummary.economic_capacity_unparsed,
    normalized_candidates:         dryRunSummary.normalized_candidates,
    snapshot_rows_prepared:        writerResult.snapshotRowsPrepared,
    invariant_violations:          writerResult.invariantViolations,
    rows_written:                  writerResult.rowsWritten,
    coverage_written:              writerResult.coverageWritten,
    dry_run_audit_drift:           !driftCheck.ok,
  };

  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k.padEnd(40)}: ${v}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  if (dryRun) {
    console.log(' DRY-RUN completado.');
    console.log(` snapshot_rows_prepared: ${writerResult.snapshotRowsPrepared}`);
    console.log(' rows_written: 0');
    console.log(' coverage_written: false');
    console.log(' DB remota: NO TOCADA');
    if (!driftCheck.ok) {
      console.log('\n ⚠️  DRIFT DETECTADO — apply bloqueado hasta resolver.');
    } else if (stats.economicCapacityUnparsed > 0) {
      console.log('\n ⚠️  economic_capacity_unparsed > 0 — apply bloqueado en v1.');
    } else {
      console.log('\n Para apply (hito separado):');
      console.log('   node --env-file=.env.local --import tsx \\');
      console.log(`     scripts/source-catalog/run-gt-rgae-snapshot-etl.ts \\`);
      console.log(`     --year ${args.year} --local-file "${args.localFile}" \\`);
      console.log('     --apply --confirm-gt-rgae-snapshot-write');
    }
  } else {
    console.log(' APPLY completado.');
    console.log(` rows_written: ${writerResult.rowsWritten}`);
    console.log(` coverage_written: ${String(writerResult.coverageWritten)}`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// Guard: ejecutar main solo cuando este archivo es el entry point directo.
const callerFile = process.argv[1] ?? '';
if (callerFile.includes('run-gt-rgae-snapshot-etl')) {
  main().catch((err) => {
    console.error('[error fatal]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
