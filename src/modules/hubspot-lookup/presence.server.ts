/**
 * ¿Está ya en SellUp este registro de HubSpot, y lo puede abrir quien mira?
 *
 * Lee con el cliente de servicio (hay que saber si existe aunque lo lleve otra persona)
 * y aplica la misma regla de alcance que las listas (`currentScopeUserIds`).
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { anyInScope, currentScopeUserIds } from '@/modules/access/record-scope.server';
import { loadDirectoryNames } from '@/modules/access/user-directory.server';
import {
  decideSellUpPresence,
  type SellUpPresence,
  type SellUpRecordRow,
} from '@/server/integrations/hubspot-lookup/hubspot-lookup-core';

type AccountRow = { id: string; owner_id: string | null; created_by: string | null; hubspot_company_id: string | null };
type ContactRow = { id: string; hubspot_contact_id: string | null; account: { owner_id: string | null; created_by: string | null } | null };

async function withOwnerNames<T extends { owner_id: string | null }>(rows: readonly T[]): Promise<Map<string, string>> {
  try {
    return await loadDirectoryNames(rows.map((r) => r.owner_id));
  } catch {
    return new Map();
  }
}

/** Presencia en SellUp de varias empresas de HubSpot (clave: Company ID). */
export async function sellUpPresenceForCompanies(hubspotCompanyIds: readonly string[]): Promise<Map<string, SellUpPresence>> {
  const out = new Map<string, SellUpPresence>();
  if (hubspotCompanyIds.length === 0) return out;
  const { data, error } = await createSupabaseAdminClient()
    .from('accounts')
    .select('id, owner_id, created_by, hubspot_company_id')
    .in('hubspot_company_id', [...hubspotCompanyIds])
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`sellUpPresenceForCompanies: ${error.message}`);
  const rows = (data ?? []) as AccountRow[];
  const [scopeIds, names] = await Promise.all([currentScopeUserIds(), withOwnerNames(rows)]);
  for (const id of hubspotCompanyIds) {
    const matching: SellUpRecordRow[] = rows
      .filter((r) => r.hubspot_company_id === id)
      .map((r) => ({ id: r.id, owner_id: r.owner_id, created_by: r.created_by, owner_name: r.owner_id ? names.get(r.owner_id) ?? null : null }));
    out.set(id, decideSellUpPresence(matching, (r) => anyInScope(scopeIds, [r.owner_id, r.created_by])));
  }
  return out;
}

/** Presencia en SellUp de varios contactos de HubSpot (clave: Contact ID). Va con su empresa. */
export async function sellUpPresenceForContacts(hubspotContactIds: readonly string[]): Promise<Map<string, SellUpPresence>> {
  const out = new Map<string, SellUpPresence>();
  if (hubspotContactIds.length === 0) return out;
  const { data, error } = await createSupabaseAdminClient()
    .from('contacts')
    .select('id, hubspot_contact_id, account:accounts(owner_id, created_by)')
    .in('hubspot_contact_id', [...hubspotContactIds])
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`sellUpPresenceForContacts: ${error.message}`);
  const rows = ((data ?? []) as unknown as ContactRow[]).map((r) => ({
    id: r.id,
    hubspot_contact_id: r.hubspot_contact_id,
    owner_id: r.account?.owner_id ?? null,
    created_by: r.account?.created_by ?? null,
  }));
  const [scopeIds, names] = await Promise.all([currentScopeUserIds(), withOwnerNames(rows)]);
  for (const id of hubspotContactIds) {
    const matching: SellUpRecordRow[] = rows
      .filter((r) => r.hubspot_contact_id === id)
      .map((r) => ({ id: r.id, owner_id: r.owner_id, created_by: r.created_by, owner_name: r.owner_id ? names.get(r.owner_id) ?? null : null }));
    out.set(id, decideSellUpPresence(matching, (r) => anyInScope(scopeIds, [r.owner_id, r.created_by])));
  }
  return out;
}

/**
 * Presencia en SellUp de una empresa por su dominio (la que la resolución vincularía al
 * traerla si no tiene el ID de HubSpot). Se mira ANTES de traer: si la lleva alguien
 * fuera del alcance de quien pide, no se toca.
 */
export async function sellUpPresenceForDomain(domain: string): Promise<SellUpPresence> {
  const { data, error } = await createSupabaseAdminClient()
    .from('accounts')
    .select('id, owner_id, created_by')
    .eq('domain', domain.trim().toLowerCase())
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`sellUpPresenceForDomain: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; owner_id: string | null; created_by: string | null }>;
  if (rows.length === 0) return { status: 'none' };
  const [scopeIds, names] = await Promise.all([currentScopeUserIds(), withOwnerNames(rows)]);
  return decideSellUpPresence(
    rows.map((r) => ({ ...r, owner_name: r.owner_id ? names.get(r.owner_id) ?? null : null })),
    (r) => anyInScope(scopeIds, [r.owner_id, r.created_by]),
  );
}
