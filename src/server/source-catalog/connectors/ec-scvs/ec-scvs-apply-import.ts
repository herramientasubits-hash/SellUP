/**
 * EC SCVS — Apply/Import helper (production write path behind explicit approval)
 *
 * Helper PURO y testable que orquesta el import productivo de snapshots EC SCVS.
 * Es el núcleo del CLI `scripts/source-catalog/apply-ec-scvs-import.ts`; toda la
 * lógica de guardrails, gates y orden de operaciones vive aquí para poder
 * testearse con fakes/mocks, SIN tocar producción, filesystem real ni red.
 *
 * A diferencia del dry-run (`run-ec-scvs-dry-run.ts` / `ec-scvs-dry-run-summary`),
 * este camino SÍ puede ejecutar el writer con `dryRun=false`. Por eso está
 * blindado con múltiples gates explícitos:
 *
 *   1. `--source-year` DEBE ser exactamente 2026 (EC-SCVS SOURCE_YEAR 2026 APROBADO).
 *   2. `--confirm` DEBE coincidir EXACTAMENTE con la frase de confirmación.
 *   3. Ningún flag genérico de bypass (`--force`, `--yes`, `--unsafe`).
 *   4. El archivo local DEBE existir y su header DEBE ser el esperado.
 *   5. Un dry-run interno DEBE pasar (status=dry_run, errors=0, validRows>0,
 *      rejectedRows=0, duplicate_record_identity_key=0) ANTES de crear cliente.
 *   6. El cliente Supabase admin se crea SOLO después de pasar todos los gates.
 *   7. El writer se invoca con `dryRun=false` únicamente tras el gate.
 *
 * Seguridad de salida: el reporte expone SOLO conteos y etiquetas de categoría.
 * Nunca imprime RUC completo, nombres, payload de fila, URL ni secrets.
 *
 * Fuera de scope: reader runtime, coverage/signals, integración con prospección,
 * migraciones, DDL, SQL manual, deletes/truncate, constraints, old tax unique.
 *
 * Hito: EC-SCVS-6C — Production apply/import CLI behind explicit approval.
 */

import {
  buildEcScvsSnapshotRows,
  EC_SCVS_SOURCE_KEY,
  EC_SCVS_COUNTRY_CODE,
} from './ec-scvs-snapshot-builder';
import type { EcScvsSnapshotBuildResult } from './ec-scvs-snapshot-builder';
import type {
  EcScvsSnapshotImportInput,
  EcScvsSnapshotImportResult,
  EcScvsSupabaseAdminLike,
} from './ec-scvs-snapshot-writer';
import type { EcScvsCsvReadResult } from './ec-scvs-csv-reader';
import { EC_SCVS_EXPECTED_COLUMNS } from './ec-scvs-types';

// ─── Constantes de guardrail ─────────────────────────────────────────────────

/**
 * Único año autorizado por la torre de control para este import.
 * "EC-SCVS SOURCE_YEAR 2026 APROBADO". No se hardcodea el CSV, pero SÍ se exige
 * que el operador pase exactamente este año — cualquier otro aborta.
 */
export const EC_SCVS_REQUIRED_SOURCE_YEAR = 2026 as const;

/** Frase de confirmación exacta exigida antes de cualquier write. */
export const EC_SCVS_APPLY_CONFIRM_PHRASE = 'EC-SCVS PRODUCTION IMPORT APROBADO' as const;

/** Header CSV esperado, en orden. Debe coincidir exactamente. */
export const EC_SCVS_EXPECTED_HEADER = EC_SCVS_EXPECTED_COLUMNS.join(',');

/**
 * Flags de bypass genéricas explícitamente prohibidas. Este CLI exige la frase
 * de confirmación específica: ningún `--force`/`--yes`/`--unsafe` la reemplaza.
 */
export const EC_SCVS_APPLY_FORBIDDEN_FLAGS = ['--force', '--yes', '--unsafe'] as const;

/** Batch size por defecto si el operador no especifica `--batch-size`. */
export const EC_SCVS_APPLY_DEFAULT_BATCH_SIZE = 500;

// ─── Args ────────────────────────────────────────────────────────────────────

export interface EcScvsApplyImportArgs {
  localFile: string;
  /** Debe ser exactamente EC_SCVS_REQUIRED_SOURCE_YEAR (2026). */
  sourceYear: number;
  /** Nombre de archivo de procedencia (obligatorio). */
  sourceFileName: string;
  /** Frase de confirmación; debe coincidir exactamente con la esperada. */
  confirm: string;
  /** Opcional; entero positivo. */
  batchSize?: number;
  sourceDownloadedAt?: string;
  importBatchId?: string;
}

/** Extrae `--flag=value` o `--flag value`; null si ausente o vacío. */
function readFlagValue(argv: string[], flag: string): string | null {
  const prefix = `${flag}=`;
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i]!;
    if (cur.startsWith(prefix)) {
      const val = cur.slice(prefix.length);
      return val === '' ? null : val;
    }
    if (cur === flag && i + 1 < argv.length) {
      const val = argv[i + 1]!;
      return val === '' ? null : val;
    }
  }
  return null;
}

/**
 * Parsea y valida los argumentos del apply/import EC SCVS.
 *
 * Orden de validación (fail-fast, antes de cualquier IO o cliente):
 *   - flags de bypass prohibidas → abort.
 *   - --local-file obligatorio.
 *   - --source-file-name obligatorio.
 *   - --source-year obligatorio y EXACTAMENTE 2026.
 *   - --confirm obligatorio y EXACTAMENTE la frase esperada.
 *   - --batch-size opcional (entero positivo).
 *
 * @throws Error con un `code:` prefijado por cada modo de fallo.
 */
export function parseEcScvsApplyImportArgs(argv: string[]): EcScvsApplyImportArgs {
  for (const forbidden of EC_SCVS_APPLY_FORBIDDEN_FLAGS) {
    if (argv.some((a) => a === forbidden || a.startsWith(`${forbidden}=`))) {
      throw new Error(
        `forbidden_flag: ${forbidden} no está soportado. El apply exige la frase de ` +
          `confirmación exacta (--confirm "${EC_SCVS_APPLY_CONFIRM_PHRASE}"), ` +
          'nunca un bypass genérico.',
      );
    }
  }

  const localFile = readFlagValue(argv, '--local-file');
  if (!localFile) {
    throw new Error('local_file_required: --local-file=<absolute path> es obligatorio');
  }

  const sourceFileName = readFlagValue(argv, '--source-file-name');
  if (!sourceFileName) {
    throw new Error(
      'source_file_name_required: --source-file-name=<archivo.csv> es obligatorio',
    );
  }

  const rawSourceYear = readFlagValue(argv, '--source-year');
  if (rawSourceYear === null) {
    throw new Error('source_year_required: --source-year=2026 es obligatorio');
  }
  const sourceYear = Number(rawSourceYear);
  if (!Number.isInteger(sourceYear) || sourceYear !== EC_SCVS_REQUIRED_SOURCE_YEAR) {
    throw new Error(
      `source_year_must_be_2026: --source-year debe ser exactamente ` +
        `${EC_SCVS_REQUIRED_SOURCE_YEAR}, recibido: ${rawSourceYear}`,
    );
  }

  const confirm = readFlagValue(argv, '--confirm');
  if (confirm === null) {
    throw new Error(
      `confirmation_required: --confirm "${EC_SCVS_APPLY_CONFIRM_PHRASE}" es obligatorio ` +
        'antes de cualquier write.',
    );
  }
  if (confirm !== EC_SCVS_APPLY_CONFIRM_PHRASE) {
    throw new Error(
      'confirmation_mismatch: --confirm no coincide exactamente con la frase esperada. ' +
        'No se aceptan confirmaciones parciales.',
    );
  }

  const args: EcScvsApplyImportArgs = {
    localFile,
    sourceYear,
    sourceFileName,
    confirm,
  };

  const rawBatchSize = readFlagValue(argv, '--batch-size');
  if (rawBatchSize !== null) {
    const batchSize = Number(rawBatchSize);
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new Error(
        `invalid_batch_size: --batch-size debe ser un entero positivo, recibido: ${rawBatchSize}`,
      );
    }
    args.batchSize = batchSize;
  }

  const sourceDownloadedAt = readFlagValue(argv, '--source-downloaded-at');
  if (sourceDownloadedAt !== null) args.sourceDownloadedAt = sourceDownloadedAt;
  const importBatchId = readFlagValue(argv, '--import-batch-id');
  if (importBatchId !== null) args.importBatchId = importBatchId;

  return args;
}

// ─── Pre-apply gate ────────────────────────────────────────────────────────────

export interface EcScvsPreApplyGateResult {
  passed: boolean;
  failures: string[];
}

/**
 * Evalúa el gate pre-apply sobre el resultado de un dry-run interno.
 * Solo si TODAS las condiciones pasan se autoriza crear cliente y escribir.
 *
 * Condiciones:
 *   - status === 'dry_run' y dryRun === true (el gate corrió en dry-run real).
 *   - errors.length === 0.
 *   - validRows > 0 (hay algo que escribir).
 *   - rejectedRows === 0 (ninguna fila rechazada por el writer).
 *   - duplicate_record_identity_key === 0 (identidad de registro sin colisiones).
 */
export function evaluatePreApplyGate(
  dryRun: EcScvsSnapshotImportResult,
): EcScvsPreApplyGateResult {
  const failures: string[] = [];

  if (dryRun.status !== 'dry_run') {
    failures.push(`writer_status_not_dry_run: ${dryRun.status}`);
  }
  if (dryRun.dryRun !== true) {
    failures.push('writer_dry_run_flag_false');
  }
  if (dryRun.errors.length > 0) {
    failures.push(`dry_run_errors: ${dryRun.errors.length}`);
  }
  if (dryRun.validRows <= 0) {
    failures.push(`no_valid_rows: validRows=${dryRun.validRows}`);
  }
  if (dryRun.rejectedRows > 0) {
    failures.push(`rejected_rows_present: ${dryRun.rejectedRows}`);
  }
  const dupIdentity = dryRun.summary.rejectionBreakdown.duplicate_record_identity_key;
  if (dupIdentity > 0) {
    failures.push(`duplicate_record_identity_key: ${dupIdentity}`);
  }

  return { passed: failures.length === 0, failures };
}

// ─── Orquestador ────────────────────────────────────────────────────────────

/** Dependencias inyectables — permiten testear sin filesystem/Supabase reales. */
export interface EcScvsApplyImportDeps {
  /** Lee y valida el CSV local. */
  readCsv: (absolutePath: string) => Promise<EcScvsCsvReadResult>;
  /** Ejecuta el writer (dry-run y apply). Inyectable como fake en tests. */
  runImport: (input: EcScvsSnapshotImportInput) => Promise<EcScvsSnapshotImportResult>;
  /**
   * Factory del cliente Supabase admin. SOLO se invoca DESPUÉS de pasar el gate.
   * Nunca se llama en args/read/gate fallidos.
   */
  createSupabaseClient: () => EcScvsSupabaseAdminLike;
  /** Sink de log (opcional). Nunca debe recibir secrets ni RUC completos. */
  log?: (message: string) => void;
}

/** Reporte seguro post-apply — solo conteos y etiquetas, nunca secrets/RUC. */
export interface EcScvsApplyImportReport {
  fileName: string;
  sourceKey: typeof EC_SCVS_SOURCE_KEY;
  countryCode: typeof EC_SCVS_COUNTRY_CODE;
  sourceYear: number;

  parsedRows: number;
  malformedRows: number;

  snapshotAcceptedRows: number;
  snapshotRejectedRows: number;

  dryRunStatus: EcScvsSnapshotImportResult['status'];
  dryRunValidRows: number;
  dryRunRejectedRows: number;
  dryRunErrors: number;

  applyStatus: EcScvsSnapshotImportResult['status'];
  applyTotalRows: number;
  applyValidRows: number;
  applyUpsertedRows: number;
  applyRejectedRows: number;
  applyBatches: number;
  applyErrors: number;

  conflictTarget: string;
  clientCreated: boolean;
}

export type EcScvsApplyImportOutcome =
  | {
      ok: false;
      stage: 'read';
      code: string;
      message: string;
      clientCreated: false;
    }
  | {
      ok: false;
      stage: 'preflight_gate';
      code: 'preflight_gate_failed';
      message: string;
      dryRun: EcScvsSnapshotImportResult;
      clientCreated: false;
    }
  | {
      ok: true;
      stage: 'applied';
      dryRun: EcScvsSnapshotImportResult;
      apply: EcScvsSnapshotImportResult;
      report: EcScvsApplyImportReport;
      clientCreated: true;
    };

/**
 * Orquesta el flujo completo de apply EC SCVS con dependencias inyectadas.
 *
 * PRECONDICIÓN: `args` ya fue validado por `parseEcScvsApplyImportArgs`
 * (source_year=2026, frase de confirmación exacta, sin flags de bypass).
 *
 * Orden estricto:
 *   read CSV → validar header → build (puro) → dry-run interno → gate →
 *   [solo si gate pasa] crear cliente → apply (dryRun=false) → reporte.
 *
 * El cliente Supabase NUNCA se crea antes del gate. Si read o gate fallan,
 * `createSupabaseClient` no se invoca y `clientCreated` es false.
 */
export async function runEcScvsApplyImport(
  args: EcScvsApplyImportArgs,
  deps: EcScvsApplyImportDeps,
): Promise<EcScvsApplyImportOutcome> {
  const log = deps.log ?? (() => {});

  // ── 1. Leer CSV ────────────────────────────────────────────────────────────
  log(`[1/6] Leyendo CSV local: ${args.sourceFileName}`);
  const read = await deps.readCsv(args.localFile);
  if (!read.ok) {
    return {
      ok: false,
      stage: 'read',
      code: read.error ?? 'read_error',
      message: `No se pudo leer el CSV: ${read.error ?? 'error desconocido'}`,
      clientCreated: false,
    };
  }

  // ── 2. Validar header esperado (orden exacto) ──────────────────────────────
  const detectedHeader = read.detectedColumns.join(',');
  if (detectedHeader !== EC_SCVS_EXPECTED_HEADER) {
    return {
      ok: false,
      stage: 'read',
      code: 'unexpected_header',
      message: `Header inesperado. Esperado: ${EC_SCVS_EXPECTED_HEADER}. Detectado: ${detectedHeader}`,
      clientCreated: false,
    };
  }
  log(`[2/6] Header validado: ${detectedHeader}`);
  log(`      parsed_rows=${read.rows.length} malformed_rows=${read.malformedRowCount}`);

  // ── 3. Construir filas de snapshot (puro, en memoria) ──────────────────────
  log('[3/6] Construyendo filas de snapshot (build puro)...');
  const build: EcScvsSnapshotBuildResult = buildEcScvsSnapshotRows({
    rows: read.rows,
    sourceYear: args.sourceYear,
    sourceFileName: args.sourceFileName,
    ...(args.sourceDownloadedAt !== undefined
      ? { sourceDownloadedAt: args.sourceDownloadedAt }
      : {}),
    ...(args.importBatchId !== undefined ? { importBatchId: args.importBatchId } : {}),
  });
  log(
    `      accepted=${build.summary.acceptedRows} rejected=${build.summary.rejectedRows}`,
  );

  // ── 4. Dry-run interno (nunca crea cliente) ────────────────────────────────
  log('[4/6] Ejecutando dry-run interno (dryRun=true)...');
  const dryRunResult = await deps.runImport({ snapshotRows: build.rows, dryRun: true });

  // ── 5. Gate pre-apply ──────────────────────────────────────────────────────
  const gate = evaluatePreApplyGate(dryRunResult);
  if (!gate.passed) {
    log(`[5/6] GATE PRE-APPLY FALLÓ: ${gate.failures.join('; ')}`);
    return {
      ok: false,
      stage: 'preflight_gate',
      code: 'preflight_gate_failed',
      message: `Gate pre-apply falló: ${gate.failures.join('; ')}`,
      dryRun: dryRunResult,
      clientCreated: false,
    };
  }
  log('[5/6] Gate pre-apply OK. Autorizado crear cliente Supabase admin.');

  // ── 6. Crear cliente SOLO ahora, luego apply (dryRun=false) ────────────────
  const supabase = deps.createSupabaseClient();
  const batchSize = args.batchSize ?? EC_SCVS_APPLY_DEFAULT_BATCH_SIZE;
  log(`[6/6] Ejecutando apply (dryRun=false, batchSize=${batchSize})...`);
  const applyResult = await deps.runImport({
    snapshotRows: build.rows,
    dryRun: false,
    supabase,
    batchSize,
  });

  const report: EcScvsApplyImportReport = {
    fileName: args.sourceFileName,
    sourceKey: EC_SCVS_SOURCE_KEY,
    countryCode: EC_SCVS_COUNTRY_CODE,
    sourceYear: args.sourceYear,

    parsedRows: read.rows.length,
    malformedRows: read.malformedRowCount,

    snapshotAcceptedRows: build.summary.acceptedRows,
    snapshotRejectedRows: build.summary.rejectedRows,

    dryRunStatus: dryRunResult.status,
    dryRunValidRows: dryRunResult.validRows,
    dryRunRejectedRows: dryRunResult.rejectedRows,
    dryRunErrors: dryRunResult.errors.length,

    applyStatus: applyResult.status,
    applyTotalRows: applyResult.totalRows,
    applyValidRows: applyResult.validRows,
    applyUpsertedRows: applyResult.upsertedRows,
    applyRejectedRows: applyResult.rejectedRows,
    applyBatches: applyResult.batches,
    applyErrors: applyResult.errors.length,

    conflictTarget: applyResult.summary.conflictTarget,
    clientCreated: true,
  };

  return {
    ok: true,
    stage: 'applied',
    dryRun: dryRunResult,
    apply: applyResult,
    report,
    clientCreated: true,
  };
}
