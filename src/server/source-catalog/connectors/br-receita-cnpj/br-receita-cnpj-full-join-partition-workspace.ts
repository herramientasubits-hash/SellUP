/**
 * BR Receita CNPJ — BOUNDED TEMPORARY PARTITION WORKSPACE (BR-SOURCE-14B.0D § 6, § 7).
 *
 * An external hash-partitioned join needs somewhere to put the partition it is not currently
 * joining. This module is that somewhere, and it is built on one premise: the fact that the engine
 * NEEDS temporary storage does not mean the engine may CREATE temporary storage. GATE-2 is not
 * approved, `BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED` is `false`, and a real run
 * therefore still refuses. What this module delivers is the mechanism, fully built and fully tested
 * against synthetic data, so the eventual owner decision is a decision about a real thing.
 *
 * ── What a partition file may contain ───────────────────────────────────────────
 * A FIXED-WIDTH BINARY RECORD of four technical integers: source file ordinal, byte offset, byte
 * length, family code. Nothing else can be in it, and that is a structural claim rather than a
 * promise — the writer accepts a `BrazilReceitaFullJoinRowReference`, encodes exactly sixteen bytes
 * from four numbers, and has no code path that can serialize a string. There is no field for a CNPJ,
 * a razão social, a raw row, a join key or a hash of one, because there is no string field at all.
 *
 * Binary rather than text for the same reason: a text format invites "just add the key for
 * debugging", and a caller who wants to add one to this format has to change the record width, the
 * codec and its tests. The friction is the feature.
 *
 * ── Where a workspace may live ──────────────────────────────────────────────────
 * Outside the repository, outside `$HOME` (which is itself a git repository in this operator's
 * environment), outside the dataset root, reached through no symlink, and named with a technical
 * name this module chose. The parent directory is VALIDATED, not trusted, and the checks are
 * path-only plus one `realpath`: a symlinked parent resolves to its target and is compared again, so
 * a link planted between validation and creation cannot redirect the workspace into the dataset.
 *
 * ── Descriptors are POOLED, not hoarded (BR-SOURCE-14B.0F § 3) ──────────────────
 * The first version of this module kept one append handle per partition file for the whole reference
 * pass. At `partitionCount = 1024` across two families that is roughly 4096 descriptors — a number
 * set by a PARTITIONING parameter rather than by a resource cap, and invisible to 14B.0C's
 * `maxFilesOpened`, which counts cumulative SOURCE opens. Correctness therefore depended on the
 * operator having raised `ulimit -n`, which is not a correctness argument.
 *
 * Handles now come from a bounded LRU pool (`maxOpenPartitionFiles`, proposed 32) whose every
 * reservation also passes through a GLOBAL concurrent ledger (`maxFilesOpened`, proposed 64) shared
 * with source files, the private metric artifact and control artifacts. Eviction is safe because
 * partition files are append-only and every write is one complete fixed-width record: a reopened file
 * continues exactly where the closed handle stopped.
 *
 * ── Free disk is checked, not assumed (BR-SOURCE-14B.0F § 4) ────────────────────
 * `maxTemporaryStorageBytes` bounds what the run may WRITE; it says nothing about whether the volume
 * can accept it. The parent is probed once before the workspace is created, and the workspace is
 * re-probed before each write block, so a filling disk stops the run while the machine is still
 * usable rather than at `ENOSPC`.
 *
 * ── Cleanup is a deletion ENGINE, and it verifies ───────────────────────────────
 * `br-receita-cnpj-full-join-cleanup` is a pure PLANNER that cannot delete a path — it was written
 * when no deletion engine was authorized. This module is that engine, and it is deliberately
 * confined: it removes ONLY a directory it created itself (own parent, own prefix), it removes only
 * files whose names match its own technical pattern, it has no force flag, and it re-checks absence
 * afterwards. An unverifiable deletion is `unverified`, never `completed` — the distinction 14B.0C
 * draws between "cleanup failed" and "nobody can say whether it finished".
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`. Every filesystem effect arrives through the injected port, so the policy
 *     here is testable without a disk and the mechanism lives in one adapter.
 *   - deletes a dataset file, a manifest, a repository path, or anything outside the workspace it
 *     created.
 *   - accepts a path to write or delete. A caller supplies a family and a partition ordinal; this
 *     module derives the name.
 *   - reports a path, a file name, an environment variable, or any dataset value.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

import * as path from 'node:path';

import {
  assertBrazilReceitaFullJoinFreeDiskBeforeStart,
  assertBrazilReceitaFullJoinFreeDiskReserve,
  createBrazilReceitaFullJoinFreeDiskCheckSchedule,
  resolveBrazilReceitaFullJoinFreeDiskThresholds,
  type BrazilReceitaFullJoinFreeDiskProbe,
} from './br-receita-cnpj-full-join-free-disk';
import type { BrazilReceitaFullJoinOpenHandleLedger } from './br-receita-cnpj-full-join-open-handle-ledger';
import {
  createBrazilReceitaFullJoinPartitionHandlePool,
  type BrazilReceitaFullJoinPartitionHandlePoolStats,
} from './br-receita-cnpj-full-join-partition-handle-pool';

// ─── Version & policy ─────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_PARTITION_WORKSPACE_VERSION = 1 as const;

/**
 * GATE-2's standing, as a `false` literal.
 *
 * A real run must consult this and refuse. It is not configuration, not an environment variable and
 * not a parameter: flipping it takes a source edit, a PR and an owner decision, which is exactly the
 * ceremony a temporary-storage authorization deserves.
 */
export const BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED = false as const;

/** The directory prefix. A technical name: no family value, no identifier, no dataset word. */
export const BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_DIRECTORY_PREFIX = 'brfj-refs-' as const;

/** Owner-only directory. No group, no other. Verified after creation, never assumed. */
export const BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_DIRECTORY_MODE = 0o700 as const;

/** Owner-only files, for the same reason and with the same verification. */
export const BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE = 0o600 as const;

/** The fixed-width reference record. Four integers, sixteen bytes, no string field. */
export const BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES = 16 as const;

/** How many references one bounded read pulls back from a partition file. */
export const BRAZIL_RECEITA_FULL_JOIN_REFERENCE_READ_BATCH = 256 as const;

/**
 * The buffered partition writer's bound, per BUFFERED partition (BR-SOURCE-14B.0H).
 *
 * Root-cause profiling of BR-SOURCE-14B.0G's reference throughput (~642 rows/s) found one
 * synchronous `fs.write` syscall per 16-byte reference — a syscall for the smallest possible unit of
 * work this module does. This buffer absorbs that: up to `8_192 / 16 = 512` references accumulate in
 * memory per partition before one write syscall carries all of them at once.
 *
 * NOT one per currently-open handle: an earlier design tied a buffer's lifetime to its handle's, which
 * measured out to ZERO benefit at the proposed profile's partition count — under near-uniform hash
 * routing with 1024+ partitions and only 32 open handles, a handle (and the buffer riding on it) is
 * evicted before accumulating more than one reference. This buffer survives a handle eviction; see
 * `BRAZIL_RECEITA_FULL_JOIN_MAX_BUFFERED_PARTITIONS` for the (much larger, independent) ceiling on how
 * many of these can exist at once — `4_096 * 8_192 = 33_554_432` bytes worst case, half of
 * `maxExternalMemoryBytes` (64 MiB in the proposed profile).
 */
export const BRAZIL_RECEITA_FULL_JOIN_PARTITION_WRITE_BUFFER_BYTES = 8_192 as const;

/**
 * How many partitions may hold a pending write buffer AT ONCE — independent of, and much larger than,
 * `maxOpenPartitionFiles`. Twice the proposed `maxPartitionCount` (2 048): the worst case is one
 * buffer per partition ordinal, per family, ever created in a single run. This is a WORKSPACE-OWNED
 * safety bound: it does not trust a caller's `partitionCount` to stay inside it, the same discipline
 * this module applies to every other cap it enforces on itself.
 */
export const BRAZIL_RECEITA_FULL_JOIN_MAX_BUFFERED_PARTITIONS = 4_096 as const;

/** The only two families this engine partitions. `socios`, `qsa` and `simples` are out of scope. */
export const BRAZIL_RECEITA_FULL_JOIN_PARTITIONED_FAMILIES = ['empresas', 'estabelecimentos'] as const;

export type BrazilReceitaFullJoinPartitionedFamily =
  (typeof BRAZIL_RECEITA_FULL_JOIN_PARTITIONED_FAMILIES)[number];

/** The on-disk family code. A small integer, so a family name never reaches a partition file. */
const FAMILY_CODES: Readonly<Record<BrazilReceitaFullJoinPartitionedFamily, number>> = {
  empresas: 1,
  estabelecimentos: 2,
};

const FAMILY_BY_CODE: Readonly<Record<number, BrazilReceitaFullJoinPartitionedFamily>> = {
  1: 'empresas',
  2: 'estabelecimentos',
};

// ─── Row reference ────────────────────────────────────────────────────────────

/**
 * The ONLY thing a partition file holds: where a row is, and in which file.
 *
 * Every field is a technical integer or a closed family enum. There is no `cnpj`, no `cnpjBasico`,
 * no `razaoSocial`, no `rawRow`, no `joinKey` and no hash of any of them — § 4.2 lists them as
 * forbidden, and the way this contract honours the list is by having nowhere to put one.
 */
export interface BrazilReceitaFullJoinRowReference {
  readonly sourceFileOrdinal: number;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly family: BrazilReceitaFullJoinPartitionedFamily;
}

/** The 48-bit ceiling on a byte offset. Far beyond any Receita file, and it keeps the record fixed. */
const MAX_ENCODABLE_OFFSET = 0xff_ff_ff_ff_ff_ff;
const MAX_ENCODABLE_UINT32 = 0xff_ff_ff_ff;

export type BrazilReceitaFullJoinReferenceCodecFailure =
  | 'ordinal_out_of_range'
  | 'offset_out_of_range'
  | 'length_out_of_range'
  | 'family_unknown'
  | 'record_truncated';

/**
 * Encodes one reference into exactly `BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES` bytes.
 *
 * Layout: ordinal u32 LE | offset u48 LE | length u32 LE | family u8 | reserved u8.
 */
export function encodeBrazilReceitaFullJoinRowReference(
  reference: BrazilReceitaFullJoinRowReference,
):
  | { readonly ok: true; readonly record: Buffer }
  | { readonly ok: false; readonly failure: BrazilReceitaFullJoinReferenceCodecFailure } {
  const { sourceFileOrdinal, byteOffset, byteLength, family } = reference;
  if (!Number.isInteger(sourceFileOrdinal) || sourceFileOrdinal < 0 || sourceFileOrdinal > MAX_ENCODABLE_UINT32) {
    return { ok: false, failure: 'ordinal_out_of_range' };
  }
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > MAX_ENCODABLE_OFFSET) {
    return { ok: false, failure: 'offset_out_of_range' };
  }
  if (!Number.isInteger(byteLength) || byteLength <= 0 || byteLength > MAX_ENCODABLE_UINT32) {
    return { ok: false, failure: 'length_out_of_range' };
  }
  const familyCode = FAMILY_CODES[family];
  if (familyCode === undefined) return { ok: false, failure: 'family_unknown' };

  const record = Buffer.alloc(BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES);
  record.writeUInt32LE(sourceFileOrdinal, 0);
  record.writeUIntLE(byteOffset, 4, 6);
  record.writeUInt32LE(byteLength, 10);
  record.writeUInt8(familyCode, 14);
  return { ok: true, record };
}

export function decodeBrazilReceitaFullJoinRowReference(
  record: Buffer,
  recordOffset: number,
):
  | { readonly ok: true; readonly reference: BrazilReceitaFullJoinRowReference }
  | { readonly ok: false; readonly failure: BrazilReceitaFullJoinReferenceCodecFailure } {
  if (recordOffset + BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES > record.length) {
    return { ok: false, failure: 'record_truncated' };
  }
  const family = FAMILY_BY_CODE[record.readUInt8(recordOffset + 14)];
  if (family === undefined) return { ok: false, failure: 'family_unknown' };
  return {
    ok: true,
    reference: {
      sourceFileOrdinal: record.readUInt32LE(recordOffset),
      byteOffset: record.readUIntLE(recordOffset + 4, 6),
      byteLength: record.readUInt32LE(recordOffset + 10),
      family,
    },
  };
}

// ─── Partition file naming ────────────────────────────────────────────────────

const PARTITION_ORDINAL_DIGITS = 5;

/** `empresas-part-00001.refs`. Technical, sequential, and derived — never caller-supplied. */
export const BRAZIL_RECEITA_FULL_JOIN_PARTITION_FILE_PATTERN =
  /^(?:empresas|estabelecimentos)-part-\d{5}\.refs$/;

export function brazilReceitaFullJoinPartitionFileName(
  family: BrazilReceitaFullJoinPartitionedFamily,
  partitionOrdinal: number,
): string | null {
  if (FAMILY_CODES[family] === undefined) return null;
  if (!Number.isInteger(partitionOrdinal) || partitionOrdinal < 0) return null;
  const padded = String(partitionOrdinal + 1).padStart(PARTITION_ORDINAL_DIGITS, '0');
  if (padded.length !== PARTITION_ORDINAL_DIGITS) return null;
  const name = `${family}-part-${padded}.refs`;
  return BRAZIL_RECEITA_FULL_JOIN_PARTITION_FILE_PATTERN.test(name) ? name : null;
}

// ─── Filesystem port ──────────────────────────────────────────────────────────

/**
 * The filesystem operations a reference workspace needs, injected so policy is testable without a
 * disk and so this module has no `node:fs` import to hide behind.
 *
 * `isSymbolicLink` and `realPath` are separate on purpose: the first answers "is this entry itself a
 * link", the second answers "where does this path actually land". A workspace parent must pass both,
 * because a link one level up is as dangerous as a link at the leaf.
 */
export interface BrazilReceitaFullJoinWorkspaceFileSystem {
  makeTemporaryDirectory(parentDirectory: string, prefix: string): string;
  chmod(targetPath: string, mode: number): void;
  /** `lstat`-based mode: the entry's OWN mode, never a symlink target's. */
  statMode(targetPath: string): number;
  isSymbolicLink(targetPath: string): boolean;
  realPath(targetPath: string): string;
  /** `lstat`-based existence, so a dangling symlink counts as PRESENT. */
  exists(targetPath: string): boolean;
  openForAppend(filePath: string, mode: number): number;
  openForRead(filePath: string): number;
  write(handle: number, data: Buffer): number;
  read(handle: number, buffer: Buffer, bufferOffset: number, length: number, position: number): number;
  close(handle: number): void;
  listNames(directoryPath: string): readonly string[];
  removeFile(filePath: string): void;
  removeDirectory(directoryPath: string): void;
}

// ─── Boundaries & refusals ────────────────────────────────────────────────────

/**
 * The boundaries the workspace must be told about. All explicit: this module reads no environment
 * variable, so it cannot discover `HOME`, the repository root or the dataset root on its own.
 */
export interface BrazilReceitaFullJoinWorkspaceBoundaries {
  readonly repositoryRoot: string;
  readonly homeDirectory: string;
  readonly datasetRoot: string | null;
}

export type BrazilReceitaFullJoinWorkspaceRejection =
  | 'parent_not_absolute'
  | 'parent_inside_repository'
  | 'parent_inside_home'
  | 'parent_inside_dataset'
  | 'parent_is_symlink'
  | 'parent_path_traversal'
  | 'parent_realpath_unavailable'
  | 'parent_realpath_escapes_declared_parent'
  | 'temporary_storage_policy_not_approved'
  | 'storage_cap_invalid'
  | 'handle_caps_invalid'
  | 'free_disk_thresholds_invalid'
  | 'insufficient_free_disk_before_start'
  | 'free_disk_measurement_unavailable';

/** True when `candidate` is `parent` or lives beneath it. Path-only; touches no filesystem. */
function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative === '') return true;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

/**
 * Validates a proposed workspace PARENT directory. Path-only checks first, then the two that need
 * the port; every rejection is reported so an operator fixes one destination rather than five.
 */
export function validateBrazilReceitaFullJoinWorkspaceParent(
  parentDirectory: string,
  boundaries: BrazilReceitaFullJoinWorkspaceBoundaries,
  fileSystem: BrazilReceitaFullJoinWorkspaceFileSystem,
): readonly BrazilReceitaFullJoinWorkspaceRejection[] {
  const rejections: BrazilReceitaFullJoinWorkspaceRejection[] = [];

  if (typeof parentDirectory !== 'string' || !path.isAbsolute(parentDirectory)) {
    // Nothing below can be decided without an absolute path, so this is reported alone.
    return ['parent_not_absolute'];
  }
  // A traversal segment in a declared parent is refused rather than normalized: normalizing it
  // would silently accept a destination the operator did not name.
  if (parentDirectory.split(path.sep).includes('..')) {
    return ['parent_path_traversal'];
  }

  if (isInside(parentDirectory, boundaries.repositoryRoot)) rejections.push('parent_inside_repository');
  else if (isInside(parentDirectory, boundaries.homeDirectory)) rejections.push('parent_inside_home');
  if (boundaries.datasetRoot !== null && isInside(parentDirectory, boundaries.datasetRoot)) {
    rejections.push('parent_inside_dataset');
  }

  let symbolic = false;
  try {
    symbolic = fileSystem.isSymbolicLink(parentDirectory);
  } catch {
    return [...rejections, 'parent_realpath_unavailable'];
  }
  if (symbolic) rejections.push('parent_is_symlink');

  let resolved: string;
  try {
    resolved = fileSystem.realPath(parentDirectory);
  } catch {
    return [...rejections, 'parent_realpath_unavailable'];
  }
  if (path.resolve(resolved) !== path.resolve(parentDirectory)) {
    // The declared parent is not where it lands. Refused even when the target would itself be
    // acceptable: the boundary checks above were run against the declared path, and a path that
    // resolves elsewhere has not been checked at all.
    rejections.push('parent_realpath_escapes_declared_parent');
  }
  // Re-check the resolved destination against every boundary, so a parent that resolves INTO the
  // dataset is caught even if the declared string looked clean.
  if (boundaries.datasetRoot !== null && isInside(resolved, boundaries.datasetRoot)) {
    if (!rejections.includes('parent_inside_dataset')) rejections.push('parent_inside_dataset');
  }
  if (isInside(resolved, boundaries.repositoryRoot) && !rejections.includes('parent_inside_repository')) {
    rejections.push('parent_inside_repository');
  }

  return rejections;
}

// ─── Workspace handle ─────────────────────────────────────────────────────────

export type BrazilReceitaFullJoinWorkspaceFailure =
  | 'workspace_creation_failed'
  | 'workspace_permission_hardening_failed'
  | 'workspace_permission_verification_failed'
  | 'partition_name_invalid'
  | 'reference_encoding_failed'
  | 'temporary_storage_cap_exceeded'
  | 'partition_write_failed'
  | 'partition_open_failed'
  | 'partition_read_failed'
  | 'partition_file_permission_verification_failed'
  | 'partition_record_truncated'
  | 'partition_handle_cap_exceeded'
  | 'free_disk_reserve_breached'
  | 'free_disk_measurement_unavailable';

/** The verified outcome of a deletion. Mirrors 14B.0C's cleanup vocabulary exactly. */
export type BrazilReceitaFullJoinWorkspaceCleanupOutcome =
  | 'not_needed'
  | 'completed'
  | 'failed'
  | 'unverified';

export interface BrazilReceitaFullJoinWorkspaceCleanupResult {
  readonly outcome: BrazilReceitaFullJoinWorkspaceCleanupOutcome;
  readonly filesReleased: number;
  /** True only when a post-deletion existence check confirmed the workspace is gone. */
  readonly verifiedAbsent: boolean;
  /** Entries the engine did not create and therefore refused to remove. Counted, never named. */
  readonly foreignEntriesLeftInPlace: number;
}

/**
 * The buffered writer's own counters (BR-SOURCE-14B.0H § 11, § 26). Every field here is a count —
 * never a name, a path or a value — matching every other stats accessor this module exposes.
 */
export interface BrazilReceitaFullJoinPartitionWriteStats {
  /** How many references were successfully appended. Mirrors `referenceCount` summed, kept flat. */
  readonly referenceRecordsAppended: number;
  /** How many `fs.write`-shaped syscalls the buffered writer actually issued. The whole point. */
  readonly partitionWriteSyscalls: number;
  /** How many of those syscalls were a FULL-buffer flush rather than the final partial one. */
  readonly fullBufferFlushes: number;
  /** How many times a buffer was flushed for any reason (full, eviction, pre-read, dispose). */
  readonly flushCount: number;
  /** A flush that failed. Once nonzero, `appendReference` refuses every further call. */
  readonly flushFailures: number;
}

export interface BrazilReceitaFullJoinWorkspace {
  /** Appends one reference to a partition. Refuses BEFORE writing when the cap would be crossed. */
  appendReference(
    reference: BrazilReceitaFullJoinRowReference,
    partitionOrdinal: number,
  ): { readonly ok: true } | { readonly ok: false; readonly failure: BrazilReceitaFullJoinWorkspaceFailure };
  /**
   * Reads ONE BOUNDED SLICE of a partition's references, starting at a record index.
   *
   * A slice rather than a stream-with-callback, for one reason: the sink may be asynchronous, and a
   * synchronous visitor cannot await it. Handing the engine a bounded slice lets it await the sink
   * between slices while memory stays at `maxRecords × 16` bytes — independent of the partition's
   * size, let alone the dataset's.
   */
  readPartitionSlice(
    family: BrazilReceitaFullJoinPartitionedFamily,
    partitionOrdinal: number,
    startRecordIndex: number,
    maxRecords: number,
  ):
    | {
        readonly ok: true;
        readonly references: readonly BrazilReceitaFullJoinRowReference[];
        readonly nextRecordIndex: number;
        readonly exhausted: boolean;
      }
    | { readonly ok: false; readonly failure: BrazilReceitaFullJoinWorkspaceFailure };
  referenceCount(
    family: BrazilReceitaFullJoinPartitionedFamily,
    partitionOrdinal: number,
  ): number;
  bytesWritten(): number;
  /** Live descriptor accounting for the partition pool. Counts only — never a name or a path. */
  handleStats(): BrazilReceitaFullJoinPartitionHandlePoolStats;
  /** The buffered writer's own counters (BR-SOURCE-14B.0H). Counts only — never a name or a path. */
  writeStats(): BrazilReceitaFullJoinPartitionWriteStats;
  /** Deletes every file this workspace created, then the directory, then verifies absence. */
  dispose(): BrazilReceitaFullJoinWorkspaceCleanupResult;
}

export interface BrazilReceitaFullJoinWorkspaceRequest {
  readonly parentDirectory: string;
  readonly boundaries: BrazilReceitaFullJoinWorkspaceBoundaries;
  readonly fileSystem: BrazilReceitaFullJoinWorkspaceFileSystem;
  readonly maxTemporaryStorageBytes: number;
  /**
   * The pool's own ceiling on simultaneously-open partition files (BR-SOURCE-14B.0F § 3).
   *
   * REQUIRED, with no default, for the same reason every 14B.0C cap is required: a filled gap is an
   * invented authorization, and the gap this one fills is precisely the one that made descriptor
   * usage a function of `maxPartitionCount`.
   */
  readonly maxOpenPartitionFiles: number;
  /**
   * The GLOBAL concurrent descriptor ledger, shared with source files, the private metric artifact
   * and control artifacts. Injected rather than created here, because "global" is only true if every
   * category reserves from the same instance.
   */
  readonly openHandleLedger: BrazilReceitaFullJoinOpenHandleLedger;
  /** How many bytes must remain free on the workspace's own filesystem, and how to find out. */
  readonly minimumFreeDiskBeforeStart: number;
  readonly minimumFreeDiskReserve: number;
  readonly freeDiskProbe: BrazilReceitaFullJoinFreeDiskProbe;
  /**
   * Whether the run is a REAL one. A real run additionally requires
   * `BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED`, which is `false`, so a real run
   * refuses here and no amount of parameter passing changes that.
   */
  readonly realDataRun: boolean;
}

export type BrazilReceitaFullJoinWorkspaceCreation =
  | { readonly ok: true; readonly workspace: BrazilReceitaFullJoinWorkspace }
  | {
      readonly ok: false;
      readonly rejections: readonly BrazilReceitaFullJoinWorkspaceRejection[];
      readonly failure: BrazilReceitaFullJoinWorkspaceFailure | null;
    };

/**
 * Creates a bounded reference workspace, or refuses.
 *
 * Order matters and is enforced: the temporary-storage POLICY is checked first (a run that may not
 * use temporary storage must not be able to learn whether its destination was acceptable), then the
 * cap, then the destination, and only then is anything created. Permissions are set and then
 * VERIFIED — `mkdtemp` honours the process umask, so the mode requested at creation is a request.
 */
export function createBrazilReceitaFullJoinPartitionWorkspace(
  request: BrazilReceitaFullJoinWorkspaceRequest,
): BrazilReceitaFullJoinWorkspaceCreation {
  if (request.realDataRun && !BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED) {
    return { ok: false, rejections: ['temporary_storage_policy_not_approved'], failure: null };
  }
  if (
    !Number.isInteger(request.maxTemporaryStorageBytes) ||
    request.maxTemporaryStorageBytes < BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES
  ) {
    // A cap below one record is not a stricter workspace; it is a workspace that cannot hold its
    // smallest legal unit, and writing nothing while reporting success would be worse.
    return { ok: false, rejections: ['storage_cap_invalid'], failure: null };
  }

  // The pool cap and the global cap are validated together: a partition pool allowed to exhaust the
  // whole descriptor budget on its own would leave nothing for the source file the join re-reads.
  if (
    !Number.isInteger(request.maxOpenPartitionFiles) ||
    request.maxOpenPartitionFiles <= 0 ||
    request.maxOpenPartitionFiles > request.openHandleLedger.maxFilesOpened()
  ) {
    return { ok: false, rejections: ['handle_caps_invalid'], failure: null };
  }

  const diskThresholds = resolveBrazilReceitaFullJoinFreeDiskThresholds({
    minimumFreeDiskBeforeStart: request.minimumFreeDiskBeforeStart,
    minimumFreeDiskReserve: request.minimumFreeDiskReserve,
    maxTemporaryStorageBytes: request.maxTemporaryStorageBytes,
  });
  if (!diskThresholds.ok) {
    return { ok: false, rejections: ['free_disk_thresholds_invalid'], failure: null };
  }

  const rejections = validateBrazilReceitaFullJoinWorkspaceParent(
    request.parentDirectory,
    request.boundaries,
    request.fileSystem,
  );
  if (rejections.length > 0) return { ok: false, rejections, failure: null };

  // Probed AFTER the destination is validated and BEFORE anything is created: a run that made its
  // workspace and then found the volume full would have to clean up something it should never have
  // made. `mkdtemp` cannot cross a filesystem boundary, so the parent's volume is the workspace's.
  const beforeStart = assertBrazilReceitaFullJoinFreeDiskBeforeStart(
    request.parentDirectory,
    diskThresholds.thresholds,
    request.freeDiskProbe,
  );
  if (!beforeStart.ok) {
    return {
      ok: false,
      rejections: [
        beforeStart.breach.code === 'free_disk_measurement_unavailable'
          ? 'free_disk_measurement_unavailable'
          : 'insufficient_free_disk_before_start',
      ],
      failure: null,
    };
  }

  const { fileSystem } = request;

  let directory: string;
  try {
    directory = fileSystem.makeTemporaryDirectory(
      request.parentDirectory,
      BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_DIRECTORY_PREFIX,
    );
  } catch {
    return { ok: false, rejections: [], failure: 'workspace_creation_failed' };
  }

  try {
    fileSystem.chmod(directory, BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_DIRECTORY_MODE);
  } catch {
    return { ok: false, rejections: [], failure: 'workspace_permission_hardening_failed' };
  }
  try {
    const mode = fileSystem.statMode(directory) & 0o777;
    if (mode !== BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_DIRECTORY_MODE) {
      return { ok: false, rejections: [], failure: 'workspace_permission_verification_failed' };
    }
  } catch {
    return { ok: false, rejections: [], failure: 'workspace_permission_verification_failed' };
  }

  let written = 0;
  let recordsWritten = 0;
  const counts = new Map<string, number>();
  const hardenedFiles = new Set<string>();
  const freeDiskCheckDue = createBrazilReceitaFullJoinFreeDiskCheckSchedule();

  // ── Buffered partition writer (BR-SOURCE-14B.0H) ────────────────────────────
  //
  // ROOT-CAUSE FINDING that shaped this design: a buffer tied to a HANDLE's lifetime only helps when
  // the same partition is revisited before its handle is evicted. Under near-uniform hash routing with
  // `partitionCount` far above `maxOpenPartitionFiles` (the proposed profile is 1024-2048 vs. 32), the
  // handle-pool's own cache hit rate measures under 1% — an eviction fires on almost every reference,
  // flushing a buffer that never held more than one record. Profiling this (BR-SOURCE-14B.0H § 26)
  // showed a handle-tied buffer earning a ~625x write-call reduction at low partition counts and a ~1x
  // reduction (no benefit) at the proposed 1024-partition profile — precisely because eviction, not the
  // write syscall, was already dominating.
  //
  // The fix: a partition's write buffer is now bounded independently of whether that partition's FILE
  // HANDLE is currently open. Buffers survive a handle eviction — the handle pool's own 32-file LRU is
  // completely unchanged and untouched by this — so a partition keeps accumulating references across
  // however many unrelated handle evictions happen in between, and the (comparatively rare) open/write/
  // possible-eviction cycle only happens once per FULL buffer, not once per reference.
  //
  // Bounded to `MAX_BUFFERED_PARTITIONS` entries (its own much-larger LRU, independent of the handle
  // pool's): at `BUFFER_BYTES_PER_PARTITION` bytes each, the worst case is
  // `4_096 * 8_192 = 33_554_432` bytes — 32 MiB, HALF of `maxExternalMemoryBytes` (64 MiB in the
  // proposed profile), leaving the other half for the reader's chunk buffer (4 MiB), carry/row
  // buffers (128 KiB together) and everything else with real headroom. BR-SOURCE-14B.0H's brief
  // proposed "32 partitions x 64 KiB" (2 MiB) as an INITIAL figure for a design where every buffer
  // shared the handle pool's own 32-slot ceiling; once buffers were decoupled from handles (see
  // above), that ceiling no longer bounds this memory, and profiling showed write-call reduction
  // scaling directly with bytes-per-partition — 32 MiB is the size at which the synthetic engineering
  // target (>= 5 MiB/s sustained, BR-SOURCE-14B.0H § 12) was actually reached (measured ~7.6 MiB/s at
  // 1M references / 1024 partitions), not a round number chosen a priori.
  interface PendingPartitionBuffer {
    readonly bytes: Buffer;
    length: number;
  }
  const MAX_BUFFERED_PARTITIONS = BRAZIL_RECEITA_FULL_JOIN_MAX_BUFFERED_PARTITIONS;
  const BUFFER_BYTES_PER_PARTITION = BRAZIL_RECEITA_FULL_JOIN_PARTITION_WRITE_BUFFER_BYTES;
  /** Insertion order doubles as LRU order, exactly like the handle pool's own `openHandles` map. */
  const writeBuffers = new Map<string, PendingPartitionBuffer>();
  let partitionWriteSyscalls = 0;
  let fullBufferFlushes = 0;
  let flushCount = 0;
  let flushFailures = 0;
  // Latched, like the resource enforcer: once a flush has failed, a byte may already be unaccounted
  // for on disk, and every further append refuses rather than building on an uncertain foundation.
  let flushFailureLatched = false;

  function partitionPath(name: string): string {
    return path.join(directory, name);
  }

  /**
   * Pool keys carry their MODE, because a partition file is opened two different ways over its life:
   * `a:` while references are being appended, `r:` while they are being read back. Keying by name
   * alone would let a read hand back an append handle, whose position is at end-of-file.
   */
  const APPEND_KEY_PREFIX = 'a:';
  const READ_KEY_PREFIX = 'r:';

  const handlePool = createBrazilReceitaFullJoinPartitionHandlePool({
    maxOpenPartitionFiles: request.maxOpenPartitionFiles,
    ledger: request.openHandleLedger,
    port: {
      open(key, firstOpen) {
        const name = key.slice(2);
        if (key.startsWith(READ_KEY_PREFIX)) return fileSystem.openForRead(partitionPath(name));
        // `openForAppend` is create-exclusive on a path that does not exist and append-only on one
        // that does, so a REOPEN after eviction lands on the file this workspace already created and
        // continues at its end. `firstOpen` is what makes the distinction auditable rather than a
        // side effect of an existence probe.
        void firstOpen;
        return fileSystem.openForAppend(partitionPath(name), BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE);
      },
      close(handle) {
        // No buffer interaction here, deliberately: buffers are no longer tied to handle lifetime (see
        // above), so an evicted handle's partition simply keeps accumulating in memory, unaffected,
        // until ITS OWN buffer decides to flush. A reopen for the same name later lands in append mode
        // at end-of-file, which is exactly where the last actual flush left it.
        fileSystem.close(handle);
      },
    },
  });

  /**
   * Acquires a (possibly freshly reopened) handle for `name` and writes its ENTIRE pending buffer
   * through it in one syscall, then drops the buffer's map entry. Used by every flush trigger: a full
   * buffer, an evicted buffer slot, a read, and dispose — one function, so "a flush is a flush" holds
   * regardless of what triggered it.
   */
  function flushBufferThroughFreshHandle(name: string): boolean {
    const pending = writeBuffers.get(name);
    if (pending === undefined) return true;
    if (pending.length === 0) {
      writeBuffers.delete(name);
      return true;
    }

    const acquired = handlePool.acquire(`${APPEND_KEY_PREFIX}${name}`);
    if (!acquired.ok) {
      flushFailures += 1;
      flushFailureLatched = true;
      writeBuffers.delete(name);
      return false;
    }
    const handle = acquired.handle;

    // Permissions are hardened and VERIFIED once per file, not once per flush: `mkdtemp`'s umask
    // applies at creation, and a file whose mode was already verified cannot change it from under us.
    if (!hardenedFiles.has(name)) {
      try {
        fileSystem.chmod(partitionPath(name), BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE);
        const mode = fileSystem.statMode(partitionPath(name)) & 0o777;
        if (mode !== BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE) {
          flushFailures += 1;
          flushFailureLatched = true;
          writeBuffers.delete(name);
          return false;
        }
      } catch {
        flushFailures += 1;
        flushFailureLatched = true;
        writeBuffers.delete(name);
        return false;
      }
      hardenedFiles.add(name);
    }

    const attemptedLength = pending.length;
    let bytes: number;
    try {
      bytes = fileSystem.write(handle, pending.bytes.subarray(0, attemptedLength));
    } catch {
      // Whether zero bytes or some prefix actually reached disk is now UNKNOWABLE from here, so the
      // buffer is dropped regardless: retrying the same bytes over an unknown amount already written
      // would risk DUPLICATING a reference on disk, which is strictly worse than losing one —
      // `flushFailureLatched` is what stops the run instead of continuing on an uncertain file.
      flushFailures += 1;
      flushFailureLatched = true;
      writeBuffers.delete(name);
      return false;
    }
    partitionWriteSyscalls += 1;
    flushCount += 1;
    if (attemptedLength === pending.bytes.length) fullBufferFlushes += 1;
    writeBuffers.delete(name);
    if (bytes !== attemptedLength) {
      flushFailures += 1;
      flushFailureLatched = true;
      return false;
    }
    return true;
  }

  /**
   * Returns the buffer for `name`, creating one if needed and evicting the LEAST-RECENTLY-TOUCHED
   * existing buffer first if the ceiling (`MAX_BUFFERED_PARTITIONS`) would otherwise be crossed. This
   * ceiling is a WORKSPACE-OWNED safety bound — it does not trust a caller's `partitionCount` to stay
   * inside it, the same discipline this module applies to every other cap it enforces on itself.
   */
  function touchBuffer(name: string): PendingPartitionBuffer | null {
    const existing = writeBuffers.get(name);
    if (existing !== undefined) {
      // Touch: delete and re-set moves this key to the back of the LRU order, exactly like the
      // handle pool's own `acquire()`.
      writeBuffers.delete(name);
      writeBuffers.set(name, existing);
      return existing;
    }
    if (writeBuffers.size >= MAX_BUFFERED_PARTITIONS) {
      const oldest = writeBuffers.keys().next();
      if (!oldest.done && !flushBufferThroughFreshHandle(oldest.value)) return null;
    }
    const created: PendingPartitionBuffer = {
      bytes: Buffer.alloc(BUFFER_BYTES_PER_PARTITION),
      length: 0,
    };
    writeBuffers.set(name, created);
    return created;
  }

  const workspace: BrazilReceitaFullJoinWorkspace = {
    appendReference(reference, partitionOrdinal) {
      // Once ANY flush has failed, some previously-accepted reference may not actually be on disk.
      // Refusing every further call — rather than only the one that happened to trigger the failed
      // flush — is what keeps "eviction cannot lose a byte" true: a byte lost silently by a LATER
      // append building on top of an unflushed failure would be worse than stopping here.
      if (flushFailureLatched) return { ok: false, failure: 'partition_write_failed' };

      const name = brazilReceitaFullJoinPartitionFileName(reference.family, partitionOrdinal);
      if (name === null) return { ok: false, failure: 'partition_name_invalid' };

      const encoded = encodeBrazilReceitaFullJoinRowReference(reference);
      if (!encoded.ok) return { ok: false, failure: 'reference_encoding_failed' };

      // The hard cap, checked on the PROJECTED total before a single byte is written. A partially
      // written record would leave a truncated file that no reader could interpret.
      const projected = written + BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES;
      if (projected > request.maxTemporaryStorageBytes) {
        return { ok: false, failure: 'temporary_storage_cap_exceeded' };
      }

      // The free-disk RESERVE, re-checked once per write block. A `statfs` per 16-byte record would
      // dominate the syscall budget and measure nothing new — a volume cannot lose 8 GiB between two
      // consecutive records.
      if (freeDiskCheckDue(recordsWritten)) {
        const reserve = assertBrazilReceitaFullJoinFreeDiskReserve(
          directory,
          diskThresholds.thresholds,
          request.freeDiskProbe,
        );
        if (!reserve.ok) {
          return {
            ok: false,
            failure:
              reserve.breach.code === 'free_disk_measurement_unavailable'
                ? 'free_disk_measurement_unavailable'
                : 'free_disk_reserve_breached',
          };
        }
      }

      // FAIL FAST, once per DISTINCT partition rather than once per reference: the very first time
      // this name is seen, its destination is opened and its permissions hardened/verified right now
      // — exactly what the pre-14B.0H design did on every single append, just no longer repeated on
      // every one of the (potentially thousands of) references that land in an already-validated
      // partition afterward. A destination that is fundamentally broken (unopenable, unverifiable
      // permissions) is discovered on this partition's FIRST reference, not silently deferred to
      // whenever its buffer happens to fill.
      if (!writeBuffers.has(name)) {
        const acquired = handlePool.acquire(`${APPEND_KEY_PREFIX}${name}`);
        if (!acquired.ok) {
          return {
            ok: false,
            failure:
              acquired.failure === 'handle_cap_exceeded'
                ? 'partition_handle_cap_exceeded'
                : 'partition_open_failed',
          };
        }
        if (!hardenedFiles.has(name)) {
          try {
            fileSystem.chmod(partitionPath(name), BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE);
            const mode = fileSystem.statMode(partitionPath(name)) & 0o777;
            if (mode !== BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE) {
              return { ok: false, failure: 'partition_file_permission_verification_failed' };
            }
          } catch {
            return { ok: false, failure: 'partition_file_permission_verification_failed' };
          }
          hardenedFiles.add(name);
        }
      }

      // The buffered write itself (BR-SOURCE-14B.0H): the record lands in memory, and the handle pool
      // above is touched again only when THIS partition's buffer fills, is evicted to make room for
      // another, or the run reads/disposes — never once per reference.
      const pending = touchBuffer(name);
      if (pending === null) return { ok: false, failure: 'partition_write_failed' };
      if (pending.length + BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES > pending.bytes.length) {
        if (!flushBufferThroughFreshHandle(name)) {
          return { ok: false, failure: 'partition_write_failed' };
        }
        // `flushBufferThroughFreshHandle` always drops the map entry it flushed, so a fresh empty
        // buffer for the SAME name is created and immediately re-touched to keep LRU order correct.
        const fresh = touchBuffer(name);
        if (fresh === null) return { ok: false, failure: 'partition_write_failed' };
        encoded.record.copy(fresh.bytes, fresh.length);
        fresh.length += BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES;
      } else {
        // Copied into the buffer rather than retained as `encoded.record` itself: reusing one scratch
        // Buffer per encode call (a future micro-optimization) must not be able to corrupt an EARLIER
        // reference still sitting unflushed in a partition's buffer.
        encoded.record.copy(pending.bytes, pending.length);
        pending.length += BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES;
      }

      written = projected;
      recordsWritten += 1;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      return { ok: true };
    },

    readPartitionSlice(family, partitionOrdinal, startRecordIndex, maxRecords) {
      const name = brazilReceitaFullJoinPartitionFileName(family, partitionOrdinal);
      if (name === null) return { ok: false, failure: 'partition_name_invalid' };
      if (!Number.isInteger(startRecordIndex) || startRecordIndex < 0) {
        return { ok: false, failure: 'partition_read_failed' };
      }
      if (!Number.isInteger(maxRecords) || maxRecords <= 0) {
        return { ok: false, failure: 'partition_read_failed' };
      }
      const total = counts.get(name) ?? 0;
      if (startRecordIndex >= total) {
        return { ok: true, references: [], nextRecordIndex: startRecordIndex, exhausted: true };
      }

      // Writing must be finished before reading: this partition's buffer (BR-SOURCE-14B.0H) may hold
      // references never yet written to disk, decoupled from whether its handle happens to be open.
      if (!flushBufferThroughFreshHandle(name)) {
        return { ok: false, failure: 'partition_write_failed' };
      }
      // An open append handle may ALSO hold OS-level unflushed bytes; closed before the read handle
      // opens, exactly as before.
      handlePool.closeKey(`${APPEND_KEY_PREFIX}${name}`);

      // The READ handle is pooled too, so a partition read back in many bounded slices pays one
      // `open` rather than one per slice — and, more importantly, so it counts against the same
      // global ledger as everything else.
      const acquired = handlePool.acquire(`${READ_KEY_PREFIX}${name}`);
      if (!acquired.ok) {
        return {
          ok: false,
          failure:
            acquired.failure === 'handle_cap_exceeded'
              ? 'partition_handle_cap_exceeded'
              : 'partition_open_failed',
        };
      }
      const handle = acquired.handle;

      const wanted = Math.min(maxRecords, total - startRecordIndex);
      const sliceBytes = BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES * wanted;
      // Allocated per slice and bounded by `maxRecords`, never by the partition's size.
      const buffer = Buffer.alloc(sliceBytes);
      const position = startRecordIndex * BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES;
      const references: BrazilReceitaFullJoinRowReference[] = [];

      try {
        let filled = 0;
        while (filled < sliceBytes) {
          let bytes: number;
          try {
            bytes = fileSystem.read(handle, buffer, filled, sliceBytes - filled, position + filled);
          } catch {
            return { ok: false, failure: 'partition_read_failed' };
          }
          if (!Number.isFinite(bytes) || bytes <= 0) {
            // The count says these records exist; the file disagrees. Refused rather than
            // interpreted: a short reference file is a corrupt one, not a smaller partition.
            return { ok: false, failure: 'partition_record_truncated' };
          }
          filled += bytes;
        }
        if (filled % BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES !== 0) {
          return { ok: false, failure: 'partition_record_truncated' };
        }
        for (
          let cursor = 0;
          cursor < filled;
          cursor += BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES
        ) {
          const decoded = decodeBrazilReceitaFullJoinRowReference(buffer, cursor);
          if (!decoded.ok) return { ok: false, failure: 'partition_record_truncated' };
          references.push(decoded.reference);
        }
      } finally {
        // The handle is NOT closed here: it belongs to the pool, which reuses it for the next slice
        // of this partition and evicts it when the budget is needed elsewhere. `dispose` closes it.
        // Closing it here would defeat the pooling and leave the ledger holding a phantom slot.
      }

      const nextRecordIndex = startRecordIndex + references.length;
      return { ok: true, references, nextRecordIndex, exhausted: nextRecordIndex >= total };
    },

    referenceCount(family, partitionOrdinal) {
      const name = brazilReceitaFullJoinPartitionFileName(family, partitionOrdinal);
      if (name === null) return 0;
      return counts.get(name) ?? 0;
    },

    bytesWritten() {
      return written;
    },

    handleStats() {
      return handlePool.stats();
    },

    writeStats() {
      return {
        referenceRecordsAppended: recordsWritten,
        partitionWriteSyscalls,
        fullBufferFlushes,
        flushCount,
        flushFailures,
      };
    },

    dispose() {
      // Every buffered partition (BR-SOURCE-14B.0H) is flushed BEFORE any handle is closed: a buffer
      // may hold references no handle currently open is even associated with (that is the whole point
      // of decoupling them), so this is the only place that is guaranteed to see every one of them.
      // Best-effort — a failure here is already latched via `flushFailureLatched` and reflected in
      // `bytesWritten()`'s caller-visible history; cleanup still proceeds regardless, exactly like a
      // failing `port.close` below never blocks the ledger release that follows it.
      for (const name of [...writeBuffers.keys()]) flushBufferThroughFreshHandle(name);

      // Every pooled descriptor — append and read alike — is closed and its ledger slot released
      // BEFORE any deletion is attempted. § 12 orders it this way for a reason: unlinking a file
      // this process still holds open leaves the space allocated until the descriptor goes, so a
      // cleanup that deleted first would report `completed` while the volume was still full.
      handlePool.closeAll();

      let names: readonly string[];
      try {
        names = fileSystem.listNames(directory);
      } catch {
        // The directory cannot be enumerated, so nobody can say what is left in it. `unverified`
        // rather than `failed`: those are different facts, and 14B.0C keeps them apart.
        return { outcome: 'unverified', filesReleased: 0, verifiedAbsent: false, foreignEntriesLeftInPlace: 0 };
      }

      let released = 0;
      let foreign = 0;
      let removalFailed = false;
      for (const name of names) {
        if (!BRAZIL_RECEITA_FULL_JOIN_PARTITION_FILE_PATTERN.test(name)) {
          // Not a file this engine created. Left in place deliberately: a cleanup that removes
          // entries it does not recognize is a cleanup that can remove someone else's data.
          foreign += 1;
          continue;
        }
        try {
          fileSystem.removeFile(path.join(directory, name));
          released += 1;
        } catch {
          removalFailed = true;
        }
      }

      if (removalFailed) {
        return { outcome: 'failed', filesReleased: released, verifiedAbsent: false, foreignEntriesLeftInPlace: foreign };
      }
      if (foreign > 0) {
        // The workspace still holds entries this engine may not touch, so the directory stays and
        // the outcome is honest about it.
        return { outcome: 'failed', filesReleased: released, verifiedAbsent: false, foreignEntriesLeftInPlace: foreign };
      }

      try {
        fileSystem.removeDirectory(directory);
      } catch {
        return { outcome: 'failed', filesReleased: released, verifiedAbsent: false, foreignEntriesLeftInPlace: foreign };
      }

      let verifiedAbsent = false;
      try {
        verifiedAbsent = !fileSystem.exists(directory);
      } catch {
        verifiedAbsent = false;
      }
      if (!verifiedAbsent) {
        return { outcome: 'unverified', filesReleased: released, verifiedAbsent: false, foreignEntriesLeftInPlace: foreign };
      }
      return {
        outcome: released === 0 ? 'not_needed' : 'completed',
        filesReleased: released,
        verifiedAbsent: true,
        foreignEntriesLeftInPlace: 0,
      };
    },
  };

  return { ok: true, workspace };
}
