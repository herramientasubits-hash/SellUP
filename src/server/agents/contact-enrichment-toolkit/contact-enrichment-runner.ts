// Agente 2A — Contact Enrichment Runner
// Hito 17A.2A — Snapshot de contactos existentes antes de enriquecer.
// No llama Apollo, Lusha ni escribe en HubSpot.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createAgentRun, createAgentRunStep, finishAgentRunStep } from '@/modules/usage-tracking/logging';
import type { Agent2AInput, ContactEnrichmentRunResult, CompanyCandidate } from '@/modules/contact-enrichment/types';
import { readExistingContactsForCompany } from './existing-contacts-reader';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

export interface StartEnrichmentRunInput {
  confirmedCompany: CompanyCandidate;
  originalInput: Agent2AInput;
  triggeredBy: string;
}

/**
 * Crea un agent_run y un contact_enrichment_run, lee los contactos existentes
 * en SellUp y HubSpot, guarda el snapshot en summary y deja el run en ready_to_enrich.
 * No llama a Apollo, Lusha ni escribe en HubSpot.
 */
export async function startContactEnrichmentRun(
  input: StartEnrichmentRunInput
): Promise<ContactEnrichmentRunResult> {
  const { confirmedCompany, originalInput, triggeredBy } = input;
  const admin = getAdminClient();

  // 1. Crear agent_run
  const agentRun = await createAgentRun({
    agent_key: 'agent_2a_contact_enrichment',
    agent_name: 'Enriquecimiento de contactos por empresa',
    triggered_by: triggeredBy,
    input_params: {
      companyName: confirmedCompany.name,
      companyDomain: confirmedCompany.domain ?? undefined,
      hubspotCompanyId: confirmedCompany.hubspotCompanyId ?? undefined,
      sellupAccountId: confirmedCompany.sellupAccountId ?? undefined,
      targetDepartments: originalInput.targetDepartments ?? [],
      targetSeniorities: originalInput.targetSeniorities ?? [],
    },
    metadata: {
      version: '1.1.0',
      hito: '17A.2A',
      source: confirmedCompany.source,
    },
  });

  if (!agentRun) {
    throw new Error('No se pudo crear el agent_run para el enriquecimiento');
  }

  // 2. Step: resolve_company
  const resolveStep = await createAgentRunStep({
    agent_run_id: agentRun.id,
    step_key: 'resolve_company',
    step_name: 'Resolución de empresa objetivo',
    metadata: {
      confirmedCompany,
      skippedProviders: ['apollo', 'lusha'],
      note: 'Hito 17A.2A — snapshot de contactos existentes',
    },
  });

  if (resolveStep) {
    await finishAgentRunStep(resolveStep.id, {
      status: 'success',
      metadata: { resolvedCompanyName: confirmedCompany.name },
    });
  }

  // 3. Crear contact_enrichment_run (summary inicial)
  const { data: enrichmentRun, error: enrichmentError } = await admin
    .from('contact_enrichment_runs')
    .insert({
      agent_run_id: agentRun.id,
      account_id: confirmedCompany.sellupAccountId ?? null,
      company_name: confirmedCompany.name,
      company_domain: confirmedCompany.domain ?? null,
      company_country_code: confirmedCompany.countryCode ?? null,
      hubspot_company_id: confirmedCompany.hubspotCompanyId ?? null,
      status: 'ready_to_enrich',
      triggered_by: triggeredBy,
      providers_used: [],
      summary: {
        totalCandidates: 0,
        company_resolution_source: confirmedCompany.source,
        note: 'Hito 17A.2A — leyendo contactos existentes...',
      },
      estimated_cost_usd: 0,
    })
    .select('id')
    .single();

  if (enrichmentError || !enrichmentRun) {
    throw new Error(
      `No se pudo crear contact_enrichment_run: ${enrichmentError?.message ?? 'error desconocido'}`
    );
  }

  // 4. Step: read_existing_contacts
  const snapshotStep = await createAgentRunStep({
    agent_run_id: agentRun.id,
    step_key: 'read_existing_contacts',
    step_name: 'Lectura de contactos existentes para deduplicación',
    metadata: {
      accountId: confirmedCompany.sellupAccountId ?? null,
      hubspotCompanyId: confirmedCompany.hubspotCompanyId ?? null,
    },
  });

  // 5. Leer contactos existentes
  const existingSnapshot = await readExistingContactsForCompany({
    accountId: confirmedCompany.sellupAccountId ?? null,
    hubspotCompanyId: confirmedCompany.hubspotCompanyId ?? null,
  });

  if (snapshotStep) {
    await finishAgentRunStep(snapshotStep.id, {
      status: existingSnapshot.sellup.status === 'error' ? 'error' : 'success',
      results_returned: existingSnapshot.combined.totalExistingContacts,
      metadata: {
        sellupStatus: existingSnapshot.sellup.status,
        sellupCount: existingSnapshot.sellup.count,
        hubspotStatus: existingSnapshot.hubspot.status,
        hubspotCount: existingSnapshot.hubspot.count,
        totalUnique: existingSnapshot.combined.totalExistingContacts,
      },
    });
  }

  // 6. Actualizar summary del run con el snapshot
  const updatedSummary = {
    totalCandidates: 0,
    company_resolution_source: confirmedCompany.source,
    existing_contacts_snapshot: {
      sellup: {
        status: existingSnapshot.sellup.status,
        count: existingSnapshot.sellup.count,
        reason: existingSnapshot.sellup.reason,
      },
      hubspot: {
        status: existingSnapshot.hubspot.status,
        count: existingSnapshot.hubspot.count,
        reason: existingSnapshot.hubspot.reason,
      },
      combined: {
        total_existing_contacts: existingSnapshot.combined.totalExistingContacts,
        existing_contact_names: existingSnapshot.combined.existingContactNames.slice(0, 50),
        existing_emails: existingSnapshot.combined.existingEmails.slice(0, 50),
        existing_linkedin_urls: existingSnapshot.combined.existingLinkedinUrls.slice(0, 50),
        incomplete_contacts: existingSnapshot.combined.incompleteContacts,
        source_counts: existingSnapshot.combined.sourceCounts,
      },
    },
  };

  await admin
    .from('contact_enrichment_runs')
    .update({ summary: updatedSummary })
    .eq('id', enrichmentRun.id);

  return {
    runId: enrichmentRun.id,
    agentRunId: agentRun.id,
    status: 'ready_to_enrich',
    candidatesCount: 0,
    existingContactsSnapshot: existingSnapshot,
  };
}
