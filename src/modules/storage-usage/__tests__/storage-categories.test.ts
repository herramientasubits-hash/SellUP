/**
 * Integraciones › Supabase — agrupar tablas, validar la RPC y medir el espacio.
 * 0 red · 0 base · 0 Producción.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyTable,
  evaluateStorageCapacity,
  formatBytes,
  formatPercent,
  formatRows,
  groupStorageByCategory,
  parseStorageUsageReport,
  resolveIncludedDiskGb,
} from '../storage-categories';

describe('classifyTable', () => {
  const cases: Array<[string, string, string]> = [
    ['public', 'source_company_snapshots', 'source_catalog'],
    ['public', 'public_procurement_supplier_links', 'source_catalog'],
    ['public', 'br_receita_snapshots_p6055420ae3b541d495508090bdd1b634', 'source_catalog'],
    ['public', 'accounts', 'companies'],
    ['public', 'account_audit', 'companies'],
    ['public', 'agent1_company_bank', 'companies'],
    ['public', 'contacts', 'contacts'],
    ['public', 'contact_enrichment_runs', 'contacts'],
    ['public', 'contact_audit', 'contacts'],
    ['public', 'phone_reveal_cache', 'contacts'],
    ['public', 'prospect_candidates', 'searches'],
    ['public', 'agent_run_steps', 'searches'],
    ['public', 'provider_seen_entities', 'searches'],
    ['public', 'provider_usage_logs', 'provider_usage'],
    ['public', 'wizard_budget_reservations', 'provider_usage'],
    ['cron', 'job_run_details', 'system_logs'],
    ['net', '_http_response', 'system_logs'],
    ['public', 'access_audit', 'system_logs'],
    ['auth', 'users', 'users'],
    ['public', 'internal_users', 'users'],
    ['public', 'subindustry_rules', 'configuration'],
    ['public', 'ai_models', 'configuration'],
    ['public', 'ai_model_pricing', 'provider_usage'],
    ['storage', 'objects', 'other'],
    ['supabase_migrations', 'schema_migrations', 'other'],
  ];
  for (const [schema, name, expected] of cases) {
    test(`${schema}.${name} → ${expected}`, () => {
      assert.equal(classifyTable(schema, name), expected);
    });
  }
});

describe('parseStorageUsageReport', () => {
  test('acepta la forma de la RPC y convierte números en texto', () => {
    const report = parseStorageUsageReport({
      database_bytes: '9000',
      generated_at: '2026-11-09T10:00:00Z',
      tables: [
        { schema: 'public', name: 'accounts', total_bytes: 100, rows: 5, rows_exact: true },
        { schema: 'public', name: 'roto', total_bytes: -1, rows: 1 },
        'no-es-un-objeto',
      ],
    });
    assert.ok(report);
    assert.equal(report.databaseBytes, 9000);
    assert.deepEqual(report.tables, [
      { schema: 'public', name: 'accounts', totalBytes: 100, rows: 5, rowsExact: true },
    ]);
  });

  test('forma inesperada ⇒ null, nunca números inventados', () => {
    assert.equal(parseStorageUsageReport(null), null);
    assert.equal(parseStorageUsageReport({ tables: [] }), null);
    assert.equal(parseStorageUsageReport({ database_bytes: 10 }), null);
  });
});

describe('groupStorageByCategory', () => {
  test('suma por categoría, ordena de mayor a menor y marca filas aproximadas', () => {
    const groups = groupStorageByCategory({
      databaseBytes: 1000,
      generatedAt: '2026-11-09T10:00:00Z',
      tables: [
        { schema: 'public', name: 'source_company_snapshots', totalBytes: 800, rows: 7_000_000, rowsExact: false },
        { schema: 'public', name: 'accounts', totalBytes: 50, rows: 135, rowsExact: true },
        { schema: 'public', name: 'agent1_company_bank', totalBytes: 100, rows: 2055, rowsExact: true },
      ],
    });
    assert.deepEqual(groups.map((g) => g.key), ['source_catalog', 'companies']);
    assert.equal(groups[0].share, 80);
    assert.equal(groups[0].rowsApproximate, true);
    assert.equal(groups[1].totalBytes, 150);
    assert.equal(groups[1].rows, 2190);
    assert.equal(groups[1].rowsApproximate, false);
    assert.deepEqual(groups[1].tables.map((t) => t.name), ['agent1_company_bank', 'accounts']);
  });
});

describe('evaluateStorageCapacity', () => {
  const GB = 1024 ** 3;
  test('por debajo del 80 % ⇒ ok', () => {
    assert.equal(evaluateStorageCapacity(4 * GB, 8).level, 'ok');
  });
  test('del 80 % al 100 % ⇒ aviso', () => {
    assert.equal(evaluateStorageCapacity(7 * GB, 8).level, 'warning');
  });
  test('por encima de lo incluido ⇒ over', () => {
    const capacity = evaluateStorageCapacity(8.4 * GB, 8);
    assert.equal(capacity.level, 'over');
    assert.ok(capacity.percent > 100);
  });
  test('SUPABASE_DISK_INCLUDED_GB inválida ⇒ 8 GB', () => {
    assert.equal(resolveIncludedDiskGb(undefined), 8);
    assert.equal(resolveIncludedDiskGb('abc'), 8);
    assert.equal(resolveIncludedDiskGb('0'), 8);
    assert.equal(resolveIncludedDiskGb('16'), 16);
  });
});

describe('formatos', () => {
  test('bytes legibles en español', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1536), '1,5 KB');
    assert.equal(formatBytes(8_622_161_920), '8,0 GB');
    assert.equal(formatBytes(131_899_392), '126 MB');
  });
  test('porcentaje y filas', () => {
    assert.equal(formatPercent(0.01), '<0,1 %');
    assert.equal(formatPercent(97.34), '97,3 %');
    assert.equal(formatRows(7_220_916, true), '≈ 7.220.916');
    assert.equal(formatRows(135, false), '135');
  });
});
