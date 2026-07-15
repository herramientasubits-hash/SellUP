/**
 * Honduras Contrataciones Abiertas — Snapshot Writer
 *
 * Prepara y (con dryRun: false) escribe filas en source_company_snapshots.
 *
 * Dry-run (default, dryRun: true):
 *   - Valida candidatos y prepara filas
 *   - NO crea cliente Supabase
 *   - NO llama .upsert()
 *   - rowsWritten = 0, coverageSummaryWritten = false
 *
 * Apply (dryRun: false):
 *   - Valida invariantes en TODAS las filas antes de cualquier write
 *   - Si una sola fila viola un invariante: 0 writes, error seguro
 *   - Upsert en source_company_snapshots con conflict key exacto
 *   - Coverage summary escrito solo si rowsWritten > 0
 *   - Admin client creado solo después de validación (nunca en dry-run)
 *
 * Conflict key: (source_key, country_code, source_year, record_identity_key)
 *
 * Hito Centroamérica.8C.4B
 */

import type { HnOcdsCandidate } from './hn-ocds-types';
import { mapCandidatesToSnapshot } from './hn-snapshot-mapper';
import type { HnSnapshotRow } from './hn-snapshot-mapper';
import { validateRecordIdentityKey, RECORD_IDENTITY_ON_CONFLICT } from '../../record-identity';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

/** Interfaz mínima de cliente Supabase — inyectable en tests. */
export type HnSupabaseAdminLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type HnSnapshotWriterOptions = {
  sourceYear: number;
  dryRun?: boolean;
  /** Número de líneas JSONL leídas — para coverage breakdown (solo apply). */
  linesRead?: number;
  /** RTN únicos válidos encontrados antes del filtro legal entity — para coverage breakdown. */
  uniqueValidRtn?: number;
  /** Cliente Supabase inyectable (testing). Si ausente, se crea desde env vars en apply. */
  supabaseAdmin?: HnSupabaseAdminLike;
};

export type HnSnapshotWriterResult = {
  sourceKey: 'hn_contrataciones_abiertas';
  countryCode: 'HN';
  sourceYear: number;
  dryRun: boolean;
  candidatesInput: number;
  eligibleLegalEntities: number;
  excludedNaturalPersonRisk: number;
  invalidRtn: number;
  rowsPrepared: number;
  rowsWritten: number;
  conflictsTarget: string;
  coverageSummaryWritten: boolean;
  recordIdentityBoundary?: {
    allowedCount: number;
    blockedCount: number;
    blockedReasons: Record<string, number>;
  };
};

export type HnCoverageSummaryPayload = {
  source_key: 'hn_contrataciones_abiertas';
  country_code: 'HN';
  coverage_kind: 'procurement_signal';
  entity_label: 'RTN proveedores con señal jurídica';
  coverage_status: 'partial_snapshot';
  loaded_rows: number;
  audited_total_rows: 0;
  refresh_source: 'hn_8c4b_pilot_snapshot';
  coverage_breakdown: {
    source_type: 'procurement_signal';
    tax_identifier_type: 'RTN';
    source_year: number;
    lines_read: number;
    unique_valid_rtn: number;
    likely_legal_entity: number;
    excluded_person_natural_risk: number;
    post_approval_enabled: false;
    human_review_required: true;
    pilot_scope: true;
    max_apply_lines: 1000;
  };
  coverage_notes: {
    is_procurement_signal_only: true;
    is_fiscal_source: false;
    validates_rtn_fiscally: false;
    post_approval_enabled: false;
    human_review_required: true;
    pilot_scope: true;
    complete_snapshot: false;
    note: string;
  };
};

// ─── Constantes ────────────────────────────────────────────────────────────────

const CONFLICT_TARGET = RECORD_IDENTITY_ON_CONFLICT;
const BATCH_SIZE = 50;

// ─── Invariant validation ─────────────────────────────────────────────────────

/**
 * Retorna mensajes de violación para filas que incumplen los invariantes.
 * Array vacío = todas las filas válidas.
 * Si el array no está vacío, 0 writes deben ejecutarse.
 */
export function findInvariantViolations(rows: HnSnapshotRow[]): string[] {
  const violations: string[] = [];
  for (const r of rows) {
    if (r.source_key !== 'hn_contrataciones_abiertas')
      violations.push(`source_key=${r.source_key}`);
    if (r.country_code !== 'HN')
      violations.push(`country_code=${r.country_code}`);
    if (!/^\d{14}$/.test(r.normalized_tax_id))
      violations.push(`normalized_tax_id=${r.normalized_tax_id} (no 14 dígitos)`);
    if (r.raw_data.source_type !== 'procurement_signal')
      violations.push(`source_type=${r.raw_data.source_type}`);
    if (r.raw_data.tax_identifier_type !== 'RTN')
      violations.push(`tax_identifier_type=${r.raw_data.tax_identifier_type}`);
    if (r.raw_data.legal_validation_status !== 'not_applicable')
      violations.push(`legal_validation_status=${r.raw_data.legal_validation_status}`);
    if (r.raw_data.human_review_required !== true)
      violations.push(`human_review_required=${String(r.raw_data.human_review_required)}`);
    if (r.raw_data.post_approval_enabled !== false)
      violations.push(`post_approval_enabled=${String(r.raw_data.post_approval_enabled)}`);
    if (r.raw_data.matching_automatic_enabled !== false)
      violations.push(`matching_automatic_enabled=${String(r.raw_data.matching_automatic_enabled)}`);
    if (r.raw_data.legal_entity_hint !== 'likely_legal_entity')
      violations.push(`legal_entity_hint=${r.raw_data.legal_entity_hint}`);
  }
  return violations;
}

// ─── Coverage summary builder ─────────────────────────────────────────────────

export function buildHnCoverageSummaryPayload(opts: {
  sourceYear: number;
  rowsWritten: number;
  linesRead: number;
  uniqueValidRtn: number;
  eligibleLegalEntities: number;
  excludedNaturalPersonRisk: number;
}): HnCoverageSummaryPayload {
  return {
    source_key: 'hn_contrataciones_abiertas',
    country_code: 'HN',
    coverage_kind: 'procurement_signal',
    entity_label: 'RTN proveedores con señal jurídica',
    coverage_status: 'partial_snapshot',
    loaded_rows: opts.rowsWritten,
    audited_total_rows: 0,
    refresh_source: 'hn_8c4b_pilot_snapshot',
    coverage_breakdown: {
      source_type: 'procurement_signal',
      tax_identifier_type: 'RTN',
      source_year: opts.sourceYear,
      lines_read: opts.linesRead,
      unique_valid_rtn: opts.uniqueValidRtn,
      likely_legal_entity: opts.eligibleLegalEntities,
      excluded_person_natural_risk: opts.excludedNaturalPersonRisk,
      post_approval_enabled: false,
      human_review_required: true,
      pilot_scope: true,
      max_apply_lines: 1000,
    },
    coverage_notes: {
      is_procurement_signal_only: true,
      is_fiscal_source: false,
      validates_rtn_fiscally: false,
      post_approval_enabled: false,
      human_review_required: true,
      pilot_scope: true,
      complete_snapshot: false,
      note: 'Señal procurement B2G. No valida RTN fiscalmente. No reemplaza fuente tributaria HN.',
    },
  };
}

// ─── Helpers internos del branch apply ───────────────────────────────────────

async function createHnSupabaseAdmin(): Promise<HnSupabaseAdminLike> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error(
      'supabase_env_missing: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados.',
    );
  }
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

async function upsertSnapshotBatch(
  admin: HnSupabaseAdminLike,
  rows: HnSnapshotRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  let totalUpserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { error } = await admin
      .from('source_company_snapshots')
      .upsert(batch, {
        onConflict: CONFLICT_TARGET,
        ignoreDuplicates: false,
      });

    if (error) {
      const msg =
        typeof error === 'object' && error !== null && 'message' in error
          ? (error as { message: string }).message
          : String(error);
      throw new Error(`upsert_source_company_snapshots (batch offset ${i}): ${msg}`);
    }
    totalUpserted += batch.length;
  }

  return totalUpserted;
}

async function upsertCoverageSummary(
  admin: HnSupabaseAdminLike,
  payload: HnCoverageSummaryPayload,
): Promise<void> {
  const row = {
    ...payload,
    refreshed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { error } = await admin
    .from('source_coverage_summaries')
    .upsert(row, { onConflict: 'source_key' });

  if (error) {
    const msg =
      typeof error === 'object' && error !== null && 'message' in error
        ? (error as { message: string }).message
        : String(error);
    throw new Error(`upsert_source_coverage_summaries: ${msg}`);
  }
}

// ─── Writer ───────────────────────────────────────────────────────────────────

export async function runHnSnapshotWriter(
  candidates: HnOcdsCandidate[],
  options: HnSnapshotWriterOptions,
): Promise<HnSnapshotWriterResult> {
  const { sourceYear, dryRun = true } = options;

  const mapped = mapCandidatesToSnapshot(candidates, sourceYear);

  const result: HnSnapshotWriterResult = {
    sourceKey: 'hn_contrataciones_abiertas',
    countryCode: 'HN',
    sourceYear,
    dryRun,
    candidatesInput: candidates.length,
    eligibleLegalEntities: mapped.eligibleLegalEntities,
    excludedNaturalPersonRisk: mapped.excludedNaturalPersonRisk,
    invalidRtn: mapped.invalidRtn,
    rowsPrepared: mapped.rows.length,
    rowsWritten: 0,
    conflictsTarget: CONFLICT_TARGET,
    coverageSummaryWritten: false,
  };

  if (dryRun) {
    return result;
  }

  // ── Apply branch ─────────────────────────────────────────────────────────────

  // 1. Validar invariantes en TODAS las filas antes de cualquier acceso a DB
  const violations = findInvariantViolations(mapped.rows);
  if (violations.length > 0) {
    throw new Error(
      `invariant_violation: ${violations.slice(0, 5).join('; ')}. Ninguna fila fue escrita.`,
    );
  }

  // 2. Crear admin client solo después de validación (nunca en dry-run)
  const admin = options.supabaseAdmin ?? (await createHnSupabaseAdmin());

  // 2.5. Record identity boundary (APP-B P2B): partición adicional, no reemplaza
  // el filtro de legal entity ya aplicado en mapCandidatesToSnapshot. Solo filas
  // con record_identity_key válido se envían a upsert; las bloqueadas se cuentan
  // pero no son un error fatal.
  const allowedRows: HnSnapshotRow[] = [];
  let boundaryBlockedCount = 0;
  const boundaryBlockedReasons: Record<string, number> = {};
  for (const row of mapped.rows) {
    const validation = validateRecordIdentityKey(row.record_identity_key ?? null);
    if (validation.valid) {
      allowedRows.push(row);
    } else {
      boundaryBlockedCount += 1;
      boundaryBlockedReasons[validation.reason] =
        (boundaryBlockedReasons[validation.reason] ?? 0) + 1;
    }
  }

  // 3. Upsert en source_company_snapshots
  const rowsWritten = await upsertSnapshotBatch(admin, allowedRows);
  result.rowsWritten = rowsWritten;
  result.recordIdentityBoundary = {
    allowedCount: allowedRows.length,
    blockedCount: boundaryBlockedCount,
    blockedReasons: boundaryBlockedReasons,
  };

  // 4. Coverage summary solo si write exitoso y rowsWritten > 0
  if (rowsWritten > 0) {
    const summaryPayload = buildHnCoverageSummaryPayload({
      sourceYear,
      rowsWritten,
      linesRead: options.linesRead ?? 0,
      uniqueValidRtn: options.uniqueValidRtn ?? 0,
      eligibleLegalEntities: mapped.eligibleLegalEntities,
      excludedNaturalPersonRisk: mapped.excludedNaturalPersonRisk,
    });
    await upsertCoverageSummary(admin, summaryPayload);
    result.coverageSummaryWritten = true;
  }

  return result;
}

// ─── Helpers de validación (para dry-run reporting) ───────────────────────────

/** Verifica invariantes sobre filas preparadas. No lanza excepciones. */
export function validateSnapshotRows(rows: HnSnapshotRow[]): {
  allSourceKeyCorrect: boolean;
  allCountryCodeCorrect: boolean;
  allNormalizedTaxId14Digits: boolean;
  allHumanReviewRequired: boolean;
  allPostApprovalDisabled: boolean;
  allMatchingDisabled: boolean;
} {
  return {
    allSourceKeyCorrect: rows.every((r) => r.source_key === 'hn_contrataciones_abiertas'),
    allCountryCodeCorrect: rows.every((r) => r.country_code === 'HN'),
    allNormalizedTaxId14Digits: rows.every((r) => /^\d{14}$/.test(r.normalized_tax_id)),
    allHumanReviewRequired: rows.every((r) => r.raw_data.human_review_required === true),
    allPostApprovalDisabled: rows.every((r) => r.raw_data.post_approval_enabled === false),
    allMatchingDisabled: rows.every((r) => r.raw_data.matching_automatic_enabled === false),
  };
}
