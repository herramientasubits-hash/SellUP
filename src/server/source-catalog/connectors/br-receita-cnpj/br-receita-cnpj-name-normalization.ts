/**
 * BR Receita CNPJ — the ONE canonical Brazilian name normalizer.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-C — candidate → Receita identity resolution.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PURE. No client, no query, no filesystem, no network, no clock, no random.
 * Nothing here is asynchronous and nothing here has a side effect.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why one function and not two ────────────────────────────────────────────
 *
 * The WRITER persists `normalized_legal_name` and the RESOLVER filters on it. If those two
 * derivations were separate implementations, the first divergence would not be a failing test —
 * it would be a resolver that silently finds NOTHING, which is indistinguishable from "this
 * company is not in Receita". A lookup that fails by returning the honest-looking wrong answer is
 * the worst failure mode available, so symmetry is not a convention here: both sides call THIS
 * function, and the CUT-C suite asserts the value the writer binds equals the value the resolver
 * filters on for the same input.
 *
 * ── 🔴 What this is NOT ─────────────────────────────────────────────────────
 *
 * There is no fuzzy matching anywhere in this module and there is no seam to add one:
 *
 *   · no Levenshtein / edit distance, no trigram similarity, no `pg_trgm`
 *   · no token scoring, no partial or substring match, no prefix match
 *   · no phonetic keys (Soundex, Metaphone), no transliteration tables
 *   · no LLM, no embedding, no "best guess", no confidence below 1
 *
 * The output is a STRING that is either equal to another string or is not. Everything downstream
 * uses `=`, which is what makes the resolution deterministic and what makes an index usable.
 *
 * ── 🔴 Legal suffixes are DELIBERATELY NOT stripped ─────────────────────────
 *
 * Several older connectors in this repository strip legal suffixes when normalizing a name
 * (`normalizeSiisLegalName`, `normalizeChileanLegalName` both drop `LTDA`, `S.A.`, …). That is
 * right for their purpose — fuzzy-ish company matching — and WRONG here, because the suffix is
 * part of the legal person:
 *
 *     ACME LTDA   and   ACME S/A   are two different companies with two different CNPJs.
 *
 * Stripping the suffix merges them into one key, and this module's whole job is to hand a single
 * establishment's CNPJ to an exact lookup. A normalizer that widens the equivalence class widens
 * AMBIGUOUS at best and produces a confident wrong identity at worst. So the suffix stays.
 *
 * ── The transformation, in order ────────────────────────────────────────────
 *
 *   1. reject non-strings outright (a number or an object is not a name)
 *   2. NFD decompose, then DROP combining marks  → accent-insensitive, symmetrically
 *   3. `toUpperCase()`                            → case-insensitive
 *   4. every character outside [A-Z0-9] becomes ONE SPACE  → punctuation normalized EXPLICITLY
 *   5. collapse runs of spaces, trim              → whitespace normalized
 *   6. refuse a result with fewer than `MIN_CANONICAL_NAME_LENGTH` alphanumerics
 *
 * 🔴 Step 4 SEPARATES on punctuation rather than deleting it, and that choice is load-bearing:
 *
 *     delete   "M.DIAS BRANCO" → "MDIAS BRANCO"   ≠   "M DIAS BRANCO"
 *     separate "M.DIAS BRANCO" → "M DIAS BRANCO"  =   "M DIAS BRANCO"
 *
 * Receita and a discovery provider disagree about whether an abbreviation carries its dot far more
 * often than they disagree about the words, so separating is the variant that survives the real
 * difference. Deleting would manufacture a token that appears in neither source.
 *
 * 🔴 `toUpperCase` and not `toLocaleUpperCase`: the locale-aware form depends on the ambient
 * locale, which would make the persisted value depend on the machine that wrote it. Case folding
 * here must be a property of the STRING, not of the process.
 *
 * ── Privacy ─────────────────────────────────────────────────────────────────
 *
 * A razão social is business identity, not personal data, and it is already inside GATE-5's
 * output contract (`legal_name` travels in the public projection). Nothing in this module touches a
 * CNPJ: no function accepts one, returns one, or could construct one.
 */

/**
 * Minimum number of alphanumeric characters a usable canonical name must have.
 *
 * 🔴 TWO, not three. `3M` and `LG` are real companies, and a threshold that rejected them would
 * be a silent coverage hole that looks like "not in Receita". One character is refused because a
 * single letter cannot identify a company and would match an unbounded set.
 */
export const MIN_CANONICAL_NAME_LENGTH = 2;

/** Why a name could not be canonicalized. A CATEGORY — never the rejected value. */
export type BrNameNormalizationReason =
  /** Not a string at all (null, undefined, number, object …). */
  | 'not_a_string'
  /** Empty, whitespace-only, or made entirely of characters that carry no identity. */
  | 'blank_after_normalization'
  /** Canonicalized to fewer than `MIN_CANONICAL_NAME_LENGTH` alphanumerics. */
  | 'too_short_to_identify';

export type BrNameNormalizationResult =
  | { readonly status: 'valid'; readonly normalized: string; readonly reason: null }
  | {
      readonly status: 'invalid';
      readonly normalized: null;
      readonly reason: BrNameNormalizationReason;
    };

/** Combining marks left behind by NFD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Everything that is not a canonical character becomes a separator. */
const NON_CANONICAL = /[^A-Z0-9]+/g;

const WHITESPACE_RUN = / {2,}/g;

/**
 * The shared canonicalization core. Deliberately private: a caller picks a NAMED normalizer
 * (company name, municipality name) so the intent is visible at the call site, and both share
 * exactly one implementation so the two sides of a comparison cannot drift.
 */
function canonicalize(raw: unknown): BrNameNormalizationResult {
  if (typeof raw !== 'string') {
    return { status: 'invalid', normalized: null, reason: 'not_a_string' };
  }

  const canonical = raw
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toUpperCase()
    .replace(NON_CANONICAL, ' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim();

  if (canonical === '') {
    return { status: 'invalid', normalized: null, reason: 'blank_after_normalization' };
  }

  // Spaces do not identify anything; the threshold counts the characters that do.
  const alphanumericCount = canonical.length - (canonical.split(' ').length - 1);
  if (alphanumericCount < MIN_CANONICAL_NAME_LENGTH) {
    return { status: 'invalid', normalized: null, reason: 'too_short_to_identify' };
  }

  return { status: 'valid', normalized: canonical, reason: null };
}

/**
 * The canonical form of a Brazilian company legal name (razão social).
 *
 * 🔴 This is the value that goes into `source_company_snapshots.normalized_legal_name` AND the
 * value a name lookup filters on. Changing it changes both, and a change that is not applied to
 * both is a resolver that finds nothing. Migration 065 created the column and its
 * `(source_key, normalized_legal_name)` index; this function decides what lives there.
 */
export function normalizeBrCompanyLegalName(raw: unknown): BrNameNormalizationResult {
  return canonicalize(raw);
}

/**
 * The canonical form of a Brazilian municipality name.
 *
 * Used on BOTH sides of the location disambiguation: the candidate's `city` and Receita's
 * `raw_data.municipality_name`. Same core as the company name for the same reason — one
 * implementation, so "SÃO PAULO" and "Sao Paulo" cannot be equal on one side and unequal on the
 * other.
 *
 * 🔴 It does NOT map a city to a UF, a municipality CODE or a region. Deriving a state from a city
 * name would be inventing an authority the candidate does not have.
 */
export function normalizeBrMunicipalityName(raw: unknown): BrNameNormalizationResult {
  return canonicalize(raw);
}

/**
 * The normalization contract, as data — so a test asserts the policy rather than a reviewer
 * re-reading the regexes every time one moves.
 */
export const BR_RECEITA_NAME_NORMALIZATION_CONTRACT = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-C',
  deterministic: true,
  unicodeSafe: true,
  caseInsensitive: true,
  accentInsensitive: true,
  whitespaceNormalized: true,
  punctuationNormalized: true,
  /** Punctuation becomes a separator; it is never deleted. See the module note. */
  punctuationBecomesSeparator: true,
  /** The same function is used by the writer and by the resolver. */
  sharedByWriterAndResolver: true,
  /** A legal suffix is part of the legal person and is retained. */
  stripsLegalSuffixes: false,
  usesFuzzyMatching: false,
  usesEditDistance: false,
  usesTrigramSimilarity: false,
  usesPhoneticKeys: false,
  usesTokenScoring: false,
  usesSubstringMatch: false,
  usesLlm: false,
  usesLocaleDependentCaseFolding: false,
  acceptsTaxIdentifier: false,
  returnsTaxIdentifier: false,
  minCanonicalLength: MIN_CANONICAL_NAME_LENGTH,
} as const;
