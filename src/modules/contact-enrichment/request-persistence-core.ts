// Agente 2A — Request Persistence Core (Hito 17B.4X.7C.1)
//
// Pure validation/normalization for contact enrichment request creation.
// No Supabase, no network — persistence is injected so this stays testable
// without a database (mirrors candidate-review-core.ts's DI shape).
//
// This core MUST NOT create an agent_run, MUST NOT create a
// contact_enrichment_runs row, MUST NOT take an existing-contacts snapshot,
// MUST NOT call Apollo/Lusha, and MUST NOT evaluate routing policy. Request
// creation is context-only.

import type {
  CompanyResolutionSource,
  ContactEnrichmentRequest,
  CreateContactEnrichmentRequestInput,
  CreateContactEnrichmentRequestResult,
} from './request-attempt-types';

const VALID_RESOLUTION_SOURCES: readonly CompanyResolutionSource[] = ['sellup', 'hubspot', 'manual'];

export function isValidCompanyResolutionSource(value: unknown): value is CompanyResolutionSource {
  return typeof value === 'string' && (VALID_RESOLUTION_SOURCES as readonly string[]).includes(value);
}

export interface NormalizedRequestContext {
  accountId: string | null;
  companyName: string;
  companyDomain: string | null;
  companyCountryCode: string | null;
  hubspotCompanyId: string | null;
  companyResolutionSource: CompanyResolutionSource;
  triggeredBy: string | null;
}

export type NormalizeCreateRequestInputResult =
  | { ok: true; context: NormalizedRequestContext }
  | { ok: false; reason: string };

/** Valida y normaliza el input de creación de request. No persiste nada. */
export function normalizeCreateRequestInput(
  input: CreateContactEnrichmentRequestInput
): NormalizeCreateRequestInputResult {
  const companyName = input.companyName?.trim();
  if (!companyName) {
    return { ok: false, reason: 'company_name_required' };
  }

  if (!isValidCompanyResolutionSource(input.companyResolutionSource)) {
    return { ok: false, reason: 'invalid_company_resolution_source' };
  }

  return {
    ok: true,
    context: {
      accountId: input.accountId ?? null,
      companyName,
      companyDomain: input.companyDomain?.trim() || null,
      companyCountryCode: input.companyCountryCode?.trim() || null,
      hubspotCompanyId: input.hubspotCompanyId?.trim() || null,
      companyResolutionSource: input.companyResolutionSource,
      triggeredBy: input.triggeredBy ?? null,
    },
  };
}

export interface InsertRequestResult {
  ok: boolean;
  row?: ContactEnrichmentRequest;
  reason?: string;
}

export interface CreateRequestPersistenceDeps {
  insertRequest: (context: NormalizedRequestContext) => Promise<InsertRequestResult>;
}

/**
 * Orquesta validar → normalizar → persistir. La persistencia real (insert en
 * contact_enrichment_requests) es inyectada por el caller server-side.
 */
export async function createContactEnrichmentRequestCore(
  input: CreateContactEnrichmentRequestInput,
  deps: CreateRequestPersistenceDeps
): Promise<CreateContactEnrichmentRequestResult> {
  const normalized = normalizeCreateRequestInput(input);
  if (!normalized.ok) {
    return { status: 'invalid_input', reason: normalized.reason };
  }

  const result = await deps.insertRequest(normalized.context);
  if (!result.ok || !result.row) {
    return { status: 'persistence_error', reason: result.reason ?? 'unknown_error' };
  }

  return { status: 'created', request: result.row };
}
