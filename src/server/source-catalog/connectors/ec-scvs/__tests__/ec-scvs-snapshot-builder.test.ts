/**
 * Tests — EC SCVS Offline Snapshot Builder
 * Sin red, sin DB, sin filesystem, sin proveedores. Hito: EC-SCVS-2.
 *
 * NOTA: la spec sugería `tests/`; el repo usa `__tests__/` de forma
 * consistente en todos los conectores, así que se sigue la convención real.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEcScvsSnapshotRows } from '../ec-scvs-snapshot-builder';
import type { EcScvsRawRow } from '../ec-scvs-types';

const SAMPLE_YEAR = 2025; // Año de EJEMPLO — es input del builder, nunca hardcode.

function row(overrides: Partial<EcScvsRawRow> = {}): EcScvsRawRow {
  return {
    expediente: '12345',
    ruc: '1790013731001',
    nombre: 'ACME SA',
    tipo: 'ANONIMA',
    pro_codigo: '17',
    provincia: 'PICHINCHA',
    ...overrides,
  };
}

function build(rows: EcScvsRawRow[], sourceYear: number = SAMPLE_YEAR) {
  return buildEcScvsSnapshotRows({ rows, sourceYear });
}

describe('buildEcScvsSnapshotRows', () => {
  // 1 — fila válida con expediente + RUC válido
  it('acepta fila con expediente + RUC válido y produce identidad + tax', () => {
    const result = build([row()]);
    assert.equal(result.rows.length, 1);
    const snap = result.rows[0]!;
    assert.equal(snap.record_identity_key, 'expediente:12345');
    assert.equal(snap.normalized_tax_id, '1790013731001');
    assert.equal(snap.tax_id, '1790013731001');
    assert.equal(snap.source_key, 'ec_scvs');
    assert.equal(snap.country_code, 'EC');
    assert.equal(snap.source_year, SAMPLE_YEAR);
    assert.equal(snap.legal_name, 'ACME SA');
    assert.equal(snap.raw_data.expediente, '12345');
    assert.equal(snap.raw_data.ruc, '1790013731001');
    assert.equal(snap.raw_data.tipo, 'ANONIMA');
    assert.equal(snap.raw_data.pro_codigo, '17');
    assert.equal(snap.raw_data.provincia, 'PICHINCHA');
    assert.equal(snap.raw_data.ruc_normalization_status, 'valid');
    assert.equal(snap.raw_data.source_type, 'official_company_registry');
    assert.equal(result.rejected.length, 0);
  });

  // 2 — expediente con espacios: trim aplicado, key estable
  it('aplica trim al expediente y produce una key estable', () => {
    const result = build([row({ expediente: '  12345  ' })]);
    assert.equal(result.rows[0]?.record_identity_key, 'expediente:12345');
  });

  // 3 — expediente válido y RUC faltante: aceptada, tax null, sin rejection
  it('acepta expediente-only (RUC faltante) con normalized_tax_id null', () => {
    const result = build([row({ ruc: null })]);
    assert.equal(result.rows.length, 1);
    const snap = result.rows[0]!;
    assert.equal(snap.record_identity_key, 'expediente:12345');
    assert.equal(snap.normalized_tax_id, null);
    assert.equal(snap.tax_id, null);
    assert.equal(snap.raw_data.ruc_normalization_status, 'missing');
    assert.equal(result.rejected.length, 0);
  });

  // 4 — expediente válido y RUC inválido: aceptada, tax null, status invalid
  it('acepta expediente con RUC inválido; normalized_tax_id null y estado invalid_format', () => {
    const result = build([row({ ruc: 'ABC123' })]);
    assert.equal(result.rows.length, 1);
    const snap = result.rows[0]!;
    assert.equal(snap.normalized_tax_id, null);
    assert.equal(snap.tax_id, 'ABC123'); // raw preservado para trazabilidad
    assert.equal(snap.raw_data.ruc_normalization_status, 'invalid_format');
    assert.equal(result.rejected.length, 0);
  });

  // 5 — fila sin expediente: rechazada, sin identity
  it('rechaza fila sin expediente y no produce record_identity_key', () => {
    const result = build([row({ expediente: null })]);
    assert.equal(result.rows.length, 0);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0]?.reason, 'missing_expediente');
    assert.equal(result.rejected[0]?.recordIdentityKey, null);
  });

  it('rechaza fila con expediente en blanco (solo espacios)', () => {
    const result = build([row({ expediente: '   ' })]);
    assert.equal(result.rows.length, 0);
    assert.equal(result.rejected[0]?.reason, 'missing_expediente');
  });

  // 6 — nombre vacío: no bloquea, legal_name null
  it('nombre vacío no bloquea si expediente es válido; legal_name null', () => {
    const result = build([row({ nombre: null })]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.legal_name, null);
    assert.equal(result.rows[0]?.record_identity_key, 'expediente:12345');
  });

  it('nombre solo-espacios se normaliza a null sin bloquear', () => {
    const result = build([row({ nombre: '   ' })]);
    assert.equal(result.rows[0]?.legal_name, null);
  });

  // 7 — nombre nunca se usa como identidad
  it('nunca produce una identidad con namespace name:', () => {
    const result = build([
      row({ expediente: '77', nombre: 'IDENTITY BAIT SA' }),
      row({ expediente: null, nombre: 'SHOULD NOT BECOME IDENTITY' }),
    ]);
    for (const snap of result.rows) {
      assert.ok(!snap.record_identity_key.toLowerCase().startsWith('name:'));
    }
  });

  // 8 — RUC nunca se usa como identidad (nunca tax:)
  it('nunca produce una identidad con namespace tax: (RUC no es identidad EC)', () => {
    const result = build([row({ expediente: '88', ruc: '1790013731001' })]);
    assert.equal(result.rows[0]?.record_identity_key, 'expediente:88');
    assert.ok(!result.rows[0]!.record_identity_key.toLowerCase().startsWith('tax:'));
  });

  // 9 — sourceYear inválido: error controlado
  it('lanza error controlado con sourceYear no entero', () => {
    assert.throws(() => build([row()], 2025.5), /sourceYear must be a positive integer/);
  });

  it('lanza error controlado con sourceYear null/NaN/no positivo', () => {
    assert.throws(
      () => buildEcScvsSnapshotRows({ rows: [row()], sourceYear: null as unknown as number }),
      /sourceYear must be a positive integer/,
    );
    assert.throws(() => build([row()], Number.NaN), /sourceYear must be a positive integer/);
    assert.throws(() => build([row()], 0), /sourceYear must be a positive integer/);
    assert.throws(() => build([row()], -2025), /sourceYear must be a positive integer/);
  });

  // 10 — duplicados por RUC con expedientes distintos
  it('duplicados por RUC con expedientes distintos → dos rows con identidades distintas', () => {
    const result = build([
      row({ expediente: '100', ruc: '1790013731001' }),
      row({ expediente: '200', ruc: '1790013731001' }),
    ]);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.record_identity_key, 'expediente:100');
    assert.equal(result.rows[1]?.record_identity_key, 'expediente:200');
    // mismo normalized_tax_id permitido en NATIVE_RECORD_GRAIN
    assert.equal(result.rows[0]?.normalized_tax_id, '1790013731001');
    assert.equal(result.rows[1]?.normalized_tax_id, '1790013731001');
    assert.equal(result.summary.distinctNormalizedTaxIds, 1);
    assert.equal(result.rejected.length, 0);
  });

  // 11 — expediente duplicado dentro del mismo input
  it('expediente duplicado → primera aceptada, resto rechazadas (no rows idénticas silenciosas)', () => {
    const result = build([
      row({ expediente: '55', ruc: '1790013731001' }),
      row({ expediente: '55', ruc: '0990013731001' }),
      row({ expediente: ' 55 ', nombre: 'OTRO NOMBRE' }),
    ]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.record_identity_key, 'expediente:55');
    assert.equal(result.rejected.length, 2);
    for (const rej of result.rejected) {
      assert.equal(rej.reason, 'duplicate_record_identity_key');
      assert.equal(rej.recordIdentityKey, 'expediente:55');
    }
    assert.equal(result.summary.rejectedDuplicateRecordIdentity, 2);
  });

  // Metadata de procedencia opcional (raw_data)
  it('propaga metadata de procedencia a raw_data solo cuando viene en el input', () => {
    const withMeta = buildEcScvsSnapshotRows({
      rows: [row()],
      sourceYear: SAMPLE_YEAR,
      sourceFileName: 'bi_compania.csv',
      sourceDownloadedAt: '2025-01-01T00:00:00.000Z',
      importBatchId: 'batch-abc',
    });
    const raw = withMeta.rows[0]!.raw_data;
    assert.equal(raw.source_file_name, 'bi_compania.csv');
    assert.equal(raw.source_downloaded_at, '2025-01-01T00:00:00.000Z');
    assert.equal(raw.import_batch_id, 'batch-abc');

    const withoutMeta = build([row()]);
    const rawNo = withoutMeta.rows[0]!.raw_data;
    assert.equal('source_file_name' in rawNo, false);
    assert.equal('source_downloaded_at' in rawNo, false);
    assert.equal('import_batch_id' in rawNo, false);
  });

  // 13 — output no toca Supabase / invariantes de no-escritura
  it('el resultado no escribe nada (invariantes db_writes/snapshot_writes = 0)', () => {
    const result = build([row(), row({ expediente: null })]);
    assert.equal(result.summary.db_writes, 0);
    assert.equal(result.summary.snapshot_writes, 0);
    assert.equal(result.summary.totalSourceRows, 2);
    assert.equal(result.summary.acceptedRows, 1);
    assert.equal(result.summary.rejectedRows, 1);
  });

  it('summary agrega conteos de tax presente/ausente', () => {
    const result = build([
      row({ expediente: '1', ruc: '1790013731001' }),
      row({ expediente: '2', ruc: null }),
      row({ expediente: '3', ruc: 'ABC' }),
    ]);
    assert.equal(result.summary.acceptedRows, 3);
    assert.equal(result.summary.rowsWithNormalizedTaxId, 1);
    assert.equal(result.summary.rowsWithoutTaxId, 2);
    assert.equal(result.summary.distinctRecordIdentityKeys, 3);
  });

  it('input vacío produce resultado vacío sin lanzar', () => {
    const result = build([]);
    assert.equal(result.rows.length, 0);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.summary.totalSourceRows, 0);
  });
});
