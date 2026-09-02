/**
 * BR Receita CNPJ — NATIONAL CHUNK OPERATOR RUNTIME PROVIDER (BR-SOURCE prod-resume loader).
 *
 * The one place that turns `br-source:operator-chunk` from a refusal into an executable command. The
 * CLI next door deliberately has no production wiring and no connection string; this module is the
 * wiring, kept apart so the CLI's guarantee ("cannot invent a runtime") stays a property of the CLI
 * source rather than a claim about it.
 *
 * ── What it provides, and nothing else ──────────────────────────────────────────
 *   1. The 2026-07 manifest, RESOLVED: Empresas0..9, Estabelecimentos0..9, CNAE, Municipios,
 *      Naturezas. Completeness is not re-implemented here — it is
 *      `deriveBrReceitaNationalInventoryFingerprint()`'s existing contract, which refuses a manifest
 *      that is missing a part or that declares a consumed file without a verified SHA-256 and byte
 *      size. This module then re-checks that the manifest BRIDGE resolved the same shape on disk,
 *      because the fingerprint hashes DECLARATIONS while the bridge resolves PATHS, and the two
 *      agreeing is the only thing that makes the fingerprint mean the files that will actually be
 *      read.
 *   2. A `BrazilReceitaFullJoinEngineRequest` base: real filesystem, one shared open-handle ledger,
 *      the partition map pinned at 1024, `duplicateKeyPolicy: 'reject'`, and explicit resource caps.
 *   3. A SQL executor over an EXPLICIT session/direct connection, refusing the transaction pooler.
 *   4. The snapshot write gateway, built on that executor.
 *
 * ── What it structurally cannot do ──────────────────────────────────────────────
 * Publish, attach a partition or create a run. It builds `createBrReceitaSqlWriteGateway()` — which
 * owns those methods — but the only consumer it hands the gateway to is the national chunk loader,
 * whose writer reaches `upsertBatch` and nothing else. This module names none of the promotion or
 * run-creation calls, and the test suite asserts that against its comment-stripped source.
 *
 * ── Never the transaction pooler ────────────────────────────────────────────────
 * The write gateway is STATEFUL across statements: it owns `BEGIN`, tracks whether a transaction is
 * open, and memoises each run's detached partition name. All three assume the next statement lands
 * on the same backend. A transaction pooler does not promise that outside an explicit transaction,
 * so port 6543 and `pgbouncer=true` are refused by name, before a socket is opened. Session mode and
 * a direct connection both hold the session, and both are 5432 — which is why 5432 is the only port
 * this module accepts, and why it must be declared rather than defaulted.
 *
 * ── Fail-closed order ──────────────────────────────────────────────────────────
 * Declaration shape, then the connection DECLARATION, then the manifest, then the catalogs, and only
 * then a real connection. A malformed manifest therefore never opens a database connection, and a
 * missing `DATABASE_URL` never opens a 30 GB file.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - publishes, promotes, demotes, attaches a partition or creates a run.
 *   - touches Agent 1, Agent 2A, a provider, HubSpot, a feature flag or the UI.
 *   - applies a migration or reads a Supabase key.
 *   - prints a path, a file name, a row, a CNPJ or a connection string. Refusals carry a fixed code.
 */

import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  resolveBrazilReceitaAttempt2OperatorAuthorization,
  type BrazilReceitaAttempt2OperatorAuthorization,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-attempt2-operator-authorization';
import { BRAZIL_RECEITA_NATIONAL_MULTIPART_EXPECTED_PARTS_PER_FAMILY } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-14b0m-national-multipart-size-preflight';
import { BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-existing-run-chunk-writer';
import {
  createBrazilReceitaFullJoinFreeDiskProbe,
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-engine-fs';
import type { BrazilReceitaFullJoinFreeDiskProbe } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-free-disk';
import { createBrazilReceitaFullJoinBridgeFileSystem } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-manifest-bridge-fs';
import {
  resolveBrazilReceitaFullJoinManifestSources,
  type BrazilReceitaFullJoinBridgeFileSystem,
  type BrazilReceitaFullJoinBridgeManifestValidator,
  type BrazilReceitaFullJoinLookupSource,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-manifest-source-bridge';
import { createBrazilReceitaFullJoinOpenHandleLedger } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-open-handle-ledger';
import { BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-partition-handle-pool';
import type { BrazilReceitaFullJoinWorkspaceFileSystem } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-partition-workspace';
import { createBrazilReceitaFullJoinResourceProcessDependencies } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-resource-envelope';
import type { BrazilReceitaFullJoinReaderFileSystem } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-streaming-reader';
import {
  mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval,
  type BrazilReceitaFullJoinInvocationTemporaryStorageApproval,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-temporary-storage-approval';
import { validateBrReceitaCnpjLocalManifest } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-manifest-validator';
import {
  createBrReceitaSqlWriteGateway,
  type BrReceitaSnapshotWriteGateway,
  type BrReceitaSqlExecutor,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-monthly-snapshot-write-gateway';
import type { BrReceitaNationalChunkEngineBaseRequest } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-chunk-loader';
import { deriveBrReceitaNationalInventoryFingerprint } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-inventory-fingerprint';
import type { BrReceitaNationalReferenceCatalogs } from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-match-projector';
import {
  loadBrReceitaNationalReferenceCatalogs,
  type BrReceitaNationalReferenceCatalogCaps,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-reference-catalog-loader';
import {
  brazilReceitaProposedFullScanResourceCaps,
  BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS,
  BRAZIL_RECEITA_REAL_FULL_SCAN_CAP_APPROVAL_STATUS,
} from '../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-real-full-scan-benchmark';
import type { BrReceitaOperatorChunkPorts } from './br-receita-operator-chunk';

// ─── The one authorized period ────────────────────────────────────────────────

/**
 * The ONLY period this provider will resolve.
 *
 * Pinned rather than parameterised because a resume loader that accepted any period would happily
 * load August's files into July's run on a typo, and the run id an operator pastes carries no
 * evidence of which month it belongs to. Next month is a source edit and a PR — which is the point.
 */
export const BR_RECEITA_OPERATOR_CHUNK_AUTHORIZED_PERIOD = '2026-07' as const;

/** Empresas0..9 and Estabelecimentos0..9 — reused, not restated. */
export const BR_RECEITA_OPERATOR_CHUNK_EXPECTED_PARTS_PER_JOIN_FAMILY =
  BRAZIL_RECEITA_NATIONAL_MULTIPART_EXPECTED_PARTS_PER_FAMILY;

/** The join families the loader consumes, in contractual order. */
export const BR_RECEITA_OPERATOR_CHUNK_JOIN_FAMILIES = ['empresas', 'estabelecimentos'] as const;

/** CNAE, Municipios, Naturezas. `simples` may be declared and is deliberately not consumed. */
export const BR_RECEITA_OPERATOR_CHUNK_REFERENCE_FAMILIES = [
  'cnaes',
  'municipios',
  'naturezas',
] as const;

// ─── The connection surface ───────────────────────────────────────────────────

/** The environment variable that carries the connection. There is no second name and no fallback. */
export const BR_RECEITA_OPERATOR_DATABASE_URL_ENV = 'DATABASE_URL' as const;

/** Session pooler and direct connections both hold the session, and both are this port. */
export const BR_RECEITA_OPERATOR_SESSION_PORT = 5432 as const;

/** The transaction pooler. Refused by name so its failure mode cannot be discovered mid-load. */
export const BR_RECEITA_OPERATOR_TRANSACTION_POOLER_PORT = 6543 as const;

/** Query parameters that put a connection into transaction-pooling mode whatever the port says. */
export const BR_RECEITA_OPERATOR_TRANSACTION_POOLER_PARAMETERS = ['pgbouncer'] as const;

const POSTGRES_URL_SCHEMES = ['postgres:', 'postgresql:'] as const;

/**
 * The driver module, as a VALUE rather than a static import specifier.
 *
 * `pg` is not a dependency of this repository — the ephemeral-Postgres harness brings it in with
 * `--no-save` — so a static `import 'pg'` would fail `npm run typecheck` on a clean checkout. Naming
 * it here and resolving it through `createRequire` is the same technique
 * `source-snapshot-identity-real-migration-chain.ts` uses, for the same reason, and it keeps the
 * absence a runtime refusal with a code instead of a build break.
 */
const POSTGRES_DRIVER_MODULE = 'pg';

// ─── Caps ─────────────────────────────────────────────────────────────────────

/**
 * Ceilings for the three reference catalogs, stated here because the catalog loader has no defaults.
 *
 * CNAE is ~1.4k rows, Municipios ~5.6k and Naturezas ~90, each two columns. 4 MiB and 32k rows is
 * two orders of magnitude of headroom over the real files and four orders below the smallest data
 * file, so a manifest that pointed a catalog entry at Empresas0 is refused by size, not by patience.
 */
export const BR_RECEITA_OPERATOR_REFERENCE_CATALOG_CAPS: BrReceitaNationalReferenceCatalogCaps =
  Object.freeze({
    maxBytesPerCatalog: 4_194_304,
    maxRowsPerCatalog: 32_768,
    maxChunkBytes: 1_048_576,
    maxRowBytes: 4_096,
  });

/**
 * The standing of the resource profile this provider assembles.
 *
 * Re-exported from the benchmark module rather than restated: these are PROPOSED benchmark caps, and
 * a chunk load that ran under them has not thereby had production caps approved.
 */
export const BR_RECEITA_OPERATOR_CHUNK_CAP_APPROVAL_STATUS =
  BRAZIL_RECEITA_REAL_FULL_SCAN_CAP_APPROVAL_STATUS;

// ─── Refusals ─────────────────────────────────────────────────────────────────

export const BR_RECEITA_OPERATOR_RUNTIME_REFUSALS = [
  'period_not_authorized',
  'manifest_path_not_declared',
  'manifest_path_not_absolute',
  'manifest_document_unreadable',
  'manifest_inventory_incomplete',
  'manifest_bridge_refused',
  'manifest_period_mismatch',
  'manifest_join_parts_incomplete',
  'manifest_reference_catalogs_incomplete',
  'inventory_fingerprint_not_declared',
  'inventory_fingerprint_mismatch',
  'reference_catalogs_unreadable',
  'workspace_parent_not_declared',
  'workspace_parent_not_absolute',
  'dataset_root_not_absolute',
  'temporary_storage_approval_missing',
  'output_row_ceiling_not_declared',
  'output_row_ceiling_invalid',
  'database_url_not_declared',
  'database_url_not_parseable',
  'database_url_scheme_not_postgres',
  'database_url_port_not_declared',
  'database_url_transaction_pooler_port_refused',
  'database_url_transaction_pooler_mode_refused',
  'database_url_port_not_session',
  'postgres_driver_unavailable',
  'postgres_session_unavailable',
] as const;

export type BrReceitaOperatorRuntimeRefusal =
  (typeof BR_RECEITA_OPERATOR_RUNTIME_REFUSALS)[number];

export class BrReceitaOperatorChunkRuntimeError extends Error {
  readonly code: BrReceitaOperatorRuntimeRefusal;

  constructor(code: BrReceitaOperatorRuntimeRefusal) {
    super(`br receita operator chunk runtime refused (${code})`);
    this.name = 'BrReceitaOperatorChunkRuntimeError';
    this.code = code;
  }
}

function refuse(code: BrReceitaOperatorRuntimeRefusal): never {
  throw new BrReceitaOperatorChunkRuntimeError(code);
}

// ─── Connection declaration ───────────────────────────────────────────────────

/**
 * A validated session/direct connection.
 *
 * `connectionString` is carried so the driver can use it and is never printed, never reported and
 * never embedded in a refusal — it holds a password.
 */
export interface BrReceitaOperatorSessionConnection {
  readonly connectionString: string;
  readonly port: typeof BR_RECEITA_OPERATOR_SESSION_PORT;
  readonly transactionPooler: false;
}

/**
 * Validates the connection DECLARATION. Opens nothing.
 *
 * An absent port is refused rather than defaulted to 5432: `postgres://host/db` reaching a pooler
 * that happens to listen on 5432 in transaction mode is exactly the silent case this check exists
 * for, and "the operator did not say" is not evidence of session mode.
 */
export function resolveBrReceitaOperatorSessionConnection(
  rawUrl: string | null | undefined,
): BrReceitaOperatorSessionConnection {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    refuse('database_url_not_declared');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    refuse('database_url_not_parseable');
  }

  if (!(POSTGRES_URL_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    refuse('database_url_scheme_not_postgres');
  }
  if (parsed.port === '') {
    refuse('database_url_port_not_declared');
  }

  for (const parameter of BR_RECEITA_OPERATOR_TRANSACTION_POOLER_PARAMETERS) {
    const declared = parsed.searchParams.get(parameter);
    // Presence is enough. A `pgbouncer` parameter set to anything is a caller telling the driver it
    // is talking to a pooler, and a caller who says so is not to be second-guessed into session mode.
    if (declared !== null && declared !== 'false') {
      refuse('database_url_transaction_pooler_mode_refused');
    }
  }

  const port = Number(parsed.port);
  if (port === BR_RECEITA_OPERATOR_TRANSACTION_POOLER_PORT) {
    refuse('database_url_transaction_pooler_port_refused');
  }
  if (port !== BR_RECEITA_OPERATOR_SESSION_PORT) {
    refuse('database_url_port_not_session');
  }

  return Object.freeze({
    connectionString: rawUrl,
    port: BR_RECEITA_OPERATOR_SESSION_PORT,
    transactionPooler: false,
  });
}

// ─── SQL session ──────────────────────────────────────────────────────────────

/** One held session. `close()` is the only lifecycle operation; there is no reconnect. */
export interface BrReceitaOperatorSqlSession {
  readonly sql: BrReceitaSqlExecutor;
  close(): Promise<void>;
}

export type BrReceitaOperatorSqlSessionFactory = (
  connection: BrReceitaOperatorSessionConnection,
) => Promise<BrReceitaOperatorSqlSession>;

interface DriverClient {
  connect(): Promise<void>;
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

/**
 * The real factory: ONE `pg.Client`, not a pool.
 *
 * A pool would hand consecutive statements to different backends, which is the same defect as the
 * transaction pooler wearing a local name — the gateway's `BEGIN`, its in-transaction flag and its
 * memoised partition name all assume one backend for the whole load.
 */
export function createBrReceitaOperatorPostgresSessionFactory(
  requireModule: NodeRequire = createRequire(__filename),
): BrReceitaOperatorSqlSessionFactory {
  return async (connection) => {
    let ClientConstructor: new (options: { connectionString: string }) => DriverClient;
    try {
      const driver = requireModule(POSTGRES_DRIVER_MODULE) as {
        Client?: new (options: { connectionString: string }) => DriverClient;
      };
      if (typeof driver?.Client !== 'function') refuse('postgres_driver_unavailable');
      ClientConstructor = driver.Client;
    } catch (error) {
      if (error instanceof BrReceitaOperatorChunkRuntimeError) throw error;
      refuse('postgres_driver_unavailable');
    }

    const client = new ClientConstructor({ connectionString: connection.connectionString });
    try {
      await client.connect();
    } catch {
      // The driver's message can carry the host, the user and the database name. It is dropped.
      refuse('postgres_session_unavailable');
    }

    return {
      sql: {
        async query(statement, params) {
          return client.query(statement, params);
        },
      },
      async close() {
        await client.end();
      },
    };
  };
}

// ─── The provider's own ports ─────────────────────────────────────────────────

/**
 * Everything the provider itself needs from the outside world. Injected, so the whole resolution
 * path — manifest, catalogs, engine request, gateway — is exercisable without a real dataset and
 * without a real database.
 */
export interface BrReceitaOperatorChunkRuntimeEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly bridgeFileSystem: BrazilReceitaFullJoinBridgeFileSystem;
  readonly readerFileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly workspaceFileSystem: BrazilReceitaFullJoinWorkspaceFileSystem;
  readonly freeDiskProbe: BrazilReceitaFullJoinFreeDiskProbe;
  readonly validateManifest: BrazilReceitaFullJoinBridgeManifestValidator;
  readonly createSqlSession: BrReceitaOperatorSqlSessionFactory;
  /** Workspace boundary: a temporary workspace may not live under either of these. */
  readonly homeDirectory: string;
  readonly repositoryRoot: string;
}

/** The real environment. The only function here that reads the process or the disk. */
export function createBrReceitaOperatorChunkRuntimeEnvironment(): BrReceitaOperatorChunkRuntimeEnvironment {
  return {
    env: process.env,
    bridgeFileSystem: createBrazilReceitaFullJoinBridgeFileSystem(),
    readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
    workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
    freeDiskProbe: createBrazilReceitaFullJoinFreeDiskProbe(),
    // `allowRealLocalFiles: true`: the whole point of resolving a manifest before a multi-hour load
    // is confirming the files are the ones it claims, by size and digest.
    validateManifest: async ({ manifestPath }) =>
      validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true }),
    createSqlSession: createBrReceitaOperatorPostgresSessionFactory(),
    homeDirectory: os.homedir(),
    repositoryRoot: path.resolve(__dirname, '..', '..', '..'),
  };
}

// ─── Declaration ──────────────────────────────────────────────────────────────

export const BR_RECEITA_OPERATOR_RUNTIME_FLAGS = Object.freeze({
  manifest: '--manifest',
  workspaceParent: '--workspace-parent',
  datasetRoot: '--dataset-root',
  maxOutputRows: '--max-output-rows',
});

export interface BrReceitaOperatorChunkRuntimeDeclaration {
  readonly sourcePeriod: string;
  readonly declaredInventoryFingerprint: string;
  readonly manifestPath: string;
  readonly workspaceParentDirectory: string;
  readonly datasetRoot: string | null;
  readonly maxOutputRows: number;
  readonly authorization: BrazilReceitaAttempt2OperatorAuthorization;
}

const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const INTEGER_PATTERN = /^[1-9][0-9]*$/;

function readFlag(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) return null;
  return value;
}

/**
 * Reads the runtime half of the operator's declaration off the SAME argv the CLI parses.
 *
 * `--period` and `--fingerprint` are read again here rather than threaded through, because this
 * function's answer must be checkable on its own: a caller that provisioned a runtime for one month
 * and then ran the CLI for another would have two parsers disagreeing silently.
 */
export function parseBrReceitaOperatorChunkRuntimeArgs(
  argv: readonly string[],
): BrReceitaOperatorChunkRuntimeDeclaration {
  const period = readFlag(argv, '--period');
  if (period !== BR_RECEITA_OPERATOR_CHUNK_AUTHORIZED_PERIOD) {
    refuse('period_not_authorized');
  }

  const fingerprint = readFlag(argv, '--fingerprint');
  if (fingerprint === null) refuse('inventory_fingerprint_not_declared');
  if (!FINGERPRINT_PATTERN.test(fingerprint)) refuse('inventory_fingerprint_not_declared');

  const manifestPath = readFlag(argv, BR_RECEITA_OPERATOR_RUNTIME_FLAGS.manifest);
  if (manifestPath === null) refuse('manifest_path_not_declared');
  if (!path.isAbsolute(manifestPath)) refuse('manifest_path_not_absolute');

  const workspaceParent = readFlag(argv, BR_RECEITA_OPERATOR_RUNTIME_FLAGS.workspaceParent);
  if (workspaceParent === null) refuse('workspace_parent_not_declared');
  if (!path.isAbsolute(workspaceParent)) refuse('workspace_parent_not_absolute');

  const datasetRoot = readFlag(argv, BR_RECEITA_OPERATOR_RUNTIME_FLAGS.datasetRoot);
  if (datasetRoot !== null && !path.isAbsolute(datasetRoot)) refuse('dataset_root_not_absolute');

  const rawOutputRows = readFlag(argv, BR_RECEITA_OPERATOR_RUNTIME_FLAGS.maxOutputRows);
  if (rawOutputRows === null) refuse('output_row_ceiling_not_declared');
  // The one cap the operator must state. Every other figure in the profile is a benchmark proposal
  // that already exists in tracked source; this one decides how many rows the load may write, and a
  // default would be a production import ceiling nobody approved.
  if (!INTEGER_PATTERN.test(rawOutputRows)) refuse('output_row_ceiling_invalid');
  const maxOutputRows = Number(rawOutputRows);
  if (!Number.isSafeInteger(maxOutputRows)) refuse('output_row_ceiling_invalid');

  const resolution = resolveBrazilReceitaAttempt2OperatorAuthorization(argv);
  const approval = resolution.ok
    ? mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(resolution.authorization)
    : null;
  if (approval === null) refuse('temporary_storage_approval_missing');

  return {
    sourcePeriod: BR_RECEITA_OPERATOR_CHUNK_AUTHORIZED_PERIOD,
    declaredInventoryFingerprint: fingerprint,
    manifestPath,
    workspaceParentDirectory: workspaceParent,
    datasetRoot,
    maxOutputRows,
    authorization: resolution.authorization,
  };
}

// ─── Provision ────────────────────────────────────────────────────────────────

export interface BrReceitaOperatorChunkRuntime {
  readonly ports: BrReceitaOperatorChunkPorts;
  /** DERIVED from the manifest, not copied from the operator's declaration. */
  readonly inventoryFingerprint: string;
  readonly joinSourceDescriptorCount: number;
  readonly referenceCatalogCount: number;
  readonly sessionPort: typeof BR_RECEITA_OPERATOR_SESSION_PORT;
  readonly capApprovalStatus: typeof BR_RECEITA_OPERATOR_CHUNK_CAP_APPROVAL_STATUS;
  close(): Promise<void>;
}

function assertJoinPartsComplete(
  sources: readonly { readonly family: string; readonly manifestPartOrdinal?: number }[],
): void {
  for (const family of BR_RECEITA_OPERATOR_CHUNK_JOIN_FAMILIES) {
    const ordinals = new Set(
      sources
        .filter((source) => source.family === family)
        .map((source) => source.manifestPartOrdinal),
    );
    if (ordinals.size !== BR_RECEITA_OPERATOR_CHUNK_EXPECTED_PARTS_PER_JOIN_FAMILY) {
      refuse('manifest_join_parts_incomplete');
    }
    for (let ordinal = 0; ordinal < BR_RECEITA_OPERATOR_CHUNK_EXPECTED_PARTS_PER_JOIN_FAMILY; ordinal += 1) {
      if (!ordinals.has(ordinal)) refuse('manifest_join_parts_incomplete');
    }
  }
}

function assertReferenceCatalogsComplete(
  lookups: readonly BrazilReceitaFullJoinLookupSource[],
): void {
  for (const family of BR_RECEITA_OPERATOR_CHUNK_REFERENCE_FAMILIES) {
    if (lookups.filter((lookup) => lookup.family === family).length !== 1) {
      refuse('manifest_reference_catalogs_incomplete');
    }
  }
}

/**
 * Resolves the manifest, loads the catalogs, opens ONE session and returns the loader's ports.
 *
 * The order below is the safety property, not a style: nothing opens a data file until the manifest
 * has been proven complete and to match the operator's fingerprint, and nothing opens a database
 * connection until the catalogs have loaded.
 */
export async function provideBrReceitaOperatorChunkRuntime(
  declaration: BrReceitaOperatorChunkRuntimeDeclaration,
  environment: BrReceitaOperatorChunkRuntimeEnvironment,
): Promise<BrReceitaOperatorChunkRuntime> {
  if (declaration.sourcePeriod !== BR_RECEITA_OPERATOR_CHUNK_AUTHORIZED_PERIOD) {
    refuse('period_not_authorized');
  }

  // The connection DECLARATION, before a byte is read. An operator with no `DATABASE_URL` learns it
  // now rather than after a manifest digest pass over 30 GB.
  const connection = resolveBrReceitaOperatorSessionConnection(
    environment.env[BR_RECEITA_OPERATOR_DATABASE_URL_ENV],
  );

  const approval = mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(
    declaration.authorization,
  );
  if (approval === null) refuse('temporary_storage_approval_missing');

  let manifestDocument: string;
  try {
    manifestDocument = environment.bridgeFileSystem.readManifestDocument(declaration.manifestPath);
  } catch {
    refuse('manifest_document_unreadable');
  }

  // Completeness lives HERE, in the existing fingerprint contract: Empresas0..9,
  // Estabelecimentos0..9, CNAE, Municipios, Naturezas, each with a verified digest and byte size.
  let derivedFingerprint: string;
  try {
    derivedFingerprint = deriveBrReceitaNationalInventoryFingerprint({
      manifestDocument,
      expectedSourcePeriod: declaration.sourcePeriod,
    });
  } catch {
    refuse('manifest_inventory_incomplete');
  }
  if (derivedFingerprint !== declaration.declaredInventoryFingerprint) {
    // The run id an operator pastes says nothing about which month's files it was opened for. This
    // comparison is what stops a July run from being resumed against August's inventory.
    refuse('inventory_fingerprint_mismatch');
  }

  const bridged = await resolveBrazilReceitaFullJoinManifestSources({
    manifestPath: declaration.manifestPath,
    fileSystem: environment.bridgeFileSystem,
    validateManifest: environment.validateManifest,
    allowRealLocalFiles: true,
  });
  if (!bridged.ok) refuse('manifest_bridge_refused');
  if (bridged.sourcePeriod !== declaration.sourcePeriod) refuse('manifest_period_mismatch');

  // The fingerprint hashed DECLARATIONS; the bridge resolved PATHS. Both agreeing is what makes the
  // fingerprint mean the files that will actually be opened.
  assertJoinPartsComplete(bridged.joinSources);
  assertReferenceCatalogsComplete(bridged.lookupSources);

  let catalogs: BrReceitaNationalReferenceCatalogs;
  try {
    catalogs = loadBrReceitaNationalReferenceCatalogs({
      lookupSources: bridged.lookupSources,
      fileSystem: environment.readerFileSystem,
      caps: BR_RECEITA_OPERATOR_REFERENCE_CATALOG_CAPS,
    });
  } catch {
    refuse('reference_catalogs_unreadable');
  }

  const engineRequest = buildEngineRequest({
    declaration,
    environment,
    approval,
    sources: bridged.joinSources,
  });

  const session = await environment.createSqlSession(connection);
  const gateway: BrReceitaSnapshotWriteGateway = createBrReceitaSqlWriteGateway(session.sql);

  return {
    ports: {
      sourceYear: bridged.sourceYear,
      sql: session.sql,
      gateway,
      catalogs,
      materializationCaps: {
        // Two rows are re-read per match — the Empresa row and the Estabelecimento row — so the
        // rehydration ceiling is twice the output ceiling the operator declared, and the byte
        // ceiling is that count at the reader's own per-row maximum. Derived from a declared figure
        // rather than defaulted, which is what the envelope's "no defaults" rule asks for.
        maxRowsRehydrated: declaration.maxOutputRows * 2,
        maxAdditionalBytesRead:
          declaration.maxOutputRows * 2 * BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxRowBytes,
      },
      engineRequest,
    },
    inventoryFingerprint: derivedFingerprint,
    joinSourceDescriptorCount: bridged.joinSources.length,
    referenceCatalogCount: BR_RECEITA_OPERATOR_CHUNK_REFERENCE_FAMILIES.length,
    sessionPort: connection.port,
    capApprovalStatus: BR_RECEITA_OPERATOR_CHUNK_CAP_APPROVAL_STATUS,
    async close() {
      await session.close();
    },
  };
}

function buildEngineRequest(args: {
  readonly declaration: BrReceitaOperatorChunkRuntimeDeclaration;
  readonly environment: BrReceitaOperatorChunkRuntimeEnvironment;
  readonly approval: BrazilReceitaFullJoinInvocationTemporaryStorageApproval;
  readonly sources: BrReceitaNationalChunkEngineBaseRequest['sources'];
}): BrReceitaNationalChunkEngineBaseRequest {
  const profile = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;

  return {
    sources: args.sources,
    readerCaps: {
      maxChunkBytes: profile.maxChunkBytes,
      maxCarryBytes: profile.maxCarryBytes,
      maxRowBytes: profile.maxRowBytes,
      maxColumnsPerRow: profile.maxColumnsPerRow,
    },
    partitioningCaps: {
      // Pinned, and pinned on BOTH numbers. The benchmark profile proposes a 2048 ceiling for a
      // controlled repartition; the national chunk loader refuses anything but 1024/1024, because a
      // repartition mid-resume would move rows to ordinals a previous chunk already claimed.
      partitionCount: BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT,
      maxPartitionCount: BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT,
      maxPartitionDepth: profile.maxPartitionDepth,
      maxReferencesPerPartition: profile.maxReferencesPerPartition,
      maxReferenceBytesPerPartition: profile.maxReferenceBytesPerPartition,
    },
    resourceCaps: {
      ...brazilReceitaProposedFullScanResourceCaps(),
      // The profile's `maxOutputRows: 0` is the BENCHMARK's control — a materializing sink aborts on
      // the first match under it. A chunk load materializes by definition, so the ceiling has to
      // come from the operator, and it is the only figure this provider overrides.
      maxOutputRows: args.declaration.maxOutputRows,
    },
    duplicateKeyPolicy: 'reject',
    readerFileSystem: args.environment.readerFileSystem,
    workspaceFileSystem: args.environment.workspaceFileSystem,
    workspaceParentDirectory: args.declaration.workspaceParentDirectory,
    workspaceBoundaries: {
      repositoryRoot: args.environment.repositoryRoot,
      homeDirectory: args.environment.homeDirectory,
      datasetRoot: args.declaration.datasetRoot,
    },
    resourceDependencies: createBrazilReceitaFullJoinResourceProcessDependencies(),
    // ONE ledger for the whole invocation: source files, partition files and the projector's
    // rehydration reads all reserve from it, which is the only way the 64-descriptor cap bounds the
    // process rather than one component of it.
    openHandleLedger: createBrazilReceitaFullJoinOpenHandleLedger(profile.maxFilesOpened),
    maxOpenPartitionFiles: BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES,
    minimumFreeDiskBeforeStart: profile.minimumFreeDiskBeforeStart,
    minimumFreeDiskReserve: profile.minimumFreeDiskReserve,
    freeDiskProbe: args.environment.freeDiskProbe,
    realDataRun: true,
    invocationTemporaryStorageApproval: args.approval,
  };
}
