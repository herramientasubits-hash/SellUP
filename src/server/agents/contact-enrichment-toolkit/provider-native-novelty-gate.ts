// Agente 2A — Pre-Paid Provider-Native Novelty Gate
// AGENT2A-PROVIDER-NOVELTY-AND-REUSE-GATE-1
//
// Purpose (cost avoidance, nothing else): stop an AUTOMATIC contact-discovery
// rerun from paying AGAIN to enrich a provider-native person that SellUp has
// already seen for the SAME COMPANY through the SAME PROVIDER.
//
//   Apollo — People Search is free and has no provider-side "exclude these
//            people" parameter, so the search still runs; the gate removes
//            already-known Apollo person_ids BEFORE the paid /people/match.
//   Lusha  — Prospecting/Search has no provider-side exclusion parameter
//            either. Its cost is NOT solved by this module: by the time this
//            gate can act, the Prospecting/Search call has already happened
//            and may already have been charged. What this gate avoids is the
//            automatic /v3/contacts/enrich on identities already known for
//            the same company.
//
// HARD IDENTITY RULE — provider-native identity only, never inferred across
// providers. Apollo identity = Apollo person_id. Lusha identity = Lusha
// contactId. There is no email / LinkedIn / name / fuzzy / company+name
// aliasing here, and a Lusha identity can never suppress an Apollo
// enrichment (nor the reverse): every lookup is filtered by `source`.
//
// COMPANY-SCOPED, never global: a person may legitimately change employers,
// so a provider identity known at company A must stay eligible at company B.
// Scope is established with the strongest DETERMINISTIC key both sides have
// (account_id > HubSpot company id > normalized company domain). Company NAME
// is never used, and there is no fuzzy company matching.
//
// FAIL OPEN — for novelty ONLY. No deterministic company key, no provider
// identity, or a failed lookup all mean "do not suppress". Existing
// privacy/suppression fail-closed rules are untouched by this module.
//
// This module does NOT reuse data: it never copies, refreshes, revives or
// approves an old candidate, never creates an official contact, never calls a
// provider, never reveals a phone and never writes anything. A skipped
// identity is a COST AVOIDANCE decision, not a new candidate.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeDomain } from './company-consistency-checker';

/** Providers that participate in Agent 2A automatic contact discovery. */
export type ContactDiscoveryProviderKey = 'apollo' | 'lusha';

/**
 * Candidate lifecycle statuses that ALL count as "already seen". The gate
 * deliberately applies NO status filter to the lookup — a rejected/discarded,
 * approved or duplicate candidate still proves a real prior provider identity,
 * so it must not become payable again. Exported so the test suite can assert
 * the full set is covered and that no status silently re-opens paid discovery.
 */
export const KNOWN_PROVIDER_IDENTITY_CANDIDATE_STATUSES = [
  'pending_review',
  'approved',
  'discarded',
  'duplicate',
] as const;

// ── Company scope (deterministic keys only) ─────────────────────

export interface CompanyIdentityKeysV1 {
  accountId: string | null;
  hubspotCompanyId: string | null;
  companyDomain: string | null;
}

export type CompanyScopeKind =
  | 'account_id'
  | 'hubspot_company_id'
  | 'company_domain'
  | 'none';

function idKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function domainKey(value: string | null | undefined): string | null {
  return normalizeDomain(value ?? null);
}

/** Strongest deterministic key present on ONE side. 'none' → gate must not suppress. */
export function resolveStrongestCompanyScopeKind(keys: CompanyIdentityKeysV1): CompanyScopeKind {
  if (idKey(keys.accountId)) return 'account_id';
  if (idKey(keys.hubspotCompanyId)) return 'hubspot_company_id';
  if (domainKey(keys.companyDomain)) return 'company_domain';
  return 'none';
}

export function hasDeterministicCompanyKey(keys: CompanyIdentityKeysV1): boolean {
  return resolveStrongestCompanyScopeKind(keys) !== 'none';
}

export interface CompanyScopeMatchV1 {
  matched: boolean;
  matchedBy: CompanyScopeKind;
}

/**
 * Same-company decision between the CURRENT run and a HISTORIC candidate's
 * run, using the strongest key BOTH sides actually have:
 *
 *   1. same account_id            (both sides have one)
 *   2. same HubSpot company id    (both sides have one)
 *   3. same normalized domain     (both sides have one)
 *
 * When the strongest shared key disagrees, the answer is "not the same
 * company" — it never falls through to a weaker key, otherwise two different
 * accounts sharing a domain (or a renamed company) could suppress a
 * legitimate enrichment. When no key is shared at all, the answer is false:
 * no deterministic scope, no novelty skip. Company name is never consulted.
 */
export function matchesDeterministicCompanyScope(
  current: CompanyIdentityKeysV1,
  historic: CompanyIdentityKeysV1,
): CompanyScopeMatchV1 {
  const currentAccount = idKey(current.accountId);
  const historicAccount = idKey(historic.accountId);
  if (currentAccount && historicAccount) {
    return { matched: currentAccount === historicAccount, matchedBy: 'account_id' };
  }

  const currentHubspot = idKey(current.hubspotCompanyId);
  const historicHubspot = idKey(historic.hubspotCompanyId);
  if (currentHubspot && historicHubspot) {
    return { matched: currentHubspot === historicHubspot, matchedBy: 'hubspot_company_id' };
  }

  const currentDomain = domainKey(current.companyDomain);
  const historicDomain = domainKey(historic.companyDomain);
  if (currentDomain && historicDomain) {
    return { matched: currentDomain === historicDomain, matchedBy: 'company_domain' };
  }

  return { matched: false, matchedBy: 'none' };
}

// ── Known-identity selection (pure) ─────────────────────────────

export interface ProviderIdentityCandidateRowV1 {
  /** Provider-native identity as persisted in contact_enrichment_candidates.source_contact_id. */
  nativeId: string;
  /** contact_enrichment_candidates.source — already filtered by the reader, kept for auditability. */
  provider: string;
  /** Company identity of the run that produced the candidate. */
  company: CompanyIdentityKeysV1;
}

/**
 * Reduces historic candidate rows to the set of provider-native ids that are
 * already known FOR THIS COMPANY. Pure: no I/O, no clock, no randomness.
 */
export function selectKnownNativeIdsForCompanyScope(
  provider: ContactDiscoveryProviderKey,
  current: CompanyIdentityKeysV1,
  rows: readonly ProviderIdentityCandidateRowV1[],
): { knownNativeIds: Set<string>; matchedByCounts: Record<CompanyScopeKind, number> } {
  const knownNativeIds = new Set<string>();
  const matchedByCounts: Record<CompanyScopeKind, number> = {
    account_id: 0,
    hubspot_company_id: 0,
    company_domain: 0,
    none: 0,
  };

  if (!hasDeterministicCompanyKey(current)) {
    return { knownNativeIds, matchedByCounts };
  }

  for (const row of rows) {
    // Cross-provider identity is forbidden: an id only counts for its own provider.
    if (row.provider !== provider) continue;
    if (!row.nativeId) continue;
    const scope = matchesDeterministicCompanyScope(current, row.company);
    if (!scope.matched) continue;
    knownNativeIds.add(row.nativeId);
    matchedByCounts[scope.matchedBy] += 1;
  }

  return { knownNativeIds, matchedByCounts };
}

// ── Partition (pure) ────────────────────────────────────────────

export interface SkippedKnownIdentityV1<T> {
  item: T;
  nativeId: string;
}

export interface ProviderNoveltyPartitionV1<T> {
  novel: T[];
  skippedKnown: Array<SkippedKnownIdentityV1<T>>;
  /** Items the provider returned without a usable native id — kept as novel (fail open). */
  withoutNativeIdCount: number;
}

/**
 * Splits provider results into novel vs already-known by provider-native id.
 * Items without a native id stay in `novel`: an absent identity cannot PROVE
 * the person is already known, and novelty must fail open.
 */
export function partitionByProviderNativeNovelty<T>(
  items: readonly T[],
  getNativeId: (item: T) => string | null | undefined,
  knownNativeIds: ReadonlySet<string>,
): ProviderNoveltyPartitionV1<T> {
  const novel: T[] = [];
  const skippedKnown: Array<SkippedKnownIdentityV1<T>> = [];
  let withoutNativeIdCount = 0;

  for (const item of items) {
    const raw = getNativeId(item);
    const nativeId = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
    if (!nativeId) {
      withoutNativeIdCount += 1;
      novel.push(item);
      continue;
    }
    if (knownNativeIds.has(nativeId)) {
      skippedKnown.push({ item, nativeId });
      continue;
    }
    novel.push(item);
  }

  return { novel, skippedKnown, withoutNativeIdCount };
}

// ── Batch lookup (one bounded query, never N+1) ─────────────────

export interface KnownProviderIdentityLookupInputV1 {
  provider: ContactDiscoveryProviderKey;
  /** Provider-native ids returned by THIS run's search — bounds the query. */
  nativeIds: readonly string[];
  /** Current attempt/run id, excluded so a run never suppresses itself. */
  excludeRunId: string;
}

export interface KnownProviderIdentityLookupResultV1 {
  rows: ProviderIdentityCandidateRowV1[];
  lookupError: string | null;
}

export type KnownProviderIdentityLoaderV1 = (
  input: KnownProviderIdentityLookupInputV1,
) => Promise<KnownProviderIdentityLookupResultV1>;

function getAdminClientOrNull(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // No hardcoded project fallback, and no throw: missing config means the
  // gate cannot prove anything and must fail open instead of crashing a run.
  if (!url || !key) return null;
  return createAdminClient(url, key);
}

interface RawKnownIdentityRow {
  source_contact_id: string | null;
  source: string;
  contact_enrichment_runs: {
    account_id: string | null;
    hubspot_company_id: string | null;
    company_domain: string | null;
  } | null;
}

/**
 * ONE bounded read for every provider identity of the current run — never one
 * query per result. Selectivity comes from `source_contact_id IN (...)`, whose
 * size is capped by the provider's own per-run result limit, so the company
 * scope can be evaluated in application code against the joined run row
 * (domain normalization has no SQL equivalent here).
 *
 * NO status filter on purpose: every candidate lifecycle status counts as
 * already seen (see KNOWN_PROVIDER_IDENTITY_CANDIDATE_STATUSES).
 */
export const readKnownProviderNativeIdentities: KnownProviderIdentityLoaderV1 = async ({
  provider,
  nativeIds,
  excludeRunId,
}) => {
  const ids = [...new Set(nativeIds.map((id) => id?.trim()).filter((id): id is string => !!id))];
  if (ids.length === 0) return { rows: [], lookupError: null };

  const admin = getAdminClientOrNull();
  if (!admin) return { rows: [], lookupError: 'supabase_service_credentials_not_configured' };

  try {
    const { data, error } = await admin
      .from('contact_enrichment_candidates')
      .select(
        'source_contact_id, source, contact_enrichment_runs!inner(account_id, hubspot_company_id, company_domain)',
      )
      .eq('source', provider)
      .in('source_contact_id', ids)
      .neq('enrichment_run_id', excludeRunId);

    if (error) return { rows: [], lookupError: error.message };

    const rows = ((data ?? []) as unknown as RawKnownIdentityRow[])
      .filter((row) => typeof row.source_contact_id === 'string' && row.source_contact_id.length > 0)
      .map((row) => ({
        nativeId: (row.source_contact_id as string).trim(),
        provider: row.source,
        company: {
          accountId: row.contact_enrichment_runs?.account_id ?? null,
          hubspotCompanyId: row.contact_enrichment_runs?.hubspot_company_id ?? null,
          companyDomain: row.contact_enrichment_runs?.company_domain ?? null,
        },
      }));

    return { rows, lookupError: null };
  } catch (err) {
    return { rows: [], lookupError: err instanceof Error ? err.message : 'unknown_lookup_error' };
  }
};

// ── Gate (observability + orchestration) ────────────────────────

export type ProviderNoveltyGateSkipReason =
  | 'no_deterministic_company_key'
  | 'no_provider_identities'
  | 'lookup_error';

/**
 * Run/step-level observability for the gate. Deliberately counters only — no
 * raw provider ids are exposed here, and this block never becomes a
 * provider_usage_logs row: no provider network call happened, so writing a
 * "success" usage row would fabricate a call and distort call counts, credits,
 * cost and effectiveness metrics.
 */
export interface ProviderNoveltyGateObservabilityV1 {
  provider: ContactDiscoveryProviderKey;
  gate_applied: boolean;
  gate_skipped_reason: ProviderNoveltyGateSkipReason | null;
  company_scope_kind: CompanyScopeKind;
  evaluated_provider_identity_count: number;
  provider_identities_without_native_id_count: number;
  known_provider_identity_ids_count: number;
  novel_provider_identity_count: number;
  skipped_known_provider_identity_count: number;
  /** Provider calls this gate avoided outright — always equals the skip count. */
  avoided_paid_provider_calls_count: number;
  lookup_error: string | null;
}

export interface ProviderNoveltyGateResultV1<T> {
  novel: T[];
  skippedKnown: Array<SkippedKnownIdentityV1<T>>;
  observability: ProviderNoveltyGateObservabilityV1;
}

export interface ApplyProviderNoveltyGateInputV1<T> {
  provider: ContactDiscoveryProviderKey;
  items: readonly T[];
  getNativeId: (item: T) => string | null | undefined;
  company: CompanyIdentityKeysV1;
  excludeRunId: string;
  loadKnownIdentities?: KnownProviderIdentityLoaderV1;
}

function emptyObservability(
  provider: ContactDiscoveryProviderKey,
  companyScopeKind: CompanyScopeKind,
  evaluated: number,
  reason: ProviderNoveltyGateSkipReason | null,
  lookupError: string | null,
): ProviderNoveltyGateObservabilityV1 {
  return {
    provider,
    gate_applied: reason === null,
    gate_skipped_reason: reason,
    company_scope_kind: companyScopeKind,
    evaluated_provider_identity_count: evaluated,
    provider_identities_without_native_id_count: 0,
    known_provider_identity_ids_count: 0,
    novel_provider_identity_count: evaluated,
    skipped_known_provider_identity_count: 0,
    avoided_paid_provider_calls_count: 0,
    lookup_error: lookupError,
  };
}

/**
 * Applies the novelty gate to one provider's discovery results BEFORE the paid
 * leg (/people/match for Apollo, /v3/contacts/enrich for Lusha). Returns the
 * novel subset to keep processing plus the skipped known identities. Fails
 * open in every uncertain case — it can only ever REMOVE work, never add it.
 */
export async function applyProviderNativeNoveltyGate<T>(
  input: ApplyProviderNoveltyGateInputV1<T>,
): Promise<ProviderNoveltyGateResultV1<T>> {
  const {
    provider,
    items,
    getNativeId,
    company,
    excludeRunId,
    loadKnownIdentities = readKnownProviderNativeIdentities,
  } = input;

  const companyScopeKind = resolveStrongestCompanyScopeKind(company);
  const evaluated = items.length;

  if (companyScopeKind === 'none') {
    return {
      novel: [...items],
      skippedKnown: [],
      observability: emptyObservability(
        provider,
        companyScopeKind,
        evaluated,
        'no_deterministic_company_key',
        null,
      ),
    };
  }

  const nativeIds = items
    .map((item) => getNativeId(item))
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim());

  if (nativeIds.length === 0) {
    return {
      novel: [...items],
      skippedKnown: [],
      observability: emptyObservability(
        provider,
        companyScopeKind,
        evaluated,
        'no_provider_identities',
        null,
      ),
    };
  }

  const { rows, lookupError } = await loadKnownIdentities({
    provider,
    nativeIds,
    excludeRunId,
  });

  if (lookupError) {
    return {
      novel: [...items],
      skippedKnown: [],
      observability: emptyObservability(
        provider,
        companyScopeKind,
        evaluated,
        'lookup_error',
        lookupError,
      ),
    };
  }

  const { knownNativeIds } = selectKnownNativeIdsForCompanyScope(provider, company, rows);
  const partition = partitionByProviderNativeNovelty(items, getNativeId, knownNativeIds);

  return {
    novel: partition.novel,
    skippedKnown: partition.skippedKnown,
    observability: {
      provider,
      gate_applied: true,
      gate_skipped_reason: null,
      company_scope_kind: companyScopeKind,
      evaluated_provider_identity_count: evaluated,
      provider_identities_without_native_id_count: partition.withoutNativeIdCount,
      known_provider_identity_ids_count: knownNativeIds.size,
      novel_provider_identity_count: partition.novel.length,
      skipped_known_provider_identity_count: partition.skippedKnown.length,
      avoided_paid_provider_calls_count: partition.skippedKnown.length,
      lookup_error: null,
    },
  };
}
