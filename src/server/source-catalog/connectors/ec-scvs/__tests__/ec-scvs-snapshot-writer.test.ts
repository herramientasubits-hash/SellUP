/**
 * EC SCVS — Snapshot Writer tests
 *
 * Cubre EC-SCVS-3: dry-run default, partición/boundary, non-dry-run con fake
 * Supabase, RECORD_IDENTITY_ON_CONFLICT, batches, error handling, y las
 * invariantes de identidad nativa (expediente).
 *
 * Hito: EC-SCVS-3 — Writer/importer con RECORD_IDENTITY_ON_CONFLICT, dry-run first.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

import { runEcScvsSnapshotImport } from '../ec-scvs-snapshot-writer';
import type { EcScvsSupabaseAdminLike } from '../ec-scvs-snapshot-writer';
import { buildEcScvsSnapshotRows } from '../ec-scvs-snapshot-builder';
import type { EcScvsSnapshotRow } from '../ec-scvs-snapshot-builder';
import type { EcScvsRawRow } from '../ec-scvs-types';
import type { RecordIdentityKey } from '../../../record-identity';

// ─── Fixture helpers ────────────────────────────────────────────────────────────

function rawRow(overrides: Partial<EcScvsRawRow> = {}): EcScvsRawRow {
  return {
    expediente: '900001',
    ruc: '1790012345001',
    nombre: 'EMPRESA EJEMPLO S.A.',
    tipo: 'ANONIMA',
    pro_codigo: '17',
    provincia: 'PICHINCHA',
    ...overrides,
  };
}

/** Construye N filas de snapshot válidas vía el builder real (expedientes únicos). */
function buildValidRows(count: number, sourceYear = 2024): EcScvsSnapshotRow[] {
  const rows: EcScvsRawRow[] = Array.from({ length: count }, (_, i) =>
    rawRow({ expediente: `9${String(100000 + i)}` }),
  );
  return buildEcScvsSnapshotRows({ rows, sourceYear }).rows;
}

function oneValidRow(overrides: Partial<EcScvsRawRow> = {}, sourceYear = 2024): EcScvsSnapshotRow {
  return buildEcScvsSnapshotRows({ rows: [rawRow(overrides)], sourceYear }).rows[0]!;
}

type UpsertCall = { rows: unknown[]; opts: unknown };

/** Fake Supabase admin. Registra llamadas; opcionalmente falla en un batch. */
function makeFakeAdmin(
  opts: {
    errorOnBatch?: number; // índice 1-based del batch que falla
    errorMessage?: string;
  } = {},
): {
  admin: EcScvsSupabaseAdminLike;
  upsertCalls: UpsertCall[];
  fromTables: string[];
} {
  const upsertCalls: UpsertCall[] = [];
  const fromTables: string[] = [];

  const admin: EcScvsSupabaseAdminLike = {
    from: (table: string) => {
      fromTables.push(table);
      return {
        upsert: (rows: unknown[], upsertOpts: unknown) => {
          upsertCalls.push({ rows, opts: upsertOpts });
          const batchNumber = upsertCalls.length;
          if (opts.errorOnBatch !== undefined && batchNumber === opts.errorOnBatch) {
            return Promise.resolve({ error: { message: opts.errorMessage ?? 'DB timeout' } });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { admin, upsertCalls, fromTables };
}

// ─── 1. Dry-run default: sin cliente, sin calls ──────────────────────────────────

describe('runEcScvsSnapshotImport — dry-run default', () => {
  it('default es dry-run: no requiere cliente Supabase y no hace calls', async () => {
    const rows = buildValidRows(3);
    const result = await runEcScvsSnapshotImport({ snapshotRows: rows });

    assert.equal(result.dryRun, true);
    assert.equal(result.status, 'dry_run');
    assert.equal(result.upsertedRows, 0);
    assert.equal(result.batches, 0);
    assert.equal(result.validRows, 3);
    assert.equal(result.rejectedRows, 0);
    assert.equal(result.errors.length, 0);
  });

  it('dry-run explícito no llama al fake Supabase aunque se pase', async () => {
    const rows = buildValidRows(2);
    const { admin, upsertCalls, fromTables } = makeFakeAdmin();

    await runEcScvsSnapshotImport({ snapshotRows: rows, dryRun: true, supabase: admin });

    assert.equal(upsertCalls.length, 0);
    assert.equal(fromTables.length, 0);
  });
});

// ─── 2. Dry-run acepta filas válidas (tax null / name null) ──────────────────────

describe('runEcScvsSnapshotImport — filas aceptadas', () => {
  it('acepta fila con normalized_tax_id null (RUC ausente) y legal_name null', async () => {
    const row = oneValidRow({ ruc: null, nombre: null });
    assert.equal(row.normalized_tax_id, null);
    assert.equal(row.legal_name, null);

    const result = await runEcScvsSnapshotImport({ snapshotRows: [row] });

    assert.equal(result.validRows, 1);
    assert.equal(result.rejectedRows, 0);
  });

  it('acepta fila con RUC inválido (normalized_tax_id null) pero expediente válido', async () => {
    const row = oneValidRow({ ruc: 'NO-ES-RUC' });
    assert.equal(row.normalized_tax_id, null);

    const result = await runEcScvsSnapshotImport({ snapshotRows: [row] });
    assert.equal(result.validRows, 1);
    assert.equal(result.rejectedRows, 0);
  });
});

// ─── 3-8. Rechazos ───────────────────────────────────────────────────────────────

describe('runEcScvsSnapshotImport — rechazos de boundary', () => {
  it('3. rechaza missing record_identity_key', async () => {
    const row = { ...oneValidRow(), record_identity_key: null as unknown as RecordIdentityKey };
    const result = await runEcScvsSnapshotImport({ snapshotRows: [row] });

    assert.equal(result.validRows, 0);
    assert.equal(result.rejectedRows, 1);
    assert.equal(result.rejections[0]!.reason, 'missing_record_identity_key');
    assert.equal(result.summary.rejectionBreakdown.missing_record_identity_key, 1);
  });

  it('4. rechaza wrong source_key', async () => {
    const row = { ...oneValidRow(), source_key: 'gt_rgae_proveedores' as unknown as EcScvsSnapshotRow['source_key'] };
    const result = await runEcScvsSnapshotImport({ snapshotRows: [row] });

    assert.equal(result.validRows, 0);
    assert.equal(result.rejections[0]!.reason, 'wrong_source_key');
  });

  it('5. rechaza wrong country_code', async () => {
    const row = { ...oneValidRow(), country_code: 'GT' as unknown as EcScvsSnapshotRow['country_code'] };
    const result = await runEcScvsSnapshotImport({ snapshotRows: [row] });

    assert.equal(result.validRows, 0);
    assert.equal(result.rejections[0]!.reason, 'wrong_country_code');
  });

  it('6. rechaza invalid source_year', async () => {
    const row = { ...oneValidRow(), source_year: 0 };
    const result = await runEcScvsSnapshotImport({ snapshotRows: [row] });

    assert.equal(result.validRows, 0);
    assert.equal(result.rejections[0]!.reason, 'invalid_source_year');
  });

  it('7. rechaza namespace distinto de expediente (p. ej. tax:)', async () => {
    const row = {
      ...oneValidRow(),
      record_identity_key: 'tax:1790012345001' as unknown as RecordIdentityKey,
    };
    const result = await runEcScvsSnapshotImport({ snapshotRows: [row] });

    assert.equal(result.validRows, 0);
    assert.equal(result.rejections[0]!.reason, 'unexpected_identity_namespace');
    assert.equal(result.rejections[0]!.recordIdentityKey, 'tax:1790012345001');
  });

  it('rechaza record_identity_key estructuralmente inválido (sin namespace)', async () => {
    const row = {
      ...oneValidRow(),
      record_identity_key: 'sin-separador' as unknown as RecordIdentityKey,
    };
    const result = await runEcScvsSnapshotImport({ snapshotRows: [row] });

    assert.equal(result.validRows, 0);
    assert.equal(result.rejections[0]!.reason, 'invalid_record_identity_key');
  });

  it('8. rechaza duplicate record_identity_key dentro del mismo source/country/year', async () => {
    const base = oneValidRow({ expediente: '900777' });
    const dup = { ...base }; // misma identidad, mismo año
    const result = await runEcScvsSnapshotImport({ snapshotRows: [base, dup] });

    assert.equal(result.validRows, 1);
    assert.equal(result.rejectedRows, 1);
    assert.equal(result.rejections[0]!.reason, 'duplicate_record_identity_key');
    assert.equal(result.rejections[0]!.sourceRowIndex, 1);
  });
});

// ─── 9. Non-dry-run requiere cliente ─────────────────────────────────────────────

describe('runEcScvsSnapshotImport — apply requiere cliente', () => {
  it('9. non-dry-run sin cliente lanza supabase_client_required', async () => {
    const rows = buildValidRows(2);
    await assert.rejects(
      () => runEcScvsSnapshotImport({ snapshotRows: rows, dryRun: false }),
      /supabase_client_required/,
    );
  });
});

// ─── 10-11. Non-dry-run upsert: tabla + onConflict ───────────────────────────────

describe('runEcScvsSnapshotImport — apply upsert', () => {
  it('10. upsert usa la tabla source_company_snapshots', async () => {
    const rows = buildValidRows(3);
    const { admin, fromTables } = makeFakeAdmin();

    const result = await runEcScvsSnapshotImport({ snapshotRows: rows, dryRun: false, supabase: admin });

    assert.equal(result.status, 'success');
    assert.equal(result.upsertedRows, 3);
    assert.ok(fromTables.every((t) => t === 'source_company_snapshots'));
    assert.equal(fromTables.includes('source_company_snapshots'), true);
  });

  it('11. upsert usa RECORD_IDENTITY_ON_CONFLICT', async () => {
    const rows = buildValidRows(2);
    const { admin, upsertCalls } = makeFakeAdmin();

    const result = await runEcScvsSnapshotImport({ snapshotRows: rows, dryRun: false, supabase: admin });

    const upsertOpts = upsertCalls[0]!.opts as { onConflict: string; ignoreDuplicates: boolean };
    assert.equal(upsertOpts.onConflict, 'source_key,country_code,source_year,record_identity_key');
    assert.equal(upsertOpts.ignoreDuplicates, false);
    assert.equal(result.summary.conflictTarget, 'source_key,country_code,source_year,record_identity_key');
  });
});

// ─── 12. batchSize se respeta ────────────────────────────────────────────────────

describe('runEcScvsSnapshotImport — batching', () => {
  it('12. batchSize=2 con 5 filas => 3 batches (2,2,1)', async () => {
    const rows = buildValidRows(5);
    const { admin, upsertCalls } = makeFakeAdmin();

    const result = await runEcScvsSnapshotImport({
      snapshotRows: rows,
      dryRun: false,
      batchSize: 2,
      supabase: admin,
    });

    assert.equal(result.batches, 3);
    assert.equal(upsertCalls.length, 3);
    assert.equal((upsertCalls[0]!.rows as unknown[]).length, 2);
    assert.equal((upsertCalls[1]!.rows as unknown[]).length, 2);
    assert.equal((upsertCalls[2]!.rows as unknown[]).length, 1);
    assert.equal(result.summary.batchSize, 2);
  });

  it('batchSize inválido lanza invalid_batch_size', async () => {
    const rows = buildValidRows(2);
    const { admin } = makeFakeAdmin();
    await assert.rejects(
      () => runEcScvsSnapshotImport({ snapshotRows: rows, dryRun: false, batchSize: 0, supabase: admin }),
      /invalid_batch_size/,
    );
  });
});

// ─── 13. Batch error se reporta y no se oculta ───────────────────────────────────

describe('runEcScvsSnapshotImport — error handling', () => {
  it('13. fallo en batch 2 se reporta, se detiene y no se oculta', async () => {
    const rows = buildValidRows(5);
    const { admin, upsertCalls } = makeFakeAdmin({ errorOnBatch: 2, errorMessage: 'connection refused' });

    const result = await runEcScvsSnapshotImport({
      snapshotRows: rows,
      dryRun: false,
      batchSize: 2,
      supabase: admin,
    });

    assert.equal(result.status, 'partial_failure');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.batchIndex, 1);
    assert.match(result.errors[0]!.message, /connection refused/);
    // fail-fast: batch 1 ok (2 filas), batch 2 falla, batch 3 nunca se intenta.
    assert.equal(result.upsertedRows, 2);
    assert.equal(upsertCalls.length, 2);
  });

  it('fallo en el primer batch => status failed, 0 writes', async () => {
    const rows = buildValidRows(3);
    const { admin } = makeFakeAdmin({ errorOnBatch: 1 });

    const result = await runEcScvsSnapshotImport({
      snapshotRows: rows,
      dryRun: false,
      batchSize: 2,
      supabase: admin,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.upsertedRows, 0);
    assert.equal(result.errors.length, 1);
  });
});

// ─── 14. No usa OLD_TAX_GRAIN_ON_CONFLICT (static) ───────────────────────────────

describe('runEcScvsSnapshotImport — static safety', () => {
  it('14. el writer no referencia OLD_TAX_GRAIN_ON_CONFLICT ni el old tax conflict target', () => {
    const source = readFileSync(new URL('../ec-scvs-snapshot-writer.ts', import.meta.url), 'utf-8');
    assert.ok(source.includes('RECORD_IDENTITY_ON_CONFLICT'));
    assert.ok(!source.includes('OLD_TAX_GRAIN_ON_CONFLICT'));
    assert.ok(!source.includes('source_key,country_code,source_year,normalized_tax_id'));
  });
});

// ─── 15-16. No dedup por RUC ─────────────────────────────────────────────────────

describe('runEcScvsSnapshotImport — RUC no es identidad', () => {
  it('16. acepta dos filas con mismo normalized_tax_id y distinto record_identity_key', async () => {
    // Mismo RUC, dos expedientes distintos => dos identidades de registro distintas.
    const rowA = oneValidRow({ expediente: '900111', ruc: '1790012345001' });
    const rowB = oneValidRow({ expediente: '900222', ruc: '1790012345001' });
    assert.equal(rowA.normalized_tax_id, rowB.normalized_tax_id);
    assert.notEqual(rowA.record_identity_key, rowB.record_identity_key);

    const { admin } = makeFakeAdmin();
    const result = await runEcScvsSnapshotImport({
      snapshotRows: [rowA, rowB],
      dryRun: false,
      supabase: admin,
    });

    assert.equal(result.validRows, 2);
    assert.equal(result.upsertedRows, 2);
    assert.equal(result.rejectedRows, 0);
  });
});

// ─── 17-18. Coverage/signals fuera de scope + summary estable ────────────────────

describe('runEcScvsSnapshotImport — summary', () => {
  it('17. no escribe coverage ni signals (fuera de scope)', async () => {
    const rows = buildValidRows(2);
    const { admin, fromTables } = makeFakeAdmin();

    const result = await runEcScvsSnapshotImport({ snapshotRows: rows, dryRun: false, supabase: admin });

    assert.equal(result.summary.coverageWritten, false);
    assert.equal(result.summary.signalsWritten, false);
    assert.equal(fromTables.includes('source_coverage_summaries'), false);
    assert.equal(fromTables.includes('source_company_signals'), false);
  });

  it('18. output summary es estable y consistente (valid + rejected = total)', async () => {
    const valid = buildValidRows(2);
    const bad = { ...oneValidRow({ expediente: '900999' }), source_key: 'x' as unknown as EcScvsSnapshotRow['source_key'] };
    const result = await runEcScvsSnapshotImport({ snapshotRows: [...valid, bad] });

    assert.equal(result.totalRows, 3);
    assert.equal(result.validRows + result.rejectedRows, result.totalRows);
    assert.equal(result.skippedRows, result.rejectedRows);
    assert.equal(result.summary.sourceKey, 'ec_scvs');
    assert.equal(result.summary.countryCode, 'EC');
    assert.equal(result.summary.conflictTarget, 'source_key,country_code,source_year,record_identity_key');
  });
});
