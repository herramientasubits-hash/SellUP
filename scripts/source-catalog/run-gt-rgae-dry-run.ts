/**
 * GT RGAE — Dry-run ETL desde XLSX local
 *
 * Valida el pipeline completo en memoria.
 * NO escribe en Supabase. NO crea snapshots. NO modifica Source Catalog.
 * --apply está bloqueado: apply_not_supported.
 *
 * Uso:
 *   node --import tsx scripts/source-catalog/run-gt-rgae-dry-run.ts \
 *     --year 2025 \
 *     --local-file "/ABSOLUTE/PATH/TO/RGAE_2025.xlsx"
 *
 * Fuente: MINFIN Guatemala — RGAE Listado de Proveedores del Estado.
 * Semántica: government_supplier_registry.
 * Año base aprobado: 2025.
 * Auditoría: Centroamérica.7F.1 — veredicto C — CONNECTOR_DRY_RUN_REQUIRED.
 *
 * Guardrails:
 *   - NIT: solo dígitos, rango técnico 5–10 (guardrail de dataset, no validación SAT).
 *   - Solo Sociedades en v1 (ONG/Asociación excluidas).
 *   - humanReviewRequired=true en todos los candidatos.
 *   - Sin post-approval, sin matching automático, sin account creation.
 *   - Sin legal_name overwrite canónico.
 *   - Sin Cloudflare bypass.
 *
 * Hito: Centroamérica.7G.1
 */

import * as path from 'node:path';
import { parseGtRgaeArgs } from '../../src/server/source-catalog/connectors/gt-rgae/gt-rgae-dry-run-args';
import { readGtRgaeXlsx } from '../../src/server/source-catalog/connectors/gt-rgae/gt-rgae-xlsx-reader';
import { adaptRgaeRows } from '../../src/server/source-catalog/connectors/gt-rgae/gt-rgae-adapter';
import type { GtRgaeNormalizedCandidate, GtRgaeDryRunSummary } from '../../src/server/source-catalog/connectors/gt-rgae/gt-rgae-types';
import { GT_NIT_MIN_LENGTH, GT_NIT_MAX_LENGTH } from '../../src/server/source-catalog/connectors/gt-rgae/gt-rgae-types';

// ─── Invariant check ─────────────────────────────────────────────────────────

function checkInvariants(candidates: GtRgaeNormalizedCandidate[]): string[] {
  const violations: string[] = [];
  for (const c of candidates) {
    if (c.sourceType !== 'government_supplier_registry') violations.push(`sourceType violation: ${c.maskedNit}`);
    if (c.supplierType !== 'Sociedades') violations.push(`supplierType violation: ${c.maskedNit}`);
    if (!/^\d+$/.test(c.normalizedNit)) violations.push(`normalizedNit non-numeric: ${c.maskedNit}`);
    if (c.normalizedNit.length < GT_NIT_MIN_LENGTH || c.normalizedNit.length > GT_NIT_MAX_LENGTH) {
      violations.push(`normalizedNit length ${c.normalizedNit.length} out of range [${GT_NIT_MIN_LENGTH},${GT_NIT_MAX_LENGTH}]: ${c.maskedNit}`);
    }
    if (c.humanReviewRequired !== true) violations.push(`humanReviewRequired !== true: ${c.maskedNit}`);
    if (c.postApprovalEnabled !== false) violations.push(`postApprovalEnabled !== false: ${c.maskedNit}`);
    if (c.matchingAutomaticEnabled !== false) violations.push(`matchingAutomaticEnabled !== false: ${c.maskedNit}`);
    if (c.accountCreationEnabled !== false) violations.push(`accountCreationEnabled !== false: ${c.maskedNit}`);
    if (c.canonicalNameOverwriteEnabled !== false) violations.push(`canonicalNameOverwriteEnabled !== false: ${c.maskedNit}`);
    if (c.fiscalValidationStatus !== 'not_applicable') violations.push(`fiscalValidationStatus !== not_applicable: ${c.maskedNit}`);
    if (c.legalValidationStatus !== 'not_applicable') violations.push(`legalValidationStatus !== not_applicable: ${c.maskedNit}`);
  }
  return violations;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Parse args (supports both --year=2025 and --year 2025 formats)
  const rawArgv = process.argv.slice(2);
  // Normalize --year 2025 → --year=2025 style
  const normalizedArgv: string[] = [];
  for (let i = 0; i < rawArgv.length; i++) {
    const cur = rawArgv[i]!;
    if ((cur === '--year' || cur === '--local-file') && i + 1 < rawArgv.length) {
      normalizedArgv.push(`${cur}=${rawArgv[i + 1]}`);
      i++;
    } else {
      normalizedArgv.push(cur);
    }
  }

  let args: ReturnType<typeof parseGtRgaeArgs>;
  try {
    args = parseGtRgaeArgs(normalizedArgv);
  } catch (err) {
    console.error(`[error] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Reject --apply
  if (args.applyRejected) {
    console.error('[guardrail] apply_not_supported: Este script es dry-run únicamente.');
    console.error('            --apply no está implementado en el hito 7G.1.');
    process.exit(2);
  }

  const basename = path.basename(args.localFile);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(' GT RGAE — Dry-run ETL Proveedores del Estado Guatemala');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  source_key:    gt_rgae_proveedores`);
  console.log(`  country_code:  GT`);
  console.log(`  year:          ${args.year}`);
  console.log(`  file:          ${basename}`);
  console.log(`  mode:          ✓  DRY-RUN (sin escrituras DB)`);
  console.log('');
  console.log('  Guardrail semántico:');
  console.log('  RGAE no valida estado fiscal SAT, vigencia mercantil ni identidad legal.');
  console.log('  Señal: existe registro de inscripción como proveedor del Estado en el año base.');
  console.log('  humanReviewRequired=true en todos los candidatos.');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ── 1. Leer XLSX ─────────────────────────────────────────────────────────
  console.log(`[1/4] Leyendo XLSX local: ${basename}`);
  const readResult = readGtRgaeXlsx(args.localFile);

  if (!readResult.ok) {
    console.error(`[error] No se pudo leer el XLSX: ${readResult.error}`);
    if (readResult.missingColumns.length > 0) {
      console.error(`        Columnas faltantes: ${readResult.missingColumns.join(', ')}`);
    }
    process.exit(1);
  }

  console.log(`      Hoja: ${readResult.sheetName}`);
  console.log(`      Columnas detectadas: ${readResult.detectedColumns.join(', ')}`);
  console.log(`      Filas leídas: ${readResult.rows.length}`);

  // ── 2. Adapter + dedup ────────────────────────────────────────────────────
  console.log('\n[2/4] Normalizando y deduplicando...');
  const { candidates, stats } = adaptRgaeRows(readResult.rows);

  // ── 3. Invariants ─────────────────────────────────────────────────────────
  console.log('\n[3/4] Verificando invariantes...');
  const violations = checkInvariants(candidates);
  if (violations.length > 0) {
    console.error(`[INVARIANT VIOLATIONS] ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  - ${v}`);
  } else {
    console.log('      ✓ Todos los invariantes cumplen.');
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  console.log('\n[4/4] Resumen ejecutivo:\n');

  const summary: GtRgaeDryRunSummary = {
    year: args.year,
    file_name: basename,
    sheet_name: readResult.sheetName ?? '(desconocida)',

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

    invariant_violations: violations.length,

    db_writes: 0,
    snapshot_writes: 0,
    coverage_writes: 0,
  };

  // Print summary
  const rows = [
    ['year', summary.year],
    ['file_name', summary.file_name],
    ['sheet_name', summary.sheet_name],
    ['', ''],
    ['rows_read', summary.rows_read],
    ['', ''],
    ['persona_individual_rows', summary.persona_individual_rows],
    ['sociedades_rows', summary.sociedades_rows],
    ['comerciante_individual_rows', summary.comerciante_individual_rows],
    ['ong_rows', summary.ong_rows],
    ['asociacion_rows', summary.asociacion_rows],
    ['other_type_rows', summary.other_type_rows],
    ['missing_type_rows', summary.missing_type_rows],
    ['', ''],
    ['sociedades_with_valid_nit', summary.sociedades_with_valid_nit],
    ['sociedades_invalid_nit', summary.sociedades_invalid_nit],
    ['sociedades_unique_nit', summary.sociedades_unique_nit],
    ['duplicate_sociedad_rows', summary.duplicate_sociedad_rows],
    ['dedup_replacements', summary.dedup_replacements],
    ['', ''],
    ['resolution_date_invalid', summary.resolution_date_invalid],
    ['resolution_number_invalid', summary.resolution_number_invalid],
    ['', ''],
    ['economic_capacity_not_applicable', summary.economic_capacity_not_applicable],
    ['economic_capacity_direct_purchase', summary.economic_capacity_direct_purchase],
    ['economic_capacity_numeric', summary.economic_capacity_numeric],
    ['economic_capacity_unparsed', summary.economic_capacity_unparsed],
    ['', ''],
    ['supplier_name_missing', summary.supplier_name_missing],
    ['supplier_name_normalization_collisions', summary.supplier_name_normalization_collisions],
    ['', ''],
    ['normalized_candidates', summary.normalized_candidates],
    ['invariant_violations', summary.invariant_violations],
    ['', ''],
    ['db_writes', summary.db_writes],
    ['snapshot_writes', summary.snapshot_writes],
    ['coverage_writes', summary.coverage_writes],
  ];

  for (const [k, v] of rows) {
    if (k === '') { console.log(''); continue; }
    const pad = String(k).padEnd(42);
    console.log(`  ${pad} ${v}`);
  }

  // Drift check vs auditoría 7F.1
  const AUDIT_TOTAL_ROWS = 137753;
  const AUDIT_SOCIEDADES = 8854;
  const AUDIT_UNIQUE_NIT = 6316;
  const DRIFT_THRESHOLD = 0.05;

  console.log('\n─── Drift vs Auditoría 7F.1 ───────────────────────────────────────');
  const driftChecks = [
    { metric: 'rows_read', audit: AUDIT_TOTAL_ROWS, actual: summary.rows_read },
    { metric: 'sociedades_rows', audit: AUDIT_SOCIEDADES, actual: summary.sociedades_rows },
    { metric: 'sociedades_unique_nit', audit: AUDIT_UNIQUE_NIT, actual: summary.sociedades_unique_nit },
  ];

  let hasDrift = false;
  for (const d of driftChecks) {
    if (d.audit === 0) continue;
    const delta = Math.abs(d.actual - d.audit) / d.audit;
    const flag = delta > DRIFT_THRESHOLD ? ' ⚠️  DRY_RUN_AUDIT_DRIFT' : '';
    if (delta > DRIFT_THRESHOLD) hasDrift = true;
    console.log(`  ${d.metric.padEnd(30)} audit=${d.audit}  actual=${d.actual}  delta=${(delta * 100).toFixed(1)}%${flag}`);
  }

  if (hasDrift) {
    console.log('\n  ⚠️  DRY_RUN_AUDIT_DRIFT detectado. Investigar antes de proceder con snapshot.');
  } else {
    console.log('\n  ✓ Sin drift significativo (dentro del 5%).');
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  ✓ DRY-RUN completado.');
  console.log('  DB writes:      0');
  console.log('  Snapshot writes: 0');
  console.log('  Coverage writes: 0');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (violations.length > 0) {
    process.exit(3);
  }
}

main().catch((err) => {
  console.error('[error fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
