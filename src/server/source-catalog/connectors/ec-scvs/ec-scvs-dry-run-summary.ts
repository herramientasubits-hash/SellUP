/**
 * EC SCVS — Dry-run writer-path summary (helper puro)
 *
 * Helper testable para el script `scripts/source-catalog/run-ec-scvs-dry-run.ts`.
 * Extiende el dry-run de profiling histórico (EC.3 / EC.3B) con una etapa de
 * WRITER-PATH que ejercita el pipeline offline completo:
 *
 *   filas crudas → buildEcScvsSnapshotRows → runEcScvsSnapshotImport(dryRun=true)
 *   → resumen local de cobertura/calidad
 *
 * NO es un writer. NO persiste. NO crea cliente Supabase. NO lee env/secrets.
 * NO descarga. NO consulta producción. NO existe modo apply/write/commit/upsert:
 * el único modo posible es dry-run (el writer subyacente permanece en su
 * default dryRun=true y este helper nunca inyecta cliente ni desactiva dry-run).
 *
 * Semántica de la fuente (ver ec-scvs-types.ts): official_company_registry.
 * Identidad: ec_scvs es NATIVE_RECORD_GRAIN → `expediente:<trim(expediente)>`.
 * El RUC nunca es identidad; solo alimenta normalized_tax_id cuando es válido.
 *
 * Seguridad de salida: este summary expone únicamente CONTEOS y etiquetas de
 * categoría (provincia / tipo / pro_codigo). Nunca expone RUC completo,
 * nombres, ni el payload de fila. Los duplicados de RUC son informativos; los
 * duplicados de record_identity_key (expediente) son bloqueantes.
 *
 * Hito: EC-SCVS-3B-R — extend Ecuador SCVS dry-run with writer-path summary.
 */

import type { EcScvsRawRow } from './ec-scvs-types';
import { buildEcScvsSnapshotRows } from './ec-scvs-snapshot-builder';
import type { EcScvsSnapshotRow } from './ec-scvs-snapshot-builder';
import { runEcScvsSnapshotImport } from './ec-scvs-snapshot-writer';
import type {
  EcScvsSnapshotImportStatus,
  EcScvsWriterRejectionReason,
} from './ec-scvs-snapshot-writer';

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Top-N por defecto para distribuciones de categoría (provincia/tipo/pro_codigo). */
export const EC_SCVS_DRY_RUN_DEFAULT_TOP_N = 10;

/**
 * Flags de escritura explícitamente prohibidas. Este script es dry-run only:
 * si aparece cualquiera de estas, el parser aborta ruidosamente en vez de
 * habilitar un camino de escritura.
 */
export const EC_SCVS_FORBIDDEN_WRITE_FLAGS = [
  '--apply',
  '--write',
  '--commit',
  '--upsert',
  '--import',
] as const;

// ─── Args ────────────────────────────────────────────────────────────────────

export interface EcScvsDryRunArgs {
  localFile: string;
  /** Año de la fuente. Obligatorio, entero positivo, nunca hardcodeado. */
  sourceYear: number;
  sourceFileName?: string;
  sourceDownloadedAt?: string;
  importBatchId?: string;
}

/** Extrae el valor de `--flag=value` o `--flag value`; null si ausente/vacío. */
function readFlagValue(argv: string[], flag: string): string | null {
  const prefix = `${flag}=`;
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i]!;
    if (cur.startsWith(prefix)) {
      const val = cur.slice(prefix.length);
      return val.trim() === '' ? null : val;
    }
    if (cur === flag && i + 1 < argv.length) {
      const val = argv[i + 1]!;
      return val.trim() === '' ? null : val;
    }
  }
  return null;
}

/**
 * Parsea y valida los argumentos del dry-run EC SCVS.
 *
 * Requisitos:
 *   - `--local-file=<absolute path>` obligatorio.
 *   - `--source-year=<YYYY>` obligatorio, entero positivo (no hardcode).
 *   - metadata opcional: `--source-file-name`, `--source-downloaded-at`,
 *     `--import-batch-id`.
 *
 * @throws Error `dry_run_only` si se pasa cualquier flag de escritura.
 * @throws Error `local_file_required` / `source_year_required` /
 *         `invalid_source_year` en validación.
 */
export function parseEcScvsDryRunArgs(argv: string[]): EcScvsDryRunArgs {
  for (const forbidden of EC_SCVS_FORBIDDEN_WRITE_FLAGS) {
    if (argv.some((a) => a === forbidden || a.startsWith(`${forbidden}=`))) {
      throw new Error(
        `dry_run_only: ${forbidden} no está soportado. Este script es dry-run only ` +
          '(no escribe en DB, no crea cliente Supabase, no ejecuta apply/write/commit/upsert/import).',
      );
    }
  }

  const localFile = readFlagValue(argv, '--local-file');
  if (!localFile) {
    throw new Error('local_file_required: --local-file=<absolute path> is required');
  }

  const rawSourceYear = readFlagValue(argv, '--source-year');
  if (rawSourceYear === null) {
    throw new Error('source_year_required: --source-year=<YYYY> is required');
  }
  const sourceYear = Number(rawSourceYear);
  if (!Number.isInteger(sourceYear) || sourceYear <= 0) {
    throw new Error(
      `invalid_source_year: --source-year debe ser un entero positivo, recibido: ${rawSourceYear}`,
    );
  }

  const args: EcScvsDryRunArgs = { localFile, sourceYear };

  const sourceFileName = readFlagValue(argv, '--source-file-name');
  if (sourceFileName !== null) args.sourceFileName = sourceFileName;
  const sourceDownloadedAt = readFlagValue(argv, '--source-downloaded-at');
  if (sourceDownloadedAt !== null) args.sourceDownloadedAt = sourceDownloadedAt;
  const importBatchId = readFlagValue(argv, '--import-batch-id');
  if (importBatchId !== null) args.importBatchId = importBatchId;

  return args;
}

// ─── Distribuciones ─────────────────────────────────────────────────────────

export interface EcScvsDryRunDistributionEntry {
  key: string;
  count: number;
}

export interface EcScvsDryRunDistribution {
  distinctValues: number;
  nullOrEmptyCount: number;
  top: EcScvsDryRunDistributionEntry[];
}

function toCategoryKey(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** Distribución top-N de una columna de categoría, con conteo de nulos/vacíos. */
function topDistribution(values: Array<string | null>, topN: number): EcScvsDryRunDistribution {
  const counts = new Map<string, number>();
  let nullOrEmptyCount = 0;

  for (const raw of values) {
    const key = toCategoryKey(raw);
    if (key === null) {
      nullOrEmptyCount++;
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([key, count]) => ({ key, count }));

  return { distinctValues: counts.size, nullOrEmptyCount, top };
}

/** Cuenta grupos con >1 fila y filas en exceso, ignorando null. Informativo. */
function countDuplicateGroups(values: Array<string | null>): {
  groups: number;
  excessRows: number;
} {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let groups = 0;
  let excessRows = 0;
  for (const c of counts.values()) {
    if (c > 1) {
      groups++;
      excessRows += c - 1;
    }
  }
  return { groups, excessRows };
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface EcScvsDryRunWriterPathSummary {
  sourceYear: number;

  // Ingesta
  totalRawRows: number;

  // Builder
  snapshotAcceptedRows: number;
  snapshotRejectedRows: number;
  rejectedMissingExpediente: number;
  rejectedDuplicateRecordIdentity: number;

  // Writer dry-run (re-valida las filas del builder; nunca escribe)
  writerStatus: EcScvsSnapshotImportStatus;
  writerDryRun: boolean;
  writerValidRows: number;
  writerRejectedRows: number;
  writerUpsertedRows: number;
  writerBatches: number;
  writerRejectionBreakdown: Record<EcScvsWriterRejectionReason, number>;

  // Calidad identidad / tax / nombre
  rowsWithValidNormalizedTaxId: number;
  rowsWithoutValidNormalizedTaxId: number;
  rowsWithLegalName: number;
  rowsWithoutLegalName: number;
  distinctRecordIdentityKeys: number;
  distinctNormalizedTaxIds: number;

  // Duplicados
  duplicateRucGroupsInformative: number;
  duplicateRucRowsExcessInformative: number;
  duplicateRecordIdentityGroupsBlocking: number;

  // Distribuciones (top N) — solo etiquetas de categoría, nunca RUC/nombre
  topN: number;
  provinceDistribution: EcScvsDryRunDistribution;
  typeDistribution: EcScvsDryRunDistribution;
  proCodigoDistribution: EcScvsDryRunDistribution;

  // Invariantes de seguridad — este hito nunca escribe ni persiste
  dbWrites: 0;
  snapshotWrites: 0;
  coveragePersisted: false;
}

export interface EcScvsDryRunSummaryInput {
  rows: EcScvsRawRow[];
  sourceYear: number;
  sourceFileName?: string;
  sourceDownloadedAt?: string;
  importBatchId?: string;
  /** Top-N para distribuciones; default EC_SCVS_DRY_RUN_DEFAULT_TOP_N. */
  topN?: number;
}

/**
 * Ejecuta el writer-path en dry-run y produce un resumen local de
 * cobertura/calidad. NO persiste nada; el coverage NO se escribe en DB.
 *
 * @throws Error si sourceYear no es entero positivo (propagado del builder).
 */
export async function summarizeEcScvsDryRunWriterPath(
  input: EcScvsDryRunSummaryInput,
): Promise<EcScvsDryRunWriterPathSummary> {
  const topN =
    input.topN !== undefined && Number.isInteger(input.topN) && input.topN > 0
      ? input.topN
      : EC_SCVS_DRY_RUN_DEFAULT_TOP_N;

  // 1. Construir filas de snapshot (puro, en memoria). Valida sourceYear.
  const build = buildEcScvsSnapshotRows({
    rows: input.rows,
    sourceYear: input.sourceYear,
    ...(input.sourceFileName !== undefined ? { sourceFileName: input.sourceFileName } : {}),
    ...(input.sourceDownloadedAt !== undefined
      ? { sourceDownloadedAt: input.sourceDownloadedAt }
      : {}),
    ...(input.importBatchId !== undefined ? { importBatchId: input.importBatchId } : {}),
  });

  // 2. Ejecutar el writer en dry-run (default). Nunca inyecta cliente Supabase,
  //    nunca desactiva dry-run → nunca toca DB.
  const importResult = await runEcScvsSnapshotImport({ snapshotRows: build.rows });

  const accepted: EcScvsSnapshotRow[] = build.rows;

  const rowsWithLegalName = accepted.filter((r) => r.legal_name !== null).length;
  const dupRuc = countDuplicateGroups(accepted.map((r) => r.normalized_tax_id));

  return {
    sourceYear: input.sourceYear,

    totalRawRows: input.rows.length,

    snapshotAcceptedRows: build.summary.acceptedRows,
    snapshotRejectedRows: build.summary.rejectedRows,
    rejectedMissingExpediente: build.summary.rejectedMissingExpediente,
    rejectedDuplicateRecordIdentity: build.summary.rejectedDuplicateRecordIdentity,

    writerStatus: importResult.status,
    writerDryRun: importResult.dryRun,
    writerValidRows: importResult.validRows,
    writerRejectedRows: importResult.rejectedRows,
    writerUpsertedRows: importResult.upsertedRows,
    writerBatches: importResult.batches,
    writerRejectionBreakdown: importResult.summary.rejectionBreakdown,

    rowsWithValidNormalizedTaxId: build.summary.rowsWithNormalizedTaxId,
    rowsWithoutValidNormalizedTaxId: build.summary.rowsWithoutTaxId,
    rowsWithLegalName,
    rowsWithoutLegalName: accepted.length - rowsWithLegalName,
    distinctRecordIdentityKeys: build.summary.distinctRecordIdentityKeys,
    distinctNormalizedTaxIds: build.summary.distinctNormalizedTaxIds,

    duplicateRucGroupsInformative: dupRuc.groups,
    duplicateRucRowsExcessInformative: dupRuc.excessRows,
    duplicateRecordIdentityGroupsBlocking: build.summary.rejectedDuplicateRecordIdentity,

    topN,
    provinceDistribution: topDistribution(
      accepted.map((r) => r.raw_data.provincia),
      topN,
    ),
    typeDistribution: topDistribution(
      accepted.map((r) => r.raw_data.tipo),
      topN,
    ),
    proCodigoDistribution: topDistribution(
      accepted.map((r) => r.raw_data.pro_codigo),
      topN,
    ),

    dbWrites: 0,
    snapshotWrites: 0,
    coveragePersisted: false,
  };
}
