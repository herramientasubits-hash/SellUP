// Agente 2A — LECTURA de los números vivos de un contacto oficial para el envío de un reveal a
// HubSpot (AGENT2A-REVEAL-PHONE-SLOTS).
//
// Sólo LEE la colección `contact_phones`: no escribe ningún teléfono ni ninguna procedencia. Vive
// fuera del runner de sincronización para que éste siga sin nombrar campos de teléfono (guarda
// 4O-E4.1 R1). Con service role porque la segunda fase también corre SIN sesión (aviso de Apollo,
// pata Lusha, cron); el contacto ya lo cargó el motor con el cliente que corresponde y la consulta
// está acotada a su id.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { RevealedPhoneForHubSpot } from './contact-hubspot-sync-core';

/** Columnas de la colección oficial que el envío de un reveal necesita. Nunca se escriben. */
const CONTACT_PHONES_FOR_HUBSPOT_SELECT = 'display_phone, normalized_phone, phone_type, phone_status';

/**
 * Los números VIVOS del contacto, el principal primero (AGENT2A-REVEAL-PHONE-SLOTS). Sólo LEE.
 * LANZA si la lectura falla; el motor lo trata como «sin colección» y usa los escalares.
 */
export async function loadContactRevealedPhonesForHubSpot(contactId: string): Promise<RevealedPhoneForHubSpot[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contact_phones')
    .select(CONTACT_PHONES_FOR_HUBSPOT_SELECT)
    .eq('contact_id', contactId)
    .is('suppressed_at', null)
    .order('is_primary', { ascending: false })
    .order('first_seen_at', { ascending: true });
  if (error || !Array.isArray(data)) throw new Error('contact phones read failed');
  const phones: RevealedPhoneForHubSpot[] = [];
  for (const row of data as Record<string, unknown>[]) {
    if (row.phone_status === 'invalid') continue;
    const value =
      (typeof row.display_phone === 'string' && row.display_phone.trim()) ||
      (typeof row.normalized_phone === 'string' && row.normalized_phone.trim()) ||
      null;
    if (!value) continue;
    phones.push({ phone: value, type: typeof row.phone_type === 'string' ? row.phone_type : null });
  }
  return phones;
}

