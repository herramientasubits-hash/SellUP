/**
 * BR Receita CNPJ — REAL MANIFEST METADATA-ONLY reader (BR-SOURCE-11D-META-IMPL).
 *
 * The second implementation of the full-join runner's reading port, and the ONLY module
 * authorized to open a real local manifest. It exists because the owner authorized
 * exactly one thing, after BR-SOURCE-11D-META-LAND was merged:
 *
 *     AUTHORIZE OPTION B — REAL MANIFEST METADATA-ONLY CARVE-OUT
 *
 * That phrase authorizes reading a manifest as a CONTROL DOCUMENT. It authorizes
 * nothing about the files the manifest describes. So this module resolves exactly ONE
 * path — the manifest — and has no code path that opens, stats, lists, or resolves a
 * second one. That is the load-bearing invariant of the whole carve-out
 * (decision record § 4.3 / § 7.1), and it is asserted by a static test, not by intent.
 *
 * ── What "metadata-only" means here ─────────────────────────────────────────────
 * The reader parses the manifest and derives SCHEMA-LEVEL facts only: whether a
 * schema version and a source period are present, how the layout mode classifies,
 * how many files are declared, which allowlisted FAMILY LABELS they fall under, how
 * many required families are missing, and how many forbidden (Sócios / QSA / CPF)
 * families are declared. Every one of those is a class label, an enum member, a count,
 * or a boolean.
 *
 * ── Refusal vs. throw ───────────────────────────────────────────────────────────
 * Two distinct failure surfaces, deliberately:
 *
 *   - A CONTRACT breach THROWS `BrazilReceitaRealManifestMetadataError`, whose message
 *     is a fixed code and nothing else: the carve-out was not declared, a cap was not
 *     stated or exceeds its ceiling, the path is refused, the document is not JSON, or
 *     raw-manifest output was requested.
 *
 *   - A MANIFEST-CONTENT refusal is REPORTED, not thrown: an oversized document, a
 *     forbidden family, a missing required family, or an unsupported layout mode come
 *     back on the scan as `refusalCode` alongside the aggregate metadata, so the runner
 *     can fail closed AND still emit the counts that explain why. Reporting a forbidden
 *     family as an aggregate count is permitted; skipping it and proceeding is not.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - opens, reads, stats, lists, globs, or resolves any file referenced by a manifest.
 *   - opens a CSV, a TXT, or a ZIP; reads a row; samples a cell; computes a join.
 *   - reads more than the stated manifest byte ceiling, or parses a truncated document.
 *   - returns or logs a filesystem path, an absolute path, a filename, the raw manifest
 *     document, a declared period value, a CNPJ, a CNPJ básico, a CPF, a name, an
 *     email, a phone, an address, a join key, or a hash of any of them.
 *   - reads an environment variable, constructs a client, downloads, imports, writes to
 *     Supabase, or touches runtime, Agent 1, a provider, HubSpot, or Slack.
 *   - approves a gate, or produces evidence about the real dataset. A green run says the
 *     operator's manifest is well-formed. It says nothing about coverage, join rates, or
 *     eligibility, and it is not citable as GATE-1 or GATE-2 evidence.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
  BR_RECEITA_CNPJ_MANIFEST_MODE,
} from './br-receita-cnpj-manifest';

// ─── Trust, layout and family vocabulary ──────────────────────────────────────

/**
 * The trust level this reader declares. Distinct from the synthetic temp-manifest
 * trust: the two carve-outs are separate authorizations and neither substitutes for
 * the other (decision record § 5.1).
 */
export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_TRUST = 'real_manifest_metadata_only' as const;

/** The only layout mode a metadata-only run accepts, per decision record § 8. */
export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE = 'official_headerless' as const;

/** How the declared layout mode classifies. Reported, then refused by the runner. */
export type BrazilReceitaRealManifestLayoutClassification =
  | typeof BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE
  | 'invalid_or_unsupported'
  | 'unknown';

/**
 * Family labels a declared file may be counted under. A family is a CLASS LABEL and is
 * reportable; a filename is operator-environment information and never is.
 */
export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_ALLOWED_FAMILIES: readonly string[] = [
  'empresas',
  'estabelecimentos',
  'simples',
  'cnaes',
  'municipios',
  'naturezas',
];

/** The bucket every unrecognized (but not forbidden) family label is counted under. */
export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_OTHER_FAMILY_KEY = 'other' as const;

/** Families that must be declared for a manifest to describe a usable file set. */
export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_REQUIRED_FAMILIES: readonly string[] = [
  ...BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
];

/**
 * Personal-data family tokens. A superset of the parser's denylist, deliberately
 * (decision record § 8): a metadata reader that sees any of these refuses before doing
 * anything else. These are denylist LABELS, recorded so a guard can refuse them.
 */
export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS: readonly string[] = [
  'socio',
  'qsa',
  'cpf',
  'pessoa',
  'person',
  'partner',
  'shareholder',
  'representante',
];

// ─── Caps ─────────────────────────────────────────────────────────────────────

/**
 * Hard ceilings from decision record § 8. Both caps are REQUIRED of the caller — a cap
 * the caller never stated is a cap nobody agreed to, so an omitted cap is a fail-closed
 * error rather than a defaulted one.
 */
export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES = 1_000_000 as const;
export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES = 20 as const;

/**
 * How much of the manifest was read, as a BUCKET rather than a byte figure. A size is a
 * (small) statement about the operator's document; a bucket is not.
 */
export type BrazilReceitaRealManifestBytesBucket = 'lte_1mb' | 'over_limit_blocked';

// ─── Path refusal denylists ───────────────────────────────────────────────────

/**
 * Directory names that indicate an operator's real downloaded / staged dataset. These
 * are denylist labels for a fail-closed guard, never usable locations: no real,
 * absolute, or complete path appears in this module.
 */
export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_PATH_SEGMENTS: readonly string[] = [
  'downloads',
  'download',
  'descargas',
  'dados_abertos',
  'dados-abertos',
  'sellup-source-data',
  'sellup_source_data',
  'raw-zips',
  'raw_zips',
  'extracted',
  'manifest-input',
  'manifest_input',
];

/**
 * Manifest FILENAMES that identify a real prepared Receita file set. They stay refused
 * under metadata-only: BR-SOURCE-11D-META-IMPL implements the code path and proves it
 * with synthetic metadata manifests, and executing an operator's real prepared file set
 * is a separate, explicitly-authorized step. Refused by name, whatever directory it
 * sits in.
 */
export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_BASENAMES: readonly string[] = [
  'manifest.headerless.json',
  'manifest.real.json',
];

/** The extension a manifest must carry. A CSV/TXT/ZIP is not a control document. */
const MANIFEST_EXTENSION = '.json';

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Why a metadata-only read was refused. Fixed machine codes; never a value or a path. */
export type BrazilReceitaRealManifestMetadataErrorCode =
  | 'manifest_metadata_not_authorized'
  | 'manifest_metadata_cap_required'
  | 'manifest_metadata_cap_exceeded'
  | 'manifest_json_invalid'
  | 'manifest_layout_unsupported'
  | 'manifest_forbidden_family_detected'
  | 'manifest_missing_required_family'
  | 'manifest_path_forbidden'
  | 'manifest_raw_output_forbidden';

export const BRAZIL_RECEITA_REAL_MANIFEST_METADATA_ERROR_CODES: readonly BrazilReceitaRealManifestMetadataErrorCode[] =
  [
    'manifest_metadata_not_authorized',
    'manifest_metadata_cap_required',
    'manifest_metadata_cap_exceeded',
    'manifest_json_invalid',
    'manifest_layout_unsupported',
    'manifest_forbidden_family_detected',
    'manifest_missing_required_family',
    'manifest_path_forbidden',
    'manifest_raw_output_forbidden',
  ];

/**
 * A contract breach. The message is the CODE and nothing else — a reader failure could
 * otherwise carry a path, a filename, or a fragment of the document.
 */
export class BrazilReceitaRealManifestMetadataError extends Error {
  readonly code: BrazilReceitaRealManifestMetadataErrorCode;

  constructor(code: BrazilReceitaRealManifestMetadataErrorCode) {
    super(`BRSOURCE11DMETA_REAL_MANIFEST_METADATA: ${code}`);
    this.name = 'BrazilReceitaRealManifestMetadataError';
    this.code = code;
  }
}

// ─── Scan contract ────────────────────────────────────────────────────────────

/**
 * What the reader returns: AGGREGATE metadata only. Deliberately no path, no filename,
 * no declared period value, no raw document, and no cell — so the runner can stay pure
 * and can never be handed content to leak.
 */
export interface BrazilReceitaRealManifestMetadataScan {
  readonly manifestTrust: typeof BRAZIL_RECEITA_REAL_MANIFEST_METADATA_TRUST;
  readonly layoutMode: BrazilReceitaRealManifestLayoutClassification;
  readonly schemaVersionPresent: boolean;
  /** Presence only. The period VALUE is operator-environment information. */
  readonly sourcePeriodPresent: boolean;
  readonly declaredFileCount: number;
  /** Keys are allowlisted family labels plus `other`. A forbidden label is never a key. */
  readonly declaredFamilyCounts: Readonly<Record<string, number>>;
  readonly requiredFamilyCount: number;
  readonly missingRequiredFamilyCount: number;
  readonly forbiddenFamilyCount: number;
  readonly manifestBytesReadBucket: BrazilReceitaRealManifestBytesBucket;
  /** Structural assertions. Always false: there is no code path that could set them. */
  readonly referencedDataFilesOpened: false;
  readonly referencedDataFilesStatted: false;
  /** A manifest-CONTENT refusal, reported rather than thrown. `null` when acceptable. */
  readonly refusalCode: BrazilReceitaRealManifestMetadataErrorCode | null;
}

/** What the reader is asked for. Both caps are passed IN and re-enforced at read time. */
export interface BrazilReceitaRealManifestMetadataReadRequest {
  readonly maxManifestBytes: number;
  readonly maxDeclaredFiles: number;
}

/** The injected port. Called at most ONCE per run. */
export type BrazilReceitaRealManifestMetadataReader = (
  request: BrazilReceitaRealManifestMetadataReadRequest,
) => BrazilReceitaRealManifestMetadataScan;

export interface BrazilReceitaRealManifestMetadataReaderOptions {
  /** The ONE local manifest path this reader may resolve. Never returned or logged. */
  readonly manifestPath: string;
  /** The owner's Option B phrase, as a declared boolean. Absent ⇒ the reader refuses. */
  readonly realManifestMetadataOnlyOptionBAuthorized?: boolean;
  readonly maxManifestBytes?: number;
  readonly maxDeclaredFiles?: number;
  /**
   * Present only so the refusal is structural: raw-manifest output is forbidden even
   * though the manifest is the input. Any truthy value fails closed.
   */
  readonly includeRawManifest?: boolean;
}

// ─── Path validation ──────────────────────────────────────────────────────────

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//');
}

/**
 * Refuses a manifest path that is a URL, is not a `.json` document, points into an
 * operator's dataset staging area, or names a real prepared file set. The offending
 * path is NEVER echoed — only the fixed refusal code survives.
 */
function assertManifestPathAllowed(manifestPath: unknown): string {
  if (typeof manifestPath !== 'string' || manifestPath.trim() === '') {
    throw new BrazilReceitaRealManifestMetadataError('manifest_path_forbidden');
  }
  if (looksLikeUrl(manifestPath)) {
    throw new BrazilReceitaRealManifestMetadataError('manifest_path_forbidden');
  }
  if (path.extname(manifestPath).toLowerCase() !== MANIFEST_EXTENSION) {
    throw new BrazilReceitaRealManifestMetadataError('manifest_path_forbidden');
  }
  const segments = manifestPath.toLowerCase().split(/[\\/]+/);
  for (const forbidden of BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_PATH_SEGMENTS) {
    if (segments.includes(forbidden)) {
      throw new BrazilReceitaRealManifestMetadataError('manifest_path_forbidden');
    }
  }
  const basename = path.basename(manifestPath).toLowerCase();
  if (BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_BASENAMES.includes(basename)) {
    throw new BrazilReceitaRealManifestMetadataError('manifest_path_forbidden');
  }
  return manifestPath;
}

// ─── Cap validation ───────────────────────────────────────────────────────────

/** True for a stated, non-negative, integral cap. An omitted cap is not a cap. */
function isStatedCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function assertCapsAllowed(request: BrazilReceitaRealManifestMetadataReadRequest): void {
  if (!isStatedCap(request.maxManifestBytes) || !isStatedCap(request.maxDeclaredFiles)) {
    throw new BrazilReceitaRealManifestMetadataError('manifest_metadata_cap_required');
  }
  if (
    request.maxManifestBytes > BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_MANIFEST_BYTES ||
    request.maxDeclaredFiles > BRAZIL_RECEITA_REAL_MANIFEST_METADATA_MAX_DECLARED_FILES
  ) {
    throw new BrazilReceitaRealManifestMetadataError('manifest_metadata_cap_exceeded');
  }
}

// ─── Bounded manifest read ────────────────────────────────────────────────────

interface BoundedManifestRead {
  readonly text: string;
  /** True when the document is LARGER than the ceiling: refused, never truncated. */
  readonly overLimit: boolean;
}

/**
 * Reads at most `maxManifestBytes` bytes from the ONE manifest path, then stops. It
 * requests one byte BEYOND the ceiling: if that byte exists the document is oversized
 * and is refused outright, because a truncated JSON document is not a smaller document
 * — it is a different one.
 *
 * No `stat` is involved anywhere. Asking the filesystem how large a file is would be a
 * fact about the operator's environment, and the ceiling is applied to the read itself.
 */
function readManifestBounded(manifestPath: string, maxManifestBytes: number): BoundedManifestRead {
  const fd = fs.openSync(manifestPath, 'r');
  try {
    const buffer = Buffer.alloc(maxManifestBytes + 1);
    const bytesRead = fs.readSync(fd, buffer, 0, maxManifestBytes + 1, 0);
    if (bytesRead > maxManifestBytes) return { text: '', overLimit: true };
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), overLimit: false };
  } finally {
    fs.closeSync(fd);
  }
}

// ─── Metadata derivation ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function classifyLayoutMode(declared: unknown): BrazilReceitaRealManifestLayoutClassification {
  if (declared === undefined || declared === null || declared === '') return 'unknown';
  if (declared === BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE) {
    return BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE;
  }
  return 'invalid_or_unsupported';
}

/** True when a family label carries a forbidden personal-data token. */
function isForbiddenFamily(label: string): boolean {
  const normalized = label.toLowerCase();
  return BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS.some((token) =>
    normalized.includes(token),
  );
}

interface FamilyTally {
  readonly counts: Record<string, number>;
  readonly forbiddenFamilyCount: number;
  readonly missingRequiredFamilyCount: number;
  readonly requiredFamilyCount: number;
}

/**
 * Counts declared entries into allowlisted family buckets. A forbidden family is counted
 * ONLY into `forbiddenFamilyCount`, never into a keyed bucket — so no forbidden label
 * can reach a report even as a key. Everything unrecognized lands in `other`.
 *
 * Only the `fileType` LABEL of each entry is read. The entry's declared path is never
 * touched, which is what keeps "resolves exactly one path" true by construction.
 */
function tallyFamilies(entries: readonly unknown[]): FamilyTally {
  const counts: Record<string, number> = {};
  for (const family of BRAZIL_RECEITA_REAL_MANIFEST_METADATA_ALLOWED_FAMILIES) counts[family] = 0;
  counts[BRAZIL_RECEITA_REAL_MANIFEST_METADATA_OTHER_FAMILY_KEY] = 0;

  let forbiddenFamilyCount = 0;
  const seenRequired = new Set<string>();

  for (const entry of entries) {
    const label = isRecord(entry) && typeof entry.fileType === 'string' ? entry.fileType : '';
    if (label !== '' && isForbiddenFamily(label)) {
      forbiddenFamilyCount += 1;
      continue;
    }
    if (BRAZIL_RECEITA_REAL_MANIFEST_METADATA_ALLOWED_FAMILIES.includes(label)) {
      counts[label] = (counts[label] ?? 0) + 1;
      if (BRAZIL_RECEITA_REAL_MANIFEST_METADATA_REQUIRED_FAMILIES.includes(label)) {
        seenRequired.add(label);
      }
      continue;
    }
    counts[BRAZIL_RECEITA_REAL_MANIFEST_METADATA_OTHER_FAMILY_KEY] += 1;
  }

  return {
    counts,
    forbiddenFamilyCount,
    requiredFamilyCount: seenRequired.size,
    missingRequiredFamilyCount:
      BRAZIL_RECEITA_REAL_MANIFEST_METADATA_REQUIRED_FAMILIES.length - seenRequired.size,
  };
}

/**
 * The scan returned when the document could not be inspected at all (oversized). Every
 * count is zero and the layout is `unknown`: no partial metadata survives a refusal.
 */
function blockedScan(
  refusalCode: BrazilReceitaRealManifestMetadataErrorCode,
  bucket: BrazilReceitaRealManifestBytesBucket,
): BrazilReceitaRealManifestMetadataScan {
  const counts: Record<string, number> = {};
  for (const family of BRAZIL_RECEITA_REAL_MANIFEST_METADATA_ALLOWED_FAMILIES) counts[family] = 0;
  counts[BRAZIL_RECEITA_REAL_MANIFEST_METADATA_OTHER_FAMILY_KEY] = 0;

  return {
    manifestTrust: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_TRUST,
    layoutMode: 'unknown',
    schemaVersionPresent: false,
    sourcePeriodPresent: false,
    declaredFileCount: 0,
    declaredFamilyCounts: counts,
    requiredFamilyCount: 0,
    missingRequiredFamilyCount: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_REQUIRED_FAMILIES.length,
    forbiddenFamilyCount: 0,
    manifestBytesReadBucket: bucket,
    referencedDataFilesOpened: false,
    referencedDataFilesStatted: false,
    refusalCode,
  };
}

/**
 * Picks the single refusal to report. Order is severity, not discovery: a forbidden
 * personal-data family outranks a missing required family, which outranks a layout mode
 * the carve-out does not recognize.
 */
function resolveRefusal(
  tally: FamilyTally,
  layoutMode: BrazilReceitaRealManifestLayoutClassification,
): BrazilReceitaRealManifestMetadataErrorCode | null {
  if (tally.forbiddenFamilyCount > 0) return 'manifest_forbidden_family_detected';
  if (tally.missingRequiredFamilyCount > 0) return 'manifest_missing_required_family';
  if (layoutMode !== BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE) {
    return 'manifest_layout_unsupported';
  }
  return null;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Builds the metadata-only reader port for ONE local manifest.
 *
 * The contract is validated EAGERLY, before any file descriptor exists: the carve-out
 * authorization, the raw-output refusal, and the path denylists are all checked here, so
 * an unauthorized or refused request never reaches the filesystem at all. The path is
 * captured in the closure and is never returned, logged, or reported.
 */
export function createBrazilReceitaRealManifestMetadataReader(
  options: BrazilReceitaRealManifestMetadataReaderOptions,
): BrazilReceitaRealManifestMetadataReader {
  if (options.realManifestMetadataOnlyOptionBAuthorized !== true) {
    throw new BrazilReceitaRealManifestMetadataError('manifest_metadata_not_authorized');
  }
  if (options.includeRawManifest) {
    throw new BrazilReceitaRealManifestMetadataError('manifest_raw_output_forbidden');
  }
  // Caps are validated at construction AND at read time: the reader enforces the same
  // bounds it was built with, so a request cannot widen them later.
  assertCapsAllowed({
    maxManifestBytes: options.maxManifestBytes as number,
    maxDeclaredFiles: options.maxDeclaredFiles as number,
  });
  const manifestPath = assertManifestPathAllowed(options.manifestPath);
  const builtCaps = {
    maxManifestBytes: options.maxManifestBytes as number,
    maxDeclaredFiles: options.maxDeclaredFiles as number,
  };

  return (request: BrazilReceitaRealManifestMetadataReadRequest) => {
    assertCapsAllowed(request);
    // A read may never ask for more than the reader was built with.
    if (
      request.maxManifestBytes > builtCaps.maxManifestBytes ||
      request.maxDeclaredFiles > builtCaps.maxDeclaredFiles
    ) {
      throw new BrazilReceitaRealManifestMetadataError('manifest_metadata_cap_exceeded');
    }

    // The ONE read of the run. No stat, no directory listing, no second descriptor.
    const bounded = readManifestBounded(manifestPath, request.maxManifestBytes);
    if (bounded.overLimit) {
      return blockedScan('manifest_metadata_cap_exceeded', 'over_limit_blocked');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bounded.text);
    } catch {
      // The underlying parse error is DISCARDED: its message quotes the document.
      throw new BrazilReceitaRealManifestMetadataError('manifest_json_invalid');
    }
    if (!isRecord(parsed)) {
      throw new BrazilReceitaRealManifestMetadataError('manifest_json_invalid');
    }

    const entries = Array.isArray(parsed.files) ? parsed.files : null;
    if (entries === null) {
      throw new BrazilReceitaRealManifestMetadataError('manifest_json_invalid');
    }
    // Bounds the parse loop BEFORE it runs: a malformed or hostile manifest cannot turn
    // a bounded walk into an unbounded one.
    if (entries.length > request.maxDeclaredFiles) {
      throw new BrazilReceitaRealManifestMetadataError('manifest_metadata_cap_exceeded');
    }

    const layoutMode = classifyLayoutMode(parsed.layoutMode);
    const tally = tallyFamilies(entries);

    return {
      manifestTrust: BRAZIL_RECEITA_REAL_MANIFEST_METADATA_TRUST,
      layoutMode,
      // Presence of a schema-level marker, never its value. `mode` is the manifest
      // layer's own schema discriminator (BR-SOURCE-6).
      schemaVersionPresent:
        isNonEmptyString(parsed.schemaVersion) ||
        parsed.mode === BR_RECEITA_CNPJ_MANIFEST_MODE ||
        typeof parsed.sourceYear === 'number',
      sourcePeriodPresent: isNonEmptyString(parsed.sourcePeriod),
      declaredFileCount: entries.length,
      declaredFamilyCounts: tally.counts,
      requiredFamilyCount: tally.requiredFamilyCount,
      missingRequiredFamilyCount: tally.missingRequiredFamilyCount,
      forbiddenFamilyCount: tally.forbiddenFamilyCount,
      manifestBytesReadBucket: 'lte_1mb',
      referencedDataFilesOpened: false,
      referencedDataFilesStatted: false,
      refusalCode: resolveRefusal(tally, layoutMode),
    };
  };
}
