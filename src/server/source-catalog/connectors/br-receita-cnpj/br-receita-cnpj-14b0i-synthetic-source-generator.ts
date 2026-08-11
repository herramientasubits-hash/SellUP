/**
 * BR Receita CNPJ — SYNTHETIC SOURCE GENERATOR for the 14B.0I throughput qualification
 * (BR-SOURCE-14B.0I § 6, § 7, § 13).
 *
 * Writes Empresas-like and Estabelecimentos-like files to disk in the OFFICIAL headerless
 * semicolon-delimited layout — official column counts (7 / 30, from
 * `BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS`), the official `;` delimiter, no header row,
 * the join column at position 0 in both families — with contents that are entirely invented.
 *
 * This is the SAME layout `br-receita-cnpj-full-join-engine-fixtures` writes for the engine's own
 * correctness suite. What this module adds is SCALE (streamed to disk in batches instead of one
 * in-memory string, so a multi-million-row fixture never materializes as a single JS string) and
 * explicit JOIN SEMANTICS a caller can dial: how many companies have zero / one / many
 * establishments, how many establishments are orphans, and whether the matched keys land in one
 * partition (skewed) or spread out (uniform).
 *
 * ── Why the keys are opaque, disjoint-prefixed markers ──────────────────────────
 * `SYN_MATCH_00000001`, `SYN_ORPHCO_00000001`, `SYN_ORPHEST_00000001`: never a digit-run shaped
 * like a CNPJ, and the three prefixes are disjoint so no accidental string-equality match can occur
 * between a company namespace and an establishment namespace. This follows the precedent in
 * `br-receita-cnpj-full-join-engine-fixtures` (`SYN_K####`) and in
 * `br-receita-cnpj-synthetic-temp-manifest`.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - contains, derives or emits a real CNPJ, CPF, company name, email, phone or address.
 *   - uses `Math.random()`, `Date.now()` or any other non-deterministic input: every row is a pure
 *     function of its index, so the same plan always produces byte-identical files.
 *   - writes outside a fresh directory it created under the OS temp root, and removes only such a
 *     directory (own parent, own prefix, no force flag, no recursion into unknown entries) — the
 *     same discipline as `br-receita-cnpj-full-join-engine-fixtures`.
 *   - touches the real manifest, the real dataset, Supabase, the runtime, Agent 1 or a provider.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getBrReceitaCnpjOfficialColumnCount } from './br-receita-cnpj-file-reader';
import { brazilReceitaFullJoinSyntheticKeysInOnePartition } from './br-receita-cnpj-full-join-engine-fixtures';
import type { BrazilReceitaFullJoinSourceFileDescriptor } from './br-receita-cnpj-full-join-engine-contract';
import type { BrazilReceitaFullJoinPartitionedFamily } from './br-receita-cnpj-full-join-partition-workspace';

// ─── Version & profiles ───────────────────────────────────────────────────────

export const BRAZIL_RECEITA_14B0I_SYNTHETIC_GENERATOR_VERSION = 1 as const;

export const BRAZIL_RECEITA_14B0I_SYNTHETIC_PROFILES = ['narrow', 'typical', 'wide'] as const;

export type BrazilReceita14B0ISyntheticProfile =
  (typeof BRAZIL_RECEITA_14B0I_SYNTHETIC_PROFILES)[number];

/**
 * Target row width in bytes, per profile. `typical` approximates the ~79 bytes/row historically
 * observed for Estabelecimentos WITHOUT using any real content — it is a filler-width target, not a
 * measurement of anything real. `narrow` uses no filler at all; `wide` is a deliberately
 * conservative (large) row to stress buffers harder.
 */
export const BRAZIL_RECEITA_14B0I_SYNTHETIC_TARGET_ROW_BYTES: Readonly<
  Record<BrazilReceita14B0ISyntheticProfile, number>
> = {
  narrow: 24,
  typical: 90,
  wide: 320,
};

const DELIMITER = ';';
const LINE_ENDING = '\n';

/** Rows are written in batches so a multi-million-row file never builds one giant JS string. */
const GENERATOR_WRITE_BATCH_ROWS = 10_000 as const;

// ─── Key namespaces ───────────────────────────────────────────────────────────

/** Disjoint prefixes. No index under one prefix can ever equal a string under another. */
const KEY_PREFIX = {
  matched: 'SYN_MATCH_',
  orphanCompany: 'SYN_ORPHCO_',
  orphanEstablishment: 'SYN_ORPHEST_',
  invalidPad: 'SYN_INV_',
} as const;

const KEY_DIGITS = 9;

function syntheticKeyId(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(KEY_DIGITS, '0')}`;
}

// ─── Row rendering ────────────────────────────────────────────────────────────

/**
 * Computes how wide a filler cell must be for a row (given its official column count and key
 * length) to land at or near `targetRowBytes`. Never below 1 character: a zero-width filler cell
 * next to a delimiter is indistinguishable from a missing column in this module's own accounting,
 * even though the reader itself tolerates it.
 */
function fillerCellWidth(targetRowBytes: number, columnCount: number, keyLength: number): number {
  const fillerColumns = Math.max(1, columnCount - 1);
  const delimiterBytes = columnCount - 1;
  const remaining = targetRowBytes - keyLength - delimiterBytes;
  return Math.max(1, Math.round(remaining / fillerColumns));
}

function renderRow(
  family: BrazilReceita14B0ISyntheticFamily,
  key: string,
  columnCount: number,
  fillerWidth: number,
): string {
  const filler = 'X'.repeat(fillerWidth);
  const cells: string[] = [key];
  while (cells.length < columnCount) cells.push(filler);
  return cells.slice(0, Math.max(1, columnCount)).join(DELIMITER);
}

export type BrazilReceita14B0ISyntheticFamily = BrazilReceitaFullJoinPartitionedFamily;

// ─── Plan ─────────────────────────────────────────────────────────────────────

export type BrazilReceita14B0ISyntheticDistribution = 'uniform' | 'skewed_single_partition';

/**
 * The join-semantics knobs. Every count is EXPLICIT — there is no default that invents a scenario a
 * caller did not ask for.
 */
export interface BrazilReceita14B0ISyntheticScenarioPlan {
  readonly profile: BrazilReceita14B0ISyntheticProfile;
  /** Companies with exactly `establishmentsPerMatchedCompany` establishments. */
  readonly matchedCompanyCount: number;
  /** How many establishment rows each matched company gets. `1` is the typical case; `>1` is multi. */
  readonly establishmentsPerMatchedCompany: number;
  /** Companies with NO establishment row anywhere. */
  readonly companiesWithoutEstablishmentCount: number;
  /** Establishment rows whose key matches no company. */
  readonly orphanEstablishmentCount: number;
  /** Company rows with an empty (invalid) join key. */
  readonly invalidKeyCompanyRows: number;
  /** Establishment rows with an empty (invalid) join key. */
  readonly invalidKeyEstablishmentRows: number;
  /** Company rows with the WRONG column count (malformed). */
  readonly malformedCompanyRows: number;
  /** Establishment rows with the WRONG column count (malformed). */
  readonly malformedEstablishmentRows: number;
  readonly distribution: BrazilReceita14B0ISyntheticDistribution;
  /**
   * Required only when `distribution === 'skewed_single_partition'`: every matched company key is
   * chosen (via the engine's own partitioner, reusing
   * `brazilReceitaFullJoinSyntheticKeysInOnePartition`) to land in partition 0 of this partition
   * count, concentrating the whole matched population into one partition.
   */
  readonly skewPartitionCount?: number;
}

export interface BrazilReceita14B0ISyntheticOracle {
  readonly expectedMatches: number;
  readonly expectedOrphanEstablishments: number;
  readonly expectedCompaniesWithoutEstablishment: number;
  readonly expectedInvalidKeyCount: number;
  readonly expectedMalformedRowCount: number;
  readonly expectedCompanyRows: number;
  readonly expectedEstablishmentRows: number;
}

/** Computes the oracle DIRECTLY from the plan — this generator constructs the data, so it is exact. */
export function computeBrazilReceita14B0ISyntheticOracle(
  plan: BrazilReceita14B0ISyntheticScenarioPlan,
): BrazilReceita14B0ISyntheticOracle {
  const expectedMatches = plan.matchedCompanyCount * plan.establishmentsPerMatchedCompany;
  return {
    expectedMatches,
    expectedOrphanEstablishments: plan.orphanEstablishmentCount,
    expectedCompaniesWithoutEstablishment: plan.companiesWithoutEstablishmentCount,
    expectedInvalidKeyCount: plan.invalidKeyCompanyRows + plan.invalidKeyEstablishmentRows,
    expectedMalformedRowCount: plan.malformedCompanyRows + plan.malformedEstablishmentRows,
    expectedCompanyRows:
      plan.matchedCompanyCount +
      plan.companiesWithoutEstablishmentCount +
      plan.invalidKeyCompanyRows +
      plan.malformedCompanyRows,
    expectedEstablishmentRows:
      expectedMatches +
      plan.orphanEstablishmentCount +
      plan.invalidKeyEstablishmentRows +
      plan.malformedEstablishmentRows,
  };
}

// ─── Streaming write ──────────────────────────────────────────────────────────

function writeAsync(stream: fs.WriteStream, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = stream.write(chunk, (error) => {
      if (error) reject(error);
    });
    if (ok) {
      resolve();
      return;
    }
    stream.once('drain', () => resolve());
  });
}

function endAsync(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * A row generator handed to `streamFamilyFile`: yields a `[key, columnCount]` pair for each row of
 * a family's file, in write order. A generator function rather than a materialized array, so the
 * plan's total row count can run into the millions without ever holding all of them at once.
 */
type RowSource = Generator<readonly [key: string, columnCount: number], void, void>;

async function streamFamilyFile(
  filePath: string,
  family: BrazilReceita14B0ISyntheticFamily,
  fillerWidth: number,
  rows: RowSource,
): Promise<{ readonly rowsWritten: number }> {
  const officialColumnCount = getBrReceitaCnpjOfficialColumnCount(family);
  const stream = fs.createWriteStream(filePath, { flags: 'wx' });
  let rowsWritten = 0;
  let batch = '';
  let inBatch = 0;

  try {
    for (const [key, columnCount] of rows) {
      batch += renderRow(family, key, columnCount, fillerWidth) + LINE_ENDING;
      rowsWritten += 1;
      inBatch += 1;
      if (inBatch >= GENERATOR_WRITE_BATCH_ROWS) {
        await writeAsync(stream, batch);
        batch = '';
        inBatch = 0;
      }
    }
    if (batch.length > 0) await writeAsync(stream, batch);
  } finally {
    await endAsync(stream);
  }

  // The official column count is used for every VALID row; malformed rows declare their own count
  // via the generator itself (see `*rowSourceFor`), so this is only a sanity anchor for callers.
  void officialColumnCount;
  return { rowsWritten };
}

// ─── Row sources, one per family ──────────────────────────────────────────────

function matchedCompanyKeys(plan: BrazilReceita14B0ISyntheticScenarioPlan): readonly string[] {
  if (plan.distribution === 'uniform') {
    return Array.from({ length: plan.matchedCompanyCount }, (_unused, index) =>
      syntheticKeyId(KEY_PREFIX.matched, index),
    );
  }
  const partitionCount = plan.skewPartitionCount;
  if (partitionCount === undefined) {
    throw new Error('skewed_single_partition distribution requires skewPartitionCount');
  }
  // Reuses the engine's OWN partitioner via the established fixture helper, rather than
  // reimplementing partition arithmetic here: the skew is real to the engine under test, not
  // asserted by this module's own guess at where a key lands.
  return brazilReceitaFullJoinSyntheticKeysInOnePartition(plan.matchedCompanyCount, partitionCount, 0);
}

function* companyRowSource(
  plan: BrazilReceita14B0ISyntheticScenarioPlan,
  matchedKeys: readonly string[],
): RowSource {
  const officialColumns = getBrReceitaCnpjOfficialColumnCount('empresas');
  for (let index = 0; index < plan.companiesWithoutEstablishmentCount; index += 1) {
    yield [syntheticKeyId(KEY_PREFIX.orphanCompany, index), officialColumns];
  }
  for (const key of matchedKeys) {
    yield [key, officialColumns];
  }
  for (let index = 0; index < plan.invalidKeyCompanyRows; index += 1) {
    yield ['', officialColumns];
  }
  for (let index = 0; index < plan.malformedCompanyRows; index += 1) {
    yield [syntheticKeyId(KEY_PREFIX.invalidPad, index), officialColumns + 1];
  }
}

function* establishmentRowSource(
  plan: BrazilReceita14B0ISyntheticScenarioPlan,
  matchedKeys: readonly string[],
): RowSource {
  const officialColumns = getBrReceitaCnpjOfficialColumnCount('estabelecimentos');
  for (const key of matchedKeys) {
    for (let copy = 0; copy < plan.establishmentsPerMatchedCompany; copy += 1) {
      yield [key, officialColumns];
    }
  }
  for (let index = 0; index < plan.orphanEstablishmentCount; index += 1) {
    yield [syntheticKeyId(KEY_PREFIX.orphanEstablishment, index), officialColumns];
  }
  for (let index = 0; index < plan.invalidKeyEstablishmentRows; index += 1) {
    yield ['', officialColumns];
  }
  for (let index = 0; index < plan.malformedEstablishmentRows; index += 1) {
    yield [syntheticKeyId(KEY_PREFIX.invalidPad, index), officialColumns + 1];
  }
}

// ─── Handle ───────────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_14B0I_FIXTURE_DIRECTORY_PREFIX = 'brfj-14b0i-fixture-' as const;
export const BRAZIL_RECEITA_14B0I_FIXTURE_WORKSPACE_PREFIX = 'brfj-14b0i-parent-' as const;

export interface BrazilReceita14B0ISyntheticFixtureHandle {
  readonly datasetRoot: string;
  readonly workspaceParentDirectory: string;
  readonly sources: readonly BrazilReceitaFullJoinSourceFileDescriptor[];
  readonly oracle: BrazilReceita14B0ISyntheticOracle;
  /** Exact on-disk byte size per source file, in `sources` order. Ground truth for byte counters. */
  readonly fileSizesBytes: readonly number[];
  readonly totalSourceBytes: number;
  readonly totalRows: number;
  dispose(): void;
}

/** True only for a directory this module could have created: directly under the OS temp root. */
function isOwnTemporaryDirectory(candidate: string, prefix: string): boolean {
  const resolved = path.resolve(candidate);
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const parent = path.dirname(resolved);
  const resolvedParent = fs.existsSync(parent) ? fs.realpathSync(parent) : parent;
  if (resolvedParent !== temporaryRoot) return false;
  return path.basename(resolved).startsWith(prefix);
}

function removeOwnTemporaryDirectory(directory: string, prefix: string): void {
  if (!isOwnTemporaryDirectory(directory, prefix)) {
    throw new Error('refusing to remove a directory this fixture module did not create');
  }
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    const entry = path.join(directory, name);
    if (fs.lstatSync(entry).isDirectory()) removeOwnTemporaryDirectory(entry, path.basename(entry));
    else fs.unlinkSync(entry);
  }
  fs.rmdirSync(directory);
}

/**
 * Generates the two-file scenario on disk and returns resolved source descriptors, an exact oracle,
 * and the exact on-disk byte size of every file — the ground truth the throughput harness compares
 * its own metered byte counters against.
 */
export async function createBrazilReceita14B0ISyntheticFixture(
  plan: BrazilReceita14B0ISyntheticScenarioPlan,
): Promise<BrazilReceita14B0ISyntheticFixtureHandle> {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const datasetRoot = fs.mkdtempSync(
    path.join(temporaryRoot, BRAZIL_RECEITA_14B0I_FIXTURE_DIRECTORY_PREFIX),
  );
  const workspaceParentDirectory = fs.mkdtempSync(
    path.join(temporaryRoot, BRAZIL_RECEITA_14B0I_FIXTURE_WORKSPACE_PREFIX),
  );

  const matchedKeys = matchedCompanyKeys(plan);
  const targetRowBytes = BRAZIL_RECEITA_14B0I_SYNTHETIC_TARGET_ROW_BYTES[plan.profile];

  const empresasColumns = getBrReceitaCnpjOfficialColumnCount('empresas');
  const estabColumns = getBrReceitaCnpjOfficialColumnCount('estabelecimentos');
  // Filler width is sized off the OFFICIAL column count and a representative key length — every key
  // namespace pads to the same `KEY_DIGITS`, so one width choice fits every row in the family.
  const representativeKeyLength = KEY_PREFIX.matched.length + KEY_DIGITS;
  const empresasFillerWidth = fillerCellWidth(targetRowBytes, empresasColumns, representativeKeyLength);
  const estabFillerWidth = fillerCellWidth(targetRowBytes, estabColumns, representativeKeyLength);

  const empresasPath = path.join(datasetRoot, 'synthetic-empresas-000.csv');
  const estabPath = path.join(datasetRoot, 'synthetic-estabelecimentos-000.csv');

  const [empresasResult, estabResult] = await Promise.all([
    streamFamilyFile(empresasPath, 'empresas', empresasFillerWidth, companyRowSource(plan, matchedKeys)),
    streamFamilyFile(
      estabPath,
      'estabelecimentos',
      estabFillerWidth,
      establishmentRowSource(plan, matchedKeys),
    ),
  ]);

  const sources: BrazilReceitaFullJoinSourceFileDescriptor[] = [
    { filePath: empresasPath, family: 'empresas', sourceFileOrdinal: 0, encoding: 'utf8' },
    { filePath: estabPath, family: 'estabelecimentos', sourceFileOrdinal: 1, encoding: 'utf8' },
  ];

  const fileSizesBytes = sources.map((source) => fs.statSync(source.filePath).size);
  const totalSourceBytes = fileSizesBytes.reduce((sum, size) => sum + size, 0);
  const oracle = computeBrazilReceita14B0ISyntheticOracle(plan);

  return {
    datasetRoot,
    workspaceParentDirectory,
    sources,
    oracle,
    fileSizesBytes,
    totalSourceBytes,
    totalRows: empresasResult.rowsWritten + estabResult.rowsWritten,
    dispose() {
      removeOwnTemporaryDirectory(datasetRoot, BRAZIL_RECEITA_14B0I_FIXTURE_DIRECTORY_PREFIX);
      removeOwnTemporaryDirectory(
        workspaceParentDirectory,
        BRAZIL_RECEITA_14B0I_FIXTURE_WORKSPACE_PREFIX,
      );
    },
  };
}
