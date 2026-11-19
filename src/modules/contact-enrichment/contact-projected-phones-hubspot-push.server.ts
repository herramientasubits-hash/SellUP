// Agente 2A — Los números NUEVOS de un contacto aprobado viajan a HubSpot aunque su principal no
// cambie (AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE, Bryan 19-11).
//
// Server-only, con service role (también corre sin sesión). Regla de Bryan: el número revelado va
// al PRIMER campo vacío del contacto en HubSpot (`phone` → `mobilephone` → `telefono_alterno`) y
// nunca si ya está en cualquiera de ellos — la misma regla de siempre (`planRevealedPhonesForHubSpot`).
// Nunca reemplaza un campo con dato. Sin conexión, sin permiso o sin poder LEER el contacto, no
// escribe nada. NUNCA lanza. No registra números.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { loadContactRevealedPhonesForHubSpot } from '@/modules/contacts/contact-phones-for-hubspot-read';
import { planRevealedPhonesForHubSpot } from '@/modules/contacts/contact-hubspot-sync-core';
import {
  fillEmptyHubSpotContactProperties,
  findHubSpotContactById,
  getHubSpotContactSyncConnection,
} from '@/server/integrations/hubspot-contact-sync';

export type ProjectedPhonesHubSpotPushOutcome =
  | 'written'
  | 'nothing_new'
  | 'not_in_hubspot'
  | 'hubspot_unavailable'
  | 'unreadable'
  | 'failed';

export async function pushContactPhonesToHubSpotEmptySlots(contactId: string): Promise<ProjectedPhonesHubSpotPushOutcome> {
  try {
    const { data } = await createSupabaseAdminClient()
      .from('contacts')
      .select('hubspot_contact_id, archived_at')
      .eq('id', contactId)
      .maybeSingle();
    const row = (data ?? null) as { hubspot_contact_id?: unknown; archived_at?: unknown } | null;
    const hubspotContactId = typeof row?.hubspot_contact_id === 'string' && row.hubspot_contact_id.trim() ? row.hubspot_contact_id.trim() : null;
    if (!hubspotContactId || row?.archived_at) return 'not_in_hubspot';

    const connection = await getHubSpotContactSyncConnection().catch(() => null);
    if (!connection?.connected || !connection.canWriteContacts) return 'hubspot_unavailable';

    const existing = await findHubSpotContactById(hubspotContactId).catch(() => null);
    if (!existing?.properties) return 'unreadable';

    const phones = await loadContactRevealedPhonesForHubSpot(contactId).catch(() => []);
    const plan = planRevealedPhonesForHubSpot(phones, existing.properties);
    if (Object.keys(plan).length === 0) return 'nothing_new';
    const written = await fillEmptyHubSpotContactProperties(existing.id ?? hubspotContactId, plan);
    return 'ok' in written && written.written.length > 0 ? 'written' : 'failed';
  } catch {
    return 'failed';
  }
}
