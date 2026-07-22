/**
 * Source Catalog — Ecuador (SCVS) batch validated-source enrichment — EC-SCVS-7
 *
 * Routes Ecuador prospect candidates through the generic validated-source
 * enrichment helper so the ec_scvs adapter is actually invoked at runtime.
 *
 * Why this exists:
 *   Ecuador prospect generation flows through the commercial (Apollo) path and
 *   never reaches the Colombia-only post-discovery enrichment block. The tax
 *   resolution dispatcher (enrichBatchCandidatesWithTaxResolution) also guards
 *   EC out by design (it is a CO/MX tax-grain resolver, not a validated-source
 *   enricher). So EC needs its own thin runtime hook. This helper is that hook.
 *
 * Contract (EC-SCVS series):
 *   - EC only. countryCode is hardcoded to 'EC'; it never touches CO/MX/CL.
 *   - Snapshot-backed, fail-soft: adapter errors never tumble the batch.
 *   - RUC multiplicity stays observable (no arbitrary row selection). The
 *     ec_scvs adapter surfaces multiplicity; this helper only persists what the
 *     adapter returns — it never collapses ambiguity to a single row.
 *   - Metadata lands under metadata.source_enrichment.ec_scvs (+ _summary).
 *   - No raw_data is persisted (the adapter never emits it) and no full RUC is
 *     ever logged.
 *   - Uses the existing validated-source helper + adapter registry; no
 *     tax-grain helpers, no single-row probes here (the ec_scvs adapter owns the
 *     snapshot read under NATIVE_RECORD_GRAIN).
 *
 * Controlled-pilot tooling (EC-SCVS-11-PRETOOL):
 *   - An OPTIONAL `options` argument adds an explicit candidate allowlist, a
 *     strict candidate ceiling, a dry-run (no-write) mode, and an EC-country
 *     guard. These exist so a FUTURE controlled live pilot can enrich a tiny,
 *     explicitly-named set of candidates safely.
 *   - Default (no options / the existing 2-arg call) is byte-for-byte the same
 *     behavior as before: every candidate in the batch is enriched and written.
 *   - The options never widen scope — they only ever restrict what is touched.
 *
 * Only server-side. No use in Client Components.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichCandidatesWithValidatedSources } from './enrich-candidates-with-validated-sources';

const EC_COUNTRY_CODE = 'EC' as const;
const EC_SCVS_SOURCE_KEY = 'ec_scvs' as const;

/** Default strict ceiling for a controlled allowlist run when a caller passes an
 *  allowlist but no explicit `maxCandidates`. Keeps pilot blast-radius tiny. */
export const EC_SCVS_CONTROLLED_PILOT_DEFAULT_MAX_CANDIDATES = 5;

/**
 * Opt-in guards for a controlled EC SCVS enrichment run. Every field is optional;
 * omitting all of them preserves the original full-batch behavior exactly.
 */
export interface EcScvsControlledEnrichmentOptions {
  /**
   * Explicit allowlist of `prospect_candidates.id` to process. When provided,
   * ONLY these candidates are enriched; every other candidate in the batch is
   * left completely untouched. Must be a non-empty array of unique, non-empty
   * ids, and every id must exist in the batch — otherwise the run fails closed
   * (no writes). An allowlist can only shrink the working set, never grow it.
   */
  candidateIds?: string[];
  /**
   * Strict upper bound on candidates processed. If the effective candidate count
   * (after allowlist + country filtering) exceeds this, the run ABORTS without
   * any write (fail-closed — never silently truncates). When an allowlist is
   * supplied without an explicit value, this defaults to
   * EC_SCVS_CONTROLLED_PILOT_DEFAULT_MAX_CANDIDATES.
   */
  maxCandidates?: number;
  /** When true, computes enrichment but performs NO database UPDATE (live-shadow). */
  dryRun?: boolean;
  /** When true, refuses any candidate whose country_code is not 'EC' (fail-closed). */
  requireEcCountry?: boolean;
}

export interface EcBatchValidatedSourceEnrichmentResult {
  attempted: boolean;
  candidatesProcessed: number;
  sourcesApplied: string[];
  matchedCount: number;
  ambiguousCount: number;
  noMatchCount: number;
  skippedCount: number;
  errorCount: number;
  warnings: string[];
  errors: string[];
  // ── Controlled-pilot observability (EC-SCVS-11-PRETOOL) ──────────────────────
  /** True when an explicit candidate allowlist restricted this run. */
  allowlistApplied: boolean;
  /** True when writes were suppressed (dry-run / live-shadow). */
  dryRun: boolean;
  /** Candidates refused by a hard guard (non-EC under requireEcCountry). */
  guardRejectedCount: number;
  /** True when a strict guard aborted the run before enrichment (no writes). */
  aborted: boolean;
  /** Number of candidate rows for which an UPDATE was actually issued (0 in dry-run). */
  updatedCount: number;
  /** Count of candidate ids selected for processing after allowlist filtering. */
  selectedCount: number;
}

function emptyResult(
  attempted: boolean,
  dryRun = false,
): EcBatchValidatedSourceEnrichmentResult {
  return {
    attempted,
    candidatesProcessed: 0,
    sourcesApplied: [],
    matchedCount: 0,
    ambiguousCount: 0,
    noMatchCount: 0,
    skippedCount: 0,
    errorCount: 0,
    warnings: [],
    errors: [],
    allowlistApplied: false,
    dryRun,
    guardRejectedCount: 0,
    aborted: false,
    updatedCount: 0,
    selectedCount: 0,
  };
}

/**
 * Sanitized, log-safe summary of a controlled run. Never contains full RUC,
 * raw_data, secrets, or candidate PII — only ids, counts and a status
 * distribution. Errors are truncated. Safe to `console.info`/persist.
 */
export interface EcScvsControlledRunSummary {
  batch_id: string;
  requested_candidate_count: number;
  selected_candidate_count: number;
  processed_candidate_count: number;
  updated_candidate_count: number;
  dry_run: boolean;
  allowlist_applied: boolean;
  aborted: boolean;
  status_distribution: {
    matched: number;
    ambiguous: number;
    no_match: number;
    skipped: number;
    error: number;
    guard_rejected: number;
  };
  errors: string[];
}

/** Truncate a free-text error so a summary never leaks long payloads. */
function sanitizeError(msg: string): string {
  const MAX = 200;
  const oneLine = msg.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX ? `${oneLine.slice(0, MAX)}…` : oneLine;
}

/**
 * Builds a sanitized summary from a controlled run result. `requestedCount` is
 * the number of ids the caller asked for (allowlist length, or the batch size
 * when no allowlist was used).
 */
export function summarizeEcScvsControlledRun(
  batchId: string,
  requestedCount: number,
  result: EcBatchValidatedSourceEnrichmentResult,
): EcScvsControlledRunSummary {
  return {
    batch_id: batchId,
    requested_candidate_count: requestedCount,
    selected_candidate_count: result.selectedCount,
    processed_candidate_count: result.candidatesProcessed,
    updated_candidate_count: result.updatedCount,
    dry_run: result.dryRun,
    allowlist_applied: result.allowlistApplied,
    aborted: result.aborted,
    status_distribution: {
      matched: result.matchedCount,
      ambiguous: result.ambiguousCount,
      no_match: result.noMatchCount,
      skipped: result.skippedCount,
      error: result.errorCount,
      guard_rejected: result.guardRejectedCount,
    },
    errors: result.errors.map(sanitizeError),
  };
}

/**
 * True when the ec_scvs adapter surfaced RUC multiplicity (multiple expedientes
 * for the same fiscal identity). The adapter reports this as status='no_match'
 * WITH signals.ruc_multiplicity='multiple' so ambiguity is never mistaken for a
 * validated single match.
 */
function isObservableAmbiguity(signals: unknown): boolean {
  if (!signals || typeof signals !== 'object') return false;
  return (signals as Record<string, unknown>)['ruc_multiplicity'] === 'multiple';
}

/**
 * Enriches all candidates of a batch with Ecuador validated sources (ec_scvs).
 *
 * Reads candidates for the batch, runs the country-aware validated-source
 * enrichment helper for EC, and persists the result under
 * metadata.source_enrichment.ec_scvs for each candidate. Fully fail-soft: any
 * error is captured and returned, never thrown.
 */
export async function enrichEcBatchWithValidatedSources(
  supabase: SupabaseClient,
  batchId: string,
  options: EcScvsControlledEnrichmentOptions = {},
): Promise<EcBatchValidatedSourceEnrichmentResult> {
  const { candidateIds, dryRun = false, requireEcCountry = false } = options;
  const allowlist = candidateIds ? new Set(candidateIds) : null;
  // When an allowlist is present without an explicit ceiling, apply the strict default.
  const maxCandidates =
    typeof options.maxCandidates === 'number'
      ? options.maxCandidates
      : allowlist
        ? EC_SCVS_CONTROLLED_PILOT_DEFAULT_MAX_CANDIDATES
        : undefined;

  try {
    const { data: candidates, error } = await supabase
      .from('prospect_candidates')
      .select('id, name, legal_name, country_code, tax_identifier, sector_description, metadata')
      .eq('batch_id', batchId);

    if (error || !candidates || candidates.length === 0) {
      const empty = emptyResult(true, dryRun);
      empty.allowlistApplied = allowlist !== null;
      if (allowlist && (!candidates || candidates.length === 0)) {
        empty.aborted = true;
        empty.errors.push('allowlist_but_batch_has_no_candidates');
      }
      return empty;
    }

    const result = emptyResult(true, dryRun);
    result.allowlistApplied = allowlist !== null;

    // ── Controlled-pilot guards (opt-in; default keeps full-batch behavior) ─────
    let working = candidates as Array<Record<string, unknown>>;

    // 0) Allowlist shape — an explicit allowlist must be non-empty and unique.
    if (candidateIds) {
      if (candidateIds.length === 0) {
        result.aborted = true;
        result.errors.push('empty_allowlist');
        return result;
      }
      if (new Set(candidateIds).size !== candidateIds.length) {
        result.aborted = true;
        result.errors.push('duplicate_candidate_ids');
        return result;
      }
    }

    // 1) Allowlist — keep ONLY explicitly listed ids. Fail closed if any
    //    requested id is missing from the batch (never silently drop it).
    if (allowlist) {
      const present = new Set(working.map((c) => c['id'] as string));
      const missing = [...allowlist].filter((id) => !present.has(id));
      if (missing.length > 0) {
        result.aborted = true;
        result.errors.push(`allowlist_ids_not_in_batch:${missing.length}`);
        return result;
      }
      working = working.filter((c) => allowlist.has(c['id'] as string));
    }

    // 2) requireEcCountry — refuse any candidate not tagged EC (fail-closed).
    if (requireEcCountry) {
      const kept: Array<Record<string, unknown>> = [];
      for (const c of working) {
        if (((c['country_code'] as string | null) ?? null) === EC_COUNTRY_CODE) {
          kept.push(c);
        } else {
          result.guardRejectedCount++;
        }
      }
      if (result.guardRejectedCount > 0) {
        // A controlled EC run must never touch a non-EC candidate: abort entirely.
        result.aborted = true;
        result.errors.push(`non_ec_candidates_rejected:${result.guardRejectedCount}`);
        return result;
      }
      working = kept;
    }

    result.selectedCount = working.length;

    // 3) maxCandidates — strict ceiling. Over the limit → abort, never truncate.
    if (typeof maxCandidates === 'number' && working.length > maxCandidates) {
      result.aborted = true;
      result.errors.push(`candidate_count_exceeds_max:${working.length}>${maxCandidates}`);
      return result;
    }

    if (working.length === 0) {
      return result;
    }

    const enrichResult = await enrichCandidatesWithValidatedSources({
      candidates: working.map((c) => ({
        name: (c['name'] as string) ?? (c['legal_name'] as string) ?? '',
        taxId: (c['tax_identifier'] as string | null) ?? null,
        countryCode: EC_COUNTRY_CODE,
        sector: (c['sector_description'] as string | null) ?? null,
        existingMetadata: (c['metadata'] as Record<string, unknown>) ?? {},
      })),
      countryCode: EC_COUNTRY_CODE,
      stage: 'post_discovery_enrichment',
    });

    result.sourcesApplied = enrichResult.sourcesApplied;
    result.warnings.push(...enrichResult.warnings);
    result.errors.push(...enrichResult.errors);

    const updateOps: Array<Promise<unknown>> = [];

    for (const r of enrichResult.results) {
      const candidate = working[r.candidateIndex];
      if (!candidate) continue;

      const existingMeta = (candidate['metadata'] as Record<string, unknown>) ?? {};
      const candidateId = candidate['id'] as string;

      const ecOutput = r.sourceEnrichments[EC_SCVS_SOURCE_KEY];
      const status = ecOutput?.status ?? 'skipped';
      const ambiguous = status === 'no_match' && isObservableAmbiguity(ecOutput?.signals);

      if (status === 'matched') result.matchedCount++;
      else if (ambiguous) result.ambiguousCount++;
      else if (status === 'no_match') result.noMatchCount++;
      else if (status === 'error') result.errorCount++;
      else result.skippedCount++;

      if (status !== 'skipped') result.candidatesProcessed++;

      const matched = status === 'matched';
      const summaryStatus = matched ? 'completed' : status === 'error' ? 'error' : 'no_match';

      const updatedMeta: Record<string, unknown> = {
        ...existingMeta,
        source_enrichment: {
          ...((existingMeta['source_enrichment'] as Record<string, unknown>) ?? {}),
          // Persist the full ec_scvs outcome (matched / no_match / skipped / error)
          // so ambiguity remains observable. The adapter never emits raw_data.
          ...r.enrichmentMetadata,
          _summary: {
            status: summaryStatus,
            enriched_at: new Date().toISOString(),
            country_code: EC_COUNTRY_CODE,
            source_keys_attempted: Object.keys(r.enrichmentMetadata),
            source_keys_matched: matched ? [EC_SCVS_SOURCE_KEY] : [],
            human_review_required: ambiguous,
            reason: matched ? null : (ecOutput?.reason ?? null),
          },
        },
      };

      // Dry-run / live-shadow: compute everything but issue NO write.
      if (dryRun) continue;

      updateOps.push(
        supabase
          .from('prospect_candidates')
          .update({ metadata: updatedMeta })
          .eq('id', candidateId) as unknown as Promise<unknown>,
      );
    }

    if (!dryRun) {
      await Promise.allSettled(updateOps);
    }
    result.updatedCount = updateOps.length;

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const r = emptyResult(true, dryRun);
    r.allowlistApplied = allowlist !== null;
    r.errors = [msg];
    return r;
  }
}
