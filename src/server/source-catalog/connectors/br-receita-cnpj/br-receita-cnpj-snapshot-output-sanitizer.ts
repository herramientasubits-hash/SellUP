/**
 * BR Receita CNPJ — SNAPSHOT / MATERIALIZED-OUTPUT sanitizer (GATE-3 hardening).
 *
 * Hito: BR-SOURCE-GATE3-CNPJ-OUTPUT-HARDENING.
 *
 * ── Why this module exists ─────────────────────────────────────────────────────
 * Two different Brazil surfaces need sanitizing and they are NOT the same thing:
 *
 *   1. a full-join dry-run REPORT — aggregates and counts, guarded by
 *      `br-receita-cnpj-full-join-output-sanitizer.ts` (keys AND values, already);
 *   2. a MATERIALIZED SNAPSHOT ROW — the registral payload the snapshot builder
 *      shapes for a later, separately-approved writer. That surface was guarded by
 *      the builder's own `assertSanitizedRawData`, which inspected KEYS ONLY.
 *
 * A key-only check cannot see a prohibited VALUE sitting under a permitted key, so
 * a CNPJ básico could be carried out of the builder in `cnpj_root` — a key nothing
 * in the old blocklist named — and three separate fields (`cnpj_root` +
 * `cnpj_order` + `cnpj_dv`) could be recombined by any reader into the full CNPJ.
 * This module closes that gap for surface (2).
 *
 * ── The rule it enforces (GATE-1 approval record, R4) ──────────────────────────
 * "CNPJ básico and full CNPJ are both categorically non-printable and
 * non-persistible — no hash, truncation or fingerprint of either, anywhere."
 *
 * Therefore a snapshot row may not carry, under ANY key:
 *   - a full CNPJ, numeric or alphanumeric (§ 3.1/§ 3.4, effective July 2026);
 *   - a CNPJ básico / raiz;
 *   - separate parts that RECOMBINE into a DV-valid full CNPJ;
 *   - a hash / truncation / fingerprint of either;
 *   - CPF, Socios/QSA, or any person-linked field.
 *
 * ── The CNPJ authority is NOT re-implemented here ──────────────────────────────
 * Full-CNPJ detection delegates to `findBrazilCnpjLikeIdentifiers`
 * (`br-receita-cnpj-identifier-shape.ts`), which is itself DV-validated by
 * `normalizeBrazilCnpj` in `br-cnpj.ts`. There is exactly one CNPJ grammar and one
 * módulo-11 DV algorithm in this connector and this module does not add a second.
 *
 * ── Why the root rule is context-aware, not "8 digits anywhere" ───────────────
 * A CNPJ básico carries NO check digit, so it cannot be DV-validated the way a full
 * CNPJ can — shape is all there is. An indiscriminate "8 alphanumerics anywhere"
 * rule would reject perfectly ordinary registral values: `start_date` is `YYYYMMDD`
 * in the real Receita layout (8 digits), and `capital_social_value` of
 * `12345678.00` contains an 8-digit run. Both are legitimate business data and
 * neither is an identifier.
 *
 * So the root rule is scoped by the CLOSED FIELD ALLOWLIST below: every permitted
 * output field declares the value SHAPE it is allowed to carry, and the root-run
 * rule is waived only where that declared shape independently explains the run —
 * a `date_yyyymmdd` field whose value really parses as a plausible calendar date, a
 * `monetary` field whose value really is a decimal amount, a `row_index` that
 * really is a bounded integer. Anywhere else an 8-character `[A-Z0-9]` run is
 * treated as root material and rejected. A field whose declared shape does not
 * match its value gets no waiver — the waiver is earned by the value, not granted
 * by the key.
 *
 * ── This module NEVER ──────────────────────────────────────────────────────────
 *   - returns, logs, or echoes the offending value or any fragment of it. A finding
 *     names the KIND and the sanitized key PATH, nothing else.
 *   - performs I/O. It is pure and can be applied at any layer, in any order.
 *   - decides policy. It enforces the allowlist; widening the allowlist is a GATE-3
 *     owner decision recorded in a decision record, never a code edit alone.
 */

import { findBrazilCnpjLikeIdentifiers } from './br-receita-cnpj-identifier-shape';

// ─── Finding kinds ────────────────────────────────────────────────────────────

/** What kind of prohibited content was detected. Never carries the value itself. */
export type BrReceitaCnpjSnapshotLeakKind =
  /** A DV-valid full CNPJ (numeric or alphanumeric) present as a value. */
  | 'cnpj_completo_value'
  /** A CNPJ básico / raiz-shaped value on a field whose declared shape does not explain it. */
  | 'cnpj_basico_value'
  /** Separate fields that recombine into a DV-valid full CNPJ. */
  | 'reconstructable_cnpj_parts'
  /** A hash / truncation / fingerprint of an identifier, by key. */
  | 'identifier_derivative_key'
  /** A hash / truncation / fingerprint of an identifier, by value shape. */
  | 'identifier_derivative_value'
  /** A CPF-shaped value. */
  | 'cpf_value'
  /** A key naming CNPJ / tax-identity material. */
  | 'cnpj_identity_key'
  /** A key naming a person, Socios/QSA or CPF concept. */
  | 'person_linked_key'
  /** A key naming a contact or fine-grained-address concept. */
  | 'contact_or_address_key'
  /** A key that is not on the closed output allowlist at all. */
  | 'unallowlisted_output_key';

export const BR_RECEITA_CNPJ_SNAPSHOT_LEAK_KINDS: readonly BrReceitaCnpjSnapshotLeakKind[] = [
  'cnpj_completo_value',
  'cnpj_basico_value',
  'reconstructable_cnpj_parts',
  'identifier_derivative_key',
  'identifier_derivative_value',
  'cpf_value',
  'cnpj_identity_key',
  'person_linked_key',
  'contact_or_address_key',
  'unallowlisted_output_key',
];

/** One finding. `path` is a dotted KEY path — never a value, never a path on disk. */
export interface BrReceitaCnpjSnapshotSanitizerFinding {
  readonly kind: BrReceitaCnpjSnapshotLeakKind;
  readonly path: string;
}

export interface BrReceitaCnpjSnapshotSanitizerResult {
  readonly ok: boolean;
  readonly findings: readonly BrReceitaCnpjSnapshotSanitizerFinding[];
}

const SANITIZER_PASSED: BrReceitaCnpjSnapshotSanitizerResult = { ok: true, findings: [] };

// ─── Closed output allowlist (§ 6 — no arbitrary source blob, no passthrough) ──

/**
 * The value SHAPE a permitted field is allowed to carry. Only the shapes marked
 * below waive the CNPJ-básico run rule, and only when the value actually matches.
 */
export type BrReceitaCnpjOutputValueShape =
  /** Free text (a legal name, a label). No run waiver. */
  | 'text'
  /** A short registral code or flag (2–7 chars). No run waiver — too short to matter. */
  | 'short_code'
  /** A list of short registral codes. No run waiver. */
  | 'short_code_list'
  /** `YYYY-MM` or `YYYYMMDD`. Waives the run rule when it parses as a plausible date. */
  | 'date'
  /** A decimal monetary amount. Waives the run rule when it matches the money shape. */
  | 'monetary'
  /** A bounded non-negative integer. Waives the run rule when it really is one. */
  | 'row_index'
  /** `true` / `false` only. */
  | 'boolean'
  /** A fixed literal declared by the parser (source_type, parser_version). */
  | 'literal'
  /** Operator-supplied provenance metadata (file name, timestamp, batch id). */
  | 'provenance';

/**
 * The CLOSED allowlist of `raw_data` keys, each with the value shape it may carry.
 *
 * GATE-3 hardening removed `cnpj_root`, `cnpj_order` and `cnpj_dv` from this list:
 * `cnpj_root` IS the CNPJ básico, and the three together recombine into the full
 * CNPJ. `capital_social_value` is DELIBERATELY retained — its inclusion is a
 * business-scope question for the GATE-3 owner, not a privacy defect, and this
 * hardening does not silently narrow enrichment scope.
 */
export const BR_RECEITA_CNPJ_ALLOWED_RAW_DATA_FIELDS: Readonly<
  Record<string, BrReceitaCnpjOutputValueShape>
> = Object.freeze({
  source_type: 'literal',
  human_review_required: 'boolean',
  parser_version: 'literal',
  source_period: 'date',
  source_row_index: 'row_index',
  source_file_name: 'provenance',
  source_downloaded_at: 'provenance',
  import_batch_id: 'provenance',

  matrix_branch_flag: 'short_code',

  legal_nature_code: 'short_code',
  legal_nature_label: 'text',
  company_size_code: 'short_code',
  capital_social_value: 'monetary',

  registration_status_code: 'short_code',
  registration_status_label: 'text',

  cnae_main_code: 'short_code',
  cnae_main_label: 'text',
  cnae_secondary_codes: 'short_code_list',

  municipality_code: 'short_code',
  municipality_name: 'text',
  uf: 'short_code',

  start_date: 'date',

  simples_opt_in: 'boolean',
  simei_opt_in: 'boolean',
  mei_flag: 'boolean',
});

/**
 * The CLOSED allowlist of TOP-LEVEL snapshot-row keys.
 *
 * GATE-3 hardening removed `tax_id` (raw full CNPJ), `normalized_tax_id`
 * (normalized full CNPJ) and `record_identity_key` (`tax:<normalized_14>`, which
 * embeds the full CNPJ verbatim). All three are full-CNPJ material under R4. The
 * builder still RESOLVES them internally — DV validation and duplicate-identity
 * rejection are unchanged — it simply does not carry them out.
 */
export const BR_RECEITA_CNPJ_ALLOWED_SNAPSHOT_FIELDS: Readonly<
  Record<string, BrReceitaCnpjOutputValueShape | 'raw_data'>
> = Object.freeze({
  source_key: 'literal',
  country_code: 'literal',
  source_year: 'row_index',
  legal_name: 'text',
  raw_data: 'raw_data',
});

// ─── Key rules ────────────────────────────────────────────────────────────────

/** `cnpj_root`, `cnpjRoot` and `CNPJ-Root` all squash to `cnpjroot`. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Splits a key into lowercase words, on both separators and camelCase boundaries,
 * so `sourceRowIndex` → `source`, `row`, `index`.
 *
 * Short fragments MUST be matched against these words rather than against the
 * squashed key: `cep` is a substring of `source_period` (…sour-CEP-eriod…) and
 * `ddd` of any key with a doubled `d` next to another. A squashed-substring rule on
 * a three-letter fragment does not detect an address field, it detects the
 * alphabet. This is the same class of bug as grepping a raw file body and calling a
 * word in a sentence a code reference.
 */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

/** Short, ambiguous fragments — matched as a whole word or a word PREFIX only. */
const SHORT_WORD_FRAGMENTS = {
  person: ['cpf', 'qsa'],
  contact: ['cep', 'ddd', 'fax'],
  derivative: ['sha'],
} as const;

function hasWordFragment(words: readonly string[], fragments: readonly string[]): boolean {
  return words.some((word) => fragments.some((fragment) => word.startsWith(fragment)));
}

/**
 * Key rules, ordered so the finding names the tightest kind.
 *
 * These fire regardless of the value: a key that NAMES prohibited material is a
 * contract breach even when the value happens to be null, because the shape has
 * been re-opened. That is the opposite of the report sanitizer's empty-payload
 * tolerance, and deliberately so — a report is a rendering, a snapshot row is a
 * schema.
 */
const PROHIBITED_KEY_RULES: ReadonlyArray<{
  readonly matches: (normalizedKey: string, words: readonly string[]) => boolean;
  readonly kind: BrReceitaCnpjSnapshotLeakKind;
}> = [
  {
    matches: (k, words) =>
      k.includes('socio') ||
      k.includes('representante') ||
      k.includes('faixaetaria') ||
      k.includes('pessoafisica') ||
      hasWordFragment(words, SHORT_WORD_FRAGMENTS.person),
    kind: 'person_linked_key',
  },
  {
    matches: (k, words) =>
      k.includes('telefone') ||
      k.includes('correio') ||
      k.includes('email') ||
      k.includes('logradouro') ||
      k.includes('numero') ||
      k.includes('complemento') ||
      k.includes('bairro') ||
      hasWordFragment(words, SHORT_WORD_FRAGMENTS.contact),
    kind: 'contact_or_address_key',
  },
  {
    matches: (k, words) =>
      k.includes('hash') ||
      k.includes('fingerprint') ||
      k.includes('digest') ||
      k.includes('truncat') ||
      k.includes('safeidentifier') ||
      k.includes('maskedidentifier') ||
      hasWordFragment(words, SHORT_WORD_FRAGMENTS.derivative),
    kind: 'identifier_derivative_key',
  },
  {
    matches: (k) =>
      k.includes('cnpj') ||
      k.includes('raiz') ||
      k.includes('basico') ||
      k.includes('taxid') ||
      k.includes('identitykey') ||
      k.includes('recordidentity'),
    kind: 'cnpj_identity_key',
  },
];

// ─── Value rules ──────────────────────────────────────────────────────────────

/**
 * A CNPJ básico / raiz-shaped run: exactly 8 chars in [A-Z0-9], containing at
 * least one DIGIT, and not touching another alphanumeric on either side.
 * Quantifiers only — no identifier literal of any length lives in this file.
 *
 * The digit requirement is what makes the rule usable on free text. Without it
 * every ordinary eight-letter word is a "leaked raiz": `official_registry` (the
 * parser's own `source_type` literal), `Limitada` inside a legal-nature label, and
 * most Portuguese registral vocabulary would all fire. With it, an all-numeric
 * raiz and every mixed alphanumeric raiz still match, and words do not.
 *
 * Residual, stated rather than hidden: a raiz composed ENTIRELY of letters would
 * not match. The July-2026 format permits one, and the only output fields that
 * could conceal it are the free-text name/label fields — which GATE-3 governs as
 * "sanitized legal_name" and code labels, not as identifier carriers. If the owner
 * wants that residual closed, it is closed by narrowing those fields, not by
 * re-opening this rule onto every word in the row.
 */
const CNPJ_BASICO_RUN = /(?<![A-Za-z0-9])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{8}(?![A-Za-z0-9])/;
/** CPF: 11 continuous digits, or the punctuated form. */
const CPF_CONTINUOUS = /(?<!\d)\d{11}(?!\d)/;
const CPF_FORMATTED = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/;
/**
 * A hex-digest-shaped run of 12 or more chars that contains at least one DIGIT.
 * The digit requirement is what keeps ordinary words out: a legal name can be a
 * long run of letters that all happen to fall in `a`–`f`, but it will not carry a
 * digit inside that run. 12 is the width the connector's own truncated SHA-256
 * helper produces, so the rule catches the derivative this codebase can build.
 */
const HEX_DIGEST_RUN = /(?<![0-9a-f])(?=[0-9a-f]*\d)[0-9a-f]{12,}(?![0-9a-f])/i;

/** `YYYY-MM`, `YYYY-MM-DD` or `YYYYMMDD`, with a plausible month and day. */
const DATE_SHAPES: readonly RegExp[] = [
  /^(\d{4})-(\d{2})$/,
  /^(\d{4})-(\d{2})-(\d{2})$/,
  /^(\d{4})(\d{2})(\d{2})$/,
];

/** A decimal monetary amount: digits, optional grouping, optional 1–2 decimals. */
const MONETARY_SHAPE = /^-?\d{1,15}(?:[.,]\d{1,2})?$/;

/** True when `value` really is a plausible calendar date, not just date-shaped. */
function isPlausibleDate(value: string): boolean {
  for (const shape of DATE_SHAPES) {
    const match = shape.exec(value);
    if (match === null) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] === undefined ? 1 : Number(match[3]);
    if (year < 1500 || year > 2999) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    return true;
  }
  return false;
}

/**
 * True when the field's DECLARED shape independently explains an 8-character run,
 * AND the value actually matches that shape. The waiver is earned by the value:
 * a `date` field carrying something that is not a date gets no waiver.
 */
function runIsExplainedByDeclaredShape(
  shape: BrReceitaCnpjOutputValueShape | undefined,
  value: string,
): boolean {
  if (shape === 'date') return isPlausibleDate(value);
  if (shape === 'monetary') return MONETARY_SHAPE.test(value);
  if (shape === 'row_index') return /^\d+$/.test(value);
  return false;
}

// ─── Reconstruction check ─────────────────────────────────────────────────────

/**
 * Bounds the pairwise/triple recombination search. A snapshot row has ~25 leaves,
 * so the bounded search is trivial; the cap only stops a pathological input from
 * turning the check into a hot loop.
 */
const MAX_RECONSTRUCTION_LEAVES = 40;

/**
 * A leaf that could be a CNPJ FRAGMENT: 1–13 chars, alphanumeric only, and
 * carrying at least one DIGIT.
 *
 * The digit requirement is the same discipline as `CNPJ_BASICO_RUN` and for the
 * same reason. Without it any eight-letter place or company name is a candidate
 * fragment, and with ~12 leaves per row the chance that some pair or triple happens
 * to satisfy two independent módulo-11 check digits stops being negligible — a real
 * false positive was observed on an ordinary municipality name before this
 * constraint existed. Every part of a real CNPJ carries digits: `cnpj_ordem` and
 * the DV are numeric, and a raiz is numeric or mixed. The residual — a raiz of pure
 * letters — is the one already stated on `CNPJ_BASICO_RUN`.
 */
const CNPJ_FRAGMENT_SHAPE = /^(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{1,13}$/;

interface OutputLeaf {
  readonly path: string;
  readonly text: string;
}

/**
 * True when two or three of the row's own leaves, concatenated in the order they
 * appear, form a DV-valid full CNPJ. This is the direct test of "no reconstructable
 * CNPJ parts in materialized output": the old contract failed it because
 * `cnpj_root` + `cnpj_order` + `cnpj_dv` recombined exactly.
 *
 * DV validation is what makes it usable rather than noise: an arbitrary pair of
 * registral codes concatenating to 14 chars still has to satisfy two independent
 * módulo-11 check digits, which happens by chance about 1 time in 10,000.
 */
function findReconstructableCnpj(leaves: readonly OutputLeaf[]): string | null {
  const fragments = leaves
    .filter((leaf) => CNPJ_FRAGMENT_SHAPE.test(leaf.text))
    .slice(0, MAX_RECONSTRUCTION_LEAVES);

  for (let a = 0; a < fragments.length; a++) {
    for (let b = 0; b < fragments.length; b++) {
      if (b === a) continue;
      const pair = `${fragments[a]!.text}${fragments[b]!.text}`;
      if (pair.length === 14 && findBrazilCnpjLikeIdentifiers(pair).length > 0) {
        return `${fragments[a]!.path}+${fragments[b]!.path}`;
      }
      if (pair.length >= 14) continue;
      for (let c = 0; c < fragments.length; c++) {
        if (c === a || c === b) continue;
        const triple = `${pair}${fragments[c]!.text}`;
        if (triple.length === 14 && findBrazilCnpjLikeIdentifiers(triple).length > 0) {
          return `${fragments[a]!.path}+${fragments[b]!.path}+${fragments[c]!.path}`;
        }
      }
    }
  }
  return null;
}

// ─── Walk ─────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKey(
  key: string,
  path: string,
  findings: BrReceitaCnpjSnapshotSanitizerFinding[],
): void {
  const normalized = normalizeKey(key);
  const words = keyWords(key);
  for (const rule of PROHIBITED_KEY_RULES) {
    if (rule.matches(normalized, words)) {
      findings.push({ kind: rule.kind, path });
      return;
    }
  }
}

function checkValue(
  value: unknown,
  path: string,
  shape: BrReceitaCnpjOutputValueShape | undefined,
  findings: BrReceitaCnpjSnapshotSanitizerFinding[],
  leaves: OutputLeaf[],
): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'boolean') return;

  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  if (text === null) return;
  if (text.trim() === '') return;

  leaves.push({ path, text });

  // Full CNPJ — numeric or alphanumeric, DV-validated by the canonical helper.
  if (findBrazilCnpjLikeIdentifiers(text).length > 0) {
    findings.push({ kind: 'cnpj_completo_value', path });
    return;
  }
  if (CPF_FORMATTED.test(text) || CPF_CONTINUOUS.test(text)) {
    findings.push({ kind: 'cpf_value', path });
    return;
  }
  if (HEX_DIGEST_RUN.test(text)) {
    findings.push({ kind: 'identifier_derivative_value', path });
    return;
  }
  // CNPJ básico / raiz. Context-aware: waived only when the field's declared shape
  // is one that can explain an 8-character run AND the value really matches it.
  if (CNPJ_BASICO_RUN.test(text) && !runIsExplainedByDeclaredShape(shape, text)) {
    findings.push({ kind: 'cnpj_basico_value', path });
  }
}

function walkRawData(
  rawData: Record<string, unknown>,
  basePath: string,
  findings: BrReceitaCnpjSnapshotSanitizerFinding[],
  leaves: OutputLeaf[],
): void {
  for (const [key, value] of Object.entries(rawData)) {
    const path = `${basePath}.${key}`;
    checkKey(key, path, findings);
    const shape = BR_RECEITA_CNPJ_ALLOWED_RAW_DATA_FIELDS[key];
    if (shape === undefined) {
      findings.push({ kind: 'unallowlisted_output_key', path });
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        checkValue(item, `${path}[${index}]`, shape, findings, leaves);
      });
      continue;
    }
    if (isRecord(value)) {
      // A nested object under an allowlisted scalar key is an arbitrary source blob.
      findings.push({ kind: 'unallowlisted_output_key', path });
      continue;
    }
    checkValue(value, path, shape, findings, leaves);
  }
}

/**
 * Validates ONE materialized snapshot row (keys AND values). PURE. Returns every
 * finding so the caller can fail closed; never throws on a leak and never echoes a
 * value.
 */
export function sanitizeBrReceitaCnpjSnapshotRow(
  row: unknown,
): BrReceitaCnpjSnapshotSanitizerResult {
  const findings: BrReceitaCnpjSnapshotSanitizerFinding[] = [];
  const leaves: OutputLeaf[] = [];

  if (!isRecord(row)) {
    return { ok: false, findings: [{ kind: 'unallowlisted_output_key', path: '<root>' }] };
  }

  for (const [key, value] of Object.entries(row)) {
    checkKey(key, key, findings);
    const declared = BR_RECEITA_CNPJ_ALLOWED_SNAPSHOT_FIELDS[key];
    if (declared === undefined) {
      findings.push({ kind: 'unallowlisted_output_key', path: key });
      continue;
    }
    if (declared === 'raw_data') {
      if (!isRecord(value)) {
        findings.push({ kind: 'unallowlisted_output_key', path: key });
        continue;
      }
      walkRawData(value, key, findings, leaves);
      continue;
    }
    checkValue(value, key, declared, findings, leaves);
  }

  const reconstruction = findReconstructableCnpj(leaves);
  if (reconstruction !== null) {
    findings.push({ kind: 'reconstructable_cnpj_parts', path: reconstruction });
  }

  if (findings.length === 0) return SANITIZER_PASSED;
  return { ok: false, findings };
}

/** Validates every row of a materialized batch. PURE. Findings are path-prefixed. */
export function sanitizeBrReceitaCnpjSnapshotRows(
  rows: readonly unknown[],
): BrReceitaCnpjSnapshotSanitizerResult {
  const findings: BrReceitaCnpjSnapshotSanitizerFinding[] = [];
  rows.forEach((row, index) => {
    for (const finding of sanitizeBrReceitaCnpjSnapshotRow(row).findings) {
      findings.push({ kind: finding.kind, path: `[${index}].${finding.path}` });
    }
  });
  if (findings.length === 0) return SANITIZER_PASSED;
  return { ok: false, findings };
}

/**
 * Validates a REJECTION row. Rejections are the other materialized output the
 * builder produces, and the pre-hardening shape carried a truncated SHA-256 of the
 * full CNPJ under `safeIdentifier` — a prohibited derivative under R4, which
 * forbids a hash or truncation of the identifier "anywhere". A rejection may name
 * the reason, the source row index and the source file; it may not name the record.
 */
export const BR_RECEITA_CNPJ_ALLOWED_REJECTION_FIELDS: Readonly<
  Record<string, BrReceitaCnpjOutputValueShape>
> = Object.freeze({
  sourceRowIndex: 'row_index',
  reasonCode: 'literal',
  sourceFile: 'provenance',
});

export function sanitizeBrReceitaCnpjRejectionRow(
  row: unknown,
): BrReceitaCnpjSnapshotSanitizerResult {
  const findings: BrReceitaCnpjSnapshotSanitizerFinding[] = [];
  const leaves: OutputLeaf[] = [];

  if (!isRecord(row)) {
    return { ok: false, findings: [{ kind: 'unallowlisted_output_key', path: '<root>' }] };
  }
  for (const [key, value] of Object.entries(row)) {
    checkKey(key, key, findings);
    const shape = BR_RECEITA_CNPJ_ALLOWED_REJECTION_FIELDS[key];
    if (shape === undefined) {
      findings.push({ kind: 'unallowlisted_output_key', path: key });
      continue;
    }
    checkValue(value, key, shape, findings, leaves);
  }
  if (findings.length === 0) return SANITIZER_PASSED;
  return { ok: false, findings };
}
