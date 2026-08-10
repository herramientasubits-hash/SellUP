/**
 * BR Receita CNPJ — MANIFEST → SOURCE DESCRIPTOR BRIDGE (BR-SOURCE-14B.0F § 8).
 *
 * The second gap 14B.0E found. The engine takes DESCRIPTORS — resolved paths, families, encodings —
 * and 14B.0D deliberately gave it no way to obtain them: § 1 of that milestone forbade opening the
 * real manifest at all, so an engine that could parse manifests would have been an engine that had to
 * be trusted not to. Every descriptor in existence was therefore hand-built by a fixture.
 *
 * This module is the missing edge, and it is the ONLY place in the connector that turns a manifest
 * into something the engine can read from.
 *
 * ── Why the official validator is a PARAMETER ───────────────────────────────────
 * § 8 requires the official validator, and this module requires it too — but as an injected
 * dependency rather than an import. The reason is § 15: no test in this milestone may open the real
 * manifest, and a module that imported `validateBrReceitaCnpjLocalManifest` directly would perform
 * real `stat`, `sha256` and header reads against whatever path it was handed. Injected, the real
 * entry point supplies the real validator and the tests supply a scripted one — and "the entry point
 * uses the official validator" becomes a fact a static test can check at the call site.
 *
 * ── Validation happens TWICE, on purpose ────────────────────────────────────────
 * The official validator answers "is this manifest well-formed, complete and layout-correct". It
 * deliberately does NOT return resolved paths — its reports carry a `safeFileLabel` basename and
 * nothing else, because it was built for a milestone that had no business resolving anything.
 *
 * So this module re-reads the manifest document to obtain the per-file `path`, and re-applies every
 * path rule itself. That is not redundancy: the validator's rules protect ITS report, and these rules
 * protect a descriptor that is about to be handed to something that will `open` it. Re-deriving them
 * here means the engine's input is validated by the code that produces it.
 *
 * ── What is refused, and why each one ───────────────────────────────────────────
 *   absolute path      — a manifest describes files NEXT TO IT. An absolute path is a manifest
 *                        reaching outside its own directory, which is what a traversal looks like
 *                        once someone stops using `..`.
 *   `..` traversal     — refused rather than normalized, before and after resolution.
 *   escape from root   — the resolved path must still be inside the manifest's directory.
 *   symlink            — at the leaf AND anywhere the resolution lands elsewhere. A symlinked data
 *                        file is a file whose real location was never checked.
 *   archive            — `.zip`, `.gz`, `.tar`, `.7z`, `.rar`, `.bz2`, `.xz`. The engine reads bytes
 *                        as delimited text; handed an archive it would read compressed noise, count
 *                        every row malformed, and report a complete traversal of nothing.
 *   unknown family     — the allowlist is `empresas` and `estabelecimentos` for the JOIN, and the
 *                        four reference families for LOOKUPS. `socios`, `qsa` and `simples` are not
 *                        in either list and never reach a descriptor.
 *   encoding/delimiter — must be the declared official pair. A wrong delimiter does not fail loudly:
 *                        it silently produces one-column rows, every one of which looks malformed.
 *   layout mode        — must be `official_headerless`. The real files ship without a header, and
 *                        reading a header-mode file positionally would treat the header as a row.
 *
 * ── Lookups are kept SEPARATE, and they are not opened ──────────────────────────
 * § 8 says so explicitly, and the separation is structural: `joinSources` and `lookupSources` are two
 * different fields, only the first is shaped as an engine descriptor, and nothing in this milestone
 * consumes the second. A reference family that ended up in `joinSources` would be traversed to EOF.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`. Reading the manifest document, `lstat` and `realpath` all arrive through an
 *     injected port, which is how a test can exercise every refusal without a real manifest anywhere.
 *   - reads a data row. It resolves paths and validates declarations; it opens no data file.
 *   - reports a path, a file name or a directory. A refusal names a REASON and a family, and the
 *     descriptors it returns are handed to the engine, never to a report.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

import * as path from 'node:path';

import type { BrazilReceitaFullJoinSourceFileDescriptor } from './br-receita-cnpj-full-join-engine-contract';
import type { BrazilReceitaFullJoinPartitionedFamily } from './br-receita-cnpj-full-join-partition-workspace';
import type { BrReceitaCnpjManifestValidationResult } from './br-receita-cnpj-manifest';

// ─── Version & allowlists ─────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_MANIFEST_BRIDGE_VERSION = 1 as const;

/**
 * The families the ENGINE may open. Exactly the two the join needs.
 *
 * Restated here rather than imported from the manifest layer's `REQUIRED_FILE_TYPES` because they
 * answer different questions: that constant says which families a manifest must DESCRIBE, this one
 * says which files the engine may READ. They coincide today, and a future manifest that required a
 * third family must not silently widen what gets traversed to EOF.
 */
export const BRAZIL_RECEITA_FULL_JOIN_BRIDGE_JOIN_FAMILIES: readonly BrazilReceitaFullJoinPartitionedFamily[] =
  ['empresas', 'estabelecimentos'];

/** Reference families a manifest MAY describe. Carried through as lookups; never opened here. */
export const BRAZIL_RECEITA_FULL_JOIN_BRIDGE_LOOKUP_FAMILIES: readonly string[] = [
  'simples',
  'cnaes',
  'municipios',
  'naturezas',
];

/** The only encoding, delimiter and layout an official file may declare. */
export const BRAZIL_RECEITA_FULL_JOIN_BRIDGE_REQUIRED_ENCODING = 'latin1' as const;
export const BRAZIL_RECEITA_FULL_JOIN_BRIDGE_REQUIRED_DELIMITER = ';' as const;
export const BRAZIL_RECEITA_FULL_JOIN_BRIDGE_REQUIRED_LAYOUT_MODE = 'official_headerless' as const;

/** Data-file extensions a descriptor may carry. */
export const BRAZIL_RECEITA_FULL_JOIN_BRIDGE_ALLOWED_EXTENSIONS: readonly string[] = ['.csv', '.txt'];

/**
 * Extensions that are refused by name.
 *
 * Belt and braces with the allowlist above: the allowlist already refuses everything not on it, and
 * this list exists so an archive is refused with an archive-shaped reason. `archive_not_allowed` tells
 * an operator they pointed the manifest at a download they never extracted; `unsupported_extension`
 * leaves them guessing.
 */
export const BRAZIL_RECEITA_FULL_JOIN_BRIDGE_ARCHIVE_EXTENSIONS: readonly string[] = [
  '.zip',
  '.gz',
  '.tar',
  '.tgz',
  '.7z',
  '.rar',
  '.bz2',
  '.xz',
];

// ─── Refusals ─────────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_BRIDGE_REJECTIONS = [
  'manifest_path_not_absolute',
  'manifest_unreadable',
  'manifest_not_json',
  'manifest_validation_failed',
  'manifest_declaration_missing',
  'family_not_authorized',
  'family_duplicated',
  'required_family_missing',
  'path_absolute_not_allowed',
  'path_traversal_blocked',
  'path_escapes_manifest_root',
  'path_is_symlink',
  'path_realpath_unavailable',
  'path_realpath_escapes_root',
  'path_not_a_regular_file',
  'archive_not_allowed',
  'unsupported_extension',
  'encoding_not_official',
  'delimiter_not_official',
  'layout_mode_not_official',
] as const;

export type BrazilReceitaFullJoinBridgeRejection =
  (typeof BRAZIL_RECEITA_FULL_JOIN_BRIDGE_REJECTIONS)[number];

/**
 * One refusal. Carries the REASON and, when it is known, the family — never the path that caused it.
 *
 * The family is safe to report: it is one of six closed enum members and reveals nothing about the
 * operator's filesystem. The path is not, which is why there is no field for it.
 */
export interface BrazilReceitaFullJoinBridgeFinding {
  readonly rejection: BrazilReceitaFullJoinBridgeRejection;
  readonly family: string | null;
}

// ─── Ports ────────────────────────────────────────────────────────────────────

/**
 * The filesystem operations the bridge needs. Deliberately four, and deliberately none that reads a
 * DATA file: there is no `open`, no `read` and no `size`, so this module cannot touch a row even by
 * mistake.
 */
export interface BrazilReceitaFullJoinBridgeFileSystem {
  /** Reads the manifest DOCUMENT — a small JSON file, never a data file. */
  readManifestDocument(manifestPath: string): string;
  isSymbolicLink(targetPath: string): boolean;
  realPath(targetPath: string): string;
  isRegularFile(targetPath: string): boolean;
}

/** The official validator, injected. See the module header for why it is not imported. */
export type BrazilReceitaFullJoinBridgeManifestValidator = (options: {
  manifestPath: string;
  allowRealLocalFiles: boolean;
}) => Promise<BrReceitaCnpjManifestValidationResult>;

// ─── Request & outcome ────────────────────────────────────────────────────────

export interface BrazilReceitaFullJoinBridgeRequest {
  readonly manifestPath: string;
  readonly fileSystem: BrazilReceitaFullJoinBridgeFileSystem;
  readonly validateManifest: BrazilReceitaFullJoinBridgeManifestValidator;
  /**
   * Whether the validator may stat, hash and header-read the described files.
   *
   * `false` validates manifest STRUCTURE only. The real benchmark sets it to `true` — the point of
   * the preflight is to confirm the files are the ones the manifest claims before a six-hour run
   * starts — and every test in this milestone leaves it `false` or points it at a synthetic fixture.
   */
  readonly allowRealLocalFiles: boolean;
}

/** A lookup family, resolved but NOT shaped as an engine descriptor. */
export interface BrazilReceitaFullJoinLookupSource {
  readonly family: string;
  readonly filePath: string;
  readonly encoding: 'latin1' | 'utf8';
}

export interface BrazilReceitaFullJoinBridgeResolution {
  readonly ok: true;
  readonly joinSources: readonly BrazilReceitaFullJoinSourceFileDescriptor[];
  readonly lookupSources: readonly BrazilReceitaFullJoinLookupSource[];
  readonly sourceYear: number;
  readonly sourcePeriod: string;
  /** Held-absence assertions, so a consumer can check them rather than trust this comment. */
  readonly rowsRead: 0;
  readonly dataFilesOpened: 0;
}

export interface BrazilReceitaFullJoinBridgeRefusal {
  readonly ok: false;
  readonly findings: readonly BrazilReceitaFullJoinBridgeFinding[];
}

export type BrazilReceitaFullJoinBridgeOutcome =
  | BrazilReceitaFullJoinBridgeResolution
  | BrazilReceitaFullJoinBridgeRefusal;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True when `candidate` is `parent` or lives beneath it. Path-only; touches no filesystem. */
function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative === '') return true;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function refuse(
  rejection: BrazilReceitaFullJoinBridgeRejection,
  family: string | null = null,
): BrazilReceitaFullJoinBridgeFinding {
  return { rejection, family };
}

// ─── Per-entry resolution ─────────────────────────────────────────────────────

interface ManifestEntry {
  readonly family: string;
  readonly declaredPath: string;
  readonly encoding: string;
  readonly delimiter: string;
  readonly layoutMode: string;
}

/**
 * Resolves ONE manifest entry's path and returns it, or every reason it was refused.
 *
 * All reasons, not the first: an operator whose manifest points at a symlinked archive should learn
 * both facts in one refusal rather than fixing one and being refused again. The exception is the
 * checks that cannot proceed — an unresolvable path stops the rest, because everything below would
 * be answering a question about a path that does not exist.
 */
function resolveEntryPath(
  entry: ManifestEntry,
  manifestDirectory: string,
  fileSystem: BrazilReceitaFullJoinBridgeFileSystem,
  requireRealFile: boolean,
):
  | { readonly ok: true; readonly filePath: string }
  | { readonly ok: false; readonly findings: readonly BrazilReceitaFullJoinBridgeFinding[] } {
  const findings: BrazilReceitaFullJoinBridgeFinding[] = [];
  const { family, declaredPath } = entry;

  if (typeof declaredPath !== 'string' || declaredPath.trim().length === 0) {
    return { ok: false, findings: [refuse('manifest_declaration_missing', family)] };
  }
  if (path.isAbsolute(declaredPath)) {
    return { ok: false, findings: [refuse('path_absolute_not_allowed', family)] };
  }
  // Refused rather than normalized: normalizing a traversal silently accepts a destination the
  // manifest author did not name.
  if (declaredPath.split(/[/\\]/).includes('..')) {
    return { ok: false, findings: [refuse('path_traversal_blocked', family)] };
  }

  const extension = path.extname(declaredPath).toLowerCase();
  if (BRAZIL_RECEITA_FULL_JOIN_BRIDGE_ARCHIVE_EXTENSIONS.includes(extension)) {
    findings.push(refuse('archive_not_allowed', family));
  } else if (!BRAZIL_RECEITA_FULL_JOIN_BRIDGE_ALLOWED_EXTENSIONS.includes(extension)) {
    findings.push(refuse('unsupported_extension', family));
  }

  const resolved = path.resolve(manifestDirectory, declaredPath);
  if (!isInside(resolved, manifestDirectory)) {
    findings.push(refuse('path_escapes_manifest_root', family));
  }

  if (!requireRealFile) {
    // Structure-only mode: the entry is never touched, so the three filesystem checks below have no
    // answer. Returning here rather than defaulting them to "passed" keeps the modes honest.
    if (findings.length > 0) return { ok: false, findings };
    return { ok: true, filePath: resolved };
  }

  let symbolic: boolean;
  try {
    symbolic = fileSystem.isSymbolicLink(resolved);
  } catch {
    return { ok: false, findings: [...findings, refuse('path_realpath_unavailable', family)] };
  }
  if (symbolic) findings.push(refuse('path_is_symlink', family));

  let realPath: string;
  try {
    realPath = fileSystem.realPath(resolved);
  } catch {
    return { ok: false, findings: [...findings, refuse('path_realpath_unavailable', family)] };
  }
  // Re-checked against the root AFTER resolution, so a link planted one directory up cannot redirect
  // a descriptor out of the manifest's tree while the declared string still looks clean.
  if (!isInside(realPath, manifestDirectory)) {
    findings.push(refuse('path_realpath_escapes_root', family));
  }

  let regular: boolean;
  try {
    regular = fileSystem.isRegularFile(resolved);
  } catch {
    return { ok: false, findings: [...findings, refuse('path_not_a_regular_file', family)] };
  }
  if (!regular) findings.push(refuse('path_not_a_regular_file', family));

  if (findings.length > 0) return { ok: false, findings };
  return { ok: true, filePath: resolved };
}

// ─── Bridge ───────────────────────────────────────────────────────────────────

/**
 * Turns a validated manifest into engine source descriptors, or refuses.
 *
 * The ORDER is a safety property: the official validator runs FIRST, so a manifest that is not a
 * Receita manifest at all — wrong mode, wrong source key, a missing required family, a forbidden
 * file name, a failed header check — is refused before this module resolves a single path. Resolving
 * paths from a document that has not been established as a manifest is how a JSON file full of
 * arbitrary paths becomes a list of files to open.
 */
export async function resolveBrazilReceitaFullJoinManifestSources(
  request: BrazilReceitaFullJoinBridgeRequest,
): Promise<BrazilReceitaFullJoinBridgeOutcome> {
  const { fileSystem } = request;

  if (typeof request.manifestPath !== 'string' || !path.isAbsolute(request.manifestPath)) {
    return { ok: false, findings: [refuse('manifest_path_not_absolute')] };
  }

  const validation = await request.validateManifest({
    manifestPath: request.manifestPath,
    allowRealLocalFiles: request.allowRealLocalFiles,
  });
  if (!validation.ok) {
    return { ok: false, findings: [refuse('manifest_validation_failed')] };
  }

  let raw: string;
  try {
    raw = fileSystem.readManifestDocument(request.manifestPath);
  } catch {
    return { ok: false, findings: [refuse('manifest_unreadable')] };
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return { ok: false, findings: [refuse('manifest_not_json')] };
  }
  if (!isRecord(document) || !Array.isArray(document.files)) {
    return { ok: false, findings: [refuse('manifest_not_json')] };
  }

  const manifestDirectory = path.dirname(request.manifestPath);
  const manifestLayoutMode =
    typeof document.layoutMode === 'string' ? document.layoutMode : undefined;

  const findings: BrazilReceitaFullJoinBridgeFinding[] = [];
  const joinSources: BrazilReceitaFullJoinSourceFileDescriptor[] = [];
  const lookupSources: BrazilReceitaFullJoinLookupSource[] = [];
  const seenFamilies = new Set<string>();

  for (const rawEntry of document.files) {
    if (!isRecord(rawEntry) || typeof rawEntry.fileType !== 'string') {
      findings.push(refuse('manifest_declaration_missing'));
      continue;
    }
    const family = rawEntry.fileType;

    const isJoinFamily = (
      BRAZIL_RECEITA_FULL_JOIN_BRIDGE_JOIN_FAMILIES as readonly string[]
    ).includes(family);
    const isLookupFamily = BRAZIL_RECEITA_FULL_JOIN_BRIDGE_LOOKUP_FAMILIES.includes(family);
    if (!isJoinFamily && !isLookupFamily) {
      // `socios`, `qsa`, `simples`-adjacent personal-data families and anything invented land here.
      findings.push(refuse('family_not_authorized', family));
      continue;
    }
    if (seenFamilies.has(family)) {
      // A second entry for one family would give the engine two descriptors for the same role, and
      // the second would silently win or silently double the traversal depending on the consumer.
      findings.push(refuse('family_duplicated', family));
      continue;
    }
    seenFamilies.add(family);

    const entry: ManifestEntry = {
      family,
      declaredPath: typeof rawEntry.path === 'string' ? rawEntry.path : '',
      encoding: typeof rawEntry.encoding === 'string' ? rawEntry.encoding : '',
      delimiter: typeof rawEntry.delimiter === 'string' ? rawEntry.delimiter : '',
      layoutMode:
        typeof rawEntry.layoutMode === 'string' ? rawEntry.layoutMode : (manifestLayoutMode ?? ''),
    };

    // Declarations are checked for BOTH roles: a lookup family read with the wrong delimiter is as
    // wrong as a join family read with the wrong delimiter, and this is the only place either is
    // checked against the official values rather than defaulted.
    if (entry.encoding !== BRAZIL_RECEITA_FULL_JOIN_BRIDGE_REQUIRED_ENCODING) {
      findings.push(refuse('encoding_not_official', family));
    }
    if (entry.delimiter !== BRAZIL_RECEITA_FULL_JOIN_BRIDGE_REQUIRED_DELIMITER) {
      findings.push(refuse('delimiter_not_official', family));
    }
    if (entry.layoutMode !== BRAZIL_RECEITA_FULL_JOIN_BRIDGE_REQUIRED_LAYOUT_MODE) {
      findings.push(refuse('layout_mode_not_official', family));
    }

    const resolved = resolveEntryPath(
      entry,
      manifestDirectory,
      fileSystem,
      request.allowRealLocalFiles,
    );
    if (!resolved.ok) {
      findings.push(...resolved.findings);
      continue;
    }

    if (isJoinFamily) {
      joinSources.push({
        filePath: resolved.filePath,
        family: family as BrazilReceitaFullJoinPartitionedFamily,
        // The ordinal is the descriptor's position in the JOIN list, assigned here and carried into
        // every reference record. A technical index, never a name.
        sourceFileOrdinal: joinSources.length,
        encoding: BRAZIL_RECEITA_FULL_JOIN_BRIDGE_REQUIRED_ENCODING,
      });
    } else {
      lookupSources.push({
        family,
        filePath: resolved.filePath,
        encoding: BRAZIL_RECEITA_FULL_JOIN_BRIDGE_REQUIRED_ENCODING,
      });
    }
  }

  for (const required of BRAZIL_RECEITA_FULL_JOIN_BRIDGE_JOIN_FAMILIES) {
    if (!joinSources.some((source) => source.family === required)) {
      findings.push(refuse('required_family_missing', required));
    }
  }

  if (findings.length > 0) return { ok: false, findings };

  return {
    ok: true,
    joinSources,
    lookupSources,
    sourceYear: validation.sourceYear,
    sourcePeriod: validation.sourcePeriod,
    rowsRead: 0,
    dataFilesOpened: 0,
  };
}
