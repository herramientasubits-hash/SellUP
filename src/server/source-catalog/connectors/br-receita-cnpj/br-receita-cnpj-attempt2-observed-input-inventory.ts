/**
 * BR Receita CNPJ — ATTEMPT #2 OBSERVED INPUT INVENTORY, METADATA ONLY
 * (BR-SOURCE-ATTEMPT2-OPS § 6–§ 11).
 *
 * The second hard stop. BR-SOURCE-14B.0K landed the EXPECTED side (the Receita's own 2026-07 part
 * listing) and 14B.0K's resolution CLI compares it against a staging DIRECTORY, but the benchmark CLI —
 * the one an operator actually runs to spend attempt #2 — handed the completeness gate
 * `observed: null, expected: null` and therefore could only ever produce `indeterminate`. Flipping the
 * authorization would not have helped: the run would have died at `national_input_not_complete` with no
 * way for a correct dataset to say so.
 *
 * This module builds the OBSERVED side from the one artifact that defines what a given run will actually
 * traverse: the dataset/input MANIFEST selected for that invocation. Not a directory listing — a
 * directory can hold ten correct parts that the manifest never names, and it is the manifest the engine
 * reads from.
 *
 * ── Manifest-declared identity, not filename archaeology (§ 7, § 10) ────────────
 * A part's family is its declared `fileType` and its ordinal is its declared `partOrdinal`. Both come
 * from the manifest, so `Empresas_parte3_FINAL.csv` and `e3.csv` are the same part-3 declaration and an
 * operator's naming habits cannot make a complete dataset look incomplete — or an incomplete one look
 * whole. 14B.0K's directory-side classifier parses names because a download directory has nothing else;
 * a manifest does.
 *
 * ── Presence is metadata, and a part that is not there is not a part ────────────
 * Each declared entry is checked for presence, regular-file-ness and non-symlink-ness through an
 * injected port whose entire vocabulary is `readManifestDocument`, `isSymbolicLink` and `isRegularFile`.
 * An entry that fails any of the three is EXCLUDED from the observed part keys and recorded as a defect,
 * so the completeness gate sees the shortfall as a shortfall (`family_part_count_short`) rather than
 * being told a file exists because a manifest said so.
 *
 * ── No rows, no reader, no join, and no second completeness algorithm (§ 8, § 19) ─
 * There is no `node:fs` import here and the port has no `open`, no `read` and no `size`, so
 * `REAL_DATA_ROWS_OPENED = 0` and `REAL_SOURCE_READER_CALLS = 0` are properties of this file. And the
 * VERDICT is not computed here at all: this module produces the `observed` record and hands it to
 * `evaluateBrazilReceitaNationalInputCompleteness`, which is the gate 14B.0J built and 14B.0K fed. A
 * second algorithm would be a second answer to disagree with.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`, opens a data file, reads a row, or resolves a symlink target.
 *   - downloads, extracts, copies, moves, renames, chmods or deletes anything.
 *   - emits a path, a directory or a file name into a result. It emits family labels, opaque part keys
 *     and fixed codes; the paths it resolves are consumed by the port and never re-exported.
 *   - authorizes an attempt, mutates a ledger, or decides a completeness verdict.
 *   - touches Supabase, a migration, the runtime, Agent 1, a provider, HubSpot or the UI.
 */

import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_DEFAULT_INPUT_SCOPE,
  BR_RECEITA_CNPJ_DEFAULT_LAYOUT_MODE,
  BR_RECEITA_CNPJ_NATIONAL_PART_COUNT,
  BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
} from './br-receita-cnpj-manifest';
import type { BrazilReceitaNationalObservedInventory } from './br-receita-cnpj-national-input-completeness';
import { BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS } from './br-receita-cnpj-real-manifest-metadata-reader';

// ─── Port ─────────────────────────────────────────────────────────────────────

/**
 * The filesystem operations this module needs. Three, and none of them can reach a row.
 *
 * Structurally satisfied by `createBrazilReceitaFullJoinBridgeFileSystem()`, which the benchmark CLI
 * already builds — reusing it means the inventory is taken through the same size-capped, `lstat`-only
 * adapter the descriptor bridge is, rather than through a second one that would have to be audited
 * separately.
 */
export interface BrazilReceitaObservedInputInventoryFileSystem {
  /** Reads the manifest DOCUMENT — a small JSON control file, never a data file. */
  readManifestDocument(manifestPath: string): string;
  isSymbolicLink(absolutePath: string): boolean;
  isRegularFile(absolutePath: string): boolean;
}

// ─── Refusals & defects ───────────────────────────────────────────────────────

/**
 * Why an observed inventory could not be built AT ALL. Fixed codes; none embeds a path or a name.
 *
 * Distinct from a part DEFECT: a refusal means nothing was inspected, so the caller must pass
 * `observed: null` to the gate and receive `indeterminate`. A defect means the manifest was read and
 * something in it is wrong, which is a definite `incomplete`.
 */
export const BRAZIL_RECEITA_OBSERVED_INPUT_INVENTORY_REFUSALS = [
  'manifest_path_not_absolute',
  'manifest_unreadable',
  'manifest_not_json',
  'manifest_files_unusable',
] as const;

export type BrazilReceitaObservedInputInventoryRefusal =
  (typeof BRAZIL_RECEITA_OBSERVED_INPUT_INVENTORY_REFUSALS)[number];

/** Why one declared part is not an observed part. Metadata-level only. */
export const BRAZIL_RECEITA_OBSERVED_INPUT_PART_DEFECTS = [
  'declared_part_ordinal_invalid',
  'declared_path_unusable',
  'declared_part_absent',
  'declared_part_not_regular_file',
  'declared_part_symlink',
] as const;

export type BrazilReceitaObservedInputPartDefect =
  (typeof BRAZIL_RECEITA_OBSERVED_INPUT_PART_DEFECTS)[number];

/** One defect. Carries the family label and the opaque part key at most — never the path. */
export interface BrazilReceitaObservedInputPartFinding {
  readonly code: BrazilReceitaObservedInputPartDefect;
  readonly family: string | null;
  readonly partKey: string | null;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface BrazilReceitaObservedInputInventoryResult {
  /** `false` when the manifest could not be read or parsed. `observed` is then `null`. */
  readonly ok: boolean;
  readonly refusals: readonly BrazilReceitaObservedInputInventoryRefusal[];
  /**
   * The gate's `observed` record, or `null` when nothing was inspected.
   *
   * `null` rather than an empty record, for the reason 14B.0J's gate documents: "I have not looked" is
   * missing evidence and resolves to `indeterminate`, while an empty record would be read as "looked,
   * and every field is wrong".
   */
  readonly observed: BrazilReceitaNationalObservedInventory | null;
  readonly partFindings: readonly BrazilReceitaObservedInputPartFinding[];
  /** What the manifest says its files constitute. Reported as evidence; never a verdict. */
  readonly declaredInputScope: string | null;
  /**
   * Present, usable descriptors per required family — § 11's `EMPRESAS_DESCRIPTORS` /
   * `ESTABELECIMENTOS_DESCRIPTORS`. Counts the parts that SURVIVED the metadata checks, so a manifest
   * naming ten Empresas parts of which one is a symlink reports nine.
   */
  readonly requiredFamilyDescriptorCounts: Readonly<Record<string, number>>;
  /** The national part count a full 2026-07 family carries, restated so a report can show the target. */
  readonly nationalPartCount: typeof BR_RECEITA_CNPJ_NATIONAL_PART_COUNT;
  /** Structural assertions (§ 19). There is no code path that could change them. */
  readonly rowsRead: 0;
  readonly sourceReaderCalls: 0;
  readonly dataFilesOpened: 0;
}

export interface BrazilReceitaObservedInputInventoryRequest {
  /** The manifest selected for THIS invocation. Absolute; never discovered, never defaulted. */
  readonly manifestPath: string;
  readonly fileSystem: BrazilReceitaObservedInputInventoryFileSystem;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isForbiddenFamily(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS.some((token) =>
    normalized.includes(token),
  );
}

/**
 * Resolves a declared `partOrdinal` the way the descriptor bridge does.
 *
 * `undefined` means "the one and only part" — `0` — which is what every manifest before 14B.0M meant.
 * Anything else outside `[0, 10)` is refused rather than coerced: a coerced ordinal would let a
 * `partOrdinal: 11` quietly become a duplicate of part 1.
 */
function resolvePartOrdinal(value: unknown): number | null {
  if (value === undefined) return 0;
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < BR_RECEITA_CNPJ_NATIONAL_PART_COUNT
  ) {
    return value;
  }
  return null;
}

/** True when `candidate` is `parent` or lives beneath it. Path-only; touches no filesystem. */
function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative === '') return true;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

/**
 * The single value a set of per-entry declarations agrees on, or a sentinel that cannot match.
 *
 * A manifest whose files disagree about encoding has no single observed encoding, and answering with the
 * first one would let one conforming entry vouch for nine that do not. `'mixed'` is not an encoding, so
 * the gate reports `encoding_incompatible` — which is the truth.
 */
const MIXED_DECLARATION_SENTINEL = 'mixed' as const;

function collapseDeclarations(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const distinct = new Set(values);
  if (distinct.size === 1) return values[0];
  return MIXED_DECLARATION_SENTINEL;
}

// ─── The scan ─────────────────────────────────────────────────────────────────

function refused(
  refusals: readonly BrazilReceitaObservedInputInventoryRefusal[],
): BrazilReceitaObservedInputInventoryResult {
  return {
    ok: false,
    refusals,
    observed: null,
    partFindings: [],
    declaredInputScope: null,
    requiredFamilyDescriptorCounts: Object.freeze({}),
    nationalPartCount: BR_RECEITA_CNPJ_NATIONAL_PART_COUNT,
    rowsRead: 0,
    sourceReaderCalls: 0,
    dataFilesOpened: 0,
  };
}

/**
 * Builds the observed national inventory for ONE invocation's manifest, from metadata alone.
 *
 * Every declared entry is visited — no early return on the first defect — so an operator repairing a
 * manifest learns the whole gap in one pass, exactly as the gate and the publisher parser do.
 *
 * Duplicate part keys are DELIBERATELY not deduplicated. The gate detects `duplicate_part_declared` by
 * seeing the same key twice, and a manifest declaring part 0 ten times must not be able to present itself
 * as ten distinct parts by passing through a `Set` on the way here.
 */
export function buildBrazilReceitaObservedInputInventory(
  request: BrazilReceitaObservedInputInventoryRequest,
): BrazilReceitaObservedInputInventoryResult {
  const manifestPath = request.manifestPath;
  if (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath)) {
    return refused(['manifest_path_not_absolute']);
  }

  let raw: string;
  try {
    raw = request.fileSystem.readManifestDocument(manifestPath);
  } catch {
    // The underlying error is DISCARDED: its message quotes the path.
    return refused(['manifest_unreadable']);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refused(['manifest_not_json']);
  }
  if (!isRecord(parsed)) return refused(['manifest_not_json']);
  if (!Array.isArray(parsed.files)) return refused(['manifest_files_unusable']);

  const manifestDirectory = path.dirname(manifestPath);
  const manifestLayoutMode =
    typeof parsed.layoutMode === 'string' ? parsed.layoutMode : BR_RECEITA_CNPJ_DEFAULT_LAYOUT_MODE;

  const findings: BrazilReceitaObservedInputPartFinding[] = [];
  const partKeysByFamily = new Map<string, string[]>();
  const encodings: string[] = [];
  const delimiters: string[] = [];
  const layoutModes: string[] = [];
  let forbiddenFamilyCount = 0;

  for (const entry of parsed.files as readonly unknown[]) {
    const rawFamily = isRecord(entry) && typeof entry.fileType === 'string' ? entry.fileType : '';
    const family = rawFamily.trim().toLowerCase();

    // A person-linked family is COUNTED and never keyed, so no forbidden label can reach a report even
    // as a map key. The count is what makes the gate's `forbidden_person_linked_family` decisive.
    if (family !== '' && isForbiddenFamily(family)) {
      forbiddenFamilyCount += 1;
      continue;
    }

    const ordinal = resolvePartOrdinal(isRecord(entry) ? entry.partOrdinal : undefined);
    if (ordinal === null) {
      findings.push({ code: 'declared_part_ordinal_invalid', family: family || null, partKey: null });
      continue;
    }
    const partKey = String(ordinal);

    // The shape declarations, resolved exactly as the official validator resolves them: an omitted
    // encoding is `utf8` and an omitted delimiter is `,`, which the join path cannot read. Defaulting
    // them to the official pair here would vouch for a manifest that never declared it.
    const declaredEncoding =
      isRecord(entry) && entry.encoding === 'latin1' ? 'latin1' : 'utf8';
    const declaredDelimiter = isRecord(entry) && entry.delimiter === ';' ? ';' : ',';
    const declaredLayoutMode =
      isRecord(entry) && typeof entry.layoutMode === 'string' ? entry.layoutMode : manifestLayoutMode;
    encodings.push(declaredEncoding);
    delimiters.push(declaredDelimiter);
    layoutModes.push(declaredLayoutMode);

    const declaredPath = isRecord(entry) && typeof entry.path === 'string' ? entry.path.trim() : '';
    if (
      declaredPath === '' ||
      path.isAbsolute(declaredPath) ||
      declaredPath.split(/[/\\]/).includes('..')
    ) {
      findings.push({ code: 'declared_path_unusable', family: family || null, partKey });
      continue;
    }
    const resolved = path.resolve(manifestDirectory, declaredPath);
    if (!isInside(resolved, manifestDirectory)) {
      findings.push({ code: 'declared_path_unusable', family: family || null, partKey });
      continue;
    }

    // ── Presence, symlink, regular file. Three questions, one `lstat` each, no content.
    let symbolic: boolean;
    let regular: boolean;
    try {
      symbolic = request.fileSystem.isSymbolicLink(resolved);
      regular = request.fileSystem.isRegularFile(resolved);
    } catch {
      // The port throws for an entry that is not there. Absence is a defect, not an exception.
      findings.push({ code: 'declared_part_absent', family: family || null, partKey });
      continue;
    }
    if (symbolic) {
      findings.push({ code: 'declared_part_symlink', family: family || null, partKey });
      continue;
    }
    if (!regular) {
      findings.push({ code: 'declared_part_not_regular_file', family: family || null, partKey });
      continue;
    }

    // Only a present, regular, non-symlinked, well-addressed part becomes an observed part.
    const keys = partKeysByFamily.get(family) ?? [];
    keys.push(partKey);
    partKeysByFamily.set(family, keys);
  }

  const families = [...partKeysByFamily.entries()]
    .map(([family, partKeys]) => ({ family, declaredPartKeys: [...partKeys].sort() }))
    .sort((left, right) => left.family.localeCompare(right.family));

  const requiredFamilyDescriptorCounts: Record<string, number> = {};
  for (const required of BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES) {
    requiredFamilyDescriptorCounts[required] = partKeysByFamily.get(required)?.length ?? 0;
  }

  const observed: BrazilReceitaNationalObservedInventory = {
    sourceKey: parsed.sourceKey,
    period: parsed.sourcePeriod,
    encoding: collapseDeclarations(encodings),
    delimiter: collapseDeclarations(delimiters),
    layoutMode: collapseDeclarations(layoutModes),
    families,
    forbiddenFamilyCount,
  };

  return {
    ok: true,
    refusals: [],
    observed,
    partFindings: findings,
    declaredInputScope:
      typeof parsed.inputScope === 'string' ? parsed.inputScope : BR_RECEITA_CNPJ_DEFAULT_INPUT_SCOPE,
    requiredFamilyDescriptorCounts: Object.freeze(requiredFamilyDescriptorCounts),
    nationalPartCount: BR_RECEITA_CNPJ_NATIONAL_PART_COUNT,
    rowsRead: 0,
    sourceReaderCalls: 0,
    dataFilesOpened: 0,
  };
}
