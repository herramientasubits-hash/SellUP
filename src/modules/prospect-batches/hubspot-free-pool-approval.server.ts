/**
 * hubspot-free-pool-approval.server.ts — las puertas reales del paso de aprobación
 * de una empresa libre de HubSpot (HUBSPOT-FREE-POOL-SOURCE-1).
 *
 * Lectura: el chequeo de duplicados de HubSpot de siempre y la regla leída en ese
 * momento. Escritura (sólo con `ENABLE_HUBSPOT_FREE_POOL_OWNER_WRITEBACK`): dueño,
 * estado de lead, Fecha Asignación y contactos. Nunca lanza: HubSpot nunca rompe la
 * aprobación en SellUp.
 */

import { isHubSpotFreePoolEnabled, isHubSpotFreePoolOwnerWritebackEnabled } from '@/lib/feature-flags.server';
import { findHubSpotOwnerByEmail, getHubSpotToken } from '@/server/integrations/hubspot-company-create';
import { checkHubSpotDuplicates } from '@/server/agents/prospecting-toolkit/hubspot-duplicate-checker';
import { isStrongHubSpotIdentityMatch } from '@/server/agents/prospecting-toolkit/hubspot-free-match';
import { claimHubSpotCompanyForOwner } from '@/server/integrations/hubspot-free-company-claim.server';
import { readHubSpotCompanyAvailabilityById } from '@/server/integrations/hubspot-free-company-pool.server';
import {
  decideFreePoolOwnerWrite,
  resolveFreePoolApprovalLink,
  resolveSellerHubSpotOwner,
  type FreePoolApprovalInput,
  type FreePoolApprovalLink,
  type StrongHubSpotIdentity,
} from './hubspot-free-pool-approval';

/** Las fichas de HubSpot que son la MISMA empresa, libres o no. `null` ⇒ HubSpot no respondió. */
async function findStrongHubSpotIdentities(input: {
  name: string;
  domain: string | null;
  taxIdentifier: string | null;
  countryCode: string | null;
}): Promise<StrongHubSpotIdentity[] | null> {
  const outcome = await checkHubSpotDuplicates({
    name: input.name,
    domain: input.domain ?? undefined,
    taxIdentifier: input.taxIdentifier ?? undefined,
    countryCode: input.countryCode ?? undefined,
  });
  if (!outcome.connected || ('error' in outcome && outcome.error)) return null;
  return outcome.matches
    .filter((match) => match.hubspotFreeToTake || isStrongHubSpotIdentityMatch(match))
    .map((match) => ({
      hubspotCompanyId: (match.hubspotFreeToTake?.hubspotCompanyId ?? match.matchedId) as string,
      freeReason: match.hubspotFreeToTake?.reason ?? null,
    }));
}

/** La ficha libre a enlazar al aprobar. `null` con la bandera apagada. */
export async function resolveLiveFreePoolApprovalLink(input: FreePoolApprovalInput): Promise<FreePoolApprovalLink | null> {
  if (!isHubSpotFreePoolEnabled()) return null;
  return resolveFreePoolApprovalLink(input, {
    findStrongHubSpotIdentities,
    readLiveAvailability: (id) => readHubSpotCompanyAvailabilityById(id),
  }).catch((err): FreePoolApprovalLink => {
    // Un tropiezo NO puede terminar en «crear»: se manda a revisión.
    console.error('[hubspot-free-pool] resolución al aprobar falló:', err);
    return { kind: 'lookup_failed', stage: 'domain_search' };
  });
}

/**
 * Pone al vendedor como dueño en HubSpot si la regla lo permite. Devuelve lo que
 * pasó, para la metadata de la cuenta (auditoría).
 */
export async function claimFreePoolCompanyForSeller(input: {
  link: Extract<FreePoolApprovalLink, { kind: 'link' }>;
  resolveSellerHubSpotOwnerId: () => Promise<string | null>;
  nowIso: string;
}): Promise<Record<string, unknown>> {
  const base = {
    company_id: input.link.hubspotCompanyId,
    source: input.link.source,
    free_reason_at_approval: input.link.availability?.free ? input.link.availability.reason : null,
    taken_reason_at_approval: input.link.availability && !input.link.availability.free ? input.link.availability.reason : null,
    checked_at: input.nowIso,
  };
  const writebackEnabled = isHubSpotFreePoolOwnerWritebackEnabled();
  let ownerLookupError: string | null = null;
  const sellerHubSpotOwnerId =
    writebackEnabled && input.link.availability?.free
      ? await input.resolveSellerHubSpotOwnerId().catch((err) => {
          ownerLookupError = err instanceof Error ? err.message.slice(0, 200) : String(err);
          return null;
        })
      : null;
  if (ownerLookupError) {
    console.error('[hubspot-free-pool] no se pudo leer el dueño de HubSpot del vendedor:', ownerLookupError);
    return { ...base, owner_written: false, owner_skip_reason: 'owner_lookup_failed', owner_error: ownerLookupError };
  }
  const decision = decideFreePoolOwnerWrite({
    writebackEnabled,
    availability: input.link.availability,
    sellerHubSpotOwnerId,
  });
  if (!decision.write) return { ...base, owner_written: false, owner_skip_reason: decision.reason };
  // Dueño + estado de lead «New» + Fecha Asignación, y los contactos al vendedor.
  const claim = await claimHubSpotCompanyForOwner({
    hubspotCompanyId: input.link.hubspotCompanyId,
    newOwnerId: decision.hubspotOwnerId,
    now: new Date(input.nowIso),
  });
  return {
    ...base,
    owner_written: claim.companyWritten,
    owner_id: decision.hubspotOwnerId,
    previous_owner_id: claim.previousOwnerId,
    ...(claim.companyError ? { owner_error: claim.companyError } : {}),
    contacts: claim.contacts,
  };
}

/**
 * El dueño de HubSpot del vendedor: mapeo y, si no está, su correo en HubSpot. Un
 * fallo de lectura se informa (la toma se salta con `owner_lookup_failed`).
 */
export async function resolveLiveSellerHubSpotOwnerId(
  email: string | null | undefined,
  findMappedOwnerId: (email: string) => Promise<string | null>,
): Promise<string | null> {
  const resolution = await resolveSellerHubSpotOwner(email, {
    findMappedOwnerId,
    findHubSpotOwnerIdByEmail: async (clean) => {
      const token = await getHubSpotToken();
      if (!token) throw new Error('hubspot_token_unavailable');
      return (await findHubSpotOwnerByEmail(clean, token))?.id ?? null;
    },
  });
  return resolution.ownerId;
}
