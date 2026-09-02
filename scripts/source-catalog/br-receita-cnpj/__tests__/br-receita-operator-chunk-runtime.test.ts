/**
 * BR Receita CNPJ — NATIONAL CHUNK OPERATOR RUNTIME PROVIDER: tests.
 *
 * Proves the four properties that make `br-source:operator-chunk` executable WITHOUT making it
 * dangerous:
 *
 *   1. no `DATABASE_URL` → refused, fail-closed, and no session is opened;
 *   2. a transaction-pooler connection (port 6543, or `pgbouncer=true`) → refused BY NAME, before a
 *      socket exists — the gateway is stateful across statements and a transaction pooler does not
 *      promise the same backend;
 *   3. an incomplete 2026-07 manifest → refused, whether the gap is a missing Empresas part, a
 *      missing reference catalog, a file declared without a verified digest, or a fingerprint that
 *      does not match what the manifest actually declares;
 *   4. with fake ports and a fake engine, `--mode benchmark` resolves a complete manifest into a
 *      loader request pinned at 1024 partitions with `duplicateKeyPolicy: 'reject'`, loads the three
 *      reference catalogs, runs one ordinal window and reports `loaded_not_published`.
 *
 * 100% synthetic: an in-memory manifest, in-memory catalog bytes, a fake SQL session and a fake
 * engine. No Supabase, no real Receita file, no download, no connection, no publication.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BR_RECEITA_OPERATOR_CHUNK_EXIT,
  main,
  runBrReceitaOperatorChunkCli,
} from '../br-receita-operator-chunk';
import {
  BR_RECEITA_OPERATOR_CHUNK_AUTHORIZED_PERIOD,
  BR_RECEITA_OPERATOR_DATABASE_URL_ENV,
  BR_RECEITA_OPERATOR_SESSION_PORT,
  BR_RECEITA_OPERATOR_TRANSACTION_POOLER_PORT,
  BrReceitaOperatorChunkRuntimeError,
  createBrReceitaOperatorPostgresSessionFactory,
  parseBrReceitaOperatorChunkRuntimeArgs,
  provideBrReceitaOperatorChunkRuntime,
  resolveBrReceitaOperatorSessionConnection,
  type BrReceitaOperatorChunkRuntimeEnvironment,
  type BrReceitaOperatorSqlSession,
} from '../br-receita-operator-chunk-runtime';
import type { BrazilReceitaFullJoinBridgeFileSystem } from '../../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-manifest-source-bridge';
import type { BrazilReceitaFullJoinReaderFileSystem } from '../../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-streaming-reader';
import type { BrazilReceitaFullJoinEngineResult } from '../../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-engine';
import { deriveBrReceitaNationalInventoryFingerprint } from '../../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-inventory-fingerprint';
import type { BrReceitaCnpjManifestValidationResult } from '../../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-manifest';

const RUNTIME_FILE = 'br-receita-operator-chunk-runtime.ts';
const RUNTIME_PATH = path.join(__dirname, '..', RUNTIME_FILE);

const RUN_ID = '33333333-3333-4333-8333-333333333333';
const MANIFEST_DIRECTORY = '/synthetic-receita-2026-07';
const MANIFEST_PATH = `${MANIFEST_DIRECTORY}/manifest.json`;
const WORKSPACE_PARENT = '/synthetic-workspace-parent';
const SESSION_URL = `postgresql://loader:secret@db.example.internal:${BR_RECEITA_OPERATOR_SESSION_PORT}/postgres`;
const POOLER_URL = `postgresql://loader:secret@pooler.example.internal:${BR_RECEITA_OPERATOR_TRANSACTION_POOLER_PORT}/postgres`;
const MAX_OUTPUT_ROWS = 8_000_000;

// ─── A complete, synthetic 2026-07 national manifest ──────────────────────────

interface ManifestFileEntry {
  readonly fileType: string;
  readonly partOrdinal?: number;
  readonly path: string;
  readonly encoding: string;
  readonly delimiter: string;
  readonly layoutMode: string;
  readonly expectedSha256?: string;
  readonly expectedSizeBytes?: number;
}

/** A distinct, well-formed digest per file. Never checked against bytes here — the fake validator owns that. */
function digestFor(seed: number): string {
  return seed.toString(16).padStart(2, '0').repeat(32);
}

function joinEntries(): ManifestFileEntry[] {
  const entries: ManifestFileEntry[] = [];
  let seed = 1;
  for (const family of ['empresas', 'estabelecimentos'] as const) {
    for (let part = 0; part < 10; part += 1) {
      entries.push({
        fileType: family,
        partOrdinal: part,
        path: `${family === 'empresas' ? 'Empresas' : 'Estabelecimentos'}${part}.csv`,
        encoding: 'latin1',
        delimiter: ';',
        layoutMode: 'official_headerless',
        expectedSha256: digestFor(seed),
        expectedSizeBytes: 1_000 + seed,
      });
      seed += 1;
    }
  }
  return entries;
}

const CATALOG_FILES: Readonly<Record<string, string>> = Object.freeze({
  cnaes: 'Cnaes.csv',
  municipios: 'Municipios.csv',
  naturezas: 'Naturezas.csv',
});

function catalogEntries(): ManifestFileEntry[] {
  let seed = 200;
  return (['cnaes', 'municipios', 'naturezas'] as const).map((family) => {
    const entry: ManifestFileEntry = {
      fileType: family,
      partOrdinal: 0,
      path: CATALOG_FILES[family]!,
      encoding: 'latin1',
      delimiter: ';',
      layoutMode: 'official_headerless',
      expectedSha256: digestFor(seed),
      expectedSizeBytes: 500 + seed,
    };
    seed += 1;
    return entry;
  });
}

function manifestDocument(
  mutate: (files: ManifestFileEntry[]) => ManifestFileEntry[] = (files) => files,
  overrides: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    mode: 'local_manifest_validation',
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: BR_RECEITA_OPERATOR_CHUNK_AUTHORIZED_PERIOD,
    inputScope: 'full_national',
    layoutMode: 'official_headerless',
    files: mutate([...joinEntries(), ...catalogEntries()]),
    ...overrides,
  });
}

const COMPLETE_MANIFEST = manifestDocument();
const COMPLETE_FINGERPRINT = deriveBrReceitaNationalInventoryFingerprint({
  manifestDocument: COMPLETE_MANIFEST,
  expectedSourcePeriod: BR_RECEITA_OPERATOR_CHUNK_AUTHORIZED_PERIOD,
});

// ─── Fake ports ───────────────────────────────────────────────────────────────

function bridgeFileSystem(document: string): BrazilReceitaFullJoinBridgeFileSystem {
  return {
    readManifestDocument(manifestPath) {
      if (manifestPath !== MANIFEST_PATH) throw new Error('unexpected manifest path');
      return document;
    },
    isSymbolicLink: () => false,
    realPath: (targetPath) => targetPath,
    isRegularFile: () => true,
  };
}

/** Two-column latin1 catalog bytes, served from memory. Nothing here touches a disk. */
function catalogReaderFileSystem(): BrazilReceitaFullJoinReaderFileSystem {
  const buffers = new Map<string, Buffer>();
  for (const [family, fileName] of Object.entries(CATALOG_FILES)) {
    buffers.set(
      path.resolve(MANIFEST_DIRECTORY, fileName),
      Buffer.from(`"01";"${family.toUpperCase()} UM"\n"02";"${family.toUpperCase()} DOIS"\n`, 'latin1'),
    );
  }
  const handles = new Map<number, Buffer>();
  let nextHandle = 1;
  return {
    size(filePath) {
      const buffer = buffers.get(filePath);
      if (buffer === undefined) throw new Error('absent');
      return buffer.length;
    },
    open(filePath) {
      const buffer = buffers.get(filePath);
      if (buffer === undefined) throw new Error('absent');
      const handle = nextHandle;
      nextHandle += 1;
      handles.set(handle, buffer);
      return handle;
    },
    read(handle, buffer, bufferOffset, length, position) {
      const source = handles.get(handle);
      if (source === undefined) throw new Error('unknown handle');
      const start = Math.min(position, source.length);
      const end = Math.min(position + length, source.length);
      return source.copy(buffer, bufferOffset, start, end);
    },
    close(handle) {
      handles.delete(handle);
    },
  };
}

function acceptingValidator(): BrReceitaCnpjManifestValidationResult {
  return {
    ok: true,
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: BR_RECEITA_OPERATOR_CHUNK_AUTHORIZED_PERIOD,
    inputScope: 'full_national',
    filesSeen: 23,
    filesAccepted: 23,
    filesRejected: 0,
    fileReports: [],
    safety: {
      datasetDownload: false,
      supabaseWrite: false,
      productionImport: false,
      runtimeIntegration: false,
      agent1Integration: false,
      hubspot: false,
      slack: false,
      liveProspectGeneration: false,
    },
  };
}

interface SessionSpy {
  opens: number;
  closes: number;
  readonly statements: string[];
}

interface FakeEnvironment {
  readonly environment: BrReceitaOperatorChunkRuntimeEnvironment;
  readonly session: SessionSpy;
}

function fakeEnvironment(options?: {
  readonly document?: string;
  readonly databaseUrl?: string | undefined;
}): FakeEnvironment {
  const session: SessionSpy = { opens: 0, closes: 0, statements: [] };
  const env: Record<string, string | undefined> = {};
  const declaredUrl = options && 'databaseUrl' in options ? options.databaseUrl : SESSION_URL;
  if (declaredUrl !== undefined) env[BR_RECEITA_OPERATOR_DATABASE_URL_ENV] = declaredUrl;

  return {
    session,
    environment: {
      env,
      bridgeFileSystem: bridgeFileSystem(options?.document ?? COMPLETE_MANIFEST),
      readerFileSystem: catalogReaderFileSystem(),
      workspaceFileSystem: {} as BrReceitaOperatorChunkRuntimeEnvironment['workspaceFileSystem'],
      freeDiskProbe: () => Number.MAX_SAFE_INTEGER,
      validateManifest: async () => acceptingValidator(),
      async createSqlSession(): Promise<BrReceitaOperatorSqlSession> {
        session.opens += 1;
        return {
          sql: {
            async query(statement) {
              session.statements.push(statement);
              // The existing-run preflight is the only statement a benchmark window issues before
              // the first match; a detached, `preparing` run answers `ready`.
              return { rows: [{ ready: true }] };
            },
          },
          async close() {
            session.closes += 1;
          },
        };
      },
      homeDirectory: '/synthetic-home',
      repositoryRoot: '/synthetic-repository',
    },
  };
}

// ─── Operator declaration ─────────────────────────────────────────────────────

function argsFor(overrides: Readonly<Record<string, string>> = {}): string[] {
  const declared: Record<string, string> = {
    '--run-id': RUN_ID,
    '--period': BR_RECEITA_OPERATOR_CHUNK_AUTHORIZED_PERIOD,
    '--fingerprint': COMPLETE_FINGERPRINT,
    '--partition-start': '0',
    '--partition-count': '128',
    '--mode': 'benchmark',
    '--manifest': MANIFEST_PATH,
    '--workspace-parent': WORKSPACE_PARENT,
    '--max-output-rows': String(MAX_OUTPUT_ROWS),
    ...overrides,
  };
  const argv = Object.entries(declared).flatMap(([flag, value]) => [flag, value]);
  return [
    ...argv,
    '--second-real-attempt-owner-authorized',
    '--temporary-storage-policy-approved',
    '--cap-input-policy-approved',
  ];
}

async function refusalFrom(
  argv: readonly string[],
  fake: FakeEnvironment,
): Promise<string> {
  try {
    await provideBrReceitaOperatorChunkRuntime(
      parseBrReceitaOperatorChunkRuntimeArgs(argv),
      fake.environment,
    );
  } catch (error) {
    assert.ok(error instanceof BrReceitaOperatorChunkRuntimeError, `unexpected error: ${String(error)}`);
    return error.code;
  }
  return assert.fail('expected a refusal');
}

function completedEngineResult(start: number, endExclusive: number) {
  return {
    exitStatus: 'completed',
    abortCode: null,
    abortStage: null,
    resourceBreach: null,
    readerCapRejections: [],
    partitioningCapRejections: [],
    partitionOrdinalRangeRejections: [],
    resourceCapRejections: [],
    workspaceRejections: [],
    exact: { partitionsCreated: 1024, partitionDepthReached: 0 },
    publicReport: {},
    partitionSummaries: [],
    executedPartitionOrdinalRange: { start, endExclusive },
    firstFileOffsetProgression: [],
    cleanupOutcome: null,
  } as unknown as BrazilReceitaFullJoinEngineResult;
}

// ─── 1. No DATABASE_URL ───────────────────────────────────────────────────────

describe('runtime provider — connection declaration is required', () => {
  it('refuses when DATABASE_URL is absent', async () => {
    const fake = fakeEnvironment({ databaseUrl: undefined });
    assert.equal(await refusalFrom(argsFor(), fake), 'database_url_not_declared');
  });

  it('refuses an empty DATABASE_URL rather than treating it as unset-but-fine', async () => {
    const fake = fakeEnvironment({ databaseUrl: '   ' });
    assert.equal(await refusalFrom(argsFor(), fake), 'database_url_not_declared');
  });

  it('opens no session and reads no manifest when the connection is not declared', async () => {
    const fake = fakeEnvironment({ databaseUrl: undefined });
    await refusalFrom(argsFor(), fake);
    assert.equal(fake.session.opens, 0);
    assert.equal(fake.session.statements.length, 0);
  });

  it('refuses a declaration with no port instead of defaulting to 5432', () => {
    assert.throws(
      () => resolveBrReceitaOperatorSessionConnection('postgresql://user:pw@host/postgres'),
      (error: unknown) =>
        error instanceof BrReceitaOperatorChunkRuntimeError &&
        error.code === 'database_url_port_not_declared',
    );
  });

  it('refuses a non-postgres scheme', () => {
    assert.throws(
      () => resolveBrReceitaOperatorSessionConnection('mysql://user:pw@host:5432/db'),
      (error: unknown) =>
        error instanceof BrReceitaOperatorChunkRuntimeError &&
        error.code === 'database_url_scheme_not_postgres',
    );
  });

  it('accepts an explicit session/direct connection on 5432', () => {
    const connection = resolveBrReceitaOperatorSessionConnection(SESSION_URL);
    assert.equal(connection.port, BR_RECEITA_OPERATOR_SESSION_PORT);
    assert.equal(connection.transactionPooler, false);
  });
});

// ─── 2. Transaction pooler ────────────────────────────────────────────────────

describe('runtime provider — the transaction pooler is refused by name', () => {
  it('refuses port 6543', async () => {
    const fake = fakeEnvironment({ databaseUrl: POOLER_URL });
    assert.equal(
      await refusalFrom(argsFor(), fake),
      'database_url_transaction_pooler_port_refused',
    );
  });

  it('refuses port 6543 before any socket is opened', async () => {
    const fake = fakeEnvironment({ databaseUrl: POOLER_URL });
    await refusalFrom(argsFor(), fake);
    assert.equal(fake.session.opens, 0);
  });

  it('refuses pgbouncer=true even on the session port', async () => {
    const fake = fakeEnvironment({ databaseUrl: `${SESSION_URL}?pgbouncer=true` });
    assert.equal(
      await refusalFrom(argsFor(), fake),
      'database_url_transaction_pooler_mode_refused',
    );
  });

  it('refuses any other port rather than guessing which mode it holds', async () => {
    const fake = fakeEnvironment({
      databaseUrl: 'postgresql://loader:secret@db.example.internal:5433/postgres',
    });
    assert.equal(await refusalFrom(argsFor(), fake), 'database_url_port_not_session');
  });
});

// ─── 3. Incomplete manifest ───────────────────────────────────────────────────

describe('runtime provider — an incomplete 2026-07 inventory is refused', () => {
  it('refuses a missing Empresas part', async () => {
    const document = manifestDocument((files) =>
      files.filter((file) => !(file.fileType === 'empresas' && file.partOrdinal === 7)),
    );
    const fake = fakeEnvironment({ document });
    assert.equal(
      await refusalFrom(argsFor({ '--fingerprint': COMPLETE_FINGERPRINT }), fake),
      'manifest_inventory_incomplete',
    );
  });

  it('refuses a missing Estabelecimentos part', async () => {
    const document = manifestDocument((files) =>
      files.filter((file) => !(file.fileType === 'estabelecimentos' && file.partOrdinal === 9)),
    );
    assert.equal(
      await refusalFrom(argsFor(), fakeEnvironment({ document })),
      'manifest_inventory_incomplete',
    );
  });

  it('refuses a missing reference catalog', async () => {
    const document = manifestDocument((files) =>
      files.filter((file) => file.fileType !== 'naturezas'),
    );
    assert.equal(
      await refusalFrom(argsFor(), fakeEnvironment({ document })),
      'manifest_inventory_incomplete',
    );
  });

  it('refuses a consumed file declared without a verified digest and size', async () => {
    const document = manifestDocument((files) =>
      files.map((file) =>
        file.fileType === 'municipios'
          ? { ...file, expectedSha256: undefined, expectedSizeBytes: undefined }
          : file,
      ),
    );
    assert.equal(
      await refusalFrom(argsFor(), fakeEnvironment({ document })),
      'manifest_inventory_incomplete',
    );
  });

  it('refuses a manifest for another period', async () => {
    const document = manifestDocument(undefined, { sourcePeriod: '2026-08' });
    assert.equal(
      await refusalFrom(argsFor(), fakeEnvironment({ document })),
      'manifest_inventory_incomplete',
    );
  });

  it('refuses a fingerprint that does not match the manifest it was declared for', async () => {
    const other = manifestDocument((files) =>
      files.map((file) =>
        file.fileType === 'empresas' && file.partOrdinal === 0
          ? { ...file, expectedSizeBytes: 999_999 }
          : file,
      ),
    );
    const otherFingerprint = deriveBrReceitaNationalInventoryFingerprint({
      manifestDocument: other,
      expectedSourcePeriod: BR_RECEITA_OPERATOR_CHUNK_AUTHORIZED_PERIOD,
    });
    assert.notEqual(otherFingerprint, COMPLETE_FINGERPRINT);

    assert.equal(
      await refusalFrom(
        argsFor({ '--fingerprint': otherFingerprint }),
        fakeEnvironment({ document: COMPLETE_MANIFEST }),
      ),
      'inventory_fingerprint_mismatch',
    );
  });

  it('opens no session for any manifest refusal', async () => {
    const document = manifestDocument((files) =>
      files.filter((file) => file.fileType !== 'cnaes'),
    );
    const fake = fakeEnvironment({ document });
    await refusalFrom(argsFor(), fake);
    assert.equal(fake.session.opens, 0);
  });

  it('refuses a period other than the one authorized', () => {
    assert.throws(
      () => parseBrReceitaOperatorChunkRuntimeArgs(argsFor({ '--period': '2026-08' })),
      (error: unknown) =>
        error instanceof BrReceitaOperatorChunkRuntimeError &&
        error.code === 'period_not_authorized',
    );
  });

  it('refuses an invocation with no temporary-storage approval', () => {
    const argv = argsFor().filter((token) => token !== '--temporary-storage-policy-approved');
    assert.throws(
      () => parseBrReceitaOperatorChunkRuntimeArgs(argv),
      (error: unknown) =>
        error instanceof BrReceitaOperatorChunkRuntimeError &&
        error.code === 'temporary_storage_approval_missing',
    );
  });

  it('refuses an invocation that declares no output-row ceiling', () => {
    const argv = argsFor();
    const index = argv.indexOf('--max-output-rows');
    assert.throws(
      () =>
        parseBrReceitaOperatorChunkRuntimeArgs([
          ...argv.slice(0, index),
          ...argv.slice(index + 2),
        ]),
      (error: unknown) =>
        error instanceof BrReceitaOperatorChunkRuntimeError &&
        error.code === 'output_row_ceiling_not_declared',
    );
  });
});

// ─── 4. Benchmark with fake ports ─────────────────────────────────────────────

describe('runtime provider — benchmark with fake ports', () => {
  it('resolves the complete manifest into 20 join descriptors and 3 reference catalogs', async () => {
    const fake = fakeEnvironment();
    const runtime = await provideBrReceitaOperatorChunkRuntime(
      parseBrReceitaOperatorChunkRuntimeArgs(argsFor()),
      fake.environment,
    );

    assert.equal(runtime.joinSourceDescriptorCount, 20);
    assert.equal(runtime.referenceCatalogCount, 3);
    assert.equal(runtime.inventoryFingerprint, COMPLETE_FINGERPRINT);
    assert.equal(runtime.sessionPort, BR_RECEITA_OPERATOR_SESSION_PORT);
    assert.equal(runtime.ports.sourceYear, 2026);
    assert.equal(runtime.ports.catalogs.cnaesRows.length, 2);
    assert.equal(runtime.ports.catalogs.municipiosRows.length, 2);
    assert.equal(runtime.ports.catalogs.naturezasRows.length, 2);

    await runtime.close();
    assert.equal(fake.session.closes, 1);
  });

  it('pins the partition map at 1024 on both numbers and rejects duplicates', async () => {
    const fake = fakeEnvironment();
    const runtime = await provideBrReceitaOperatorChunkRuntime(
      parseBrReceitaOperatorChunkRuntimeArgs(argsFor()),
      fake.environment,
    );

    const caps = runtime.ports.engineRequest.partitioningCaps as Record<string, number>;
    assert.equal(caps.partitionCount, 1024);
    assert.equal(caps.maxPartitionCount, 1024);
    assert.equal(runtime.ports.engineRequest.duplicateKeyPolicy, 'reject');
    assert.equal(runtime.ports.engineRequest.realDataRun, true);
    assert.ok(runtime.ports.engineRequest.openHandleLedger);
    assert.equal(runtime.ports.engineRequest.workspaceParentDirectory, WORKSPACE_PARENT);

    await runtime.close();
  });

  it('carries the operator output-row ceiling and derives the materialization budget from it', async () => {
    const fake = fakeEnvironment();
    const runtime = await provideBrReceitaOperatorChunkRuntime(
      parseBrReceitaOperatorChunkRuntimeArgs(argsFor()),
      fake.environment,
    );

    const resourceCaps = runtime.ports.engineRequest.resourceCaps as Record<string, number>;
    assert.equal(resourceCaps.maxOutputRows, MAX_OUTPUT_ROWS);
    const materialization = runtime.ports.materializationCaps as Record<string, number>;
    // Two rows re-read per match: the Empresa row and the Estabelecimento row.
    assert.equal(materialization.maxRowsRehydrated, MAX_OUTPUT_ROWS * 2);
    assert.ok(materialization.maxAdditionalBytesRead > 0);

    await runtime.close();
  });

  it('runs one ordinal window through the real loader and reports loaded_not_published', async () => {
    const fake = fakeEnvironment();
    const runtime = await provideBrReceitaOperatorChunkRuntime(
      parseBrReceitaOperatorChunkRuntimeArgs(argsFor()),
      fake.environment,
    );

    // The engine itself is faked — the point of THIS test is the provider's ports, and a real
    // streaming join would need real Receita files. Everything between the ports and the report is
    // the production path: the real loader, the real projector and the real chunk writer.
    const exit = await main(argsFor(), {
      ...runtime.ports,
      runEngine: async (request) => {
        await request.sink.finalize();
        return completedEngineResult(0, 128);
      },
    });

    assert.equal(exit, BR_RECEITA_OPERATOR_CHUNK_EXIT.loaded);
    assert.equal(exit, 0);
    // The existing-run preflight ran against the injected session, and nothing else did.
    assert.equal(fake.session.statements.length, 1);
    assert.match(fake.session.statements[0]!, /source_snapshot_runs/);

    await runtime.close();
  });

  it('refuses through the CLI runner without a runtime and releases nothing it never opened', async () => {
    const fake = fakeEnvironment({ databaseUrl: undefined });
    const exit = await runBrReceitaOperatorChunkCli(argsFor(), fake.environment);
    assert.equal(exit, BR_RECEITA_OPERATOR_CHUNK_EXIT.refused);
    assert.equal(fake.session.opens, 0);
    assert.equal(fake.session.closes, 0);
  });

  it('refuses a malformed CLI declaration before the provider reads a manifest', async () => {
    const fake = fakeEnvironment();
    const argv = argsFor();
    const index = argv.indexOf('--run-id');
    const exit = await runBrReceitaOperatorChunkCli(
      [...argv.slice(0, index), ...argv.slice(index + 2)],
      fake.environment,
    );
    assert.equal(exit, BR_RECEITA_OPERATOR_CHUNK_EXIT.refused);
    assert.equal(fake.session.opens, 0);
  });
});

// ─── The real driver factory ──────────────────────────────────────────────────

describe('runtime provider — the real Postgres session factory', () => {
  const connection = resolveBrReceitaOperatorSessionConnection(SESSION_URL);

  it('refuses with a code when the driver is not installed instead of breaking the build', async () => {
    const factory = createBrReceitaOperatorPostgresSessionFactory(((specifier: string) => {
      throw new Error(`Cannot find module '${specifier}'`);
    }) as unknown as NodeRequire);

    await assert.rejects(
      factory(connection),
      (error: unknown) =>
        error instanceof BrReceitaOperatorChunkRuntimeError &&
        error.code === 'postgres_driver_unavailable',
    );
  });

  it('refuses a driver module that resolves without a Client', async () => {
    const factory = createBrReceitaOperatorPostgresSessionFactory(
      (() => ({})) as unknown as NodeRequire,
    );

    await assert.rejects(
      factory(connection),
      (error: unknown) =>
        error instanceof BrReceitaOperatorChunkRuntimeError &&
        error.code === 'postgres_driver_unavailable',
    );
  });

  it('maps a failed connect to a code and never forwards the driver message', async () => {
    class FailingClient {
      async connect(): Promise<void> {
        // A real `pg` message here would carry the host, the user and the database name.
        throw new Error('password authentication failed for user "loader" at db.example.internal');
      }
      async query(): Promise<{ rows: Record<string, unknown>[] }> {
        return { rows: [] };
      }
      async end(): Promise<void> {}
    }
    const factory = createBrReceitaOperatorPostgresSessionFactory(
      (() => ({ Client: FailingClient })) as unknown as NodeRequire,
    );

    await assert.rejects(factory(connection), (error: unknown) => {
      assert.ok(error instanceof BrReceitaOperatorChunkRuntimeError);
      assert.equal(error.code, 'postgres_session_unavailable');
      assert.doesNotMatch(error.message, /password|loader|db\.example/);
      return true;
    });
  });

  it('builds ONE client over the declared connection string and closes it once', async () => {
    const constructed: string[] = [];
    let ended = 0;
    const statements: string[] = [];
    class RecordingClient {
      constructor(options: { connectionString: string }) {
        constructed.push(options.connectionString);
      }
      async connect(): Promise<void> {}
      async query(statement: string): Promise<{ rows: Record<string, unknown>[] }> {
        statements.push(statement);
        return { rows: [{ ready: true }] };
      }
      async end(): Promise<void> {
        ended += 1;
      }
    }
    const factory = createBrReceitaOperatorPostgresSessionFactory(
      (() => ({ Client: RecordingClient })) as unknown as NodeRequire,
    );

    const session = await factory(connection);
    await session.sql.query('SELECT 1');
    await session.close();

    assert.deepEqual(constructed, [SESSION_URL]);
    assert.deepEqual(statements, ['SELECT 1']);
    assert.equal(ended, 1);
  });
});

// ─── Static guards (comment-stripped, so prose is never read as a call) ───────

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('runtime provider — static guards', () => {
  const code = stripComments(fs.readFileSync(RUNTIME_PATH, 'utf8'));

  it('never references publication, promotion, demotion or run creation in code', () => {
    assert.doesNotMatch(code, /commitFinalBatchAndPublish/);
    assert.doesNotMatch(code, /beginPeriodRun/);
    assert.doesNotMatch(code, /publishFinalChunk/);
    assert.doesNotMatch(code, /attachRunPartition|br_receita_attach_run_partition/);
    assert.doesNotMatch(code, /failPeriod|discardRunRows/);
  });

  it('never imports Supabase, a provider, HubSpot or a migration', () => {
    assert.doesNotMatch(code, /supabase|hubspot|apollo|lusha/i);
  });

  it('never opens a pool — one session, one backend', () => {
    assert.doesNotMatch(code, /new\s+\w*Pool\b|\bPool\s*\(/);
  });

  it('names the transaction pooler port and the session port as constants', () => {
    assert.match(code, /BR_RECEITA_OPERATOR_TRANSACTION_POOLER_PORT = 6543/);
    assert.match(code, /BR_RECEITA_OPERATOR_SESSION_PORT = 5432/);
  });

  it('reads exactly one environment variable, and it is the connection', () => {
    const environmentReads = code.match(/process\.env/g) ?? [];
    assert.equal(environmentReads.length, 1);
  });
});
