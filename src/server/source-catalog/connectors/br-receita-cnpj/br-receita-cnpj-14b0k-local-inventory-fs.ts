/**
 * BR Receita CNPJ — LOCAL INVENTORY METADATA ADAPTER (BR-SOURCE-14B.0K § 7, § 8, § 16).
 *
 * The only file in this milestone that touches a filesystem, and the smallest surface that can answer
 * § 8's five questions: is the entry present, is it a regular file, is it non-zero, is it a symlink,
 * which family does its name classify under.
 *
 * ── Metadata only, enforced by what is imported and what is called ──────────────
 * `readdirSync` and `lstatSync`. That is the entire vocabulary. There is no `open`, no `read`, no
 * `readFile`, no `createReadStream`, no `unzip`, and no `spawn` — so § 16's `REAL_DATA_ROWS_OPENED = 0`
 * and § 7's no-download / no-extract / no-copy / no-move / no-rename / no-delete / no-chmod prohibitions
 * hold because the calls that would violate them are absent, not because a flag is off. A dedicated test
 * reads this file as TEXT and asserts those absences.
 *
 * `lstat`, never `stat`: a symlinked part must be REPORTED as a symlink, and `stat` would silently follow
 * it and report the target as a regular file. Following a link out of the dataset root is exactly the
 * shape of accident this milestone must not have.
 *
 * ── Read-only, and never recursive ──────────────────────────────────────────────
 * One directory, one level. No walking, no globbing, no filesystem-wide search — § 7 is explicit that
 * the dataset location is reused rather than hunted for, and a recursive adapter is how a bounded probe
 * becomes an unbounded one. `$HOME` may contain an accidental `.git`, and nothing here spawns a process,
 * so no git command can run with the dataset as its working directory.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - opens a file, reads a byte, extracts an archive, or resolves a symlink target.
 *   - writes, moves, copies, renames, chmods or deletes anything.
 *   - recurses, globs, or searches outside the single directory it is given.
 *   - returns a path. It returns basenames, sizes and two booleans; the caller's classifier turns those
 *     into family labels and opaque part keys, and paths never reach a report.
 *   - touches Supabase, a migration, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { BrazilReceitaLocalInventoryEntry } from './br-receita-cnpj-14b0k-national-inventory-resolution';

/** The port the resolution's callers depend on. Injectable, so tests need no real directory. */
export interface BrazilReceitaLocalInventoryFileSystem {
  /** Lists ONE directory, one level deep, as metadata. Throws if the path is not an absolute directory. */
  listDirectoryEntries(absoluteDirectory: string): readonly BrazilReceitaLocalInventoryEntry[];
}

export const BRAZIL_RECEITA_LOCAL_INVENTORY_FS_REFUSALS = [
  'directory_path_not_absolute',
  'directory_not_a_directory',
] as const;

export type BrazilReceitaLocalInventoryFsRefusal =
  (typeof BRAZIL_RECEITA_LOCAL_INVENTORY_FS_REFUSALS)[number];

/** Carries a fixed refusal code and never the offending path. */
export class BrazilReceitaLocalInventoryFsError extends Error {
  constructor(public readonly code: BrazilReceitaLocalInventoryFsRefusal) {
    super(code);
    this.name = 'BrazilReceitaLocalInventoryFsError';
  }
}

/**
 * The real adapter.
 *
 * A relative path is refused rather than resolved against `process.cwd()`: an operator's dataset lives
 * outside the repository, and a probe that quietly resolved a relative path would list the wrong
 * directory and report its absence as a missing national inventory.
 */
export function createBrazilReceitaLocalInventoryFileSystem(): BrazilReceitaLocalInventoryFileSystem {
  return {
    listDirectoryEntries(absoluteDirectory: string): readonly BrazilReceitaLocalInventoryEntry[] {
      if (typeof absoluteDirectory !== 'string' || !path.isAbsolute(absoluteDirectory)) {
        throw new BrazilReceitaLocalInventoryFsError('directory_path_not_absolute');
      }
      const rootStat = fs.lstatSync(absoluteDirectory);
      if (!rootStat.isDirectory()) {
        throw new BrazilReceitaLocalInventoryFsError('directory_not_a_directory');
      }
      return fs
        .readdirSync(absoluteDirectory)
        .sort()
        .map((name) => {
          const entryStat = fs.lstatSync(path.join(absoluteDirectory, name));
          return {
            name,
            isRegularFile: entryStat.isFile(),
            isSymbolicLink: entryStat.isSymbolicLink(),
            sizeBytes: entryStat.size,
          };
        });
    },
  };
}
