'use server';

// Agente 2A — Búsqueda por lotes con ID de HubSpot (backlog D1)
//
// Server action que procesa UN Company ID. El panel la llama una vez por ID, en
// secuencia: así cada empresa corre en su propia invocación (sin riesgo de que
// 10 búsquedas seguidas superen el tiempo máximo de una función) y la UI puede
// mostrar el avance «empresa 3 de 10».
//
// No agrega lógica de negocio nueva: encadena las mismas piezas que el asistente
// individual (resolver por ID #587 → request con cuenta #587 → enrutado
// automático Apollo→Lusha). Los candidatos quedan en `pending_review`; nada se
// aprueba ni se escribe en HubSpot desde aquí.

import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { resolveCompanyForContactEnrichment } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import { createContactEnrichmentRequestAction, requireActiveUserForEnrichment } from './actions';
import { runAutomaticContactEnrichmentForRequestCore } from './automatic-routing-action-core';
import {
  processHubSpotIdBatchItem,
  type HubSpotIdBatchItemResult,
} from './hubspot-id-batch-core';

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createServiceRoleClient(url, key);
}

export async function runHubSpotIdBatchItemAction(
  hubspotCompanyId: unknown,
): Promise<HubSpotIdBatchItemResult> {
  const { internalUserId } = await requireActiveUserForEnrichment();
  const id = typeof hubspotCompanyId === 'string' ? hubspotCompanyId : '';
  const admin = getServiceRoleClient();

  return processHubSpotIdBatchItem(id, {
    resolveCompany: (companyId) => resolveCompanyForContactEnrichment({ hubspotCompanyId: companyId }),

    createRequest: (candidate) => createContactEnrichmentRequestAction(candidate),

    async loadRequestAccountId(requestId) {
      const { data, error } = await admin
        .from('contact_enrichment_requests')
        .select('account_id')
        .eq('id', requestId)
        .maybeSingle();
      if (error) throw new Error(`loadRequestAccountId: ${error.message}`);
      return (data?.account_id as string | null | undefined) ?? null;
    },

    async countPendingCandidatesForAccount(accountId) {
      const { data: runs, error: runsError } = await admin
        .from('contact_enrichment_runs')
        .select('id')
        .eq('account_id', accountId);
      if (runsError) throw new Error(`countPendingCandidatesForAccount: ${runsError.message}`);
      const runIds = (runs ?? []).map((run) => run.id as string);
      if (runIds.length === 0) return 0;

      const { count, error } = await admin
        .from('contact_enrichment_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_review')
        .in('enrichment_run_id', runIds);
      if (error) throw new Error(`countPendingCandidatesForAccount: ${error.message}`);
      return count ?? 0;
    },

    runAutomaticRouting: (requestId) =>
      runAutomaticContactEnrichmentForRequestCore(requestId, internalUserId, new Date().toISOString()),
  });
}
