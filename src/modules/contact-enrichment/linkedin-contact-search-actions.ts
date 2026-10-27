'use server';

// Agente 2A — Buscar contacto por LinkedIn: acciones del servidor (F2).
//
// Cablea el núcleo puro (`linkedin-contact-search-core.ts`) con Supabase, Apollo, Lusha y
// HubSpot. Todo detrás de CONTACT_ENRICHMENT_LINKEDIN_SEARCH_ENABLED: apagada, las dos acciones
// responden «no activada» antes de leer nada o llamar a un proveedor.
//
// No escribe en HubSpot (sólo lee por email). No crea contactos finales: el candidato queda en
// `pending_review` y la aprobación sigue el camino de siempre (que ya envía `hs_linkedin_url`
// con su reintento ante un 400, #651).

import { createClient as createServiceRoleClient, type SupabaseClient } from '@supabase/supabase-js';
import { isContactEnrichmentLinkedInSearchEnabled } from '@/lib/feature-flags.server';
import { logProviderUsage, updateAgentRun } from '@/modules/usage-tracking/logging';
import { findHubSpotContactByEmail } from '@/server/integrations/hubspot-contact-sync';
import { createContactEnrichmentAttempt } from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-attempt-creator';
import { createContactEnrichmentRequestAction, requireActiveUserForEnrichment } from './actions';
import {
  createLinkedinContactCandidate,
  searchContactByLinkedin,
  type KnownContactMatch,
  type LinkedinCandidateCreationResult,
  type LinkedinSearchPreviewData,
  type LinkedinSearchResult,
} from './linkedin-contact-search-core';
import { lookupApolloByLinkedin, lookupLushaByLinkedin } from './linkedin-contact-search-providers.server';
import { linkedinProfileKey, linkedinSlugIlikePatterns } from './linkedin-profile-url';
import { signLinkedinPreviewToken, verifyLinkedinPreviewToken } from './linkedin-preview-token';
import type { CompanyCandidate } from './types';

function getServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createServiceRoleClient(url, key);
}

function previewSecret(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
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
      .select('full_name, linkedin_url, run:enrichment_run_id ( company_name )')
      .eq('status', 'pending_review')
      .ilike('linkedin_url', pattern)
      .limit(20);
    if (error) throw new Error('linkedin_search_pending_candidates_failed');
    const row = (data ?? []).find((r) => linkedinProfileKey(r.linkedin_url as string | null) === slug);
    if (row) {
      const run = one(row.run as Embedded<{ company_name: string | null }>);
      return { fullName: (row.full_name as string | null) ?? null, companyName: run?.company_name ?? null };
    }
  }
  return null;
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

// ── Acciones ──────────────────────────────────────────────────────────────────

export type LinkedinContactSearchActionResult = LinkedinSearchResult;

/** Paso 1: valida la URL, deduplica, enriquece y devuelve la vista previa firmada. */
export async function searchContactByLinkedinAction(rawUrl: unknown): Promise<LinkedinContactSearchActionResult> {
  if (!isContactEnrichmentLinkedInSearchEnabled()) return { status: 'disabled' };
  const { internalUserId } = await requireActiveUserForEnrichment();
  const admin = getServiceRoleClient();

  try {
    return await searchContactByLinkedin(rawUrl, {
      isEnabled: isContactEnrichmentLinkedInSearchEnabled,
      findSellUpContactByLinkedin: (slug) => findSellUpContactByLinkedin(admin, slug),
      findPendingCandidateByLinkedin: (slug) => findPendingCandidateByLinkedin(admin, slug),
      lookupApollo: (url) => lookupApolloByLinkedin(url),
      lookupLusha: (url) => lookupLushaByLinkedin(url),
      findSellUpContactByEmail: (email) => findSellUpContactByEmail(admin, email),
      findHubSpotContactByEmail: findHubSpotContactMatchByEmail,
      async logUsage(entry) {
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
          // Sin la URL de LinkedIn: dato personal.
          metadata: { entry_mode: 'linkedin_single', hito: 'AGENT2A-LINKEDIN-CONTACT-SEARCH' },
        });
      },
      signPreview: (data) =>
        signLinkedinPreviewToken(data, { userId: internalUserId, nowMs: Date.now(), secret: previewSecret() }),
      nowIso: () => new Date().toISOString(),
    });
  } catch {
    // Nunca se reenvía el mensaje crudo: podría citar la URL o el email.
    return { status: 'provider_error', message: 'No pudimos completar la búsqueda. Intenta de nuevo.' };
  }
}

/** Paso 2: con la empresa elegida, crea el run (con account_id) y el candidato pending_review. */
export async function createLinkedinContactCandidateAction(
  token: unknown,
  company: CompanyCandidate | null,
): Promise<LinkedinCandidateCreationResult> {
  if (!isContactEnrichmentLinkedInSearchEnabled()) {
    return { ok: false, error: 'disabled', message: 'La búsqueda por LinkedIn no está activada en este entorno.' };
  }
  const { internalUserId } = await requireActiveUserForEnrichment();
  const admin = getServiceRoleClient();
  const agentRunByRun = new Map<string, string | null>();

  try {
    return await createLinkedinContactCandidate(
      { token, company },
      {
        isEnabled: isContactEnrichmentLinkedInSearchEnabled,
        verifyPreview(raw) {
          const verified = verifyLinkedinPreviewToken<LinkedinSearchPreviewData>(raw, {
            userId: internalUserId,
            nowMs: Date.now(),
            secret: previewSecret(),
          });
          return verified.ok ? { ok: true, data: verified.data } : { ok: false, expired: verified.error === 'expired' };
        },
        findPendingCandidateByLinkedin: (slug) => findPendingCandidateByLinkedin(admin, slug),
        createRequest: (selected) => createContactEnrichmentRequestAction(selected),
        async loadRequestAccountId(requestId) {
          const { data, error } = await admin
            .from('contact_enrichment_requests')
            .select('account_id')
            .eq('id', requestId)
            .maybeSingle();
          if (error) return null;
          return (data?.account_id as string | null | undefined) ?? null;
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
          const { data, error } = await admin
            .from('contact_enrichment_candidates')
            .insert(row)
            .select('id')
            .single();
          if (error || !data) return { candidateId: null };
          return { candidateId: data.id as string };
        },
        async finalizeRun({ runId, provider, providersCalled, creditsSpent, companyConsistency }) {
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
                entry_mode: 'linkedin_single',
                totalCandidates: 1,
                candidates_created: 1,
                candidate_provider: provider,
                // El gasto se registró al buscar (provider_usage_logs); aquí sólo el total.
                credits_spent_at_search: creditsSpent,
                company_consistency: companyConsistency,
                hito: 'AGENT2A-LINKEDIN-CONTACT-SEARCH',
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
  } catch {
    return { ok: false, error: 'insert_failed', message: 'No pudimos crear el candidato. Intenta de nuevo.' };
  }
}
