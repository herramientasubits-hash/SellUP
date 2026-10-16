/**
 * hubspot-free-company-claim.server.ts — ESCRITURA en HubSpot al tomar una empresa
 * libre (HUBSPOT-FREE-POOL-SOURCE-1). Sólo la llama la aprobación, y sólo con
 * `ENABLE_HUBSPOT_FREE_POOL_OWNER_WRITEBACK` (decisión de la dueña, 15-10):
 *
 *   · empresa: dueño = vendedor y estado de lead «New» (HubSpot pone solo la Fecha
 *     Asignación al cambiar el dueño);
 *   · contactos asociados: pasan al vendedor los sin dueño, de bolsa, de dueño
 *     desactivado o del dueño anterior; los de OTRO vendedor activo no se tocan.
 *
 * Permisos verificados el 15-10: crm.objects.companies.write y contacts.write.
 * Nunca lanza: devuelve lo que pasó, con causas, para la metadata de la cuenta.
 */

import { getHubSpotToken } from './hubspot-company-create';
import {
  buildHubSpotClaimProperties,
  selectContactsToReassign,
  type HubSpotContactOwner,
} from './hubspot-free-company-policy';
import { loadHubSpotOwnerDirectory, type HubSpotFetch } from './hubspot-free-company-pool.server';
import { fetchHubSpotWithRetry } from './hubspot-rate-limit';

const HUBSPOT_API = 'https://api.hubapi.com';
const TIMEOUT_MS = 10_000;
const BATCH_SIZE = 100;
/** Contactos por empresa como máximo (la más documentada medida tiene 79). */
const MAX_CONTACTS = 2_000;

export type HubSpotClaimResult = {
  companyWritten: boolean;
  companyError: string | null;
  previousOwnerId: string | null;
  contacts: {
    associated: number;
    reassigned: number;
    keptOtherActiveOwner: number;
    alreadyOwned: number;
    failed: number;
    error: string | null;
  };
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function readCompanyOwner(token: string, companyId: string, fetchFn: HubSpotFetch): Promise<string | null> {
  const res = await fetchHubSpotWithRetry(
    `${HUBSPOT_API}/crm/v3/objects/companies/${encodeURIComponent(companyId)}?properties=hubspot_owner_id`,
    { headers: { Authorization: `Bearer ${token}` } },
    TIMEOUT_MS,
    { fetchFn },
  );
  if (!res.ok) throw new Error(`company_read_http_${res.status}`);
  const body = (await res.json()) as { properties?: { hubspot_owner_id?: string | null } };
  const owner = body.properties?.hubspot_owner_id;
  return typeof owner === 'string' && owner.trim() !== '' ? owner.trim() : null;
}

async function listAssociatedContactIds(token: string, companyId: string, fetchFn: HubSpotFetch): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const url = `${HUBSPOT_API}/crm/v4/objects/companies/${encodeURIComponent(companyId)}/associations/contacts?limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const res = await fetchHubSpotWithRetry(url, { headers: { Authorization: `Bearer ${token}` } }, TIMEOUT_MS, { fetchFn });
    if (!res.ok) throw new Error(`associations_http_${res.status}`);
    const body = (await res.json()) as { results?: Array<{ toObjectId: string | number }>; paging?: { next?: { after?: string } } };
    ids.push(...(body.results ?? []).map((row) => String(row.toObjectId)));
    after = body.paging?.next?.after;
  } while (after && ids.length < MAX_CONTACTS);
  return [...new Set(ids)].slice(0, MAX_CONTACTS);
}

async function readContactOwners(token: string, ids: readonly string[], fetchFn: HubSpotFetch): Promise<HubSpotContactOwner[]> {
  const out: HubSpotContactOwner[] = [];
  for (const group of chunk(ids, BATCH_SIZE)) {
    const res = await fetchHubSpotWithRetry(
      `${HUBSPOT_API}/crm/v3/objects/contacts/batch/read`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: ['hubspot_owner_id'], inputs: group.map((id) => ({ id })) }),
      },
      TIMEOUT_MS,
      { fetchFn },
    );
    if (!res.ok) throw new Error(`contacts_read_http_${res.status}`);
    const body = (await res.json()) as { results?: Array<{ id: string; properties?: { hubspot_owner_id?: string | null } }> };
    for (const row of body.results ?? []) out.push({ id: String(row.id), ownerId: row.properties?.hubspot_owner_id ?? null });
  }
  return out;
}

async function updateContactOwners(
  token: string,
  ids: readonly string[],
  ownerId: string,
  fetchFn: HubSpotFetch,
): Promise<{ updated: number; failed: number; error: string | null }> {
  let updated = 0;
  let failed = 0;
  let error: string | null = null;
  for (const group of chunk(ids, BATCH_SIZE)) {
    const res = await fetchHubSpotWithRetry(
      `${HUBSPOT_API}/crm/v3/objects/contacts/batch/update`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: group.map((id) => ({ id, properties: { hubspot_owner_id: ownerId } })) }),
      },
      TIMEOUT_MS,
      { fetchFn },
    );
    if (res.ok) {
      updated += group.length;
    } else {
      failed += group.length;
      error ??= `contacts_update_http_${res.status}`;
    }
  }
  return { updated, failed, error };
}

/** Toma la empresa en HubSpot para el vendedor. Nunca lanza. */
export async function claimHubSpotCompanyForOwner(
  input: { hubspotCompanyId: string; newOwnerId: string },
  options: { fetchFn?: HubSpotFetch; resolveToken?: () => Promise<string | null> } = {},
): Promise<HubSpotClaimResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const result: HubSpotClaimResult = {
    companyWritten: false,
    companyError: null,
    previousOwnerId: null,
    contacts: { associated: 0, reassigned: 0, keptOtherActiveOwner: 0, alreadyOwned: 0, failed: 0, error: null },
  };
  const token = await (options.resolveToken ?? getHubSpotToken)().catch(() => null);
  if (!token) return { ...result, companyError: 'token_unavailable' };

  try {
    result.previousOwnerId = await readCompanyOwner(token, input.hubspotCompanyId, fetchFn);
    const res = await fetchHubSpotWithRetry(
      `${HUBSPOT_API}/crm/v3/objects/companies/${encodeURIComponent(input.hubspotCompanyId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: buildHubSpotClaimProperties(input.newOwnerId) }),
      },
      TIMEOUT_MS,
      { fetchFn },
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      console.error('[hubspot-free-pool] no se pudo tomar la empresa en HubSpot:', res.status, detail);
      return { ...result, companyError: `company_update_http_${res.status}` };
    }
    result.companyWritten = true;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
    console.error('[hubspot-free-pool] no se pudo tomar la empresa en HubSpot:', message);
    return { ...result, companyError: message };
  }

  // Contactos: un fallo aquí NO deshace la toma de la empresa; queda registrado.
  try {
    const owners = await loadHubSpotOwnerDirectory(token, { fetchFn });
    if (!owners) throw new Error('owner_directory_unavailable');
    const ids = await listAssociatedContactIds(token, input.hubspotCompanyId, fetchFn);
    const contacts = await readContactOwners(token, ids, fetchFn);
    const plan = selectContactsToReassign(contacts, owners, result.previousOwnerId, input.newOwnerId);
    const update = await updateContactOwners(token, plan.reassign, input.newOwnerId, fetchFn);
    result.contacts = {
      associated: ids.length,
      reassigned: update.updated,
      keptOtherActiveOwner: plan.keptOtherActiveOwner.length,
      alreadyOwned: plan.alreadyOwned,
      failed: update.failed,
      error: update.error,
    };
    if (update.error) console.error('[hubspot-free-pool] contactos sin reasignar:', update.error);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
    console.error('[hubspot-free-pool] contactos sin reasignar:', message);
    result.contacts = { ...result.contacts, error: message };
  }
  return result;
}
