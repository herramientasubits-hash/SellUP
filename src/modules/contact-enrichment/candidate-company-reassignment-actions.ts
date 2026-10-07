'use server';

// Agente 2A — «Reasignar empresa» desde la ficha del candidato
// (AGENT2A-CANDIDATE-COMPANY-REASSIGN-1).
//
// La búsqueda reutiliza `resolveContactEnrichmentCompanyAction` (la misma del AGENTE IA: nombre,
// dominio o HubSpot ID, en SellUp y HubSpot). Esta acción sólo confirma la selección:
//  - vuelve a resolver la empresa en el servidor por su id (no confía en el cliente);
//  - si la empresa sólo existe en HubSpot, busca/vincula/crea la cuenta SellUp con el MISMO
//    resolvedor que la aprobación (`resolveOrCreateAccountForHubSpotCandidate`);
//  - guarda la reasignación en `enrichment_metadata.company_reassignment` del candidato.
//
// NO escribe en HubSpot, NO llama a Apollo/Lusha, NO toca `contact_enrichment_runs` y NO
// aprueba: aprobar sigue siendo un clic humano aparte.

import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveCompanyForContactEnrichment } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import {
  buildHubSpotAccountResolutionDeps,
  loadContactSearchTriggeredBy,
} from '@/server/agents/contact-enrichment-toolkit/hubspot-account-resolution-deps';
import { requireActiveUserForEnrichment } from './actions';
import { resolveOrCreateAccountForHubSpotCandidate } from './hubspot-account-resolver';
import { isNextControlFlowSignal } from './next-control-flow-signal';
import {
  pickReassignmentCompany,
  runReassignCandidateCompany,
  type CompanyReassignmentSelection,
  type ReassignCandidateCompanyErrorCode,
} from './candidate-company-reassignment-core';

export interface ReassignCandidateCompanyActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  code?: ReassignCandidateCompanyErrorCode;
  companyName?: string;
}

export async function reassignContactCandidateCompanyAction(
  candidateId: string,
  selection: CompanyReassignmentSelection,
): Promise<ReassignCandidateCompanyActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();
    const supabase = await createClient();
    const admin = createSupabaseAdminClient();

    const result = await runReassignCandidateCompany(candidateId, selection, {
      actorId: internalUserId,
      nowIso: new Date().toISOString(),
      loadCandidate: async (id) => {
        const { data, error } = await supabase
          .from('contact_enrichment_candidates')
          .select(
            'id, status, email, enrichment_metadata, run:contact_enrichment_runs ( account_id, hubspot_company_id, company_name, company_domain, company_country_code )',
          )
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const row = data as Record<string, unknown>;
        const runRaw = row.run;
        const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
          | Record<string, string | null>
          | null
          | undefined;
        return {
          id: row.id as string,
          status: (row.status as string) ?? '',
          email: (row.email as string | null) ?? null,
          enrichment_metadata: (row.enrichment_metadata as Record<string, unknown>) ?? {},
          run: {
            account_id: run?.account_id ?? null,
            hubspot_company_id: run?.hubspot_company_id ?? null,
            company_name: run?.company_name ?? null,
            company_domain: run?.company_domain ?? null,
            country_code: run?.company_country_code ?? null,
          },
        };
      },
      resolveCompany: async (sel) => {
        const resolution = await resolveCompanyForContactEnrichment(
          sel.source === 'sellup'
            ? { sellupAccountId: sel.sellupAccountId }
            : { hubspotCompanyId: sel.hubspotCompanyId },
        );
        return pickReassignmentCompany(sel, resolution.candidates);
      },
      resolveOrCreateAccount: async (args) => {
        const searcherUserId =
          (await loadContactSearchTriggeredBy(admin, { candidateId })) ?? internalUserId;
        return resolveOrCreateAccountForHubSpotCandidate(
          { ...args, run_id: null },
          buildHubSpotAccountResolutionDeps(admin, internalUserId, 'contact_candidate_reassignment', searcherUserId),
        );
      },
      writeCandidateMetadata: async (id, metadata) => {
        const { data, error } = await admin
          .from('contact_enrichment_candidates')
          .update({ enrichment_metadata: metadata })
          .eq('id', id)
          .eq('status', 'pending_review')
          .select('id');
        if (error) return { updated: false, error: error.message };
        return { updated: (data ?? []).length > 0 };
      },
    });

    if (!result.ok) return { ok: false, error: result.error, code: result.code };
    return {
      ok: true,
      companyName: result.reassignment.company_name,
      message: result.unchanged
        ? `El candidato ya estaba asociado a ${result.reassignment.company_name}.`
        : `Empresa reasignada a ${result.reassignment.company_name}. Ya puedes aprobar el candidato.`,
    };
  } catch (err) {
    if (isNextControlFlowSignal(err)) throw err;
    console.error('[reassignContactCandidateCompanyAction] failed', {
      candidateId: typeof candidateId === 'string' ? candidateId : null,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: 'No fue posible reasignar la empresa. Intenta de nuevo.' };
  }
}
