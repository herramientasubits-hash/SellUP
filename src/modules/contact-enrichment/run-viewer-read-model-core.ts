// Agente 2A — Read-only Contact Enrichment Run Viewer (Hito 17B.4X.7C.3E.2)
//
// Pure loaders for viewing a single historical run. No Supabase, no
// network — persistence is injected so this stays testable without a
// database (mirrors candidate-review-core.ts's DI shape). This core MUST
// NOT call Apollo/Lusha, MUST NOT filter candidates to pending_review only,
// and MUST NOT mutate anything — every function here is a read.

import type {
  ContactEnrichmentRunCandidate,
  ContactEnrichmentRunDetail,
  ContactEnrichmentRunProviderUsage,
} from './run-viewer-types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidContactEnrichmentRunId(value: string): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

// ── Row mappers (defensive against unknown/partial shapes) ──────────────

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
}

export function mapRunDetailRow(row: unknown): ContactEnrichmentRunDetail {
  const r = asRecord(row);
  const summary = r.summary && typeof r.summary === 'object' ? (r.summary as Record<string, unknown>) : {};
  const summaryError = typeof summary.error === 'string' ? summary.error : null;

  return {
    id: r.id as string,
    status: r.status as ContactEnrichmentRunDetail['status'],
    companyName: (r.company_name as string | null) ?? '',
    companyDomain: (r.company_domain as string | null) ?? null,
    companyCountryCode: (r.company_country_code as string | null) ?? null,
    hubspotCompanyId: (r.hubspot_company_id as string | null) ?? null,
    accountId: (r.account_id as string | null) ?? null,
    agentRunId: (r.agent_run_id as string | null) ?? null,
    requestId: (r.request_id as string | null) ?? null,
    attemptOrder: (r.attempt_order as number | null) ?? null,
    intendedProvider: (r.intended_provider as ContactEnrichmentRunDetail['intendedProvider']) ?? null,
    providersUsed: Array.isArray(r.providers_used) ? (r.providers_used as string[]) : [],
    estimatedCostUsd: Number(r.estimated_cost_usd ?? 0),
    realCostUsd: r.real_cost_usd != null ? Number(r.real_cost_usd) : null,
    summaryError,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function mapRunCandidateRow(row: unknown): ContactEnrichmentRunCandidate {
  const r = asRecord(row);
  return {
    id: r.id as string,
    full_name: (r.full_name as string | null) ?? '',
    title: (r.title as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    linkedin_url: (r.linkedin_url as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    source: (r.source as ContactEnrichmentRunCandidate['source']) ?? 'apollo',
    status: (r.status as ContactEnrichmentRunCandidate['status']) ?? 'pending_review',
    duplicate_status: (r.duplicate_status as ContactEnrichmentRunCandidate['duplicate_status']) ?? 'unchecked',
    confidence: Number(r.confidence ?? 0),
    enrichment_metadata: (r.enrichment_metadata as ContactEnrichmentRunCandidate['enrichment_metadata']) ?? {},
    created_at: r.created_at as string,
  };
}

export function mapProviderUsageRow(row: unknown): ContactEnrichmentRunProviderUsage {
  const r = asRecord(row);
  const metadata = r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {};
  const rawResults = metadata.raw_results;
  const phoneReveal = metadata.phone_reveal_enabled;

  return {
    providerKey: (r.provider_key as string) ?? '',
    operationKey: (r.operation_key as string) ?? '',
    status: (r.status as ContactEnrichmentRunProviderUsage['status']) ?? 'error',
    creditsUsed: r.credits_used != null ? Number(r.credits_used) : null,
    resultsReturned: Number(r.results_returned ?? 0),
    rawResultsCount: typeof rawResults === 'number' ? rawResults : null,
    phoneRevealEnabled: typeof phoneReveal === 'boolean' ? phoneReveal : null,
    errorMessage: (r.error_message as string | null) ?? null,
    createdAt: (r.created_at as string) ?? '',
  };
}

// ── DI loaders ────────────────────────────────────────────────────────────

export interface LoadContactEnrichmentRunByIdDeps {
  fetchRunRow: (runId: string) => Promise<unknown | null>;
}

/** Returns null for an invalid UUID or a run that does not exist — never throws
 *  on a missing run, so the caller can render a controlled not-found state. */
export async function loadContactEnrichmentRunById(
  runId: string,
  deps: LoadContactEnrichmentRunByIdDeps,
): Promise<ContactEnrichmentRunDetail | null> {
  if (!isValidContactEnrichmentRunId(runId)) return null;

  const row = await deps.fetchRunRow(runId.trim());
  if (!row) return null;

  return mapRunDetailRow(row);
}

export interface LoadContactCandidatesByRunIdDeps {
  fetchCandidateRows: (runId: string) => Promise<unknown[]>;
}

/** Candidates scoped to `enrichment_run_id = runId`, any status — never
 *  hard-filters to pending_review (that is a different, global read model:
 *  getPendingContactCandidates in actions.ts). Returns [] for an invalid
 *  UUID or a run with zero candidates — both are valid, non-error states. */
export async function loadContactCandidatesByRunId(
  runId: string,
  deps: LoadContactCandidatesByRunIdDeps,
): Promise<ContactEnrichmentRunCandidate[]> {
  if (!isValidContactEnrichmentRunId(runId)) return [];

  const rows = await deps.fetchCandidateRows(runId.trim());
  return rows.map(mapRunCandidateRow);
}

export interface LoadProviderUsageByAgentRunIdDeps {
  fetchUsageRows: (agentRunId: string) => Promise<unknown[]>;
}

/** Usage rows scoped to `agent_run_id`, ordered oldest-first by the caller's
 *  query — lets the viewer distinguish a provider success with 0 candidates
 *  from a real unavailable/error outcome. Returns [] when there is no
 *  agent_run_id (legacy/bulk rows) or it is not a well-formed UUID. */
export async function loadProviderUsageByAgentRunId(
  agentRunId: string | null,
  deps: LoadProviderUsageByAgentRunIdDeps,
): Promise<ContactEnrichmentRunProviderUsage[]> {
  if (!agentRunId || !isValidContactEnrichmentRunId(agentRunId)) return [];

  const rows = await deps.fetchUsageRows(agentRunId.trim());
  return rows.map(mapProviderUsageRow);
}
