/**
 * EC SCVS — Snapshot Writer / Importer
 *
 * Persiste (en un hito FUTURO autorizado) filas construidas por
 * `buildEcScvsSnapshotRows` en `source_company_snapshots`, usando el grain de
 * identidad de registro nativo de Ecuador SCVS.
 *
 * Dry-run (default, dryRun: true):
 *   - Particiona y valida TODAS las filas (accepted / rejected).
 *   - NO requiere cliente Supabase.
 *   - NO llama .upsert() ni ninguna operación de red.
 *   - upsertedRows = 0, batches = 0, status = 'dry_run'.
 *
 * Apply (dryRun: false):
 *   - EXIGE un cliente Supabase inyectado. El writer NUNCA crea un cliente ni
 *     lee env/secrets: si falta el cliente en apply, lanza `supabase_client_required`.
 *     Esta es una decisión de seguridad de este hito (EC-SCVS-3): sin acceso a
 *     producción ni superficie de secrets dentro del writer.
 *   - Valida y particiona las filas antes de cualquier write.
 *   - Solo las filas aceptadas llegan al upsert (partición real, no silenciosa).
 *   - Upsert por batches en `source_company_snapshots`.
 *   - Conflict key: (source_key, country_code, source_year, record_identity_key)
 *     vía RECORD_IDENTITY_ON_CONFLICT. NUNCA el conflict target de grain
 *     fiscal legacy (source_key/country_code/source_year/normalized_tax_id).
 *
 * Failure semantics — fail-fast, sin ocultar errores:
 *   Si el batch N falla, los batches 0..N-1 pueden haber persistido. El writer
 *   DETIENE el procesamiento (no continúa silenciosamente), registra el error
 *   en `errors[]` y reporta status 'partial_failure' (hubo writes previos) o
 *   'failed' (0 writes). Re-run completo es idempotente por onConflict.
 *
 * Identidad (EC-SCVS-1 / NATIVE_RECORD_GRAIN):
 *   record_identity_key = `expediente:<trim(expediente)>`. El RUC/nombre nunca
 *   son identidad. Una fila con normalized_tax_id = null es válida si su
 *   record_identity_key es válido. NUNCA se deduplica por RUC.
 *
 * Fuera de scope de este hito: reader, coverage summary, source_company_signals,
 * integración con prospección, migraciones. Ver EC-SCVS-3B / EC-SCVS-6.
 *
 * Hito: EC-SCVS-3 — Writer/importer con RECORD_IDENTITY_ON_CONFLICT, dry-run first.
 */

import type { EcScvsSnapshotRow } from './ec-scvs-snapshot-builder';
import { EC_SCVS_SOURCE_KEY, EC_SCVS_COUNTRY_CODE } from './ec-scvs-snapshot-builder';
import { validateRecordIdentityKey, RECORD_IDENTITY_ON_CONFLICT } from '../../record-identity';

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Único conflict target admisible para este writer. */
const CONFLICT_TARGET = RECORD_IDENTITY_ON_CONFLICT;

/** Namespace obligatorio de la identidad de registro EC SCVS. */
const EXPEDIENTE_NAMESPACE = 'expediente';

/** Tamaño de batch por defecto (seguro para datasets grandes de registro). */
const DEFAULT_BATCH_SIZE = 500;

/**
 * Columnas que este writer está autorizado a persistir en
 * `source_company_snapshots`. Es un SUBCONJUNTO estricto de las columnas reales
 * de la tabla — deliberadamente NO incluye una columna `status` (la tabla no la
 * tiene) ni columnas gestionadas por la DB (`id`, `imported_at`).
 *
 * EC-SCVS-6E: el apply productivo falló con PGRST204 ("Could not find the
 * 'status' column ...") porque el payload arrastraba una key top-level
 * inexistente. El writer ahora construye el payload EXPLÍCITAMENTE desde este
 * allowlist (ver `toPersistableSnapshotPayload`): cualquier key extra en la fila
 * se descarta antes del upsert, aunque un builder futuro regrese.
 */
export const EC_SCVS_PERSISTABLE_COLUMNS = [
  'source_key',
  'country_code',
  'source_year',
  'tax_id',
  'normalized_tax_id',
  'legal_name',
  'raw_data',
  'record_identity_key',
] as const;

/** Payload persistible — exactamente las columnas permitidas, sin extras. */
export type EcScvsPersistableSnapshot = Pick<
  EcScvsSnapshotRow,
  (typeof EC_SCVS_PERSISTABLE_COLUMNS)[number]
>;

/**
 * Proyecta una fila de snapshot a SOLO las columnas persistibles permitidas.
 * Construye un objeto nuevo (inmutable respecto a la entrada) y NUNCA copia
 * keys fuera del allowlist — barrera defensiva contra columnas inexistentes
 * (p.ej. `status`) que romperían el upsert con PGRST204.
 */
export function toPersistableSnapshotPayload(
  row: EcScvsSnapshotRow,
): EcScvsPersistableSnapshot {
  return {
    source_key: row.source_key,
    country_code: row.country_code,
    source_year: row.source_year,
    tax_id: row.tax_id,
    normalized_tax_id: row.normalized_tax_id,
    legal_name: row.legal_name,
    raw_data: row.raw_data,
    record_identity_key: row.record_identity_key,
  };
}

// ─── Tipos ─────────────────────────────────────────────────────────────────────

/** Interfaz mínima de cliente Supabase — inyectable en tests. Nunca se crea aquí. */
export type EcScvsSupabaseAdminLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/** Motivos de rechazo de una fila antes del write. */
export type EcScvsWriterRejectionReason =
  | 'malformed_row'
  | 'wrong_source_key'
  | 'wrong_country_code'
  | 'invalid_source_year'
  | 'missing_record_identity_key'
  | 'invalid_record_identity_key'
  | 'unexpected_identity_namespace'
  | 'duplicate_record_identity_key';

export interface EcScvsWriterRejection {
  sourceRowIndex: number;
  reason: EcScvsWriterRejectionReason;
  /** Presente solo cuando la identidad se pudo leer (dup / namespace). */
  recordIdentityKey: string | null;
}

export interface EcScvsWriterBatchError {
  /** Índice 0-based del batch que falló. */
  batchIndex: number;
  /** Offset (índice de la primera fila del batch) dentro de las filas aceptadas. */
  offset: number;
  message: string;
  /**
   * Código de error del proveedor (p.ej. PGRST204) si viene. Opcional para no
   * romper llamadores/tests que construyen errores solo con `message`.
   */
  code?: string | null;
  /** Hint del proveedor si viene (generalmente genérico, sin valores de fila). */
  hint?: string | null;
}

export type EcScvsSnapshotImportStatus =
  | 'dry_run'
  | 'success'
  | 'partial_failure'
  | 'failed';

export interface EcScvsSnapshotImportInput {
  snapshotRows: EcScvsSnapshotRow[];
  /** Default true — nunca escribe si no se pide explícitamente. */
  dryRun?: boolean;
  /** Default DEFAULT_BATCH_SIZE. Debe ser entero positivo. */
  batchSize?: number;
  /** Cliente Supabase inyectado. OBLIGATORIO en apply. Ignorado en dry-run. */
  supabase?: EcScvsSupabaseAdminLike;
}

export interface EcScvsSnapshotImportSummary {
  sourceKey: typeof EC_SCVS_SOURCE_KEY;
  countryCode: typeof EC_SCVS_COUNTRY_CODE;
  conflictTarget: string;
  batchSize: number;
  /** Desglose de rechazos por motivo (0 en las categorías no observadas). */
  rejectionBreakdown: Record<EcScvsWriterRejectionReason, number>;
  /** Este hito NO persiste coverage ni signals — invariantes explícitos. */
  coverageWritten: false;
  signalsWritten: false;
}

export interface EcScvsSnapshotImportResult {
  status: EcScvsSnapshotImportStatus;
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  upsertedRows: number;
  /** Filas que no llegaron al upsert (rechazadas). */
  skippedRows: number;
  batches: number;
  errors: EcScvsWriterBatchError[];
  rejections: EcScvsWriterRejection[];
  summary: EcScvsSnapshotImportSummary;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyRejectionBreakdown(): Record<EcScvsWriterRejectionReason, number> {
  return {
    malformed_row: 0,
    wrong_source_key: 0,
    wrong_country_code: 0,
    invalid_source_year: 0,
    missing_record_identity_key: 0,
    invalid_record_identity_key: 0,
    unexpected_identity_namespace: 0,
    duplicate_record_identity_key: 0,
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Namespace de un record_identity_key ya validado estructuralmente. */
function namespaceOf(recordIdentityKey: string): string {
  const separatorIndex = recordIdentityKey.indexOf(':');
  return separatorIndex === -1 ? '' : recordIdentityKey.slice(0, separatorIndex);
}

/** Clave de deduplicación al grain del conflict target. */
function conflictScopeKey(row: EcScvsSnapshotRow): string {
  return `${row.source_key}|${row.country_code}|${row.source_year}|${row.record_identity_key}`;
}

// ─── Partición / boundary ──────────────────────────────────────────────────────

interface PartitionResult {
  accepted: EcScvsSnapshotRow[];
  rejections: EcScvsWriterRejection[];
}

/**
 * Particiona filas en accepted / rejected según el contrato EC SCVS.
 * Orden de chequeos deliberado: forma → source_key → country_code → year →
 * identidad presente → identidad válida → namespace → duplicado.
 *
 * NO deduplica por RUC. normalized_tax_id null y legal_name null son válidos.
 */
function partitionRows(rows: EcScvsSnapshotRow[]): PartitionResult {
  const accepted: EcScvsSnapshotRow[] = [];
  const rejections: EcScvsWriterRejection[] = [];
  const seenScopeKeys = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as EcScvsSnapshotRow | null | undefined;

    if (row === null || row === undefined || typeof row !== 'object') {
      rejections.push({ sourceRowIndex: i, reason: 'malformed_row', recordIdentityKey: null });
      continue;
    }

    if (row.source_key !== EC_SCVS_SOURCE_KEY) {
      rejections.push({ sourceRowIndex: i, reason: 'wrong_source_key', recordIdentityKey: null });
      continue;
    }

    if (row.country_code !== EC_SCVS_COUNTRY_CODE) {
      rejections.push({ sourceRowIndex: i, reason: 'wrong_country_code', recordIdentityKey: null });
      continue;
    }

    if (!isPositiveInteger(row.source_year)) {
      rejections.push({ sourceRowIndex: i, reason: 'invalid_source_year', recordIdentityKey: null });
      continue;
    }

    const rawKey = row.record_identity_key as unknown;
    if (rawKey === null || rawKey === undefined || (typeof rawKey === 'string' && rawKey.trim().length === 0)) {
      rejections.push({
        sourceRowIndex: i,
        reason: 'missing_record_identity_key',
        recordIdentityKey: null,
      });
      continue;
    }

    const validation = validateRecordIdentityKey(rawKey);
    if (!validation.valid) {
      rejections.push({
        sourceRowIndex: i,
        reason: 'invalid_record_identity_key',
        recordIdentityKey: typeof rawKey === 'string' ? rawKey : null,
      });
      continue;
    }

    const key = row.record_identity_key as string;
    if (namespaceOf(key) !== EXPEDIENTE_NAMESPACE) {
      rejections.push({
        sourceRowIndex: i,
        reason: 'unexpected_identity_namespace',
        recordIdentityKey: key,
      });
      continue;
    }

    const scopeKey = conflictScopeKey(row);
    if (seenScopeKeys.has(scopeKey)) {
      rejections.push({
        sourceRowIndex: i,
        reason: 'duplicate_record_identity_key',
        recordIdentityKey: key,
      });
      continue;
    }
    seenScopeKeys.add(scopeKey);

    accepted.push(row);
  }

  return { accepted, rejections };
}

// ─── Upsert ────────────────────────────────────────────────────────────────────

interface UpsertOutcome {
  upsertedRows: number;
  batches: number;
  errors: EcScvsWriterBatchError[];
}

async function upsertAcceptedBatches(
  supabase: EcScvsSupabaseAdminLike,
  accepted: EcScvsSnapshotRow[],
  batchSize: number,
): Promise<UpsertOutcome> {
  let upsertedRows = 0;
  let batches = 0;
  const errors: EcScvsWriterBatchError[] = [];

  for (let offset = 0; offset < accepted.length; offset += batchSize) {
    const batchIndex = batches;
    const batch = accepted.slice(offset, offset + batchSize);
    batches += 1;

    // Proyecta cada fila a SOLO las columnas persistibles antes del upsert.
    // Barrera defensiva: aunque una fila arrastre keys extra (p.ej. `status`),
    // nunca llegan a la tabla — evita PGRST204 por columna inexistente.
    const payload = batch.map(toPersistableSnapshotPayload);

    const { error } = await supabase
      .from('source_company_snapshots')
      .upsert(payload, { onConflict: CONFLICT_TARGET, ignoreDuplicates: false });

    if (error) {
      // Fail-fast: no continuar silenciosamente. Registrar y detener.
      errors.push(toBatchError(error, batchIndex, offset));
      break;
    }

    upsertedRows += batch.length;
  }

  return { upsertedRows, batches, errors };
}

/**
 * Extrae un error de batch estructurado del error del proveedor. Solo lee
 * campos escalares conocidos (message/code/hint) — nunca copia el objeto de
 * error completo ni el payload de la fila.
 */
function toBatchError(
  error: unknown,
  batchIndex: number,
  offset: number,
): EcScvsWriterBatchError {
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    const message = 'message' in obj ? String(obj.message) : String(error);
    const code = 'code' in obj && obj.code != null ? String(obj.code) : null;
    const hint = 'hint' in obj && obj.hint != null ? String(obj.hint) : null;
    return { batchIndex, offset, message, code, hint };
  }
  return { batchIndex, offset, message: String(error), code: null, hint: null };
}

// ─── Writer ────────────────────────────────────────────────────────────────────

/**
 * Ejecuta el import de snapshots EC SCVS. Por defecto es dry-run (no toca DB).
 *
 * @throws Error `supabase_client_required` si dryRun=false sin cliente inyectado.
 * @throws Error `invalid_batch_size` si batchSize no es entero positivo.
 */
export async function runEcScvsSnapshotImport(
  input: EcScvsSnapshotImportInput,
): Promise<EcScvsSnapshotImportResult> {
  const { snapshotRows, dryRun = true, supabase } = input;
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;

  if (!isPositiveInteger(batchSize)) {
    throw new Error(
      `invalid_batch_size: batchSize debe ser un entero positivo, recibido: ${String(input.batchSize)}`,
    );
  }

  const { accepted, rejections } = partitionRows(snapshotRows);

  const rejectionBreakdown = emptyRejectionBreakdown();
  for (const rejection of rejections) {
    rejectionBreakdown[rejection.reason] += 1;
  }

  const summary: EcScvsSnapshotImportSummary = {
    sourceKey: EC_SCVS_SOURCE_KEY,
    countryCode: EC_SCVS_COUNTRY_CODE,
    conflictTarget: CONFLICT_TARGET,
    batchSize,
    rejectionBreakdown,
    coverageWritten: false,
    signalsWritten: false,
  };

  const base: Omit<EcScvsSnapshotImportResult, 'status'> = {
    dryRun,
    totalRows: snapshotRows.length,
    validRows: accepted.length,
    rejectedRows: rejections.length,
    upsertedRows: 0,
    skippedRows: rejections.length,
    batches: 0,
    errors: [],
    rejections,
    summary,
  };

  // ── Dry-run: nunca toca Supabase ───────────────────────────────────────────
  if (dryRun) {
    return { ...base, status: 'dry_run' };
  }

  // ── Apply: exige cliente inyectado (nunca se crea aquí) ────────────────────
  if (supabase === undefined || supabase === null) {
    throw new Error(
      'supabase_client_required: apply (dryRun=false) requiere un cliente Supabase inyectado. ' +
        'El writer no crea clientes ni lee secrets.',
    );
  }

  const { upsertedRows, batches, errors } = await upsertAcceptedBatches(
    supabase,
    accepted,
    batchSize,
  );

  let status: EcScvsSnapshotImportStatus;
  if (errors.length > 0) {
    status = upsertedRows > 0 ? 'partial_failure' : 'failed';
  } else if (upsertedRows === accepted.length && accepted.length > 0) {
    status = 'success';
  } else if (accepted.length === 0) {
    // Apply sin filas escribibles: no-op explícito, no silencioso.
    status = 'failed';
  } else {
    status = 'partial_failure';
  }

  return {
    ...base,
    status,
    upsertedRows,
    batches,
    errors,
  };
}
