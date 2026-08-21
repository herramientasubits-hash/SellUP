/**
 * BR Receita CNPJ — real filesystem adapter for the PRIVATE operator metric channel
 * (BR-SOURCE-14B.0C § 6).
 *
 * Isolated in its own module for one reason: it lets
 * `br-receita-cnpj-full-join-operator-metric-channel` stay entirely free of `node:fs`, so that
 * module's static guards can assert it performs no I/O at all while the policy it enforces is still
 * backed by a real disk here.
 *
 * This adapter is MECHANISM ONLY. Every policy decision — is the destination outside the
 * repository, outside home, outside the dataset, is the slug safe, is the TTL sane, is the payload
 * clean — belongs to the channel module and has already been made before any function here runs.
 * Nothing in this file decides whether a write is allowed.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - writes to stdout or stderr. It has no `console` reference.
 *   - reads an environment variable, a hostname or a username.
 *   - opens, reads, moves, copies or deletes a dataset file or a manifest. The only paths it ever
 *     receives are the two the channel module derived from a validated operator declaration.
 *   - follows a symlink into place: the artifact is created with `wx`, which fails on an existing
 *     path rather than writing through it.
 */

import * as fs from 'node:fs';

import type { BrazilReceitaFullJoinPrivateChannelFileSystem } from './br-receita-cnpj-full-join-operator-metric-channel';

/**
 * The real, process-backed filesystem for the private channel.
 *
 * `writeFileExclusive` uses the `wx` flag and an explicit mode, then `fsync`s before closing:
 *   - `wx` fails if the path exists, which turns a pre-existing file or a planted symlink into an
 *     error instead of a target.
 *   - `fsync` matters because the artifact is renamed immediately afterwards. Without it, a crash
 *     between rename and flush can leave a visible file with unwritten contents — an artifact that
 *     exists and is empty is worse than one that does not exist.
 *
 * The mode passed here is a REQUEST: `open` masks it with the process umask. The channel module
 * `chmod`s and then verifies, which is why this function does not try to guarantee the mode itself.
 */
export function createBrazilReceitaFullJoinPrivateChannelFileSystem(): BrazilReceitaFullJoinPrivateChannelFileSystem {
  return {
    writeFileExclusive(filePath, contents, mode) {
      const descriptor = fs.openSync(filePath, 'wx', mode);
      try {
        fs.writeFileSync(descriptor, contents, { encoding: 'utf8' });
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    },
    chmod(filePath, mode) {
      fs.chmodSync(filePath, mode);
    },
    statMode(filePath) {
      // `lstatSync`, not `statSync`: the mode that matters is the artifact's own, and a symlink's
      // target mode would answer a different question than the one being verified.
      return fs.lstatSync(filePath).mode;
    },
    rename(fromPath, toPath) {
      fs.renameSync(fromPath, toPath);
    },
    exists(filePath) {
      // `lstatSync` again: a dangling symlink must count as PRESENT, because deletion has to remove
      // it. `existsSync` follows links and would report a dangling link as absent.
      try {
        fs.lstatSync(filePath);
        return true;
      } catch {
        return false;
      }
    },
    unlink(filePath) {
      fs.unlinkSync(filePath);
    },
  };
}
