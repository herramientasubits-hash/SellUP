// HUBSPOT-ACCOUNT-SYNC-1 — Copiar la ficha de HubSpot a una empresa de SellUp
//
// Cableado de E/S del núcleo `hubspot-company-profile-mapping`: lee la ficha en HubSpot
// (solo lectura), resuelve el dueño de HubSpot a un usuario de SellUp por correo y completa
// la empresa SIN pisar lo que ya tiene. Lo usan los tres caminos que crean o vinculan una
// empresa con HubSpot: Agente 2 (buscar contactos), aprobación del Agente 1 cuando la
// empresa ya existía en HubSpot, y el script de completado de empresas existentes.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getHubSpotCompanyProfileById } from '@/server/integrations/hubspot-company-search';
import { mapCountryToCode } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import {
  HUBSPOT_COMPANY_PROFILE_PROPERTIES,
  buildAccountFillPatch,
  decideAccountOwner,
  mapHubSpotCompanyProfile,
  type AccountFillPatch,
  type AccountOwnerSource,
  type HubSpotCompanyProfileMapping,
} from './hubspot-company-profile-mapping';

export type HubSpotAccountProfileLoad =
  | { status: 'found'; mapping: HubSpotCompanyProfileMapping; hubspotOwnerUserId: string | null }
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: string };

/** Usuario activo de SellUp con ese correo (el dueño de HubSpot), o `null`. */
export async function findActiveInternalUserIdByEmail(
  admin: SupabaseClient,
  email: string | null,
): Promise<string | null> {
  if (!email) return null;
  const { data, error } = await admin
    .from('internal_users')
    .select('id')
    .ilike('email', email.trim())
    .eq('access_status', 'active')
    .is('archived_at', null)
    .is('suspended_at', null)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[hubspot-company-profile-sync] internal user lookup failed', { error: error.message });
    return null;
  }
  return (data?.id as string | undefined) ?? null;
}

/** Lee la ficha de HubSpot y la traduce. Nunca escribe en HubSpot. */
export async function loadHubSpotAccountProfile(
  admin: SupabaseClient,
  hubspotCompanyId: string,
): Promise<HubSpotAccountProfileLoad> {
  const result = await getHubSpotCompanyProfileById(hubspotCompanyId, HUBSPOT_COMPANY_PROFILE_PROPERTIES);
  if (result.status !== 'found') return result;
  const mapping = mapHubSpotCompanyProfile(result.properties, mapCountryToCode);
  const hubspotOwnerUserId = await findActiveInternalUserIdByEmail(admin, mapping.hubspotOwnerEmail);
  return { status: 'found', mapping, hubspotOwnerUserId };
}

export interface AccountProfileSnapshot {
  id: string;
  owner_id: string | null;
  domain: string | null;
  website: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  company_size: string | null;
  tax_identifier: string | null;
  linkedin_url: string | null;
  metadata: Record<string, unknown> | null;
}

export const ACCOUNT_PROFILE_SNAPSHOT_SELECT =
  'id, owner_id, domain, website, country, country_code, city, region, industry, company_size, tax_identifier, linkedin_url, metadata';

export interface AccountProfileUpdate {
  patch: AccountFillPatch & { owner_id?: string };
  ownerSource: AccountOwnerSource | null;
}

/**
 * Qué escribir en la empresa: lo vacío que HubSpot completa y, si no tiene responsable,
 * el dueño de HubSpot o quien buscó (ver `decideAccountOwner`).
 */
export function buildAccountProfileUpdate(
  account: AccountProfileSnapshot,
  profile: Extract<HubSpotAccountProfileLoad, { status: 'found' }> | null,
  searcherUserId: string | null,
): AccountProfileUpdate {
  const fill = profile ? buildAccountFillPatch(account, profile.mapping.fields) : {};
  if (account.owner_id) return { patch: fill, ownerSource: null };
  const owner = decideAccountOwner({
    hubspotOwnerUserId: profile?.hubspotOwnerUserId ?? null,
    searcherUserId,
  });
  return {
    patch: owner.ownerId ? { ...fill, owner_id: owner.ownerId } : fill,
    ownerSource: owner.source,
  };
}

export interface SyncAccountFromHubSpotResult {
  status: 'updated' | 'unchanged' | 'not_found' | 'unavailable' | 'account_unavailable';
  columns: string[];
  ownerSource: AccountOwnerSource | null;
}

/**
 * Completa una empresa de SellUp con su ficha de HubSpot y le pone responsable.
 * Fail-soft: si HubSpot no responde, igual asigna a quien buscó.
 */
export async function syncAccountFromHubSpotProfile(
  admin: SupabaseClient,
  input: { accountId: string; hubspotCompanyId: string | null; searcherUserId: string | null; actorUserId: string | null; nowIso: string },
): Promise<SyncAccountFromHubSpotResult> {
  const { data, error } = await admin
    .from('accounts')
    .select(ACCOUNT_PROFILE_SNAPSHOT_SELECT)
    .eq('id', input.accountId)
    .maybeSingle();
  if (error || !data) return { status: 'account_unavailable', columns: [], ownerSource: null };
  const account = data as unknown as AccountProfileSnapshot;

  const load = input.hubspotCompanyId
    ? await loadHubSpotAccountProfile(admin, input.hubspotCompanyId)
    : null;
  const profile = load?.status === 'found' ? load : null;
  const { patch, ownerSource } = buildAccountProfileUpdate(account, profile, input.searcherUserId);
  const columns = Object.keys(patch);

  if (columns.length === 0) {
    const status = load && load.status !== 'found' ? load.status : 'unchanged';
    return { status, columns, ownerSource };
  }

  const { error: updateError } = await admin
    .from('accounts')
    .update({
      ...patch,
      ...(input.actorUserId ? { updated_by: input.actorUserId } : {}),
      metadata: {
        ...(account.metadata ?? {}),
        hubspot_profile_sync: {
          synced_at: input.nowIso,
          hubspot_company_id: input.hubspotCompanyId,
          profile_status: load?.status ?? 'no_hubspot_id',
          filled_columns: columns,
          owner_source: ownerSource,
        },
      },
    })
    .eq('id', input.accountId);
  if (updateError) {
    console.error('[hubspot-company-profile-sync] account update failed', {
      accountId: input.accountId,
      error: updateError.message,
    });
    return { status: 'account_unavailable', columns: [], ownerSource: null };
  }
  return { status: 'updated', columns, ownerSource };
}
