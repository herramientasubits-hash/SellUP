/**
 * Tests — EC SCVS Dry-run writer-path summary helper
 *
 * Sin red, sin DB, sin filesystem, sin proveedores. Hito: EC-SCVS-3B-R.
 * Convención: el repo usa `__tests__/` en todos los conectores.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseEcScvsDryRunArgs,
  summarizeEcScvsDryRunWriterPath,
  EC_SCVS_DRY_RUN_DEFAULT_TOP_N,
  EC_SCVS_FORBIDDEN_WRITE_FLAGS,
} from '../ec-scvs-dry-run-summary';
import type { EcScvsRawRow } from '../ec-scvs-types';

const HELPER_SOURCE = readFileSync(
  fileURLToPath(new URL('../ec-scvs-dry-run-summary.ts', import.meta.url)),
  'utf-8',
);

const SAMPLE_YEAR = 2025; // Año de EJEMPLO — es input del helper, nunca hardcode.

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

// ─── parseEcScvsDryRunArgs ─────────────────────────────────────────────────────

describe('parseEcScvsDryRunArgs', () => {
  // 2 — sourceYear requerido
  it('parsea local-file y source-year válidos', () => {
    const args = parseEcScvsDryRunArgs([
      '--local-file=/tmp/bi_compania.csv',
      '--source-year=2025',
    ]);
    assert.equal(args.localFile, '/tmp/bi_compania.csv');
    assert.equal(args.sourceYear, 2025);
    assert.equal(args.sourceFileName, undefined);
  });

  it('soporta forma con espacio (--flag value)', () => {
    const args = parseEcScvsDryRunArgs([
      '--local-file',
      '/tmp/bi_compania.csv',
      '--source-year',
      '2024',
    ]);
    assert.equal(args.localFile, '/tmp/bi_compania.csv');
    assert.equal(args.sourceYear, 2024);
  });

  it('captura metadata opcional', () => {
    const args = parseEcScvsDryRunArgs([
      '--local-file=/tmp/f.csv',
      '--source-year=2025',
      '--source-file-name=bi_compania.csv',
      '--source-downloaded-at=2026-07-21',
      '--import-batch-id=batch-1',
    ]);
    assert.equal(args.sourceFileName, 'bi_compania.csv');
    assert.equal(args.sourceDownloadedAt, '2026-07-21');
    assert.equal(args.importBatchId, 'batch-1');
  });

  // 2 — sourceYear requerido
  it('falla si falta --source-year', () => {
    assert.throws(
      () => parseEcScvsDryRunArgs(['--local-file=/tmp/f.csv']),
      /source_year_required/,
    );
  });

  it('falla si falta --local-file', () => {
    assert.throws(() => parseEcScvsDryRunArgs(['--source-year=2025']), /local_file_required/);
  });

  it('falla si --local-file está vacío', () => {
    assert.throws(
      () => parseEcScvsDryRunArgs(['--local-file=', '--source-year=2025']),
      /local_file_required/,
    );
  });

  // 3 — sourceYear inválido falla controladamente
  it('rechaza source-year no entero', () => {
    assert.throws(
      () => parseEcScvsDryRunArgs(['--local-file=/tmp/f.csv', '--source-year=20a5']),
      /invalid_source_year/,
    );
  });

  it('rechaza source-year <= 0', () => {
    assert.throws(
      () => parseEcScvsDryRunArgs(['--local-file=/tmp/f.csv', '--source-year=0']),
      /invalid_source_year/,
    );
  });

  it('rechaza source-year decimal', () => {
    assert.throws(
      () => parseEcScvsDryRunArgs(['--local-file=/tmp/f.csv', '--source-year=2025.5']),
      /invalid_source_year/,
    );
  });

  it('no hardcodea 2025/2026 — acepta cualquier año entero positivo', () => {
    const args = parseEcScvsDryRunArgs(['--local-file=/tmp/f.csv', '--source-year=1999']);
    assert.equal(args.sourceYear, 1999);
  });

  // 4 / 5 — no existe modo dryRun=false ni flag write/apply/import/upsert
  it('aborta ruidosamente ante cualquier flag de escritura (dry_run_only)', () => {
    for (const flag of EC_SCVS_FORBIDDEN_WRITE_FLAGS) {
      assert.throws(
        () => parseEcScvsDryRunArgs(['--local-file=/tmp/f.csv', '--source-year=2025', flag]),
        /dry_run_only/,
        `esperaba dry_run_only para ${flag}`,
      );
    }
  });

  it('los args parseados no exponen ningún campo apply/write/dryRun=false', () => {
    const args = parseEcScvsDryRunArgs(['--local-file=/tmp/f.csv', '--source-year=2025']);
    assert.equal('apply' in args, false);
    assert.equal('write' in args, false);
    assert.equal('dryRun' in args, false);
    assert.equal('commit' in args, false);
  });
});

// ─── summarizeEcScvsDryRunWriterPath ───────────────────────────────────────────

describe('summarizeEcScvsDryRunWriterPath', () => {
  // 1 — summary writer-path con fixture pequeño produce conteos correctos
  it('produce conteos correctos con un fixture pequeño', async () => {
    const rows: EcScvsRawRow[] = [
      row({ expediente: '1', ruc: '1790013731001' }),
      row({ expediente: '2', ruc: '1791234567001', provincia: 'GUAYAS', tipo: 'LIMITADA' }),
      row({ expediente: '3', ruc: null }), // 8 — expediente sin RUC (aceptada)
    ];

    const summary = await summarizeEcScvsDryRunWriterPath({ rows, sourceYear: SAMPLE_YEAR });

    assert.equal(summary.sourceYear, SAMPLE_YEAR);
    assert.equal(summary.totalRawRows, 3);
    assert.equal(summary.snapshotAcceptedRows, 3);
    assert.equal(summary.snapshotRejectedRows, 0);
    assert.equal(summary.distinctRecordIdentityKeys, 3);
    // writer dry-run re-valida y acepta todas las filas del builder
    assert.equal(summary.writerValidRows, 3);
    assert.equal(summary.writerRejectedRows, 0);
  });

  // 4 — no existe modo dryRun=false: el writer permanece en dry-run, 0 writes
  it('el writer permanece en dry-run: status dry_run, 0 upserts, 0 batches', async () => {
    const summary = await summarizeEcScvsDryRunWriterPath({
      rows: [row()],
      sourceYear: SAMPLE_YEAR,
    });
    assert.equal(summary.writerStatus, 'dry_run');
    assert.equal(summary.writerDryRun, true);
    assert.equal(summary.writerUpsertedRows, 0);
    assert.equal(summary.writerBatches, 0);
  });

  // 6 / 7 — no crea Supabase client, no lee env/secrets
  it('corre sin variables de entorno y expone invariantes de seguridad', async () => {
    const summary = await summarizeEcScvsDryRunWriterPath({
      rows: [row()],
      sourceYear: SAMPLE_YEAR,
    });
    assert.equal(summary.dbWrites, 0);
    assert.equal(summary.snapshotWrites, 0);
    assert.equal(summary.coveragePersisted, false);
  });

  // 6 / 7 — chequeo estático: el helper nunca lee env ni crea cliente Supabase
  it('el helper no referencia process.env ni crea cliente Supabase (estático)', () => {
    assert.equal(HELPER_SOURCE.includes('process.env'), false);
    assert.equal(HELPER_SOURCE.includes('createSupabaseAdminClient'), false);
    assert.equal(HELPER_SOURCE.includes('createClient'), false);
    // Tampoco inyecta un cliente al writer (dry-run puro).
    assert.equal(HELPER_SOURCE.includes('supabase:'), false);
    assert.equal(HELPER_SOURCE.includes('dryRun: false'), false);
  });

  // 8 — acepta expediente sin RUC
  it('acepta expediente sin RUC con normalized_tax_id null', async () => {
    const summary = await summarizeEcScvsDryRunWriterPath({
      rows: [row({ expediente: '77', ruc: null })],
      sourceYear: SAMPLE_YEAR,
    });
    assert.equal(summary.snapshotAcceptedRows, 1);
    assert.equal(summary.rowsWithValidNormalizedTaxId, 0);
    assert.equal(summary.rowsWithoutValidNormalizedTaxId, 1);
  });

  // 9 — RUC inválido → normalized_tax_id null/informativo (fila aún aceptada por expediente)
  it('reporta RUC inválido como normalized_tax_id null (fila aceptada por expediente)', async () => {
    const summary = await summarizeEcScvsDryRunWriterPath({
      rows: [row({ expediente: '88', ruc: 'ABC-not-a-ruc' })],
      sourceYear: SAMPLE_YEAR,
    });
    assert.equal(summary.snapshotAcceptedRows, 1);
    assert.equal(summary.rowsWithValidNormalizedTaxId, 0);
    assert.equal(summary.rowsWithoutValidNormalizedTaxId, 1);
    assert.equal(summary.snapshotRejectedRows, 0);
  });

  // 10 — duplicate expediente → rechazo/bloqueante
  it('reporta duplicate expediente como rechazo bloqueante', async () => {
    const rows: EcScvsRawRow[] = [
      row({ expediente: '5', ruc: '1790013731001' }),
      row({ expediente: '5', ruc: '1791234567001' }), // mismo expediente → colisión
    ];
    const summary = await summarizeEcScvsDryRunWriterPath({ rows, sourceYear: SAMPLE_YEAR });
    assert.equal(summary.snapshotAcceptedRows, 1);
    assert.equal(summary.snapshotRejectedRows, 1);
    assert.equal(summary.rejectedDuplicateRecordIdentity, 1);
    assert.equal(summary.duplicateRecordIdentityGroupsBlocking, 1);
  });

  it('reporta expediente ausente como rechazo missing_expediente', async () => {
    const summary = await summarizeEcScvsDryRunWriterPath({
      rows: [row({ expediente: null })],
      sourceYear: SAMPLE_YEAR,
    });
    assert.equal(summary.snapshotAcceptedRows, 0);
    assert.equal(summary.snapshotRejectedRows, 1);
    assert.equal(summary.rejectedMissingExpediente, 1);
  });

  // 11 — duplicate RUC informativo, no rejection
  it('reporta duplicate RUC como informativo, sin rechazar filas', async () => {
    const rows: EcScvsRawRow[] = [
      row({ expediente: '10', ruc: '1790013731001' }),
      row({ expediente: '11', ruc: '1790013731001' }), // mismo RUC, distinto expediente
    ];
    const summary = await summarizeEcScvsDryRunWriterPath({ rows, sourceYear: SAMPLE_YEAR });
    // Ambas filas aceptadas: el RUC NUNCA es identidad.
    assert.equal(summary.snapshotAcceptedRows, 2);
    assert.equal(summary.snapshotRejectedRows, 0);
    assert.equal(summary.duplicateRucGroupsInformative, 1);
    assert.equal(summary.duplicateRucRowsExcessInformative, 1);
    assert.equal(summary.duplicateRecordIdentityGroupsBlocking, 0);
  });

  // 12 — coverage por provincia/tipo/pro_codigo
  it('produce distribuciones top-N por provincia, tipo y pro_codigo', async () => {
    const rows: EcScvsRawRow[] = [
      row({ expediente: '1', provincia: 'PICHINCHA', tipo: 'ANONIMA', pro_codigo: '17' }),
      row({ expediente: '2', provincia: 'PICHINCHA', tipo: 'ANONIMA', pro_codigo: '17' }),
      row({ expediente: '3', provincia: 'GUAYAS', tipo: 'LIMITADA', pro_codigo: '09' }),
      row({ expediente: '4', provincia: null, tipo: null, pro_codigo: null }),
    ];
    const summary = await summarizeEcScvsDryRunWriterPath({ rows, sourceYear: SAMPLE_YEAR });

    assert.equal(summary.topN, EC_SCVS_DRY_RUN_DEFAULT_TOP_N);
    assert.equal(summary.provinceDistribution.distinctValues, 2);
    assert.equal(summary.provinceDistribution.nullOrEmptyCount, 1);
    assert.deepEqual(summary.provinceDistribution.top[0], { key: 'PICHINCHA', count: 2 });
    assert.equal(summary.typeDistribution.top[0]?.key, 'ANONIMA');
    assert.equal(summary.proCodigoDistribution.top[0]?.key, '17');
  });

  it('respeta topN configurable y ordena por conteo desc', async () => {
    const rows: EcScvsRawRow[] = [
      row({ expediente: '1', provincia: 'A' }),
      row({ expediente: '2', provincia: 'B' }),
      row({ expediente: '3', provincia: 'B' }),
      row({ expediente: '4', provincia: 'C' }),
      row({ expediente: '5', provincia: 'C' }),
      row({ expediente: '6', provincia: 'C' }),
    ];
    const summary = await summarizeEcScvsDryRunWriterPath({
      rows,
      sourceYear: SAMPLE_YEAR,
      topN: 2,
    });
    assert.equal(summary.provinceDistribution.top.length, 2);
    assert.deepEqual(summary.provinceDistribution.top[0], { key: 'C', count: 3 });
    assert.deepEqual(summary.provinceDistribution.top[1], { key: 'B', count: 2 });
  });

  // 3 — sourceYear inválido falla controladamente (propagado del builder)
  it('propaga error de sourceYear inválido desde el builder', async () => {
    await assert.rejects(
      () => summarizeEcScvsDryRunWriterPath({ rows: [row()], sourceYear: 0 }),
      /positive integer/,
    );
  });

  // 13 — output seguro: no expone RUC completo ni nombres
  it('output seguro: no incluye RUC completo ni legal_name en el summary', async () => {
    const summary = await summarizeEcScvsDryRunWriterPath({
      rows: [row({ expediente: '1', ruc: '1790013731001', nombre: 'SECRETO CONFIDENCIAL SA' })],
      sourceYear: SAMPLE_YEAR,
    });
    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes('1790013731001'), false);
    assert.equal(serialized.includes('SECRETO CONFIDENCIAL'), false);
  });
});
