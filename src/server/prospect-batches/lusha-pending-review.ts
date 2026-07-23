/**
 * Lusha → pending-review persistence — pure core (Q3F-5BB.4)
 *
 * Turns a Lusha company-prospecting result into a pending-review prospect batch
 * plus candidate rows. This module is PURE + fully dependency-injected: it does
 * NO I/O of its own. Every write flows through the injected `insertBatch` /
 * `insertCandidates` deps, so it is STRUCTURALLY impossible for it to touch
 * accounts, HubSpot, enrichment, `provider_usage_logs` or `agent_runs` — those
 * dependencies simply do not exist here.
 *
 * Authorized scope (Q3F-5BB.4):
 *   - DB writes limited to prospect_batches + prospect_candidates (two deps).
 *   - Never creates accounts/companies; never calls HubSpot / enrichment.
 *   - Lusha runs exactly once via the injected `runSearch`, backed by the same
 *     read-only `executeLushaPreview` core → page 0 / size 10 / ≤1 credit.
 *   - On Lusha failure OR zero usable companies: NO writes at all.
 *   - Dedupe by normalized domain (fallback normalized name) — the preview
 *     already marks in-batch domain duplicates; here we drop them before insert.
 *   - Never persists raw provider payloads or secrets.
 */

import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
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
/** Only an in-batch dedupe was performed (no account-level check). `no_match`
 *  keeps approve-and-convert out of its hard-block set; approval re-derives the
 *  real account/HubSpot dedupe at conversion time. */
export const LUSHA_PENDING_REVIEW_DUPLICATE_STATUS = 'no_match' as const;
/** Discreet provider traceability. */
export const LUSHA_PENDING_REVIEW_PROVIDER = 'lusha' as const;
/** Where the human review happens. */
export const LUSHA_PENDING_REVIEW_URL = PROSPECTOS_TAB_ROUTE;

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
  duplicate_status: typeof LUSHA_PENDING_REVIEW_DUPLICATE_STATUS;
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

export interface PersistLushaPendingReviewDeps {
  runSearch: RunLushaSearch;
  insertBatch: (row: LushaPendingReviewBatchRow) => Promise<{ id: string }>;
  insertCandidates: (
    rows: LushaPendingReviewCandidateRow[],
  ) => Promise<{ insertedCount: number }>;
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

/** Build the batch insert row (deterministic — no clocks, no randomness). */
export function buildLushaPendingReviewBatchRow(
  input: LushaPreviewInput,
  actor: PersistLushaPendingReviewActor,
  search: LushaPreviewResult,
  uniqueCount: number,
): LushaPendingReviewBatchRow {
  const rs = search.requestSummary;
  const sectorLabel = rs.sector ?? input.sectorKey;
  const countryLabel = rs.country ?? input.countryCode;

  return {
    name: `Búsqueda con IA · ${sectorLabel} · ${countryLabel}`,
    country: rs.country ?? null,
    country_code: input.countryCode ?? null,
    industry: rs.sector ?? null,
    target_count: uniqueCount,
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

/** Build candidate insert rows from the deduped companies. */
export function buildLushaPendingReviewCandidateRows(
  batchId: string,
  companies: LushaPreviewCompany[],
): LushaPendingReviewCandidateRow[] {
  return companies.map((company) => ({
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
    duplicate_status: LUSHA_PENDING_REVIEW_DUPLICATE_STATUS,
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
      // Only an in-batch dedupe ran; account-level dedupe happens at approval.
      accountDuplicateCheck: 'not_performed',
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

// ─── Core orchestrator ────────────────────────────────────────────────────────

/**
 * Runs Lusha once and, only on success with usable results, persists a single
 * pending-review batch plus its candidate rows via the injected deps.
 *
 * Write ordering guarantees:
 *   - Lusha failure          → no batch, no candidates.
 *   - Empty / all-duplicates → no batch, no candidates (status 'empty').
 *   - Success                → exactly one batch, then N candidate rows.
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

  const batchRow = buildLushaPendingReviewBatchRow(input, actor, search, unique.length);
  const { id: batchId } = await deps.insertBatch(batchRow);

  const candidateRows = buildLushaPendingReviewCandidateRows(batchId, unique);
  const { insertedCount } = await deps.insertCandidates(candidateRows);

  return {
    ok: true,
    status: 'success',
    batchId,
    createdCandidatesCount: insertedCount,
    skippedCount,
    creditsCharged,
    resultsReturned,
    reviewUrl: LUSHA_PENDING_REVIEW_URL,
    message: `Encontramos ${insertedCount} ${insertedCount === 1 ? 'empresa candidata' : 'empresas candidatas'} para revisar.`,
  };
}
