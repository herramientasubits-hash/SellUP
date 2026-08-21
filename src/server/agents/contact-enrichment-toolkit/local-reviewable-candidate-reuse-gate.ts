// Agente 2A — Pre-Provider LOCAL Reviewable Candidate Reuse Gate
// AGENT2A-LOCAL-REVIEWABLE-CANDIDATE-REUSE-1.1
//
// Purpose: when the Apollo attempt produced zero reviewable candidates and the
// automatic router would normally fall back to Lusha, first answer a question
// that costs nothing — does SellUp ALREADY hold at least one actionable
// same-company candidate awaiting human review? If it does, the operation is
// already satisfiable locally and there is nothing for the provider to add
// that a human has not yet looked at.
//
// PROVIDER-AGNOSTIC BY CONSTRUCTION (corrected in 1.1). The first draft of
// this gate only admitted source='lusha' candidates, which left a real cost
// leak. The router's fallback signal is derived from
// attempt1Result.candidatesCreated, and #315 removes already-known Apollo
// person_ids BEFORE the paid /people/match leg. So a repeat run can
// legitimately reach candidatesCreated=0 — "zero_reviewable_candidates" —
// while SellUp already holds an actionable pending_review APOLLO candidate for
// that same company. A Lusha-only predicate ignored it and started Lusha
// provider work anyway. The reusable set is therefore source IN
// ('apollo','lusha') for this milestone.
//
// THIS IS A COMPANY-LEVEL REVIEWABILITY QUESTION, NOT AN IDENTITY CLAIM.
// The question answered here is only: "does SellUp already have at least one
// actionable candidate for this same company waiting for human review?"
// Emphatically NOT asserted, computed or implied anywhere in this module:
//   * that an Apollo person_id equals a Lusha contactId;
//   * that a person is the same person across two providers;
//   * any alias, translation or mapping between provider-native ids;
//   * any suppression of a specific Lusha contactId by an Apollo row, or of a
//     specific Apollo person_id by a Lusha row.
// source_contact_id values are NEVER compared to each other — not within a
// provider and not across providers. Each is only tested for PRESENCE (see
// isActionableReusableLocalCandidate). The existing candidate keeps its own
// source and its own provider identity untouched; the router simply declines
// to buy ANOTHER candidate when a reviewable deliverable already exists.
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
//                 /v3/contacts/enrich leg. #315 is unchanged by this gate.
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
// possible_duplicate / exact_duplicate / unchecked duplicate_status, and
// pending_review rows without an email do NOT satisfy this gate, whatever
// their source. They also do not trigger any automatic direct re-enrich — a
// known identity is not a purchase trigger. Keeping them out of paid
// rediscovery stays #315's job.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  hasDeterministicCompanyKey,
  matchesDeterministicCompanyScope,
  resolveStrongestCompanyScopeKind,
  type CompanyIdentityKeysV1,
  type CompanyScopeKind,
  type ContactDiscoveryProviderKey,
} from './provider-native-novelty-gate';
import { normalizeDomain } from './company-consistency-checker';

/**
 * Binary threshold. The current router has NO numeric candidate target: its
 * fallback signal is "zero reviewable candidates", so ONE actionable
 * reviewable candidate is exactly what makes the fallback unnecessary.
 * LUSHA_MAX_CANDIDATES_PER_RUN is a per-run CAP on the Lusha runner and is
 * deliberately not reinterpreted as a target here.
 */
export const ACTIONABLE_LOCAL_REUSE_THRESHOLD = 1;

/**
 * The candidate sources this gate considers for THIS milestone. Both are
 * provider-backed contact-discovery sources whose candidates land in the same
 * pending_review queue and are reviewed by the same human, which is the only
 * property that matters to the reviewability question.
 *
 * Admitting both is NOT a cross-provider identity claim — see the module
 * header. It is the reason the gate closes the cost leak instead of leaving it
 * open for Apollo-originated candidates.
 */
export const REUSABLE_LOCAL_CANDIDATE_SOURCES: readonly ContactDiscoveryProviderKey[] = [
  'apollo',
  'lusha',
];

/** The only candidate lifecycle status that can satisfy local reuse. */
export const REUSABLE_LOCAL_CANDIDATE_STATUS = 'pending_review' as const;

/** The only duplicate_status that can satisfy local reuse. */
export const REUSABLE_LOCAL_CANDIDATE_DUPLICATE_STATUS = 'no_match' as const;

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

export interface ReusableLocalCandidateRowV1 {
  /**
   * contact_enrichment_candidates.source — filtered to
   * REUSABLE_LOCAL_CANDIDATE_SOURCES by the reader and re-checked by the pure
   * predicate. Retained so the aggregate source_counts telemetry is truthful
   * and so an unexpected source can be proven out.
   */
  source: string;
  /**
   * contact_enrichment_candidates.source_contact_id — the candidate's OWN
   * provider-native identity, under its OWN source. Required only as evidence
   * that this is a durable provider-backed candidate rather than a manual or
   * fabricated row. Its VALUE is never compared to anything, here or
   * elsewhere in this module, and it is never logged.
   */
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
 *   - source IN ('apollo', 'lusha')
 *   - source_contact_id present — PRESENCE only, never compared by value, so
 *     manual/fabricated rows without a provider-native identity stay out
 *   - status = 'pending_review'
 *   - email present
 *   - duplicate_status = 'no_match'
 * LinkedIn is OPTIONAL and is not read at all.
 *
 * Company scope is NOT decided here — it is a separate, deterministic
 * question answered by matchesDeterministicCompanyScope.
 */
export function isActionableReusableLocalCandidate(row: ReusableLocalCandidateRowV1): boolean {
  if (!isReusableCandidateSource(row.source)) return false;
  if (!nonEmpty(row.sourceContactId)) return false;
  if (row.status !== REUSABLE_LOCAL_CANDIDATE_STATUS) return false;
  if (!nonEmpty(row.email)) return false;
  if (row.duplicateStatus !== REUSABLE_LOCAL_CANDIDATE_DUPLICATE_STATUS) return false;
  return true;
}

function isReusableCandidateSource(source: string): source is ContactDiscoveryProviderKey {
  return (REUSABLE_LOCAL_CANDIDATE_SOURCES as readonly string[]).includes(source);
}

/** Aggregate per-source counts. Counts only — never ids, emails or LinkedIn. */
export type ReusableSourceCounts = Record<ContactDiscoveryProviderKey, number>;

export interface ActionableReusableSelectionV1 {
  actionableCount: number;
  /** How each accepted candidate proved same-company. Aggregate only — no ids. */
  matchedByCounts: Record<CompanyScopeKind, number>;
  /** Strongest scope kind that actually matched, or 'none'. */
  companyScopeKind: CompanyScopeKind;
  /** Aggregate count of accepted candidates per source. Aggregate only — no ids. */
  sourceCounts: ReusableSourceCounts;
}

const SCOPE_STRENGTH: readonly CompanyScopeKind[] = [
  'account_id',
  'hubspot_company_id',
  'company_domain',
];

function emptySourceCounts(): ReusableSourceCounts {
  return { apollo: 0, lusha: 0 };
}

/**
 * Reduces historic candidate rows to the count of ACTIONABLE, SAME-COMPANY
 * reusable candidates. Pure: no I/O, no clock, no randomness.
 *
 * Rows produced by a run belonging to the CURRENT request are excluded — a
 * request can never satisfy itself, so the Apollo candidates the current
 * attempt just created (if any) can never be the reason its own fallback is
 * skipped.
 *
 * Sources are counted independently and summed. No row is ever compared to
 * another row: there is no pairing, matching, deduplication or identity
 * reconciliation step, across providers or within one.
 */
export function selectActionableReusableLocalCandidates(
  currentRequestId: string,
  current: CompanyIdentityKeysV1,
  rows: readonly ReusableLocalCandidateRowV1[],
): ActionableReusableSelectionV1 {
  const matchedByCounts: Record<CompanyScopeKind, number> = {
    account_id: 0,
    hubspot_company_id: 0,
    company_domain: 0,
    none: 0,
  };
  const sourceCounts = emptySourceCounts();

  if (!hasDeterministicCompanyKey(current)) {
    return { actionableCount: 0, matchedByCounts, companyScopeKind: 'none', sourceCounts };
  }

  let actionableCount = 0;
  for (const row of rows) {
    if (row.requestId && row.requestId === currentRequestId) continue;
    if (!isActionableReusableLocalCandidate(row)) continue;
    const scope = matchesDeterministicCompanyScope(current, row.company);
    if (!scope.matched) continue;
    actionableCount += 1;
    matchedByCounts[scope.matchedBy] += 1;
    if (isReusableCandidateSource(row.source)) sourceCounts[row.source] += 1;
  }

  const companyScopeKind = SCOPE_STRENGTH.find((kind) => matchedByCounts[kind] > 0) ?? 'none';
  return { actionableCount, matchedByCounts, companyScopeKind, sourceCounts };
}

// ── Bounded readers ─────────────────────────────────────────────

export interface RequestCompanyKeysLookupResultV1 {
  company: CompanyIdentityKeysV1 | null;
  lookupError: string | null;
}

export interface ReusableLocalCandidateLookupInputV1 {
  /** Company keys of the CURRENT request — bounds the run lookup. */
  current: CompanyIdentityKeysV1;
  /** Runs belonging to this request are excluded so a request never satisfies itself. */
  currentRequestId: string;
}

export interface ReusableLocalCandidateLookupResultV1 {
  rows: ReusableLocalCandidateRowV1[];
  lookupError: string | null;
}

export type RequestCompanyKeysReaderV1 = (
  requestId: string,
) => Promise<RequestCompanyKeysLookupResultV1>;

export type ReusableLocalCandidateReaderV1 = (
  input: ReusableLocalCandidateLookupInputV1,
) => Promise<ReusableLocalCandidateLookupResultV1>;

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
 * actionable contract at the SQL layer (source IN ('apollo','lusha'), status,
 * duplicate_status, non-null email and non-null source_contact_id). Widening
 * the source filter from one provider to two changes the row count this ONE
 * query can return, never the number of queries.
 *
 * The application-level company-scope helper (#315) remains authoritative: SQL
 * is used strictly to BOUND the read, never to decide same-company.
 */
export const readReusableLocalCandidatesForCompanyScope: ReusableLocalCandidateReaderV1 = async ({
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
      .in('source', [...REUSABLE_LOCAL_CANDIDATE_SOURCES])
      .eq('status', REUSABLE_LOCAL_CANDIDATE_STATUS)
      .eq('duplicate_status', REUSABLE_LOCAL_CANDIDATE_DUPLICATE_STATUS)
      .not('source_contact_id', 'is', null)
      .not('email', 'is', null)
      .limit(REUSE_CANDIDATE_ROW_LIMIT);

    if (candidateError) return { rows: [], lookupError: candidateError.message };

    const rows: ReusableLocalCandidateRowV1[] = ((candidateData ?? []) as RawReusableCandidateRow[])
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

export type LocalReuseSkipReason =
  | 'gate_disabled'
  | 'request_company_keys_unavailable'
  | 'no_deterministic_company_key'
  | 'lookup_error'
  | 'no_actionable_reusable_candidate';

/**
 * Routing/run-level observability for the gate. Counters only: no candidate
 * ids, no provider-native ids, no email, no LinkedIn.
 *
 * `source_counts` carries AGGREGATE per-source counts. Aggregate counts of
 * which sources satisfied a company-level reviewability question are not
 * provider-native identities and reveal no person.
 *
 * `provider_calls` is 0 as a matter of fact — this branch performs no provider
 * network call at all. It deliberately does NOT claim avoided paid calls,
 * credits saved, USD saved or projected savings: the counterfactual provider
 * spend of a fallback that never ran is not measured here.
 *
 * This block never becomes a provider_usage_logs row. A fabricated
 * "provider success / 0 credits" usage row would distort provider call count,
 * effectiveness, credit metrics and success rate.
 */
export interface LocalReuseObservabilityV1 {
  gate_applied: boolean;
  gate_skipped_reason: LocalReuseSkipReason | null;
  actionable_reusable_candidate_count: number;
  threshold: number;
  provider_calls: 0;
  outcome: 'fallback_satisfied_by_existing_candidate' | 'fallback_not_satisfied_locally';
  company_scope_kind: CompanyScopeKind;
  lookup_error: string | null;
  source_counts: ReusableSourceCounts;
}

export interface LocalReuseGateResultV1 {
  /** true ⇒ the fallback is already satisfied locally; skip ALL provider work. */
  hit: boolean;
  actionableReusableCandidateCount: number;
  observability: LocalReuseObservabilityV1;
}

export interface EvaluateLocalReuseGateInputV1 {
  requestId: string;
}

export interface EvaluateLocalReuseGateDepsV1 {
  isGateEnabled: () => boolean;
  readRequestCompanyKeys?: RequestCompanyKeysReaderV1;
  readReusableCandidates?: ReusableLocalCandidateReaderV1;
}

function miss(
  reason: LocalReuseSkipReason,
  companyScopeKind: CompanyScopeKind,
  lookupError: string | null,
  actionableCount = 0,
  sourceCounts: ReusableSourceCounts = emptySourceCounts(),
): LocalReuseGateResultV1 {
  return {
    hit: false,
    actionableReusableCandidateCount: actionableCount,
    observability: {
      gate_applied: reason === 'no_actionable_reusable_candidate',
      gate_skipped_reason: reason,
      actionable_reusable_candidate_count: actionableCount,
      threshold: ACTIONABLE_LOCAL_REUSE_THRESHOLD,
      provider_calls: 0,
      outcome: 'fallback_not_satisfied_locally',
      company_scope_kind: companyScopeKind,
      lookup_error: lookupError,
      source_counts: sourceCounts,
    },
  };
}

/**
 * Evaluates local reuse. Returns hit=true ONLY when at least
 * ACTIONABLE_LOCAL_REUSE_THRESHOLD actionable same-company candidates
 * (source 'apollo' or 'lusha') already sit in pending_review. Every uncertain
 * case is a MISS, which means "run the existing provider fallback unchanged".
 *
 * When the gate flag is off this returns immediately: neither reader is
 * called, so no extra query is issued and the router's behaviour is identical
 * to the pre-gate code path.
 */
export async function evaluateLocalReviewableCandidateReuseGate(
  input: EvaluateLocalReuseGateInputV1,
  deps: EvaluateLocalReuseGateDepsV1,
): Promise<LocalReuseGateResultV1> {
  const {
    isGateEnabled,
    readRequestCompanyKeys = readContactEnrichmentRequestCompanyKeys,
    readReusableCandidates = readReusableLocalCandidatesForCompanyScope,
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

  const selection = selectActionableReusableLocalCandidates(requestId, company, rows);

  if (selection.actionableCount < ACTIONABLE_LOCAL_REUSE_THRESHOLD) {
    return miss(
      'no_actionable_reusable_candidate',
      selection.companyScopeKind,
      null,
      selection.actionableCount,
      selection.sourceCounts,
    );
  }

  return {
    hit: true,
    actionableReusableCandidateCount: selection.actionableCount,
    observability: {
      gate_applied: true,
      gate_skipped_reason: null,
      actionable_reusable_candidate_count: selection.actionableCount,
      threshold: ACTIONABLE_LOCAL_REUSE_THRESHOLD,
      provider_calls: 0,
      outcome: 'fallback_satisfied_by_existing_candidate',
      company_scope_kind: selection.companyScopeKind,
      lookup_error: null,
      source_counts: selection.sourceCounts,
    },
  };
}
