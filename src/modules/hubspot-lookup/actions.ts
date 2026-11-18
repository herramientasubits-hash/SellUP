'use server';

/**
 * Consulta de HubSpot desde SellUp — «Traer a SellUp» (dueña 17-11).
 *
 * Crea la empresa —y el contacto— en SellUp, vinculados a HubSpot, con la misma
 * resolución que ya usan los agentes (por Company ID, luego por dominio, y si no,
 * nueva). Lo usan el botón «Traer a SellUp» y, antes de seguir, «Buscar contactos» y
 * «Preparar primer contacto» desde una ficha que sólo estaba en HubSpot.
 *
 *  - No escribe en HubSpot.
 *  - Si ya está en SellUp y la lleva alguien fuera del alcance de quien pide, no se
 *    duplica ni se le quita: se dice quién la lleva.
 *
 * Las LECTURAS (buscar, ver, actividad) van por `/api/hubspot-lookup` (`lookup.server.ts`).
 */

import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { canActOnAccount, canActOnContact } from '@/modules/access/record-scope.server';
import { resolveAccountForEnrichmentRequest } from '@/modules/contact-enrichment/request-account-resolution-core';
import { importHubSpotContactAsApprovedCandidate } from '@/modules/contact-enrichment/hubspot-contact-import.server';
import { missingChannelsLabel } from '@/modules/contact-enrichment/hubspot-contact-import-core';
import { buildHubSpotAccountResolutionDeps } from '@/server/agents/contact-enrichment-toolkit/hubspot-account-resolution-deps';
import { mapCountryToCode } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import {
  isHubSpotObjectId,
  type HubSpotCompanyView,
  type HubSpotContactView,
  type SellUpPresence,
} from '@/server/integrations/hubspot-lookup/hubspot-lookup-core';
import { readHubSpotCompany, readHubSpotContact } from '@/server/integrations/hubspot-lookup/hubspot-lookup.server';
import { lookupUnavailable } from './lookup.server';
import { sellUpPresenceForCompanies, sellUpPresenceForContacts, sellUpPresenceForDomain } from './presence.server';
import type { ImportHubSpotCompanyResult, ImportHubSpotContactResult } from './types';

const NONE: SellUpPresence = { status: 'none' };
const HUBSPOT_DOWN = 'HubSpot no respondió. Vuelve a intentarlo en un momento.';

async function currentInternalUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

function otherOwnerError(name: string | null): string {
  return name
    ? `Esa empresa ya está en SellUp y la lleva ${name}. Pídele que te la asigne.`
    : 'Esa empresa ya está en SellUp y la lleva otra persona. Pide que te la asignen.';
}

async function importCompany(userId: string, hubspotCompanyId: string): Promise<ImportHubSpotCompanyResult> {
  let company: HubSpotCompanyView | null;
  try {
    company = await readHubSpotCompany(hubspotCompanyId);
  } catch (error) {
    lookupUnavailable(error, 'traer empresa');
    return { success: false, error: HUBSPOT_DOWN };
  }
  if (!company) return { success: false, error: 'Esa empresa ya no existe en HubSpot.' };

  // Ya está en SellUp: se abre la de siempre (o se dice quién la lleva). Nunca se duplica.
  const existing = (await sellUpPresenceForCompanies([hubspotCompanyId])).get(hubspotCompanyId) ?? NONE;
  if (existing.status === 'visible') return { success: true, accountId: existing.id, created: false };
  if (existing.status === 'other_owner') return { success: false, error: otherOwnerError(existing.ownerName) };

  // La misma empresa por dominio (sin el ID de HubSpot): si la lleva otra persona, se dice
  // ANTES de tocarla (la resolución le pondría el vínculo y completaría su ficha).
  if (company.domain) {
    const byDomain = await sellUpPresenceForDomain(company.domain);
    if (byDomain.status === 'other_owner') return { success: false, error: otherOwnerError(byDomain.ownerName) };
  }

  const resolution = await resolveAccountForEnrichmentRequest(
    {
      source: 'hubspot',
      sellupAccountId: null,
      hubspotCompanyId,
      name: company.name,
      domain: company.domain,
      countryCode: mapCountryToCode(company.country),
    },
    buildHubSpotAccountResolutionDeps(createSupabaseAdminClient(), userId, 'hubspot_lookup_import'),
  );
  if (!resolution.accountId) {
    console.error('[hubspot-lookup] traer empresa falló:', 'reason' in resolution ? resolution.reason : resolution.outcome);
    return { success: false, error: 'No pudimos traer la empresa a SellUp. Vuelve a intentarlo.' };
  }
  // Se vinculó por dominio a una empresa de otra persona: no se le quita.
  if (!(await canActOnAccount(resolution.accountId))) {
    const again = (await sellUpPresenceForCompanies([hubspotCompanyId])).get(hubspotCompanyId);
    return { success: false, error: otherOwnerError(again?.status === 'other_owner' ? again.ownerName : null) };
  }
  return { success: true, accountId: resolution.accountId, created: resolution.outcome === 'created' };
}

/** Trae la empresa de HubSpot a SellUp (o devuelve la que ya estaba). */
export async function importHubSpotCompany(hubspotCompanyId: string): Promise<ImportHubSpotCompanyResult> {
  const userId = await currentInternalUserId();
  if (!userId) return { success: false, error: 'Tu sesión se cerró. Vuelve a iniciar sesión.' };
  if (!isHubSpotObjectId(hubspotCompanyId)) return { success: false, error: 'Esa empresa de HubSpot no es válida.' };
  return importCompany(userId, hubspotCompanyId);
}

/** El contacto ya está en SellUp: el que se puede abrir, o por qué no. */
async function existingContact(
  hubspotContactId: string,
): Promise<ImportHubSpotContactResult | null> {
  const already = (await sellUpPresenceForContacts([hubspotContactId])).get(hubspotContactId) ?? NONE;
  if (already.status === 'none') return null;
  if (already.status === 'other_owner') {
    return {
      success: false,
      error: already.ownerName
        ? `Ese contacto ya está en SellUp, en una empresa que lleva ${already.ownerName}.`
        : 'Ese contacto ya está en SellUp, en una empresa que lleva otra persona.',
    };
  }
  const { data } = await createSupabaseAdminClient().from('contacts').select('account_id').eq('id', already.id).maybeSingle();
  const accountId = (data as { account_id: string } | null)?.account_id;
  if (!accountId || !(await canActOnContact(already.id))) return null;
  return { success: true, accountId, contactId: already.id, created: false };
}

/**
 * Lo que le falta al contacto ya guardado («correo · teléfono»), para el aviso. El teléfono se
 * mira en `phone`: la aprobación proyecta ahí el principal (y nunca escribe el celular).
 */
async function missingOnContact(contactId: string): Promise<string | null> {
  const { data } = await createSupabaseAdminClient()
    .from('contacts')
    .select('email, linkedin_url, phone')
    .eq('id', contactId)
    .maybeSingle();
  if (!data) return null;
  const r = data as { email: string | null; linkedin_url: string | null; phone: string | null };
  return missingChannelsLabel({ email: r.email, linkedinUrl: r.linkedin_url, hasPhone: Boolean(r.phone?.trim()) });
}

/**
 * Trae el contacto de HubSpot a SellUp, con su empresa. Si el contacto ya está (por su
 * Contact ID o por su correo en esa empresa), se usa el que estaba y se le pone el vínculo.
 *
 * `hubspotCompanyId`: la empresa desde cuya ficha se trae. Un contacto de HubSpot puede
 * estar asociado a varias; queda en la que se estaba mirando, no en su «principal».
 * `sellupAccountId`: la empresa de SellUp abierta (si se trae desde su ficha): queda ahí.
 */
export async function importHubSpotContact(
  hubspotContactId: string,
  hubspotCompanyId?: string | null,
  sellupAccountId?: string | null,
): Promise<ImportHubSpotContactResult> {
  const userId = await currentInternalUserId();
  if (!userId) return { success: false, error: 'Tu sesión se cerró. Vuelve a iniciar sesión.' };
  if (!isHubSpotObjectId(hubspotContactId)) return { success: false, error: 'Ese contacto de HubSpot no es válido.' };

  const already = await existingContact(hubspotContactId);
  if (already) return already;

  let contact: HubSpotContactView | null;
  try {
    contact = await readHubSpotContact(hubspotContactId);
  } catch (error) {
    lookupUnavailable(error, 'traer contacto');
    return { success: false, error: HUBSPOT_DOWN };
  }
  if (!contact) return { success: false, error: 'Ese contacto ya no existe en HubSpot.' };
  const companyId = isHubSpotObjectId(hubspotCompanyId) ? hubspotCompanyId : contact.companyId;
  if (!companyId) {
    return { success: false, error: 'Este contacto no tiene empresa en HubSpot. Asócialo a su empresa en HubSpot y vuelve a intentarlo.' };
  }

  let accountId: string;
  if (sellupAccountId && (await canActOnAccount(sellupAccountId))) {
    accountId = sellupAccountId;
  } else {
    const company = await importCompany(userId, companyId);
    if (!company.success) return company;
    accountId = company.accountId;
  }

  // AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE (Bryan 17-11): el contacto entra como un candidato
  // de HubSpot aprobado al instante, para que su ficha pueda revelar correo, LinkedIn y teléfono
  // (y enviarlos a HubSpot). Si ya esperaba en «Por revisar», se aprueba ése.
  const saved = await importHubSpotContactAsApprovedCandidate({
    accountId,
    triggeredBy: userId,
    contact: {
      hubspotContactId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName,
      email: contact.email,
      linkedinUrl: contact.linkedinUrl,
      jobTitle: contact.jobTitle,
    },
  });
  if (!saved.ok) {
    console.error('[hubspot-lookup] crear contacto falló:', saved.error);
    return { success: false, error: saved.error };
  }
  return {
    success: true,
    accountId,
    contactId: saved.contactId,
    created: saved.created,
    missing: await missingOnContact(saved.contactId),
    approvedFromReview: saved.via === 'pending_candidate_approved',
  };
}
