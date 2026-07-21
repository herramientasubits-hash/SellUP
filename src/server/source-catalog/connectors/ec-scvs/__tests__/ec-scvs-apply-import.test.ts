/**
 * EC SCVS — Apply/Import helper tests (EC-SCVS-6C)
 *
 * Cubre los guardrails del camino de apply productivo:
 *   - parse de args: source_year exacto 2026, frase de confirmación exacta,
 *     rechazo de flags de bypass genéricas.
 *   - orquestador: gate pre-apply, orden dry-run→apply, y la invariante crítica
 *     de que el cliente Supabase se crea SOLO tras pasar el gate.
 *   - salida segura (sin secrets, sin RUC completos).
 *   - estáticos: el dry-run script sigue sin flags de escritura y el writer
 *     conserva su contrato non-dry-run.
 *
 * NO toca Supabase real, filesystem de producción ni red. Todo con fakes.
 *
 * Hito: EC-SCVS-6C — Production apply/import CLI behind explicit approval.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  parseEcScvsApplyImportArgs,
  runEcScvsApplyImport,
  evaluatePreApplyGate,
  EC_SCVS_APPLY_CONFIRM_PHRASE,
  EC_SCVS_REQUIRED_SOURCE_YEAR,
  EC_SCVS_APPLY_DEFAULT_BATCH_SIZE,
  type EcScvsApplyImportArgs,
  type EcScvsApplyImportDeps,
} from '../ec-scvs-apply-import';
import type {
  EcScvsSnapshotImportInput,
  EcScvsSnapshotImportResult,
  EcScvsSupabaseAdminLike,
  EcScvsWriterRejectionReason,
} from '../ec-scvs-snapshot-writer';
import type { EcScvsCsvReadResult } from '../ec-scvs-csv-reader';
import type { EcScvsRawRow } from '../ec-scvs-types';
import { EC_SCVS_EXPECTED_COLUMNS } from '../ec-scvs-types';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../../record-identity';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SAMPLE_RUC = '1790012345001';

function rawRow(overrides: Partial<EcScvsRawRow> = {}): EcScvsRawRow {
  return {
    expediente: '900001',
    ruc: SAMPLE_RUC,
    nombre: 'EMPRESA EJEMPLO S.A.',
    tipo: 'ANONIMA',
    pro_codigo: '17',
    provincia: 'PICHINCHA',
    ...overrides,
  };
}

function makeCsvReadResult(over: Partial<EcScvsCsvReadResult> = {}): EcScvsCsvReadResult {
  return {
    ok: true,
    rows: [
      rawRow({ expediente: '900001' }),
      rawRow({ expediente: '900002' }),
      rawRow({ expediente: '900003' }),
    ],
    missingColumns: [],
    detectedColumns: [...EC_SCVS_EXPECTED_COLUMNS],
    malformedRowCount: 0,
    error: null,
    ...over,
  };
}

function emptyBreakdown(): Record<EcScvsWriterRejectionReason, number> {
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

function makeImportResult(
  over: Partial<EcScvsSnapshotImportResult> = {},
): EcScvsSnapshotImportResult {
  return {
    status: 'dry_run',
    dryRun: true,
    totalRows: 3,
    validRows: 3,
    rejectedRows: 0,
    upsertedRows: 0,
    skippedRows: 0,
    batches: 0,
    errors: [],
    rejections: [],
    summary: {
      sourceKey: 'ec_scvs',
      countryCode: 'EC',
      conflictTarget: RECORD_IDENTITY_ON_CONFLICT,
      batchSize: 500,
      rejectionBreakdown: emptyBreakdown(),
      coverageWritten: false,
      signalsWritten: false,
    },
    ...over,
  };
}

/** Fake runImport: registra llamadas y devuelve dry-run/apply según input.dryRun. */
function makeRunImportSpy(opts: {
  dryRunResult?: EcScvsSnapshotImportResult;
  applyResult?: EcScvsSnapshotImportResult;
  order?: string[];
} = {}) {
  const calls: EcScvsSnapshotImportInput[] = [];
  const runImport = async (
    input: EcScvsSnapshotImportInput,
  ): Promise<EcScvsSnapshotImportResult> => {
    calls.push(input);
    if (opts.order) opts.order.push(input.dryRun === false ? 'import:apply' : 'import:dry_run');
    if (input.dryRun === false) {
      return (
        opts.applyResult ??
        makeImportResult({
          status: 'success',
          dryRun: false,
          upsertedRows: 3,
          batches: 1,
        })
      );
    }
    return opts.dryRunResult ?? makeImportResult();
  };
  return { runImport, calls };
}

/** Fake client factory: cuenta invocaciones (nunca debe correr antes del gate). */
function makeClientSpy(order?: string[]) {
  let count = 0;
  const factory = (): EcScvsSupabaseAdminLike => {
    count += 1;
    if (order) order.push('create_client');
    return {
      from: () => ({
        upsert: async () => ({ error: null }),
      }),
    };
  };
  return { factory, count: () => count };
}

function baseArgs(over: Partial<EcScvsApplyImportArgs> = {}): EcScvsApplyImportArgs {
  return {
    localFile: '/abs/path/bi_compania.csv',
    sourceYear: EC_SCVS_REQUIRED_SOURCE_YEAR,
    sourceFileName: 'bi_compania.csv',
    confirm: EC_SCVS_APPLY_CONFIRM_PHRASE,
    ...over,
  };
}

const VALID_ARGV = [
  '--local-file',
  '/abs/path/bi_compania.csv',
  '--source-year',
  '2026',
  '--source-file-name',
  'bi_compania.csv',
  '--confirm',
  EC_SCVS_APPLY_CONFIRM_PHRASE,
];

// ─── 1–4, 14, 19, 20: parse de args ──────────────────────────────────────────

describe('parseEcScvsApplyImportArgs — guardrails de args', () => {
  it('1. aborta si falta --confirm', () => {
    const argv = [
      '--local-file',
      '/abs/x.csv',
      '--source-year',
      '2026',
      '--source-file-name',
      'bi_compania.csv',
    ];
    assert.throws(() => parseEcScvsApplyImportArgs(argv), /confirmation_required/);
  });

  it('2. aborta si --confirm no coincide exactamente', () => {
    const argv = [
      '--local-file',
      '/abs/x.csv',
      '--source-year',
      '2026',
      '--source-file-name',
      'bi_compania.csv',
      '--confirm',
      'EC-SCVS PRODUCTION IMPORT APROBADO ', // trailing space → mismatch
    ];
    assert.throws(() => parseEcScvsApplyImportArgs(argv), /confirmation_mismatch/);
  });

  it('2b. aborta ante confirmación parcial', () => {
    const argv = [
      '--local-file',
      '/abs/x.csv',
      '--source-year',
      '2026',
      '--source-file-name',
      'bi_compania.csv',
      '--confirm',
      'EC-SCVS PRODUCTION IMPORT',
    ];
    assert.throws(() => parseEcScvsApplyImportArgs(argv), /confirmation_mismatch/);
  });

  it('3. aborta si falta --source-year', () => {
    const argv = [
      '--local-file',
      '/abs/x.csv',
      '--source-file-name',
      'bi_compania.csv',
      '--confirm',
      EC_SCVS_APPLY_CONFIRM_PHRASE,
    ];
    assert.throws(() => parseEcScvsApplyImportArgs(argv), /source_year_required/);
  });

  it('4/20. aborta si source-year != 2026 (2025 rechazado)', () => {
    const argv = [
      '--local-file',
      '/abs/x.csv',
      '--source-year',
      '2025',
      '--source-file-name',
      'bi_compania.csv',
      '--confirm',
      EC_SCVS_APPLY_CONFIRM_PHRASE,
    ];
    assert.throws(() => parseEcScvsApplyImportArgs(argv), /source_year_must_be_2026/);
  });

  it('14. no acepta --force / --yes / --unsafe', () => {
    for (const flag of ['--force', '--yes', '--unsafe']) {
      assert.throws(
        () => parseEcScvsApplyImportArgs([...VALID_ARGV, flag]),
        /forbidden_flag/,
        `flag ${flag} debería abortar`,
      );
      assert.throws(
        () => parseEcScvsApplyImportArgs([...VALID_ARGV, `${flag}=1`]),
        /forbidden_flag/,
        `flag ${flag}=1 debería abortar`,
      );
    }
  });

  it('aborta si falta --local-file', () => {
    const argv = [
      '--source-year',
      '2026',
      '--source-file-name',
      'bi_compania.csv',
      '--confirm',
      EC_SCVS_APPLY_CONFIRM_PHRASE,
    ];
    assert.throws(() => parseEcScvsApplyImportArgs(argv), /local_file_required/);
  });

  it('aborta si falta --source-file-name', () => {
    const argv = [
      '--local-file',
      '/abs/x.csv',
      '--source-year',
      '2026',
      '--confirm',
      EC_SCVS_APPLY_CONFIRM_PHRASE,
    ];
    assert.throws(() => parseEcScvsApplyImportArgs(argv), /source_file_name_required/);
  });

  it('aborta si --batch-size no es entero positivo', () => {
    assert.throws(
      () => parseEcScvsApplyImportArgs([...VALID_ARGV, '--batch-size', '0']),
      /invalid_batch_size/,
    );
    assert.throws(
      () => parseEcScvsApplyImportArgs([...VALID_ARGV, '--batch-size', '-5']),
      /invalid_batch_size/,
    );
  });

  it('19. source_year 2026 se acepta con args completos', () => {
    const args = parseEcScvsApplyImportArgs([
      ...VALID_ARGV,
      '--batch-size',
      '250',
      '--source-downloaded-at',
      '2026-07-21',
      '--import-batch-id',
      'batch-xyz',
    ]);
    assert.equal(args.sourceYear, 2026);
    assert.equal(args.confirm, EC_SCVS_APPLY_CONFIRM_PHRASE);
    assert.equal(args.sourceFileName, 'bi_compania.csv');
    assert.equal(args.batchSize, 250);
    assert.equal(args.sourceDownloadedAt, '2026-07-21');
    assert.equal(args.importBatchId, 'batch-xyz');
  });

  it('acepta la forma --flag=value', () => {
    const args = parseEcScvsApplyImportArgs([
      '--local-file=/abs/x.csv',
      '--source-year=2026',
      '--source-file-name=bi_compania.csv',
      `--confirm=${EC_SCVS_APPLY_CONFIRM_PHRASE}`,
    ]);
    assert.equal(args.sourceYear, 2026);
    assert.equal(args.localFile, '/abs/x.csv');
  });
});

// ─── evaluatePreApplyGate (unidad) ───────────────────────────────────────────

describe('evaluatePreApplyGate', () => {
  it('pasa con dry-run limpio', () => {
    const gate = evaluatePreApplyGate(makeImportResult());
    assert.equal(gate.passed, true);
    assert.equal(gate.failures.length, 0);
  });

  it('falla si status no es dry_run', () => {
    const gate = evaluatePreApplyGate(makeImportResult({ status: 'success', dryRun: false }));
    assert.equal(gate.passed, false);
  });

  it('falla si hay errors', () => {
    const gate = evaluatePreApplyGate(
      makeImportResult({ errors: [{ batchIndex: 0, offset: 0, message: 'x' }] }),
    );
    assert.equal(gate.passed, false);
  });

  it('falla si validRows <= 0', () => {
    const gate = evaluatePreApplyGate(makeImportResult({ validRows: 0 }));
    assert.equal(gate.passed, false);
  });

  it('falla si rejectedRows > 0', () => {
    const gate = evaluatePreApplyGate(makeImportResult({ rejectedRows: 2 }));
    assert.equal(gate.passed, false);
  });

  it('falla si hay duplicate_record_identity_key', () => {
    const bd = emptyBreakdown();
    bd.duplicate_record_identity_key = 1;
    const gate = evaluatePreApplyGate(
      makeImportResult({ summary: { ...makeImportResult().summary, rejectionBreakdown: bd } }),
    );
    assert.equal(gate.passed, false);
  });
});

// ─── 5–6: read/header gates (sin cliente) ────────────────────────────────────

describe('runEcScvsApplyImport — read/header gates', () => {
  it('5. aborta si el CSV no existe (no crea cliente)', async () => {
    const client = makeClientSpy();
    const { runImport, calls } = makeRunImportSpy();
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult({ ok: false, rows: [], error: 'file_not_found' }),
      runImport,
      createSupabaseClient: client.factory,
    };

    const outcome = await runEcScvsApplyImport(baseArgs(), deps);

    assert.equal(outcome.ok, false);
    assert.equal(outcome.stage, 'read');
    assert.equal(outcome.clientCreated, false);
    assert.equal(client.count(), 0);
    assert.equal(calls.length, 0, 'no debe ejecutar writer si no lee CSV');
  });

  it('6. aborta si el header no coincide (no crea cliente)', async () => {
    const client = makeClientSpy();
    const { runImport, calls } = makeRunImportSpy();
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () =>
        makeCsvReadResult({ detectedColumns: ['expediente', 'ruc', 'nombre'] }),
      runImport,
      createSupabaseClient: client.factory,
    };

    const outcome = await runEcScvsApplyImport(baseArgs(), deps);

    assert.equal(outcome.ok, false);
    assert.equal(outcome.stage, 'read');
    if (outcome.ok === false) assert.equal(outcome.code, 'unexpected_header');
    assert.equal(client.count(), 0);
    assert.equal(calls.length, 0);
  });
});

// ─── 7–13: gate + orden + cliente post-gate ──────────────────────────────────

describe('runEcScvsApplyImport — gate y orden dry-run → apply', () => {
  it('7. aborta si el dry-run interno tiene errors (no crea cliente)', async () => {
    const client = makeClientSpy();
    const { runImport } = makeRunImportSpy({
      dryRunResult: makeImportResult({
        errors: [{ batchIndex: 0, offset: 0, message: 'boom' }],
      }),
    });
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };

    const outcome = await runEcScvsApplyImport(baseArgs(), deps);

    assert.equal(outcome.ok, false);
    assert.equal(outcome.stage, 'preflight_gate');
    assert.equal(outcome.clientCreated, false);
    assert.equal(client.count(), 0);
  });

  it('8. aborta si el dry-run tiene rejectedRows > 0 (no crea cliente)', async () => {
    const client = makeClientSpy();
    const { runImport } = makeRunImportSpy({
      dryRunResult: makeImportResult({ rejectedRows: 4, validRows: 2 }),
    });
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };

    const outcome = await runEcScvsApplyImport(baseArgs(), deps);

    assert.equal(outcome.ok, false);
    assert.equal(outcome.stage, 'preflight_gate');
    assert.equal(client.count(), 0);
  });

  it('9/10/11/12. no crea cliente antes del gate; lo crea después; orden dry-run→apply', async () => {
    const order: string[] = [];
    const client = makeClientSpy(order);
    const { runImport, calls } = makeRunImportSpy({ order });
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };

    const outcome = await runEcScvsApplyImport(baseArgs(), deps);

    assert.equal(outcome.ok, true);
    assert.equal(client.count(), 1, 'cliente creado exactamente una vez');
    assert.equal(calls.length, 2, 'writer invocado dos veces (dry-run + apply)');
    assert.equal(calls[0]!.dryRun, true, '11. primer call dryRun=true');
    assert.equal(calls[1]!.dryRun, false, '12. segundo call dryRun=false');
    // El cliente se crea DESPUÉS del dry-run y ANTES del apply.
    assert.deepEqual(order, ['import:dry_run', 'create_client', 'import:apply']);
  });

  it('13. el apply usa el batchSize provisto', async () => {
    const client = makeClientSpy();
    const { runImport, calls } = makeRunImportSpy();
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };

    await runEcScvsApplyImport(baseArgs({ batchSize: 250 }), deps);

    assert.equal(calls[1]!.batchSize, 250);
  });

  it('13b. el apply usa el batchSize por defecto si no se especifica', async () => {
    const client = makeClientSpy();
    const { runImport, calls } = makeRunImportSpy();
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };

    await runEcScvsApplyImport(baseArgs(), deps);

    assert.equal(calls[1]!.batchSize, EC_SCVS_APPLY_DEFAULT_BATCH_SIZE);
  });

  it('el apply inyecta el cliente creado al writer', async () => {
    const client = makeClientSpy();
    const { runImport, calls } = makeRunImportSpy();
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };

    await runEcScvsApplyImport(baseArgs(), deps);

    assert.equal(calls[0]!.supabase, undefined, 'dry-run sin cliente');
    assert.notEqual(calls[1]!.supabase, undefined, 'apply con cliente inyectado');
  });
});

// ─── 15–16: salida segura ────────────────────────────────────────────────────

describe('runEcScvsApplyImport — salida segura', () => {
  it('15/16. el reporte no contiene secrets ni RUC completos', async () => {
    const logs: string[] = [];
    const client = makeClientSpy();
    const { runImport } = makeRunImportSpy();
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
      log: (m) => logs.push(m),
    };

    const outcome = await runEcScvsApplyImport(baseArgs(), deps);
    assert.equal(outcome.ok, true);

    const serialized = JSON.stringify(outcome.ok ? outcome.report : {}) + '\n' + logs.join('\n');
    // No RUC completo en la salida.
    assert.ok(!serialized.includes(SAMPLE_RUC), 'no debe incluir RUC completo');
    // No fragmentos de secrets/env.
    for (const needle of [
      'service_role',
      'SUPABASE_SERVICE_ROLE_KEY',
      'supabase.co',
      'apikey',
      'Bearer ',
    ]) {
      assert.ok(!serialized.includes(needle), `no debe incluir "${needle}"`);
    }
  });

  it('el reporte expone solo claves seguras', async () => {
    const client = makeClientSpy();
    const { runImport } = makeRunImportSpy();
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };

    const outcome = await runEcScvsApplyImport(baseArgs(), deps);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    const allowedKeys = new Set([
      'fileName',
      'sourceKey',
      'countryCode',
      'sourceYear',
      'parsedRows',
      'malformedRows',
      'snapshotAcceptedRows',
      'snapshotRejectedRows',
      'dryRunStatus',
      'dryRunValidRows',
      'dryRunRejectedRows',
      'dryRunErrors',
      'applyStatus',
      'applyTotalRows',
      'applyValidRows',
      'applyUpsertedRows',
      'applyRejectedRows',
      'applyBatches',
      'applyErrors',
      'applyErrorDetails',
      'conflictTarget',
      'clientCreated',
    ]);
    for (const key of Object.keys(outcome.report)) {
      assert.ok(allowedKeys.has(key), `clave inesperada en reporte: ${key}`);
    }
    assert.equal(outcome.report.conflictTarget, RECORD_IDENTITY_ON_CONFLICT);
    assert.equal(outcome.report.applyStatus, 'success');
    assert.equal(outcome.report.applyUpsertedRows, 3);
  });
});

// ─── 17–18: estáticos (dry-run script y writer intactos) ─────────────────────

describe('EC-SCVS-6C — invariantes estáticas', () => {
  const dryRunScript = readFileSync(
    new URL(
      '../../../../../../scripts/source-catalog/run-ec-scvs-dry-run.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const writerSource = readFileSync(
    new URL('../ec-scvs-snapshot-writer.ts', import.meta.url),
    'utf8',
  );

  it('17. el dry-run script sigue siendo dry-run only', () => {
    // No habilita el camino de escritura ni crea cliente admin.
    assert.ok(
      !dryRunScript.includes('dryRun: false'),
      'el dry-run script no debe invocar el writer con dryRun: false',
    );
    assert.ok(
      !dryRunScript.includes('createSupabaseAdminClient'),
      'el dry-run script no debe crear cliente admin',
    );
    assert.ok(
      !dryRunScript.includes('runEcScvsApplyImport'),
      'el dry-run script no debe usar el orquestador de apply',
    );
    // Conserva su parser dry-run only (que a su vez prohíbe flags de escritura).
    assert.ok(dryRunScript.includes('parseEcScvsDryRunArgs'));
  });

  it('18. el writer conserva su contrato non-dry-run', () => {
    // El writer sigue exigiendo cliente inyectado (nunca lo crea).
    assert.ok(writerSource.includes('supabase_client_required'));
    // Default sigue siendo dry-run.
    assert.ok(writerSource.includes('dryRun = true'));
    // Conserva el conflict target de identidad de registro.
    assert.ok(writerSource.includes('RECORD_IDENTITY_ON_CONFLICT'));
    // El writer no crea cliente Supabase.
    assert.ok(!writerSource.includes('createSupabaseAdminClient'));
  });
});

// ─── EC-SCVS-6E — reporte seguro de errores de apply ─────────────────────────

describe('EC-SCVS-6E — apply error reporting seguro', () => {
  // Error de apply que reproduce el fallo diagnosticado (PGRST204), SIN datos de
  // fila (el proveedor pone valores en `details`, que nunca incluimos).
  const SCHEMA_ERROR = {
    batchIndex: 0,
    offset: 0,
    code: 'PGRST204',
    message: "Could not find the 'status' column of 'source_company_snapshots' in the schema cache",
    hint: null as string | null,
  };

  function failingApplyResult(): EcScvsSnapshotImportResult {
    return makeImportResult({
      status: 'failed',
      dryRun: false,
      upsertedRows: 0,
      batches: 1,
      errors: [SCHEMA_ERROR],
    });
  }

  function depsWithFailingApply(logs?: string[]): EcScvsApplyImportDeps {
    const client = makeClientSpy();
    const { runImport } = makeRunImportSpy({ applyResult: failingApplyResult() });
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };
    if (logs) deps.log = (m) => logs.push(m);
    return deps;
  }

  it('11. el reporte seguro incluye code y message del error de batch', async () => {
    const outcome = await runEcScvsApplyImport(baseArgs(), depsWithFailingApply());
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    assert.equal(outcome.report.applyErrors, 1);
    assert.equal(outcome.report.applyErrorDetails.length, 1);
    const detail = outcome.report.applyErrorDetails[0]!;
    assert.equal(detail.batchIndex, 0);
    assert.equal(detail.code, 'PGRST204');
    assert.match(detail.message, /Could not find the 'status' column/);
    assert.equal(detail.hint, null);
  });

  it('12/13/14. el reporte seguro no incluye payload/RUC/secrets', async () => {
    const logs: string[] = [];
    const outcome = await runEcScvsApplyImport(baseArgs(), depsWithFailingApply(logs));
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    // 12. El reporte (deliverable seguro) no arrastra keys de payload de fila.
    const reportJson = JSON.stringify(outcome.report);
    for (const needle of ['expediente', 'raw_data', 'normalized_tax_id']) {
      assert.ok(!reportJson.includes(needle), `el reporte no debe incluir payload: "${needle}"`);
    }

    // 13/14. Ni el reporte ni los logs incluyen RUC completo ni secrets.
    const combined = reportJson + '\n' + logs.join('\n');
    assert.ok(!combined.includes(SAMPLE_RUC), 'no debe incluir RUC completo');
    for (const needle of [
      'service_role',
      'SUPABASE_SERVICE_ROLE_KEY',
      'supabase.co',
      'apikey',
      'Bearer ',
    ]) {
      assert.ok(!combined.includes(needle), `no debe incluir "${needle}"`);
    }
  });

  it('el detalle de error trunca mensajes excesivamente largos', async () => {
    const longMessage = 'x'.repeat(5000);
    const applyResult = makeImportResult({
      status: 'failed',
      dryRun: false,
      upsertedRows: 0,
      batches: 1,
      errors: [{ batchIndex: 0, offset: 0, code: 'PGRST000', message: longMessage }],
    });
    const client = makeClientSpy();
    const { runImport } = makeRunImportSpy({ applyResult });
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };

    const outcome = await runEcScvsApplyImport(baseArgs(), deps);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    const detail = outcome.report.applyErrorDetails[0]!;
    assert.ok(detail.message.length < longMessage.length, 'el mensaje debe truncarse');
    assert.match(detail.message, /truncated/);
  });

  it('15. mantiene el gate source_year=2026 (2025 aborta antes de cualquier IO)', () => {
    assert.throws(
      () => parseEcScvsApplyImportArgs([...VALID_ARGV.slice(0, 2), '--source-year', '2025', ...VALID_ARGV.slice(4)]),
      /source_year_must_be_2026/,
    );
  });

  it('16. mantiene el gate de frase de confirmación exacta', () => {
    assert.throws(
      () =>
        parseEcScvsApplyImportArgs([
          '--local-file',
          '/abs/x.csv',
          '--source-year',
          '2026',
          '--source-file-name',
          'bi_compania.csv',
          '--confirm',
          'EC-SCVS PRODUCTION IMPORT',
        ]),
      /confirmation_mismatch/,
    );
  });

  it('17. el orden dry-run → create_client → apply se mantiene con el reporte de errores', async () => {
    const order: string[] = [];
    const client = makeClientSpy(order);
    const { runImport } = makeRunImportSpy({ order, applyResult: failingApplyResult() });
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };

    const outcome = await runEcScvsApplyImport(baseArgs(), deps);
    assert.equal(outcome.ok, true);
    assert.deepEqual(order, ['import:dry_run', 'create_client', 'import:apply']);
  });

  it('18. no crea cliente Supabase cuando el gate pre-apply falla', async () => {
    const client = makeClientSpy();
    const { runImport } = makeRunImportSpy({
      dryRunResult: makeImportResult({
        errors: [{ batchIndex: 0, offset: 0, message: 'boom', code: 'PGRST000' }],
      }),
    });
    const deps: EcScvsApplyImportDeps = {
      readCsv: async () => makeCsvReadResult(),
      runImport,
      createSupabaseClient: client.factory,
    };

    const outcome = await runEcScvsApplyImport(baseArgs(), deps);
    assert.equal(outcome.ok, false);
    assert.equal(client.count(), 0);
  });
});
