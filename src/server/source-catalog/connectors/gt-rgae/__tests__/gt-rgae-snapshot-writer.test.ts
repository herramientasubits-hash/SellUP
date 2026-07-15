/**
 * GT RGAE — Snapshot Writer tests
 *
 * Cubre: Tarea 16 (writer con client fake/injected)
 * Hito: Centroamérica.7G.3
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { runGtRgaeSnapshotWriter } from '../gt-rgae-snapshot-writer';
import type { GtRgaeSupabaseAdminLike } from '../gt-rgae-snapshot-writer';
import type { GtRgaeNormalizedCandidate, GtRgaeDryRunSummary } from '../gt-rgae-types';
import { deriveTaxRecordIdentity, validateRecordIdentityKey } from '../../../record-identity';

// ─── Fixture helpers ────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<GtRgaeNormalizedCandidate> = {}): GtRgaeNormalizedCandidate {
  return {
    normalizedNit: '1234567',
    maskedNit: '123****',
    supplierName: 'EMPRESA EJEMPLO S.A.',
    normalizedSupplierName: 'EMPRESA EJEMPLO S.A.',
    supplierType: 'Sociedades',
    requestType: 'INSCRIPCION',
    resolutionDate: '2025-03-15',
    resolutionNumber: 42,
    certificateNumber: 1001,
    economicCapacity: { kind: 'numeric', amount: 500000, raw: 'Q500,000.00' },
    sourceYear: 2025,
    sourceType: 'government_supplier_registry',
    fiscalValidationStatus: 'not_applicable',
    legalValidationStatus: 'not_applicable',
    humanReviewRequired: true,
    postApprovalEnabled: false,
    matchingAutomaticEnabled: false,
    accountCreationEnabled: false,
    canonicalNameOverwriteEnabled: false,
    ...overrides,
  };
}

function makeCandidates(count: number): GtRgaeNormalizedCandidate[] {
  return Array.from({ length: count }, (_, i) =>
    makeCandidate({ normalizedNit: String(1000000 + i).slice(0, 7) }),
  );
}

function makeBaseSummary(): GtRgaeDryRunSummary {
  return {
    year: 2025,
    file_name: 'test.xlsx',
    sheet_name: 'Hoja1',
    rows_read: 137753,
    persona_individual_rows: 120209,
    sociedades_rows: 8854,
    comerciante_individual_rows: 8603,
    ong_rows: 58,
    asociacion_rows: 22,
    other_type_rows: 7,
    missing_type_rows: 0,
    sociedades_with_valid_nit: 8757,
    sociedades_invalid_nit: 97,
    sociedades_unique_nit: 6245,
    duplicate_sociedad_rows: 2512,
    dedup_replacements: 2119,
    resolution_date_invalid: 0,
    resolution_number_invalid: 0,
    economic_capacity_not_applicable: 0,
    economic_capacity_direct_purchase: 4397,
    economic_capacity_numeric: 1848,
    economic_capacity_unparsed: 0,
    supplier_name_missing: 0,
    supplier_name_normalization_collisions: 0,
    normalized_candidates: 6245,
    invariant_violations: 0,
    db_writes: 0,
    snapshot_writes: 0,
    coverage_writes: 0,
  };
}

type UpsertCall = { rows: unknown[]; opts: unknown };

/** Crea un cliente fake que no falla. Registra las llamadas en arrays. */
function makeFakeAdmin(opts: {
  snapshotError?: { message: string };
  snapshotErrorOnBatch?: number; // 1-based batch index that fails
  coverageError?: { message: string };
} = {}): {
  admin: GtRgaeSupabaseAdminLike;
  snapshotCalls: UpsertCall[];
  coverageCalls: UpsertCall[];
  fromCalls: string[];
} {
  const snapshotCalls: UpsertCall[] = [];
  const coverageCalls: UpsertCall[] = [];
  const fromCalls: string[] = [];

  const admin: GtRgaeSupabaseAdminLike = {
    from: (table: string) => {
      fromCalls.push(table);
      if (table === 'source_company_snapshots') {
        return {
          upsert: (rows: unknown[], upsertOpts: unknown) => {
            snapshotCalls.push({ rows, opts: upsertOpts });
            const batchIndex = snapshotCalls.length;
            if (opts.snapshotErrorOnBatch !== undefined && batchIndex === opts.snapshotErrorOnBatch) {
              return Promise.resolve({ error: { message: 'DB timeout' } });
            }
            if (opts.snapshotError) {
              return Promise.resolve({ error: opts.snapshotError });
            }
            return Promise.resolve({ error: null });
          },
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ count: 0, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'source_coverage_summaries') {
        return {
          upsert: (rows: unknown, upsertOpts: unknown) => {
            coverageCalls.push({ rows: [rows], opts: upsertOpts });
            if (opts.coverageError) return Promise.resolve({ error: opts.coverageError });
            return Promise.resolve({ error: null });
          },
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      return {
        upsert: () => Promise.resolve({ error: null }),
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      };
    },
  };

  return { admin, snapshotCalls, coverageCalls, fromCalls };
}

// ─── Dry-run ───────────────────────────────────────────────────────────────────

describe('runGtRgaeSnapshotWriter — dry-run', () => {
  it('mapea candidatos y valida sin calls a DB', async () => {
    const candidates = makeCandidates(3);
    const { admin, snapshotCalls, coverageCalls } = makeFakeAdmin();

    const result = await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun: true,
      supabaseAdmin: admin,
    });

    assert.equal(result.snapshotRowsPrepared, 3);
    assert.equal(result.rowsWritten, 0);
    assert.equal(result.coverageWritten, false);
    assert.equal(snapshotCalls.length, 0);
    assert.equal(coverageCalls.length, 0);
  });

  it('default es dry-run si no se pasa dryRun', async () => {
    const result = await runGtRgaeSnapshotWriter(makeCandidates(2), { sourceYear: 2025 });
    assert.equal(result.dryRun, true);
    assert.equal(result.rowsWritten, 0);
  });

  it('invariant violations calculadas sin write', async () => {
    const result = await runGtRgaeSnapshotWriter(makeCandidates(2), {
      sourceYear: 2025,
      dryRun: true,
    });
    assert.equal(result.invariantViolations, 0);
  });
});

// ─── Apply válido ──────────────────────────────────────────────────────────────

describe('runGtRgaeSnapshotWriter — apply', () => {
  it('batch size 50: 51 candidates = 2 batches', async () => {
    const candidates = makeCandidates(51);
    const { admin, snapshotCalls } = makeFakeAdmin();

    await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun: false,
      dryRunSummary: makeBaseSummary(),
      supabaseAdmin: admin,
    });

    assert.equal(snapshotCalls.length, 2);
    assert.equal((snapshotCalls[0]!.rows as unknown[]).length, 50);
    assert.equal((snapshotCalls[1]!.rows as unknown[]).length, 1);
  });

  it('onConflict exacto en cada upsert', async () => {
    const candidates = makeCandidates(2);
    const { admin, snapshotCalls } = makeFakeAdmin();

    await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun: false,
      dryRunSummary: makeBaseSummary(),
      supabaseAdmin: admin,
    });

    const upsertOpts = snapshotCalls[0]!.opts as { onConflict: string; ignoreDuplicates: boolean };
    assert.equal(upsertOpts.onConflict, 'source_key,country_code,source_year,record_identity_key');
    assert.equal(upsertOpts.ignoreDuplicates, false);
  });

  it('rowsWritten correcto', async () => {
    const candidates = makeCandidates(10);
    const { admin } = makeFakeAdmin();

    const result = await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun: false,
      dryRunSummary: makeBaseSummary(),
      supabaseAdmin: admin,
    });

    assert.equal(result.rowsWritten, 10);
  });

  it('coverage escrito solo después del último batch exitoso', async () => {
    const candidates = makeCandidates(10);
    const { admin, coverageCalls } = makeFakeAdmin();

    const result = await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun: false,
      dryRunSummary: makeBaseSummary(),
      supabaseAdmin: admin,
    });

    assert.equal(result.coverageWritten, true);
    assert.equal(coverageCalls.length, 1);
  });

  it('re-apply no hace delete, mismo path upsert', async () => {
    const candidates = makeCandidates(3);
    const { admin, fromCalls } = makeFakeAdmin();

    await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun: false,
      dryRunSummary: makeBaseSummary(),
      supabaseAdmin: admin,
    });

    assert.equal(fromCalls.includes('delete'), false);
    assert.equal(fromCalls.includes('source_company_snapshots'), true);
  });
});

// ─── EC4D5.C2 — record identity shadow ─────────────────────────────────────────

describe('runGtRgaeSnapshotWriter — record identity shadow (EC4D5.C2)', () => {
  it('cada fila upserted incluye record_identity_key = tax:<normalized_nit>', async () => {
    const candidates = [
      makeCandidate({ normalizedNit: '1234567' }),
      makeCandidate({ normalizedNit: '7654321' }),
    ];
    const { admin, snapshotCalls } = makeFakeAdmin();

    await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun: false,
      dryRunSummary: makeBaseSummary(),
      supabaseAdmin: admin,
    });

    const rows = snapshotCalls[0]!.rows as Array<{ normalized_tax_id: string; record_identity_key: string | null }>;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.record_identity_key, `tax:${row.normalized_tax_id}`);
    }
  });

  it('recordIdentityShadow.resolved_count refleja filas con NIT válido, sin excluir filas', async () => {
    const candidates = makeCandidates(5);
    const { admin } = makeFakeAdmin();

    const result = await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun: false,
      dryRunSummary: makeBaseSummary(),
      supabaseAdmin: admin,
    });

    assert.equal(result.recordIdentityShadow.resolved_count, 5);
    assert.equal(result.recordIdentityShadow.unavailable_count, 0);
    assert.equal(result.snapshotRowsPrepared, 5);
    assert.equal(result.rowsWritten, 5);
  });

  it('dry-run también calcula recordIdentityShadow sin escribir', async () => {
    const candidates = makeCandidates(3);

    const result = await runGtRgaeSnapshotWriter(candidates, { sourceYear: 2025, dryRun: true });

    assert.equal(result.recordIdentityShadow.resolved_count, 3);
    assert.equal(result.rowsWritten, 0);
  });

  it('onConflict usa el grain de identidad de registro (RECORD_IDENTITY_ON_CONFLICT — APP-D4)', async () => {
    const candidates = makeCandidates(2);
    const { admin, snapshotCalls } = makeFakeAdmin();

    const result = await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun: false,
      dryRunSummary: makeBaseSummary(),
      supabaseAdmin: admin,
    });

    const upsertOpts = snapshotCalls[0]!.opts as { onConflict: string };
    assert.equal(upsertOpts.onConflict, 'source_key,country_code,source_year,record_identity_key');
    assert.equal(result.conflictsTarget, 'source_key,country_code,source_year,record_identity_key');
  });
});

// ─── APP-B P2B — record_identity_key boundary ──────────────────────────────────

describe('runGtRgaeSnapshotWriter — record_identity_key boundary (APP-B P2B)', () => {
  it('todas las filas con NIT válido pasan validateRecordIdentityKey y quedan allowedCount === rowsWritten', async () => {
    const candidates = makeCandidates(5);
    const { admin } = makeFakeAdmin();

    const result = await runGtRgaeSnapshotWriter(candidates, {
      sourceYear: 2025,
      dryRun: false,
      dryRunSummary: makeBaseSummary(),
      supabaseAdmin: admin,
    });

    assert.ok(result.recordIdentityBoundary);
    assert.equal(result.recordIdentityBoundary!.allowedCount, 5);
    assert.equal(result.recordIdentityBoundary!.blockedCount, 0);
    assert.equal(result.rowsWritten, 5);
  });

  it('una fila con record_identity_key resuelto (tax:<nit>) pasa validateRecordIdentityKey (función pura)', () => {
    const identity = deriveTaxRecordIdentity('1234567');
    assert.equal(identity.status, 'resolved');
    if (identity.status !== 'resolved') return;

    const validation = validateRecordIdentityKey(identity.recordIdentityKey);
    assert.equal(validation.valid, true);
  });

  it('un record_identity_key ausente (NIT normalizado vacío) falla validateRecordIdentityKey (función pura)', () => {
    const identity = deriveTaxRecordIdentity('');
    assert.equal(identity.status, 'unavailable');

    // identity.status is already asserted 'unavailable' above, so record_identity_key is null.
    const recordIdentityKey: string | null = null;
    const validation = validateRecordIdentityKey(recordIdentityKey);
    assert.equal(validation.valid, false);
    if (validation.valid) return;
    assert.equal(validation.reason, 'missing_value');
  });

  it('el boundary P2B sigue activo y el writer usa RECORD_IDENTITY_ON_CONFLICT (APP-D4)', () => {
    const source = readFileSync(
      new URL('../gt-rgae-snapshot-writer.ts', import.meta.url),
      'utf-8',
    );
    assert.ok(source.includes('validateRecordIdentityKey'));
    assert.ok(source.includes('RECORD_IDENTITY_ON_CONFLICT'));
    assert.ok(!source.includes('OLD_TAX_GRAIN_ON_CONFLICT'));
  });
});

// ─── Batch failure ─────────────────────────────────────────────────────────────

describe('runGtRgaeSnapshotWriter — batch failure', () => {
  it('fallo en batch 2: coverage no se llama', async () => {
    const candidates = makeCandidates(51);
    const { admin, coverageCalls } = makeFakeAdmin({ snapshotErrorOnBatch: 2 });

    await assert.rejects(
      () => runGtRgaeSnapshotWriter(candidates, {
        sourceYear: 2025,
        dryRun: false,
        dryRunSummary: makeBaseSummary(),
        supabaseAdmin: admin,
      }),
      /upsert_source_company_snapshots/,
    );

    assert.equal(coverageCalls.length, 0);
  });

  it('error propagado con mensaje semántico', async () => {
    const candidates = makeCandidates(2);
    const { admin } = makeFakeAdmin({ snapshotError: { message: 'connection refused' } });

    await assert.rejects(
      () => runGtRgaeSnapshotWriter(candidates, {
        sourceYear: 2025,
        dryRun: false,
        dryRunSummary: makeBaseSummary(),
        supabaseAdmin: admin,
      }),
      /upsert_source_company_snapshots/,
    );
  });
});

// ─── Invariant violation ───────────────────────────────────────────────────────

describe('runGtRgaeSnapshotWriter — invariant violation', () => {
  it('0 upsert calls cuando hay invariant violation en apply', async () => {
    const candidates = makeCandidates(2);
    const { admin, snapshotCalls } = makeFakeAdmin();

    // Forzar violation: candidato con NIT con letras
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (candidates[0] as any).normalizedNit = 'INVALID';

    await assert.rejects(
      () => runGtRgaeSnapshotWriter(candidates, {
        sourceYear: 2025,
        dryRun: false,
        dryRunSummary: makeBaseSummary(),
        supabaseAdmin: admin,
      }),
      /snapshot_invariant_violation/,
    );

    assert.equal(snapshotCalls.length, 0);
  });
});

// ─── Zero candidates ───────────────────────────────────────────────────────────

describe('runGtRgaeSnapshotWriter — zero candidates', () => {
  it('apply bloqueado con zero_candidates', async () => {
    const { admin } = makeFakeAdmin();
    await assert.rejects(
      () => runGtRgaeSnapshotWriter([], {
        sourceYear: 2025,
        dryRun: false,
        dryRunSummary: makeBaseSummary(),
        supabaseAdmin: admin,
      }),
      /zero_candidates/,
    );
  });
});
