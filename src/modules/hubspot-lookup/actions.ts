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
import { logContactAudit } from '@/modules/contacts/contact-audit.server';
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

/** Un contacto con ese correo en la empresa: se le pone el vínculo en vez de duplicarlo. */
async function linkByEmail(userId: string, accountId: string, contact: HubSpotContactView): Promise<string | null> {
  if (!contact.email) return null;
  const admin = createSupabaseAdminClient();
  // Sin comodines: «ana_p@x.com» no debe encontrar a «anaxp@x.com».
  const exactEmail = contact.email.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const { data } = await admin
    .from('contacts')
    .select('id, hubspot_contact_id')
    .eq('account_id', accountId)
    .ilike('email', exactEmail)
    .is('archived_at', null)
    .limit(1);
  const match = (data ?? [])[0] as { id: string; hubspot_contact_id: string | null } | undefined;
  if (!match) return null;
  if (!match.hubspot_contact_id) {
    await admin
      .from('contacts')
      .update({ hubspot_contact_id: contact.id, updated_by: userId })
      .eq('id', match.id)
      .is('hubspot_contact_id', null);
  }
  return match.id;
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

  const linkedId = await linkByEmail(userId, accountId, contact);
  if (linkedId) return { success: true, accountId, contactId: linkedId, created: false };

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from('contacts')
    .insert({
      account_id: accountId,
      first_name: contact.firstName,
      last_name: contact.lastName,
      full_name: contact.fullName,
      email: contact.email,
      // El de HubSpot, sin procedencia de proveedor (como al aprobar un candidato de
      // HubSpot): así la regla 164 lo protege de que Apollo / Lusha lo reemplacen.
      phone: contact.phone ?? contact.mobilePhone,
      mobile_phone: contact.phone && contact.mobilePhone ? contact.mobilePhone : null,
      linkedin_url: contact.linkedinUrl,
      job_title: contact.jobTitle,
      contact_status: 'active',
      source: 'hubspot',
      hubspot_contact_id: hubspotContactId,
      is_primary: false,
      created_by: userId,
      updated_by: userId,
      metadata: { created_from: 'hubspot_lookup_import', source_hubspot_contact_id: hubspotContactId },
    })
    .select('id')
    .single();
  if (error || !inserted) {
    console.error('[hubspot-lookup] crear contacto falló:', error?.message);
    return { success: false, error: 'Trajimos la empresa, pero no pudimos crear el contacto. Vuelve a intentarlo.' };
  }

  await logContactAudit({
    contactId: inserted.id as string,
    accountId,
    actorUserId: userId,
    actionType: 'contact_created',
    details: { full_name: contact.fullName, source: 'hubspot', hubspot_contact_id: hubspotContactId },
  });

  return { success: true, accountId, contactId: inserted.id as string, created: true };
}
