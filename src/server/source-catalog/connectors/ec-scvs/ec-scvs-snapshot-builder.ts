/**
 * EC SCVS — Offline Snapshot Builder
 *
 * Convierte filas crudas de bi_compania.csv (SCVS Ecuador) en filas listas
 * para persistir en `source_company_snapshots` en un hito FUTURO.
 *
 * Este hito (EC-SCVS-2) NO persiste, NO escribe writer/importer, NO consulta
 * producción, NO crea reader runtime y NO conecta prospección. Es una función
 * PURA en memoria: sin Supabase, sin filesystem, sin network, sin provider.
 *
 * Semántica de la fuente (ver ec-scvs-types.ts): official_company_registry.
 * NO reporta estado societario, objeto social, representante legal ni CIIU.
 * NO implica validación SRI ni validación legal.
 *
 * Identidad (EC-SCVS-1 / source-family-registry): ec_scvs es
 * NATIVE_RECORD_GRAIN. La identidad física de la fila es `expediente`
 * (`expediente:<trim(expediente)>`), NUNCA el RUC ni el nombre. El RUC solo
 * alimenta normalized_tax_id/tax_id cuando es válido/normalizable. La misma
 * identidad fiscal (RUC) puede abarcar múltiples expedientes.
 *
 * Corrección EC-SCVS-0: una fila con expediente válido y RUC ausente es
 * admisible — se acepta con normalized_tax_id = null. Una fila SIN expediente
 * usable se rechaza (no puede establecer identidad de registro nativa).
 *
 * Hito: EC-SCVS-2 — Offline snapshot builder for bi_compania.csv.
 */

import type { EcScvsRawRow } from './ec-scvs-types';
import { normalizeEcuadorRuc } from './ec-ruc-normalizer';
import { deriveEcScvsRecordIdentity } from './ec-scvs-record-identity';
import type { RecordIdentityKey } from '../../record-identity';

export const EC_SCVS_SOURCE_KEY = 'ec_scvs' as const;
export const EC_SCVS_COUNTRY_CODE = 'EC' as const;

// ─── Input ─────────────────────────────────────────────────────────────────────

export interface EcScvsSnapshotBuildInput {
  /** Filas crudas tal como las produce el reader (parser CSV). */
  rows: EcScvsRawRow[];
  /**
   * Año de la fuente. Decisión de negocio NO cerrada en este hito: el builder
   * EXIGE que venga explícito en el input (entero positivo). No se hardcodea.
   */
  sourceYear: number;
  /** Metadata opcional de procedencia; solo se propaga a raw_data si viene. */
  sourceFileName?: string;
  sourceDownloadedAt?: string;
  importBatchId?: string;
}

// ─── Snapshot row (forma alineada con builders existentes) ──────────────────────

/** Estado de normalización del RUC preservado para trazabilidad en raw_data. */
export type EcScvsRucNormalizationStatus = 'valid' | 'missing' | 'invalid_format';

export interface EcScvsSnapshotRawData {
  source_type: 'official_company_registry';
  legal_validation_status: 'not_applicable';
  tax_validation_status: 'not_applicable';
  human_review_required: true;

  // Campos crudos tal como los reporta la fuente (sin validación legal/fiscal).
  expediente: string | null;
  ruc: string | null;
  nombre: string | null;
  tipo: string | null;
  pro_codigo: string | null;
  provincia: string | null;

  ruc_normalization_status: EcScvsRucNormalizationStatus;
  source_row_index: number;

  // Metadata de procedencia (solo presente si el input la proporcionó).
  source_file_name?: string;
  source_downloaded_at?: string;
  import_batch_id?: string;
}

export interface EcScvsSnapshotRow {
  source_key: typeof EC_SCVS_SOURCE_KEY;
  country_code: typeof EC_SCVS_COUNTRY_CODE;
  source_year: number;
  /** RUC crudo si viene presente; null si falta. */
  tax_id: string | null;
  /** RUC normalizado solo si válido; null si falta o no normaliza. */
  normalized_tax_id: string | null;
  /** nombre trim/normalizado o null. NUNCA es identidad. */
  legal_name: string | null;
  /** SCVS no reporta estado societario — marcador neutro de listado. */
  status: 'active_or_listed';
  raw_data: EcScvsSnapshotRawData;
  /** Siempre `expediente:<trim>` en filas aceptadas (invariante del builder). */
  record_identity_key: RecordIdentityKey;
}

// ─── Rejected rows ───────────────────────────────────────────────────────────

export type EcScvsSnapshotRejectionReason =
  /** expediente ausente/vacío: no hay identidad de registro nativa. */
  | 'missing_expediente'
  /** expediente repetido dentro del mismo input: colisión de identidad. */
  | 'duplicate_record_identity_key';

export interface EcScvsSnapshotRejectedRow {
  sourceRowIndex: number;
  reason: EcScvsSnapshotRejectionReason;
  /** Presente solo cuando la identidad SÍ se resolvió (duplicado). */
  recordIdentityKey: RecordIdentityKey | null;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface EcScvsSnapshotBuildSummary {
  totalSourceRows: number;
  acceptedRows: number;
  rejectedRows: number;
  rejectedMissingExpediente: number;
  rejectedDuplicateRecordIdentity: number;
  rowsWithNormalizedTaxId: number;
  rowsWithoutTaxId: number;
  distinctRecordIdentityKeys: number;
  distinctNormalizedTaxIds: number;
  // Nunca se escribe nada en este hito — invariantes explícitos.
  db_writes: 0;
  snapshot_writes: 0;
}

export interface EcScvsSnapshotBuildResult {
  rows: EcScvsSnapshotRow[];
  rejected: EcScvsSnapshotRejectedRow[];
  summary: EcScvsSnapshotBuildSummary;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeLegalName(raw: string | null): string | null {
  if (raw === null) return null;
  const normalized = raw.trim().replace(/\s+/g, ' ');
  return normalized === '' ? null : normalized;
}

function assertValidSourceYear(sourceYear: unknown): asserts sourceYear is number {
  if (typeof sourceYear !== 'number' || !Number.isInteger(sourceYear) || sourceYear <= 0) {
    throw new Error(
      `EC SCVS snapshot builder: sourceYear must be a positive integer, received: ${String(sourceYear)}`,
    );
  }
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Construye filas de snapshot EC SCVS en memoria desde filas crudas.
 * No escribe en Supabase, ni toca disco/red/proveedores.
 *
 * Reglas de admisión:
 *   - expediente usable (tras trim) es OBLIGATORIO → produce record_identity_key.
 *   - RUC válido NO es obligatorio → normalized_tax_id null si falta/no normaliza.
 *   - nombre vacío NO bloquea → legal_name null.
 *   - expediente ausente/vacío → fila rechazada (missing_expediente).
 *   - expediente repetido en el mismo input → primera aceptada, resto rechazadas
 *     (duplicate_record_identity_key). Nunca produce dos filas con identidad igual.
 *
 * @throws Error si sourceYear no es un entero positivo (Task 6 — sin hardcode).
 */
export function buildEcScvsSnapshotRows(
  input: EcScvsSnapshotBuildInput,
): EcScvsSnapshotBuildResult {
  assertValidSourceYear(input.sourceYear);

  const rows: EcScvsSnapshotRow[] = [];
  const rejected: EcScvsSnapshotRejectedRow[] = [];
  const seenIdentityKeys = new Set<string>();
  const normalizedTaxIds = new Set<string>();

  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i]!;

    const identity = deriveEcScvsRecordIdentity({ expediente: row.expediente });
    if (identity.status !== 'resolved') {
      // Sin expediente usable no hay identidad de registro nativa: se rechaza.
      // El RUC/nombre NUNCA se usan como fallback de identidad.
      rejected.push({ sourceRowIndex: i, reason: 'missing_expediente', recordIdentityKey: null });
      continue;
    }

    const recordIdentityKey = identity.recordIdentityKey;
    if (seenIdentityKeys.has(recordIdentityKey)) {
      rejected.push({
        sourceRowIndex: i,
        reason: 'duplicate_record_identity_key',
        recordIdentityKey,
      });
      continue;
    }
    seenIdentityKeys.add(recordIdentityKey);

    const rucResult = normalizeEcuadorRuc(row.ruc);
    const normalizedTaxId = rucResult.status === 'valid' ? rucResult.normalized : null;
    if (normalizedTaxId !== null) {
      normalizedTaxIds.add(normalizedTaxId);
    }

    const rawData: EcScvsSnapshotRawData = {
      source_type: 'official_company_registry',
      legal_validation_status: 'not_applicable',
      tax_validation_status: 'not_applicable',
      human_review_required: true,
      expediente: row.expediente,
      ruc: row.ruc,
      nombre: row.nombre,
      tipo: row.tipo,
      pro_codigo: row.pro_codigo,
      provincia: row.provincia,
      ruc_normalization_status: rucResult.status,
      source_row_index: i,
    };

    if (input.sourceFileName !== undefined) rawData.source_file_name = input.sourceFileName;
    if (input.sourceDownloadedAt !== undefined) {
      rawData.source_downloaded_at = input.sourceDownloadedAt;
    }
    if (input.importBatchId !== undefined) rawData.import_batch_id = input.importBatchId;

    rows.push({
      source_key: EC_SCVS_SOURCE_KEY,
      country_code: EC_SCVS_COUNTRY_CODE,
      source_year: input.sourceYear,
      tax_id: row.ruc,
      normalized_tax_id: normalizedTaxId,
      legal_name: normalizeLegalName(row.nombre),
      status: 'active_or_listed',
      raw_data: rawData,
      record_identity_key: recordIdentityKey,
    });
  }

  const rejectedMissingExpediente = rejected.filter(
    (r) => r.reason === 'missing_expediente',
  ).length;
  const rejectedDuplicateRecordIdentity = rejected.filter(
    (r) => r.reason === 'duplicate_record_identity_key',
  ).length;
  const rowsWithNormalizedTaxId = rows.filter((r) => r.normalized_tax_id !== null).length;

  const summary: EcScvsSnapshotBuildSummary = {
    totalSourceRows: input.rows.length,
    acceptedRows: rows.length,
    rejectedRows: rejected.length,
    rejectedMissingExpediente,
    rejectedDuplicateRecordIdentity,
    rowsWithNormalizedTaxId,
    rowsWithoutTaxId: rows.length - rowsWithNormalizedTaxId,
    distinctRecordIdentityKeys: seenIdentityKeys.size,
    distinctNormalizedTaxIds: normalizedTaxIds.size,
    db_writes: 0,
    snapshot_writes: 0,
  };

  return { rows, rejected, summary };
}
