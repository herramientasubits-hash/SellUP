// Agente 2A — Contact Enrichment Runner (mock para Hito 17A.1)
// Solo crea el run; NO ejecuta Apollo, Lusha ni escribe en HubSpot.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createAgentRun, createAgentRunStep, finishAgentRunStep } from '@/modules/usage-tracking/logging';
import type { Agent2AInput, ContactEnrichmentRunResult } from '@/modules/contact-enrichment/types';
import type { CompanyCandidate } from '@/modules/contact-enrichment/types';

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
 * Crea un agent_run y un contact_enrichment_run en estado ready_to_enrich.
 * No llama a Apollo, Lusha ni HubSpot write.
 * Hito 17A.1 — estructura y persistencia únicamente.
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
      version: '1.0.0-scaffold',
      hito: '17A.1',
      source: confirmedCompany.source,
    },
  });

  if (!agentRun) {
    throw new Error('No se pudo crear el agent_run para el enriquecimiento');
  }

  // 2. Crear step resolve_company
  const step = await createAgentRunStep({
    agent_run_id: agentRun.id,
    step_key: 'resolve_company',
    step_name: 'Resolución de empresa objetivo',
    metadata: {
      confirmedCompany,
      skippedProviders: ['apollo', 'lusha'],
      note: 'Hito 17A.1 — sin ejecución de proveedores',
    },
  });

  if (step) {
    await finishAgentRunStep(step.id, {
      status: 'success',
      metadata: { resolvedCompanyName: confirmedCompany.name },
    });
  }

  // 3. Crear contact_enrichment_run
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
        note: 'Hito 17A.1 — en espera de conexión de proveedores',
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

  return {
    runId: enrichmentRun.id,
    agentRunId: agentRun.id,
    status: 'ready_to_enrich',
    candidatesCount: 0,
  };
}
