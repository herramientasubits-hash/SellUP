// Agente 2A — Conversational wizard contracts (Hito 17A.2B)
// Pure types + actions for the contact-enrichment chat state machine.
// No React, no network — safe to import from unit tests.

import type { AgentChatMessage } from '@/components/agent-chat';
import type { CompanyCandidate, ContactEnrichmentRunResult } from '@/modules/contact-enrichment/types';

// ── Provider selection (17B.4K) ───────────────────────────────────────────────
//
// Retained as an internal enum only. Since AGENT2-ROUTING-WIRE-1 the user never
// picks a provider: Apollo runs as primary and Lusha as fallback automatically
// via runAutomaticContactEnrichmentForRequestAction. `selectedProvider` stays in
// state (defaulting to 'apollo') purely so the result-snapshot copy can special-
// case a Lusha attempt; it is no longer a user-facing decision.

export type ContactEnrichmentProvider = 'apollo' | 'lusha';

// ── Conversational steps ──────────────────────────────────────────────────────

export type ContactEnrichmentChatStep =
  | 'await_company' // waiting for the user to type a company (composer open)
  | 'resolving' // searching SellUp + HubSpot
  | 'selecting_company' // multiple matches — user picks one
  | 'needs_extra_data' // 0 matches with only a name — asks for domain / país
  | 'confirming' // a candidate is ready — user confirms
  | 'creating_run' // creating the run + reading existing contacts
  | 'done' // run created — snapshot shown
  | 'searching_contacts' // automatic Apollo→Lusha routing in flight (ROUTING-WIRE-1)
  | 'searching_apollo' // querying Apollo for real candidates (Hito 17A.3A) — legacy manual path, no longer wired to the wizard CTA
  | 'searching_lusha' // querying Lusha for contacts (17B.4K) — legacy manual path, no longer wired to the wizard CTA
  | 'error'; // controlled error

// ── Automatic routing result (AGENT2-ROUTING-WIRE-1) ──────────────────────────
//
// Structural mirror of RunAutomaticContactEnrichmentForRequestResult
// (modules/contact-enrichment/automatic-routing-action-core.ts). Kept as a
// local, server-free shape so this pure types file stays importable from unit
// tests. `status` is widened to string on purpose — the wizard forwards the
// server result verbatim and never re-narrows it.

export interface AutomaticRoutingUiResult {
  success: boolean;
  status: string;
  automaticRoutingEnabled: boolean;
  fallbackExecuted: boolean;
  attempt1AttemptId: string | null;
  attempt2AttemptId: string | null;
  blockedReason: string | null;
}

// ── Lusha enrichment result (17B.4K) ─────────────────────────────────────────

export interface LushaEnrichmentUiResult {
  status: 'ready_for_review' | 'completed' | 'no_reviewable_candidate' | 'disabled' | 'missing_api_key' | 'not_found' | 'invalid_account' | 'invalid_run_status' | 'provider_error' | 'error';
  candidatesCreated: number;
  duplicatesSkipped: number;
  rawResultsCount: number;
  creditsUsed: number | null;
  providerStatus: 'success' | 'skipped' | 'error';
  noReviewableContactsFound: boolean;
  error?: string;
}

// ── Apollo enrichment result (Hito 17A.3A) ─────────────────────────────────────

export interface ApolloEnrichmentUiCostGuardrail {
  phone_completion_enabled: boolean;
  estimated_credits_before_completion: number;
  max_credits_per_run: number;
  guardrail_blocked: boolean;
  blocked_reason?: string;
  actual_credits_email: number;
  actual_credits_phone: number;
  actual_credits_total: number;
  blocked_profiles_count: number;
}

export interface ApolloEnrichmentUiResult {
  status: 'ready_for_review' | 'completed' | 'skipped' | 'error';
  candidatesCreated: number;
  duplicatesSkipped: number;
  possibleDuplicates: number;
  totalCandidates: number;
  /** Perfiles crudos encontrados en Apollo. */
  rawResultsCount: number;
  /** Perfiles descartados por baja relevancia o datos insuficientes. */
  rejectedByRelevance: number;
  /** Apollo encontró perfiles pero ninguno pasó el filtro de revisión. */
  noReviewableContactsFound: boolean;
  /** Candidatos a los que se intentó completar datos vía people/match. */
  completionAttempted: number;
  /** Candidatos relevantes que quedaron con datos accionables. */
  actionableContactsCount: number;
  /** Apollo trajo perfiles relevantes pero ninguno quedó accionable. */
  noActionableContactsFound: boolean;
  providerStatus: 'success' | 'skipped' | 'error';
  estimatedCostUsd: number;
  /** Guardrail de costo y completion (Hito 17A.6B). */
  costGuardrail?: ApolloEnrichmentUiCostGuardrail;
  /** Guardrail de presupuesto de búsqueda (Hito 17A.6D). */
  searchGuardrail?: {
    max_search_attempts: number;
    max_results_per_attempt: number;
    max_results_per_run: number;
    estimated_search_credits: number;
    blocked_by_search_budget: boolean;
    stopped_early_reason: string | null;
  };
  error?: string;
}

// ── State ─────────────────────────────────────────────────────────────────────

export interface ContactEnrichmentChatState {
  step: ContactEnrichmentChatStep;
  /** Monotonic counter used to mint deterministic message ids. */
  seq: number;
  messages: AgentChatMessage[];
  /** Last company query the user typed (name / domain / HubSpot id). */
  query: string;
  candidates: CompanyCandidate[];
  selectedCandidate: CompanyCandidate | null;
  skippedHubSpot: boolean;
  runResult: ContactEnrichmentRunResult | null;
  /** contact_enrichment_requests id (Hito 17B.4X.7C.2). Created before any
   *  provider attempt exists; the attempt itself is created lazily when the
   *  user picks a provider and searches. */
  requestId: string | null;
  /** Selected provider for enrichment. Apollo is default. (17B.4K) */
  selectedProvider: ContactEnrichmentProvider;
  /** Apollo candidate-sourcing result (Hito 17A.3A). Null until Apollo runs. */
  apolloResult: ApolloEnrichmentUiResult | null;
  /** Lusha candidate-sourcing result (17B.4K). Null until Lusha runs. */
  lushaResult: LushaEnrichmentUiResult | null;
  /** Automatic Apollo→Lusha routing result (ROUTING-WIRE-1). Null until the
   *  automatic search runs; set once it settles so the CTA is not shown again. */
  automaticResult: AutomaticRoutingUiResult | null;
  errorMessage: string | null;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export type ContactEnrichmentChatAction =
  | { type: 'SUBMIT_QUERY'; query: string }
  | { type: 'RESOLVED_NONE_NEEDS_DATA' }
  | { type: 'RESOLVED_MANUAL'; candidate: CompanyCandidate; skippedHubSpot: boolean }
  | { type: 'RESOLVED_SINGLE'; candidate: CompanyCandidate; skippedHubSpot: boolean }
  | { type: 'RESOLVED_MULTIPLE'; candidates: CompanyCandidate[]; skippedHubSpot: boolean }
  | { type: 'RESOLVE_FAILED'; message: string }
  | { type: 'SELECT_CANDIDATE'; candidate: CompanyCandidate }
  | { type: 'SUBMIT_EXTRA_DATA'; domain: string; country: string }
  | { type: 'CONFIRM' }
  | { type: 'RUN_SUCCEEDED'; result: ContactEnrichmentRunResult }
  | { type: 'REQUEST_CREATED'; requestId: string }
  | { type: 'RUN_FAILED'; message: string }
  | { type: 'SELECT_PROVIDER'; provider: ContactEnrichmentProvider }
  | { type: 'APOLLO_START' }
  | { type: 'APOLLO_SUCCEEDED'; result: ApolloEnrichmentUiResult; runResult?: ContactEnrichmentRunResult }
  | { type: 'APOLLO_FAILED'; result: ApolloEnrichmentUiResult; runResult?: ContactEnrichmentRunResult }
  | { type: 'LUSHA_START' }
  | { type: 'LUSHA_SUCCEEDED'; result: LushaEnrichmentUiResult; runResult?: ContactEnrichmentRunResult }
  | { type: 'LUSHA_FAILED'; result: LushaEnrichmentUiResult; runResult?: ContactEnrichmentRunResult }
  | { type: 'AUTOMATIC_ROUTING_START' }
  | { type: 'AUTOMATIC_ROUTING_SETTLED'; result: AutomaticRoutingUiResult }
  | { type: 'RESET' };

// ── Manual contact context (Hito 17A.7C.2) ────────────────────────────────────

export interface ManualContactContext {
  accountId: string;
  runId: string;
  companyName: string | null;
  companyDomain: string | null;
}

// ── Preloaded company (contextual sidepanel entry from /accounts) ──────────────

export interface ContactEnrichmentInitialCompany {
  name: string;
  domain?: string | null;
  country?: string | null;
  /** ISO-2 country code (e.g. "CO"). Used to filter Apollo people_search by location (Hito 17A.9B.2). */
  countryCode?: string | null;
  sellupAccountId?: string;
  /** HubSpot company ID when the account is synced with HubSpot. */
  hubspotCompanyId?: string | null;
}
