// Agente 2A — Contact Enrichment Request / Attempt Persistence Types
// Hito 17B.4X.7C.1 — PARENT_REQUEST_PROVIDER_ATTEMPTS foundation
//
// Foundation-only types: request context persistence + atomic attempt
// creation outcomes. No routing policy, no provider execution, no wizard
// wiring lives in this file.

export type CompanyResolutionSource = 'sellup' | 'hubspot' | 'manual';

export interface ContactEnrichmentRequest {
  id: string;
  accountId: string | null;
  companyName: string;
  companyDomain: string | null;
  companyCountryCode: string | null;
  hubspotCompanyId: string | null;
  companyResolutionSource: CompanyResolutionSource;
  triggeredBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContactEnrichmentRequestInput {
  accountId?: string | null;
  companyName: string;
  companyDomain?: string | null;
  companyCountryCode?: string | null;
  hubspotCompanyId?: string | null;
  companyResolutionSource: CompanyResolutionSource;
  triggeredBy?: string | null;
}

export type CreateContactEnrichmentRequestResult =
  | { status: 'created'; request: ContactEnrichmentRequest }
  | { status: 'invalid_input'; reason: string }
  | { status: 'persistence_error'; reason: string };

export type ReadContactEnrichmentRequestResult =
  | { status: 'found'; request: ContactEnrichmentRequest }
  | { status: 'not_found' }
  | { status: 'error'; reason: string };

// ── Attempt creation (§14-20) ────────────────────────────────────

export type IntendedProvider = 'apollo' | 'lusha';

/**
 * Typed outcomes of create_contact_enrichment_attempt (migration 086).
 * 'rpc_error' covers transport/connection failures — distinct from the
 * function's own typed status codes.
 */
export type AttemptCreationStatus =
  | 'created'
  | 'already_exists'
  | 'invalid_request'
  | 'invalid_provider'
  | 'invalid_attempt_order'
  | 'rpc_error';

export interface AttemptCreationResult {
  status: AttemptCreationStatus;
  attemptId: string | null;
  agentRunId: string | null;
  reason?: string;
}

/**
 * Public/server-facing input for the initial attempt. No attemptOrder field
 * exists here on purpose — attempt order is server-owned (§20) and always 1
 * for this entry point.
 */
export interface CreateInitialContactEnrichmentAttemptInput {
  requestId: string;
  intendedProvider: IntendedProvider;
  triggeredBy: string;
}
