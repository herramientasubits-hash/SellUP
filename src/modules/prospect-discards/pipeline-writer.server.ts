// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — best-effort, additive persistence of
// every terminal REJECTION the Apollo two-round pipeline already computed
// (`evaluateApolloCandidateFinalDispositions`, pure, unchanged) as a durable
// row in `prospect_discarded_dispositions`.
//
// Deliberately isolated from the orchestrator/production-runner:
//   - reads ONLY data already computed in memory (`ResumedCandidate.identity`,
//     the final-disposition entries) — makes ZERO provider calls of its own.
//   - writes ONLY the new table — never touches `prospect_candidates`,
//     `prospect_batches`, budget, or credit tables.
//   - NEVER throws. Every failure is caught, logged, and reported in the
//     returned summary — a persistence failure here must never fail or alter
//     the run's own result.
//
// Called exactly once per production write, from
// `production-runner.server.ts`, AFTER the existing candidate writer already
// ran — so it cannot affect candidate creation, budget, or existing counts.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  computeDiscardDispositionSourceKey,
  mapApolloFinalDispositionToCode,
} from './mapping';
import type { CreateDiscardedDispositionInput } from './types';

/** Minimal shape this module needs from a final-disposition entry. Kept as a
 *  structural type (not imported from the orchestrator) to avoid coupling
 *  this module's types to the Apollo pipeline's internal types. */
export interface FinalDispositionEntryLike {
  candidateKey: string;
  roundNumber: number;
  finalDisposition: string;
  finalReason: string | null;
}

/** Minimal shape this module needs from a resumed candidate's identity. */
export interface EvaluatedCandidateIdentityLike {
  candidateKey: string;
  identity: {
    providerOrganizationId: string | null;
    normalizedDomain: string | null;
    canonicalName: string | null;
  };
}

export interface PersistApolloRejectedDispositionsInput {
  batchId: string;
  /** Search-scoped context — the only country/industry available without
   *  threading raw provider organization fields through the pure orchestrator
   *  (out of scope for this hito: no Apollo pipeline changes). */
  requestedCountryCode: string | null;
  requestedIndustry: string | null;
  sourcePrimary: 'apollo';
  evaluatedCandidates: readonly EvaluatedCandidateIdentityLike[];
  finalDispositions: readonly FinalDispositionEntryLike[];
}

export interface PersistApolloRejectedDispositionsResult {
  attempted: number;
  persisted: number;
  failed: number;
  errors: string[];
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

/**
 * Best-effort UPSERT of one row per terminal rejection. Never throws — every
 * failure is caught and reported via the returned summary. `ON CONFLICT
 * (batch_id, source_key)` is the idempotency guarantee: calling this twice
 * for the same run (e.g. a resumed attempt) never duplicates a row.
 */
export async function persistApolloRejectedDispositions(
  input: PersistApolloRejectedDispositionsInput,
): Promise<PersistApolloRejectedDispositionsResult> {
  const result: PersistApolloRejectedDispositionsResult = {
    attempted: 0,
    persisted: 0,
    failed: 0,
    errors: [],
  };

  try {
    const identityByKey = new Map(
      input.evaluatedCandidates.map((c) => [c.candidateKey, c.identity]),
    );

    const rows: CreateDiscardedDispositionInput[] = [];
    for (const entry of input.finalDispositions) {
      const code = mapApolloFinalDispositionToCode(entry.finalDisposition);
      if (code === null) continue; // Not a rejection — persisted or review-only.

      const identity = identityByKey.get(entry.candidateKey);
      const name = identity?.canonicalName?.trim();
      if (!name) continue; // No usable name to show — nothing to persist.

      rows.push({
        batchId: input.batchId,
        providerIdentifier: identity?.providerOrganizationId ?? null,
        sourceKey: computeDiscardDispositionSourceKey({
          domain: identity?.normalizedDomain ?? null,
          providerIdentifier: identity?.providerOrganizationId ?? null,
          name,
        }),
        name,
        domain: identity?.normalizedDomain ?? null,
        countryCode: input.requestedCountryCode,
        industry: input.requestedIndustry,
        sourcePrimary: input.sourcePrimary,
        roundOrigin: `round_${entry.roundNumber}`,
        disposition: code,
        reasonCode: entry.finalDisposition,
        reasonDetail: entry.finalReason,
        evidence: {
          candidate_key: entry.candidateKey,
          round_number: entry.roundNumber,
          final_disposition: entry.finalDisposition,
          final_reason: entry.finalReason,
          requested_country_code: input.requestedCountryCode,
          requested_industry: input.requestedIndustry,
        },
      });
    }

    result.attempted = rows.length;
    if (rows.length === 0) return result;

    const supabase = getAdminClient();
    const payload = rows.map((row) => ({
      batch_id: row.batchId,
      provider_identifier: row.providerIdentifier,
      source_key: row.sourceKey,
      name: row.name,
      domain: row.domain,
      country_code: row.countryCode,
      industry: row.industry,
      source_primary: row.sourcePrimary,
      round_origin: row.roundOrigin,
      disposition: row.disposition,
      reason_code: row.reasonCode,
      reason_detail: row.reasonDetail,
      evidence: row.evidence,
    }));

    const { data, error } = await supabase
      .from('prospect_discarded_dispositions')
      .upsert(payload, { onConflict: 'batch_id,source_key', ignoreDuplicates: false })
      .select('id');

    if (error) {
      result.failed = rows.length;
      result.errors.push(error.message);
      console.error(
        '[prospect-discards] persistApolloRejectedDispositions upsert failed (non-critical):',
        error,
      );
      return result;
    }

    result.persisted = data?.length ?? rows.length;
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.failed = result.attempted;
    result.errors.push(message);
    console.error(
      '[prospect-discards] persistApolloRejectedDispositions failed (non-critical):',
      err,
    );
    return result;
  }
}
