/**
 * BR Receita CNPJ — SYNTHETIC TEMP MANIFEST workspace (BR-SOURCE-11C, Option B).
 *
 * The single module authorized to touch the filesystem for a `local_manifest_dry_run`.
 * It exists because the owner authorized exactly one thing:
 *
 *     AUTHORIZE OPTION B — SYNTHETIC TEMP-MANIFEST CARVE-OUT ONLY
 *
 * So this module never OPENS a manifest it was handed. It GENERATES one: it creates a
 * temp directory of its own under the OS temp root, writes a synthetic manifest and
 * synthetic headerless CSV files into it, reads only those files back under bounded
 * caps, and removes the directory it created. There is no parameter through which a
 * caller can point it at a real path — the workspace location is chosen here, never
 * supplied, which is what makes "real manifest execution is not authorized" a
 * structural property rather than a promise.
 *
 * ── Synthetic cells only ────────────────────────────────────────────────────────
 * Every generated cell is an OPAQUE label (`SYN_COMP_A`, `SYN_CNAE_A`). There is no
 * CNPJ, no CNPJ básico, no CPF, no digit run of identifier length, no name, no email,
 * no phone, no address, and no LinkedIn URL anywhere in the generated files — the
 * files exercise the official POSITIONAL column layout, and nothing else.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - reads, opens, stats, or lists a path it did not create itself.
 *   - accepts a caller-supplied path, directory, URL, or manifest document.
 *   - reads a real Receita file, a download directory, or an operator's dataset.
 *   - describes a SOCIOS / QSA / CPF family (a request for one fails closed).
 *   - reads more than the bounded per-file ceiling it was given.
 *   - returns a filesystem path, a filename, a raw line, or a cell to its caller.
 *   - deletes anything outside the temp workspace it created.
 *   - imports Supabase, Agent 1, a provider, HubSpot, or Slack; performs a write, a
 *     download, or a network call of any kind.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_FORBIDDEN_TOKENS,
  getBrReceitaCnpjOfficialColumnCount,
  validateBrReceitaCnpjHeaderlessFirstLine,
  type BrReceitaCnpjLayoutFileType,
} from './br-receita-cnpj-file-reader';
import {
  BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
  BR_RECEITA_CNPJ_MANIFEST_MODE,
  BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
} from './br-receita-cnpj-manifest';
import {
  BRAZIL_RECEITA_FULL_JOIN_LOCAL_MANIFEST_LAYOUT_MODE,
  BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST,
  type BrazilReceitaFullJoinLocalManifestReadRequest,
  type BrazilReceitaFullJoinLocalManifestScan,
  type BrazilReceitaFullJoinSyntheticCompanyRow,
  type BrazilReceitaFullJoinSyntheticEligibility,
  type BrazilReceitaFullJoinSyntheticEstablishmentRow,
} from './br-receita-cnpj-full-join-dry-run-runner';

// ─── Workspace constants ──────────────────────────────────────────────────────

/** Prefix of every temp directory this module creates — and the only one it removes. */
export const BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_DIR_PREFIX =
  'br-source-11c-synthetic-temp-manifest-' as const;

/** The manifest filename inside the workspace. Deliberately NOT the real dataset name. */
export const BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_FILE_NAME = 'synthetic-temp-manifest.json';

/** The families a synthetic workspace generates by default. */
export const BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_DEFAULT_FAMILIES: readonly BrReceitaCnpjLayoutFileType[] =
  ['empresas', 'estabelecimentos', 'cnaes', 'municipios', 'naturezas'];

/** The official files ship semicolon-delimited; the synthetic ones mirror that. */
const SYNTHETIC_DELIMITER = ';';

/** Filler cell used to pad a row out to its official positional width. */
const SYNTHETIC_PAD_CELL = 'SYN_PAD';

/** Synthetic year/period stamped on the generated manifest (no real snapshot exists). */
const SYNTHETIC_SOURCE_YEAR = 2026;
const SYNTHETIC_SOURCE_PERIOD = '2026-07';

// ─── Synthetic markers ────────────────────────────────────────────────────────

/**
 * Column 1 of a synthetic `empresas` row carries an eligibility MARKER rather than a
 * real legal-nature code. Classifying real Receita fields would require GATE-3 (field
 * allowlist), which is not approved — so the synthetic files state the outcome the
 * plumbing should produce, and the plumbing is what gets verified.
 */
const SYNTHETIC_ELIGIBILITY_MARKERS: Readonly<
  Record<string, BrazilReceitaFullJoinSyntheticEligibility>
> = {
  SYN_ELIG_IMPORT: 'eligible_for_future_import',
  SYN_ELIG_REVIEW: 'needs_legal_review',
  SYN_ELIG_PRIVACY: 'excluded_privacy_signal',
  SYN_ELIG_NATURE: 'excluded_legal_nature',
};

/** Column 1 of a synthetic `estabelecimentos` row: signal present, or explicitly not. */
const SYNTHETIC_PRIVACY_SIGNAL_MARKER = 'SYN_PRIVACY_SIGNAL';
const SYNTHETIC_NO_PRIVACY_SIGNAL_MARKER = 'SYN_NO_SIGNAL';

/** Opaque company refs. Never dataset-shaped, never numeric, never emitted in a report. */
const SYNTHETIC_COMPANY_REF_A = 'SYN_COMP_A';
const SYNTHETIC_COMPANY_REF_B = 'SYN_COMP_B';
const SYNTHETIC_COMPANY_REF_C = 'SYN_COMP_C';
const SYNTHETIC_COMPANY_REF_D = 'SYN_COMP_D';
/** A ref present only among establishments — models missing company context. */
const SYNTHETIC_COMPANY_REF_ABSENT = 'SYN_COMP_E_ABSENT';

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Base error. Messages carry fixed codes and labels only — never a path or a cell. */
export class BrazilReceitaSyntheticTempManifestError extends Error {
  constructor(message: string) {
    super(`BRSOURCE11C_SYNTHETIC_TEMP_MANIFEST: ${message}`);
    this.name = 'BrazilReceitaSyntheticTempManifestError';
  }
}

export class BrazilReceitaSyntheticTempManifestForbiddenFamilyError extends BrazilReceitaSyntheticTempManifestError {
  constructor(token: string) {
    super(
      `family request matches the forbidden personal-data token "${token}" — SOCIOS/QSA/CPF are never a valid family`,
    );
    this.name = 'BrazilReceitaSyntheticTempManifestForbiddenFamilyError';
  }
}

export class BrazilReceitaSyntheticTempManifestUnsafeCleanupError extends BrazilReceitaSyntheticTempManifestError {
  constructor() {
    super(
      'refusing to remove a directory outside the synthetic temp workspace this module created',
    );
    this.name = 'BrazilReceitaSyntheticTempManifestUnsafeCleanupError';
  }
}

// ─── Family validation ────────────────────────────────────────────────────────

/**
 * Fails closed on any family whose label carries a forbidden personal-data token, or
 * that is not a recognized layout family. Checked BEFORE the workspace is created, so
 * a forbidden request never results in a file on disk.
 */
function assertFamiliesAllowed(families: readonly string[]): void {
  for (const family of families) {
    const normalized = String(family).toLowerCase();
    for (const token of BR_RECEITA_CNPJ_FORBIDDEN_TOKENS) {
      if (normalized.includes(token)) {
        throw new BrazilReceitaSyntheticTempManifestForbiddenFamilyError(token);
      }
    }
    // `getBrReceitaCnpjOfficialColumnCount` is the layout authority: an unrecognized
    // family has no official column count and therefore cannot be generated.
    getBrReceitaCnpjOfficialColumnCount(family as BrReceitaCnpjLayoutFileType);
  }
}

// ─── Synthetic row generation ─────────────────────────────────────────────────

/** Builds one delimited line padded to the official positional width for the family. */
function syntheticLine(
  family: BrReceitaCnpjLayoutFileType,
  leadingCells: readonly string[],
): string {
  const width = getBrReceitaCnpjOfficialColumnCount(family);
  if (leadingCells.length > width) {
    throw new BrazilReceitaSyntheticTempManifestError(
      `synthetic row for "${family}" declares more cells than the official layout width`,
    );
  }
  const cells = [...leadingCells];
  while (cells.length < width) cells.push(SYNTHETIC_PAD_CELL);
  return cells.join(SYNTHETIC_DELIMITER);
}

/**
 * The synthetic company rows. One per eligibility outcome, so a read exercises every
 * scoring branch of the runner.
 */
const SYNTHETIC_EMPRESAS_CELLS: ReadonlyArray<readonly [string, string]> = [
  [SYNTHETIC_COMPANY_REF_A, 'SYN_ELIG_IMPORT'],
  [SYNTHETIC_COMPANY_REF_B, 'SYN_ELIG_REVIEW'],
  [SYNTHETIC_COMPANY_REF_C, 'SYN_ELIG_PRIVACY'],
  [SYNTHETIC_COMPANY_REF_D, 'SYN_ELIG_NATURE'],
];

/**
 * The synthetic establishment rows: one per company, one whose company is absent, one
 * with no ref at all, and one carrying its own privacy signal.
 */
const SYNTHETIC_ESTABELECIMENTOS_CELLS: ReadonlyArray<readonly [string, string]> = [
  [SYNTHETIC_COMPANY_REF_A, SYNTHETIC_NO_PRIVACY_SIGNAL_MARKER],
  [SYNTHETIC_COMPANY_REF_B, SYNTHETIC_NO_PRIVACY_SIGNAL_MARKER],
  [SYNTHETIC_COMPANY_REF_C, SYNTHETIC_NO_PRIVACY_SIGNAL_MARKER],
  [SYNTHETIC_COMPANY_REF_D, SYNTHETIC_NO_PRIVACY_SIGNAL_MARKER],
  [SYNTHETIC_COMPANY_REF_ABSENT, SYNTHETIC_NO_PRIVACY_SIGNAL_MARKER],
  ['', SYNTHETIC_NO_PRIVACY_SIGNAL_MARKER],
  [SYNTHETIC_COMPANY_REF_A, SYNTHETIC_PRIVACY_SIGNAL_MARKER],
];

/** Reference catalogs: opaque code + opaque label, nothing derived from real data. */
const SYNTHETIC_REFERENCE_CELLS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> =
  {
    cnaes: [['SYN_CNAE_A', 'SYN_CNAE_LABEL_A']],
    municipios: [['SYN_CITY_A', 'SYN_CITY_LABEL_A']],
    naturezas: [['SYN_NATURE_A', 'SYN_NATURE_LABEL_A']],
    simples: [['SYN_COMP_A', 'SYN_SIMPLES_LABEL_A']],
  };

function syntheticFamilyContent(family: BrReceitaCnpjLayoutFileType): string {
  const rows: string[] = [];
  if (family === 'empresas') {
    for (const cells of SYNTHETIC_EMPRESAS_CELLS) rows.push(syntheticLine(family, cells));
  } else if (family === 'estabelecimentos') {
    for (const cells of SYNTHETIC_ESTABELECIMENTOS_CELLS) rows.push(syntheticLine(family, cells));
  } else {
    for (const cells of SYNTHETIC_REFERENCE_CELLS[family] ?? []) {
      rows.push(syntheticLine(family, cells));
    }
  }
  // Headerless by construction: the FIRST line is a data row, exactly as the official
  // files ship. No header is ever written.
  return `${rows.join('\n')}\n`;
}

// ─── Workspace handle ─────────────────────────────────────────────────────────

export interface BrazilReceitaSyntheticTempManifestOptions {
  /** Families to generate. Defaults to the five-family set. Forbidden ones fail closed. */
  readonly families?: readonly string[];
  /**
   * Layout mode DECLARED by the generated manifest. Defaults to `official_headerless`.
   * Overridable so a test can prove the runner refuses any other declaration — the
   * generated files are always headerless whatever this says.
   */
  readonly declaredLayoutMode?: string;
  /**
   * Trust level DECLARED to the runner. Defaults to `synthetic_temp_manifest_only`.
   * Overridable so a test can prove the runner refuses a mis-declared trust level.
   */
  readonly declaredManifestTrust?: string;
}

/** Aggregate cleanup outcome. No path, no filename, counts only. */
export interface BrazilReceitaSyntheticTempManifestCleanupResult {
  readonly workspaceRemoved: boolean;
  readonly filesReleased: number;
}

export interface BrazilReceitaSyntheticTempManifestHandle {
  readonly manifestTrust: string;
  readonly declaredLayoutMode: string;
  readonly familiesDeclared: readonly string[];
  /** The reader port handed to the runner. Performs the ONE bounded read. */
  readonly read: (
    request: BrazilReceitaFullJoinLocalManifestReadRequest,
  ) => BrazilReceitaFullJoinLocalManifestScan;
  /** Removes the workspace this handle created. Idempotent. */
  readonly dispose: () => BrazilReceitaSyntheticTempManifestCleanupResult;
}

// ─── Bounded reading ──────────────────────────────────────────────────────────

interface BoundedRead {
  readonly text: string;
  /** True when the file on disk was LARGER than the ceiling: a fail-closed condition. */
  readonly exceededCeiling: boolean;
}

/**
 * Reads at most `maxBytes` bytes from a file the module created. Never reads the whole
 * file "just to check": the ceiling is applied to the read itself, so an oversized file
 * costs one stat and a bounded read, never an unbounded one.
 */
function readBounded(filePath: string, maxBytes: number): BoundedRead {
  const size = fs.statSync(filePath).size;
  const toRead = Math.min(size, maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(toRead);
    if (toRead > 0) fs.readSync(fd, buffer, 0, toRead, 0);
    return { text: buffer.toString('utf8'), exceededCeiling: size > maxBytes };
  } finally {
    fs.closeSync(fd);
  }
}

/** Splits a bounded read into non-empty lines. Never returns the raw text to a caller. */
function nonEmptyLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0);
}

/** The positional cells of one synthetic line. Local to this module, never returned. */
function cellsOf(line: string): string[] {
  return line.split(SYNTHETIC_DELIMITER);
}

// ─── Row derivation (synthetic markers → runner fixture shape) ────────────────

function deriveCompanyRows(
  lines: readonly string[],
  maxRows: number,
): BrazilReceitaFullJoinSyntheticCompanyRow[] {
  const rows: BrazilReceitaFullJoinSyntheticCompanyRow[] = [];
  for (const line of lines.slice(0, maxRows)) {
    const cells = cellsOf(line);
    const marker = cells[1] ?? '';
    const eligibility = SYNTHETIC_ELIGIBILITY_MARKERS[marker];
    if (eligibility === undefined) {
      throw new BrazilReceitaSyntheticTempManifestError(
        'a synthetic company row carries an unrecognized eligibility marker',
      );
    }
    rows.push({ companyRef: cells[0] ?? '', eligibility });
  }
  return rows;
}

function deriveEstablishmentRows(
  lines: readonly string[],
  maxRows: number,
): BrazilReceitaFullJoinSyntheticEstablishmentRow[] {
  const rows: BrazilReceitaFullJoinSyntheticEstablishmentRow[] = [];
  for (const line of lines.slice(0, maxRows)) {
    const cells = cellsOf(line);
    const marker = cells[1] ?? '';
    if (marker !== SYNTHETIC_PRIVACY_SIGNAL_MARKER && marker !== SYNTHETIC_NO_PRIVACY_SIGNAL_MARKER) {
      throw new BrazilReceitaSyntheticTempManifestError(
        'a synthetic establishment row carries an unrecognized privacy marker',
      );
    }
    const ref = cells[0] ?? '';
    rows.push({
      companyRef: ref === '' ? null : ref,
      privacySignal: marker === SYNTHETIC_PRIVACY_SIGNAL_MARKER,
    });
  }
  return rows;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * True only for a directory this module could have created: directly under the OS temp
 * root, with the module's own prefix. Everything else — a repo path, a home directory,
 * a download directory, a nested temp path — is out of bounds.
 */
export function isBrazilReceitaSyntheticTempWorkspace(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  const tempRoot = fs.realpathSync(os.tmpdir());
  const parent = path.dirname(resolved);
  const resolvedParent = fs.existsSync(parent) ? fs.realpathSync(parent) : parent;
  if (resolvedParent !== tempRoot) return false;
  return path.basename(resolved).startsWith(BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_DIR_PREFIX);
}

/**
 * Removes a synthetic temp workspace. Refuses ANY path that is not one this module
 * could have created — there is no force flag, and the offending path is never echoed.
 * Exported so the containment rule itself is directly testable.
 */
export function removeBrazilReceitaSyntheticTempWorkspace(
  directory: string,
): BrazilReceitaSyntheticTempManifestCleanupResult {
  if (!isBrazilReceitaSyntheticTempWorkspace(directory)) {
    throw new BrazilReceitaSyntheticTempManifestUnsafeCleanupError();
  }
  if (!fs.existsSync(directory)) return { workspaceRemoved: false, filesReleased: 0 };
  const filesReleased = fs.readdirSync(directory).length;
  fs.rmSync(directory, { recursive: true, force: false });
  return { workspaceRemoved: true, filesReleased };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Creates a synthetic temp-manifest workspace and returns a handle exposing a bounded
 * reader and a contained cleanup. The workspace path is chosen HERE (a fresh directory
 * under the OS temp root) and is never returned, so neither the caller nor the report
 * can learn it, and no caller can redirect this at a real location.
 *
 * The caller MUST call `dispose()` — ideally in a `finally` — so the workspace does not
 * outlive the run.
 */
export function createBrazilReceitaSyntheticTempManifest(
  options: BrazilReceitaSyntheticTempManifestOptions = {},
): BrazilReceitaSyntheticTempManifestHandle {
  const families = options.families ?? BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_DEFAULT_FAMILIES;
  assertFamiliesAllowed(families);

  const declaredLayoutMode =
    options.declaredLayoutMode ?? BRAZIL_RECEITA_FULL_JOIN_LOCAL_MANIFEST_LAYOUT_MODE;
  const manifestTrust =
    options.declaredManifestTrust ?? BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_TEMP_MANIFEST_TRUST;

  // The workspace root: chosen by this module, under the OS temp root, never supplied.
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_DIR_PREFIX),
  );

  const fileNames = new Map<string, string>();
  for (const family of families) {
    const fileName = `synthetic-${family}.csv`;
    fileNames.set(family, fileName);
    fs.writeFileSync(
      path.join(directory, fileName),
      syntheticFamilyContent(family as BrReceitaCnpjLayoutFileType),
      { encoding: 'utf8' },
    );
  }

  // A structurally complete manifest, describing ONLY the synthetic files just written.
  const manifest = {
    sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
    countryCode: BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
    sourceYear: SYNTHETIC_SOURCE_YEAR,
    sourcePeriod: SYNTHETIC_SOURCE_PERIOD,
    mode: BR_RECEITA_CNPJ_MANIFEST_MODE,
    layoutMode: declaredLayoutMode,
    synthetic: true,
    manifestTrust,
    files: families.map((family) => ({
      fileType: family,
      path: fileNames.get(family),
      delimiter: SYNTHETIC_DELIMITER,
      encoding: 'utf8',
      layoutMode: declaredLayoutMode,
    })),
  };
  fs.writeFileSync(
    path.join(directory, BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_FILE_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8' },
  );

  const read = (
    request: BrazilReceitaFullJoinLocalManifestReadRequest,
  ): BrazilReceitaFullJoinLocalManifestScan => {
    if (
      !Number.isInteger(request.maxBytesPerFile) ||
      request.maxBytesPerFile < 0 ||
      !Number.isInteger(request.maxCompanyScanRows) ||
      !Number.isInteger(request.maxEstablishmentRows)
    ) {
      throw new BrazilReceitaSyntheticTempManifestError('bounded caps must be non-negative integers');
    }

    // The manifest itself is read under the same ceiling as a data file.
    const manifestRead = readBounded(
      path.join(directory, BRAZIL_RECEITA_SYNTHETIC_TEMP_MANIFEST_FILE_NAME),
      request.maxBytesPerFile,
    );
    let exceededCeiling = manifestRead.exceededCeiling;
    let filesScanned = manifestRead.exceededCeiling ? 0 : 1;

    let companies: BrazilReceitaFullJoinSyntheticCompanyRow[] = [];
    let establishments: BrazilReceitaFullJoinSyntheticEstablishmentRow[] = [];

    for (const family of families) {
      const fileName = fileNames.get(family);
      if (fileName === undefined) continue;
      const fileRead = readBounded(path.join(directory, fileName), request.maxBytesPerFile);
      if (fileRead.exceededCeiling) {
        // Fail-closed signal for the runner: an oversized file is never partially scored.
        exceededCeiling = true;
        continue;
      }
      filesScanned += 1;

      const lines = nonEmptyLines(fileRead.text);
      // Layout authority: the FIRST line is a DATA row, validated by positional column
      // count against the official layout — never by header names.
      if (lines.length > 0) {
        validateBrReceitaCnpjHeaderlessFirstLine(
          family as BrReceitaCnpjLayoutFileType,
          lines[0]!,
          SYNTHETIC_DELIMITER,
          { fileLabel: family },
        );
      }
      if (family === 'empresas') {
        companies = deriveCompanyRows(lines, request.maxCompanyScanRows);
      } else if (family === 'estabelecimentos') {
        establishments = deriveEstablishmentRows(lines, request.maxEstablishmentRows);
      }
      // Reference families are layout-validated and counted, never mapped into rows:
      // they carry no join or eligibility signal in this carve-out.
    }

    return {
      manifestTrust,
      layoutMode: declaredLayoutMode,
      familiesScanned: [...families],
      filesScanned: exceededCeiling ? 0 : filesScanned,
      bytesCapApplied: true,
      bytesCapExceeded: exceededCeiling,
      fixture: { companies, establishments },
    };
  };

  const dispose = (): BrazilReceitaSyntheticTempManifestCleanupResult =>
    removeBrazilReceitaSyntheticTempWorkspace(directory);

  return {
    manifestTrust,
    declaredLayoutMode,
    familiesDeclared: [...families],
    read,
    dispose,
  };
}
