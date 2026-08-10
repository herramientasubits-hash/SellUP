/**
 * BR Receita CNPJ — real filesystem adapter for the MANIFEST → DESCRIPTOR BRIDGE
 * (BR-SOURCE-14B.0F § 8).
 *
 * Its own module, and the reason is a test rather than taste. 14B.0D's classification suite asserts
 * that `br-receita-cnpj-full-join-engine-fs` contains no `readFileSync`, because that adapter serves
 * the streaming reader and a whole-file read there would be a whole-file read of a 30 GB Receita
 * file. The bridge genuinely does need to read a file whole — but a DIFFERENT file, a small JSON
 * index — and weakening the engine adapter's guard to accommodate it would trade a structural
 * guarantee for a convenience. So the two adapters are separate, and each keeps the guarantee that
 * fits what it reads. `br-receita-cnpj-full-join-private-channel-fs` exists for the same reason.
 *
 * ── The size cap is not decoration ──────────────────────────────────────────────
 * `readManifestDocument` refuses anything above `MANIFEST_DOCUMENT_MAX_BYTES` BEFORE reading a byte.
 * The failure it prevents is concrete: an operator points `--manifest` at `Empresas0.csv` by mistake,
 * and without the cap this function answers by loading tens of gigabytes into a string. With it, the
 * mistake is an error message.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - opens, reads or writes a DATA file. The only path it ever reads is the manifest document, and
 *     the port it implements has no operation that could reach a row.
 *   - writes anything at all. There is no `write`, no `unlink`, no `mkdir`.
 *   - writes to stdout or stderr. It has no `console` reference.
 *   - reads an environment variable, a hostname or a username.
 *   - follows a symlink to answer a question: `lstat` throughout, because the bridge's questions are
 *     about the ENTRY and a target's answers would be answers to a different question.
 */

import * as fs from 'node:fs';

import type { BrazilReceitaFullJoinBridgeFileSystem } from './br-receita-cnpj-full-join-manifest-source-bridge';

/**
 * The ceiling on a manifest document, in bytes.
 *
 * A Receita manifest lists at most six files with a hash and a size each — a few kilobytes. One
 * megabyte is three orders of magnitude of headroom and still four orders below the smallest data
 * file, so it separates "a large manifest" from "not a manifest" cleanly.
 */
export const BRAZIL_RECEITA_FULL_JOIN_MANIFEST_DOCUMENT_MAX_BYTES = 1_000_000 as const;

export function createBrazilReceitaFullJoinBridgeFileSystem(): BrazilReceitaFullJoinBridgeFileSystem {
  return {
    readManifestDocument(manifestPath) {
      // `lstat`, so a symlinked manifest is refused rather than followed, and the size is checked
      // BEFORE the read rather than after.
      const stats = fs.lstatSync(manifestPath);
      if (!stats.isFile()) throw new Error('manifest_not_a_regular_file');
      if (stats.size > BRAZIL_RECEITA_FULL_JOIN_MANIFEST_DOCUMENT_MAX_BYTES) {
        throw new Error('manifest_document_too_large');
      }
      return fs.readFileSync(manifestPath, 'utf8');
    },
    isSymbolicLink(targetPath) {
      return fs.lstatSync(targetPath).isSymbolicLink();
    },
    realPath(targetPath) {
      return fs.realpathSync(targetPath);
    },
    isRegularFile(targetPath) {
      return fs.lstatSync(targetPath).isFile();
    },
  };
}
