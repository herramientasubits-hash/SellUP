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
  | 'error'; // controlled error

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
  | { type: 'RESET' };

// ── Preloaded company (contextual sidepanel entry from /accounts) ──────────────

export interface ContactEnrichmentInitialCompany {
  name: string;
  domain?: string | null;
  country?: string | null;
  sellupAccountId?: string;
}
