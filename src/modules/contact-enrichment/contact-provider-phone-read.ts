// Agente 2A — LECTURAS de teléfonos del contacto oficial: el escalar (arranque de la colección
// legacy), el número de proveedor más reciente y los números que viajan tras fusionar en HubSpot
// (AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE). Sólo LEE `contact_phones` y su procedencia: no
// escribe ningún teléfono ni ninguna procedencia. Vive aparte del escritor de `metadata` (mismo
// patrón que `contact-phones-for-hubspot-read.ts`). Service role: también corre sin sesión.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { loadContactRevealedPhonesForHubSpot } from '@/modules/contacts/contact-phones-for-hubspot-read';
import type { RevealedPhoneForHubSpot } from '@/modules/contacts/contact-hubspot-sync-core';
import {
  legacyPhoneSourceFromPair,
  type LegacyContactScalar,
  type ProviderPhoneRow,
} from './legacy-contact-phone-bootstrap-core';

type Embedded<T> = T | T[] | null | undefined;
function one<T>(value: Embedded<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** El número de proveedor más reciente de la colección viva del contacto. */
export async function readNewestProviderPhone(contactId: string): Promise<ProviderPhoneRow | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('contact_phones')
    .select('display_phone, normalized_phone, phone_type, last_seen_at, sources:contact_phone_sources ( provider, acquisition_mode, observed_at, suppressed_at )')
    .eq('contact_id', contactId)
    .is('suppressed_at', null)
    .order('last_seen_at', { ascending: false });
  if (error || !Array.isArray(data)) return null;
  for (const row of data as Record<string, unknown>[]) {
    const sources = (Array.isArray(row.sources) ? row.sources : []).filter(isRecord).filter((s) => !s.suppressed_at);
    const provider = sources
      .map((s) => ({ source: legacyPhoneSourceFromPair(str(s.provider), str(s.acquisition_mode)), observedAt: str(s.observed_at) }))
      .find((s) => s.source !== null);
    if (!provider) continue;
    const number = str(row.display_phone) ?? str(row.normalized_phone);
    if (!number) continue;
    return { number, type: str(row.phone_type), source: provider.source, observedAt: provider.observedAt ?? str(row.last_seen_at) };
  }
  return null;
}

/** El escalar del contacto (y el país de su cuenta, para normalizar el número). Sólo LEE. */
export async function readLegacyContactScalar(contactId: string): Promise<LegacyContactScalar | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('contacts')
    .select('phone, phone_type, account:account_id ( country_code )')
    .eq('id', contactId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const account = one(row.account as Embedded<{ country_code?: unknown }>);
  return { phone: str(row.phone), phoneType: str(row.phone_type), countryCode: str(account?.country_code) };
}

/**
 * Números del contacto para la fusión en HubSpot: la colección oficial y, si está vacía, el
 * escalar `phone`. Sólo LEE.
 */
export async function loadContactPhonesForHubSpotMerge(contactId: string): Promise<RevealedPhoneForHubSpot[]> {
  let phones: RevealedPhoneForHubSpot[] = [];
  try {
    phones = await loadContactRevealedPhonesForHubSpot(contactId);
  } catch {
    phones = [];
  }
  if (phones.length > 0) return phones;
  const { data } = await createSupabaseAdminClient().from('contacts').select('phone').eq('id', contactId).maybeSingle();
  const scalar = str((data as { phone?: unknown } | null)?.phone);
  return scalar ? [{ phone: scalar }] : [];
}
