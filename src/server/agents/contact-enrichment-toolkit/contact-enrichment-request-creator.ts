// Agente 2A — Contact Enrichment Request Creator (Hito 17B.4X.7C.1)
//
// Server-side wiring for request creation: persists one
// contact_enrichment_requests row via the Supabase admin client. Delegates
// validation/normalization to request-persistence-core.ts.
//
// This module MUST NOT create an agent_run, MUST NOT create a
// contact_enrichment_runs row, MUST NOT take an existing-contacts snapshot,
// MUST NOT call Apollo/Lusha, and MUST NOT evaluate routing policy.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  createContactEnrichmentRequestCore,
  type NormalizedRequestContext,
  type InsertRequestResult,
} from '@/modules/contact-enrichment/request-persistence-core';
import type {
  ContactEnrichmentRequest,
  CreateContactEnrichmentRequestInput,
  CreateContactEnrichmentRequestResult,
} from '@/modules/contact-enrichment/request-attempt-types';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

function mapRequestRow(row: Record<string, unknown>): ContactEnrichmentRequest {
  return {
    id: row.id as string,
    accountId: (row.account_id as string | null) ?? null,
    companyName: row.company_name as string,
    companyDomain: (row.company_domain as string | null) ?? null,
    companyCountryCode: (row.company_country_code as string | null) ?? null,
    hubspotCompanyId: (row.hubspot_company_id as string | null) ?? null,
    companyResolutionSource: row.company_resolution_source as ContactEnrichmentRequest['companyResolutionSource'],
    triggeredBy: (row.triggered_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

async function insertRequest(context: NormalizedRequestContext): Promise<InsertRequestResult> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_requests')
    .insert({
      account_id: context.accountId,
      company_name: context.companyName,
      company_domain: context.companyDomain,
      company_country_code: context.companyCountryCode,
      hubspot_company_id: context.hubspotCompanyId,
      company_resolution_source: context.companyResolutionSource,
      triggered_by: context.triggeredBy,
    })
    .select()
    .single();

  if (error || !data) {
    return { ok: false, reason: error?.message ?? 'unknown_error' };
  }

  return { ok: true, row: mapRequestRow(data) };
}

export interface ContactEnrichmentRequestCreatorDeps {
  insertRequest?: (context: NormalizedRequestContext) => Promise<InsertRequestResult>;
}

/**
 * Crea un contact_enrichment_requests row. Retorna el requestId creado.
 * No crea agent_run, no crea contact_enrichment_runs, no toma snapshot de
 * contactos existentes, no llama Apollo/Lusha, no evalúa routing.
 */
export async function createContactEnrichmentRequest(
  input: CreateContactEnrichmentRequestInput,
  deps: ContactEnrichmentRequestCreatorDeps = {}
): Promise<CreateContactEnrichmentRequestResult> {
  const { insertRequest: insertRequestFn = insertRequest } = deps;
  return createContactEnrichmentRequestCore(input, { insertRequest: insertRequestFn });
}
