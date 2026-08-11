/**
 * BR Receita CNPJ — NATIONAL INVENTORY RESOLUTION for 2026-07 (BR-SOURCE-14B.0K § 7–§ 13, § 17).
 *
 * The publisher side is now known (14B.0K's inventory artifact). This module answers the question the
 * owner actually asked: does the LOCAL 2026-07 file set constitute the national collection, or is it the
 * calibration subset attempt #1 already consumed six hours on?
 *
 * It is a pure comparison over FILESYSTEM METADATA the caller already holds — names, regular-file flags,
 * symlink flags, sizes. There is no `node:fs` import here and no port through which one could arrive, so
 * § 16's `REAL_DATA_ROWS_OPENED = 0` / `REAL_SOURCE_READ_CALLS = 0` are properties of this file rather
 * than promises about it. Directory metadata is gathered by the dedicated adapter
 * (`br-receita-cnpj-14b0k-local-inventory-fs`), which lists and lstats and cannot open.
 *
 * ── Identity comparison, not counting (§ 9, § 14) ────────────────────────────────
 * The comparison is set difference over PART IDENTITIES, so the answer is "Empresas 1–9 are absent", not
 * "one of ten present". A count-only gate would report the same shortfall for a set holding part 0 ten
 * times, and would leave an owner acquiring the wrong files.
 *
 * ── Two scopes, and the security condition lives in only one of them (§ 10) ──────
 * `inputEntries` are the files that CONSTITUTE the pipeline input. `archiveEntries` are files merely
 * staged on disk. The distinction is the milestone's sharpest point: a `Socios*` archive sitting in a
 * download directory is `prohibitedFamilyPresentOnDisk` and does NOT fail the dataset, while the same
 * family reaching the input is `prohibitedFamilyIncludedInInput` and is a hard reject regardless of how
 * complete everything else looks. Collapsing the two would either delete an owner's files or wave through
 * a person-linked join.
 *
 * ── An unavailable publisher can never become a verdict (§ 12) ───────────────────
 * With no verified listing, `missing*` and `extra*` are `null` — not `[]`. An empty array reads as
 * "nothing missing" and would let `indeterminate` be mistaken for `complete` by any caller that checked
 * lengths instead of statuses.
 *
 * ── The 14B.0J gate remains the authority on the verdict ─────────────────────────
 * This module does not replace `evaluateBrazilReceitaNationalInputCompleteness`; it FEEDS it, then takes
 * the more restrictive of the two verdicts. Agreement is the normal case, and the combination exists so
 * that a future edit to either side cannot quietly widen the other.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - opens, reads, stats, lists, downloads, extracts, copies, moves, renames, chmods or deletes anything.
 *   - emits a path, a directory, a CNPJ, a CPF, a name or a join key. It emits family labels and opaque
 *     part keys, and its `fileName` inputs are consumed for classification and never re-exported.
 *   - authorizes attempt #2, mutates the attempt ledger, or changes a cap, the engine, the reader, the
 *     parser, the partitioner, the FD pool or the benchmark instrumentation (§ 18).
 *   - touches Supabase, a migration, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

import {
  BRAZIL_RECEITA_PUBLISHER_LOOKUP_FAMILIES,
  BRAZIL_RECEITA_PUBLISHER_REQUIRED_FAMILIES,
  BRAZIL_RECEITA_PUBLISHER_SINGLETON_PART_KEY,
  deriveBrazilReceitaExpectedPartKeys,
  deriveBrazilReceitaNationalExpectedInventory,
  isBrazilReceitaPersonLinkedFamily,
  parseBrazilReceitaPublisherInventory,
  type BrazilReceitaPublisherInventoryDocument,
  type BrazilReceitaPublisherInventoryParseResult,
  type BrazilReceitaPublisherInventoryStatus,
} from './br-receita-cnpj-14b0k-publisher-inventory';
import { BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY } from './br-receita-cnpj-manifest';
import {
  BRAZIL_RECEITA_NATIONAL_EXPECTED_DELIMITER,
  BRAZIL_RECEITA_NATIONAL_EXPECTED_ENCODING,
  BRAZIL_RECEITA_NATIONAL_EXPECTED_LAYOUT_MODE,
  BRAZIL_RECEITA_NATIONAL_REQUIRED_ATTEMPT_2_INPUT_SCOPE,
  evaluateBrazilReceitaNationalInputCompleteness,
  type BrazilReceitaNationalInputCompletenessResult,
  type BrazilReceitaNationalInputCompletenessVerdict,
} from './br-receita-cnpj-national-input-completeness';
import {
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
  BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
  brazilReceitaNextRealAttemptNumber,
} from './br-receita-cnpj-real-benchmark-attempt-ledger';

// ─── Local metadata inputs ────────────────────────────────────────────────────

/**
 * One directory entry, as filesystem METADATA only.
 *
 * Everything here is available from `readdir` + `lstat`. There is no content field, and there is nowhere
 * for one to go: a resolution that needed a row would have to change this interface first.
 */
export interface BrazilReceitaLocalInventoryEntry {
  /** The entry's basename. Consumed for classification; never re-emitted in a finding. */
  readonly name: string;
  readonly isRegularFile: boolean;
  readonly isSymbolicLink: boolean;
  readonly sizeBytes: number;
}

/** The declared shape of the local input, from the manifest read as a CONTROL document. */
export interface BrazilReceitaLocalInputDeclaration {
  readonly sourceKey: unknown;
  readonly period: unknown;
  readonly encoding: unknown;
  readonly delimiter: unknown;
  readonly layoutMode: unknown;
}

/**
 * Extensions a local Receita part may carry: a staged archive (`.zip`) or a prepared input file
 * (`.csv` / `.txt`). Anything else is not a data file and is counted as ignored, not as a defect.
 */
const LOCAL_ENTRY_PATTERN = /^([A-Za-z][A-Za-z_-]*?)(\d*)\.(zip|csv|txt)$/i;

/** Why a classified local part is unusable as input. Metadata-level defects only. */
export const BRAZIL_RECEITA_LOCAL_PART_DEFECTS = [
  'local_part_not_regular_file',
  'local_part_symlink',
  'local_part_zero_size',
  'local_part_duplicate',
] as const;

export type BrazilReceitaLocalPartDefect = (typeof BRAZIL_RECEITA_LOCAL_PART_DEFECTS)[number];

export interface BrazilReceitaLocalPartFinding {
  readonly code: BrazilReceitaLocalPartDefect;
  readonly family: string;
  readonly partKey: string;
}

export interface BrazilReceitaLocalFamilyScan {
  readonly family: string;
  readonly partKeys: readonly string[];
}

export interface BrazilReceitaLocalInventoryScan {
  readonly families: readonly BrazilReceitaLocalFamilyScan[];
  readonly findings: readonly BrazilReceitaLocalPartFinding[];
  /** Entries that are not Receita data files at all — dotfiles, notes, reports (§ 9 test 14). */
  readonly ignoredEntryCount: number;
  /** Classified families outside the pipeline contract, e.g. the publisher's `motivos` lookup. */
  readonly outOfContractFamilies: readonly string[];
  readonly personLinkedFamilies: readonly string[];
}

/**
 * Groups directory metadata into families and opaque part keys, and records metadata-level defects.
 *
 * An unrecognized entry is COUNTED and ignored rather than treated as a defect: a `.DS_Store` or a
 * report file next to the data does not make a national dataset incomplete, and a resolution that said
 * otherwise would be unusable against any real staging directory.
 */
export function classifyBrazilReceitaLocalInventory(
  entries: readonly BrazilReceitaLocalInventoryEntry[],
): BrazilReceitaLocalInventoryScan {
  const findings: BrazilReceitaLocalPartFinding[] = [];
  const grouped = new Map<string, Set<string>>();
  let ignoredEntryCount = 0;

  for (const entry of entries) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    const match = name === '' ? null : LOCAL_ENTRY_PATTERN.exec(name);
    if (match === null) {
      ignoredEntryCount += 1;
      continue;
    }
    const family = match[1].toLowerCase();
    const partKey =
      match[2] === '' ? BRAZIL_RECEITA_PUBLISHER_SINGLETON_PART_KEY : match[2];

    const seen = grouped.get(family) ?? new Set<string>();
    if (seen.has(partKey)) findings.push({ code: 'local_part_duplicate', family, partKey });
    else seen.add(partKey);
    grouped.set(family, seen);

    if (entry.isSymbolicLink) findings.push({ code: 'local_part_symlink', family, partKey });
    else if (!entry.isRegularFile) findings.push({ code: 'local_part_not_regular_file', family, partKey });
    else if (!(typeof entry.sizeBytes === 'number' && entry.sizeBytes > 0)) {
      findings.push({ code: 'local_part_zero_size', family, partKey });
    }
  }

  const families = [...grouped.entries()]
    .map(([family, keys]) => ({ family, partKeys: [...keys].sort() }))
    .sort((left, right) => left.family.localeCompare(right.family));

  return {
    families,
    findings,
    ignoredEntryCount,
    outOfContractFamilies: families
      .map((entry) => entry.family)
      .filter(
        (family) =>
          !BRAZIL_RECEITA_PUBLISHER_REQUIRED_FAMILIES.includes(family) &&
          !BRAZIL_RECEITA_PUBLISHER_LOOKUP_FAMILIES.includes(family) &&
          !isBrazilReceitaPersonLinkedFamily(family),
      ),
    personLinkedFamilies: families
      .map((entry) => entry.family)
      .filter((family) => isBrazilReceitaPersonLinkedFamily(family)),
  };
}

// ─── Resolution ───────────────────────────────────────────────────────────────

export interface BrazilReceitaNationalInventoryResolutionRequest {
  readonly period: string;
  /** The transcribed publisher listing. `null` models an unavailable publisher (§ 6). */
  readonly publisherDocument: BrazilReceitaPublisherInventoryDocument | null;
  /**
   * The entries that CONSTITUTE the input. `null` when nothing was inspected — distinguished from `[]`,
   * which is an inspected-and-empty directory.
   */
  readonly inputEntries: readonly BrazilReceitaLocalInventoryEntry[] | null;
  /** Files merely staged on disk. Reported; never compared, never required, never deleted. */
  readonly archiveEntries?: readonly BrazilReceitaLocalInventoryEntry[] | null;
  /** The manifest's own declaration, needed by the 14B.0J gate's shape checks. */
  readonly inputDeclaration?: BrazilReceitaLocalInputDeclaration | null;
}

export interface BrazilReceitaFamilyPartDiff {
  readonly family: string;
  readonly expected: readonly string[];
  readonly local: readonly string[];
  readonly missing: readonly string[];
  readonly extra: readonly string[];
}

export interface BrazilReceitaNationalInventoryResolution {
  readonly period: string;
  readonly authoritativeInventoryStatus: BrazilReceitaPublisherInventoryStatus;
  readonly publisher: BrazilReceitaPublisherInventoryParseResult;
  /** `null` when the publisher is not authoritative — never `[]` (§ 12). */
  readonly requiredFamilyDiffs: readonly BrazilReceitaFamilyPartDiff[] | null;
  readonly lookupFamilyDiffs: readonly BrazilReceitaFamilyPartDiff[] | null;
  readonly duplicateParts: readonly BrazilReceitaLocalPartFinding[];
  readonly localPartDefects: readonly BrazilReceitaLocalPartFinding[];
  readonly unexpectedFamilies: readonly string[];
  readonly prohibitedFamilyPresentOnDisk: boolean;
  readonly prohibitedFamilyIncludedInInput: boolean;
  /** The 14B.0J gate's own result, computed from this resolution's derived inputs. */
  readonly gate: BrazilReceitaNationalInputCompletenessResult;
  readonly nationalInputCompleteness: BrazilReceitaNationalInputCompletenessVerdict;
  readonly attempt1InputScope: 'staged_subset';
  readonly attempt2RequiredInputScope: typeof BRAZIL_RECEITA_NATIONAL_REQUIRED_ATTEMPT_2_INPUT_SCOPE;
  /** `false`, always. Resolving an inventory is evidence, not authorization (§ 13). */
  readonly attempt2Authorized: false;
  readonly attempt2Executed: false;
  readonly attempt3Allowed: typeof BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED;
  readonly attemptsConsumed: typeof BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED;
  readonly structurallySupportedAttempts: typeof BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS;
  readonly nextRealAttemptNumber: number;
  /** Structural assertions (§ 16). No code path can change them. */
  readonly rowsRead: 0;
  readonly sourceReadCalls: 0;
  readonly scanExecuted: false;
  readonly joinExecuted: false;
  readonly secondRealBenchmarkExecuted: false;
}

function diffFamily(
  family: string,
  expected: readonly string[],
  local: readonly string[],
): BrazilReceitaFamilyPartDiff {
  const localSet = new Set(local);
  const expectedSet = new Set(expected);
  return {
    family,
    expected: [...expected].sort(),
    local: [...local].sort(),
    missing: expected.filter((key) => !localSet.has(key)).sort(),
    extra: local.filter((key) => !expectedSet.has(key)).sort(),
  };
}

/** The stricter of two verdicts. A definite defect outranks missing evidence, per 14B.0J's own ordering. */
function strictestVerdict(
  left: BrazilReceitaNationalInputCompletenessVerdict,
  right: BrazilReceitaNationalInputCompletenessVerdict,
): BrazilReceitaNationalInputCompletenessVerdict {
  if (left === 'incomplete' || right === 'incomplete') return 'incomplete';
  if (left === 'indeterminate' || right === 'indeterminate') return 'indeterminate';
  return 'complete';
}

/**
 * Resolves NATIONAL_INPUT_COMPLETENESS for a period.
 *
 * Order matters and is deliberate:
 *   1. The publisher is validated FIRST. Without a verified listing there is nothing legitimate to
 *      compare against, so the comparison is skipped entirely rather than run against a guess (§ 12).
 *   2. A person-linked family reaching the INPUT is decisive and outranks everything, including a
 *      complete part set (§ 10).
 *   3. Only then do part identities decide `complete` vs `incomplete`.
 *
 * The result is evidence for an owner decision. It never authorizes attempt #2 and never mutates a ledger.
 */
export function resolveBrazilReceitaNationalInventory(
  request: BrazilReceitaNationalInventoryResolutionRequest,
): BrazilReceitaNationalInventoryResolution {
  const publisher = parseBrazilReceitaPublisherInventory(request.publisherDocument, request.period);
  const authoritative = publisher.status === 'verified';

  const inputScan =
    request.inputEntries === null || request.inputEntries === undefined
      ? null
      : classifyBrazilReceitaLocalInventory(request.inputEntries);
  const archiveScan =
    request.archiveEntries === null || request.archiveEntries === undefined
      ? null
      : classifyBrazilReceitaLocalInventory(request.archiveEntries);

  const localPartKeys = (family: string): readonly string[] =>
    inputScan?.families.find((entry) => entry.family === family)?.partKeys ?? [];

  const requiredFamilyDiffs =
    authoritative && inputScan !== null
      ? BRAZIL_RECEITA_PUBLISHER_REQUIRED_FAMILIES.map((family) =>
          diffFamily(family, deriveBrazilReceitaExpectedPartKeys(publisher, family), localPartKeys(family)),
        )
      : null;

  const lookupFamilyDiffs =
    authoritative && inputScan !== null
      ? publisher.lookupFamilies
          .filter((family) => localPartKeys(family.family).length > 0)
          .map((family) =>
            diffFamily(
              family.family,
              deriveBrazilReceitaExpectedPartKeys(publisher, family.family),
              localPartKeys(family.family),
            ),
          )
      : null;

  const duplicateParts = (inputScan?.findings ?? []).filter(
    (finding) => finding.code === 'local_part_duplicate',
  );
  const localPartDefects = (inputScan?.findings ?? []).filter(
    (finding) => finding.code !== 'local_part_duplicate',
  );

  const prohibitedFamilyIncludedInInput = (inputScan?.personLinkedFamilies.length ?? 0) > 0;
  const prohibitedFamilyPresentOnDisk =
    prohibitedFamilyIncludedInInput || (archiveScan?.personLinkedFamilies.length ?? 0) > 0;

  // ── Feed the 14B.0J gate. Expected comes from the publisher derivation; observed is built from the
  //    local classification plus the manifest's declared shape. Both are metadata records.
  const declaration = request.inputDeclaration ?? null;
  const gate = evaluateBrazilReceitaNationalInputCompleteness({
    period: request.period,
    expected: deriveBrazilReceitaNationalExpectedInventory(publisher),
    observed:
      inputScan === null
        ? null
        : {
            sourceKey: declaration === null ? null : declaration.sourceKey,
            period: declaration === null ? null : declaration.period,
            encoding: declaration === null ? null : declaration.encoding,
            delimiter: declaration === null ? null : declaration.delimiter,
            layoutMode: declaration === null ? null : declaration.layoutMode,
            families: inputScan.families.map((family) => ({
              family: family.family,
              declaredPartKeys: family.partKeys,
            })),
            forbiddenFamilyCount: inputScan.personLinkedFamilies.length,
          },
  });

  // ── This module's own identity-level verdict.
  let identityVerdict: BrazilReceitaNationalInputCompletenessVerdict;
  if (prohibitedFamilyIncludedInInput) {
    identityVerdict = 'incomplete';
  } else if (!authoritative || inputScan === null || requiredFamilyDiffs === null) {
    identityVerdict = 'indeterminate';
  } else {
    const shortOrSubstituted =
      requiredFamilyDiffs.some((diff) => diff.missing.length > 0 || diff.extra.length > 0) ||
      (lookupFamilyDiffs ?? []).some((diff) => diff.extra.length > 0) ||
      duplicateParts.length > 0 ||
      localPartDefects.length > 0 ||
      inputScan.outOfContractFamilies.length > 0;
    identityVerdict = shortOrSubstituted ? 'incomplete' : 'complete';
  }

  return {
    period: request.period,
    authoritativeInventoryStatus: publisher.status,
    publisher,
    requiredFamilyDiffs,
    lookupFamilyDiffs,
    duplicateParts,
    localPartDefects,
    unexpectedFamilies: inputScan?.outOfContractFamilies ?? [],
    prohibitedFamilyPresentOnDisk,
    prohibitedFamilyIncludedInInput,
    gate,
    nationalInputCompleteness: strictestVerdict(identityVerdict, gate.verdict),
    attempt1InputScope: 'staged_subset',
    attempt2RequiredInputScope: BRAZIL_RECEITA_NATIONAL_REQUIRED_ATTEMPT_2_INPUT_SCOPE,
    attempt2Authorized: false,
    attempt2Executed: false,
    attempt3Allowed: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED,
    attemptsConsumed: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
    structurallySupportedAttempts: BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
    nextRealAttemptNumber: brazilReceitaNextRealAttemptNumber(),
    rowsRead: 0,
    sourceReadCalls: 0,
    scanExecuted: false,
    joinExecuted: false,
    secondRealBenchmarkExecuted: false,
  };
}

// ─── Next action (§ 11, § 12, § 13) ───────────────────────────────────────────

export const BRAZIL_RECEITA_NATIONAL_RESOLUTION_NEXT_ACTIONS = {
  complete: 'OWNER AUTHORIZATION — SECOND REAL FULL-NATIONAL BENCHMARK',
  incomplete: 'OWNER REVIEW — ACQUIRE ONLY MISSING 2026-07 PARTS',
  indeterminate: 'OWNER REVIEW — AUTHORITATIVE INVENTORY UNAVAILABLE',
} as const;

/**
 * The owner's next action, derived from the verdict.
 *
 * Never "run attempt #2": even a `complete` verdict routes to an AUTHORIZATION request, because the
 * input being right is a precondition for asking and not a substitute for being answered (§ 13).
 */
export function brazilReceitaNationalResolutionNextAction(
  resolution: BrazilReceitaNationalInventoryResolution,
): string {
  return BRAZIL_RECEITA_NATIONAL_RESOLUTION_NEXT_ACTIONS[resolution.nationalInputCompleteness];
}

/** The declared expected shape of a local input, for callers building a declaration to check. */
export const BRAZIL_RECEITA_LOCAL_INPUT_EXPECTED_DECLARATION: BrazilReceitaLocalInputDeclaration = {
  sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
  period: '2026-07',
  encoding: BRAZIL_RECEITA_NATIONAL_EXPECTED_ENCODING,
  delimiter: BRAZIL_RECEITA_NATIONAL_EXPECTED_DELIMITER,
  layoutMode: BRAZIL_RECEITA_NATIONAL_EXPECTED_LAYOUT_MODE,
};
