'use server';

// Agente 2A — Server action: resolver un match HubSpot pendiente (Task B5)
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Cablea `runResolveHubSpotCompanyMatch` (núcleo puro) sobre Supabase real vía la fábrica
// fail-closed `createSupabaseAdminClient` (nunca `createClient(process.env...)` inline). La
// decisión "different" delega en `createHubSpotCompanyForAccountWired` (Task B4, extendido
// aquí), que crea la empresa SIN volver a evaluar el match — el humano ya decidió.

import { requireActiveUserForEnrichment } from '@/modules/contact-enrichment/actions';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { runResolveHubSpotCompanyMatch } from './hubspot-company-resolution-review-core';
import { createHubSpotCompanyForAccountWired } from './hubspot-company-resolution-wiring';

export async function resolveHubSpotCompanyMatchAction(input: {
  accountId: string;
  decision: 'same' | 'different';
}): Promise<{ ok: boolean }> {
  await requireActiveUserForEnrichment();
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const result = await runResolveHubSpotCompanyMatch(input, {
    loadAccount: async (accountId) => {
      const { data, error } = await admin
        .from('accounts')
        .select('id, metadata')
        .eq('id', accountId)
        .maybeSingle();
      if (error) {
        console.error('[hubspot-company-review-actions] loadAccount query failed', { accountId, error });
        return null;
      }
      return data
        ? { id: data.id as string, metadata: (data.metadata as Record<string, unknown>) ?? {} }
        : null;
    },
    updateAccount: async (accountId, patch) => {
      const { error } = await admin.from('accounts').update(patch).eq('id', accountId);
      if (error) {
        console.error('[hubspot-company-review-actions] updateAccount failed', { accountId, error });
      }
    },
    createCompany: async (accountId) => createHubSpotCompanyForAccountWired(accountId),
    nowIso,
  });

  return { ok: result.ok };
}
