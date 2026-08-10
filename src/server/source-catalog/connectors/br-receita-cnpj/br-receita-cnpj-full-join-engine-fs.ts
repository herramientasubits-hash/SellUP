/**
 * BR Receita CNPJ — real filesystem adapter for the STREAMING FULL-JOIN ENGINE (BR-SOURCE-14B.0D).
 *
 * Isolated in its own module for exactly the reason `br-receita-cnpj-full-join-private-channel-fs`
 * is: it lets the reader, the partition workspace and the engine stay entirely free of `node:fs`, so
 * their static guards can assert they perform no I/O of their own while the mechanism they drive is
 * still backed by a real disk here.
 *
 * This adapter is MECHANISM ONLY. Every policy decision — is the destination outside the repository,
 * outside home, outside the dataset, is the parent a symlink, is the cap about to be crossed, is the
 * name technical — belongs to the modules above and has already been made before any function here
 * runs. Nothing in this file decides whether an operation is allowed.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - calls `readFileSync`, `readFile`, or anything else that materializes a whole file. `read` is
 *     bounded by the caller's buffer, and there is no unbounded read in the port it implements.
 *   - writes to stdout or stderr. It has no `console` reference.
 *   - reads an environment variable, a hostname or a username. `os.tmpdir()` is NOT called here: a
 *     workspace parent is always supplied by the caller, so this module cannot choose a destination.
 *   - deletes recursively, and has no force flag. `removeFile` unlinks one path; `removeDirectory`
 *     removes an EMPTY directory and fails if it is not empty — so a stray entry stops the deletion
 *     and is reported rather than swept away.
 *   - follows a symlink to answer a question about permissions or existence: `lstat` throughout.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { BrazilReceitaFullJoinFreeDiskProbe } from './br-receita-cnpj-full-join-free-disk';
import type { BrazilReceitaFullJoinWorkspaceFileSystem } from './br-receita-cnpj-full-join-partition-workspace';
import type { BrazilReceitaFullJoinReaderFileSystem } from './br-receita-cnpj-full-join-streaming-reader';

/**
 * The real free-disk probe, backed by `statfs` (BR-SOURCE-14B.0F § 4).
 *
 * `statfsSync` rather than `child_process` + `df`, which § 4 forbids and which would be worse on
 * every axis: spawning a shell from a module that must not spawn anything, parsing locale-dependent
 * output, and answering for whatever `df` decided the path meant.
 *
 * `bavail`, NOT `bfree`. Most filesystems reserve a slice of their free blocks for the superuser, so
 * `bfree` is larger than what this process can actually write. A run that treated the reserved slice
 * as usable would hit `ENOSPC` while its own arithmetic still said there was room — which is exactly
 * the failure the free-disk check exists to prevent.
 *
 * Throws on an unresolvable path, and that is deliberate: the free-disk policy module treats a
 * throwing probe as `free_disk_measurement_unavailable`, which is terminal. A probe that swallowed
 * the error and returned a large number would turn "cannot measure" into "plenty of room".
 */
export function createBrazilReceitaFullJoinFreeDiskProbe(): BrazilReceitaFullJoinFreeDiskProbe {
  return (targetPath: string): number => {
    const stats = fs.statfsSync(targetPath);
    return Number(stats.bavail) * Number(stats.bsize);
  };
}

/**
 * The real, process-backed reader port.
 *
 * `size` uses `statSync` deliberately: the question is how many bytes the reader must traverse, and
 * for a regular data file that is the target's size. A symlinked INPUT is a manifest-resolution
 * concern, not a reader concern — the reader is handed paths, it does not choose them.
 */
export function createBrazilReceitaFullJoinReaderFileSystem(): BrazilReceitaFullJoinReaderFileSystem {
  return {
    size(filePath) {
      return fs.statSync(filePath).size;
    },
    open(filePath) {
      return fs.openSync(filePath, 'r');
    },
    read(handle, buffer, bufferOffset, length, position) {
      return fs.readSync(handle, buffer, bufferOffset, length, position);
    },
    close(handle) {
      fs.closeSync(handle);
    },
  };
}

/**
 * The real, process-backed workspace port.
 *
 * `makeTemporaryDirectory` appends the prefix to the caller's parent and hands the whole thing to
 * `mkdtempSync`, which chooses the random suffix. The caller therefore cannot supply a full
 * directory name, and two concurrent runs cannot collide on one.
 *
 * `openForAppend` uses the `ax` flag on first open — create-exclusive, append-only — so a
 * pre-existing file or a planted symlink at that path is an ERROR rather than a target. The mode is a
 * request (`open` masks it with the umask), which is why the workspace module chmods and then
 * verifies.
 */
export function createBrazilReceitaFullJoinWorkspaceFileSystem(): BrazilReceitaFullJoinWorkspaceFileSystem {
  return {
    makeTemporaryDirectory(parentDirectory, prefix) {
      return fs.mkdtempSync(path.join(parentDirectory, prefix));
    },
    chmod(targetPath, mode) {
      fs.chmodSync(targetPath, mode);
    },
    statMode(targetPath) {
      // `lstatSync`, not `statSync`: the mode that matters is the entry's own, and a symlink
      // target's mode would answer a different question than the one being verified.
      return fs.lstatSync(targetPath).mode;
    },
    isSymbolicLink(targetPath) {
      return fs.lstatSync(targetPath).isSymbolicLink();
    },
    realPath(targetPath) {
      return fs.realpathSync(targetPath);
    },
    exists(targetPath) {
      // `lstatSync` again: a dangling symlink must count as PRESENT, because cleanup has to remove
      // it and `existsSync` would report it as absent.
      try {
        fs.lstatSync(targetPath);
        return true;
      } catch {
        return false;
      }
    },
    openForAppend(filePath, mode) {
      // `ax` on a fresh path, `a` once this run already created it. The exclusive first open is the
      // guarantee that this engine never appends into a file it did not create.
      if (fs.existsSync(filePath)) return fs.openSync(filePath, 'a', mode);
      return fs.openSync(filePath, 'ax', mode);
    },
    openForRead(filePath) {
      return fs.openSync(filePath, 'r');
    },
    write(handle, data) {
      return fs.writeSync(handle, data, 0, data.length);
    },
    read(handle, buffer, bufferOffset, length, position) {
      return fs.readSync(handle, buffer, bufferOffset, length, position);
    },
    close(handle) {
      fs.closeSync(handle);
    },
    listNames(directoryPath) {
      return fs.readdirSync(directoryPath);
    },
    removeFile(filePath) {
      fs.unlinkSync(filePath);
    },
    removeDirectory(directoryPath) {
      // `rmdirSync`, not `rmSync({recursive:true})`: a non-empty workspace must FAIL here so the
      // caller reports an unreleased artifact, rather than silently deleting whatever was in it.
      fs.rmdirSync(directoryPath);
    },
  };
}
