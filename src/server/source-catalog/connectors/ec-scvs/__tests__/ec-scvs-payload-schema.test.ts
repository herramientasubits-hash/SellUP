/**
 * EC SCVS — Payload schema tests (EC-SCVS-6E)
 *
 * Regresión del fallo de apply productivo diagnosticado en EC-SCVS-6D-DIAG:
 * el payload arrastraba una columna top-level `status` que NO existe en
 * `source_company_snapshots`, provocando PGRST204 y 0 filas escritas.
 *
 * Estos tests fijan el contrato de forma del payload:
 *   - el builder no emite `status` top-level (vive en raw_data.source_status);
 *   - las keys top-level de la fila son subconjunto de columnas válidas;
 *   - el writer NUNCA envía columnas inexistentes al upsert, aunque una fila
 *     regrese con una key extra (barrera defensiva `toPersistableSnapshotPayload`).
 *
 * Sin red, sin DB, sin filesystem, sin proveedores. Todo con fakes.
 *
 * NOTA: el repo usa `__tests__/` consistentemente; se sigue esa convención.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildEcScvsSnapshotRows } from '../ec-scvs-snapshot-builder';
import type { EcScvsSnapshotRow } from '../ec-scvs-snapshot-builder';
import {
  runEcScvsSnapshotImport,
  toPersistableSnapshotPayload,
  EC_SCVS_PERSISTABLE_COLUMNS,
} from '../ec-scvs-snapshot-writer';
import type { EcScvsSupabaseAdminLike } from '../ec-scvs-snapshot-writer';
import type { EcScvsRawRow } from '../ec-scvs-types';

// ─── Columnas reales de source_company_snapshots ─────────────────────────────
// Fuente de verdad del schema físico (per EC-SCVS-6D-DIAG). La tabla NO tiene
// columna `status`. Se declara aquí como dato de test (no se toca la DB).
const SOURCE_COMPANY_SNAPSHOTS_COLUMNS = new Set<string>([
  'id',
  'source_key',
  'country_code',
  'source_year',
  'tax_id',
  'legal_name',
  'normalized_tax_id',
  'normalized_legal_name',
  'sector',
  'city',
  'department',
  'region',
  'priority_score',
  'signals',
  'financials',
  'raw_data',
  'imported_at',
  'record_identity_key',
]);

const SAMPLE_YEAR = 2025;

function rawRow(overrides: Partial<EcScvsRawRow> = {}): EcScvsRawRow {
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

/** Fake admin que captura el payload exacto pasado a .upsert(). */
function makeCapturingAdmin(): { admin: EcScvsSupabaseAdminLike; upserted: unknown[][] } {
  const upserted: unknown[][] = [];
  const admin: EcScvsSupabaseAdminLike = {
    from: () => ({
      upsert: (rows: unknown[]) => {
        upserted.push(rows);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { admin, upserted };
}

// ─── Builder: sin `status` top-level ─────────────────────────────────────────

describe('EC-SCVS-6E — builder no emite status top-level', () => {
  it('1. la fila del builder no tiene una key `status` top-level', () => {
    const snap = build([rawRow()]).rows[0]!;
    assert.equal('status' in snap, false);
  });

  it('2. el marcador de listado se conserva dentro de raw_data.source_status', () => {
    const snap = build([rawRow()]).rows[0]!;
    assert.equal(snap.raw_data.source_status, 'active_or_listed');
    // Y NO como columna top-level.
    assert.equal((snap as unknown as Record<string, unknown>).status, undefined);
  });

  it('3. las keys top-level de la fila ⊆ columnas válidas de source_company_snapshots', () => {
    const snap = build([rawRow()]).rows[0]!;
    for (const key of Object.keys(snap)) {
      assert.ok(
        SOURCE_COMPANY_SNAPSHOTS_COLUMNS.has(key),
        `key top-level inesperada en la fila: ${key}`,
      );
    }
  });

  it('el allowlist del writer es subconjunto de columnas válidas de la tabla', () => {
    for (const col of EC_SCVS_PERSISTABLE_COLUMNS) {
      assert.ok(
        SOURCE_COMPANY_SNAPSHOTS_COLUMNS.has(col),
        `columna persistible no válida: ${col}`,
      );
    }
  });
});

// ─── Writer: nunca envía columnas inexistentes ───────────────────────────────

describe('EC-SCVS-6E — writer sanitiza el payload persistible', () => {
  it('4. el payload enviado al fake Supabase solo tiene columnas válidas', async () => {
    const rows = build([
      rawRow({ expediente: '1' }),
      rawRow({ expediente: '2', ruc: null }),
    ]).rows;
    const { admin, upserted } = makeCapturingAdmin();

    const result = await runEcScvsSnapshotImport({
      snapshotRows: rows,
      dryRun: false,
      supabase: admin,
    });

    assert.equal(result.status, 'success');
    assert.ok(upserted.length > 0);
    for (const batch of upserted) {
      for (const row of batch as Record<string, unknown>[]) {
        for (const key of Object.keys(row)) {
          assert.ok(
            SOURCE_COMPANY_SNAPSHOTS_COLUMNS.has(key),
            `columna inexistente en payload: ${key}`,
          );
        }
      }
    }
  });

  it('5. una fila con `status` top-level inyectado NO llega al payload persistible', async () => {
    const clean = build([rawRow({ expediente: '9' })]).rows[0]!;
    // Simula un builder regresivo que reintroduce `status` top-level.
    const rogue = { ...clean, status: 'active_or_listed' } as unknown as EcScvsSnapshotRow;

    // La proyección pura descarta la key extra.
    const projected = toPersistableSnapshotPayload(rogue) as unknown as Record<string, unknown>;
    assert.equal('status' in projected, false);

    // Y el writer tampoco la envía al upsert.
    const { admin, upserted } = makeCapturingAdmin();
    const result = await runEcScvsSnapshotImport({
      snapshotRows: [rogue],
      dryRun: false,
      supabase: admin,
    });
    assert.equal(result.status, 'success');
    const sent = (upserted[0] as Record<string, unknown>[])[0]!;
    assert.equal('status' in sent, false);
    // El valor semántico sigue disponible en raw_data.
    assert.equal(
      (sent.raw_data as Record<string, unknown>).source_status,
      'active_or_listed',
    );
  });
});

// ─── Invariantes de identidad preservadas ────────────────────────────────────

describe('EC-SCVS-6E — invariantes de identidad intactas tras el fix', () => {
  it('6. record_identity_key sigue siendo expediente:<id>', () => {
    const snap = build([rawRow({ expediente: '  777 ' })]).rows[0]!;
    assert.equal(snap.record_identity_key, 'expediente:777');
  });

  it('7. normalized_tax_id null sigue permitido (expediente-only)', () => {
    const snap = build([rawRow({ ruc: null })]).rows[0]!;
    assert.equal(snap.normalized_tax_id, null);
  });

  it('8. filas expediente-only siguen aceptadas', () => {
    const result = build([rawRow({ ruc: null })]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rejected.length, 0);
  });

  it('9. duplicate RUC con expedientes distintos sigue permitido', () => {
    const result = build([
      rawRow({ expediente: '100', ruc: '1790013731001' }),
      rawRow({ expediente: '200', ruc: '1790013731001' }),
    ]);
    assert.equal(result.rows.length, 2);
    assert.equal(result.summary.distinctNormalizedTaxIds, 1);
  });

  it('10. duplicate expediente sigue bloqueado', () => {
    const result = build([
      rawRow({ expediente: '55', ruc: '1790013731001' }),
      rawRow({ expediente: '55', ruc: '0990013731001' }),
    ]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0]?.reason, 'duplicate_record_identity_key');
  });
});
