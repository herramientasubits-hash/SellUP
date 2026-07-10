// Agente 2A — Contact Enrichment Attempt Creator (Hito 17B.4X.7C.1)
//
// Server-side adapter around the atomic create_contact_enrichment_attempt
// RPC (migration 086). Loads the request, reads a fresh existing-contacts
// snapshot (SNAPSHOT_AT_ATTEMPT_CREATION, §12-13), and calls the RPC so the
// snapshot lands in the attempt's initial INSERT — never a follow-up UPDATE.
//
// This adapter MUST NOT call Apollo, MUST NOT call Lusha, MUST NOT execute
// any provider runner, MUST NOT evaluate routing policy, MUST NOT write
// routing events, and MUST NOT create a fallback attempt automatically.
//
// Attempt order is server-owned (§20): createInitialContactEnrichmentAttempt
// is the only production entry point and always requests order 1.
// createContactEnrichmentAttempt (order-parameterized) exists so 7C.2+ can
// contract-test order 2 without another DB migration — no live caller in
// this hito passes 2.
//
// All Supabase-touching steps are injectable (default-parameter DI, mirrors
// executeContactEnrichmentApolloRun's ApolloEnrichmentRunnerDeps pattern) so
// this adapter's control flow is unit-testable without a database.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { readExistingContactsForCompany } from './existing-contacts-reader';
import type {
  AttemptCreationResult,
  AttemptCreationStatus,
  CreateInitialContactEnrichmentAttemptInput,
  IntendedProvider,
} from '@/modules/contact-enrichment/request-attempt-types';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

export interface RequestRow {
  id: string;
  account_id: string | null;
  company_name: string;
  company_domain: string | null;
  company_country_code: string | null;
  hubspot_company_id: string | null;
  company_resolution_source: string;
}

async function defaultLoadRequest(requestId: string): Promise<RequestRow | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('contact_enrichment_requests')
    .select('id, account_id, company_name, company_domain, company_country_code, hubspot_company_id, company_resolution_source')
    .eq('id', requestId)
    .maybeSingle();
  return (data as RequestRow | null) ?? null;
}

/**
 * Reconstruye la misma forma de summary.existing_contacts_snapshot que
 * contact-enrichment-runner.ts persiste hoy (readDeduplicationSnapshot en
 * apollo-enrichment-runner.ts depende de estas claves snake_case exactas).
 */
export async function defaultBuildExistingContactsSnapshot(
  accountId: string | null,
  hubspotCompanyId: string | null
): Promise<Record<string, unknown>> {
  const snapshot = await readExistingContactsForCompany({
    accountId,
    hubspotCompanyId,
  });

  return {
    sellup: {
      status: snapshot.sellup.status,
      count: snapshot.sellup.count,
      reason: snapshot.sellup.reason,
    },
    hubspot: {
      status: snapshot.hubspot.status,
      count: snapshot.hubspot.count,
      reason: snapshot.hubspot.reason,
    },
    combined: {
      total_existing_contacts: snapshot.combined.totalExistingContacts,
      existing_contact_names: snapshot.combined.existingContactNames.slice(0, 50),
      existing_emails: snapshot.combined.existingEmails.slice(0, 50),
      existing_linkedin_urls: snapshot.combined.existingLinkedinUrls.slice(0, 50),
      incomplete_contacts: snapshot.combined.incompleteContacts,
      source_counts: snapshot.combined.sourceCounts,
    },
  };
}

interface AttemptCreationRpcRow {
  status: AttemptCreationStatus;
  attempt_id: string | null;
  agent_run_id: string | null;
}

interface RpcCallResult {
  data: AttemptCreationRpcRow | null;
  error: { message: string } | null;
}

async function defaultCallRpc(params: {
  requestId: string;
  attemptOrder: 1 | 2;
  intendedProvider: IntendedProvider;
  triggeredBy: string;
  existingContactsSnapshot: Record<string, unknown>;
  request: RequestRow;
}): Promise<RpcCallResult> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc('create_contact_enrichment_attempt', {
    p_request_id: params.requestId,
    p_attempt_order: params.attemptOrder,
    p_intended_provider: params.intendedProvider,
    p_triggered_by: params.triggeredBy,
    p_existing_contacts_snapshot: params.existingContactsSnapshot,
    p_agent_run_input_params: {
      companyName: params.request.company_name,
      companyDomain: params.request.company_domain ?? undefined,
      hubspotCompanyId: params.request.hubspot_company_id ?? undefined,
      sellupAccountId: params.request.account_id ?? undefined,
    },
    p_agent_run_metadata: {
      hito: '17B.4X.7C.1',
      requestId: params.requestId,
      attemptOrder: params.attemptOrder,
      intendedProvider: params.intendedProvider,
    },
  });

  if (error) {
    return { data: null, error: { message: error.message } };
  }
  return { data: (data as AttemptCreationRpcRow | null) ?? null, error: null };
}

export interface AttemptCreatorDeps {
  loadRequest?: (requestId: string) => Promise<RequestRow | null>;
  buildExistingContactsSnapshot?: (
    accountId: string | null,
    hubspotCompanyId: string | null
  ) => Promise<Record<string, unknown>>;
  callRpc?: (params: {
    requestId: string;
    attemptOrder: 1 | 2;
    intendedProvider: IntendedProvider;
    triggeredBy: string;
    existingContactsSnapshot: Record<string, unknown>;
    request: RequestRow;
  }) => Promise<RpcCallResult>;
}

/**
 * Adaptador interno de bajo nivel: acepta attemptOrder 1|2 para permitir
 * pruebas de contrato futuras (7C.2+). Ningún caller productivo de este
 * hito invoca esta función con attemptOrder = 2.
 */
export async function createContactEnrichmentAttempt(
  input: {
    requestId: string;
    attemptOrder: 1 | 2;
    intendedProvider: IntendedProvider;
    triggeredBy: string;
  },
  deps: AttemptCreatorDeps = {}
): Promise<AttemptCreationResult> {
  const {
    loadRequest = defaultLoadRequest,
    buildExistingContactsSnapshot = defaultBuildExistingContactsSnapshot,
    callRpc = defaultCallRpc,
  } = deps;

  const { requestId, attemptOrder, intendedProvider, triggeredBy } = input;

  if (!requestId || typeof requestId !== 'string') {
    return { status: 'invalid_request', attemptId: null, agentRunId: null, reason: 'requestId_required' };
  }

  const request = await loadRequest(requestId);
  if (!request) {
    return { status: 'invalid_request', attemptId: null, agentRunId: null, reason: 'request_not_found' };
  }

  const existingContactsSnapshot = await buildExistingContactsSnapshot(
    request.account_id,
    request.hubspot_company_id
  );

  const { data, error } = await callRpc({
    requestId,
    attemptOrder,
    intendedProvider,
    triggeredBy,
    existingContactsSnapshot,
    request,
  });

  if (error) {
    return { status: 'rpc_error', attemptId: null, agentRunId: null, reason: error.message };
  }

  if (!data) {
    return { status: 'rpc_error', attemptId: null, agentRunId: null, reason: 'empty_rpc_result' };
  }

  return {
    status: data.status,
    attemptId: data.attempt_id,
    agentRunId: data.agent_run_id,
  };
}

/**
 * Único punto de entrada productivo para 7C.1. Siempre crea attempt_order=1.
 * No acepta attemptOrder del caller. No llama Apollo/Lusha, no ejecuta
 * ningún provider runner, no evalúa routing, no crea fallback.
 */
export async function createInitialContactEnrichmentAttempt(
  input: CreateInitialContactEnrichmentAttemptInput,
  deps: AttemptCreatorDeps = {}
): Promise<AttemptCreationResult> {
  return createContactEnrichmentAttempt(
    {
      requestId: input.requestId,
      attemptOrder: 1,
      intendedProvider: input.intendedProvider,
      triggeredBy: input.triggeredBy,
    },
    deps
  );
}
