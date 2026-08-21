/**
 * BR Receita CNPJ — the EXECUTABLE GATE-5 output guard (BR-SOURCE-GATE-ROUND-3).
 *
 * BR-SOURCE-10O § 5.4 named `OS-A01` … `OS-A46` as "a review and traceability device" and said
 * plainly: "No test is written here." This module is what makes each of those rules a predicate a
 * test can call, so GATE-5's pass criterion — "every rule is expressed as an assertion a future test
 * can enforce, not as prose guidance" (10K § 9) — has something to be true of.
 *
 * It is a GUARD, not a sanitizer-in-the-runner sense: it decides whether a candidate output is
 * admissible and returns findings. It never rewrites a value into a "safe" one, because a contract
 * whose enforcement can silently repair its input teaches callers that violations are survivable.
 *
 * ── 🔴 Where this guard sits relative to BR-SOURCE-11A ───────────────────────
 *
 * `br-receita-cnpj-full-join-output-sanitizer` (11A) already exists and already walks report trees.
 * This module does NOT replace it, wrap it, or weaken it. They answer different questions:
 *
 *   11A   — "does this tree contain something that LOOKS like dataset content?" (a denylist walk)
 *   here  — "is every key in this tree NAMED in the frozen § 6 allowlist?" (`OS-A08`)
 *
 * 10O § 5.4 is explicit that the allowlist is the load-bearing half: "A denylist can be evaded; an
 * allowlist cannot be evaded by novelty. If exactly one assertion had to survive, it is `OS-A08`."
 * 11A has no allowlist. That is the gap this module closes, and it is why both must run.
 *
 * ── 🔴 One residual gap in the frozen VP rules, recorded and NOT papered over ─
 *
 * `VP-1` … `VP-3` name runs of exactly 8, 11 and 14 positions and `VP-4` names runs LONGER than 14.
 * Runs of 9, 10, 12 and 13 positions are therefore uncovered by the frozen rules as written. This
 * module implements the rules AS FROZEN rather than quietly widening them — 10O § 5.3's own warning
 * is that an indiscriminate widening manufactures false positives — and records the residual in
 * `BRAZIL_RECEITA_GATE5_VP_RESIDUAL_DIGIT_RUN_GAP`. What actually closes it today is 11A's
 * `LONG_DIGIT_RUN`, which matches 8-or-more. That is a reason to keep 11A, not to edit this contract.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - emits, logs, prints or returns a value it rejected. Findings carry a rule id and a key path.
 *   - approves a gate, authorizes a run, a report emission, an import, a Supabase write, a
 *     migration, a runtime path, Agent 1, Agent 2A or a provider call.
 *   - re-implements CNPJ validation. The DV authority is `br-cnpj.ts`, reached through
 *     `br-receita-cnpj-identifier-shape`, exactly as 11A reaches it.
 */

import { containsBrazilCnpjLikeIdentifier } from './br-receita-cnpj-identifier-shape';
import {
  BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS,
  BRAZIL_RECEITA_GATE5_COMPLEMENTARY_SUPPRESSION_REQUIRED,
  BRAZIL_RECEITA_GATE5_ERROR_CODES,
  BRAZIL_RECEITA_GATE5_ERROR_ENVELOPE_FIELDS,
  BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_GROUPS,
  BRAZIL_RECEITA_GATE5_GENERIC_ERROR_CODE,
  BRAZIL_RECEITA_GATE5_LOG_EVENT_FIELDS,
  BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH,
  BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL,
  BRAZIL_RECEITA_GATE5_SMALL_CELL_K,
  type BrazilReceitaGate5ErrorCode,
} from './br-receita-cnpj-gate5-output-contract';

// ─── Rule identifiers ─────────────────────────────────────────────────────────

/** The value-pattern rule ids, exactly as 10O § 5.3 names them. */
export type BrazilReceitaGate5ValueRuleId =
  | 'VP-1'
  | 'VP-2'
  | 'VP-3'
  | 'VP-4'
  | 'VP-5'
  | 'VP-6'
  | 'VP-7'
  | 'VP-8'
  | 'VP-9'
  | 'VP-10';

export type BrazilReceitaGate5RuleId =
  | BrazilReceitaGate5ValueRuleId
  | 'KEY-DENYLIST'
  | 'KEY-ALLOWLIST'
  | 'SMALL-CELL'
  | 'CROSS-TAB'
  | 'ERROR-ENVELOPE'
  | 'LOG-FIELD-SET'
  | 'CNPJ-DV';

export interface BrazilReceitaGate5Finding {
  readonly rule: BrazilReceitaGate5RuleId;
  /** The dotted key path of the offending node. Keys only — never a value, never a path. */
  readonly path: string;
  /** For a denylist hit, which § 5.2 group fired. Absent for every other rule. */
  readonly group?: number;
}

export interface BrazilReceitaGate5GuardResult {
  readonly ok: boolean;
  readonly findings: readonly BrazilReceitaGate5Finding[];
}

const GUARD_PASSED: BrazilReceitaGate5GuardResult = { ok: true, findings: [] };

function result(findings: readonly BrazilReceitaGate5Finding[]): BrazilReceitaGate5GuardResult {
  return findings.length === 0 ? GUARD_PASSED : { ok: false, findings };
}

/**
 * The digit-run positions the frozen `VP-1` … `VP-4` rules leave uncovered. Recorded as data so a
 * future reader finds the gap here rather than rediscovering it from a leak.
 */
export const BRAZIL_RECEITA_GATE5_VP_RESIDUAL_DIGIT_RUN_GAP = {
  uncoveredRunLengths: [9, 10, 12, 13] as readonly number[],
  coveredElsewhereBy: 'LONG_DIGIT_RUN',
  coveredElsewhereIn: 'br-receita-cnpj-full-join-output-sanitizer (BR-SOURCE-11A)',
  widenedByThisRound: false,
} as const;

// ─── § 5.2 normalization ──────────────────────────────────────────────────────

/**
 * The four-step normalization 10O § 5.2 froze, in order: lowercase, strip diacritics, collapse every
 * non-alphanumeric run to one underscore, trim leading and trailing underscores.
 *
 * 🔴 Underscores SURVIVE, unlike the 11A normalizer which strips every separator. That difference is
 * load-bearing: group 3 matches `numero` as a WHOLE name, and a separator-stripping normalizer would
 * turn `establishment_numero_bucket` into one long token in which `numero` is only a substring.
 */
export function normalizeBrazilReceitaGate5Key(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Removes a trailing `_<digits>` positional suffix, for the group-2 `whole_or_ordinal` mode. */
function stripOrdinalSuffix(normalizedKey: string): string {
  return normalizedKey.replace(/_\d+$/, '');
}

/**
 * The group whose closed enumeration matches `key`, or `null`. Exposed so a test can assert the
 * exact closed rule rather than a re-description of it.
 */
export function matchBrazilReceitaGate5ForbiddenKeyGroup(key: string): number | null {
  const normalized = normalizeBrazilReceitaGate5Key(key);
  const withoutOrdinal = stripOrdinalSuffix(normalized);

  for (const group of BRAZIL_RECEITA_GATE5_FORBIDDEN_KEY_GROUPS) {
    for (const name of group.names) {
      if (group.matchMode === 'substring' && normalized.includes(name)) return group.group;
      if (group.matchMode === 'whole' && normalized === name) return group.group;
      if (
        group.matchMode === 'whole_or_ordinal' &&
        (normalized === name || withoutOrdinal === name)
      ) {
        return group.group;
      }
    }
  }
  return null;
}

/** `OS-A07`. True when the key is refused by the closed § 5.2 denylist. */
export function isBrazilReceitaGate5ForbiddenKey(key: string): boolean {
  return matchBrazilReceitaGate5ForbiddenKeyGroup(key) !== null;
}

/**
 * `OS-A08`, the load-bearing assertion. True only when the key is NAMED in the frozen § 6 allowlist.
 * Absence is refusal; novelty cannot evade it.
 */
export function isBrazilReceitaGate5AllowedKey(key: string): boolean {
  return BRAZIL_RECEITA_GATE5_ALLOWED_REPORT_KEYS.includes(
    normalizeBrazilReceitaGate5Key(key),
  );
}

// ─── § 5.3 the value-pattern rules ────────────────────────────────────────────

/** Quantifiers only. No identifier of any length appears as a literal in this source. */
const RUN_OF_8 = /(?<!\d)\d{8}(?!\d)/;
const RUN_OF_11 = /(?<!\d)\d{11}(?!\d)/;
const RUN_OF_14 = /(?<!\d)\d{14}(?!\d)/;
const RUN_LONGER_THAN_14 = /(?<!\d)\d{15,}(?!\d)/;

/** The `VP-5` separator set: dots, slashes, hyphens and spaces, per 10O § 5.3. */
const VP5_SEPARATORS = /[./\-\s]/g;

/** The email marker, assembled from its code point so no literal marker sits in this source. */
const EMAIL_MARKER = String.fromCharCode(64);

const DIGIT_RUN_RULES: ReadonlyArray<readonly [RegExp, BrazilReceitaGate5ValueRuleId]> = [
  [RUN_OF_8, 'VP-1'],
  [RUN_OF_11, 'VP-2'],
  [RUN_OF_14, 'VP-3'],
  [RUN_LONGER_THAN_14, 'VP-4'],
];

/**
 * `VP-1` … `VP-5`. Evaluates the digit-run rules against BOTH the raw text and its separator-stripped
 * form, so a formatted identifier is caught as readily as a bare one.
 */
export function findBrazilReceitaGate5DigitRunViolations(
  text: string,
): readonly BrazilReceitaGate5ValueRuleId[] {
  const stripped = text.replace(VP5_SEPARATORS, '');
  const hits = new Set<BrazilReceitaGate5ValueRuleId>();
  for (const [pattern, rule] of DIGIT_RUN_RULES) {
    if (pattern.test(text)) hits.add(rule);
    // A hit that appears ONLY in the stripped form is what VP-5 exists to catch.
    if (pattern.test(stripped)) {
      hits.add(rule);
      if (!pattern.test(text)) hits.add('VP-5');
    }
  }
  return [...hits];
}

/** `VP-6`. The marker CHARACTER, not a full address shape — the contract is the broader rule. */
export function containsBrazilReceitaGate5EmailMarker(text: string): boolean {
  return text.includes(EMAIL_MARKER);
}

/** `VP-8`. No enum-or-literal string value may exceed the owner's ceiling. */
export function exceedsBrazilReceitaGate5StringLength(text: string): boolean {
  return text.length > BRAZIL_RECEITA_GATE5_MAX_OUTPUT_STRING_LENGTH;
}

/**
 * `VP-7`. A string value is admissible only as a member of a closed enum, a fixed schema literal, or
 * a numeral rendered as a string. `allowedLiterals` is the caller's closed set; passing an empty set
 * means only numerals pass, which is the fail-closed default rather than a permissive one.
 */
export function isBrazilReceitaGate5AdmissibleStringValue(
  text: string,
  allowedLiterals: readonly string[],
): boolean {
  if (allowedLiterals.includes(text)) return true;
  return /^-?\d+$/.test(text) && !exceedsBrazilReceitaGate5StringLength(text);
}

/** `VP-9`. Every count, total, or distribution bucket carries an integer. */
export function isBrazilReceitaGate5AdmissibleCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
}

/**
 * Checks one string value against every rule that applies to values. Returns rule ids only; the
 * value is never echoed, quoted, truncated or attached to a finding.
 */
export function checkBrazilReceitaGate5StringValue(
  text: string,
  allowedLiterals: readonly string[],
): readonly BrazilReceitaGate5ValueRuleId[] {
  const hits = new Set<BrazilReceitaGate5ValueRuleId>(
    findBrazilReceitaGate5DigitRunViolations(text),
  );
  if (containsBrazilReceitaGate5EmailMarker(text)) hits.add('VP-6');
  if (exceedsBrazilReceitaGate5StringLength(text)) hits.add('VP-8');
  if (!isBrazilReceitaGate5AdmissibleStringValue(text, allowedLiterals)) hits.add('VP-7');
  return [...hits];
}

// ─── The report walk ──────────────────────────────────────────────────────────

/** Bounds the recursive walk so a cyclic or pathological candidate cannot hang it. */
const MAX_WALK_DEPTH = 12;

export interface BrazilReceitaGate5GuardOptions {
  /** The closed literal set `VP-7` admits for this candidate. Empty means numerals only. */
  readonly allowedLiterals?: readonly string[];
  /** The closed bucket labels `VP-10` admits as count-map keys. Empty means none. */
  readonly allowedBucketLabels?: readonly string[];
  /** Keys whose object children are count maps, so their keys are checked under `VP-10`. */
  readonly countMapKeys?: readonly string[];
}

/**
 * The precedence 10O § 5.2 states in one sentence and which is the whole reason the contract works:
 * **"The allowlist governs; the denylist is a second, independent net. Where the two disagree about a
 * key that is in neither, the key is forbidden."**
 *
 * Read as three cases:
 *
 *   in § 6                → ADMITTED, even when a denylist group matches it
 *   in § 5.2 only         → forbidden, and the finding names the group
 *   in neither            → forbidden
 *
 * 🔴 The first case is not a loophole, it is the design. `persisted_rows`, `rows_seen_by_family` and
 * `join_outcome_counts` all trip group 7's deliberately-broad `row` / `cell` substrings, and 10O
 * § 5.2 answers exactly that: they are permitted "because [they are] *named in § 6*, not because
 * [they] survive the denylist." Reporting a denylist hit on an allowlisted key would make the frozen
 * § 6 report un-emittable by its own contract — the two halves would refuse each other.
 *
 * The safety of the first case rests on § 6 being CLOSED and owner-frozen: fifty reviewed names, and
 * no way to add a fifty-first except a recorded owner decision.
 */
function pushKeyFindings(
  key: string,
  path: string,
  findings: BrazilReceitaGate5Finding[],
): void {
  if (isBrazilReceitaGate5AllowedKey(key)) return;
  findings.push({ rule: 'KEY-ALLOWLIST', path });
  const group = matchBrazilReceitaGate5ForbiddenKeyGroup(key);
  if (group !== null) findings.push({ rule: 'KEY-DENYLIST', path, group });
}

function walk(
  value: unknown,
  path: string,
  depth: number,
  seen: WeakSet<object>,
  options: BrazilReceitaGate5GuardOptions,
  findings: BrazilReceitaGate5Finding[],
  insideCountMap: boolean,
): void {
  if (depth > MAX_WALK_DEPTH) return;

  if (typeof value === 'string') {
    for (const rule of checkBrazilReceitaGate5StringValue(
      value,
      options.allowedLiterals ?? [],
    )) {
      findings.push({ rule, path });
    }
    if (containsBrazilCnpjLikeIdentifier(value)) findings.push({ rule: 'CNPJ-DV', path });
    return;
  }
  if (typeof value === 'number') {
    if (insideCountMap && !isBrazilReceitaGate5AdmissibleCount(value)) {
      findings.push({ rule: 'VP-9', path });
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.forEach((item, index) => {
      walk(item, `${path}[${index}]`, depth + 1, seen, options, findings, insideCountMap);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path === '' ? key : `${path}.${key}`;

    if (insideCountMap) {
      // `VP-10`: a count map's KEYS are bucket labels from a closed enum, and are subject to § 5.2
      // and to VP-1..VP-6. The key is where the datum hides when the value looks safe.
      const label = normalizeBrazilReceitaGate5Key(key);
      const admitted =
        (options.allowedBucketLabels ?? []).includes(label) ||
        label === BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL;
      if (!admitted) findings.push({ rule: 'VP-10', path: childPath });
      // Same precedence as `pushKeyFindings`: a label the contract NAMES is admitted, and the
      // denylist is the second net for everything else. `OD-C3` records why this case exists — the
      // residual label 10O § 7 mandates trips group 7's `cell` substring.
      if (!admitted && isBrazilReceitaGate5ForbiddenKey(key)) {
        findings.push({
          rule: 'KEY-DENYLIST',
          path: childPath,
          group: matchBrazilReceitaGate5ForbiddenKeyGroup(key) ?? 0,
        });
      }
      for (const rule of findBrazilReceitaGate5DigitRunViolations(key)) {
        findings.push({ rule, path: childPath });
      }
      if (containsBrazilReceitaGate5EmailMarker(key)) findings.push({ rule: 'VP-6', path: childPath });
      if (!isBrazilReceitaGate5AdmissibleCount(child)) findings.push({ rule: 'VP-9', path: childPath });
      continue;
    }

    pushKeyFindings(key, childPath, findings);
    const childIsCountMap = (options.countMapKeys ?? []).includes(
      normalizeBrazilReceitaGate5Key(key),
    );
    walk(child, childPath, depth + 1, seen, options, findings, childIsCountMap);
  }
}

/**
 * `OS-A07`, `OS-A08`, `OS-A09` … `OS-A12`, `OS-A22`, `OS-A23`. Validates a candidate report tree
 * against the frozen contract and returns every finding so the caller can fail closed.
 *
 * PURE. Never throws on a violation, never rewrites the input, never echoes a rejected value.
 */
export function guardBrazilReceitaGate5Report(
  candidate: unknown,
  options: BrazilReceitaGate5GuardOptions = {},
): BrazilReceitaGate5GuardResult {
  const findings: BrazilReceitaGate5Finding[] = [];
  walk(candidate, '', 0, new WeakSet<object>(), options, findings, false);
  return result(findings);
}

/**
 * `OS-A05` on the rendered surface. Applies the digit-run, marker and DV rules to an already-rendered
 * string, so a leak introduced by rendering rather than by the tree is still refused.
 */
export function guardBrazilReceitaGate5RenderedOutput(
  rendered: string,
): BrazilReceitaGate5GuardResult {
  const findings: BrazilReceitaGate5Finding[] = [];
  for (const rule of findBrazilReceitaGate5DigitRunViolations(rendered)) {
    findings.push({ rule, path: '<rendered>' });
  }
  if (containsBrazilReceitaGate5EmailMarker(rendered)) {
    findings.push({ rule: 'VP-6', path: '<rendered>' });
  }
  if (containsBrazilCnpjLikeIdentifier(rendered)) {
    findings.push({ rule: 'CNPJ-DV', path: '<rendered>' });
  }
  return result(findings);
}

// ─── § 7 small-cell suppression ───────────────────────────────────────────────

export interface BrazilReceitaGate5SuppressionOutcome {
  /** The disclosed buckets. Every count is at or above `k`. */
  readonly disclosed: Readonly<Record<string, number>>;
  /** The single merged residual count, or `null` when nothing was suppressed. */
  readonly residualCount: number | null;
  /**
   * `OS-A19`. True when the family could not be made compliant — a state the caller must treat as a
   * failure rather than as a report with a gap.
   */
  readonly suppressionFailed: boolean;
}

/**
 * Applies the frozen suppression mechanism to one bucket family.
 *
 * Three properties, each of which 10O § 7 requires and each of which is easy to get wrong:
 *
 *   · the residual is ONE count. The number of merged buckets is itself a disclosure, so the outcome
 *     carries no bucket tally and no labels.
 *   · COMPLEMENTARY suppression. Suppressing exactly one bucket and publishing the family leaves the
 *     suppressed count recoverable by subtraction, so the next smallest is suppressed with it.
 *   · a residual that is ITSELF below `k` is not disclosable either, so more buckets are absorbed
 *     until it clears `k` — and if the whole family cannot clear it, the outcome is a FAILURE, not a
 *     family reported as empty.
 */
export function applyBrazilReceitaGate5SmallCellSuppression(
  family: Readonly<Record<string, number>>,
): BrazilReceitaGate5SuppressionOutcome {
  const k = BRAZIL_RECEITA_GATE5_SMALL_CELL_K;
  const entries = Object.entries(family).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  const suppressed: [string, number][] = [];
  const kept: [string, number][] = [];
  for (const entry of entries) {
    if (entry[1] < k) suppressed.push(entry);
    else kept.push(entry);
  }

  if (suppressed.length === 0) {
    return { disclosed: Object.freeze({ ...family }), residualCount: null, suppressionFailed: false };
  }

  // Complementary suppression: one suppressed cell is recoverable by subtraction.
  if (
    BRAZIL_RECEITA_GATE5_COMPLEMENTARY_SUPPRESSION_REQUIRED &&
    suppressed.length === 1 &&
    kept.length > 0
  ) {
    suppressed.push(kept.shift() as [string, number]);
  }

  // A residual below `k` is not disclosable; absorb the next smallest until it clears.
  let residual = suppressed.reduce((total, entry) => total + entry[1], 0);
  while (residual < k && kept.length > 0) {
    const next = kept.shift() as [string, number];
    suppressed.push(next);
    residual += next[1];
  }

  if (residual < k) {
    // Nothing admissible remains: the family cannot be disclosed at all.
    return { disclosed: Object.freeze({}), residualCount: null, suppressionFailed: true };
  }

  const disclosed: Record<string, number> = {};
  for (const [label, count] of kept) disclosed[label] = count;
  disclosed[BRAZIL_RECEITA_GATE5_RESIDUAL_BUCKET_LABEL] = residual;
  return { disclosed: Object.freeze(disclosed), residualCount: residual, suppressionFailed: false };
}

// ─── § 8 the error boundary ───────────────────────────────────────────────────

export interface BrazilReceitaGate5SanitizedError {
  readonly error_code: BrazilReceitaGate5ErrorCode;
  readonly failed_stage: string | null;
  readonly safe_counts: Readonly<Record<string, number>>;
  readonly file_family: string | null;
  readonly gate_name: string | null;
  readonly safety_flags: Readonly<Record<string, false>>;
  readonly cleanup_status: string | null;
}

export interface BrazilReceitaGate5ErrorInput {
  readonly code?: unknown;
  readonly failedStage?: string | null;
  readonly safeCounts?: Readonly<Record<string, unknown>>;
  readonly fileFamily?: string | null;
  readonly gateName?: string | null;
  readonly cleanupStatus?: string | null;
}

function admissibleEnumOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (exceedsBrazilReceitaGate5StringLength(value)) return null;
  if (isBrazilReceitaGate5ForbiddenKey(value)) return null;
  if (findBrazilReceitaGate5DigitRunViolations(value).length > 0) return null;
  if (containsBrazilReceitaGate5EmailMarker(value)) return null;
  if (containsBrazilCnpjLikeIdentifier(value)) return null;
  // Closed-enum shape: lowercase tokens and underscores only. A free-form string cannot pass.
  return /^[a-z][a-z0-9_]*$/.test(value) ? value : null;
}

/**
 * `OS-A30` … `OS-A35`. THE constructor. Sanitizes at construction, so an object that travels is
 * already clean and no print site has to be trusted.
 *
 * Fail-closed in three ways 10O § 8.3 requires:
 *
 *   · an unrecognized code becomes `unclassified_failure`, never a pass-through;
 *   · a field that cannot be classified becomes `null`, never the original value;
 *   · the returned object is a PLAIN frozen record, not an `Error`. That is deliberate: an `Error`
 *     carries a `stack` the moment it is constructed, and `OS-A34` forbids stack emission on every
 *     surface. A shape with nowhere to put a stack cannot leak one.
 */
export function createBrazilReceitaGate5SanitizedError(
  input: BrazilReceitaGate5ErrorInput,
): BrazilReceitaGate5SanitizedError {
  const rawCode = typeof input.code === 'string' ? input.code : '';
  const code = (BRAZIL_RECEITA_GATE5_ERROR_CODES as readonly string[]).includes(rawCode)
    ? (rawCode as BrazilReceitaGate5ErrorCode)
    : BRAZIL_RECEITA_GATE5_GENERIC_ERROR_CODE;

  const safeCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.safeCounts ?? {})) {
    if (!isBrazilReceitaGate5AdmissibleCount(value)) continue;
    if (isBrazilReceitaGate5ForbiddenKey(key)) continue;
    if (!isBrazilReceitaGate5AllowedKey(key)) continue;
    safeCounts[normalizeBrazilReceitaGate5Key(key)] = value as number;
  }

  return Object.freeze({
    error_code: code,
    failed_stage: admissibleEnumOrNull(input.failedStage),
    safe_counts: Object.freeze(safeCounts),
    file_family: admissibleEnumOrNull(input.fileFamily),
    gate_name: admissibleEnumOrNull(input.gateName),
    safety_flags: Object.freeze({
      import_executed: false as const,
      supabase_write: false as const,
      runtime_integration: false as const,
      agent1_integration: false as const,
    }),
    cleanup_status: admissibleEnumOrNull(input.cleanupStatus),
  });
}

/** `OS-A21`. What may reach stderr: the envelope's fields, and nothing this contract cannot name. */
export function isBrazilReceitaGate5ErrorEnvelopeShape(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false;
  const keys = Object.keys(candidate as Record<string, unknown>);
  const allowed = BRAZIL_RECEITA_GATE5_ERROR_ENVELOPE_FIELDS as readonly string[];
  return keys.every((key) => allowed.includes(key)) && keys.length > 0;
}

// ─── § 11 the log boundary ────────────────────────────────────────────────────

/**
 * `OS-A25`. A log event is admissible only when every key comes from the closed field set and every
 * value survives the value rules. There is no free-form message field to misuse, so a caller with
 * something to interpolate has nowhere to put it.
 */
export function guardBrazilReceitaGate5LogEvent(
  event: unknown,
  allowedLiterals: readonly string[] = [],
): BrazilReceitaGate5GuardResult {
  const findings: BrazilReceitaGate5Finding[] = [];
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    return { ok: false, findings: [{ rule: 'LOG-FIELD-SET', path: '<event>' }] };
  }
  const allowed = BRAZIL_RECEITA_GATE5_LOG_EVENT_FIELDS as readonly string[];
  for (const [key, value] of Object.entries(event as Record<string, unknown>)) {
    if (!allowed.includes(key)) findings.push({ rule: 'LOG-FIELD-SET', path: key });
    if (typeof value === 'string') {
      for (const rule of checkBrazilReceitaGate5StringValue(value, allowedLiterals)) {
        findings.push({ rule, path: key });
      }
      if (containsBrazilCnpjLikeIdentifier(value)) findings.push({ rule: 'CNPJ-DV', path: key });
    }
  }
  return result(findings);
}
