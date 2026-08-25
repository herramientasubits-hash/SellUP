/**
 * BR Receita CNPJ — the CANDIDATE → RECEITA IDENTITY RESOLVER. Turns a Brazilian company
 * discovered WITHOUT a CNPJ into exactly one establishment of ONE pinned publication, or into an
 * explicit refusal.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-C — candidate → Receita identity resolution.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ-ONLY. ONE SELECT against the snapshot table. No INSERT, no UPDATE, no
 * DELETE, no RPC, no transaction, no migration. No Supabase client is created
 * here: one is injected. No provider, no credit, no HubSpot, no flag.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this closes ────────────────────────────────────────────────────────
 *
 * CUT B2 pinned the publication and enriched every Brazilian candidate that ALREADY had a CNPJ.
 * Agent 1 discovers companies through Apollo, which returns a company name and — for Brazil —
 * essentially never a CNPJ. So the pinned path answered `skipped / missing_cnpj` for the whole
 * discovered population: the snapshot was pinned, published, readable, and unreachable.
 *
 * This module is the fallback, and it is a fallback in the strict sense: it runs ONLY when there
 * is no CNPJ, it never runs alongside one, and what it produces is an INPUT to the existing
 * exact-CNPJ path rather than a second way of enriching.
 *
 * ── 🔴 A razão social is NOT an identity ────────────────────────────────────
 *
 * This is the whole difficulty and it is not a corner case:
 *
 *     ACME LTDA · São Paulo · CNPJ …0001-XX     (matriz)
 *     ACME LTDA · Rio        · CNPJ …0002-XX     (filial)
 *
 * Both rows are real, both are in the same publication, and both carry the SAME legal name because
 * in Brazil the razão social belongs to the COMPANY while the identity grain is the ESTABLISHMENT
 * (GATE-4). An exact, unique, perfectly deterministic name match therefore does NOT authorize
 * picking a row. Two rows is not "pick the better one"; it is a different answer.
 *
 * So the resolver has a closed result set with AMBIGUOUS in it, and AMBIGUOUS is a legitimate,
 * common, non-error outcome that yields NO identity at all.
 *
 * ── 🔴 What this will NOT do, ever ──────────────────────────────────────────
 *
 *   · no fuzzy match, no edit distance, no trigram, no token score, no substring, no LLM
 *   · no `first()`, no `[0]`, no `LIMIT 1`
 *   · no "prefer the matriz", no "prefer the filial" — `matrix_branch_flag` is NOT consulted
 *   · no row order, no `imported_at`, no `created_at`, no lowest/highest CNPJ
 *   · no `latest` publication, no other period, no other run — see the pin note below
 *   · no widening back to the original set when the city filter leaves nothing (§ 7)
 *   · no UF disambiguation: the candidate has no UF authority, and deriving one from a city name
 *     would be inventing the evidence the comparison is supposed to test
 *
 * ── 🔴 The run id cannot come from the caller ───────────────────────────────
 *
 * `BrReceitaCandidateIdentityInput` has NO `snapshotRunId` and NO `sourcePeriod`. Both arrive
 * inside a `BrReceitaPinnedPublication`, which is unforgeable: private constructor, private
 * nominal brand, module-private mint token and a minted-instance registry the guard checks by
 * MEMBERSHIP rather than by `instanceof` (see `br-receita-cnpj-pinned-publication.ts`). A caller
 * therefore cannot ask this resolver to search a publication it chose, and "resolved inside the
 * run's own photograph of Receita" is a type-level fact rather than a discipline.
 *
 * `publish_state` is deliberately NOT re-checked, for the same reason the pinned reader does not
 * re-check it: a run that pinned publication A must finish on A even after A becomes `superseded`.
 *
 * ── 🔴 Bounded, never a national scan ───────────────────────────────────────
 *
 * The query is an EQUALITY probe on `normalized_legal_name` inside one publication, served by
 * migration 065's `(source_key, normalized_legal_name)` index, and it fetches at most
 * `BR_RECEITA_NAME_RESOLUTION_ROW_LIMIT + 1` rows. The `+ 1` is what distinguishes "this many
 * branches" from "more than this resolver is willing to adjudicate": overflowing the window is
 * AMBIGUOUS, never a silent truncation to whatever the first N rows happened to be.
 *
 * ── Privacy (§ 11) ──────────────────────────────────────────────────────────
 *
 * The CNPJ is fetched — it is the answer — and it leaves this module through exactly ONE field, on
 * exactly ONE status. Everything else is category data:
 *
 *   · `resolvedNormalizedTaxId` is populated on `RESOLVED_UNIQUE` and is `null` on every other
 *     status, including AMBIGUOUS. There is no list of candidate CNPJs anywhere on the result
 *     shape, so an ambiguous answer cannot leak one even by a caller's mistake.
 *   · no reason string is ever built from a row value: reasons are fixed categories.
 *   · no driver message is forwarded. A PostgREST error body can quote the filter that failed, and
 *     this filter carries the company's legal name.
 *   · no row, no `raw_data`, no legal name and no municipality is returned to the caller. The
 *     municipality is read, compared, and discarded inside this function.
 */

import { normalizeBrazilCnpj } from './br-cnpj';
import { BR_RECEITA_SNAPSHOT_TABLE } from './br-receita-cnpj-monthly-snapshot-identity';
import {
  normalizeBrCompanyLegalName,
  normalizeBrMunicipalityName,
} from './br-receita-cnpj-name-normalization';
import { SNAPSHOT_RUN_ID_COLUMN } from './br-receita-cnpj-monthly-snapshot-run-handle';
import {
  isBrReceitaPinnedPublication,
  type BrReceitaPinnedPublication,
} from './br-receita-cnpj-pinned-publication';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
} from './br-receita-cnpj-types';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../snapshot-read/snapshot-read-contract';

/** The persisted canonical-name column migration 065 created and CUT C now writes. */
export const BR_RECEITA_NORMALIZED_LEGAL_NAME_COLUMN = 'normalized_legal_name' as const;

/**
 * The two columns the resolution projects.
 *
 * 🔴 `normalized_tax_id` because it IS the answer, and `raw_data` because the municipality that
 * disambiguates branches lives inside it (`raw_data.municipality_name`, an
 * `INCLUDED_OUTPUT` field of GATE-3's closed allowlist). `legal_name` is NOT projected: the filter
 * already proved the canonical name matches, and re-reading the display form would only invite it
 * into a log line.
 */
export const BR_RECEITA_NAME_RESOLUTION_SELECT_COLUMNS =
  'normalized_tax_id, raw_data' as const;

/**
 * How many same-name establishments this resolver is willing to adjudicate.
 *
 * A real Brazilian company can hold many establishments under one razão social, and city
 * disambiguation only helps if the rows are actually in hand — so a window of 2 (enough to tell
 * unique from ambiguous) would collapse every real multi-branch company into AMBIGUOUS without
 * even trying. 25 covers ordinary corporate structures; beyond it the resolver stops rather than
 * paging, because "hundreds of establishments share this name" is not a case a single city string
 * is going to settle.
 */
export const BR_RECEITA_NAME_RESOLUTION_ROW_LIMIT = 25;

export type BrReceitaCandidateIdentityStatus =
  /** Exactly ONE establishment survived every rule. `resolvedNormalizedTaxId` is populated. */
  | 'RESOLVED_UNIQUE'
  /** More than one establishment is still plausible. NO identity is produced. */
  | 'AMBIGUOUS'
  /** Zero establishments survived. Includes "the city filter left nothing" (§ 7). */
  | 'NO_MATCH'
  /** The candidate name is unusable. NO query is sent. */
  | 'INVALID_INPUT'
  /** An operational failure, sanitised. Never a claim about the company. */
  | 'ERROR';

export interface BrReceitaCandidateIdentityResolution {
  readonly status: BrReceitaCandidateIdentityStatus;
  /** A CATEGORY, always safe to log. Never a CNPJ, a name, a city or a driver message. */
  readonly reason: string;
  /** The publication the question was asked of. Log-safe. */
  readonly sourcePeriod: string | null;
  /** The publication run. A VERSION id, never identity. */
  readonly snapshotRunId: string | null;
  /**
   * How many establishments were still plausible when the resolver stopped.
   *
   * On `AMBIGUOUS` this is the authorized non-identifying evidence (§ 11). On
   * `RESOLVED_UNIQUE` it is 1. `null` when no query was sent.
   */
  readonly observedCount: number | null;
  /** True when the candidate's city is what reduced several establishments to one. */
  readonly disambiguatedByCity: boolean;
  /**
   * The resolved establishment identity.
   *
   * 🔴 INTERNAL. Populated ONLY on `RESOLVED_UNIQUE`; `null` on every other status. It exists to
   * be handed to the existing exact-CNPJ adapter and to nothing else: never rendered, never
   * logged, never reported, never a telemetry label and never persisted by this module.
   */
  readonly resolvedNormalizedTaxId: string | null;
}

export interface BrReceitaCandidateIdentityInput {
  readonly client: SnapshotReadClient<SnapshotIdentityRow>;
  /**
   * The publication to resolve INSIDE.
   *
   * 🔴 Not a period and not a run-id string — see the module note. This is the only channel
   * through which a run id can reach the query.
   */
  readonly publication: BrReceitaPinnedPublication;
  /** The candidate's company name (razão social preferred). Canonicalized here. */
  readonly candidateName: unknown;
  /**
   * The candidate's city, when it has one. Optional, and its ABSENCE is a real supported state
   * that yields AMBIGUOUS for a multi-branch name — never a guess.
   */
  readonly candidateCity?: unknown;
}

function outcome(
  status: BrReceitaCandidateIdentityStatus,
  reason: string,
  extra: {
    sourcePeriod?: string | null;
    snapshotRunId?: string | null;
    observedCount?: number | null;
    disambiguatedByCity?: boolean;
    resolvedNormalizedTaxId?: string | null;
  } = {},
): BrReceitaCandidateIdentityResolution {
  return {
    status,
    reason,
    sourcePeriod: extra.sourcePeriod ?? null,
    snapshotRunId: extra.snapshotRunId ?? null,
    observedCount: extra.observedCount ?? null,
    disambiguatedByCity: extra.disambiguatedByCity ?? false,
    resolvedNormalizedTaxId: extra.resolvedNormalizedTaxId ?? null,
  };
}

/**
 * Reads the municipality off a snapshot row's `raw_data`.
 *
 * Defensive on purpose: `raw_data` is JSONB, so its runtime shape is whatever the database holds
 * rather than whatever the TypeScript type promises. A row whose municipality is missing or not a
 * string simply cannot participate in location disambiguation — it is DROPPED from the filtered
 * set, never treated as a wildcard that matches every city.
 */
function municipalityOf(row: Record<string, unknown>): string | null {
  const rawData = row.raw_data;
  if (typeof rawData !== 'object' || rawData === null) {
    return null;
  }
  const municipality = (rawData as Record<string, unknown>).municipality_name;
  const normalized = normalizeBrMunicipalityName(municipality);
  return normalized.status === 'valid' ? normalized.normalized : null;
}

/**
 * Turns ONE surviving row into a resolution, validating its identity first.
 *
 * 🔴 The persisted `normalized_tax_id` is re-validated with the canonical CNPJ normalizer rather
 * than trusted. Migration 127's Brazil CHECK makes a malformed value impossible, and "impossible"
 * is exactly the claim that quietly stops being true — handing a malformed identity to the exact
 * adapter would turn a schema drift into a confident wrong lookup. Fail closed instead.
 */
function resolveFromSingleRow(
  row: Record<string, unknown>,
  publication: BrReceitaPinnedPublication,
  disambiguatedByCity: boolean,
): BrReceitaCandidateIdentityResolution {
  const normalized = normalizeBrazilCnpj(row.normalized_tax_id);
  if (normalized.status !== 'valid' || normalized.normalized === null) {
    return outcome('ERROR', 'resolved_row_carries_invalid_persisted_identity', {
      sourcePeriod: publication.sourcePeriod,
      snapshotRunId: publication.snapshotRunId,
      observedCount: 1,
    });
  }

  return outcome(
    'RESOLVED_UNIQUE',
    disambiguatedByCity
      ? 'unique_after_city_disambiguation'
      : 'unique_exact_normalized_legal_name',
    {
      sourcePeriod: publication.sourcePeriod,
      snapshotRunId: publication.snapshotRunId,
      observedCount: 1,
      disambiguatedByCity,
      resolvedNormalizedTaxId: normalized.normalized,
    },
  );
}

/**
 * Resolves ONE candidate to ONE establishment inside ONE pinned publication.
 *
 * Guard order is load-bearing: the pin and the name are validated BEFORE any query is sent, so a
 * forged pin or a blank name never becomes a database round trip (CASE 13, CASE 19).
 *
 * Never throws. The caller is a batch loop that must survive one bad candidate, and a thrown
 * driver error would land in a `catch` that would probably log it — with the legal name in the
 * filter it quotes.
 */
export async function resolveBrReceitaCandidateIdentity(
  input: BrReceitaCandidateIdentityInput,
): Promise<BrReceitaCandidateIdentityResolution> {
  // ── Guard 1 — the pin must be one this process minted. Zero queries otherwise. ──
  if (!isBrReceitaPinnedPublication(input.publication)) {
    return outcome('ERROR', 'pinned_publication_not_minted_here');
  }
  const { sourcePeriod, snapshotRunId } = input.publication;

  // ── Guard 2 — a usable canonical name. Zero queries otherwise. ──
  const canonicalName = normalizeBrCompanyLegalName(input.candidateName);
  if (canonicalName.status !== 'valid') {
    return outcome('INVALID_INPUT', `candidate_name_${canonicalName.reason}`, {
      sourcePeriod,
      snapshotRunId,
    });
  }

  // ── The read. Scoped by all four publication columns PLUS the canonical name. ──
  // `.limit(LIMIT + 1)`: the extra row is how "more than this resolver adjudicates" is DETECTED
  // rather than silently truncated away.
  let rows: ReadonlyArray<Record<string, unknown>>;
  try {
    const { data, error } = await input.client
      .from(BR_RECEITA_SNAPSHOT_TABLE)
      .select(BR_RECEITA_NAME_RESOLUTION_SELECT_COLUMNS)
      .eq('source_key', BR_RECEITA_CNPJ_SOURCE_KEY)
      .eq('country_code', BR_RECEITA_CNPJ_COUNTRY_CODE)
      .eq('source_period', sourcePeriod)
      .eq(SNAPSHOT_RUN_ID_COLUMN, snapshotRunId)
      .eq(BR_RECEITA_NORMALIZED_LEGAL_NAME_COLUMN, canonicalName.normalized)
      .limit(BR_RECEITA_NAME_RESOLUTION_ROW_LIMIT + 1);

    if (error) {
      // 🔴 Only the fact of failure. No code, no message, no detail: the filter this query sent
      // carries the company's legal name, and a PostgREST error body may quote it.
      return outcome('ERROR', 'name_resolution_query_failed', { sourcePeriod, snapshotRunId });
    }
    if (data === null) {
      // A list query returns an array on success. A null payload with no error is a transport
      // state, not "this company is not in Receita" — never converted into a domain answer.
      return outcome('ERROR', 'name_resolution_query_returned_no_data', {
        sourcePeriod,
        snapshotRunId,
      });
    }
    rows = data as unknown as ReadonlyArray<Record<string, unknown>>;
  } catch {
    return outcome('ERROR', 'name_resolution_query_threw', { sourcePeriod, snapshotRunId });
  }

  // ── Zero. ──
  if (rows.length === 0) {
    return outcome('NO_MATCH', 'no_establishment_with_exact_normalized_legal_name', {
      sourcePeriod,
      snapshotRunId,
      observedCount: 0,
    });
  }

  // ── More than the window. Reported, NEVER truncated to the first N. ──
  if (rows.length > BR_RECEITA_NAME_RESOLUTION_ROW_LIMIT) {
    return outcome('AMBIGUOUS', 'too_many_name_matches_to_adjudicate', {
      sourcePeriod,
      snapshotRunId,
      observedCount: rows.length,
    });
  }

  // ── Exactly one. The only branch that produces an identity without further evidence. ──
  if (rows.length === 1) {
    return resolveFromSingleRow(rows[0], input.publication, false);
  }

  // ── Several establishments share the name. The FIRST authorized disambiguator is the city. ──
  const canonicalCity = normalizeBrMunicipalityName(input.candidateCity);
  if (canonicalCity.status !== 'valid') {
    // 🔴 No city ⇒ no evidence ⇒ no pick. Not an error, and not a licence to guess.
    return outcome('AMBIGUOUS', 'multiple_name_matches_and_no_usable_candidate_city', {
      sourcePeriod,
      snapshotRunId,
      observedCount: rows.length,
    });
  }

  const cityMatches = rows.filter(
    (row) => municipalityOf(row) === canonicalCity.normalized,
  );

  if (cityMatches.length === 0) {
    // 🔴 NO_MATCH, and deliberately NOT a fall back to the unfiltered set (§ 7). "Several
    // companies carry this name and none of them is in the candidate's city" is evidence AGAINST
    // every one of them; returning to the original set would use the city only when it helped.
    return outcome('NO_MATCH', 'insufficient_location_match', {
      sourcePeriod,
      snapshotRunId,
      observedCount: 0,
    });
  }

  if (cityMatches.length === 1) {
    return resolveFromSingleRow(cityMatches[0], input.publication, true);
  }

  // Two establishments of the same company in the same municipality. Real, and unresolvable with
  // the evidence this cut authorizes.
  return outcome('AMBIGUOUS', 'multiple_name_matches_in_same_municipality', {
    sourcePeriod,
    snapshotRunId,
    observedCount: cityMatches.length,
  });
}

/**
 * The contract this resolver satisfies, as data — so a test asserts the policy rather than a
 * reviewer re-reading the branches every time one moves.
 */
export const BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-C',
  appliesToSourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
  countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
  // ── Scope ────────────────────────────────────────────────────────────────
  requiresMintedPin: true,
  acceptsRunIdAsPlainString: false,
  acceptsSourcePeriodFromCaller: false,
  scopedBySourceKey: true,
  scopedByCountryCode: true,
  scopedBySourcePeriod: true,
  scopedBySnapshotRunId: true,
  scopedByNormalizedLegalName: true,
  resolvesLatestPublication: false,
  readsAnotherPeriod: false,
  readsAnotherRun: false,
  reChecksPublishStateAtReadTime: false,
  // ── Matching ─────────────────────────────────────────────────────────────
  matchesOnExactCanonicalNameOnly: true,
  usesFuzzyMatching: false,
  usesSubstringMatch: false,
  usesLlm: false,
  // ── Cardinality ──────────────────────────────────────────────────────────
  boundedRowWindow: BR_RECEITA_NAME_RESOLUTION_ROW_LIMIT,
  detectsWindowOverflowInsteadOfTruncating: true,
  takesFirstRow: false,
  prefersMatrizByDefault: false,
  prefersFilialByDefault: false,
  usesRowOrder: false,
  usesImportedAt: false,
  usesLowestOrHighestTaxId: false,
  // ── Disambiguation ───────────────────────────────────────────────────────
  disambiguatesByCandidateCity: true,
  fallsBackToUnfilteredSetWhenCityMatchesNothing: false,
  usesUfForDisambiguation: false,
  derivesUfFromCity: false,
  // ── Output ───────────────────────────────────────────────────────────────
  returnsClosedStatusSet: true,
  returnsRowOrNull: false,
  returnsIdentityOnlyWhenUnique: true,
  returnsAmbiguousIdentityList: false,
  returnsRawRows: false,
  forwardsDriverMessages: false,
  throwsOnQueryFailure: false,
  // ── Boundaries ───────────────────────────────────────────────────────────
  enrichesCandidate: false,
  persistsAnything: false,
  authorsMigration: false,
} as const;
