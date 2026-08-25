/**
 * Source Catalog — Brazil (Receita CNPJ) batch validated-source enrichment.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-B1 — frozen period, metadata provenance, Agent 1 binding.
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
 * ── 🔴 The period is resolved ONCE and frozen for the whole run ─────────────
 *
 *   1. resolve the current published month, BEFORE a single candidate is read
 *   2. bind ONE adapter to it
 *   3. every candidate in the run is enriched against that same month
 *
 * If 2026-09 is published while the run is still working through candidates, the run stays on
 * 2026-08. A run that started on A finishes on A; the NEXT run gets B. Resolving per candidate —
 * or re-resolving mid-run — is the failure this ordering exists to make structurally impossible:
 * the resolver is called on a code path that runs before the candidate loop and is not reachable
 * from inside it.
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
 * the adapter's outputs carry categories, and `snapshot_run_id` travels as per-candidate
 * provenance without ever becoming a telemetry label.
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
  resolveBrReceitaLatestPublishedPeriod,
  type BrReceitaPublishedPeriodResult,
} from '../connectors/br-receita-cnpj/br-receita-cnpj-published-period-resolver';
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

/** Result of the run-level period decision, exposed so a caller can log it honestly. */
export interface BrFrozenPeriodDecision {
  readonly status: BrReceitaPublishedPeriodResult['status'];
  readonly reason: string;
  /** Canonical `YYYY-MM`, or `null` when nothing is published. Log-safe. */
  readonly sourcePeriod: string | null;
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
  /** How many times the period was resolved. MUST be 1 for a run that reached the loop. */
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
  resolvePeriod?: typeof resolveBrReceitaLatestPublishedPeriod;
  createAdapter?: (config: BrReceitaEnrichmentConfig) => SourceEnrichmentAdapter;
  now?: () => string;
}

function emptyResult(dryRun: boolean): BrBatchValidatedSourceEnrichmentResult {
  return {
    attempted: true,
    frozenPeriod: { status: 'NO_PUBLISHED_PERIOD', reason: 'not_resolved', sourcePeriod: null },
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
        // Only the month. `snapshot_run_id` stays per-candidate provenance and is deliberately
        // NOT hoisted to the run: it is a high-cardinality version id, not a run-level label.
        [BR_RECEITA_CNPJ_SOURCE_KEY]: { source_period: sourcePeriod },
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
  const resolvePeriod = deps.resolvePeriod ?? resolveBrReceitaLatestPublishedPeriod;
  const createAdapter = deps.createAdapter ?? createBrReceitaCnpjEnrichmentAdapter;
  const now = deps.now ?? (() => new Date().toISOString());

  const result = emptyResult(dryRun);
  const readClient = supabase as unknown as SnapshotReadClient<SnapshotIdentityRow>;

  try {
    // ── 1. THE run-level decision. Once, before anything else. ───────────────
    let decision: BrReceitaPublishedPeriodResult;
    try {
      decision = await resolvePeriod({ client: readClient });
    } catch (err) {
      // The resolver throws only `BrReceitaPublishedPeriodQueryError`, which carries a provider
      // code and no message body. Report its CLASS, never its text.
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
      sourcePeriod: decision.sourcePeriod,
    };

    // ── 2. Fail closed. No period ⇒ no candidate read, no adapter, no write. ──
    if (decision.status !== 'FOUND' || decision.sourcePeriod === null) {
      result.aborted = true;
      result.errors.push(`br_no_published_period:${decision.reason}`);
      return result;
    }
    const frozenSourcePeriod = decision.sourcePeriod;

    // ── 3. ONE adapter, bound to that one month, for the whole run. ───────────
    const boundAdapter = createAdapter({
      sourcePeriod: frozenSourcePeriod,
      getClient: () => readClient,
    });
    result.adapterConstructionCount = 1;

    // ── 4. Execution provenance on the batch. ────────────────────────────────
    if (!dryRun) {
      result.runProvenancePersisted = await persistRunSourceContext(
        supabase,
        batchId,
        frozenSourcePeriod,
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
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-B1',
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
} as const;
