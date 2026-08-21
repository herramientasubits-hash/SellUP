/**
 * BR Receita CNPJ — NATIONAL INPUT COMPLETENESS GATE (BR-SOURCE-14B.0J § 7, § 8).
 *
 * The owner's conditional approval turns on one question this module exists to answer: is the real
 * 2026-07 input a second run would traverse the NATIONAL collection, or is it the same calibration
 * subset attempt #1 used?
 *
 * It is not a rhetorical question. BR-SOURCE-14B.0G's own § 2 coverage caveat says its manifest held a
 * SINGLE part per join family, of a dataset the Receita publishes in roughly ten parts per family — so
 * its complete traversal covered on the order of one tenth of the national universe. A second six-hour
 * attempt over the same staged subset would consume the last structurally supported attempt and answer
 * a question nobody asked.
 *
 * ── The verdict this module refuses to fake ─────────────────────────────────────
 * `indeterminate` is never an edge case here. § 7 is explicit: if the caller does not hold enough
 * metadata to know whether a file set is the national whole, the answer is `indeterminate` and it is a
 * HARD STOP — "no declarar 'complete' por ausencia de evidencia".
 *
 * At 14B.0J that was also the STANDING answer: an audit of the whole connector, its scripts and its
 * decision records found NO authoritative statement of the expected 2026-07 part inventory, so this gate
 * returned `indeterminate` every time and named the gap. `roughly ten parts per family`, from a prose
 * caveat, was not a contract — it was an observation with a hedge in it, and a gate that turned it into
 * `expectedPartCount: 10` would have invented the very evidence § 7 forbids inventing.
 *
 * ── BR-SOURCE-14B.0K closed that gap, for one period ────────────────────────────
 * The expected inventory now exists as a versioned, publisher-derived artifact
 * (`br-receita-cnpj-14b0k-publisher-inventory`): the Receita's own 2026-07 listing, transcribed verbatim
 * with exact part identities, parsed fail-closed, and derived into this gate's `expected` input by
 * `deriveBrazilReceitaNationalExpectedInventory`. So
 * `BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN` is now `true` — for the periods listed in
 * `BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN_PERIODS` and no others.
 *
 * Nothing about the gate's behaviour changed, and that matters: the constant is DESCRIPTIVE. A caller
 * that supplies no expectation still gets `indeterminate`, a caller that supplies an operator's own
 * assurance still gets `indeterminate`, and a period with no transcribed listing still has no
 * expectation at all. Knowing what the publisher published is a precondition for deciding; it is not a
 * decision, and it is not authorization.
 *
 * ── Provenance is part of the evidence (§ 7) ────────────────────────────────────
 * An expected inventory is only evidence if someone other than the run said so. An operator asserting
 * "this is complete" is the claim under test, not proof of it, so `operator_assertion` and `unknown`
 * resolve to `indeterminate` however complete the numbers look. Only a publisher manifest or a declared
 * local inventory contract can support a `complete` verdict.
 *
 * ── Metadata only. No row is read, and that is structural (§ 9) ─────────────────
 * This module has no `node:fs` import and no port through which one could arrive. It is a pure function
 * over records the caller already holds — family labels and opaque part keys — so "the completeness
 * preflight reads no rows" is a property of the file rather than a promise in a comment. It also refuses
 * part keys that look like file names or paths, because a part key is an ordinal label and a gate that
 * accepted `EMPRESAS0.CSV` would quietly become a place operator file names go.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - reads a row, opens a file, stats a path, or imports an I/O module.
 *   - emits a path, a file name, a CNPJ, a join key or an operator directory into any finding.
 *   - touches Supabase, a migration, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 *   - authorizes a benchmark, or reports `complete` because nothing contradicted it.
 */

import {
  BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
  BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
} from './br-receita-cnpj-manifest';
import {
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_ALLOWED_FAMILIES,
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS,
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE,
} from './br-receita-cnpj-real-manifest-metadata-reader';

// ─── Standing of the repository's own knowledge (§ 7) ─────────────────────────

/**
 * Whether this repository declares the expected national part inventory for any period. `true` since
 * BR-SOURCE-14B.0K.
 *
 * It was `false` on audit at 14B.0J rather than on principle, and it is `true` now for the same reason:
 * because of what the repository actually contains. 14B.0K landed the Receita's own 2026-07 listing as a
 * versioned artifact with exact part identities, so the honest value changed — and the flag stayed
 * DESCRIPTIVE. It grants nothing. `evaluateBrazilReceitaNationalInputCompleteness` reads the caller's
 * `expected` and `observed` records and never this constant, so a caller with no evidence still gets
 * `indeterminate` whatever this line says.
 */
export const BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN = true as const;

/**
 * The periods a publisher-derived inventory exists for. Exactly one.
 *
 * Enumerated rather than implied, because "we know what the Receita publishes" is a per-period claim: a
 * run for 2026-08 has no expectation in this repository, and inferring one from July is precisely the
 * substitution § 2 of 14B.0K forbids.
 */
export const BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN_PERIODS: readonly string[] = ['2026-07'];

/**
 * Where the expectation comes from, in a form a report can carry.
 *
 * Recorded because a verdict alone tells an owner they are blocked without telling them on whose word:
 * the answer is the official publisher's listing for the period, transcribed deterministically, and never
 * the run's own operator.
 */
export const BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_SOURCE =
  'publisher_derived_part_identity_inventory_2026_07' as const;

/** The scope a second real attempt must have. Restated from the attempt ledger for local readers. */
export const BRAZIL_RECEITA_NATIONAL_REQUIRED_ATTEMPT_2_INPUT_SCOPE = 'full_national' as const;

/** Encodings and delimiters the join path can actually consume, per the official headerless layout. */
export const BRAZIL_RECEITA_NATIONAL_EXPECTED_ENCODING = 'latin1' as const;
export const BRAZIL_RECEITA_NATIONAL_EXPECTED_DELIMITER = ';' as const;
export const BRAZIL_RECEITA_NATIONAL_EXPECTED_LAYOUT_MODE =
  BRAZIL_RECEITA_REAL_MANIFEST_METADATA_LAYOUT_MODE;

/** The families a full join REQUIRES. Empresas and Estabelecimentos, and nothing else. */
export const BRAZIL_RECEITA_NATIONAL_REQUIRED_FAMILIES: readonly string[] = [
  ...BR_RECEITA_CNPJ_REQUIRED_FILE_TYPES,
];

// ─── Provenance ───────────────────────────────────────────────────────────────

/**
 * Where an expected inventory came from, and therefore whether it counts as evidence.
 *
 * The split is the point. The first two are statements made OUTSIDE the run and can support a
 * `complete` verdict; the last two cannot, because a run that accepted its own operator's assurance
 * would be checking nothing.
 */
export const BRAZIL_RECEITA_NATIONAL_EVIDENTIAL_PROVENANCES = [
  'official_publisher_manifest',
  'declared_local_inventory_contract',
] as const;

export const BRAZIL_RECEITA_NATIONAL_NON_EVIDENTIAL_PROVENANCES = [
  'operator_assertion',
  'unknown',
] as const;

export type BrazilReceitaNationalInventoryProvenance =
  | (typeof BRAZIL_RECEITA_NATIONAL_EVIDENTIAL_PROVENANCES)[number]
  | (typeof BRAZIL_RECEITA_NATIONAL_NON_EVIDENTIAL_PROVENANCES)[number];

function isEvidentialProvenance(value: unknown): boolean {
  return (BRAZIL_RECEITA_NATIONAL_EVIDENTIAL_PROVENANCES as readonly unknown[]).includes(value);
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

/** One family's expected part count, from an evidential inventory. */
export interface BrazilReceitaNationalExpectedFamily {
  readonly family: string;
  /** How many distinct parts the period publishes for this family. A positive integer, or the gate stops. */
  readonly expectedPartCount: unknown;
}

/**
 * The expected national inventory for a period.
 *
 * `null` is the honest value today and the gate handles it as `indeterminate` rather than as an error:
 * nobody has one, and a caller pretending otherwise is what this module is for.
 */
export interface BrazilReceitaNationalExpectedInventory {
  readonly sourceKey: unknown;
  readonly period: unknown;
  readonly provenance: unknown;
  readonly families: readonly BrazilReceitaNationalExpectedFamily[] | unknown;
}

/** One family as the observed manifest metadata declares it. */
export interface BrazilReceitaNationalObservedFamily {
  readonly family: string;
  /**
   * Opaque part labels — ordinals such as `'0'`, `'1'`, or a publisher's part token.
   *
   * NEVER a file name and never a path: a key containing a separator or a data-file extension is
   * refused with `part_key_not_opaque`, because this is exactly where an operator's directory listing
   * would otherwise leak into a report.
   */
  readonly declaredPartKeys: readonly unknown[];
}

/**
 * What the manifest metadata says is actually present, as AGGREGATES.
 *
 * Deliberately shaped to be fillable from `BrazilReceitaRealManifestMetadataScan` plus part labels, and
 * deliberately without a path, a file name or a row.
 */
export interface BrazilReceitaNationalObservedInventory {
  readonly sourceKey: unknown;
  readonly period: unknown;
  readonly encoding: unknown;
  readonly delimiter: unknown;
  readonly layoutMode: unknown;
  readonly families: readonly BrazilReceitaNationalObservedFamily[] | unknown;
  /** Person-linked families detected by the metadata reader. Must be zero. */
  readonly forbiddenFamilyCount: unknown;
}

export interface BrazilReceitaNationalInputCompletenessRequest {
  readonly period: string;
  /**
   * `null` when the caller has NO manifest metadata at all — which is the operator CLI's honest state,
   * since this milestone opens nothing.
   *
   * Distinguished from a metadata record full of wrong values, and the distinction matters: "I have not
   * looked" is missing evidence and resolves to `indeterminate`, while "I looked and the encoding is
   * utf8" is a detected defect and resolves to `incomplete`. Collapsing the two would report a run that
   * never inspected anything as one that had inspected it and found it broken.
   */
  readonly observed: BrazilReceitaNationalObservedInventory | null;
  /** `null` when no evidential inventory exists — the standing case. */
  readonly expected: BrazilReceitaNationalExpectedInventory | null;
}

// ─── Findings ─────────────────────────────────────────────────────────────────

/**
 * Findings that make the answer UNKNOWABLE. Each one is a missing piece of evidence rather than a
 * detected defect, and none of them may ever resolve to `complete`.
 */
export const BRAZIL_RECEITA_NATIONAL_INDETERMINATE_FINDINGS = [
  'observed_inventory_absent',
  'expected_inventory_absent',
  'expected_inventory_provenance_not_evidential',
  'expected_inventory_source_key_unusable',
  'expected_inventory_period_unusable',
  'expected_inventory_families_unusable',
  'expected_inventory_part_count_undeclared',
  'observed_inventory_families_unusable',
] as const;

/** Findings that make the answer a definite NO. A detected defect, not a gap in evidence. */
export const BRAZIL_RECEITA_NATIONAL_INCOMPLETE_FINDINGS = [
  'source_key_mismatch',
  'period_mismatch',
  'required_family_missing',
  'family_part_count_short',
  'family_part_count_excess',
  'duplicate_part_declared',
  'unexpected_family_substitution',
  'forbidden_person_linked_family',
  'encoding_incompatible',
  'delimiter_incompatible',
  'layout_incompatible',
  'part_key_not_opaque',
] as const;

export type BrazilReceitaNationalInputFindingCode =
  | (typeof BRAZIL_RECEITA_NATIONAL_INDETERMINATE_FINDINGS)[number]
  | (typeof BRAZIL_RECEITA_NATIONAL_INCOMPLETE_FINDINGS)[number];

/**
 * One finding. Carries the FAMILY LABEL at most — a class label, and reportable — and never a part key,
 * a file name, a path or a count that could identify the operator's staging layout.
 */
export interface BrazilReceitaNationalInputFinding {
  readonly code: BrazilReceitaNationalInputFindingCode;
  readonly family: string | null;
}

export type BrazilReceitaNationalInputCompletenessVerdict = 'complete' | 'incomplete' | 'indeterminate';

export type BrazilReceitaNationalInputScope = 'full_national' | 'staged_subset' | 'indeterminate';

export interface BrazilReceitaNationalInputCompletenessResult {
  readonly verdict: BrazilReceitaNationalInputCompletenessVerdict;
  readonly inputScope: BrazilReceitaNationalInputScope;
  readonly findings: readonly BrazilReceitaNationalInputFinding[];
  readonly expectedInventoryKnown: boolean;
  readonly requiredFamiliesChecked: readonly string[];
  /** Structural assertions. Always these values: there is no code path that could change them. */
  readonly rowsRead: 0;
  readonly filesOpened: 0;
  readonly filesStatted: 0;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PART_KEY_MAX_LENGTH = 16;
const NON_OPAQUE_PART_KEY_PATTERN = /[/\\.]|\.(?:csv|txt|zip)$/i;

/** A part key must be a short opaque label. Anything path-like or file-like is refused. */
function isOpaquePartKey(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > PART_KEY_MAX_LENGTH) return false;
  return !NON_OPAQUE_PART_KEY_PATTERN.test(trimmed);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isFamilyLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** A family label is only reportable if it is an allowlisted class label — never an arbitrary string. */
function reportableFamily(family: unknown): string | null {
  if (!isFamilyLabel(family)) return null;
  const normalized = family.trim().toLowerCase();
  return BRAZIL_RECEITA_REAL_MANIFEST_METADATA_ALLOWED_FAMILIES.includes(normalized)
    ? normalized
    : null;
}

function isForbiddenFamily(family: unknown): boolean {
  if (!isFamilyLabel(family)) return false;
  const normalized = family.trim().toLowerCase();
  return BRAZIL_RECEITA_REAL_MANIFEST_METADATA_FORBIDDEN_FAMILY_TOKENS.some((token) =>
    normalized.includes(token),
  );
}

// ─── The gate ─────────────────────────────────────────────────────────────────

/**
 * Evaluates whether the observed 2026-07 file set is the national collection a full join requires.
 *
 * Read-only, pure, and metadata-only. Returns EVERY finding rather than the first, so an owner
 * assembling an inventory learns the whole gap in one pass.
 *
 * ── Verdict resolution ──────────────────────────────────────────────────────────
 * A definite defect outranks missing evidence: with both present the verdict is `incomplete`, because
 * "this set is wrong" is a stronger and more actionable statement than "we cannot tell". Both are HARD
 * STOPs, so the ordering changes the label and never the permission. `complete` requires zero findings
 * AND an evidential expected inventory — there is no path to it through absence.
 *
 * ── Person-linked families are decisive ─────────────────────────────────────────
 * A forbidden family is recorded as `incomplete` even when everything else is indeterminate. It is the
 * one finding whose meaning does not depend on knowing the expected inventory, and letting it be
 * reported as "we cannot tell" would understate it.
 */
export function evaluateBrazilReceitaNationalInputCompleteness(
  request: BrazilReceitaNationalInputCompletenessRequest,
): BrazilReceitaNationalInputCompletenessResult {
  const findings: BrazilReceitaNationalInputFinding[] = [];
  const add = (code: BrazilReceitaNationalInputFindingCode, family: string | null = null): void => {
    findings.push({ code, family });
  };

  const observed = request.observed;

  // ── Observed side: absent metadata is UNKNOWN, not wrong. ──
  //
  // Checked first and short-circuiting, because the alternative is worse than useless: running the
  // remaining checks against `null` fields would emit `source_key_mismatch`, `period_mismatch`,
  // `encoding_incompatible` and three more, and a caller who had simply not inspected anything would be
  // handed a verdict of `incomplete` describing defects nobody observed.
  if (observed === null || observed === undefined) {
    add('observed_inventory_absent');
  }

  // ── Observed side: person-linked families first. Decisive, and independent of everything else. ──
  if (
    observed !== null &&
    observed !== undefined &&
    !(typeof observed.forbiddenFamilyCount === 'number' && observed.forbiddenFamilyCount === 0)
  ) {
    add('forbidden_person_linked_family');
  }

  const observedFamilies =
    observed !== null && observed !== undefined && Array.isArray(observed.families)
      ? (observed.families as readonly BrazilReceitaNationalObservedFamily[])
      : null;
  if (observedFamilies === null && observed !== null && observed !== undefined) {
    add('observed_inventory_families_unusable');
  }

  for (const entry of observedFamilies ?? []) {
    if (isForbiddenFamily(entry?.family)) add('forbidden_person_linked_family');
  }

  // ── Observed side: shape the join path must be able to read. ──
  //
  // Only when there IS an observed record. Against `null` these five comparisons would all fail and
  // manufacture defects out of the absence of evidence — see `observed_inventory_absent` above.
  if (observed !== null && observed !== undefined) {
    if (observed.sourceKey !== BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY) add('source_key_mismatch');
    if (observed.period !== request.period) add('period_mismatch');
    if (observed.encoding !== BRAZIL_RECEITA_NATIONAL_EXPECTED_ENCODING) {
      add('encoding_incompatible');
    }
    if (observed.delimiter !== BRAZIL_RECEITA_NATIONAL_EXPECTED_DELIMITER) {
      add('delimiter_incompatible');
    }
    if (observed.layoutMode !== BRAZIL_RECEITA_NATIONAL_EXPECTED_LAYOUT_MODE) {
      add('layout_incompatible');
    }
  }

  // ── Observed side: parts per family, deduplicated. ──
  const observedPartsByFamily = new Map<string, Set<string>>();
  for (const entry of observedFamilies ?? []) {
    const family = reportableFamily(entry?.family);
    if (family === null) {
      // A declared family that is neither allowlisted nor forbidden. A full join over an unrecognized
      // family is not a full join over the one that was expected.
      add('unexpected_family_substitution');
      continue;
    }
    const keys = Array.isArray(entry?.declaredPartKeys) ? entry.declaredPartKeys : null;
    if (keys === null) {
      add('observed_inventory_families_unusable', family);
      continue;
    }
    const seen = observedPartsByFamily.get(family) ?? new Set<string>();
    for (const key of keys) {
      if (!isOpaquePartKey(key)) {
        add('part_key_not_opaque', family);
        continue;
      }
      const normalized = (key as string).trim().toLowerCase();
      if (seen.has(normalized)) add('duplicate_part_declared', family);
      else seen.add(normalized);
    }
    observedPartsByFamily.set(family, seen);
  }

  // Same reasoning: a required family is only MISSING if someone looked. With no observed record the
  // gate has already said `observed_inventory_absent`, and adding two `required_family_missing` findings
  // on top would turn "not inspected" into a diagnosis.
  if (observed !== null && observed !== undefined) {
    for (const required of BRAZIL_RECEITA_NATIONAL_REQUIRED_FAMILIES) {
      const parts = observedPartsByFamily.get(required);
      if (parts === undefined || parts.size === 0) add('required_family_missing', required);
    }
  }

  // ── Expected side: the evidence, or its absence. ──
  const expected = request.expected;
  if (expected === null || expected === undefined) {
    add('expected_inventory_absent');
  } else {
    if (!isEvidentialProvenance(expected.provenance)) {
      add('expected_inventory_provenance_not_evidential');
    }
    if (expected.sourceKey !== BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY) {
      add('expected_inventory_source_key_unusable');
    }
    if (expected.period !== request.period) add('expected_inventory_period_unusable');

    const expectedFamilies = Array.isArray(expected.families)
      ? (expected.families as readonly BrazilReceitaNationalExpectedFamily[])
      : null;
    if (expectedFamilies === null) {
      add('expected_inventory_families_unusable');
    } else {
      const expectedByFamily = new Map<string, number>();
      for (const entry of expectedFamilies) {
        const family = reportableFamily(entry?.family);
        if (family === null) {
          add('expected_inventory_families_unusable');
          continue;
        }
        if (!isPositiveInteger(entry?.expectedPartCount)) {
          add('expected_inventory_part_count_undeclared', family);
          continue;
        }
        expectedByFamily.set(family, entry.expectedPartCount as number);
      }

      // Every REQUIRED family must have a declared expectation. An expectation nobody stated is not a
      // satisfied expectation — it is the `indeterminate` case, per family.
      for (const required of BRAZIL_RECEITA_NATIONAL_REQUIRED_FAMILIES) {
        const expectedCount = expectedByFamily.get(required);
        if (expectedCount === undefined) {
          add('expected_inventory_part_count_undeclared', required);
          continue;
        }
        // Counting requires something to count. With no observed record the comparison is vacuous, and a
        // `family_part_count_short` derived from an unread inventory would read as a diagnosed subset.
        if (observed === null || observed === undefined) continue;
        const observedCount = observedPartsByFamily.get(required)?.size ?? 0;
        if (observedCount < expectedCount) add('family_part_count_short', required);
        else if (observedCount > expectedCount) add('family_part_count_excess', required);
      }
    }
  }

  // ── Verdict. ──
  const indeterminateCodes = new Set<string>(BRAZIL_RECEITA_NATIONAL_INDETERMINATE_FINDINGS);
  const hasDefiniteDefect = findings.some((finding) => !indeterminateCodes.has(finding.code));
  const hasMissingEvidence = findings.some((finding) => indeterminateCodes.has(finding.code));

  const verdict: BrazilReceitaNationalInputCompletenessVerdict = hasDefiniteDefect
    ? 'incomplete'
    : hasMissingEvidence
      ? 'indeterminate'
      : 'complete';

  // A shortfall in declared parts, against a KNOWN expectation, is what a staged subset looks like.
  // Without a known expectation the scope is `indeterminate`, never `staged_subset` — the second attempt
  // must be refused for lack of evidence, not mislabelled as a diagnosed subset.
  const shortfall = findings.some((finding) => finding.code === 'family_part_count_short');
  const inputScope: BrazilReceitaNationalInputScope =
    verdict === 'complete' ? 'full_national' : shortfall ? 'staged_subset' : 'indeterminate';

  return {
    verdict,
    inputScope,
    findings,
    expectedInventoryKnown: expected !== null && expected !== undefined && isEvidentialProvenance(expected.provenance),
    requiredFamiliesChecked: BRAZIL_RECEITA_NATIONAL_REQUIRED_FAMILIES,
    rowsRead: 0,
    filesOpened: 0,
    filesStatted: 0,
  };
}

/**
 * Whether a completeness result clears attempt #2's input requirement.
 *
 * Both conditions, and neither implies the other: the verdict must be `complete` AND the scope must be
 * `full_national`. Requiring both is cheap and it closes the one shape of bug that matters here — a
 * future edit that widened `inputScope` without touching the verdict, or the reverse.
 */
export function brazilReceitaNationalInputSatisfiesAttempt2(
  result: BrazilReceitaNationalInputCompletenessResult,
): boolean {
  return (
    result.verdict === 'complete' &&
    result.inputScope === BRAZIL_RECEITA_NATIONAL_REQUIRED_ATTEMPT_2_INPUT_SCOPE
  );
}

// ─── Reportable standing ──────────────────────────────────────────────────────

export interface BrazilReceitaNationalInputGateStanding {
  readonly gateImplemented: true;
  readonly expectedInventoryKnown: typeof BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN;
  readonly expectedInventoryKnownPeriods: readonly string[];
  readonly expectedInventorySource: typeof BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_SOURCE;
  readonly standingVerdictWithoutInventory: 'indeterminate';
  readonly attempt1InputScope: 'staged_subset';
  readonly attempt2RequiredInputScope: typeof BRAZIL_RECEITA_NATIONAL_REQUIRED_ATTEMPT_2_INPUT_SCOPE;
  readonly readsRows: false;
  readonly opensFiles: false;
}

/**
 * The gate's standing, as data.
 *
 * `expectedInventoryKnown: true` and `standingVerdictWithoutInventory: 'indeterminate'` are both true at
 * once, and reporting them together is the point: the expectation exists, and a caller that supplies no
 * observation is still refused. Knowing what the publisher published is not the same as having looked at
 * what is on disk, and the gate keeps the two apart.
 */
export function summarizeBrazilReceitaNationalInputGate(): BrazilReceitaNationalInputGateStanding {
  return {
    gateImplemented: true,
    expectedInventoryKnown: BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN,
    expectedInventoryKnownPeriods: BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN_PERIODS,
    expectedInventorySource: BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_SOURCE,
    standingVerdictWithoutInventory: 'indeterminate',
    attempt1InputScope: 'staged_subset',
    attempt2RequiredInputScope: BRAZIL_RECEITA_NATIONAL_REQUIRED_ATTEMPT_2_INPUT_SCOPE,
    readsRows: false,
    opensFiles: false,
  };
}
