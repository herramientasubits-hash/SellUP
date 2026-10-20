'use server';

/**
 * Agente 3 para una empresa que todavía no está en SellUp (dueña 18-10: «como cuando
 * uno busca contactos: primero pide la empresa, revisa si está en HubSpot o en SellUp
 * para asociarla; si no, pide nombre, país y dominio y la crea en SellUp y HubSpot»).
 *
 * Convierte la empresa elegida en una empresa de SellUp:
 *  - de SellUp: la misma (si la persona la puede ver);
 *  - de HubSpot: se crea vinculada, con la misma revisión de duplicados del Agente 2;
 *  - escrita a mano: se revisan duplicados por dominio y nombre, se crea en SellUp y se
 *    crea o vincula en HubSpot con el mecanismo que ya usan los demás agentes (si hay
 *    duda de duplicado, queda para revisión humana en vez de crear).
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isAgent3FirstCallEnabled } from '@/lib/feature-flags.server';
import { createAccount, getAccountById } from '@/modules/accounts/actions';
import { resolveAccountHubSpotCompanyWired } from '@/modules/accounts/hubspot-company-resolution-wiring';
import { LATAM_COUNTRIES } from '@/modules/accounts/types';
import { resolveAccountForEnrichmentRequest } from '@/modules/contact-enrichment/request-account-resolution-core';
import type { CompanyCandidate } from '@/modules/contact-enrichment/types';
import {
  buildHubSpotAccountResolutionDeps,
  normalizeAccountName,
} from '@/server/agents/contact-enrichment-toolkit/hubspot-account-resolution-deps';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';

export type FirstContactCompanyHubSpot = 'linked' | 'created' | 'pending_review' | 'not_created';

export type ResolveFirstContactCompanyResult =
  | { success: true; accountId: string; created: boolean; hubspot: FirstContactCompanyHubSpot }
  | { success: false; error: string };

const NAME_MAX_CHARS = 160;

async function currentInternalUserId(): Promise<string | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('internal_users').select('id').eq('auth_user_id', user.id).eq('access_status', 'active').maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Una empresa ya existente con ese dominio o ese nombre (archivadas fuera). */
async function findExisting(name: string, domain: string | null): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  if (domain) {
    const { data } = await admin.from('accounts').select('id').eq('domain', domain).is('archived_at', null).limit(1);
    if (data && data.length > 0) return (data[0] as { id: string }).id;
  }
  const { data } = await admin.from('accounts').select('id').eq('normalized_name', normalizeAccountName(name)).is('archived_at', null).limit(1);
  return data && data.length > 0 ? (data[0] as { id: string }).id : null;
}

export async function resolveFirstContactCompanyAction(input: {
  candidate?: CompanyCandidate | null;
  manual?: { name: string; countryCode: string; domain?: string | null } | null;
}): Promise<ResolveFirstContactCompanyResult> {
  if (!isAgent3FirstCallEnabled()) return { success: false, error: 'La preparación del primer contacto no está activada.' };
  const userId = await currentInternalUserId();
  if (!userId) return { success: false, error: 'Tu sesión se cerró. Vuelve a iniciar sesión.' };

  const candidate = input.candidate ?? null;
  if (candidate?.source === 'sellup' && candidate.sellupAccountId) {
    const account = await getAccountById(candidate.sellupAccountId);
    if (!account || account.pipeline_status === 'archived') return { success: false, error: 'Esa empresa no está en tu cartera.' };
    return { success: true, accountId: account.id, created: false, hubspot: account.hubspot_company_id ? 'linked' : 'not_created' };
  }

  if (candidate?.source === 'hubspot' && candidate.hubspotCompanyId) {
    const resolution = await resolveAccountForEnrichmentRequest(
      {
        source: 'hubspot',
        sellupAccountId: null,
        hubspotCompanyId: candidate.hubspotCompanyId,
        name: candidate.name,
        domain: candidate.domain ?? null,
        countryCode: candidate.countryCode ?? null,
      },
      buildHubSpotAccountResolutionDeps(createSupabaseAdminClient(), userId, 'first_contact_request'),
    );
    if (!resolution.accountId) return { success: false, error: 'No pudimos traer esa empresa de HubSpot. Vuelve a intentarlo.' };
    if (!(await getAccountById(resolution.accountId))) return { success: false, error: 'Esa empresa ya existe en SellUp y la lleva otro vendedor.' };
    return { success: true, accountId: resolution.accountId, created: resolution.outcome === 'created', hubspot: 'linked' };
  }

  // Escrita a mano: nombre, país y dominio.
  const manual = input.manual ?? (candidate ? { name: candidate.name, countryCode: candidate.countryCode ?? '', domain: candidate.domain ?? null } : null);
  const name = (manual?.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > NAME_MAX_CHARS) return { success: false, error: 'Escribe el nombre de la empresa.' };
  const country = LATAM_COUNTRIES.find((c) => c.code === (manual?.countryCode ?? '').toUpperCase());
  if (!country) return { success: false, error: 'Elige el país de la empresa.' };
  const domain = manual?.domain ? normalizeDomain(manual.domain) : null;
  if (manual?.domain && !domain) return { success: false, error: 'El dominio no es válido (ej.: empresa.com).' };

  const existing = await findExisting(name, domain);
  if (existing) {
    const account = await getAccountById(existing);
    if (!account) return { success: false, error: 'Esa empresa ya existe en SellUp y la lleva otro vendedor.' };
    return { success: true, accountId: account.id, created: false, hubspot: account.hubspot_company_id ? 'linked' : 'not_created' };
  }

  const created = await createAccount({ name, website: domain ?? undefined, country: country.name, country_code: country.code });
  if (!created.success) return { success: false, error: 'No pudimos crear la empresa. Vuelve a intentarlo.' };

  // La misma resolución que usan los demás agentes: vincula si ya existe en HubSpot, la crea
  // si no, y si hay duda de duplicado la deja para revisión humana.
  let hubspot: FirstContactCompanyHubSpot = 'not_created';
  try {
    const outcome = await resolveAccountHubSpotCompanyWired(created.id, new Date().toISOString());
    hubspot = outcome.status === 'ready' ? 'created' : outcome.status === 'pending_review' ? 'pending_review' : 'not_created';
  } catch (error) {
    console.error('[first-contact-company] HubSpot resolution failed:', error instanceof Error ? error.message : error);
  }
  return { success: true, accountId: created.id, created: true, hubspot };
}
