/**
 * GT RGAE — Snapshot Writer
 *
 * Prepara y (con dryRun: false) escribe filas en source_company_snapshots.
 *
 * Dry-run (default, dryRun: true):
 *   - Mapea candidatos y valida invariantes
 *   - NO crea cliente Supabase
 *   - NO llama .upsert()
 *   - rowsWritten = 0, coverageWritten = false
 *
 * Apply (dryRun: false):
 *   - Valida invariantes en TODAS las filas antes de cualquier write
 *   - Si una sola fila viola un invariante: 0 writes, error seguro
 *   - Preflight read-only: cuenta rows existentes + cobertura existente
 *   - Upsert en batches de 50 en source_company_snapshots
 *   - Coverage summary escrito solo si todos los batches exitosos Y rowsWritten === snapshotRows.length
 *
 * Failure semantics — fail-fast with possible partial writes:
 *   Si batch N falla, los batches 0..N-1 pueden haber persistido.
 *   rowsWritten refleja los batches ya completados antes del fallo.
 *   Coverage NO se escribe si hubo fallo parcial.
 *   Retry recomendado: re-run completo (idempotencia por onConflict).
 *
 * Conflict key: (source_key, country_code, source_year, normalized_tax_id)
 *
 * Hito: Centroamérica.7G.3 — snapshot write path.
 */

import type { GtRgaeNormalizedCandidate, GtRgaeDryRunSummary } from './gt-rgae-types';
import {
  mapCandidatesToSnapshot,
  findSnapshotInvariantViolations,
  buildGtRgaeCoveragePayload,
} from './gt-rgae-snapshot-mapper';
import type { GtRgaeSnapshotRow, GtRgaeCoverageSummaryPayload } from './gt-rgae-snapshot-mapper';
import {
  deriveTaxRecordIdentity,
  validateRecordIdentityKey,
  OLD_TAX_GRAIN_ON_CONFLICT,
} from '../../record-identity';
import type { RecordIdentityKey, RecordIdentityUnavailableReason } from '../../record-identity';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

/** Interfaz mínima de cliente Supabase — inyectable en tests. */
export type GtRgaeSupabaseAdminLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/** GtRgaeSnapshotRow + shadow record_identity_key (EC4D5.C2 — additive, no excluye filas). */
export type GtRgaeShadowSnapshotRow = GtRgaeSnapshotRow & {
  record_identity_key: RecordIdentityKey | null;
};

export type GtRgaeRecordIdentityShadowSummary = {
  resolved_count: number;
  unavailable_count: number;
  unavailable_reasons: Partial<Record<RecordIdentityUnavailableReason, number>>;
};

/** APP-B P2B — partición real: solo allowedCount llega al upsert. */
export type GtRgaeRecordIdentityBoundarySummary = {
  allowedCount: number;
  blockedCount: number;
  blockedReasons: Record<string, number>;
};

export type GtRgaeSnapshotWriterOptions = {
  sourceYear: 2025;
  dryRun?: boolean;
  /** Summary del dry-run/adapter — alimenta el payload de coverage. Requerido en apply. */
  dryRunSummary?: GtRgaeDryRunSummary;
  /** Cliente Supabase inyectable (testing). Si ausente, se crea desde env vars en apply. */
  supabaseAdmin?: GtRgaeSupabaseAdminLike;
};

export type GtRgaePreflight = {
  existingSnapshotRows: number;
  existingCoverageFound: boolean;
};

export type GtRgaeSnapshotWriterResult = {
  sourceKey: 'gt_rgae_proveedores';
  countryCode: 'GT';
  sourceYear: 2025;
  dryRun: boolean;
  candidatesInput: number;
  snapshotRowsPrepared: number;
  invariantViolations: number;
  rowsWritten: number;
  conflictsTarget: string;
  coverageWritten: boolean;
  preflight: GtRgaePreflight | null;
  recordIdentityShadow: GtRgaeRecordIdentityShadowSummary;
  recordIdentityBoundary?: GtRgaeRecordIdentityBoundarySummary;
};

// ─── Constantes ────────────────────────────────────────────────────────────────

const CONFLICT_TARGET = OLD_TAX_GRAIN_ON_CONFLICT;
const BATCH_SIZE = 50;

// ─── Helpers internos ──────────────────────────────────────────────────────────

/**
 * EC4D5.C2 — shadow dual-write: deriva record_identity_key desde normalized_tax_id
 * sin excluir ni reordenar filas. P2A puro (aditivo, no bloqueante).
 */
function withRecordIdentity(rows: GtRgaeSnapshotRow[]): {
  rows: GtRgaeShadowSnapshotRow[];
  shadow: GtRgaeRecordIdentityShadowSummary;
} {
  const unavailableReasons: Partial<Record<RecordIdentityUnavailableReason, number>> = {};
  let resolvedCount = 0;
  let unavailableCount = 0;

  const shadowRows = rows.map((row) => {
    const identity = deriveTaxRecordIdentity(row.normalized_tax_id);
    if (identity.status === 'resolved') {
      resolvedCount++;
      return { ...row, record_identity_key: identity.recordIdentityKey };
    }
    unavailableCount++;
    unavailableReasons[identity.reason] = (unavailableReasons[identity.reason] ?? 0) + 1;
    return { ...row, record_identity_key: null };
  });

  return {
    rows: shadowRows,
    shadow: {
      resolved_count: resolvedCount,
      unavailable_count: unavailableCount,
      unavailable_reasons: unavailableReasons,
    },
  };
}

async function createGtRgaeSupabaseAdmin(): Promise<GtRgaeSupabaseAdminLike> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error(
      'service_role_required: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados.',
    );
  }
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

async function runPreflight(admin: GtRgaeSupabaseAdminLike): Promise<GtRgaePreflight> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { count: existingCount } = await admin
    .from('source_company_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('source_key', 'gt_rgae_proveedores')
    .eq('country_code', 'GT')
    .eq('source_year', 2025);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { data: coverageData } = await admin
    .from('source_coverage_summaries')
    .select('source_key')
    .eq('source_key', 'gt_rgae_proveedores')
    .maybeSingle();

  return {
    existingSnapshotRows: typeof existingCount === 'number' ? existingCount : 0,
    existingCoverageFound: coverageData !== null,
  };
}

async function upsertSnapshotBatches(
  admin: GtRgaeSupabaseAdminLike,
  rows: GtRgaeShadowSnapshotRow[],
): Promise<{ rowsWritten: number; boundary: GtRgaeRecordIdentityBoundarySummary }> {
  let totalUpserted = 0;
  let boundaryAllowedCount = 0;
  let boundaryBlockedCount = 0;
  const boundaryBlockedReasons: Record<string, number> = {};

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // APP-B P2B — solo filas con record_identity_key válido llegan al upsert.
    const allowedRows: typeof batch = [];
    for (const row of batch) {
      const validation = validateRecordIdentityKey(row.record_identity_key);
      if (validation.valid) {
        allowedRows.push(row);
        boundaryAllowedCount += 1;
      } else {
        boundaryBlockedCount += 1;
        boundaryBlockedReasons[validation.reason] =
          (boundaryBlockedReasons[validation.reason] ?? 0) + 1;
      }
    }

    if (allowedRows.length === 0) continue;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { error } = await admin
      .from('source_company_snapshots')
      .upsert(allowedRows, {
        onConflict: CONFLICT_TARGET,
        ignoreDuplicates: false,
      });

    if (error) {
      const msg =
        typeof error === 'object' && error !== null && 'message' in error
          ? (error as { message: string }).message
          : String(error);
      // Fail-fast: batches anteriores pueden haber persistido.
      // rowsWritten refleja solo los batches completados antes de este error.
      // Re-run completo es idempotente por onConflict.
      throw new Error(`upsert_source_company_snapshots (batch offset ${i}): ${msg}`);
    }

    totalUpserted += allowedRows.length;
  }

  return {
    rowsWritten: totalUpserted,
    boundary: {
      allowedCount: boundaryAllowedCount,
      blockedCount: boundaryBlockedCount,
      blockedReasons: boundaryBlockedReasons,
    },
  };
}

async function upsertCoverageSummary(
  admin: GtRgaeSupabaseAdminLike,
  payload: GtRgaeCoverageSummaryPayload,
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

// ─── Writer ────────────────────────────────────────────────────────────────────

export async function runGtRgaeSnapshotWriter(
  candidates: GtRgaeNormalizedCandidate[],
  options: GtRgaeSnapshotWriterOptions,
): Promise<GtRgaeSnapshotWriterResult> {
  const { sourceYear, dryRun = true } = options;

  const snapshotRows = mapCandidatesToSnapshot(candidates);
  const violations = findSnapshotInvariantViolations(snapshotRows);
  const { rows: shadowRows, shadow: recordIdentityShadow } = withRecordIdentity(snapshotRows);

  const result: GtRgaeSnapshotWriterResult = {
    sourceKey: 'gt_rgae_proveedores',
    countryCode: 'GT',
    sourceYear,
    dryRun,
    candidatesInput: candidates.length,
    snapshotRowsPrepared: snapshotRows.length,
    invariantViolations: violations.length,
    rowsWritten: 0,
    conflictsTarget: CONFLICT_TARGET,
    coverageWritten: false,
    preflight: null,
    recordIdentityShadow,
  };

  if (dryRun) {
    return result;
  }

  // ── Apply branch ─────────────────────────────────────────────────────────────

  // 1. Bloquear si hay violations (antes de cualquier acceso a DB)
  if (violations.length > 0) {
    throw new Error(
      `snapshot_invariant_violation: ${violations.slice(0, 5).join('; ')}. Ninguna fila fue escrita.`,
    );
  }

  // 2. Bloquear si zero candidates
  if (snapshotRows.length === 0) {
    throw new Error('zero_candidates: candidatesInput=0. Apply abortado.');
  }

  // 3. Crear admin client (nunca en dry-run)
  const admin = options.supabaseAdmin ?? (await createGtRgaeSupabaseAdmin());

  // 4. Preflight read-only
  result.preflight = await runPreflight(admin);

  // 5. Upsert en source_company_snapshots
  const { rowsWritten, boundary } = await upsertSnapshotBatches(admin, shadowRows);
  result.rowsWritten = rowsWritten;
  result.recordIdentityBoundary = boundary;

  // 6. Coverage solo si todos los batches exitosos Y rowsWritten === snapshotRows.length
  const allBatchesComplete =
    rowsWritten > 0 &&
    rowsWritten === snapshotRows.length &&
    violations.length === 0;

  if (allBatchesComplete) {
    if (!options.dryRunSummary) {
      throw new Error(
        'dryRunSummary_required: options.dryRunSummary es requerido para escribir coverage en apply.',
      );
    }
    const coveragePayload = buildGtRgaeCoveragePayload({
      rowsWritten,
      summary: options.dryRunSummary,
      invariantViolations: 0,
    });
    await upsertCoverageSummary(admin, coveragePayload);
    result.coverageWritten = true;
  }

  return result;
}
