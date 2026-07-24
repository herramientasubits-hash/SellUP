/**
 * Lusha → pending-review persistence — pure core (Q3F-5BB.4 · duplicate parity Q3F-5BB.7)
 *
 * Turns a Lusha company-prospecting result into a pending-review prospect batch
 * plus candidate rows. This module is PURE + fully dependency-injected: it does
 * NO I/O of its own. Every write flows through the injected `insertBatch` /
 * `insertCandidates` deps, so it is STRUCTURALLY impossible for it to touch
 * accounts, HubSpot, enrichment, `provider_usage_logs` or `agent_runs` — those
 * write dependencies simply do not exist here.
 *
 * Q3F-5BB.7 adds DUPLICATE PARITY with the canonical Tavily/candidate-writer flow
 * BEFORE candidates are persisted, via two READ-ONLY injected deps:
 *   - `checkCompanyDuplicate`  → canonical SellUp + HubSpot duplicate checker.
 *   - `fetchActiveCandidates`  → canonical active-candidate prefetch (read-only).
 * These are strictly read-only: they can only detect duplicates, never create or
 * mutate anything. The active-candidate guard itself is the canonical pure
 * function `checkActiveCandidateDuplicate` (no I/O), imported directly.
 *
 * Authorized scope (Q3F-5BB.4 + Q3F-5BB.7):
 *   - DB writes limited to prospect_batches + prospect_candidates (two deps).
 *   - Never creates accounts/companies; never calls HubSpot WRITE / enrichment.
 *   - Lusha runs exactly once via the injected `runSearch`, backed by the same
 *     read-only `executeLushaPreview` core → page 0 / size 10 / ≤1 credit.
 *   - On Lusha failure OR zero usable companies: NO writes at all.
 *   - Dedupe by normalized domain (fallback normalized name) — the preview
 *     already marks in-batch domain duplicates; here we drop them before insert.
 *   - Duplicate parity: for every deduped company we run the canonical SellUp +
 *     HubSpot duplicate check and the active-candidate guard, then persist the
 *     real `duplicate_status`, `matched_account_id`, `matched_hubspot_company_id`
 *     and a `source_trace` describing what ran. Strong active-candidate matches
 *     (same active domain / same inferred identity) are SKIPPED, exactly like the
 *     canonical writer.
 *   - Never persists raw provider payloads or secrets.
 */

import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
import {
  checkActiveCandidateDuplicate,
  type ActiveCandidateRecord,
  type DuplicateGuardInput,
  type DuplicateGuardMatch,
} from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import {
  normalizeDomain,
  type LushaPreviewCompany,
  type LushaPreviewInput,
  type LushaPreviewResult,
} from './lusha-preview';

// ─── Contract constants (see data-contract in migrations 040/045/093) ─────────

/** Batch provenance. There is no `lusha` batch source enum; this AI-wizard flow
 *  maps to `agent_1`. The provider name lives in metadata + candidate rows. */
export const LUSHA_PENDING_REVIEW_BATCH_SOURCE = 'agent_1' as const;
/** Batch status so its candidates surface in the Prospectos review list. */
export const LUSHA_PENDING_REVIEW_BATCH_STATUS = 'ready_for_review' as const;
/** Candidate source_primary — the enum explicitly allows `lusha`. */
export const LUSHA_PENDING_REVIEW_CANDIDATE_SOURCE = 'lusha' as const;
/** Candidate status required by the Prospectos list + review actions. */
export const LUSHA_PENDING_REVIEW_CANDIDATE_STATUS = 'needs_review' as const;
/** MANDATORY: the review actions reject anything but `production`
 *  (`not_clean_production`). The canonical Agent-1 writer omits this — we do not. */
export const LUSHA_PENDING_REVIEW_RECORD_ORIGIN = 'production' as const;
/** Marks the writer as the classifier for record_origin (migration 093 enum). */
export const LUSHA_PENDING_REVIEW_CLASSIFICATION_SOURCE = 'writer' as const;
/** Default duplicate_status when no duplicate signal was found. */
export const LUSHA_PENDING_REVIEW_DUPLICATE_STATUS = 'no_match' as const;
/** Discreet provider traceability. */
export const LUSHA_PENDING_REVIEW_PROVIDER = 'lusha' as const;
/** Where the human review happens. */
export const LUSHA_PENDING_REVIEW_URL = PROSPECTOS_TAB_ROUTE;
/** source_trace marker so an auditor knows which resolver produced the status. */
export const LUSHA_DUPLICATE_RESOLUTION_VERSION = 'lusha_duplicate_parity_v1' as const;

// ─── Duplicate parity contracts (Q3F-5BB.7) ───────────────────────────────────

/** DB duplicate_status values this writer can persist. Mirrors the canonical
 *  candidate-writer mapping (existing_in_* → exact_duplicate, possible_duplicate
 *  → possible_duplicate, else no_match). Unlike the canonical writer this Lusha
 *  flow NEVER persists a blocking `unchecked`/`insufficient_data` just because the
 *  secondary HubSpot check was unavailable — see `resolveLushaCandidateDuplicateState`. */
export type LushaDbDuplicateStatus = 'no_match' | 'exact_duplicate' | 'possible_duplicate';

export type AccountDuplicateCheckTrace =
  | 'performed_matched'
  | 'performed_possible_duplicate'
  | 'performed_no_match';

export type HubSpotDuplicateCheckTrace =
  | 'performed_matched'
  | 'performed_possible_duplicate'
  | 'performed_no_match'
  | 'skipped_unavailable';

export type ActiveCandidateDuplicateCheckTrace =
  | 'performed_no_match'
  | 'performed_possible_duplicate';

/** Resolved duplicate state for a single Lusha company, ready to persist. */
export interface LushaCandidateDuplicateResolution {
  dbDuplicateStatus: LushaDbDuplicateStatus;
  matchedAccountId: string | null;
  matchedHubspotCompanyId: string | null;
  accountDuplicateCheck: AccountDuplicateCheckTrace;
  hubSpotDuplicateCheck: HubSpotDuplicateCheckTrace;
  activeCandidateDuplicateCheck: ActiveCandidateDuplicateCheckTrace;
  activeGuardReason: DuplicateGuardMatch['reason'];
}

/** Company paired with its resolved duplicate state (post-guard, insert-ready). */
export interface ResolvedLushaCandidate {
  company: LushaPreviewCompany;
  resolution: LushaCandidateDuplicateResolution;
}

// ─── Row shapes handed to the injected insert deps ────────────────────────────

export interface LushaPendingReviewBatchRow {
  name: string;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  target_count: number | null;
  search_depth: 'standard';
  status: typeof LUSHA_PENDING_REVIEW_BATCH_STATUS;
  source: typeof LUSHA_PENDING_REVIEW_BATCH_SOURCE;
  owner_id: string;
  created_by: string;
  metadata: Record<string, unknown>;
}

export interface LushaPendingReviewCandidateRow {
  batch_id: string;
  name: string;
  normalized_name: string | null;
  website: string | null;
  domain: string | null;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  company_size: string | null;
  source_primary: typeof LUSHA_PENDING_REVIEW_CANDIDATE_SOURCE;
  sources_checked: string[];
  duplicate_status: LushaDbDuplicateStatus;
  matched_account_id: string | null;
  matched_hubspot_company_id: string | null;
  confidence_score: number | null;
  fit_score: number | null;
  data_completeness_score: number | null;
  status: typeof LUSHA_PENDING_REVIEW_CANDIDATE_STATUS;
  record_origin: typeof LUSHA_PENDING_REVIEW_RECORD_ORIGIN;
  classification_source: typeof LUSHA_PENDING_REVIEW_CLASSIFICATION_SOURCE;
  source_trace: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// ─── Injected dependencies + result ───────────────────────────────────────────

export interface PersistLushaPendingReviewActor {
  internalUserId: string;
}

/** Runs Lusha once. Backed by the read-only `executeLushaPreview` core so the
 *  page/size/credit guardrails are inherited verbatim. */
export type RunLushaSearch = (input: LushaPreviewInput) => Promise<LushaPreviewResult>;

/** READ-ONLY. Canonical SellUp + HubSpot duplicate checker. Can only detect
 *  duplicates — it never writes. */
export type CheckLushaCompanyDuplicate = (
  input: DuplicateCheckInput,
) => Promise<DuplicateCheckResult>;

/** READ-ONLY. Loads active prospect candidates for the guard. Returns [] when the
 *  prefetch is unavailable (fail-open — the guard degrades gracefully). */
export type FetchActiveCandidatesForLushaGuard = (
  domains: string[],
  countryCode: string | null,
) => Promise<ActiveCandidateRecord[]>;

export interface PersistLushaPendingReviewDeps {
  runSearch: RunLushaSearch;
  // ── Write deps (the ONLY two write surfaces) ──
  insertBatch: (row: LushaPendingReviewBatchRow) => Promise<{ id: string }>;
  insertCandidates: (
    rows: LushaPendingReviewCandidateRow[],
  ) => Promise<{ insertedCount: number }>;
  // ── Read-only duplicate-parity deps (Q3F-5BB.7) — never write ──
  checkCompanyDuplicate: CheckLushaCompanyDuplicate;
  fetchActiveCandidates: FetchActiveCandidatesForLushaGuard;
}

export type PersistLushaPendingReviewStatus = 'success' | 'empty' | 'error';

export interface PersistLushaPendingReviewResult {
  ok: boolean;
  status: PersistLushaPendingReviewStatus;
  batchId: string | null;
  createdCandidatesCount: number;
  skippedCount: number;
  creditsCharged: number | null;
  resultsReturned: number | null;
  reviewUrl: string;
  message: string;
  error?: string;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Normalize a company name for dedupe fallback + normalized_name column. */
export function normalizeLushaCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function employeesLabel(company: LushaPreviewCompany): string | null {
  if (typeof company.employeesExact === 'number') return String(company.employeesExact);
  if (company.employeesMin !== null || company.employeesMax !== null) {
    return `${company.employeesMin ?? '?'}-${company.employeesMax ?? '?'}`;
  }
  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a matched id looks like a real SellUp account UUID. */
export function isValidAccountUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/**
 * Dedupe by normalized domain (fallback normalized name). Companies with neither
 * a domain nor a usable name are unusable (candidate.name is NOT NULL) and are
 * counted as skipped. Mirrors the preview's domain-dedupe intent.
 */
export function dedupeLushaCompanies(
  companies: LushaPreviewCompany[],
): { unique: LushaPreviewCompany[]; skippedCount: number } {
  const seen = new Set<string>();
  const unique: LushaPreviewCompany[] = [];
  let skippedCount = 0;

  for (const company of companies) {
    const nameKey = normalizeLushaCompanyName(company.name);
    // name is required by the schema — no name means the row is unusable.
    if (!nameKey) {
      skippedCount++;
      continue;
    }
    const dedupeKey = normalizeDomain(company.domain) ?? nameKey;
    if (seen.has(dedupeKey)) {
      skippedCount++;
      continue;
    }
    seen.add(dedupeKey);
    unique.push(company);
  }

  return { unique, skippedCount };
}

/** Build the canonical duplicate-check input for a Lusha company. */
export function buildLushaDuplicateCheckInput(
  company: LushaPreviewCompany,
  input: LushaPreviewInput,
): DuplicateCheckInput {
  const domain = normalizeDomain(company.domain);
  return {
    name: company.name ?? '',
    normalizedName: normalizeLushaCompanyName(company.name),
    website: company.domain ? `https://${company.domain}` : null,
    domain,
    country: company.country,
    countryCode: company.countryIso2 ?? input.countryCode ?? null,
    // Lusha company prospecting does not return a fiscal identifier.
    taxIdentifier: null,
  };
}

/** Build the active-candidate guard input for a Lusha company. */
export function buildLushaGuardInput(company: LushaPreviewCompany): DuplicateGuardInput {
  const name = company.name ?? null;
  return {
    name,
    domain: normalizeDomain(company.domain),
    website: company.domain ? `https://${company.domain}` : null,
    // Lusha has no separate inferred/service-title identity — use the raw name.
    inferredCompanyName: name,
    normalizedName: normalizeLushaCompanyName(company.name),
  };
}

/** Strong active matches are SKIPPED before insert (canonical writer behavior). */
export function isStrongActiveGuardMatch(match: DuplicateGuardMatch): boolean {
  return (
    match.matched &&
    (match.reason === 'same_active_domain' || match.reason === 'same_inferred_identity')
  );
}

/**
 * Resolve the persisted duplicate state for a single company from the canonical
 * SellUp+HubSpot check result plus the active-candidate guard match.
 *
 * Mapping (mirrors candidate-writer's `mapDuplicateStatus` semantics):
 *   - any SellUp/HubSpot exact match         → exact_duplicate
 *   - any SellUp/HubSpot possible match, OR
 *     active guard `same_canonical_identity` → possible_duplicate
 *   - otherwise                              → no_match
 *
 * HubSpot leniency (Q3F-5BB.7): when the secondary HubSpot check could not run
 * (not connected / errored) we record `hubSpotDuplicateCheck = skipped_unavailable`
 * and DO NOT let that turn the whole candidate into a blocking status — the
 * primary SellUp accounts check still ran. This is the one deliberate divergence
 * from the canonical consolidator, which conservatively emits `unchecked`.
 */
export function resolveLushaCandidateDuplicateState(
  dupResult: DuplicateCheckResult,
  guardMatch: DuplicateGuardMatch,
): LushaCandidateDuplicateResolution {
  const sellupMatches = dupResult.matches.filter((m) => m.source === 'sellup');
  const hubspotMatches = dupResult.matches.filter((m) => m.source === 'hubspot');

  const sellupExact = sellupMatches.find((m) => m.status === 'existing_in_sellup') ?? null;
  const sellupPossible = sellupMatches.find((m) => m.status === 'possible_duplicate') ?? null;
  const hubspotExact = hubspotMatches.find((m) => m.status === 'existing_in_hubspot') ?? null;
  const hubspotPossible = hubspotMatches.find((m) => m.status === 'possible_duplicate') ?? null;

  const hubspotChecked = dupResult.checkedSources.includes('hubspot');
  const hubspotErrored = (dupResult.errors ?? []).some((e) => /hubspot/i.test(e));
  const hubspotAvailable = hubspotChecked && !hubspotErrored;

  // matched_account_id — only when it is a real SellUp account UUID.
  const sellupMatchId = sellupExact?.matchedId ?? sellupPossible?.matchedId ?? null;
  const matchedAccountId = isValidAccountUuid(sellupMatchId) ? (sellupMatchId as string) : null;

  // matched_hubspot_company_id — any non-empty HubSpot object id string.
  const hubspotMatchId = hubspotExact?.matchedId ?? hubspotPossible?.matchedId ?? null;
  const matchedHubspotCompanyId =
    typeof hubspotMatchId === 'string' && hubspotMatchId.trim().length > 0
      ? hubspotMatchId
      : null;

  const accountDuplicateCheck: AccountDuplicateCheckTrace = sellupExact
    ? 'performed_matched'
    : sellupPossible
      ? 'performed_possible_duplicate'
      : 'performed_no_match';

  const hubSpotDuplicateCheck: HubSpotDuplicateCheckTrace = !hubspotAvailable
    ? 'skipped_unavailable'
    : hubspotExact
      ? 'performed_matched'
      : hubspotPossible
        ? 'performed_possible_duplicate'
        : 'performed_no_match';

  const activeCanonical =
    guardMatch.matched && guardMatch.reason === 'same_canonical_identity';
  const activeCandidateDuplicateCheck: ActiveCandidateDuplicateCheckTrace = activeCanonical
    ? 'performed_possible_duplicate'
    : 'performed_no_match';

  const dbDuplicateStatus: LushaDbDuplicateStatus =
    sellupExact || hubspotExact
      ? 'exact_duplicate'
      : sellupPossible || hubspotPossible || activeCanonical
        ? 'possible_duplicate'
        : 'no_match';

  return {
    dbDuplicateStatus,
    matchedAccountId,
    matchedHubspotCompanyId,
    accountDuplicateCheck,
    hubSpotDuplicateCheck,
    activeCandidateDuplicateCheck,
    activeGuardReason: guardMatch.matched ? guardMatch.reason : null,
  };
}

/** Build the batch insert row (deterministic — no clocks, no randomness). */
export function buildLushaPendingReviewBatchRow(
  input: LushaPreviewInput,
  actor: PersistLushaPendingReviewActor,
  search: LushaPreviewResult,
  persistedCount: number,
): LushaPendingReviewBatchRow {
  const rs = search.requestSummary;
  const sectorLabel = rs.sector ?? input.sectorKey;
  const countryLabel = rs.country ?? input.countryCode;

  return {
    name: `Búsqueda con IA · ${sectorLabel} · ${countryLabel}`,
    country: rs.country ?? null,
    country_code: input.countryCode ?? null,
    industry: rs.sector ?? null,
    target_count: persistedCount,
    search_depth: 'standard',
    status: LUSHA_PENDING_REVIEW_BATCH_STATUS,
    source: LUSHA_PENDING_REVIEW_BATCH_SOURCE,
    owner_id: actor.internalUserId,
    created_by: actor.internalUserId,
    metadata: {
      provider: LUSHA_PENDING_REVIEW_PROVIDER,
      discovery_source: 'generate_with_ia_wizard',
      limited_scope: true,
      do_not_sync_hubspot: true,
      do_not_call_enrichment: true,
      // Duplicate parity ran before persistence (Q3F-5BB.7).
      duplicate_resolution_version: LUSHA_DUPLICATE_RESOLUTION_VERSION,
      request: {
        country_code: input.countryCode,
        sector_key: rs.sectorKey,
        main_industries_ids: rs.mainIndustriesIds,
        sub_industry_id: rs.subIndustryId,
        size_band: rs.sizeBand,
        has_search_text: rs.hasSearchText,
      },
      // Safe billing metadata only — no API key, no headers, no raw payload.
      billing: {
        provider: LUSHA_PENDING_REVIEW_PROVIDER,
        endpoint_category: 'company_prospecting',
        credits_charged: search.billing.creditsCharged,
        results_returned: search.billing.resultsReturned,
        expected_max_credits: search.billing.expectedMaxCredits,
      },
    },
  };
}

/** Build candidate insert rows from resolved companies (post duplicate parity). */
export function buildLushaPendingReviewCandidateRows(
  batchId: string,
  resolved: ResolvedLushaCandidate[],
): LushaPendingReviewCandidateRow[] {
  return resolved.map(({ company, resolution }) => ({
    batch_id: batchId,
    name: company.name as string, // dedupe guarantees a non-empty name
    normalized_name: normalizeLushaCompanyName(company.name),
    website: company.domain ? `https://${company.domain}` : null,
    domain: company.domain,
    country: company.country,
    country_code: company.countryIso2,
    industry: company.industry,
    company_size: employeesLabel(company),
    source_primary: LUSHA_PENDING_REVIEW_CANDIDATE_SOURCE,
    sources_checked: [LUSHA_PENDING_REVIEW_PROVIDER],
    duplicate_status: resolution.dbDuplicateStatus,
    matched_account_id: resolution.matchedAccountId,
    matched_hubspot_company_id: resolution.matchedHubspotCompanyId,
    confidence_score: null,
    fit_score: typeof company.score === 'number' ? company.score : null,
    data_completeness_score: null,
    status: LUSHA_PENDING_REVIEW_CANDIDATE_STATUS,
    record_origin: LUSHA_PENDING_REVIEW_RECORD_ORIGIN,
    classification_source: LUSHA_PENDING_REVIEW_CLASSIFICATION_SOURCE,
    source_trace: {
      sourceProvider: LUSHA_PENDING_REVIEW_PROVIDER,
      sourceKey: company.domain ?? company.providerCompanyId ?? null,
      providerCompanyId: company.providerCompanyId ?? null,
      discovery: 'generate_with_ia_wizard',
      duplicateResolutionVersion: LUSHA_DUPLICATE_RESOLUTION_VERSION,
      // What actually ran before persistence (Q3F-5BB.7 — no longer 'not_performed').
      accountDuplicateCheck: resolution.accountDuplicateCheck,
      hubSpotDuplicateCheck: resolution.hubSpotDuplicateCheck,
      activeCandidateDuplicateCheck: resolution.activeCandidateDuplicateCheck,
      ...(resolution.activeGuardReason
        ? { activeCandidateGuardReason: resolution.activeGuardReason }
        : {}),
    },
    metadata: {
      provider: LUSHA_PENDING_REVIEW_PROVIDER,
      score: company.score,
      passes_gate: company.passesGate,
      issues: company.issues,
      linkedin_url: company.linkedinUrl,
      employees: {
        exact: company.employeesExact,
        min: company.employeesMin,
        max: company.employeesMax,
      },
    },
  }));
}

function sanitizeError(message: string | undefined): string {
  if (!message) return 'Error desconocido al consultar el proveedor.';
  return message.slice(0, 200);
}

/**
 * Run duplicate parity for every deduped company. Fetches active candidates once,
 * then per company runs the canonical duplicate check + active-candidate guard.
 * Strong active matches are skipped (returned via `guardSkippedCount`), matching
 * the canonical writer. Purely orchestrates injected read-only deps.
 */
export async function resolveLushaCandidatesDuplicateState(
  deps: Pick<PersistLushaPendingReviewDeps, 'checkCompanyDuplicate' | 'fetchActiveCandidates'>,
  input: LushaPreviewInput,
  companies: LushaPreviewCompany[],
): Promise<{ resolved: ResolvedLushaCandidate[]; guardSkippedCount: number }> {
  const guardDomains = Array.from(
    new Set(
      companies
        .map((c) => normalizeDomain(c.domain))
        .filter((d): d is string => d !== null),
    ),
  );

  const activeCandidates = await deps.fetchActiveCandidates(
    guardDomains,
    input.countryCode ?? null,
  );

  const resolved: ResolvedLushaCandidate[] = [];
  let guardSkippedCount = 0;

  for (const company of companies) {
    const guardMatch = checkActiveCandidateDuplicate(
      buildLushaGuardInput(company),
      activeCandidates,
    );

    // Strong active match → skip, exactly like the canonical writer.
    if (isStrongActiveGuardMatch(guardMatch)) {
      guardSkippedCount++;
      continue;
    }

    const dupResult = await deps.checkCompanyDuplicate(
      buildLushaDuplicateCheckInput(company, input),
    );
    const resolution = resolveLushaCandidateDuplicateState(dupResult, guardMatch);
    resolved.push({ company, resolution });
  }

  return { resolved, guardSkippedCount };
}

// ─── Core orchestrator ────────────────────────────────────────────────────────

/**
 * Runs Lusha once and, only on success with usable results, runs duplicate parity
 * and persists a single pending-review batch plus its candidate rows via the
 * injected deps.
 *
 * Write ordering guarantees:
 *   - Lusha failure                    → no batch, no candidates.
 *   - Empty / all-duplicates / all
 *     skipped by active guard          → no batch, no candidates (status 'empty').
 *   - Success                          → exactly one batch, then N candidate rows.
 */
export async function persistLushaPendingReviewBatch(
  deps: PersistLushaPendingReviewDeps,
  input: LushaPreviewInput,
  actor: PersistLushaPendingReviewActor,
): Promise<PersistLushaPendingReviewResult> {
  const search = await deps.runSearch(input);
  const creditsCharged = search.billing?.creditsCharged ?? null;
  const resultsReturned = search.billing?.resultsReturned ?? null;

  if (!search.ok) {
    return {
      ok: false,
      status: 'error',
      batchId: null,
      createdCandidatesCount: 0,
      skippedCount: 0,
      creditsCharged,
      resultsReturned,
      reviewUrl: LUSHA_PENDING_REVIEW_URL,
      message: 'No fue posible completar la búsqueda con el proveedor.',
      error: sanitizeError(search.error),
    };
  }

  const { unique, skippedCount } = dedupeLushaCompanies(search.results ?? []);

  if (unique.length === 0) {
    return {
      ok: true,
      status: 'empty',
      batchId: null,
      createdCandidatesCount: 0,
      skippedCount,
      creditsCharged,
      resultsReturned,
      reviewUrl: LUSHA_PENDING_REVIEW_URL,
      message: 'La búsqueda no devolvió empresas nuevas para revisar.',
    };
  }

  // Duplicate parity BEFORE persistence (Q3F-5BB.7).
  const { resolved, guardSkippedCount } = await resolveLushaCandidatesDuplicateState(
    deps,
    input,
    unique,
  );
  const totalSkipped = skippedCount + guardSkippedCount;

  if (resolved.length === 0) {
    // Every usable company duplicated an active candidate → nothing new to review.
    return {
      ok: true,
      status: 'empty',
      batchId: null,
      createdCandidatesCount: 0,
      skippedCount: totalSkipped,
      creditsCharged,
      resultsReturned,
      reviewUrl: LUSHA_PENDING_REVIEW_URL,
      message: 'La búsqueda no devolvió empresas nuevas para revisar.',
    };
  }

  const batchRow = buildLushaPendingReviewBatchRow(input, actor, search, resolved.length);
  const { id: batchId } = await deps.insertBatch(batchRow);

  const candidateRows = buildLushaPendingReviewCandidateRows(batchId, resolved);
  const { insertedCount } = await deps.insertCandidates(candidateRows);

  return {
    ok: true,
    status: 'success',
    batchId,
    createdCandidatesCount: insertedCount,
    skippedCount: totalSkipped,
    creditsCharged,
    resultsReturned,
    reviewUrl: LUSHA_PENDING_REVIEW_URL,
    message: `Encontramos ${insertedCount} ${insertedCount === 1 ? 'empresa candidata' : 'empresas candidatas'} para revisar.`,
  };
}
