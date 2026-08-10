/**
 * BR Receita CNPJ — SYNTHETIC FIXTURES for the streaming full-join engine (BR-SOURCE-14B.0D § 6.3).
 *
 * Real files on a real disk, in the OFFICIAL headerless semicolon-delimited layout, containing
 * entirely invented content. The engine under test performs real `open`/`read`/`close` against these,
 * because a streaming reader tested against an in-memory string is not a tested streaming reader:
 * chunk boundaries, carry-over, CRLF and a missing final newline are all properties of bytes on disk.
 *
 * ── Why the join keys are opaque markers rather than CNPJ-shaped digits ─────────
 * A `SYN_K0001` marker cannot be mistaken for a real identifier by a reader, a grep, a log or a
 * future author, and it keeps this source file free of any digit run that resembles a CNPJ básico —
 * which matters because the output sanitizer treats an eight-digit run as an identifier by default,
 * and a fixture file full of them would train everyone to ignore that rule. It follows the
 * established precedent in `br-receita-cnpj-synthetic-temp-manifest`, whose synthetic company
 * references are opaque markers in exactly this position.
 *
 * The layout is NOT invented: rows carry the official positional width for their family (7 for
 * Empresas, 30 for Estabelecimentos, from `BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS`), the
 * official `;` delimiter, no header row, and the join column at position 0 in both families.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - writes outside a fresh directory it created under the OS temp root, and removes only such a
 *     directory (own parent, own prefix, no force flag, no recursion into unknown entries).
 *   - contains, derives or emits a real CNPJ, CPF, company name, email, phone or address.
 *   - touches the real manifest, the real dataset, Supabase, the runtime, Agent 1 or a provider.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getBrReceitaCnpjOfficialColumnCount } from './br-receita-cnpj-file-reader';
import {
  brazilReceitaFullJoinPartitionOrdinalFor,
  type BrazilReceitaFullJoinSourceFileDescriptor,
} from './br-receita-cnpj-full-join-engine-contract';
import type { BrazilReceitaFullJoinPartitionedFamily } from './br-receita-cnpj-full-join-partition-workspace';

// ─── Constants ────────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_FIXTURE_DIRECTORY_PREFIX = 'brfj-fixture-' as const;
export const BRAZIL_RECEITA_FULL_JOIN_FIXTURE_WORKSPACE_PREFIX = 'brfj-parent-' as const;

/** The official delimiter. Stated here too so a fixture can never drift from the reader. */
const DELIMITER = ';';

/** Opaque filler for every column that is not the join column. */
const PAD_CELL = 'SYN_PAD';

/** The opaque join-key prefix. Never a digit run, never a real identifier shape. */
const KEY_PREFIX = 'SYN_K';

export type BrazilReceitaFullJoinFixtureLineEnding = 'lf' | 'crlf';

export interface BrazilReceitaFullJoinFixtureRow {
  /** The join key exactly as it will be written. `''` produces an invalid-key row. */
  readonly key: string;
  /**
   * Columns to write. Defaults to the official width for the family; a different value produces a
   * MALFORMED row, which is exactly what the malformed-row test needs.
   */
  readonly columnCount?: number;
  /** Widens the filler so a row exceeds the chunk size and must be carried across a boundary. */
  readonly padWidth?: number;
}

export interface BrazilReceitaFullJoinFixtureFile {
  readonly family: BrazilReceitaFullJoinPartitionedFamily;
  readonly rows: readonly BrazilReceitaFullJoinFixtureRow[];
  readonly lineEnding?: BrazilReceitaFullJoinFixtureLineEnding;
  /** When `false`, the last row is written WITHOUT a terminator. Defaults to `true`. */
  readonly trailingNewline?: boolean;
  readonly encoding?: 'latin1' | 'utf8';
}

export interface BrazilReceitaFullJoinFixtureScenario {
  readonly files: readonly BrazilReceitaFullJoinFixtureFile[];
}

/** A synthetic key that is guaranteed opaque and stable. */
export function brazilReceitaFullJoinSyntheticKey(index: number): string {
  return `${KEY_PREFIX}${String(index).padStart(4, '0')}`;
}

/**
 * Finds `count` synthetic keys that all land in the SAME partition under `partitionCount`.
 *
 * Used to build the "all keys in one partition" and adversarial-distribution fixtures without
 * hard-coding anything about the hash function: the fixture asks the real partitioner where a key
 * goes, so it stays correct if the partitioner ever changes.
 */
export function brazilReceitaFullJoinSyntheticKeysInOnePartition(
  count: number,
  partitionCount: number,
  targetOrdinal = 0,
): readonly string[] {
  const keys: string[] = [];
  for (let index = 1; keys.length < count && index < 100_000; index += 1) {
    const key = brazilReceitaFullJoinSyntheticKey(index);
    if (brazilReceitaFullJoinPartitionOrdinalFor(key, partitionCount) === targetOrdinal) {
      keys.push(key);
    }
  }
  return keys;
}

// ─── Row rendering ────────────────────────────────────────────────────────────

function renderRow(
  family: BrazilReceitaFullJoinPartitionedFamily,
  row: BrazilReceitaFullJoinFixtureRow,
): string {
  const width = row.columnCount ?? getBrReceitaCnpjOfficialColumnCount(family);
  const filler = row.padWidth === undefined ? PAD_CELL : PAD_CELL.padEnd(row.padWidth, 'X');
  const cells: string[] = [row.key];
  while (cells.length < width) cells.push(filler);
  return cells.slice(0, Math.max(1, width)).join(DELIMITER);
}

function renderFile(file: BrazilReceitaFullJoinFixtureFile): string {
  const terminator = file.lineEnding === 'crlf' ? '\r\n' : '\n';
  const lines = file.rows.map((row) => renderRow(file.family, row));
  if (lines.length === 0) return '';
  const body = lines.join(terminator);
  return file.trailingNewline === false ? body : `${body}${terminator}`;
}

// ─── Handle ───────────────────────────────────────────────────────────────────

export interface BrazilReceitaFullJoinFixtureHandle {
  /** The synthetic dataset root. Passed to the engine as `datasetRoot`, never as a workspace parent. */
  readonly datasetRoot: string;
  /** A SEPARATE temp directory the engine may create its reference workspace inside. */
  readonly workspaceParentDirectory: string;
  readonly sources: readonly BrazilReceitaFullJoinSourceFileDescriptor[];
  /** Removes both directories this handle created. Idempotent, and confined to its own prefixes. */
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

/** Removes one of this module's own temp directories. Refuses anything else, with no force flag. */
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
 * Writes a scenario to disk and returns resolved source descriptors.
 *
 * The descriptors are what the engine consumes: § 1 forbids opening the real manifest, so the engine
 * takes already-resolved files and never learns that a manifest concept exists. The dataset root and
 * the workspace parent are DIFFERENT directories on purpose — the workspace-boundary rules refuse a
 * workspace inside the dataset, and a fixture that put them in one place could not exercise that.
 */
export function createBrazilReceitaFullJoinFixture(
  scenario: BrazilReceitaFullJoinFixtureScenario,
): BrazilReceitaFullJoinFixtureHandle {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const datasetRoot = fs.mkdtempSync(
    path.join(temporaryRoot, BRAZIL_RECEITA_FULL_JOIN_FIXTURE_DIRECTORY_PREFIX),
  );
  const workspaceParentDirectory = fs.mkdtempSync(
    path.join(temporaryRoot, BRAZIL_RECEITA_FULL_JOIN_FIXTURE_WORKSPACE_PREFIX),
  );

  const sources: BrazilReceitaFullJoinSourceFileDescriptor[] = [];
  scenario.files.forEach((file, index) => {
    const encoding = file.encoding ?? 'utf8';
    const fileName = `synthetic-${file.family}-${String(index).padStart(3, '0')}.csv`;
    const filePath = path.join(datasetRoot, fileName);
    fs.writeFileSync(filePath, Buffer.from(renderFile(file), encoding));
    sources.push({
      filePath,
      family: file.family,
      sourceFileOrdinal: index,
      encoding,
    });
  });

  return {
    datasetRoot,
    workspaceParentDirectory,
    sources,
    dispose() {
      removeOwnTemporaryDirectory(datasetRoot, BRAZIL_RECEITA_FULL_JOIN_FIXTURE_DIRECTORY_PREFIX);
      removeOwnTemporaryDirectory(
        workspaceParentDirectory,
        BRAZIL_RECEITA_FULL_JOIN_FIXTURE_WORKSPACE_PREFIX,
      );
    },
  };
}

// ─── Independent oracle ───────────────────────────────────────────────────────

export interface BrazilReceitaFullJoinSyntheticOracle {
  readonly expectedMatches: number;
  readonly expectedOrphanEstablishments: number;
  readonly expectedCompaniesWithoutEstablishment: number;
  readonly expectedInvalidKeys: number;
  readonly expectedMalformedRows: number;
  readonly expectedDuplicateCompanyKeys: number;
  readonly expectedCompanyRows: number;
  readonly expectedEstablishmentRows: number;
}

/**
 * Computes the join's expected result by brute force, from the SCENARIO rather than from the engine.
 *
 * Deliberately naive and deliberately not streaming: it builds two plain arrays and compares every
 * pair. That is what makes it an independent oracle — it shares no code with the partitioner, the
 * reader, the workspace or the join, so an agreement between the two is evidence rather than a
 * tautology.
 */
export function computeBrazilReceitaFullJoinSyntheticOracle(
  scenario: BrazilReceitaFullJoinFixtureScenario,
): BrazilReceitaFullJoinSyntheticOracle {
  const companyKeys: string[] = [];
  const establishmentKeys: string[] = [];
  let invalidKeys = 0;
  let malformedRows = 0;
  let companyRows = 0;
  let establishmentRows = 0;

  for (const file of scenario.files) {
    const officialWidth = getBrReceitaCnpjOfficialColumnCount(file.family);
    for (const row of file.rows) {
      if (file.family === 'empresas') companyRows += 1;
      else establishmentRows += 1;
      const width = row.columnCount ?? officialWidth;
      if (width !== officialWidth) {
        malformedRows += 1;
        continue;
      }
      const key = row.key.trim();
      if (key.length === 0) {
        invalidKeys += 1;
        continue;
      }
      if (file.family === 'empresas') companyKeys.push(key);
      else establishmentKeys.push(key);
    }
  }

  const distinctCompanyKeys = new Set(companyKeys);
  const duplicateCompanyKeys = companyKeys.length - distinctCompanyKeys.size;

  let matches = 0;
  let orphans = 0;
  const matchedCompanyKeys = new Set<string>();
  for (const establishmentKey of establishmentKeys) {
    const pairings = companyKeys.filter((companyKey) => companyKey === establishmentKey).length;
    if (pairings === 0) {
      orphans += 1;
      continue;
    }
    matches += pairings;
    matchedCompanyKeys.add(establishmentKey);
  }

  return {
    expectedMatches: matches,
    expectedOrphanEstablishments: orphans,
    expectedCompaniesWithoutEstablishment: distinctCompanyKeys.size - matchedCompanyKeys.size,
    expectedInvalidKeys: invalidKeys,
    expectedMalformedRows: malformedRows,
    expectedDuplicateCompanyKeys: duplicateCompanyKeys,
    expectedCompanyRows: companyRows,
    expectedEstablishmentRows: establishmentRows,
  };
}
