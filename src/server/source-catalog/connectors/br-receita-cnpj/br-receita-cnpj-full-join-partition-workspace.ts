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
  | 'storage_cap_invalid';

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
  | 'partition_record_truncated';

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
  /** Deletes every file this workspace created, then the directory, then verifies absence. */
  dispose(): BrazilReceitaFullJoinWorkspaceCleanupResult;
}

export interface BrazilReceitaFullJoinWorkspaceRequest {
  readonly parentDirectory: string;
  readonly boundaries: BrazilReceitaFullJoinWorkspaceBoundaries;
  readonly fileSystem: BrazilReceitaFullJoinWorkspaceFileSystem;
  readonly maxTemporaryStorageBytes: number;
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

  const rejections = validateBrazilReceitaFullJoinWorkspaceParent(
    request.parentDirectory,
    request.boundaries,
    request.fileSystem,
  );
  if (rejections.length > 0) return { ok: false, rejections, failure: null };

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
  const counts = new Map<string, number>();
  const appendHandles = new Map<string, number>();

  function partitionPath(name: string): string {
    return path.join(directory, name);
  }

  function closeAppendHandles(): void {
    for (const handle of appendHandles.values()) {
      try {
        fileSystem.close(handle);
      } catch {
        // A close failure is reported through the cleanup outcome, not thrown: the caller is already
        // on its way out, and an exception here would replace an accurate cleanup verdict.
      }
    }
    appendHandles.clear();
  }

  const workspace: BrazilReceitaFullJoinWorkspace = {
    appendReference(reference, partitionOrdinal) {
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

      let handle = appendHandles.get(name);
      if (handle === undefined) {
        try {
          handle = fileSystem.openForAppend(
            partitionPath(name),
            BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE,
          );
        } catch {
          return { ok: false, failure: 'partition_open_failed' };
        }
        appendHandles.set(name, handle);
        try {
          fileSystem.chmod(partitionPath(name), BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE);
          const mode = fileSystem.statMode(partitionPath(name)) & 0o777;
          if (mode !== BRAZIL_RECEITA_FULL_JOIN_WORKSPACE_FILE_MODE) {
            return { ok: false, failure: 'partition_file_permission_verification_failed' };
          }
        } catch {
          return { ok: false, failure: 'partition_file_permission_verification_failed' };
        }
      }

      try {
        const bytes = fileSystem.write(handle, encoded.record);
        if (bytes !== BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES) {
          return { ok: false, failure: 'partition_write_failed' };
        }
      } catch {
        return { ok: false, failure: 'partition_write_failed' };
      }

      written = projected;
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

      // Writing must be finished before reading: an open append handle may hold unflushed bytes.
      const appendHandle = appendHandles.get(name);
      if (appendHandle !== undefined) {
        try {
          fileSystem.close(appendHandle);
        } catch {
          return { ok: false, failure: 'partition_write_failed' };
        }
        appendHandles.delete(name);
      }

      let handle: number;
      try {
        handle = fileSystem.openForRead(partitionPath(name));
      } catch {
        return { ok: false, failure: 'partition_open_failed' };
      }

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
        try {
          fileSystem.close(handle);
        } catch {
          // The read verdict already stands; a close failure must not overwrite it.
        }
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

    dispose() {
      closeAppendHandles();

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
