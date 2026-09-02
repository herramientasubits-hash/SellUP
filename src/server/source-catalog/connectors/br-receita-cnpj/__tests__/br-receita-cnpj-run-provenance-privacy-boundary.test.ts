/**
 * BR-PROVENANCE-FINAL-PRIVACY-BOUNDARY — the two holes the pre-#370 correction did not close.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 NO Production. NO remote database. NO apply_migration. NO provider. NO
 * credit. NO flag. NO national import. Migration 134 is UNCHANGED and is
 * applied to an EPHEMERAL embedded PostgreSQL and to nothing else. Every
 * identifier below is synthetic.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 1. An allowed KEY could still carry a disallowed VALUE ──────────────────
 *
 * `brReceitaRunProvenanceForRun` narrowed the four provenance KEYS and then accepted any
 * non-empty string in them. So `source_file_name` could be `/Users/ana/receita.csv` or
 * `C:\Users\ana\receita.csv` — an operator's home directory, persisted into a jsonb column that
 * a publication keeps forever — and `parser_version` / `import_batch_id` were free-text carriers
 * with no shape at all. Each value now has to match its shape, and a value that does not is
 * OMITTED rather than repaired: basenaming a path would launder the disclosure into something
 * that looks legitimate, which is worse than absent.
 *
 * ── 2. The planner was the only narrowing ──────────────────────────────────
 *
 * `beginPeriodRun` persisted `JSON.stringify(operation.metadata)` directly. Every caller that
 * goes through `planBrReceitaMonthlySnapshotWrite` is safe by construction — but the gateway is a
 * public surface, and a direct runtime caller with a cast object bypassed the allowlist entirely.
 * The write boundary now runs the metadata back through the SAME narrower, so the last thing to
 * touch the value before it becomes jsonb is the narrower and not a caller's promise.
 *
 * 🔴 The regression for that one does NOT test the planner. It calls `gateway.beginPeriodRun`
 * DIRECTLY against a real database and reads `source_snapshot_runs.metadata` back out, because
 * only a real read can tell "narrowed at the boundary" apart from "narrowed upstream".
 *
 * ── 3. A shape-valid VALUE could still BE an identifier ─────────────────────
 *
 * Shape validation closed paths and prose, and left one thing open: an unformatted CNPJ is
 * fourteen digits and nothing else, so it satisfies every safe-token charset by itself and rides
 * into jsonb inside an APPROVED key — `parser_version`, `source_file_name`, `import_batch_id`.
 * GATE-4A allows the source exactly ONE persisted exact CNPJ representation,
 * `br_receita_snapshots.normalized_tax_id`, and `source_snapshot_runs.metadata` is not it.
 * A CNPJ-shaped value is now refused SEMANTICALLY, by shape and never by check digit, and the
 * refusal is an OMISSION — no normalisation, no repair, and no identifier in any error.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyRealChain,
  bootstrapPlatform,
  BR_RECEITA_COMPACT_CHAIN,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../../__tests__/support/source-snapshot-identity-real-migration-chain';

import {
  BR_RECEITA_COMPACT_STORAGE_CONTRACT,
  BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS,
  brReceitaRunProvenanceForRun,
  containsForbiddenCnpjIdentifierShape,
} from '../br-receita-cnpj-compact-storage';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_PARSER_VERSION,
  BR_RECEITA_CNPJ_SOURCE_KEY,
} from '../br-receita-cnpj-types';
import {
  createBrReceitaSqlWriteGateway,
  type BrReceitaSqlExecutor,
} from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import type { BeginPeriodOperation } from '../br-receita-cnpj-monthly-snapshot-write-plan';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const { ctor: EmbeddedPostgresCtor, skip: harnessSkip } = resolveEmbeddedPostgres(import.meta.url);

/** The one legitimate filename shape: a simple name, no directory anywhere in it. */
const SIMPLE_FILE_NAME = 'estabelecimentos0.csv';
/** Two operator-side absolute paths. Neither is a filename, and neither may persist. */
const LOCAL_ABSOLUTE_PATH = '/Users/test/receita.csv';
const WINDOWS_ABSOLUTE_PATH = 'C:\\Users\\test\\receita.csv';

/**
 * A SYNTHETIC CNPJ-shaped identifier, assembled from its parts so that no fourteen-digit literal
 * sits in this source. It denotes no real company; it exists only to be refused.
 */
const SYNTHETIC_CNPJ = ['11222333', '0001', '81'].join('');
/** The same shape with deliberately WRONG check digits — refusal must not depend on the DV. */
const SYNTHETIC_CNPJ_BAD_DV = ['11222333', '0001', '00'].join('');

/**
 * The three carriers. Each is a value that PASSES its safe-token shape and still hides a CNPJ:
 * a filename, a version token and a batch token. This is the surface the key allowlist cannot see.
 */
const CNPJ_CARRYING_FILE_NAME = `${SYNTHETIC_CNPJ}.csv`;
const CNPJ_CARRYING_PARSER_VERSION = `br-receita-cnpj-${SYNTHETIC_CNPJ}@1`;
const CNPJ_CARRYING_BATCH_ID = `national-${SYNTHETIC_CNPJ}`;

/**
 * The nearest legitimate MISS: a canonical UUID's longest digit run is its twelve-character final
 * group, so it must survive a rule that refuses fourteen.
 */
const LEGITIMATE_UUID_BATCH_ID = '33333333-3333-4333-8333-333333333333';

/** Asserts a value is absent WITHOUT echoing the synthetic identifier into the message. */
const assertKeyAbsent = (
  metadata: Record<string, unknown>,
  key: string,
  carrier: string,
): void => {
  assert.equal(key in metadata, false, `${key} must be omitted when it carries a CNPJ shape`);
  for (const persisted of Object.values(metadata)) {
    assert.equal(
      typeof persisted === 'string' && persisted.includes(SYNTHETIC_CNPJ),
      false,
      `no persisted provenance value may contain the refused identifier (via ${key})`,
    );
    assert.equal(persisted === carrier, false, `the raw carrier must not persist under ${key}`);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PURE — the value shapes, with no database involved.
// ═══════════════════════════════════════════════════════════════════════════
describe('BR-PROVENANCE-PRIVACY — an allowed key may not carry a disallowed value', () => {
  it('🔴 source_file_name accepts a simple filename and REFUSES a path', () => {
    assert.equal(
      brReceitaRunProvenanceForRun({ source_file_name: SIMPLE_FILE_NAME }).source_file_name,
      SIMPLE_FILE_NAME,
    );
    for (const path of [
      LOCAL_ABSOLUTE_PATH,
      WINDOWS_ABSOLUTE_PATH,
      './receita.csv',
      '../receita.csv',
      'downloads/receita.csv',
      'C:receita.csv/..',
      'file:///Users/test/receita.csv',
      '/home/ana/Área de trabalho/receita.csv',
    ]) {
      const built = brReceitaRunProvenanceForRun({ source_file_name: path });
      assert.equal('source_file_name' in built, false, `must not persist: ${path}`);
    }
  });

  it('🔴 a refused filename is OMITTED, not basenamed into a plausible-looking one', () => {
    // The tempting "fix" is `basename(path)` — which would persist `receita.csv` and quietly
    // confirm that a file by that name was the source. Absent is the honest answer.
    const built = brReceitaRunProvenanceForRun({ source_file_name: LOCAL_ABSOLUTE_PATH });
    assert.deepEqual(built, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
    // Neither the path nor a basename of it appears anywhere in what is persisted.
    for (const value of Object.values(built)) {
      assert.equal(value, BR_RECEITA_CNPJ_PARSER_VERSION);
      assert.equal(value.includes(LOCAL_ABSOLUTE_PATH), false);
      assert.equal(value.endsWith('receita.csv'), false);
    }
    assert.equal(BR_RECEITA_COMPACT_STORAGE_CONTRACT.runLevelProvenanceRepairsUnsafeValues, false);
  });

  it('source_downloaded_at keeps a canonical instant and refuses free text', () => {
    for (const instant of ['2026-07-12T09:18:00.000Z', '2026-07-12T09:18:00Z', '2026-07-12T06:18:00-03:00']) {
      assert.equal(
        brReceitaRunProvenanceForRun({ source_downloaded_at: instant }).source_downloaded_at,
        instant,
      );
    }
    for (const invalid of [
      'ayer por la tarde',
      '12/07/2026',
      '2026-07-12',
      '2026-02-30T00:00:00Z', // the right shape, and no such date
      '2026-07-12T09:18:00.000Z downloaded by the operator',
    ]) {
      const built = brReceitaRunProvenanceForRun({ source_downloaded_at: invalid });
      assert.equal('source_downloaded_at' in built, false, `must not persist: ${invalid}`);
    }
  });

  it('parser_version keeps a version token and falls back to the authoritative constant', () => {
    for (const version of [BR_RECEITA_CNPJ_PARSER_VERSION, 'v9', '1.2.3+build']) {
      assert.equal(
        brReceitaRunProvenanceForRun({ parser_version: version }).parser_version,
        version,
      );
    }
    for (const prose of ['the parser Ana ran on her laptop', '', '   ', 'v1 /Users/test']) {
      assert.equal(
        brReceitaRunProvenanceForRun({ parser_version: prose }).parser_version,
        BR_RECEITA_CNPJ_PARSER_VERSION,
        `must not persist: ${prose}`,
      );
    }
  });

  it('import_batch_id keeps both legitimate shapes and refuses prose', () => {
    for (const id of ['national-2026-07', '33333333-3333-4333-8333-333333333333']) {
      assert.equal(brReceitaRunProvenanceForRun({ import_batch_id: id }).import_batch_id, id);
    }
    for (const prose of ['lote de Ana, empresa RAIZ', '/Users/test/lote', 'a'.repeat(200)]) {
      const built = brReceitaRunProvenanceForRun({ import_batch_id: prose });
      assert.equal('import_batch_id' in built, false, 'prose must not persist as a batch id');
    }
  });

  it('🔴 a CNPJ-shaped value does not persist under ANY approved provenance key', () => {
    // Each carrier PASSES its safe-token shape. Only the value rule stops it.
    const built = brReceitaRunProvenanceForRun({
      parser_version: CNPJ_CARRYING_PARSER_VERSION,
      source_file_name: CNPJ_CARRYING_FILE_NAME,
      import_batch_id: CNPJ_CARRYING_BATCH_ID,
    });
    // parser_version is MANDATORY, so it falls back rather than disappearing.
    assert.deepEqual(built, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
    assertKeyAbsent(built, 'source_file_name', CNPJ_CARRYING_FILE_NAME);
    assertKeyAbsent(built, 'import_batch_id', CNPJ_CARRYING_BATCH_ID);
  });

  it('🔴 a bare CNPJ, and one with WRONG check digits, are refused alike', () => {
    // The refusal is by SHAPE. Check-digit validation would have admitted the second one, and
    // this is a privacy boundary: conservative omission beats a checksum that persists a near-miss.
    for (const carrier of [SYNTHETIC_CNPJ, SYNTHETIC_CNPJ_BAD_DV]) {
      const built = brReceitaRunProvenanceForRun({
        source_file_name: carrier,
        import_batch_id: carrier,
        parser_version: carrier,
      });
      assert.deepEqual(built, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
    }
    assert.equal(containsForbiddenCnpjIdentifierShape(SYNTHETIC_CNPJ_BAD_DV), true);
    assert.equal(
      BR_RECEITA_COMPACT_STORAGE_CONTRACT.runLevelProvenanceCnpjRefusalIsCheckDigitIndependent,
      true,
    );
  });

  it('the refusal is a shape rule, not a list of known identifiers', () => {
    assert.equal(containsForbiddenCnpjIdentifierShape(SYNTHETIC_CNPJ), true);
    assert.equal(containsForbiddenCnpjIdentifierShape(CNPJ_CARRYING_PARSER_VERSION), true);
    // Fifteen or more digits is a superset of the shape, not an escape from it.
    assert.equal(containsForbiddenCnpjIdentifierShape(`${SYNTHETIC_CNPJ}7`), true);
    // And the legitimate values stay legitimate.
    for (const safe of [
      BR_RECEITA_CNPJ_PARSER_VERSION,
      SIMPLE_FILE_NAME,
      'national-2026-07',
      LEGITIMATE_UUID_BATCH_ID,
      '2026-07-12T09:18:00.000Z',
    ]) {
      assert.equal(containsForbiddenCnpjIdentifierShape(safe), false, 'must remain persistable');
    }
  });

  it('legitimate provenance is UNCHANGED by the CNPJ rule', () => {
    assert.deepEqual(
      brReceitaRunProvenanceForRun({
        parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
        source_file_name: SIMPLE_FILE_NAME,
        source_downloaded_at: '2026-07-12T09:18:00.000Z',
        import_batch_id: 'national-2026-07',
      }),
      {
        parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
        source_file_name: SIMPLE_FILE_NAME,
        source_downloaded_at: '2026-07-12T09:18:00.000Z',
        import_batch_id: 'national-2026-07',
      },
    );
    // The nearest miss: a UUID batch id runs to twelve digits and must survive.
    assert.equal(
      brReceitaRunProvenanceForRun({ import_batch_id: LEGITIMATE_UUID_BATCH_ID }).import_batch_id,
      LEGITIMATE_UUID_BATCH_ID,
    );
    assert.equal(
      BR_RECEITA_COMPACT_STORAGE_CONTRACT.runLevelProvenanceRefusesCnpjShapedValues,
      true,
    );
  });

  it('a non-string value in an allowed key persists nothing', () => {
    const built = brReceitaRunProvenanceForRun({
      source_file_name: 42,
      source_downloaded_at: new Date('2026-07-12T09:18:00.000Z'),
      import_batch_id: { toString: () => 'national-2026-07' },
    } as never);
    assert.deepEqual(built, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REAL PostgreSQL — the SQL write boundary, reached WITHOUT the planner.
// ═══════════════════════════════════════════════════════════════════════════
describe('BR-PROVENANCE-PRIVACY — the gateway re-narrows at the write boundary', () => {
  let postgres: EmbeddedPostgresLike | null = null;
  let client: PgLikeClient;
  let dataDir = '';

  const realSql = (): BrReceitaSqlExecutor => ({
    query: (statement, params) => client.query(statement, params ? [...params] : undefined),
  });

  /**
   * A `begin_period` operation built BY HAND, exactly as a direct runtime caller would.
   *
   * 🔴 The planner is not involved: this is the bypass the fix exists for. `metadata` is cast, so
   * the compile-time allowlist is out of the picture too and only the gateway is left.
   */
  const beginPeriodDirectly = async (
    sourcePeriod: string,
    metadata: Record<string, unknown>,
  ): Promise<string> => {
    const gateway = createBrReceitaSqlWriteGateway(realSql());
    const operation = {
      kind: 'begin_period',
      table: 'source_snapshot_runs',
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
      source_period: sourcePeriod,
      publish_state: 'preparing',
      metadata,
      returnsRunId: true,
      resolvesRunHandle: true,
      persistsRunProvenance: true,
    } as unknown as BeginPeriodOperation;
    const { snapshotRunId } = await gateway.beginPeriodRun(operation);
    return snapshotRunId;
  };

  const runMetadataOf = async (runId: string): Promise<Record<string, unknown>> => {
    const { rows } = await client.query(
      'SELECT metadata FROM public.source_snapshot_runs WHERE id = $1',
      [runId],
    );
    assert.equal(rows.length, 1);
    return rows[0].metadata as Record<string, unknown>;
  };

  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-br-provenance-privacy-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54941,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await client.connect();
    await bootstrapPlatform(client);
    await applyRealChain(client, repoRoot, BR_RECEITA_COMPACT_CHAIN);
  });

  after(async () => {
    await client?.end().catch(() => {});
    await postgres?.stop().catch(() => {});
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  const maybe = harnessSkip === false ? it : it.skip;

  maybe('🔴 extra runtime keys do NOT survive the SQL boundary', async () => {
    const runId = await beginPeriodDirectly('2026-08', {
      parser_version: 'br-receita-cnpj-boundary@1',
      // Everything a bypassing caller could reach for. jsonb would have taken all of it.
      normalized_tax_id: '11222333000181', // synthetic
      legal_name: 'EMPRESA SINTETICA LTDA',
      raw_row: 'a,b,c',
      local_path: LOCAL_ABSOLUTE_PATH,
    });

    const metadata = await runMetadataOf(runId);
    assert.deepEqual(metadata, { parser_version: 'br-receita-cnpj-boundary@1' });
    for (const forbidden of ['normalized_tax_id', 'legal_name', 'raw_row', 'local_path']) {
      assert.equal(forbidden in metadata, false, `${forbidden} must not reach run metadata`);
    }
    // And no persisted key is outside the four the contract names.
    for (const key of Object.keys(metadata)) {
      assert.equal(
        (BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS as readonly string[]).includes(key),
        true,
        `${key} is not a run-level provenance key`,
      );
    }
  });

  maybe('🔴 a LOCAL absolute path in source_file_name does not persist', async () => {
    const metadata = await runMetadataOf(
      await beginPeriodDirectly('2026-09', { source_file_name: LOCAL_ABSOLUTE_PATH }),
    );
    assert.equal('source_file_name' in metadata, false);
    assert.deepEqual(metadata, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
  });

  maybe('🔴 a WINDOWS absolute path in source_file_name does not persist', async () => {
    const metadata = await runMetadataOf(
      await beginPeriodDirectly('2026-10', { source_file_name: WINDOWS_ABSOLUTE_PATH }),
    );
    assert.equal('source_file_name' in metadata, false);
    assert.deepEqual(metadata, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
  });

  maybe('a SIMPLE filename does persist — the fix withholds paths, not provenance', async () => {
    const metadata = await runMetadataOf(
      await beginPeriodDirectly('2026-11', {
        source_file_name: SIMPLE_FILE_NAME,
        source_downloaded_at: '2026-07-12T09:18:00.000Z',
        import_batch_id: 'national-2026-07',
      }),
    );
    assert.deepEqual(metadata, {
      parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
      source_file_name: SIMPLE_FILE_NAME,
      source_downloaded_at: '2026-07-12T09:18:00.000Z',
      import_batch_id: 'national-2026-07',
    });
  });

  maybe(
    '🔴 a CNPJ in import_batch_id does NOT survive the SQL boundary',
    async () => {
      const metadata = await runMetadataOf(
        await beginPeriodDirectly('2027-01', { import_batch_id: CNPJ_CARRYING_BATCH_ID }),
      );
      assertKeyAbsent(metadata, 'import_batch_id', CNPJ_CARRYING_BATCH_ID);
      assert.deepEqual(metadata, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
    },
  );

  maybe(
    '🔴 a CNPJ in parser_version does NOT survive, and falls back to the constant',
    async () => {
      const metadata = await runMetadataOf(
        await beginPeriodDirectly('2027-02', { parser_version: CNPJ_CARRYING_PARSER_VERSION }),
      );
      // parser_version is mandatory in what is PERSISTED, so the refusal shows up as the
      // authoritative constant rather than as an absent key.
      assert.equal(metadata.parser_version, BR_RECEITA_CNPJ_PARSER_VERSION);
      assert.deepEqual(metadata, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
      for (const persisted of Object.values(metadata)) {
        assert.equal(
          typeof persisted === 'string' && persisted.includes(SYNTHETIC_CNPJ),
          false,
          'the refused identifier must not reach run metadata',
        );
      }
    },
  );

  maybe(
    '🔴 a CNPJ in source_file_name does NOT survive the SQL boundary',
    async () => {
      const metadata = await runMetadataOf(
        await beginPeriodDirectly('2027-03', { source_file_name: CNPJ_CARRYING_FILE_NAME }),
      );
      assertKeyAbsent(metadata, 'source_file_name', CNPJ_CARRYING_FILE_NAME);
      assert.deepEqual(metadata, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
    },
  );

  maybe(
    '🔴 all three carriers at once, cast past the compile-time allowlist',
    async () => {
      const metadata = await runMetadataOf(
        await beginPeriodDirectly('2027-04', {
          parser_version: CNPJ_CARRYING_PARSER_VERSION,
          source_file_name: CNPJ_CARRYING_FILE_NAME,
          import_batch_id: CNPJ_CARRYING_BATCH_ID,
          // A bare one too, under a key the allowlist already refuses.
          normalized_tax_id: SYNTHETIC_CNPJ,
        }),
      );
      assert.deepEqual(metadata, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
      // GATE-4A, read back off the real row: the persisted jsonb holds no CNPJ representation.
      assert.equal(
        JSON.stringify(metadata).includes(SYNTHETIC_CNPJ),
        false,
        'run metadata may not carry any CNPJ representation',
      );
    },
  );

  maybe('LEGITIMATE provenance still survives the same boundary', async () => {
    const metadata = await runMetadataOf(
      await beginPeriodDirectly('2027-05', {
        parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
        source_file_name: SIMPLE_FILE_NAME,
        source_downloaded_at: '2026-07-12T09:18:00.000Z',
        import_batch_id: LEGITIMATE_UUID_BATCH_ID,
      }),
    );
    assert.deepEqual(metadata, {
      parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
      source_file_name: SIMPLE_FILE_NAME,
      source_downloaded_at: '2026-07-12T09:18:00.000Z',
      import_batch_id: LEGITIMATE_UUID_BATCH_ID,
    });
  });

  maybe('the contract claim about the SQL boundary is the behaviour just proved', async () => {
    const c = BR_RECEITA_COMPACT_STORAGE_CONTRACT;
    assert.equal(c.runLevelProvenanceIsRenarrowedAtTheSqlBoundary, true);
    assert.equal(c.runLevelProvenanceValuesAreShapeValidated, true);
    assert.equal(c.runLevelProvenanceAcceptsArbitraryCallerKeys, false);
    assert.equal(c.runLevelProvenanceRefusesCnpjShapedValues, true);
    assert.equal(c.runLevelProvenanceCnpjRefusalIsCheckDigitIndependent, true);
    // GATE-4A's one representation is a column, and it is not this jsonb.
    assert.equal(c.identityRepresentationCount, 1);
    assert.equal(c.identityRepresentationQualifiedColumn, 'br_receita_snapshots.normalized_tax_id');
    // Proved once more through the door itself, with a value of every refused kind at once.
    const metadata = await runMetadataOf(
      await beginPeriodDirectly('2026-12', {
        parser_version: 'a version Ana typed by hand',
        source_file_name: WINDOWS_ABSOLUTE_PATH,
        source_downloaded_at: 'esta manana',
        import_batch_id: 'lote de la oficina',
        legal_name: 'EMPRESA SINTETICA LTDA',
      }),
    );
    assert.deepEqual(metadata, { parser_version: BR_RECEITA_CNPJ_PARSER_VERSION });
  });
});
