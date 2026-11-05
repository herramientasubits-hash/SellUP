'use server';

// Agente 2A — Búsqueda por lotes con ID de HubSpot (backlog D1)
//
// Server action que PREPARA un Company ID: resuelve la empresa y crea la request, igual que el
// asistente de una empresa al confirmar (#587). La búsqueda de contactos ya no corre aquí: el
// panel la lanza por la MISMA ruta que «Buscar contactos con IA» (Bryan 04-11), así que corre en
// segundo plano, sale en el Centro de procesos, aprueba los contactos de HubSpot completos y
// cuenta aprobados y pendientes de antes. Una acción corta por empresa, en orden.

import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { resolveCompanyForContactEnrichment } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import { createContactEnrichmentRequestAction, requireActiveUserForEnrichment } from './actions';
import { prepareHubSpotIdBatchItem, type HubSpotIdBatchPrepared } from './hubspot-id-batch-core';

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createServiceRoleClient(url, key);
}

export async function prepareHubSpotIdBatchItemAction(hubspotCompanyId: unknown): Promise<HubSpotIdBatchPrepared> {
  await requireActiveUserForEnrichment();
  const id = typeof hubspotCompanyId === 'string' ? hubspotCompanyId : '';
  const admin = getServiceRoleClient();

  return prepareHubSpotIdBatchItem(id, {
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
  });
}
