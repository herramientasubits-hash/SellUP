'use server';

// Agente 2A — Búsqueda puntual de un contacto (LinkedIn o correo): acción del servidor.
// F2 · AGENT2A-LINKEDIN-CONTACT-SEARCH, ampliada en AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE.
//
// Una sola acción: detecta si llegó un LinkedIn o un correo, busca (núcleos puros
// `linkedin-contact-search-core.ts` y `email-contact-search-core.ts`), y si encontró a la
// persona resuelve la empresa (HubSpot primero, luego SellUp; sólo coincidencia única) y CREA
// el candidato `pending_review` en el mismo momento. El usuario lo revisa desde el chat
// («Revisar ahora») o después en «Por revisar».
//
// Todo detrás de CONTACT_ENRICHMENT_LINKEDIN_SEARCH_ENABLED: apagada, responde «no activada»
// antes de leer nada o llamar a un proveedor. No escribe en HubSpot (sólo lee). No crea
// contactos finales: la aprobación sigue el camino de siempre.

import { createClient as createServiceRoleClient, type SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isContactEnrichmentLinkedInSearchEnabled } from '@/lib/feature-flags.server';
import { logProviderUsage, updateAgentRun } from '@/modules/usage-tracking/logging';
import {
  findHubSpotContactByEmail,
  findHubSpotContactProfileByEmail,
} from '@/server/integrations/hubspot-contact-sync';
import { createContactEnrichmentAttempt } from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-attempt-creator';
import {
  defaultGetHubSpotCompanyById,
  defaultSearchByDomain,
  defaultSearchByName,
  defaultSearchHubSpot,
  hubspotMatchToCandidate,
  sellupMatchToCandidate,
} from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import { isOfferableHubSpotContact } from '@/server/agents/contact-enrichment-toolkit/hubspot-first-core';
import { resolveHubSpotFirstOwnership } from '@/server/agents/contact-enrichment-toolkit/hubspot-first-stage.server';
import { createContactEnrichmentRequestAction, requireActiveUserForEnrichment } from './actions';
import { canSeeContactCandidate } from './candidate-scope.server';
import { createQuickSearchCandidate } from './contact-quick-search-candidate-core';
import { resolveQuickSearchCompany } from './contact-quick-search-company-core';
import {
  CONTACT_SEARCH_INPUT_COPY,
  detectContactSearchInput,
} from './contact-search-input';
import { searchContactByEmail, type EmailSearchResult } from './email-contact-search-core';
import {
  searchContactByLinkedin,
  type ContactSearchEntryMode,
  type KnownContactMatch,
  type LinkedinProviderUsage,
  type LinkedinSearchPreview,
  type LinkedinSearchResult,
} from './linkedin-contact-search-core';
import {
  lookupApolloByEmail,
  lookupApolloByLinkedin,
  lookupLushaByEmail,
  lookupLushaByLinkedin,
} from './linkedin-contact-search-providers.server';
import { linkedinProfileKey, linkedinSlugIlikePatterns } from './linkedin-profile-url';

function getServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createServiceRoleClient(url, key);
}

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

type Embedded<T> = T | T[] | null;
function one<T>(value: Embedded<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// ── Lecturas en SellUp (globales: deduplicar no depende del dueño) ────────────
//
// Sólo devuelven nombre y empresa: lo justo para decir «ya existe», sin abrir la ficha de un
// contacto de otro vendedor.

async function findSellUpContactByLinkedin(admin: SupabaseClient, slug: string): Promise<KnownContactMatch | null> {
  for (const pattern of linkedinSlugIlikePatterns(slug)) {
    const { data, error } = await admin
      .from('contacts')
      .select('full_name, linkedin_url, account:account_id ( name )')
      .is('archived_at', null)
      .ilike('linkedin_url', pattern)
      .limit(20);
    if (error) throw new Error('linkedin_search_sellup_contacts_failed');
    const row = (data ?? []).find((r) => linkedinProfileKey(r.linkedin_url as string | null) === slug);
    if (row) {
      const account = one(row.account as Embedded<{ name: string | null }>);
      return { fullName: (row.full_name as string | null) ?? null, companyName: account?.name ?? null };
    }
  }
  return null;
}

async function findPendingCandidateByLinkedin(admin: SupabaseClient, slug: string): Promise<KnownContactMatch | null> {
  for (const pattern of linkedinSlugIlikePatterns(slug)) {
    const { data, error } = await admin
      .from('contact_enrichment_candidates')
      .select('id, full_name, linkedin_url, run:enrichment_run_id ( company_name )')
      .eq('status', 'pending_review')
      .ilike('linkedin_url', pattern)
      .limit(20);
    if (error) throw new Error('linkedin_search_pending_candidates_failed');
    const row = (data ?? []).find((r) => linkedinProfileKey(r.linkedin_url as string | null) === slug);
    if (row) {
      const run = one(row.run as Embedded<{ company_name: string | null }>);
      return {
        fullName: (row.full_name as string | null) ?? null,
        companyName: run?.company_name ?? null,
        candidateId: (row.id as string | null) ?? null,
      };
    }
  }
  return null;
}

async function findPendingCandidateByEmail(admin: SupabaseClient, email: string): Promise<KnownContactMatch | null> {
  const { data, error } = await admin
    .from('contact_enrichment_candidates')
    .select('id, full_name, email, run:enrichment_run_id ( company_name )')
    .eq('status', 'pending_review')
    .ilike('email', escapeLikeValue(email))
    .limit(5);
  if (error) throw new Error('quick_search_pending_email_failed');
  const row = (data ?? []).find((r) => (r.email as string | null)?.trim().toLowerCase() === email);
  if (!row) return null;
  const run = one(row.run as Embedded<{ company_name: string | null }>);
  return {
    fullName: (row.full_name as string | null) ?? null,
    companyName: run?.company_name ?? null,
    candidateId: (row.id as string | null) ?? null,
  };
}

async function findSellUpContactByEmail(admin: SupabaseClient, email: string): Promise<KnownContactMatch | null> {
  const { data, error } = await admin
    .from('contacts')
    .select('full_name, email, account:account_id ( name )')
    .is('archived_at', null)
    .ilike('email', escapeLikeValue(email))
    .limit(5);
  if (error) throw new Error('linkedin_search_sellup_email_failed');
  const row = (data ?? []).find((r) => (r.email as string | null)?.trim().toLowerCase() === email);
  if (!row) return null;
  const account = one(row.account as Embedded<{ name: string | null }>);
  return { fullName: (row.full_name as string | null) ?? null, companyName: account?.name ?? null };
}

async function findHubSpotContactMatchByEmail(email: string): Promise<KnownContactMatch | null> {
  const match = await findHubSpotContactByEmail(email);
  if (!match) return null;
  const first = match.properties?.firstname?.trim() ?? '';
  const last = match.properties?.lastname?.trim() ?? '';
  return { fullName: `${first} ${last}`.trim() || null, companyName: null };
}

// ── Acción ────────────────────────────────────────────────────────────────────

export type ContactQuickSearchResult =
  | { status: 'disabled' }
  | { status: 'invalid_input'; message: string }
  | {
      status: 'already_known';
      where: 'sellup_contact' | 'sellup_pending_candidate' | 'hubspot_contact';
      matchedBy: 'linkedin' | 'email';
      match: { fullName: string | null; companyName: string | null };
      creditsSpent: boolean;
      message: string;
      /** Sólo si está en «Por revisar» y el usuario lo puede ver: para «Abrir candidato». */
      candidateId: string | null;
    }
  | { status: 'not_found'; message: string; creditsSpent: boolean }
  | { status: 'provider_error'; message: string }
  | {
      /** Se encontró a la persona pero no se pudo guardar (ya hubo gasto si vino de un proveedor). */
      status: 'create_failed';
      entryMode: ContactSearchEntryMode;
      preview: LinkedinSearchPreview;
      message: string;
    }
  | {
      status: 'created';
      entryMode: ContactSearchEntryMode;
      candidateId: string;
      preview: LinkedinSearchPreview;
      /** La empresa asignada (coincidencia única); null ⇒ «Sin empresa asociada». */
      company: { name: string; source: 'sellup' | 'hubspot' } | null;
      /** La empresa asignada no coincide con la que dice la fuente (posible cambio de trabajo). */
      companyMismatch: boolean;
      /** HubSpot no respondió en algún paso (revisión de correo o empresa). */
      hubspotUnavailable: boolean;
    };

const UNEXPECTED_ERROR = 'No pudimos completar la búsqueda. Intenta de nuevo.';

function usageLogger(internalUserId: string, entryMode: ContactSearchEntryMode) {
  return async function logUsage(entry: LinkedinProviderUsage): Promise<void> {
    await logProviderUsage({
      provider_key: entry.provider_key,
      operation_key: entry.operation_key,
      // Créditos: null ⇒ desconocido (se omite, queda NULL), nunca 0. El costo en USD no se
      // calcula aquí: NULL explícito para no escribir un 0 inventado.
      ...(entry.credits_used === null ? {} : { credits_used: entry.credits_used }),
      estimated_cost_usd: null,
      results_returned: entry.results_returned,
      status: entry.status,
      ...(entry.error_code ? { error_code: entry.error_code } : {}),
      triggered_by: internalUserId,
      agent_key: 'agent2a',
      agent_step: 'identificar_contacto',
      // Sin la URL de LinkedIn ni el correo: datos personales.
      metadata: { entry_mode: entryMode, hito: 'AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE' },
    });
  };
}

/** ¿El candidato que ya está en «Por revisar» lo puede abrir este usuario? Si no, sin id. */
async function visibleCandidateId(candidateId: string | null | undefined): Promise<string | null> {
  if (!candidateId) return null;
  try {
    const supabase = await createClient();
    return (await canSeeContactCandidate(supabase, candidateId)) ? candidateId : null;
  } catch {
    return null;
  }
}

/**
 * Busca a la persona por su LinkedIn o su correo y, si la encuentra, crea el candidato en
 * «Por revisar» con la empresa resuelta (o sin empresa) en el mismo momento.
 */
export async function searchContactQuickAction(rawInput: unknown): Promise<ContactQuickSearchResult> {
  if (!isContactEnrichmentLinkedInSearchEnabled()) return { status: 'disabled' };
  const input = detectContactSearchInput(rawInput);
  if (input.kind === 'empty') return { status: 'invalid_input', message: CONTACT_SEARCH_INPUT_COPY.empty };
  if (input.kind === 'unknown') return { status: 'invalid_input', message: CONTACT_SEARCH_INPUT_COPY.unknown };

  const { internalUserId } = await requireActiveUserForEnrichment();
  const admin = getServiceRoleClient();
  const nowIso = () => new Date().toISOString();

  // 1. Buscar.
  let found: LinkedinSearchResult | EmailSearchResult;
  try {
    if (input.kind === 'linkedin') {
      found = await searchContactByLinkedin(input.raw, {
        isEnabled: isContactEnrichmentLinkedInSearchEnabled,
        findSellUpContactByLinkedin: (slug) => findSellUpContactByLinkedin(admin, slug),
        findPendingCandidateByLinkedin: (slug) => findPendingCandidateByLinkedin(admin, slug),
        lookupApollo: (url) => lookupApolloByLinkedin(url),
        lookupLusha: (url) => lookupLushaByLinkedin(url),
        findSellUpContactByEmail: (email) => findSellUpContactByEmail(admin, email),
        // Decisión de Bryan (29-10): el duplicado por correo contra HubSpot sigue como estaba.
        findHubSpotContactByEmail: findHubSpotContactMatchByEmail,
        logUsage: usageLogger(internalUserId, 'linkedin_single'),
        nowIso,
      });
    } else {
      found = await searchContactByEmail(input.email, {
        isEnabled: isContactEnrichmentLinkedInSearchEnabled,
        findSellUpContactByEmail: (email) => findSellUpContactByEmail(admin, email),
        findPendingCandidateByEmail: (email) => findPendingCandidateByEmail(admin, email),
        findHubSpotContactByEmail: (email) => findHubSpotContactProfileByEmail(email),
        async isHubSpotContactOfferable(contact) {
          // Misma regla de dueño que «Primero HubSpot»: un contacto de otro vendedor activo no
          // se ofrece. Sin dueño ⇒ se ofrece sin preguntar a nadie.
          if (!contact.ownerId) return true;
          const ownership = await resolveHubSpotFirstOwnership(internalUserId, null);
          return isOfferableHubSpotContact(contact.ownerId, ownership);
        },
        lookupApollo: (email) => lookupApolloByEmail(email),
        lookupLusha: (email) => lookupLushaByEmail(email),
        findSellUpContactByLinkedin: (slug) => findSellUpContactByLinkedin(admin, slug),
        findPendingCandidateByLinkedin: (slug) => findPendingCandidateByLinkedin(admin, slug),
        logUsage: usageLogger(internalUserId, 'email_single'),
        nowIso,
      });
    }
  } catch {
    // Nunca se reenvía el mensaje crudo: podría citar la URL o el correo.
    return { status: 'provider_error', message: UNEXPECTED_ERROR };
  }

  if (found.status === 'invalid_url') return { status: 'invalid_input', message: found.message };
  if (found.status === 'already_known') {
    return {
      status: 'already_known',
      where: found.where,
      matchedBy: found.matchedBy,
      match: { fullName: found.match.fullName, companyName: found.match.companyName },
      creditsSpent: found.creditsSpent,
      message: found.message,
      candidateId:
        found.where === 'sellup_pending_candidate' ? await visibleCandidateId(found.match.candidateId) : null,
    };
  }
  if (found.status !== 'found') return found;

  const { data, preview } = found;

  // 2. Empresa: HubSpot primero, luego SellUp; sólo coincidencia única.
  const resolution = await resolveQuickSearchCompany(
    {
      hubspotCompanyId: data.hubspotContact?.associatedCompanyId ?? null,
      companyDomain: data.profile.providerCompanyDomain,
      companyName: data.profile.providerCompanyName,
      email: data.profile.email,
    },
    {
      getHubSpotCompanyById: defaultGetHubSpotCompanyById,
      searchHubSpotByDomain: (domain) => defaultSearchHubSpot({ domain }),
      searchHubSpotByName: (name) => defaultSearchHubSpot({ name }),
      searchSellUpByDomain: defaultSearchByDomain,
      searchSellUpByName: defaultSearchByName,
      toHubSpotCandidate: (match) => hubspotMatchToCandidate(match, 1),
      toSellUpCandidate: (match) => sellupMatchToCandidate(match, 1),
    },
  ).catch(() => ({ status: 'none' as const, hubspotUnavailable: true }));
  const company = resolution.status === 'resolved' ? resolution.company : null;

  // 3. Crear el candidato (siempre, con o sin empresa).
  const agentRunByRun = new Map<string, string | null>();
  try {
    const created = await createQuickSearchCandidate(
      { data, company, companyMatchedBy: resolution.status === 'resolved' ? resolution.matchedBy : null },
      {
        findPendingCandidateByLinkedin: (slug) => findPendingCandidateByLinkedin(admin, slug),
        findPendingCandidateByEmail: (email) => findPendingCandidateByEmail(admin, email),
        createRequest: (selected) => createContactEnrichmentRequestAction(selected),
        async loadRequestAccountId(requestId) {
          const { data: request, error } = await admin
            .from('contact_enrichment_requests')
            .select('account_id')
            .eq('id', requestId)
            .maybeSingle();
          if (error) return null;
          return (request?.account_id as string | null | undefined) ?? null;
        },
        async createRun({ requestId, provider }) {
          const attempt = await createContactEnrichmentAttempt({
            requestId,
            attemptOrder: 1,
            intendedProvider: provider,
            triggeredBy: internalUserId,
          });
          if ((attempt.status !== 'created' && attempt.status !== 'already_exists') || !attempt.attemptId) {
            return { runId: null };
          }
          agentRunByRun.set(attempt.attemptId, attempt.agentRunId ?? null);
          return { runId: attempt.attemptId };
        },
        async insertCandidate(row) {
          const { data: inserted, error } = await admin
            .from('contact_enrichment_candidates')
            .insert(row)
            .select('id')
            .single();
          if (error || !inserted) return { candidateId: null };
          return { candidateId: inserted.id as string };
        },
        async finalizeRun({ runId, entryMode, source, providersCalled, creditsSpent, companyConsistency, companyMatchedBy }) {
          const { data: current } = await admin
            .from('contact_enrichment_runs')
            .select('summary')
            .eq('id', runId)
            .maybeSingle();
          const summary = (current?.summary as Record<string, unknown> | null) ?? {};
          await admin
            .from('contact_enrichment_runs')
            .update({
              status: 'ready_for_review',
              providers_used: providersCalled,
              summary: {
                ...summary,
                entry_mode: entryMode,
                totalCandidates: 1,
                candidates_created: 1,
                candidate_provider: source,
                // El gasto se registró al buscar (provider_usage_logs); aquí sólo el total.
                credits_spent_at_search: creditsSpent,
                company_consistency: companyConsistency,
                company_auto_assignment: companyMatchedBy ?? 'unassigned',
                hito: 'AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE',
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', runId);
          const agentRunId = agentRunByRun.get(runId);
          if (agentRunId) {
            await updateAgentRun(agentRunId, {
              status: 'completed',
              results_generated: 1,
              finished_at: new Date().toISOString(),
            });
          }
        },
      },
    );

    if (!created.ok) {
      if (created.error === 'already_pending') {
        const pending =
          (data.linkedinSlug ? await findPendingCandidateByLinkedin(admin, data.linkedinSlug) : null) ??
          (data.profile.email ? await findPendingCandidateByEmail(admin, data.profile.email) : null);
        return {
          status: 'already_known',
          where: 'sellup_pending_candidate',
          matchedBy: data.entryMode === 'email_single' ? 'email' : 'linkedin',
          match: { fullName: pending?.fullName ?? preview.fullName, companyName: pending?.companyName ?? null },
          creditsSpent: data.providersCalled.length > 0,
          message: created.message,
          candidateId: await visibleCandidateId(pending?.candidateId),
        };
      }
      return { status: 'create_failed', entryMode: data.entryMode, preview, message: created.message };
    }

    return {
      status: 'created',
      entryMode: data.entryMode,
      candidateId: created.candidateId,
      preview,
      company:
        created.company && (created.company.source === 'sellup' || created.company.source === 'hubspot')
          ? { name: created.company.name, source: created.company.source }
          : null,
      companyMismatch: created.companyConsistency?.status === 'possible_mismatch',
      hubspotUnavailable: found.hubspotCheck === 'unavailable' || resolution.hubspotUnavailable,
    };
  } catch {
    return { status: 'create_failed', entryMode: data.entryMode, preview, message: UNEXPECTED_ERROR };
  }
}
