/**
 * Source Catalog — Brazil (Receita CNPJ) batch validated-source enrichment.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-B2 — pin exact publication for the whole Agent 1 run.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Snapshot-only. No Receita download, no import, no provider, no credit, no
 * HubSpot, no flag, no migration. Two kinds of statement are issued: SELECTs,
 * and `metadata` UPDATEs on rows this batch already owns.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why Brazil needs its own hook and could not reuse EC's ──────────────────
 *
 * CUT B registered Brazil on the real registries, which made the source REACHABLE. It did not
 * make it REACH anything: the registry entry is deliberately unbound, so it answers
 * `skipped / br_snapshot_period_not_configured` for every candidate. Something has to choose the
 * month, and the choice is a RUN-level decision that no per-candidate code path is entitled to
 * make. This module is that something.
 *
 * The EC SCVS hook is the structural model — read the batch, delegate to the generic validated-
 * source helper, persist under `metadata.source_enrichment` — and it is deliberately not copied
 * wholesale, because Ecuador is year-grained and has no period to freeze.
 *
 * ── 🔴 The PUBLICATION is pinned ONCE and frozen for the whole run ──────────
 *
 *   1. pin the current publication — period AND run id — BEFORE a single candidate is read
 *   2. bind ONE adapter to that publication
 *   3. every candidate in the run is enriched against that same physical publication
 *
 * CUT B1 froze the month and closed the cross-month race: publishing 2026-09 mid-run no longer
 * moves a run that started on 2026-08. It left the SAME-month race open, because a month is not a
 * publication. A rebuild can supersede run A and publish run B for 2026-08 while the run is still
 * working, and a reader that asks "which run is published for 2026-08?" per candidate would answer
 * A for the first half and B for the second — two different extractions inside one batch, with
 * nothing anywhere reporting a problem.
 *
 * So the frozen thing is the PUBLICATION. A run that pinned A finishes on A even after A becomes
 * `superseded`; the NEXT run pins again and gets B. Per-candidate resolution is not a discipline
 * this module remembers — it is unreachable: the pin is minted before the candidate loop, the
 * adapter is bound to the token, and the pinned reader has no code path that asks which run is
 * published.
 *
 * ── 🔴 Fail-closed when nothing is published ────────────────────────────────
 *
 * No published period ⇒ no adapter, no candidate read, no write. "Enrich against whatever exists"
 * is not a lesser version of the right answer; it is a different, unapproved one.
 *
 * ── 🔴 CUT C: the missing-CNPJ population is no longer a dead end ───────────
 *
 * Through CUT B2 a candidate discovered without a CNPJ stayed `skipped / missing_cnpj` forever.
 * That was correct and it was also the whole population: Apollo returns a company name and, for
 * Brazil, essentially never a CNPJ — so the snapshot was pinned, published, readable and
 * unreachable.
 *
 * CUT C adds a THIRD phase between the enrichment and the persist, and its shape is what keeps it
 * honest:
 *
 *   first pass   → the exact-CNPJ path, unchanged
 *   resolution   → for `skipped / missing_cnpj` ONLY: name → ONE establishment of the PINNED
 *                  publication, or an explicit refusal
 *   second pass  → the SAME adapter, handed the resolved CNPJ as an ordinary `taxId`
 *
 * 🔴 The resolver IDENTIFIES and the adapter ENRICHES. There is no second enrichment projection,
 * no second allowlist and no path by which a name match becomes a match the exact reader never
 * confirmed — the resolved identity re-enters through the same door a discovered CNPJ uses.
 *
 * 🔴 A candidate that ALREADY has a `tax_identifier` is never name-resolved (§ 8), not even when
 * that identifier turns out malformed. "The exact path could not run" is the adapter's own
 * `missing_cnpj`, and overriding source-supplied fiscal data with a name guess is a different,
 * unapproved decision.
 *
 * 🔴 AMBIGUOUS is a normal outcome, not a failure to try harder. A razão social is not an identity
 * — `ACME LTDA` legitimately names a São Paulo matriz and a Rio filial with different CNPJs — so
 * more than one surviving establishment yields NO identity at all. Nothing here prefers the
 * matriz, the filial, the first row or the lower CNPJ.
 *
 * ── 🔴 CUT D: the resolved CNPJ becomes DURABLE, and only under a fence ─────
 *
 * Through CUT C the resolved identity was used for the lookup and then dropped, because there was
 * nowhere safe to put it: Agent 1's identity authority evaluated identity at INSERT time only, and
 * a bare `.update({ tax_identifier })` would have declared no epoch, filtered by `id` alone, never
 * looked at whether another candidate of the batch already held that identity, and left the
 * persisted `identity_key` describing the pre-resolution candidate. That was
 * `DURABLE_TAX_ID_SAFE_PATH = NOT_FOUND`.
 *
 * CUT D adds the missing operation — `promote_candidate_fiscal_identity_fenced` — and inserts it
 * BETWEEN the resolution and the second pass:
 *
 *   resolution → RESOLVED_UNIQUE → PROMOTION (fenced) → second pass, only if adjudicated
 *
 * 🔴 The promotion is where the identity is DECIDED, and the second pass only happens for a
 * candidate whose identity the promotion adjudicated. A `FISCAL_IDENTITY_CONFLICT`, a lost race or
 * an error therefore never becomes an exact Receita lookup on an identity nobody adjudicated: the
 * candidate keeps a non-identifying category and is left for review/dedup.
 *
 * 🔴 A candidate that ALREADY carries a `tax_identifier` is not promoted either, for the same
 * reason it is not name-resolved (§ 8): overriding source-supplied fiscal data with a resolved
 * guess is a different, unapproved decision. The refusal is enforced three times over — by the
 * CUT C gate that never offers it to the resolver, by the registry evidence, and by the SQL itself.
 *
 * 🔴 While the CUT D migration is unapplied the database says so, and this hook keeps EXACTLY the
 * CUT C behaviour: the identity stays transient and the enrichment still happens. That window is
 * counted (`identityPromotion.capabilityAbsent`), never silent.
 *
 * ── Privacy (§ 8) ───────────────────────────────────────────────────────────
 *
 * The frozen `source_period` is log-safe and IS logged. A CNPJ, a `legal_name`, a `raw_data`
 * payload and a driver message are not, and none of them reaches a log or a returned error here:
 * the adapter's outputs carry categories. `snapshot_run_id` is a publication VERSION and is now
 * durable provenance on the batch as well as on each candidate (owner decision § 7) — and still
 * never a telemetry label, a metric dimension, public copy or a high-cardinality log line.
 *
 * Only server-side. No use in Client Components.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichCandidatesWithValidatedSources } from './enrich-candidates-with-validated-sources';
import {
  createBrReceitaCnpjEnrichmentAdapter,
  type BrReceitaEnrichmentConfig,
} from '../connectors/br-receita-cnpj/br-receita-cnpj-enrichment-adapter';
import {
  pinBrReceitaPublication,
  type BrReceitaPinnedPublicationResult,
} from '../connectors/br-receita-cnpj/br-receita-cnpj-pinned-publication';
import {
  resolveBrReceitaCandidateIdentity,
  type BrReceitaCandidateIdentityResolution,
} from '../connectors/br-receita-cnpj/br-receita-cnpj-candidate-identity-resolver';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
} from '../connectors/br-receita-cnpj/br-receita-cnpj-types';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../snapshot-read/snapshot-read-contract';
import type { SourceEnrichmentAdapter, SourceEnrichmentOutput } from './types';
import {
  loadBatchIdentityRegistry,
  type BatchIdentitySeedOutcome,
} from '@/server/prospect-batches/batch-identity-registry-store';
import {
  INITIAL_PROMOTION_CAPABILITY_STATE,
  type PromotionCapabilityState,
} from '@/server/prospect-batches/promotion-capability-state';
import {
  runFencedIdentityPromotion,
  type FencedIdentityPromotionResult,
} from '@/server/prospect-batches/run-fenced-identity-promotion';
import { buildFiscalIdentityKeyFromRaw } from '@/server/agents/prospecting-toolkit/fiscal-identity';

/** The batch-level provenance key under `prospect_batches.metadata`. */
export const BR_RUN_SOURCE_CONTEXT_KEY = 'source_context' as const;

/**
 * The candidate columns this hook reads.
 *
 * 🔴 `city` is CUT C's addition and it is the ONLY new column: it is the first authorized
 * disambiguator when several establishments share a razão social (§ 7). `region` is deliberately
 * NOT read — Apollo's region is free text and is not a UF authority, and deriving a UF from it (or
 * from the city) would be manufacturing the very evidence the comparison is supposed to test.
 */
export const BR_CANDIDATE_SELECT_COLUMNS =
  'id, name, legal_name, country_code, city, tax_identifier, sector_description, metadata' as const;

/** True when the candidate arrived carrying something in `tax_identifier`. */
function hasCandidateTaxIdentifier(candidate: Record<string, unknown>): boolean {
  const raw = candidate['tax_identifier'];
  return typeof raw === 'string' && raw.trim() !== '';
}

/**
 * The name the RESOLVER is asked about — `legal_name` first, then `name`.
 *
 * 🔴 The opposite precedence to the one the generic enrichment input uses below, and deliberately
 * so. That one carries the candidate's DISPLAY name, which is what every other source and every
 * log line means by "the candidate". This one asks a different question — "which razão social
 * should I look for in Receita?" — and `legal_name`, when a discovery source supplied one, is the
 * closer answer. Collapsing the two would make one of the two questions wrong.
 */
function candidateResolutionName(candidate: Record<string, unknown>): string {
  const legal = candidate['legal_name'];
  if (typeof legal === 'string' && legal.trim() !== '') {
    return legal;
  }
  const name = candidate['name'];
  return typeof name === 'string' ? name : '';
}

/**
 * Result of the run-level publication decision, exposed so a caller can log it honestly.
 *
 * CUT B1 called this the "frozen period" and froze a month. CUT B2 freezes the PUBLICATION: the
 * month AND the physical run that publishes it, so a republication of the same month cannot move
 * a run that already started.
 */
export interface BrFrozenPeriodDecision {
  readonly status: BrReceitaPinnedPublicationResult['status'];
  readonly reason: string;
  /** Canonical `YYYY-MM`, or `null` when nothing is published. Log-safe. */
  readonly sourcePeriod: string | null;
  /**
   * The pinned publication run id, or `null` when nothing was pinned.
   *
   * 🔴 A VERSION id, never identity (§ 7). Durable batch provenance — never a telemetry label, a
   * metric dimension, public copy or a high-cardinality log line.
   */
  readonly snapshotRunId: string | null;
}

/**
 * Per-status accounting of the CUT D promotion pass. Numbers only (§ 6).
 */
export interface BrIdentityPromotionBreakdown {
  /** How many RESOLVED_UNIQUE identities were offered to the fence. */
  attempted: number;
  /** …of which became durable, advancing the batch's identity epoch. */
  promoted: number;
  /** …already stored exactly that identity. Idempotent replay. */
  alreadySameIdentity: number;
  /** …were refused: the row, a batch peer or this run already claims that identity. */
  conflict: number;
  /** …lost the bounded race and failed CLOSED. */
  staleExhausted: number;
  /** …named a candidate that is not in this batch. */
  candidateNotFound: number;
  /** …carried an identity the canonical authority cannot compose. */
  invalidIdentity: number;
  /** …ran while the CUT D migration is unapplied. CUT C behaviour preserved. */
  capabilityAbsent: number;
  /** …ran in live-shadow: every refusal evaluated, nothing written. */
  skippedDryRun: number;
  /** …failed operationally. Never a claim about the company. */
  error: number;
  /**
   * …ended with an identity the caller may use downstream.
   *
   * 🔴 The ONLY population that reaches the second (exact-CNPJ) pass.
   */
  adjudicated: number;
}

export interface BrBatchValidatedSourceEnrichmentResult {
  attempted: boolean;
  /** The run-level decision. `sourcePeriod` is the ONE month the whole run used. */
  frozenPeriod: BrFrozenPeriodDecision;
  candidatesProcessed: number;
  sourcesApplied: string[];
  matchedCount: number;
  noMatchCount: number;
  skippedCount: number;
  /**
   * Candidates whose FIRST pass had no exact CNPJ — the population CUT C's resolver is offered.
   *
   * Retained under the CUT B1 name and with the CUT B1 meaning: it is the size of the missing-CNPJ
   * population, NOT the number that stayed unenriched. What happened to them afterwards is the
   * `identity*` breakdown below, and `missingCnpjUnresolvedCount` is the honest residue.
   */
  missingCnpjCount: number;
  // ── CUT C identity-resolution breakdown (§ 12) ────────────────────────────
  /**
   * BR candidates that arrived WITH a `tax_identifier`.
   *
   * 🔴 Name resolution never runs for these, valid CNPJ or not (§ 8): a candidate that already
   * carries a fiscal identity is answered by the exact path, and a resolver that "helped" when
   * that identity turned out malformed would be silently overriding source data.
   */
  existingCnpjCount: number;
  /** Missing-CNPJ candidates the resolver reduced to exactly ONE establishment. */
  identityResolvedCount: number;
  /** Missing-CNPJ candidates where more than one establishment stayed plausible. No identity. */
  identityAmbiguousCount: number;
  /** Missing-CNPJ candidates with zero surviving establishments (incl. no city match). */
  identityNoMatchCount: number;
  /** Missing-CNPJ candidates whose name was unusable. No query was sent for these. */
  identityInvalidInputCount: number;
  /** Missing-CNPJ candidates whose resolution failed operationally. Never a claim about them. */
  identityErrorCount: number;
  /** How many resolution attempts were made. Equals `missingCnpjCount`. */
  identityResolutionAttemptCount: number;
  /**
   * Missing-CNPJ candidates that are STILL without an identity after the resolver ran.
   *
   * 🔴 The number this cut is measured by, and deliberately not buried inside `skippedCount`.
   * Equals ambiguous + no-match + invalid-input + error.
   */
  missingCnpjUnresolvedCount: number;
  // ── CUT D identity-promotion breakdown ────────────────────────────────────
  /**
   * What happened to each RESOLVED identity when it was offered to the fence.
   *
   * 🔴 Counts and nothing else. No CNPJ, no name, no candidate id reaches this
   * object, so a batch summary cannot leak an identity the run was refused.
   */
  identityPromotion: BrIdentityPromotionBreakdown;
  /**
   * Missing-CNPJ candidates that ended the run WITHOUT an adjudicated identity.
   *
   * 🔴 The number CUT D is measured by, and deliberately not folded into
   * `missingCnpjUnresolvedCount`, which keeps its CUT C meaning (the RESOLVER's
   * residue). A candidate the resolver answered and the fence then refused is a
   * different, newer outcome and has to stay countable on its own.
   */
  missingCnpjWithoutAdjudicatedIdentityCount: number;
  errorCount: number;
  /** Candidates left untouched because their `country_code` is not BR. */
  nonBrSkippedCount: number;
  /** Rows an UPDATE was issued for (0 in dry-run). */
  updatedCount: number;
  /** True when a guard stopped the run before any candidate was read or written. */
  aborted: boolean;
  /** True when the batch-level `source_context` provenance write was issued. */
  runProvenancePersisted: boolean;
  dryRun: boolean;
  warnings: string[];
  errors: string[];
  // ── Freeze observability — the properties CASE 1/2/4/11 assert ─────────────
  /**
   * How many times the publication was pinned. MUST be 1 for a run that reached the loop.
   *
   * Kept under the CUT B1 name because it measures the same property, one level stricter: the run
   * decides its publication exactly once.
   */
  periodResolutionCount: number;
  /** How many period-bound adapters were constructed. MUST be at most 1. */
  adapterConstructionCount: number;
}

export interface BrBatchEnrichmentOptions {
  /** When true, computes everything but issues NO database UPDATE (live-shadow). */
  dryRun?: boolean;
}

/**
 * Seams. Injected ONLY so the freeze can be proven offline — production passes none of them and
 * gets the real resolver, the real adapter factory and the real clock.
 */
export interface BrBatchEnrichmentDeps {
  pinPublication?: typeof pinBrReceitaPublication;
  createAdapter?: (config: BrReceitaEnrichmentConfig) => SourceEnrichmentAdapter;
  /** CUT C's candidate → Receita name resolver. Injected only so the fallback is provable offline. */
  resolveIdentity?: typeof resolveBrReceitaCandidateIdentity;
  /** CUT D's fenced promotion. Injected only so the fence is provable offline. */
  promoteIdentity?: typeof runFencedIdentityPromotion;
  /** CUT D's coherent (rows + epoch) photograph loader. Injected only for tests. */
  loadIdentitySnapshot?: typeof loadBatchIdentityRegistry;
  now?: () => string;
}

function emptyResult(dryRun: boolean): BrBatchValidatedSourceEnrichmentResult {
  return {
    attempted: true,
    frozenPeriod: {
      status: 'NO_PUBLISHED_PUBLICATION',
      reason: 'not_resolved',
      sourcePeriod: null,
      snapshotRunId: null,
    },
    candidatesProcessed: 0,
    sourcesApplied: [],
    matchedCount: 0,
    noMatchCount: 0,
    skippedCount: 0,
    missingCnpjCount: 0,
    existingCnpjCount: 0,
    identityResolvedCount: 0,
    identityAmbiguousCount: 0,
    identityNoMatchCount: 0,
    identityInvalidInputCount: 0,
    identityErrorCount: 0,
    identityResolutionAttemptCount: 0,
    missingCnpjUnresolvedCount: 0,
    identityPromotion: {
      attempted: 0,
      promoted: 0,
      alreadySameIdentity: 0,
      conflict: 0,
      staleExhausted: 0,
      candidateNotFound: 0,
      invalidIdentity: 0,
      capabilityAbsent: 0,
      skippedDryRun: 0,
      error: 0,
      adjudicated: 0,
    },
    missingCnpjWithoutAdjudicatedIdentityCount: 0,
    errorCount: 0,
    nonBrSkippedCount: 0,
    updatedCount: 0,
    aborted: false,
    runProvenancePersisted: false,
    dryRun,
    warnings: [],
    errors: [],
    periodResolutionCount: 0,
    adapterConstructionCount: 0,
  };
}

/**
 * Records the frozen month on the BATCH, as execution provenance.
 *
 * 🔴 Reuses `prospect_batches.metadata` — the durable JSONB the same run already writes its
 * `agent_key`, cascade and counters into. No column is added and no migration is authored: a new
 * physical home for one string would be a schema change nobody approved, and this cut is
 * `MIGRATION = NONE` by contract.
 *
 * Read-modify-write, merging rather than replacing, so a concurrent writer's keys survive.
 * Fail-soft: provenance is valuable, but failing to record it must not stop the enrichment.
 */
async function persistRunSourceContext(
  supabase: SupabaseClient,
  batchId: string,
  sourcePeriod: string,
  snapshotRunId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('prospect_batches')
      .select('metadata')
      .eq('id', batchId)
      .maybeSingle();

    if (error) return false;

    const existing = ((data as { metadata?: unknown } | null)?.metadata ?? {}) as Record<
      string,
      unknown
    >;
    const existingContext = (existing[BR_RUN_SOURCE_CONTEXT_KEY] ?? {}) as Record<string, unknown>;

    const merged: Record<string, unknown> = {
      ...existing,
      [BR_RUN_SOURCE_CONTEXT_KEY]: {
        ...existingContext,
        // 🔴 CUT B2 (owner decision § 7): the run id IS recorded here now. It is what makes the
        // batch's provenance answer "which physical publication did this batch read?", which the
        // month alone cannot — a republished month has two. It is a VERSION id, not a CNPJ and not
        // a company identity, so durable batch provenance is an authorized home for it. It stays
        // OUT of telemetry labels, metric dimensions, public copy and high-cardinality logs.
        [BR_RECEITA_CNPJ_SOURCE_KEY]: {
          source_period: sourcePeriod,
          snapshot_run_id: snapshotRunId,
        },
      },
    };

    const { error: updateError } = await supabase
      .from('prospect_batches')
      .update({ metadata: merged })
      .eq('id', batchId);

    return !updateError;
  } catch {
    return false;
  }
}

/**
 * Enriches every Brazilian candidate of a batch against ONE frozen published month.
 *
 * Ordering is the contract, and it is load-bearing:
 *
 *   resolve period → (fail closed if none) → bind adapter → record provenance →
 *   read candidates → enrich → persist
 *
 * The resolver is not reachable from inside the candidate loop, so "resolved once" is a property
 * of the call graph rather than a discipline this function has to remember.
 */
export async function enrichBrBatchWithValidatedSources(
  supabase: SupabaseClient,
  batchId: string,
  options: BrBatchEnrichmentOptions = {},
  deps: BrBatchEnrichmentDeps = {},
): Promise<BrBatchValidatedSourceEnrichmentResult> {
  const dryRun = options.dryRun ?? false;
  const pinPublication = deps.pinPublication ?? pinBrReceitaPublication;
  const createAdapter = deps.createAdapter ?? createBrReceitaCnpjEnrichmentAdapter;
  const resolveIdentity = deps.resolveIdentity ?? resolveBrReceitaCandidateIdentity;
  const promoteIdentity = deps.promoteIdentity ?? runFencedIdentityPromotion;
  const loadIdentitySnapshot = deps.loadIdentitySnapshot ?? loadBatchIdentityRegistry;
  const now = deps.now ?? (() => new Date().toISOString());

  const result = emptyResult(dryRun);
  const readClient = supabase as unknown as SnapshotReadClient<SnapshotIdentityRow>;

  try {
    // ── 1. THE run-level decision. Once, before anything else. ───────────────
    let decision: BrReceitaPinnedPublicationResult;
    try {
      decision = await pinPublication({ client: readClient });
    } catch (err) {
      // The pin throws only `BrReceitaPinnedPublicationQueryError`, which carries a provider code
      // and no message body. Report its CLASS, never its text.
      const name =
        typeof err === 'object' && err !== null && typeof (err as Error).name === 'string'
          ? (err as Error).name
          : 'non_error_thrown';
      result.periodResolutionCount = 1;
      result.aborted = true;
      result.errors.push(`br_period_resolution_failed:${name}`);
      return result;
    }
    result.periodResolutionCount = 1;
    result.frozenPeriod = {
      status: decision.status,
      reason: decision.reason,
      sourcePeriod: decision.publication?.sourcePeriod ?? null,
      snapshotRunId: decision.publication?.snapshotRunId ?? null,
    };

    // ── 2. Fail closed. No publication ⇒ no candidate read, no adapter, no write. ──
    // An ambiguous or malformed publication fails here too, and is NOT demoted to an older month.
    if (decision.status !== 'PINNED' || decision.publication === null) {
      result.aborted = true;
      result.errors.push(`br_no_published_period:${decision.reason}`);
      return result;
    }
    const publication = decision.publication;
    const frozenSourcePeriod = publication.sourcePeriod;

    // ── 3. ONE adapter, pinned to that ONE publication, for the whole run. ────
    // 🔴 `publication` — not just `sourcePeriod`. The month is passed alongside it purely so the
    // seam stays observable; the adapter derives its reads from the pin, and refuses the pair if
    // they ever disagree.
    const boundAdapter = createAdapter({
      publication,
      sourcePeriod: frozenSourcePeriod,
      getClient: () => readClient,
    });
    result.adapterConstructionCount = 1;

    // ── 4. Execution provenance on the batch: month AND publication run (§ 7). ──
    if (!dryRun) {
      result.runProvenancePersisted = await persistRunSourceContext(
        supabase,
        batchId,
        frozenSourcePeriod,
        publication.snapshotRunId,
      );
    }

    // ── 5. Candidates. ───────────────────────────────────────────────────────
    const { data: candidates, error } = await supabase
      .from('prospect_candidates')
      .select(BR_CANDIDATE_SELECT_COLUMNS)
      .eq('batch_id', batchId);

    if (error || !candidates || candidates.length === 0) {
      return result;
    }

    const all = candidates as Array<Record<string, unknown>>;
    const working = all.filter(
      (c) => ((c['country_code'] as string | null) ?? null) === BR_RECEITA_CNPJ_COUNTRY_CODE,
    );
    result.nonBrSkippedCount = all.length - working.length;

    if (working.length === 0) {
      return result;
    }

    // ── 6. FIRST PASS — the exact-CNPJ path, byte-for-byte the CUT B2 behaviour. ─
    //      The bound adapter SUBSTITUTES the unbound registry entry; it cannot add a source,
    //      because the applicable set is still computed from country + capability.
    const enrichInputs = working.map((c) => ({
      // The DISPLAY name, `name` first — see `candidateResolutionName` for why the resolver
      // deliberately reads the other way round.
      name: (c['name'] as string) ?? (c['legal_name'] as string) ?? '',
      taxId: (c['tax_identifier'] as string | null) ?? null,
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      sector: (c['sector_description'] as string | null) ?? null,
      existingMetadata: (c['metadata'] as Record<string, unknown>) ?? {},
    }));

    const firstPass = await enrichCandidatesWithValidatedSources({
      candidates: enrichInputs,
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      stage: 'post_discovery_enrichment',
      adapterOverrides: { [BR_RECEITA_CNPJ_SOURCE_KEY]: boundAdapter },
    });

    const sourcesApplied = new Set<string>(firstPass.sourcesApplied);
    result.warnings.push(...firstPass.warnings);
    result.errors.push(...firstPass.errors);

    /**
     * One slot per working candidate, holding its FINAL outcome.
     *
     * 🔴 Counting happens once, at the end, over these slots — not per pass. A candidate whose
     * identity was resolved and then enriched must be counted as `matched`, exactly once, and
     * incrementing during each pass is how it would end up as both `skipped` and `matched`.
     */
    interface CandidateOutcome {
      seen: boolean;
      output: SourceEnrichmentOutput | undefined;
      enrichmentMetadata: Record<string, unknown>;
      resolution: BrReceitaCandidateIdentityResolution | null;
      promotion: FencedIdentityPromotionResult | null;
    }
    const outcomes: CandidateOutcome[] = working.map(() => ({
      seen: false,
      output: undefined,
      enrichmentMetadata: {},
      resolution: null,
      promotion: null,
    }));

    for (const r of firstPass.results) {
      const slot = outcomes[r.candidateIndex];
      if (!slot) continue;
      slot.seen = true;
      slot.output = r.sourceEnrichments[BR_RECEITA_CNPJ_SOURCE_KEY];
      slot.enrichmentMetadata = r.enrichmentMetadata;
    }

    // Measured from the candidate rows, not inferred from an adapter status: "arrived with a
    // fiscal identity" is a property of the ROW, and a malformed CNPJ is still a CNPJ (§ 8).
    result.existingCnpjCount = working.filter(hasCandidateTaxIdentifier).length;

    // ── 7. RESOLUTION PASS — missing CNPJ ONLY (§ 8, § 9). ───────────────────
    //
    // 🔴 The gate is the adapter's own `skipped / missing_cnpj`, not a re-derivation of "does this
    // candidate have a CNPJ?". The adapter is the authority on when the exact path could not run,
    // so the fallback cannot start for a candidate the exact path DID serve — including one whose
    // CNPJ was present but malformed, which stays `skipped / invalid_cnpj_*` and is never
    // second-guessed by a name.
    //
    // Sequential on purpose. This is one bounded, indexed equality probe per unresolved candidate,
    // and running them in lockstep keeps the load predictable and the order deterministic.
    const retryIndexes: number[] = [];

    /**
     * The batch's coherent (rows + epoch) photograph, loaded LAZILY.
     *
     * 🔴 Lazily on purpose. A run whose Brazilian candidates all arrived with a CNPJ never
     * promotes anything, and making it pay for — and fail on — a fence read it does not use would
     * be CUT D charging CUT B2 for a feature CUT B2 does not want. Once loaded it is THREADED: one
     * read per run, and each promotion hands back the photograph the next candidate decides
     * against, exactly as `runFencedPersistence` does after an insert.
     */
    let identitySnapshot: BatchIdentitySeedOutcome | null = null;
    /**
     * Fiscal identities this RUN already adjudicated.
     *
     * 🔴 The durable check cannot cover the window in which CUT D is inert: with the migration
     * unapplied nothing is written, so a second candidate resolving to the SAME establishment
     * would find no peer holding it. This closes that, and it costs nothing in the applied case.
     * Local variable only — never logged, never persisted, never returned.
     */
    const promotedFiscalKeys = new Set<string>();
    /**
     * What this RUN has established about migration 133 — the promotion function.
     *
     * 🔴 Threaded, not per candidate, and NEVER derived from `identitySnapshot`. The snapshot's
     * epoch proves migration 126 and nothing else, and production ran with 126 applied and 133
     * not: in that window the promotion answers "no such function" and the honest reading is that
     * the migration is unapplied, so CUT C's enrichment must survive untouched. Once the promotion
     * HAS answered in this run the state is `PRESENT` and terminal — a later absence is a
     * deployment inconsistency and fails closed, which is how the fence is stopped from evaporating
     * between candidate 1 and candidate 7 of the same batch.
     */
    let promotionCapability: PromotionCapabilityState = INITIAL_PROMOTION_CAPABILITY_STATE;

    for (let i = 0; i < working.length; i += 1) {
      const slot = outcomes[i];
      const candidate = working[i];
      if (!slot || !candidate) continue;
      if (slot.output?.status !== 'skipped' || slot.output.reason !== 'missing_cnpj') continue;

      result.missingCnpjCount += 1;
      result.identityResolutionAttemptCount += 1;

      // 🔴 `publication` — never a period and never a run-id string. The resolver's input shape
      // has nowhere to put one, so this run cannot search a publication it did not pin.
      const resolution = await resolveIdentity({
        client: readClient,
        publication,
        candidateName: candidateResolutionName(candidate),
        candidateCity: candidate['city'],
      });
      slot.resolution = resolution;

      switch (resolution.status) {
        case 'RESOLVED_UNIQUE': {
          result.identityResolvedCount += 1;

          // ── CUT D — the identity is DECIDED here, not by the adapter. ──────
          const resolvedTaxId = resolution.resolvedNormalizedTaxId;
          if (resolvedTaxId === null) {
            // Unreachable by the resolver's own contract (`RESOLVED_UNIQUE` always carries one),
            // and handled rather than asserted: an identity that is not there cannot be promoted
            // and must not silently reach the exact adapter either.
            result.identityPromotion.attempted += 1;
            result.identityPromotion.invalidIdentity += 1;
            break;
          }

          if (identitySnapshot === null) {
            identitySnapshot = await loadIdentitySnapshot(supabase, batchId);
          }

          const promotion = await promoteIdentity({
            client: supabase,
            batchId,
            candidateId: candidate['id'] as string,
            countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
            taxIdentifier: resolvedTaxId,
            candidateName: (candidate['name'] as string | null) ?? null,
            snapshot: identitySnapshot,
            promotedFiscalKeys,
            promotionCapability,
            dryRun,
          });
          identitySnapshot = promotion.snapshot;
          promotionCapability = promotion.promotionCapability;
          slot.promotion = promotion;

          result.identityPromotion.attempted += 1;
          switch (promotion.status) {
            case 'PROMOTED':
              result.identityPromotion.promoted += 1;
              break;
            case 'ALREADY_SAME_IDENTITY':
              result.identityPromotion.alreadySameIdentity += 1;
              break;
            case 'FISCAL_IDENTITY_CONFLICT':
              result.identityPromotion.conflict += 1;
              break;
            case 'STALE_IDENTITY_EPOCH':
              result.identityPromotion.staleExhausted += 1;
              break;
            case 'CANDIDATE_NOT_FOUND':
              result.identityPromotion.candidateNotFound += 1;
              break;
            case 'INVALID_IDENTITY':
              result.identityPromotion.invalidIdentity += 1;
              break;
            case 'CAPABILITY_ABSENT':
              result.identityPromotion.capabilityAbsent += 1;
              break;
            case 'SKIPPED_DRY_RUN':
              result.identityPromotion.skippedDryRun += 1;
              break;
            default:
              result.identityPromotion.error += 1;
              break;
          }

          // 🔴 The gate. Only an ADJUDICATED identity reaches the exact-CNPJ adapter; a conflict,
          // a lost race or an error leaves the candidate with its category and no Receita match.
          if (promotion.adjudicated) {
            result.identityPromotion.adjudicated += 1;
            const fiscalKey = buildFiscalIdentityKeyFromRaw({
              value: resolvedTaxId,
              countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
            });
            if (fiscalKey !== null) promotedFiscalKeys.add(fiscalKey);
            retryIndexes.push(i);
          }
          break;
        }
        case 'AMBIGUOUS':
          result.identityAmbiguousCount += 1;
          break;
        case 'NO_MATCH':
          result.identityNoMatchCount += 1;
          break;
        case 'INVALID_INPUT':
          result.identityInvalidInputCount += 1;
          break;
        default:
          result.identityErrorCount += 1;
          break;
      }
    }

    result.missingCnpjUnresolvedCount =
      result.identityAmbiguousCount +
      result.identityNoMatchCount +
      result.identityInvalidInputCount +
      result.identityErrorCount;

    // 🔴 The CUT D residue: everything the resolver could not answer, PLUS everything the fence
    // refused to adjudicate. Kept separate from the line above so the CUT C number keeps meaning
    // exactly what CUT C said it meant.
    result.missingCnpjWithoutAdjudicatedIdentityCount =
      result.missingCnpjUnresolvedCount +
      (result.identityPromotion.attempted - result.identityPromotion.adjudicated);

    // ── 8. SECOND PASS — the SAME adapter, now handed the resolved identity (§ 9). ──
    //
    // 🔴 The resolver IDENTIFIES; the adapter ENRICHES. The resolved CNPJ re-enters through the
    // ordinary `taxId` input, so the exact lookup, the projection, the allowlist, the pinned read
    // and the `matchedBy: 'tax_id'` semantics are the CUT B2 ones — there is no second enrichment
    // projection to keep in sync, and no path by which a name match becomes a match the exact
    // reader never confirmed.
    if (retryIndexes.length > 0) {
      const secondPass = await enrichCandidatesWithValidatedSources({
        candidates: retryIndexes.map((i) => ({
          ...enrichInputs[i],
          taxId: outcomes[i]?.resolution?.resolvedNormalizedTaxId ?? null,
        })),
        countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
        stage: 'post_discovery_enrichment',
        adapterOverrides: { [BR_RECEITA_CNPJ_SOURCE_KEY]: boundAdapter },
      });

      for (const applied of secondPass.sourcesApplied) sourcesApplied.add(applied);
      result.warnings.push(...secondPass.warnings);
      result.errors.push(...secondPass.errors);

      for (const r of secondPass.results) {
        const workingIndex = retryIndexes[r.candidateIndex];
        if (workingIndex === undefined) continue;
        const slot = outcomes[workingIndex];
        if (!slot) continue;
        slot.output = r.sourceEnrichments[BR_RECEITA_CNPJ_SOURCE_KEY];
        slot.enrichmentMetadata = r.enrichmentMetadata;
      }
    }

    result.sourcesApplied = [...sourcesApplied];

    // ── 9. Count once, persist once. ─────────────────────────────────────────
    const enrichedAt = now();
    const updateOps: Array<Promise<unknown>> = [];

    for (let i = 0; i < working.length; i += 1) {
      const candidate = working[i];
      const slot = outcomes[i];
      if (!candidate || !slot || !slot.seen) continue;

      const status = slot.output?.status ?? 'skipped';
      const reason = slot.output?.reason ?? null;

      if (status === 'matched') result.matchedCount++;
      else if (status === 'no_match') result.noMatchCount++;
      else if (status === 'error') result.errorCount++;
      else result.skippedCount++;

      if (status !== 'skipped') result.candidatesProcessed++;

      const matched = status === 'matched';
      const existingMeta = (candidate['metadata'] as Record<string, unknown>) ?? {};
      const resolution = slot.resolution;
      const promotion = slot.promotion;

      const updatedMeta: Record<string, unknown> = {
        ...existingMeta,
        source_enrichment: {
          ...((existingMeta['source_enrichment'] as Record<string, unknown>) ?? {}),
          // Carries `metadata.source_period` and `metadata.snapshot_run_id` now that the generic
          // builder preserves the adapter's metadata block.
          ...slot.enrichmentMetadata,
          _summary: {
            status: matched ? 'completed' : status === 'error' ? 'error' : 'no_match',
            enriched_at: enrichedAt,
            country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
            source_keys_attempted: Object.keys(slot.enrichmentMetadata),
            source_keys_matched: matched ? [BR_RECEITA_CNPJ_SOURCE_KEY] : [],
            // The month is run-level truth, repeated per candidate so a reviewer reading ONE row
            // can tell which publication answered without opening the batch.
            source_period: frozenSourcePeriod,
            reason: matched ? null : reason,
            // 🔴 CUT C provenance: WHY this candidate reached (or did not reach) an identity.
            // `null` for a candidate that never needed resolution, so "the resolver did not run"
            // and "the resolver found nothing" stay distinguishable.
            //
            // 🔴 There is deliberately NO CNPJ here, and none is derivable from it: a status, a
            // category reason, a COUNT and a boolean. An AMBIGUOUS candidate therefore cannot
            // leak the establishments it could not choose between (§ 11).
            identity_resolution:
              resolution === null
                ? null
                : {
                    status: resolution.status,
                    reason: resolution.reason,
                    observed_count: resolution.observedCount,
                    disambiguated_by_city: resolution.disambiguatedByCity,
                  },
            // 🔴 CUT D provenance: whether the resolved identity became DURABLE, and why not when
            // it did not. `null` for a candidate that never reached the fence, so "the promotion
            // did not run" and "the promotion was refused" stay distinguishable.
            //
            // 🔴 There is deliberately NO CNPJ here and none is derivable from it: a status, a
            // category reason and two booleans. A candidate refused for a fiscal conflict cannot
            // leak the identity it collided with — which is the whole point of refusing.
            identity_promotion:
              promotion === null
                ? null
                : {
                    status: promotion.status,
                    reason: promotion.reason,
                    mutated: promotion.mutated,
                    adjudicated: promotion.adjudicated,
                  },
          },
        },
      };

      if (dryRun) continue;

      updateOps.push(
        supabase
          .from('prospect_candidates')
          .update({ metadata: updatedMeta })
          .eq('id', candidate['id'] as string) as unknown as Promise<unknown>,
      );
    }

    if (!dryRun) {
      await Promise.allSettled(updateOps);
    }
    result.updatedCount = updateOps.length;

    return result;
  } catch (err) {
    // Fail-soft, and CATEGORY-only: a driver message on this path can quote a filter, and one of
    // the filters upstream of here carries a CNPJ.
    const name =
      typeof err === 'object' && err !== null && typeof (err as Error).name === 'string'
        ? (err as Error).name
        : 'non_error_thrown';
    result.errors.push(`br_batch_enrichment_failed:${name}`);
    return result;
  }
}

/**
 * The runtime contract this hook satisfies, as data. Asserted by the CUT B1 suite so the freeze
 * policy is a test subject rather than a paragraph.
 */
export const BR_AGENT1_RUNTIME_BINDING_CONTRACT = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-B2',
  appliesToSourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
  countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
  periodResolvedOncePerRun: true,
  periodFrozenForWholeRun: true,
  periodResolvedInsideCandidateLoop: false,
  adapterBoundOncePerRun: true,
  failsClosedWithoutPublishedPeriod: true,
  readsCandidatesBeforeResolvingPeriod: false,
  /** The Receita LOOKUP is still exact-CNPJ only — CUT C changes where the CNPJ comes from. */
  requiresExactCnpj: true,
  runProvenanceHome: 'prospect_batches.metadata.source_context',
  authorsMigration: false,
  // ── CUT B2 ────────────────────────────────────────────────────────────────
  /** The run pins a PUBLICATION (period + run id), not merely a month. */
  publicationPinnedOncePerRun: true,
  publicationPinnedForWholeRun: true,
  /** A republication of the SAME month mid-run cannot move a run that already pinned. */
  samePeriodRepublicationIsolated: true,
  /** The pinned run may become `superseded`; the run that pinned it still reads it. */
  survivesPinnedRunBecomingSuperseded: true,
  /** Nothing below this hook re-asks "which run is published?". */
  resolvesPublishedRunPerCandidate: false,
  /** Owner decision § 7: the run id is durable batch provenance. */
  persistsSnapshotRunIdAsBatchProvenance: true,
  /** …and nothing more than provenance: never a telemetry label or metric dimension. */
  usesSnapshotRunIdAsTelemetryLabel: false,
  // ── CUT C ─────────────────────────────────────────────────────────────────
  /**
   * 🔴 Flipped from `false` by BR-SOURCE-FUNCTIONAL-CUT-C. Through CUT B2 this key recorded that
   * the hook refused to look at names at all; leaving it `false` while the fallback exists would
   * be a guard defending the defect it was written to describe. The properties that actually keep
   * the resolution safe are the ones below it, and they are the ones a reviewer must read.
   */
  resolvesIdentityByName: true,
  /** …and ONLY for candidates the exact path could not serve. */
  resolvesIdentityByNameOnlyWhenCnpjMissing: true,
  /** A candidate that arrived with a `tax_identifier` is never name-resolved. */
  overridesCandidateSuppliedTaxIdentifier: false,
  /** The resolution happens inside the run's own pinned publication, never another. */
  resolvesIdentityInsidePinnedPublication: true,
  /** More than one surviving establishment yields no identity. */
  ambiguousNameFailsClosed: true,
  /** Zero surviving establishments yields no identity, and never a widened retry. */
  noMatchFailsClosed: true,
  /** The candidate's city is the only disambiguator; UF is not used and not derived. */
  disambiguatesByCandidateCity: true,
  usesUfForDisambiguation: false,
  /** The resolved identity re-enters through the existing exact-CNPJ adapter, not a second path. */
  reusesExactCnpjAdapterForResolvedIdentity: true,
  duplicatesEnrichmentProjection: false,
  /** Neither the resolution metadata nor any counter carries a CNPJ. */
  persistsResolvedTaxIdentifierInMetadata: false,
  // ── CUT D ─────────────────────────────────────────────────────────────────
  /**
   * 🔴 Both flipped from `false` by BR-SOURCE-FUNCTIONAL-CUT-D. Through CUT C the resolved CNPJ
   * was transient because there was no fenced UPDATE path for adding a fiscal identity to an
   * existing row. There is one now, and leaving these keys at `false` while the promotion exists
   * would be a guard defending the very gap it was written to describe. The properties that keep
   * the write safe are the ones below, and they are what a reviewer must read.
   */
  persistsResolvedTaxIdentifierOnCandidate: true,
  rewritesCandidateIdentityKey: true,
  /** …and NEVER through a bare `.update({ tax_identifier })`. */
  usesBareTaxIdentifierUpdate: false,
  promotesResolvedIdentityUnderEpochFence: true,
  /** `tax_identifier` and `identity_key` move together, in ONE transaction. */
  promotesIdentifierAndIdentityKeyTogether: true,
  /** The promotion is scoped by `(id, batch_id)`: one batch's fence cannot write another's row. */
  scopesPromotionByBatch: true,
  /** A batch peer that already holds the identity refuses the promotion (TIER 1). */
  refusesPromotionOnFiscalConflict: true,
  /** A candidate that arrived with a `tax_identifier` is never promoted over. */
  overwritesCandidateSuppliedTaxIdentifier: false,
  /** A lost race fails CLOSED — there is no unfenced fallback write. */
  fallsBackToUnfencedWriteAfterRetries: false,
  /** 🔴 Only an ADJUDICATED identity reaches the exact-CNPJ adapter. */
  enrichesWithUnadjudicatedIdentity: false,
  /**
   * With the CUT D migration unapplied, the CUT C behaviour is preserved exactly — including in
   * the PRODUCTION topology, where migration 126 IS applied and only 133 is missing.
   */
  preservesCutCBehaviourWhenPromotionCapabilityAbsent: true,
  /** 🔴 …and the promotion's capability is tracked across candidates, per run. */
  threadsPromotionCapabilityAcrossCandidates: true,
  /** …never inferred from the identity snapshot's epoch, which is a different migration. */
  infersPromotionCapabilityFromSnapshotEpoch: false,
  /** Neither the promotion metadata nor any promotion counter carries a CNPJ. */
  persistsPromotionOutcomeWithoutIdentifier: true,
} as const;
