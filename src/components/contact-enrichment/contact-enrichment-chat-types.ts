// Agente 2A — Conversational wizard contracts (Hito 17A.2B)
// Pure types + actions for the contact-enrichment chat state machine.
// No React, no network — safe to import from unit tests.

import type { AgentChatMessage } from '@/components/agent-chat';
import type { CompanyCandidate, ContactEnrichmentRunResult } from '@/modules/contact-enrichment/types';

// ── Conversational steps ──────────────────────────────────────────────────────

export type ContactEnrichmentChatStep =
  | 'await_company' // waiting for the user to type a company (composer open)
  | 'resolving' // searching SellUp + HubSpot
  | 'selecting_company' // multiple matches — user picks one
  | 'needs_extra_data' // 0 matches with only a name — asks for domain / país
  | 'confirming' // a candidate is ready — user confirms
  | 'creating_run' // creating the run + reading existing contacts
  | 'done' // run created — snapshot shown
  | 'searching_apollo' // querying Apollo for real candidates (Hito 17A.3A)
  | 'error'; // controlled error

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
  /** Apollo candidate-sourcing result (Hito 17A.3A). Null until Apollo runs. */
  apolloResult: ApolloEnrichmentUiResult | null;
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
  | { type: 'RUN_FAILED'; message: string }
  | { type: 'APOLLO_START' }
  | { type: 'APOLLO_SUCCEEDED'; result: ApolloEnrichmentUiResult }
  | { type: 'APOLLO_FAILED'; result: ApolloEnrichmentUiResult }
  | { type: 'RESET' };

// ── Preloaded company (contextual sidepanel entry from /accounts) ──────────────

export interface ContactEnrichmentInitialCompany {
  name: string;
  domain?: string | null;
  country?: string | null;
  sellupAccountId?: string;
}
