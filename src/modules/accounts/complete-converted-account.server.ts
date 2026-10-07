// HUBSPOT-ACCOUNT-SYNC-1 — Completar la empresa que deja una aprobación del Agente 1
//
// Tras aprobar un prospecto, la empresa queda con lo que traía el prospecto. Aquí se le
// pone responsable (dueño de HubSpot o quien lanzó la búsqueda), se completa lo vacío con
// la ficha de HubSpot cuando la empresa ya existía allí, y se programan las fuentes
// oficiales gratuitas. Nunca lanza: la aprobación ya terminó.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { syncAccountFromHubSpotProfile } from './hubspot-company-profile-sync.server';
import { scheduleAccountOfficialEnrichment } from './account-official-enrichment.server';

export async function completeConvertedAccount(input: {
  accountId: string;
  hubspotCompanyId: string | null;
  searcherUserId: string | null;
  actorUserId: string;
  nowIso: string;
}): Promise<void> {
  try {
    await syncAccountFromHubSpotProfile(createSupabaseAdminClient(), input);
  } catch (err) {
    console.error('[complete-converted-account] HubSpot profile sync failed', {
      accountId: input.accountId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  scheduleAccountOfficialEnrichment(input.accountId, input.actorUserId);
}
