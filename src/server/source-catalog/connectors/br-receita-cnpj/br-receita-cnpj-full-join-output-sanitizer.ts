/**
 * BR Receita CNPJ — full join dry-run OUTPUT SANITIZER (BR-SOURCE-11A).
 *
 * The last line of defense before a full-join dry-run report is returned, printed,
 * or written. GATE-5 (output sanitization) is NOT approved, so no report may leave
 * the runner without passing this check.
 *
 * The sanitizer walks the whole report tree and rejects it if any leaf or key could
 * carry dataset content rather than an aggregate:
 *
 *   - a full CNPJ (14 continuous digits, or the NN.NNN.NNN/NNNN-NN form);
 *   - a CPF (11 continuous digits, or the NNN.NNN.NNN-NN form);
 *   - a CNPJ básico / raiz (8 continuous digits appearing as a VALUE);
 *   - an email marker, a phone-like token, or a LinkedIn URL;
 *   - a `raw_row` / `rawRows` / `raw_data` key carrying a non-empty payload;
 *   - a `raw_cell` / `cell_value` / `column_value` key, or a `row_sample` / `sampled_row` key,
 *     carrying a payload — from BR-SOURCE-11F-IMPL the required-family probe is the first code
 *     path that ever holds a real ROW and a real CELL. It splits a row to COUNT its fields and
 *     discards them, and samples are forbidden outright, so either shape reaching a report
 *     means a value was kept that the probe was only ever allowed to count;
 *   - a `raw_manifest` / `manifest_json` key carrying a payload — from
 *     BR-SOURCE-11D-META-IMPL a real manifest DOCUMENT can be parsed, and echoing it
 *     would leak declared filenames, paths, and the declared period in one step;
 *   - a `file_name` / `manifest_path` / `basename` key carrying a value — a declared
 *     filename is operator-environment information, and a RELATIVE one would slip past
 *     the absolute-path value pattern below, so it is blocked by key as well;
 *   - a `join_key` / `joined_row` / `joined_sample` / `join_pair` key carrying a payload —
 *     from BR-SOURCE-11G-IMPL the required-family JOIN probe is the first code path that ever
 *     holds the protected technical join key. It may parse one ephemerally and compare it in
 *     memory; it may never emit it, materialize a joined row, or emit a pair (11G decision
 *     record § 5, § 8.1);
 *   - a coverage PERCENTAGE / ratio / rate key carrying a value — `coverageAllowed = false` is
 *     a refusal rather than a labelling rule (11G § 9.1), so a ratio is blocked at the output
 *     boundary as well as declined at the input one. Deliberately narrow: the bounded-scan
 *     guardrail counts and the `coverage_claimed: false` / `join_coverage_computed: false`
 *     assertions carry nothing and still pass;
 *   - a `record_identity_key`, `normalized_tax_id`, `cnpj_basico`, `cnpj`, or `cpf`
 *     key carrying a real value, and a `cnpj_basico`/`cnpj_completo` COLLECTION key — the
 *     shape a bounded key window would take if it were ever written out;
 *   - a `hash` / `fingerprint` / `sha` key carrying a value — hashing an identifier
 *     does not de-identify it, so derived digests are blocked outright;
 *   - a numeric leaf with 8 or more digits. Every legitimate field in this report is
 *     an aggregate count or a bounded cap, all far below that; a huge number is
 *     therefore either a leaked identifier or a full-dataset-scale count, and both
 *     must fail closed.
 *   - a FILESYSTEM PATH (an absolute POSIX path, a Windows drive path, or a `file:`
 *     URL). From BR-SOURCE-11C onward a synthetic temp workspace exists on disk, and a
 *     temp path still names the operator's machine — so no report may carry one.
 *
 * Safe shapes pass by construction, not by exception: `YYYY-MM` and `2026-07` carry a
 * separator so they hold no 8-digit run; hito labels (`BR-SOURCE-11A`) and
 * placeholders (`not_approved`, `synthetic_fixture_only`) are plain identifiers.
 *
 * ── The sanitizer NEVER ─────────────────────────────────────────────────────────
 *   - includes the offending value, or any fragment of it, in its findings. A
 *     finding names the KIND of leak and the sanitized key PATH, nothing else.
 *   - performs I/O. It is pure, so it can be applied to a report and to a rendered
 *     string in any order, at any layer.
 */

// ─── Finding kinds ────────────────────────────────────────────────────────────

/** What kind of forbidden content was detected. Never carries the value itself. */
export type BrazilReceitaFullJoinLeakKind =
  | 'cnpj_completo_like'
  | 'cnpj_basico_like'
  | 'cpf_like'
  | 'email_like'
  | 'phone_like'
  | 'linkedin_url_like'
  | 'raw_row_payload'
  | 'raw_cell_payload'
  | 'row_sample_payload'
  | 'raw_data_payload'
  | 'raw_manifest_payload'
  | 'declared_filename_payload'
  | 'record_identity_key_value'
  | 'normalized_tax_id_value'
  | 'cnpj_key_value'
  | 'cpf_key_value'
  | 'cnpj_basico_key_value'
  | 'identifier_hash_value'
  | 'oversized_numeric_value'
  | 'filesystem_path_like'
  // ── BR-SOURCE-11G-IMPL: the join probe is the first code path that holds a JOIN KEY ──
  | 'join_key_payload'
  | 'joined_row_payload'
  | 'joined_sample_payload'
  | 'join_pair_payload'
  | 'coverage_payload'
  | 'cnpj_basico_payload'
  | 'cnpj_completo_payload';

export const BRAZIL_RECEITA_FULL_JOIN_LEAK_KINDS: readonly BrazilReceitaFullJoinLeakKind[] = [
  'cnpj_completo_like',
  'cnpj_basico_like',
  'cpf_like',
  'email_like',
  'phone_like',
  'linkedin_url_like',
  'raw_row_payload',
  'raw_cell_payload',
  'row_sample_payload',
  'raw_data_payload',
  'raw_manifest_payload',
  'declared_filename_payload',
  'record_identity_key_value',
  'normalized_tax_id_value',
  'cnpj_key_value',
  'cpf_key_value',
  'cnpj_basico_key_value',
  'identifier_hash_value',
  'oversized_numeric_value',
  'filesystem_path_like',
  'join_key_payload',
  'joined_row_payload',
  'joined_sample_payload',
  'join_pair_payload',
  'coverage_payload',
  'cnpj_basico_payload',
  'cnpj_completo_payload',
];

/** The single aggregate error code surfaced on a report when sanitization fails. */
export const BRAZIL_RECEITA_FULL_JOIN_SANITIZER_ERROR_CODE = 'forbidden_output_detected' as const;

/**
 * One sanitization finding. `path` is the dotted key path of the offending node
 * (keys only — never a value, never a filesystem path).
 */
export interface BrazilReceitaFullJoinSanitizerFinding {
  readonly kind: BrazilReceitaFullJoinLeakKind;
  readonly path: string;
}

export interface BrazilReceitaFullJoinSanitizerResult {
  readonly ok: boolean;
  readonly findings: readonly BrazilReceitaFullJoinSanitizerFinding[];
}

const SANITIZER_PASSED: BrazilReceitaFullJoinSanitizerResult = { ok: true, findings: [] };

// ─── Value patterns ───────────────────────────────────────────────────────────

/**
 * Digit-run and format patterns. Quantifiers only — no literal identifier of any
 * length lives in this source file.
 */
const CNPJ_CONTINUOUS = /(?<!\d)\d{14}(?!\d)/;
const CNPJ_FORMATTED = /(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?!\d)/;
const CPF_CONTINUOUS = /(?<!\d)\d{11}(?!\d)/;
const CPF_FORMATTED = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/;
const CNPJ_BASICO_CONTINUOUS = /(?<!\d)\d{8}(?!\d)/;
/** Any digit run at or beyond CNPJ básico length, in case it matches no exact size. */
const LONG_DIGIT_RUN = /(?<!\d)\d{8,}(?!\d)/;
/** An international/local phone-ish token: a leading + followed by a long digit run. */
const PHONE_LIKE = /\+\d[\d\s().-]{7,}/;
const LINKEDIN_LIKE = /linkedin\.[a-z]{2,}/i;
/** A hex digest of md5 length or beyond — a derived identifier fingerprint. */
const HEX_DIGEST_LIKE = /(?<![a-f0-9])[a-f0-9]{32,}(?![a-f0-9])/i;
/**
 * A filesystem location: an absolute POSIX path of two or more segments, a Windows
 * drive path, or a `file:` URL. Matters from BR-SOURCE-11C onward, because a synthetic
 * temp-manifest run is the first time a real path exists anywhere in the process — and
 * a temp path still names the operator's machine, so no report may ever carry one.
 * Every legitimate report value (`not_approved`, `official_headerless`, `YYYY-MM`, a
 * source key, a count) is separator-free, so this cannot fire on a safe shape.
 */
const FILESYSTEM_PATH_LIKE =
  /(?:^|[\s"'(=[,])(?:\/[A-Za-z0-9._-]+){2,}|[A-Za-z]:[\\/][A-Za-z0-9._-]|file:\/\//;

/** Local-part@domain, assembled without a literal marker character in a string. */
const EMAIL_LIKE = new RegExp(
  `[A-Za-z0-9._%+-]+${String.fromCharCode(64)}[A-Za-z0-9.-]+\\.[A-Za-z]{2,}`,
);

/** Ordered value checks. The first match wins, so the finding names the tightest kind. */
const VALUE_PATTERNS: ReadonlyArray<
  readonly [pattern: RegExp, kind: BrazilReceitaFullJoinLeakKind]
> = [
  [CNPJ_FORMATTED, 'cnpj_completo_like'],
  [CPF_FORMATTED, 'cpf_like'],
  [EMAIL_LIKE, 'email_like'],
  [LINKEDIN_LIKE, 'linkedin_url_like'],
  [PHONE_LIKE, 'phone_like'],
  [CNPJ_CONTINUOUS, 'cnpj_completo_like'],
  [CPF_CONTINUOUS, 'cpf_like'],
  [CNPJ_BASICO_CONTINUOUS, 'cnpj_basico_like'],
  [LONG_DIGIT_RUN, 'cnpj_basico_like'],
  [HEX_DIGEST_LIKE, 'identifier_hash_value'],
  // Last: the tighter identifier kinds above should name a leak before this does.
  [FILESYSTEM_PATH_LIKE, 'filesystem_path_like'],
];

/**
 * A numeric leaf at or beyond this magnitude is rejected. Every legitimate field is
 * an aggregate count or a bounded cap; nothing in a no-write bounded dry-run can
 * legitimately reach eight digits.
 */
export const BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF = 9_999_999 as const;

// ─── Key patterns ─────────────────────────────────────────────────────────────

/**
 * Keys that may only ever carry an EMPTY payload. A non-empty value on any of them
 * is a leak regardless of what the value looks like.
 *
 * Each rule is a MATCHER over the normalized key (lowercase, separators stripped) so
 * `raw_row`, `rawRow`, and `RawRows` resolve to the same rule. Short, ambiguous
 * fragments (`sha`, `cpf`) are matched at a token boundary rather than as a bare
 * substring, so an innocent key such as `shared_scope` or `cpf_free_columns` cannot
 * be mistaken for an identifier field.
 */
const EMPTY_ONLY_KEY_RULES: ReadonlyArray<{
  readonly matches: (normalizedKey: string) => boolean;
  readonly kind: BrazilReceitaFullJoinLeakKind;
}> = [
  { matches: (k) => k.includes('rawrow'), kind: 'raw_row_payload' },
  {
    // BR-SOURCE-11F-IMPL: the required-family probe is the first code path that ever holds a
    // real CELL, so a cell-shaped key gets its own kind rather than sharing `raw_data`. The
    // probe splits a row to COUNT fields and discards them; a report that carries one has
    // kept a value it was only allowed to count.
    matches: (k) =>
      k.includes('rawcell') ||
      k.includes('cellvalue') ||
      k.includes('cellvalues') ||
      k.includes('rawfield') ||
      k.includes('fieldvalue') ||
      k.includes('columnvalue'),
    kind: 'raw_cell_payload',
  },
  {
    // A SAMPLE is forbidden outright (decision record § 8: `samplesAllowed = false`), so a
    // sample-shaped key is a leak even when its payload would have looked innocuous.
    matches: (k) =>
      k.includes('rowsample') ||
      k.includes('samplerow') ||
      k.includes('sampledrow') ||
      k.includes('rowexcerpt') ||
      k.includes('linesample'),
    kind: 'row_sample_payload',
  },
  { matches: (k) => k.includes('rawdata'), kind: 'raw_data_payload' },
  {
    // The manifest may be PARSED; it may never be ECHOED. A report carrying the raw
    // document has leaked declared filenames, paths, and the declared period in one
    // step, which is why raw-manifest output is forbidden even though the manifest is
    // the input (BR-SOURCE-11D-META decision record § 4.3).
    matches: (k) =>
      k.includes('rawmanifest') ||
      k.includes('manifestraw') ||
      k.includes('manifestjson') ||
      k.includes('manifestdocument') ||
      k.includes('manifestbody'),
    kind: 'raw_manifest_payload',
  },
  {
    // A declared FILENAME is operator-environment information, not a class label. A
    // family label (`empresas`) is reportable; the file it names never is — and a
    // relative filename would slip past the absolute-path value pattern, so it is
    // blocked by KEY as well.
    matches: (k) =>
      k.includes('filename') ||
      k.includes('filepath') ||
      k.includes('manifestpath') ||
      k.includes('declaredpath') ||
      k.includes('basename') ||
      k.includes('absolutepath'),
    kind: 'declared_filename_payload',
  },
  {
    // BR-SOURCE-11G-IMPL: the join probe is the first code path that ever holds the protected
    // technical JOIN KEY. It may parse one ephemerally and compare it in memory; it may never
    // emit it (11G decision record § 5). `join_keys_printed: false` still passes — a `false`
    // carries nothing — but any populated join-key-shaped key is a leak.
    matches: (k) =>
      k.includes('joinkey') ||
      k.includes('joinkeys') ||
      k.includes('joinkeyvalue') ||
      k.includes('joinrootkey') ||
      k.includes('cnpjroot') ||
      k.includes('rootkeyvalue'),
    kind: 'join_key_payload',
  },
  {
    // A joined ROW is a materialization the probe never performs: the join is a membership
    // test (§ 8.1). A report carrying one has built a record it was never authorized to build.
    matches: (k) =>
      k.includes('joinedrow') ||
      k.includes('joinrow') ||
      k.includes('joinedrecord') ||
      k.includes('joinedentity'),
    kind: 'joined_row_payload',
  },
  {
    // A joined SAMPLE is forbidden outright (§ 9, `samplesAllowed = false`).
    matches: (k) =>
      k.includes('joinedsample') ||
      k.includes('joinsample') ||
      k.includes('joinedexcerpt') ||
      k.includes('joinexcerpt'),
    kind: 'joined_sample_payload',
  },
  {
    // `maxJoinPairsEmitted = 0` is an equality, not a ceiling (§ 9.1), so a populated pair key
    // — including `joined_pairs_emitted: 1` — is a leak rather than a wider probe.
    matches: (k) =>
      k.includes('joinpair') || k.includes('joinedpair') || k.includes('joinmatchpair'),
    kind: 'join_pair_payload',
  },
  {
    // `coverageAllowed = false` is a REFUSAL, not a labelling rule (§ 9.1): with bounded rows
    // any ratio is a statement about two prefixes. Deliberately narrow — it must fire on a
    // percentage, a ratio or a rate, and NOT on the legitimate bounded-scan guardrail counts
    // (`coverage_scan_limit_reached`) or the held-absence assertions
    // (`coverage_claimed: false`, `join_coverage_computed: false`), which carry nothing.
    matches: (k) =>
      k.includes('coveragepercentage') ||
      k.includes('coverageratio') ||
      k.includes('coveragerate') ||
      k.includes('coveragevalue') ||
      k.includes('coverageclaim') ||
      k.includes('joinrate') ||
      k.includes('matchrate') ||
      k.includes('joinratio') ||
      k.includes('matchratio'),
    kind: 'coverage_payload',
  },
  {
    // A COLLECTION of CNPJ básico / root values — the shape a bounded key window would take if
    // it were ever written out. Narrower than the `cnpjbasico` key rule below on purpose: a
    // single `cnpj_basico` field keeps its own established kind, and this one names the
    // window / list / set shape that only a join probe could produce.
    matches: (k) =>
      k.includes('cnpjbasico') &&
      (k.includes('payload') ||
        k.includes('values') ||
        k.includes('list') ||
        k.includes('window') ||
        k.includes('set')),
    kind: 'cnpj_basico_payload',
  },
  {
    matches: (k) => k.includes('cnpjcompleto') || k.includes('cnpjfull') || k.includes('fullcnpj'),
    kind: 'cnpj_completo_payload',
  },
  { matches: (k) => k.includes('identitykey'), kind: 'record_identity_key_value' },
  { matches: (k) => k.includes('normalizedtaxid'), kind: 'normalized_tax_id_value' },
  { matches: (k) => k.includes('cnpjbasico'), kind: 'cnpj_basico_key_value' },
  { matches: (k) => k.includes('cnpj'), kind: 'cnpj_key_value' },
  { matches: (k) => k === 'cpf' || k.startsWith('cpf') || k.endsWith('cpf'), kind: 'cpf_key_value' },
  {
    // `sha` is matched only as a standalone key or with a digest width attached, so
    // an innocent key such as `shared_scope` is not mistaken for a hash field.
    matches: (k) =>
      k.includes('hash') ||
      k.includes('fingerprint') ||
      k.includes('digest') ||
      k === 'sha' ||
      /sha(1|256|512)/.test(k),
    kind: 'identifier_hash_value',
  },
];

/**
 * Keys that legitimately CONTAIN a blocked fragment because they ASSERT THE ABSENCE
 * of the thing (`cnpj_basico_printed: false`, `identity_keys_constructed: false`).
 *
 * The exemption applies ONLY when the value is literally `false` — the assertion
 * holding. A `*_printed: true`, or a string/number on such a key, is treated as a
 * declared leak and still reported.
 */
function isHeldAbsenceAssertion(normalizedKey: string, value: unknown): boolean {
  if (value !== false) return false;
  return (
    normalizedKey.endsWith('printed') ||
    normalizedKey.endsWith('constructed') ||
    normalizedKey.endsWith('persisted') ||
    normalizedKey.endsWith('detected')
  );
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when a keyed payload is structurally empty and therefore carries nothing. */
function isEmptyPayload(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value === false;
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

// ─── Walk ─────────────────────────────────────────────────────────────────────

/** Bounds the recursive walk so a cyclic or pathological report cannot hang it. */
const MAX_REPORT_WALK_DEPTH = 12;

function checkStringValue(
  text: string,
  path: string,
  findings: BrazilReceitaFullJoinSanitizerFinding[],
): void {
  for (const [pattern, kind] of VALUE_PATTERNS) {
    if (pattern.test(text)) {
      findings.push({ kind, path });
      return;
    }
  }
}

function checkNumberValue(
  value: number,
  path: string,
  findings: BrazilReceitaFullJoinSanitizerFinding[],
): void {
  if (!Number.isFinite(value)) {
    findings.push({ kind: 'oversized_numeric_value', path });
    return;
  }
  if (Math.abs(value) > BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF) {
    findings.push({ kind: 'oversized_numeric_value', path });
  }
}

function walk(
  value: unknown,
  path: string,
  depth: number,
  seen: WeakSet<object>,
  findings: BrazilReceitaFullJoinSanitizerFinding[],
): void {
  if (depth > MAX_REPORT_WALK_DEPTH) return;

  if (typeof value === 'string') {
    checkStringValue(value, path, findings);
    return;
  }
  if (typeof value === 'number') {
    checkNumberValue(value, path, findings);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.forEach((item, index) => {
      walk(item, `${path}[${index}]`, depth + 1, seen, findings);
    });
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    const childPath = path === '' ? key : `${path}.${key}`;
    const normalized = normalizeKey(key);

    if (!isHeldAbsenceAssertion(normalized, child) && !isEmptyPayload(child)) {
      for (const rule of EMPTY_ONLY_KEY_RULES) {
        if (rule.matches(normalized)) {
          findings.push({ kind: rule.kind, path: childPath });
          break;
        }
      }
    }
    walk(child, childPath, depth + 1, seen, findings);
  }
}

// ─── Public entry points ──────────────────────────────────────────────────────

/**
 * Validates a report tree. PURE. Returns every finding (kind + sanitized key path)
 * so the caller can fail closed; never throws on a leak and never echoes a value.
 */
export function sanitizeBrazilReceitaFullJoinReport(
  report: unknown,
): BrazilReceitaFullJoinSanitizerResult {
  const findings: BrazilReceitaFullJoinSanitizerFinding[] = [];
  walk(report, '', 0, new WeakSet<object>(), findings);
  if (findings.length === 0) return SANITIZER_PASSED;
  return { ok: false, findings };
}

/**
 * Validates an ALREADY-RENDERED string (JSON or text). Applies the same value
 * patterns, so a leak introduced by rendering rather than by the report tree is
 * still caught. `path` on a finding is `<rendered>` — there is no key path to name.
 */
export function sanitizeBrazilReceitaFullJoinRenderedOutput(
  rendered: string,
): BrazilReceitaFullJoinSanitizerResult {
  const findings: BrazilReceitaFullJoinSanitizerFinding[] = [];
  checkStringValue(rendered, '<rendered>', findings);
  if (findings.length === 0) return SANITIZER_PASSED;
  return { ok: false, findings };
}
