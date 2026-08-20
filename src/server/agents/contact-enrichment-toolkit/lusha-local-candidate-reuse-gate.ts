// Agente 2A — Pre-Provider LOCAL Lusha Candidate Reuse Gate
// AGENT2A-LUSHA-LOCAL-REUSE-GATE-1
//
// Purpose: when the Apollo attempt produced zero reviewable candidates and the
// automatic router would normally fall back to Lusha, first answer a question
// that costs nothing — does SellUp ALREADY hold at least one actionable
// same-company Lusha candidate awaiting review? If it does, the operation is
// already satisfiable locally and there is nothing for the provider to add
// that a human has not yet looked at.
//
// This is NOT a provider operation. It issues read-only Supabase queries and
// no network call to Apollo, Lusha or HubSpot; it creates no candidate row, no
// attempt, no provider_usage_logs row, spends no credit and reveals no phone.
// It never copies, refreshes, revives, re-enriches or approves the existing
// candidate: the candidate that is already in pending_review simply REMAINS
// the reviewable deliverable.
//
// RELATIONSHIP WITH THE PROVIDER-NATIVE NOVELTY GATE (#315) — different
// problems, both still necessary:
//
//   this module — BEFORE Lusha Prospecting/Search: avoids the Prospecting call
//                 itself when an existing actionable candidate already
//                 satisfies the reviewable-result condition.
//   #315        — AFTER Lusha Prospecting: stops already-known Lusha
//                 contactIds from proceeding into the paid
//                 /v3/contacts/enrich leg.
//
// COMPANY IDENTITY is delegated in full to #315's exported helpers
// (resolveStrongestCompanyScopeKind / matchesDeterministicCompanyScope /
// hasDeterministicCompanyKey): strongest deterministic key both sides possess,
// account_id > HubSpot company id > normalized domain, never falling through
// to a weaker key when the strongest shared one disagrees. Company NAME, fuzzy
// matching, email identity, LinkedIn identity, person name and cross-provider
// aliases are all forbidden here and none of them is read.
//
// FAIL OPEN, always. No deterministic company key, an unreadable request, a
// lookup error or missing Supabase credentials all mean "do not skip the
// fallback" — the existing provider pipeline runs unchanged. A reuse
// optimization that cannot be evaluated must never block normal fallback.
//
// SUPPRESS-ONLY, never reuse: approved / discarded / duplicate candidates,
// possible_duplicate / exact_duplicate duplicate_status, and pending_review
// rows without an email do NOT satisfy this gate. They also do not trigger any
// automatic direct re-enrich — a known identity is not a purchase trigger.
// Keeping them out of paid rediscovery stays #315's job.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  hasDeterministicCompanyKey,
  matchesDeterministicCompanyScope,
  resolveStrongestCompanyScopeKind,
  type CompanyIdentityKeysV1,
  type CompanyScopeKind,
} from './provider-native-novelty-gate';
import { normalizeDomain } from './company-consistency-checker';

/**
 * Binary threshold. The current router has NO numeric candidate target: its
 * fallback signal is "zero reviewable candidates", so ONE actionable
 * reviewable candidate is exactly what makes the fallback unnecessary.
 * LUSHA_MAX_CANDIDATES_PER_RUN is a per-run CAP on the Lusha runner and is
 * deliberately not reinterpreted as a target here.
 */
export const ACTIONABLE_LUSHA_REUSE_THRESHOLD = 1;

/** The only candidate source this gate ever considers. Cross-provider reuse is forbidden. */
export const REUSABLE_LUSHA_CANDIDATE_SOURCE = 'lusha' as const;

/** The only candidate lifecycle status that can satisfy local reuse. */
export const REUSABLE_LUSHA_CANDIDATE_STATUS = 'pending_review' as const;

/** The only duplicate_status that can satisfy local reuse. */
export const REUSABLE_LUSHA_CANDIDATE_DUPLICATE_STATUS = 'no_match' as const;

/**
 * Candidate lifecycle / duplicate states that are SUPPRESS-ONLY: they prove a
 * prior provider identity (so #315 keeps them out of automatic paid
 * rediscovery) but they are NOT an actionable reviewable deliverable, so they
 * can never satisfy this gate. Exported so the suite can assert the full set.
 */
export const SUPPRESS_ONLY_NOT_REUSABLE_STATES = [
  'status:approved',
  'status:discarded',
  'status:duplicate',
  'duplicate_status:possible_duplicate',
  'duplicate_status:exact_duplicate',
  'duplicate_status:unchecked',
  'pending_review_without_email',
] as const;

// ── Row shape (what the reader returns) ─────────────────────────

export interface ReusableLushaCandidateRowV1 {
  /** contact_enrichment_candidates.source — always filtered to 'lusha' by the reader, kept for auditability. */
  source: string;
  /** contact_enrichment_candidates.source_contact_id — the Lusha-native identity. Never logged raw. */
  sourceContactId: string | null;
  status: string;
  duplicateStatus: string;
  email: string | null;
  /** contact_enrichment_runs.request_id of the run that produced the candidate. */
  requestId: string | null;
  /** Company identity of the run that produced the candidate. */
  company: CompanyIdentityKeysV1;
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The ACTIONABLE REUSE CONTRACT, as a pure predicate. ALL of:
 *   - source = 'lusha'
 *   - source_contact_id present (a real Lusha-native identity)
 *   - status = 'pending_review'
 *   - email present
 *   - duplicate_status = 'no_match'
 * LinkedIn is OPTIONAL and is not read at all.
 *
 * Company scope is NOT decided here — it is a separate, deterministic
 * question answered by matchesDeterministicCompanyScope.
 */
export function isActionableReusableLushaCandidate(row: ReusableLushaCandidateRowV1): boolean {
  if (row.source !== REUSABLE_LUSHA_CANDIDATE_SOURCE) return false;
  if (!nonEmpty(row.sourceContactId)) return false;
  if (row.status !== REUSABLE_LUSHA_CANDIDATE_STATUS) return false;
  if (!nonEmpty(row.email)) return false;
  if (row.duplicateStatus !== REUSABLE_LUSHA_CANDIDATE_DUPLICATE_STATUS) return false;
  return true;
}

export interface ActionableReusableSelectionV1 {
  actionableCount: number;
  /** How each accepted candidate proved same-company. Aggregate only — no ids. */
  matchedByCounts: Record<CompanyScopeKind, number>;
  /** Strongest scope kind that actually matched, or 'none'. */
  companyScopeKind: CompanyScopeKind;
}

const SCOPE_STRENGTH: readonly CompanyScopeKind[] = [
  'account_id',
  'hubspot_company_id',
  'company_domain',
];

/**
 * Reduces historic candidate rows to the count of ACTIONABLE, SAME-COMPANY
 * reusable Lusha candidates. Pure: no I/O, no clock, no randomness.
 *
 * Rows produced by a run belonging to the CURRENT request are excluded — a
 * request can never satisfy itself.
 */
export function selectActionableReusableLushaCandidates(
  currentRequestId: string,
  current: CompanyIdentityKeysV1,
  rows: readonly ReusableLushaCandidateRowV1[],
): ActionableReusableSelectionV1 {
  const matchedByCounts: Record<CompanyScopeKind, number> = {
    account_id: 0,
    hubspot_company_id: 0,
    company_domain: 0,
    none: 0,
  };

  if (!hasDeterministicCompanyKey(current)) {
    return { actionableCount: 0, matchedByCounts, companyScopeKind: 'none' };
  }

  let actionableCount = 0;
  for (const row of rows) {
    if (row.requestId && row.requestId === currentRequestId) continue;
    if (!isActionableReusableLushaCandidate(row)) continue;
    const scope = matchesDeterministicCompanyScope(current, row.company);
    if (!scope.matched) continue;
    actionableCount += 1;
    matchedByCounts[scope.matchedBy] += 1;
  }

  const companyScopeKind = SCOPE_STRENGTH.find((kind) => matchedByCounts[kind] > 0) ?? 'none';
  return { actionableCount, matchedByCounts, companyScopeKind };
}

// ── Bounded readers ─────────────────────────────────────────────

export interface RequestCompanyKeysLookupResultV1 {
  company: CompanyIdentityKeysV1 | null;
  lookupError: string | null;
}

export interface ReusableLushaCandidateLookupInputV1 {
  /** Company keys of the CURRENT request — bounds the run lookup. */
  current: CompanyIdentityKeysV1;
  /** Runs belonging to this request are excluded so a request never satisfies itself. */
  currentRequestId: string;
}

export interface ReusableLushaCandidateLookupResultV1 {
  rows: ReusableLushaCandidateRowV1[];
  lookupError: string | null;
}

export type RequestCompanyKeysReaderV1 = (
  requestId: string,
) => Promise<RequestCompanyKeysLookupResultV1>;

export type ReusableLushaCandidateReaderV1 = (
  input: ReusableLushaCandidateLookupInputV1,
) => Promise<ReusableLushaCandidateLookupResultV1>;

/**
 * Hard caps. The gate only needs to know whether ONE actionable candidate
 * exists, so a truncated read can only ever produce a conservative MISS (the
 * existing provider fallback then runs, exactly as it does today) — never a
 * wrong HIT.
 */
export const REUSE_RUN_SCOPE_ROW_LIMIT = 200;
export const REUSE_CANDIDATE_ROW_LIMIT = 200;

function getAdminClientOrNull(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // No hardcoded project fallback and no throw: missing config means the gate
  // cannot prove anything and must fail open instead of crashing a run.
  if (!url || !key) return null;
  return createAdminClient(url, key);
}

/**
 * The CURRENT company keys, read from contact_enrichment_requests for
 * input.requestId — the request is the authority for the company being worked
 * on, not any individual attempt run.
 */
export const readContactEnrichmentRequestCompanyKeys: RequestCompanyKeysReaderV1 = async (
  requestId,
) => {
  const id = requestId?.trim();
  if (!id) return { company: null, lookupError: 'missing_request_id' };

  const admin = getAdminClientOrNull();
  if (!admin) return { company: null, lookupError: 'supabase_service_credentials_not_configured' };

  try {
    const { data, error } = await admin
      .from('contact_enrichment_requests')
      .select('account_id, hubspot_company_id, company_domain')
      .eq('id', id)
      .maybeSingle();

    if (error) return { company: null, lookupError: error.message };
    if (!data) return { company: null, lookupError: 'request_not_found' };

    return {
      company: {
        accountId: (data as { account_id: string | null }).account_id ?? null,
        hubspotCompanyId: (data as { hubspot_company_id: string | null }).hubspot_company_id ?? null,
        companyDomain: (data as { company_domain: string | null }).company_domain ?? null,
      },
      lookupError: null,
    };
  } catch (err) {
    return { company: null, lookupError: err instanceof Error ? err.message : 'unknown_lookup_error' };
  }
};

/**
 * Literal spellings of a company domain that an EXACT SQL match can find.
 * `contact_enrichment_runs.company_domain` is stored raw, and normalizeDomain
 * (protocol/www/case stripping) has no SQL equivalent here, so the SQL leg is
 * bounded by a small deterministic set of spellings and the application-level
 * deterministic helper stays authoritative over whatever comes back. A row
 * stored in some other spelling is simply not found — a conservative MISS, not
 * a fuzzy match: there is no LIKE, no suffix match and no wildcard anywhere.
 */
export function buildDomainLookupSpellings(companyDomain: string | null): string[] {
  const normalized = normalizeDomain(companyDomain);
  if (!normalized) return [];
  const raw = typeof companyDomain === 'string' ? companyDomain.trim().toLowerCase() : '';
  const spellings = [normalized, `www.${normalized}`, raw].filter((value) => value.length > 0);
  return [...new Set(spellings)];
}

interface RawScopedRunRow {
  id: string;
  request_id: string | null;
  account_id: string | null;
  hubspot_company_id: string | null;
  company_domain: string | null;
}

interface RawReusableCandidateRow {
  source: string;
  source_contact_id: string | null;
  status: string;
  duplicate_status: string;
  email: string | null;
  enrichment_run_id: string;
}

/**
 * BOUNDED, read-only, and never N+1: a constant number of queries (at most
 * three company-keyed run lookups plus ONE candidate lookup) regardless of how
 * many candidates exist, and every query carries an explicit row limit.
 *
 * Phase 1 resolves the historic runs that could belong to the same company,
 * keyed ONLY by the deterministic keys the current request actually possesses
 * (account_id, HubSpot company id, exact domain spellings). Each leg is an
 * index-backed equality/IN filter — no table scan, no LIKE, no OR-string
 * construction. Runs belonging to the CURRENT request are dropped here.
 *
 * Phase 2 reads candidates for those run ids only, already narrowed to the
 * actionable contract at the SQL layer (source, status, duplicate_status,
 * non-null email and source_contact_id).
 *
 * The application-level company-scope helper (#315) remains authoritative: SQL
 * is used strictly to BOUND the read, never to decide same-company.
 */
export const readReusableLushaCandidatesForCompanyScope: ReusableLushaCandidateReaderV1 = async ({
  current,
  currentRequestId,
}) => {
  if (!hasDeterministicCompanyKey(current)) {
    return { rows: [], lookupError: null };
  }

  const admin = getAdminClientOrNull();
  if (!admin) return { rows: [], lookupError: 'supabase_service_credentials_not_configured' };

  const RUN_COLUMNS = 'id, request_id, account_id, hubspot_company_id, company_domain';

  try {
    type RunLegResult = { data: RawScopedRunRow[] | null; error: { message: string } | null };
    const runLegs: Array<Promise<RunLegResult>> = [];

    const runLeg = async (
      apply: (
        builder: ReturnType<ReturnType<SupabaseClient['from']>['select']>,
      ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
    ): Promise<RunLegResult> => {
      const { data, error } = await apply(
        admin.from('contact_enrichment_runs').select(RUN_COLUMNS),
      );
      return { data: (data ?? null) as RawScopedRunRow[] | null, error: error ?? null };
    };

    const accountId = current.accountId?.trim();
    if (accountId) {
      runLegs.push(
        runLeg((builder) => builder.eq('account_id', accountId).limit(REUSE_RUN_SCOPE_ROW_LIMIT)),
      );
    }

    const hubspotCompanyId = current.hubspotCompanyId?.trim();
    if (hubspotCompanyId) {
      runLegs.push(
        runLeg((builder) =>
          builder.eq('hubspot_company_id', hubspotCompanyId).limit(REUSE_RUN_SCOPE_ROW_LIMIT),
        ),
      );
    }

    const domainSpellings = buildDomainLookupSpellings(current.companyDomain);
    if (domainSpellings.length > 0) {
      runLegs.push(
        runLeg((builder) =>
          builder.in('company_domain', domainSpellings).limit(REUSE_RUN_SCOPE_ROW_LIMIT),
        ),
      );
    }

    if (runLegs.length === 0) return { rows: [], lookupError: null };

    const legResults = await Promise.all(runLegs);
    for (const leg of legResults) {
      if (leg.error) return { rows: [], lookupError: leg.error.message };
    }

    const runsById = new Map<string, RawScopedRunRow>();
    for (const leg of legResults) {
      for (const row of leg.data ?? []) {
        if (!row?.id) continue;
        // A request can never satisfy itself.
        if (row.request_id && row.request_id === currentRequestId) continue;
        runsById.set(row.id, row);
      }
    }

    const runIds = [...runsById.keys()];
    if (runIds.length === 0) return { rows: [], lookupError: null };

    const { data: candidateData, error: candidateError } = await admin
      .from('contact_enrichment_candidates')
      .select('source, source_contact_id, status, duplicate_status, email, enrichment_run_id')
      .in('enrichment_run_id', runIds)
      .eq('source', REUSABLE_LUSHA_CANDIDATE_SOURCE)
      .eq('status', REUSABLE_LUSHA_CANDIDATE_STATUS)
      .eq('duplicate_status', REUSABLE_LUSHA_CANDIDATE_DUPLICATE_STATUS)
      .not('source_contact_id', 'is', null)
      .not('email', 'is', null)
      .limit(REUSE_CANDIDATE_ROW_LIMIT);

    if (candidateError) return { rows: [], lookupError: candidateError.message };

    const rows: ReusableLushaCandidateRowV1[] = ((candidateData ?? []) as RawReusableCandidateRow[])
      .map((row) => {
        const run = runsById.get(row.enrichment_run_id);
        return {
          source: row.source,
          sourceContactId: row.source_contact_id ?? null,
          status: row.status,
          duplicateStatus: row.duplicate_status,
          email: row.email ?? null,
          requestId: run?.request_id ?? null,
          company: {
            accountId: run?.account_id ?? null,
            hubspotCompanyId: run?.hubspot_company_id ?? null,
            companyDomain: run?.company_domain ?? null,
          },
        };
      });

    return { rows, lookupError: null };
  } catch (err) {
    return { rows: [], lookupError: err instanceof Error ? err.message : 'unknown_lookup_error' };
  }
};

// ── Gate (observability + orchestration) ────────────────────────

export type LushaLocalReuseSkipReason =
  | 'gate_disabled'
  | 'request_company_keys_unavailable'
  | 'no_deterministic_company_key'
  | 'lookup_error'
  | 'no_actionable_reusable_candidate';

/**
 * Routing/run-level observability for the gate. Counters only: no candidate
 * ids, no raw Lusha contactIds, no email, no LinkedIn.
 *
 * `provider_calls` is 0 as a matter of fact — this branch performs no provider
 * network call at all. It deliberately does NOT claim avoided paid calls,
 * credits saved, USD saved or projected savings: the counterfactual provider
 * spend of a fallback that never ran is not measured here.
 *
 * This block never becomes a provider_usage_logs row. A fabricated
 * "Lusha success / 0 credits" usage row would distort provider call count,
 * effectiveness, credit metrics and success rate.
 */
export interface LushaLocalReuseObservabilityV1 {
  gate_applied: boolean;
  gate_skipped_reason: LushaLocalReuseSkipReason | null;
  actionable_reusable_candidate_count: number;
  threshold: number;
  provider_calls: 0;
  outcome: 'fallback_satisfied_by_existing_candidate' | 'fallback_not_satisfied_locally';
  company_scope_kind: CompanyScopeKind;
  lookup_error: string | null;
}

export interface LushaLocalReuseGateResultV1 {
  /** true ⇒ the fallback is already satisfied locally; skip ALL Lusha provider work. */
  hit: boolean;
  actionableReusableCandidateCount: number;
  observability: LushaLocalReuseObservabilityV1;
}

export interface EvaluateLushaLocalReuseGateInputV1 {
  requestId: string;
}

export interface EvaluateLushaLocalReuseGateDepsV1 {
  isGateEnabled: () => boolean;
  readRequestCompanyKeys?: RequestCompanyKeysReaderV1;
  readReusableCandidates?: ReusableLushaCandidateReaderV1;
}

function miss(
  reason: LushaLocalReuseSkipReason,
  companyScopeKind: CompanyScopeKind,
  lookupError: string | null,
  actionableCount = 0,
): LushaLocalReuseGateResultV1 {
  return {
    hit: false,
    actionableReusableCandidateCount: actionableCount,
    observability: {
      gate_applied: reason === 'no_actionable_reusable_candidate',
      gate_skipped_reason: reason,
      actionable_reusable_candidate_count: actionableCount,
      threshold: ACTIONABLE_LUSHA_REUSE_THRESHOLD,
      provider_calls: 0,
      outcome: 'fallback_not_satisfied_locally',
      company_scope_kind: companyScopeKind,
      lookup_error: lookupError,
    },
  };
}

/**
 * Evaluates local reuse. Returns hit=true ONLY when at least
 * ACTIONABLE_LUSHA_REUSE_THRESHOLD actionable same-company Lusha candidates
 * already sit in pending_review. Every uncertain case is a MISS, which means
 * "run the existing provider fallback unchanged".
 *
 * When the gate flag is off this returns immediately: neither reader is
 * called, so no extra query is issued and the router's behaviour is identical
 * to the pre-gate code path.
 */
export async function evaluateLushaLocalCandidateReuseGate(
  input: EvaluateLushaLocalReuseGateInputV1,
  deps: EvaluateLushaLocalReuseGateDepsV1,
): Promise<LushaLocalReuseGateResultV1> {
  const {
    isGateEnabled,
    readRequestCompanyKeys = readContactEnrichmentRequestCompanyKeys,
    readReusableCandidates = readReusableLushaCandidatesForCompanyScope,
  } = deps;

  if (!isGateEnabled()) {
    return miss('gate_disabled', 'none', null);
  }

  const requestId = input.requestId?.trim();
  if (!requestId) {
    return miss('request_company_keys_unavailable', 'none', 'missing_request_id');
  }

  const { company, lookupError: requestError } = await readRequestCompanyKeys(requestId);
  if (requestError || !company) {
    return miss('request_company_keys_unavailable', 'none', requestError ?? 'request_company_keys_missing');
  }

  const currentScopeKind = resolveStrongestCompanyScopeKind(company);
  if (currentScopeKind === 'none') {
    return miss('no_deterministic_company_key', 'none', null);
  }

  const { rows, lookupError } = await readReusableCandidates({ current: company, currentRequestId: requestId });
  if (lookupError) {
    return miss('lookup_error', currentScopeKind, lookupError);
  }

  const selection = selectActionableReusableLushaCandidates(requestId, company, rows);

  if (selection.actionableCount < ACTIONABLE_LUSHA_REUSE_THRESHOLD) {
    return miss('no_actionable_reusable_candidate', selection.companyScopeKind, null, selection.actionableCount);
  }

  return {
    hit: true,
    actionableReusableCandidateCount: selection.actionableCount,
    observability: {
      gate_applied: true,
      gate_skipped_reason: null,
      actionable_reusable_candidate_count: selection.actionableCount,
      threshold: ACTIONABLE_LUSHA_REUSE_THRESHOLD,
      provider_calls: 0,
      outcome: 'fallback_satisfied_by_existing_candidate',
      company_scope_kind: selection.companyScopeKind,
      lookup_error: null,
    },
  };
}
