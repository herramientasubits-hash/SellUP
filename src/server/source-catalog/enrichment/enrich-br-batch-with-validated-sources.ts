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
 * ── 🔴 Exact CNPJ is still required (CUT B1 does NOT resolve identity) ──────
 *
 * The adapter looks Receita up by establishment identity. A candidate discovered without a CNPJ
 * stays `skipped / missing_cnpj` — visible and counted, never guessed at by name. Name-based
 * candidate→Receita identity resolution is the NEXT cut's problem and is not started here.
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
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
} from '../connectors/br-receita-cnpj/br-receita-cnpj-types';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../snapshot-read/snapshot-read-contract';
import type { SourceEnrichmentAdapter } from './types';

/** The batch-level provenance key under `prospect_batches.metadata`. */
export const BR_RUN_SOURCE_CONTEXT_KEY = 'source_context' as const;

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

export interface BrBatchValidatedSourceEnrichmentResult {
  attempted: boolean;
  /** The run-level decision. `sourcePeriod` is the ONE month the whole run used. */
  frozenPeriod: BrFrozenPeriodDecision;
  candidatesProcessed: number;
  sourcesApplied: string[];
  matchedCount: number;
  noMatchCount: number;
  skippedCount: number;
  /** Candidates refused for lack of an exact CNPJ. Counted, never guessed at by name. */
  missingCnpjCount: number;
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
      .select('id, name, legal_name, country_code, tax_identifier, sector_description, metadata')
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

    // ── 6. Enrich. The bound adapter SUBSTITUTES the unbound registry entry; it cannot add
    //      a source, because the applicable set is still computed from country + capability.
    const enrichResult = await enrichCandidatesWithValidatedSources({
      candidates: working.map((c) => ({
        name: (c['name'] as string) ?? (c['legal_name'] as string) ?? '',
        taxId: (c['tax_identifier'] as string | null) ?? null,
        countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
        sector: (c['sector_description'] as string | null) ?? null,
        existingMetadata: (c['metadata'] as Record<string, unknown>) ?? {},
      })),
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      stage: 'post_discovery_enrichment',
      adapterOverrides: { [BR_RECEITA_CNPJ_SOURCE_KEY]: boundAdapter },
    });

    result.sourcesApplied = enrichResult.sourcesApplied;
    result.warnings.push(...enrichResult.warnings);
    result.errors.push(...enrichResult.errors);

    const enrichedAt = now();
    const updateOps: Array<Promise<unknown>> = [];

    for (const r of enrichResult.results) {
      const candidate = working[r.candidateIndex];
      if (!candidate) continue;

      const output = r.sourceEnrichments[BR_RECEITA_CNPJ_SOURCE_KEY];
      const status = output?.status ?? 'skipped';
      const reason = output?.reason ?? null;

      if (status === 'matched') result.matchedCount++;
      else if (status === 'no_match') result.noMatchCount++;
      else if (status === 'error') result.errorCount++;
      else {
        result.skippedCount++;
        // 🔴 Counted separately and on purpose: "we could not look this company up because it has
        // no CNPJ" is the measurement the NEXT cut is scoped by, and it must not be buried inside
        // a generic skip total.
        if (reason === 'missing_cnpj') result.missingCnpjCount++;
      }

      if (status !== 'skipped') result.candidatesProcessed++;

      const matched = status === 'matched';
      const existingMeta = (candidate['metadata'] as Record<string, unknown>) ?? {};

      const updatedMeta: Record<string, unknown> = {
        ...existingMeta,
        source_enrichment: {
          ...((existingMeta['source_enrichment'] as Record<string, unknown>) ?? {}),
          // Carries `metadata.source_period` and `metadata.snapshot_run_id` now that the generic
          // builder preserves the adapter's metadata block.
          ...r.enrichmentMetadata,
          _summary: {
            status: matched ? 'completed' : status === 'error' ? 'error' : 'no_match',
            enriched_at: enrichedAt,
            country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
            source_keys_attempted: Object.keys(r.enrichmentMetadata),
            source_keys_matched: matched ? [BR_RECEITA_CNPJ_SOURCE_KEY] : [],
            // The month is run-level truth, repeated per candidate so a reviewer reading ONE row
            // can tell which publication answered without opening the batch.
            source_period: frozenSourcePeriod,
            reason: matched ? null : reason,
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
  requiresExactCnpj: true,
  resolvesIdentityByName: false,
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
} as const;
