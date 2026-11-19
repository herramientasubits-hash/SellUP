// Agente 2A — «Cambió de empresa»: lecturas, escrituras y HubSpot
// (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11).
//
// Sin 'use server' a propósito: son ayudantes del servidor, no acciones invocables desde el
// navegador. Las decisiones viven en los núcleos puros (`contact-company-change-core.ts`,
// `contact-hubspot-email-company-core.ts`); aquí sólo se cablean Supabase y HubSpot.
//
// Nunca registra correos ni URLs de LinkedIn (datos personales).

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  addHubSpotContactSecondaryEmail,
  getHubSpotContactSyncConnection,
  listHubSpotContactCompanyIds,
  readHubSpotContactEmails,
  removeHubSpotContactCompanyAssociation,
  setHubSpotContactJobTitle,
  setHubSpotContactPrimaryCompany,
  setHubSpotContactPrimaryEmail,
} from '@/server/integrations/hubspot-contact-sync';
import { createContactEnrichmentAttempt } from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-attempt-creator';
import { createContactEnrichmentRequest } from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-request-creator';
import { buildHubSpotAccountResolutionDeps } from '@/server/agents/contact-enrichment-toolkit/hubspot-account-resolution-deps';
import {
  defaultGetHubSpotCompanyById,
  defaultSearchByDomain,
  defaultSearchByName,
  defaultSearchHubSpot,
  hubspotMatchToCandidate,
  sellupMatchToCandidate,
} from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import type { CompanyResolutionSource } from './request-attempt-types';
import { resolveAccountForEnrichmentRequest } from './request-account-resolution-core';
import { resolveQuickSearchCompany, type QuickSearchCompanyResolution } from './contact-quick-search-company-core';
import { createQuickSearchCandidate, type QuickSearchCandidateCreationResult } from './contact-quick-search-candidate-core';
import { linkedinProfileKey, linkedinSlugIlikePatterns } from './linkedin-profile-url';
import type { KnownContactMatch, SearchedContactData } from './linkedin-contact-search-core';
import {
  addHubSpotAdditionalEmail,
  makeHubSpotPrimaryEmail,
  moveHubSpotContactToCompany,
  type HubSpotAdditionalEmailOutcome,
  type HubSpotCompanyMoveOutcome,
  type HubSpotEmailDeps,
  type HubSpotPrimaryEmailOutcome,
} from './contact-hubspot-email-company-core';
import {
  readCandidateCompanyChange,
  readContactCompanyChange,
  withCompanyChangeOutcome,
  companyChangeLookupInput,
  collectCompanyChangePhones,
  type CompanyChangeContact,
  type CompanyChangePhone,
  type CompanyChangeSourceCandidate,
} from './contact-company-change-core';
import type { EmailCheckBlock } from './email-change-classifier-core';
import { readProviderPhone } from './provider-phone';
import { readOfficialContactStoredPhones } from './official-contact-stored-phones-read';
import { selectAdditionalStoredOfficialPhones } from './official-contact-stored-phones-core';
import type { CompanyCandidate } from './types';

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

type Embedded<T> = T | T[] | null | undefined;
function one<T>(value: Embedded<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// ── Lecturas ────────────────────────────────────────────────────────

export async function loadCompanyChangeContact(contactId: string): Promise<CompanyChangeContact | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('contacts')
    .select(
      'id, account_id, first_name, last_name, full_name, email, linkedin_url, job_title, seniority, hubspot_contact_id, contact_status, archived_at, metadata, account:account_id ( name, domain, hubspot_company_id )',
    )
    .eq('id', contactId)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  const account = one(r.account as Embedded<{ name?: unknown; domain?: unknown; hubspot_company_id?: unknown }>);
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    accountName: str(account?.name),
    accountDomain: str(account?.domain),
    accountHubSpotCompanyId: str(account?.hubspot_company_id),
    firstName: str(r.first_name),
    lastName: str(r.last_name),
    fullName: str(r.full_name) ?? 'Contacto',
    email: str(r.email),
    linkedinUrl: str(r.linkedin_url),
    jobTitle: str(r.job_title),
    seniority: str(r.seniority),
    hubspotContactId: str(r.hubspot_contact_id),
    contactStatus: str(r.contact_status),
    archivedAt: str(r.archived_at),
    metadata: asRecord(r.metadata),
  };
}

/**
 * Todos los teléfonos del contacto viejo, para el candidato de la empresa nueva (Bryan 19-11):
 * «Celular», «Teléfono», «Teléfono Apollo / Lusha» y los de «Ver más números». SÓLO LECTURA.
 * Complementario: si la colección no se puede leer, viajan los escalares; si nada se puede leer,
 * el candidato nace sin teléfono (el cambio de empresa no se frena por esto).
 */
export async function loadCompanyChangePhones(contactId: string): Promise<CompanyChangePhone[]> {
  const { data } = await createSupabaseAdminClient()
    .from('contacts')
    .select('phone, mobile_phone, metadata')
    .eq('id', contactId)
    .maybeSingle();
  const row = (data ?? {}) as Record<string, unknown>;
  const phone = str(row.phone);
  let stored: string[] = [];
  try {
    stored = selectAdditionalStoredOfficialPhones(await readOfficialContactStoredPhones(contactId)).map((p) => p.number);
  } catch {
    stored = [];
  }
  return collectCompanyChangePhones({
    mobilePhone: str(row.mobile_phone),
    mainPhone: phone,
    providerPhone: readProviderPhone(row.metadata, phone)?.number ?? null,
    storedPhones: stored,
  });
}

export async function loadCompanyChangeSourceCandidate(candidateId: string): Promise<CompanyChangeSourceCandidate | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('contact_enrichment_candidates')
    .select('id, source, source_contact_id, matched_hubspot_contact_id, apollo_person_id, linkedin_url')
    .eq('id', candidateId)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: r.id as string,
    source: str(r.source),
    sourceContactId: str(r.source_contact_id),
    matchedHubSpotContactId: str(r.matched_hubspot_contact_id),
    apolloPersonId: str(r.apollo_person_id),
    linkedinUrl: str(r.linkedin_url),
  };
}

// ── Empresa nueva (sólo empresas que existen en HubSpot o SellUp) ───

export async function resolveCompanyChangeCompany(check: EmailCheckBlock): Promise<QuickSearchCompanyResolution> {
  return resolveQuickSearchCompany(companyChangeLookupInput(check), {
    getHubSpotCompanyById: defaultGetHubSpotCompanyById,
    searchHubSpotByDomain: (domain) => defaultSearchHubSpot({ domain }),
    searchHubSpotByName: (name) => defaultSearchHubSpot({ name }),
    searchSellUpByDomain: defaultSearchByDomain,
    searchSellUpByName: defaultSearchByName,
    toHubSpotCandidate: (match) => hubspotMatchToCandidate(match, 1),
    toSellUpCandidate: (match) => sellupMatchToCandidate(match, 1),
  }).catch(() => ({ status: 'none' as const, hubspotUnavailable: true }));
}

// ── El candidato en la empresa nueva ────────────────────────────────

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function findPendingCandidateByLinkedin(admin: SupabaseClient, slug: string): Promise<KnownContactMatch | null> {
  for (const pattern of linkedinSlugIlikePatterns(slug)) {
    const { data, error } = await admin
      .from('contact_enrichment_candidates')
      .select('id, full_name, linkedin_url, run:enrichment_run_id ( company_name )')
      .eq('status', 'pending_review')
      .ilike('linkedin_url', pattern)
      .limit(20);
    if (error) throw new Error('company_change_pending_linkedin_failed');
    const row = (data ?? []).find((r) => linkedinProfileKey(r.linkedin_url as string | null) === slug);
    if (row) {
      const run = one(row.run as Embedded<{ company_name: string | null }>);
      return { fullName: str(row.full_name), companyName: run?.company_name ?? null, candidateId: str(row.id) };
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
  if (error) throw new Error('company_change_pending_email_failed');
  const row = (data ?? []).find((r) => (r.email as string | null)?.trim().toLowerCase() === email);
  if (!row) return null;
  const run = one(row.run as Embedded<{ company_name: string | null }>);
  return { fullName: str(row.full_name), companyName: run?.company_name ?? null, candidateId: str(row.id) };
}

/**
 * Crea el candidato «Por revisar» con el MISMO camino que la búsqueda puntual (request de la
 * empresa → corrida → candidato). La request se crea con el cliente de servicio y SIN exigir que
 * la empresa nueva sea del equipo de quien detectó el cambio (Bryan 18-11, D3): el candidato debe
 * llegar al dueño de ESA empresa. Crear un candidato no crea contactos: aprobarlo sigue exigiendo
 * que la empresa sea de quien aprueba.
 */
export async function createCompanyChangeCandidate(input: {
  data: SearchedContactData;
  company: CompanyCandidate | null;
  companyMatchedBy: Extract<QuickSearchCompanyResolution, { status: 'resolved' }>['matchedBy'] | null;
  actorId: string;
  candidateMetadata: Record<string, unknown>;
}): Promise<QuickSearchCandidateCreationResult> {
  const admin = createSupabaseAdminClient();
  const created = await createQuickSearchCandidate(
    { data: input.data, company: input.company, companyMatchedBy: input.companyMatchedBy },
    {
      findPendingCandidateByLinkedin: (slug) => findPendingCandidateByLinkedin(admin, slug),
      findPendingCandidateByEmail: (email) => findPendingCandidateByEmail(admin, email),
      async createRequest(company) {
        const resolution = await resolveAccountForEnrichmentRequest(
          {
            source: company.source,
            sellupAccountId: company.sellupAccountId ?? null,
            hubspotCompanyId: company.hubspotCompanyId ?? null,
            name: company.name,
            domain: company.domain ?? null,
            countryCode: company.countryCode ?? null,
          },
          buildHubSpotAccountResolutionDeps(admin, input.actorId, 'contact_enrichment_request'),
        );
        const result = await createContactEnrichmentRequest({
          accountId: resolution.accountId ?? company.sellupAccountId ?? null,
          companyName: company.name,
          companyDomain: company.domain ?? null,
          companyCountryCode: company.countryCode ?? null,
          hubspotCompanyId: company.hubspotCompanyId ?? null,
          companyResolutionSource: company.source as CompanyResolutionSource,
          triggeredBy: input.actorId,
        });
        return result.status === 'created' ? { success: true, requestId: result.request.id } : { success: false };
      },
      async loadRequestAccountId(requestId) {
        const { data } = await admin.from('contact_enrichment_requests').select('account_id').eq('id', requestId).maybeSingle();
        return str((data as { account_id?: unknown } | null)?.account_id);
      },
      async createRun({ requestId, provider }) {
        const attempt = await createContactEnrichmentAttempt({
          requestId,
          attemptOrder: 1,
          intendedProvider: provider,
          triggeredBy: input.actorId,
        });
        if ((attempt.status !== 'created' && attempt.status !== 'already_exists') || !attempt.attemptId) return { runId: null };
        return { runId: attempt.attemptId };
      },
      async insertCandidate(row) {
        const { data, error } = await admin
          .from('contact_enrichment_candidates')
          .insert({ ...row, enrichment_metadata: { ...row.enrichment_metadata, ...input.candidateMetadata } })
          .select('id')
          .single();
        if (error || !data) return { candidateId: null };
        return { candidateId: data.id as string };
      },
      async finalizeRun({ runId, entryMode, source, companyConsistency, companyMatchedBy }) {
        const { data: current } = await admin.from('contact_enrichment_runs').select('summary').eq('id', runId).maybeSingle();
        const summary = asRecord((current as { summary?: unknown } | null)?.summary);
        await admin
          .from('contact_enrichment_runs')
          .update({
            status: 'ready_for_review',
            providers_used: [],
            summary: {
              ...summary,
              entry_mode: entryMode,
              totalCandidates: 1,
              candidates_created: 1,
              candidate_provider: source,
              // Lo gastado se registró al verificar (provider_usage_logs).
              credits_spent_at_search: 0,
              company_consistency: companyConsistency,
              company_auto_assignment: companyMatchedBy ?? 'unassigned',
              hito: 'AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE',
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId);
      },
    },
  );
  return created;
}

// ── HubSpot ─────────────────────────────────────────────────────────

export const hubspotEmailDeps: HubSpotEmailDeps = {
  readEmails: readHubSpotContactEmails,
  setPrimaryEmail: setHubSpotContactPrimaryEmail,
  addSecondaryEmail: addHubSpotContactSecondaryEmail,
};

async function canWriteHubSpotContacts(): Promise<boolean> {
  try {
    const connection = await getHubSpotContactSyncConnection();
    return connection.connected && connection.canWriteContacts;
  } catch {
    return false;
  }
}

/** Correo nuevo como principal (el anterior queda como adicional). Nunca lanza. */
export async function promoteHubSpotEmail(hubspotContactId: string, email: string): Promise<HubSpotPrimaryEmailOutcome | 'hubspot_unavailable'> {
  if (!(await canWriteHubSpotContacts())) return 'hubspot_unavailable';
  return makeHubSpotPrimaryEmail(hubspotContactId, email, hubspotEmailDeps);
}

/** Correo personal como adicional (nunca principal). Nunca lanza. */
export async function addHubSpotPersonalEmail(hubspotContactId: string, email: string): Promise<HubSpotAdditionalEmailOutcome | 'hubspot_unavailable'> {
  if (!(await canWriteHubSpotContacts())) return 'hubspot_unavailable';
  return addHubSpotAdditionalEmail(hubspotContactId, email, hubspotEmailDeps);
}

/** Antes de la revisión (D5): correo nuevo como principal y cargo actual. Nunca lanza. */
export async function pushCompanyChangeToHubSpot(
  hubspotContactId: string,
  plan: { email: string | null; jobTitle: string | null },
): Promise<{ email: string | null; job_title: string | null }> {
  if (!plan.email && !plan.jobTitle) return { email: null, job_title: null };
  if (!(await canWriteHubSpotContacts())) {
    return { email: plan.email ? 'hubspot_unavailable' : null, job_title: plan.jobTitle ? 'hubspot_unavailable' : null };
  }
  const email = plan.email ? await makeHubSpotPrimaryEmail(hubspotContactId, plan.email, hubspotEmailDeps) : null;
  let jobTitle: string | null = null;
  if (plan.jobTitle) {
    const written = await setHubSpotContactJobTitle(hubspotContactId, plan.jobTitle).catch(() => ({ error: 'THREW' }));
    jobTitle = 'ok' in written ? 'written' : 'failed';
  }
  return { email, job_title: jobTitle };
}

// ── Aprobar / rechazar el candidato de la empresa nueva ─────────────

async function loadCandidateCompanyChange(admin: SupabaseClient, candidateId: string) {
  const { data } = await admin.from('contact_enrichment_candidates').select('enrichment_metadata').eq('id', candidateId).maybeSingle();
  return readCandidateCompanyChange((data as { enrichment_metadata?: unknown } | null)?.enrichment_metadata);
}

async function updatePreviousContact(
  admin: SupabaseClient,
  previousContactId: string,
  update: Parameters<typeof withCompanyChangeOutcome>[2],
): Promise<void> {
  const { data } = await admin.from('contacts').select('metadata').eq('id', previousContactId).maybeSingle();
  const metadata = asRecord((data as { metadata?: unknown } | null)?.metadata);
  const block = readContactCompanyChange(metadata);
  if (!block) return;
  await admin.from('contacts').update({ metadata: withCompanyChangeOutcome(metadata, block, update) }).eq('id', previousContactId);
}

/**
 * Después de aprobar (y del autosync de la aprobación): en HubSpot la empresa nueva queda como
 * «Principal» y el contacto se desasocia de las demás (D4). Deals y actividades no se tocan.
 * No-op para candidatos que no vienen de un cambio de empresa. Nunca lanza.
 */
export async function afterCompanyChangeCandidateApproved(candidateId: string, contactId: string): Promise<HubSpotCompanyMoveOutcome | 'not_company_change' | 'not_in_hubspot' | 'no_hubspot_company' | 'hubspot_unavailable' | 'error'> {
  try {
    const admin = createSupabaseAdminClient();
    const change = await loadCandidateCompanyChange(admin, candidateId);
    if (!change) return 'not_company_change';
    const { data } = await admin
      .from('contacts')
      .select('hubspot_contact_id, account:account_id ( hubspot_company_id )')
      .eq('id', contactId)
      .maybeSingle();
    const row = data as { hubspot_contact_id?: unknown; account?: Embedded<{ hubspot_company_id?: unknown }> } | null;
    const hubspotContactId = str(row?.hubspot_contact_id);
    const hubspotCompanyId = str(one(row?.account)?.hubspot_company_id);
    const nowIso = new Date().toISOString();
    let outcome: HubSpotCompanyMoveOutcome | 'not_in_hubspot' | 'no_hubspot_company' | 'hubspot_unavailable';
    if (!hubspotContactId) outcome = 'not_in_hubspot';
    else if (!hubspotCompanyId) outcome = 'no_hubspot_company';
    else if (!(await canWriteHubSpotContacts())) outcome = 'hubspot_unavailable';
    else {
      const report = await moveHubSpotContactToCompany(hubspotContactId, hubspotCompanyId, {
        listCompanyIds: listHubSpotContactCompanyIds,
        setPrimaryCompany: setHubSpotContactPrimaryCompany,
        removeCompany: removeHubSpotContactCompanyAssociation,
      });
      outcome = report.outcome;
    }
    await updatePreviousContact(admin, change.previous_contact_id, {
      outcome: 'approved',
      nowIso,
      approvedContactId: contactId,
      hubspotReassociation: outcome,
    });
    return outcome;
  } catch (err) {
    console.error('[contact-company-change] after approval failed', {
      candidateId,
      contactId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return 'error';
  }
}

/** Al rechazar el candidato nuevo: sólo se anota en el contacto viejo (sigue archivado). */
export async function afterCompanyChangeCandidateDiscarded(candidateId: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const change = await loadCandidateCompanyChange(admin, candidateId);
    if (!change) return;
    await updatePreviousContact(admin, change.previous_contact_id, { outcome: 'rejected', nowIso: new Date().toISOString() });
  } catch (err) {
    console.error('[contact-company-change] after discard failed', {
      candidateId,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}
