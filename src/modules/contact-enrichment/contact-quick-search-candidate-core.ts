// Agente 2A — Crear el candidato de la búsqueda puntual (LinkedIn o correo). Núcleo puro.
// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE.
//
// Decisión A de Bryan (29-10): el candidato se crea SIEMPRE que la búsqueda encontró a la
// persona, sin esperar al usuario. Si no lo revisa en el momento, ya está en «Por revisar».
//
//   - con empresa (coincidencia única, HubSpot primero) ⇒ request con esa empresa (crea o
//     vincula la cuenta, #587) ⇒ run con su cuenta;
//   - sin empresa (varias o ninguna) ⇒ request «manual» sin cuenta ⇒ run sin cuenta ⇒ el
//     candidato aparece «Sin empresa asociada» y se elige con «Reasignar empresa». Aprobar sin
//     empresa sigue bloqueado (`MSG.noAccount`).
//   - una empresa de HubSpot cuya cuenta no se pudo crear NO detiene nada: el run guarda el
//     `hubspot_company_id` y la aprobación vuelve a resolver la cuenta.
//
// Crear el candidato no llama a ningún proveedor.

import {
  checkCompanyConsistency,
  isGenericEmailDomain,
  normalizeDomain,
  type CompanyConsistencyResult,
} from '@/server/agents/contact-enrichment-toolkit/company-consistency-checker';
import type {
  ContactSearchSource,
  KnownContactMatch,
  LinkedinProviderProfile,
  LinkedinSearchProvider,
  SearchedContactData,
} from './linkedin-contact-search-core';
import type { QuickSearchCompanyMatchedBy } from './contact-quick-search-company-core';
import type { CompanyCandidate } from './types';

export const QUICK_SEARCH_HITO = 'AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE' as const;

/** Nombre de la empresa «manual» cuando la fuente tampoco dice dónde trabaja. */
export const QUICK_SEARCH_NO_COMPANY_NAME = 'Sin empresa identificada';

export type QuickSearchCandidateCreationError = 'already_pending' | 'request_failed' | 'run_failed' | 'insert_failed';

export const QUICK_SEARCH_CREATE_COPY: Record<QuickSearchCandidateCreationError, string> = {
  already_pending: 'Esta persona ya está en «Por revisar».',
  request_failed: 'Encontramos a la persona, pero no pudimos guardarla. Intenta de nuevo.',
  run_failed: 'Encontramos a la persona, pero no pudimos registrar la búsqueda. Intenta de nuevo.',
  insert_failed: 'Encontramos a la persona, pero no pudimos crear el candidato. Intenta de nuevo.',
};

export type QuickSearchCandidateCreationResult =
  | {
      ok: true;
      candidateId: string;
      runId: string;
      accountId: string | null;
      /** La empresa asignada; null ⇒ «Sin empresa asociada». */
      company: CompanyCandidate | null;
      companyConsistency: CompanyConsistencyResult | null;
    }
  | { ok: false; error: QuickSearchCandidateCreationError; message: string };

export interface QuickSearchCandidateRow {
  enrichment_run_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  title: string | null;
  seniority: string | null;
  department: null;
  country: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  source: ContactSearchSource;
  source_contact_id: string | null;
  /** Sólo candidatos que salen de un contacto de HubSpot (la aprobación se vincula a él). */
  matched_hubspot_contact_id?: string;
  confidence: number;
  status: 'pending_review';
  duplicate_status: 'no_match';
  enrichment_metadata: Record<string, unknown>;
}

export interface QuickSearchCandidateCreationDeps {
  findPendingCandidateByLinkedin: (slug: string) => Promise<KnownContactMatch | null>;
  findPendingCandidateByEmail: (email: string) => Promise<KnownContactMatch | null>;
  /** Crea la request de la empresa (crea o vincula la cuenta en SellUp cuando aplica, #587). */
  createRequest: (company: CompanyCandidate) => Promise<{ success: boolean; requestId?: string }>;
  loadRequestAccountId: (requestId: string) => Promise<string | null>;
  /** Crea el run (intento 1) de la request: hereda su cuenta (RPC create_contact_enrichment_attempt). */
  createRun: (input: { requestId: string; provider: LinkedinSearchProvider }) => Promise<{ runId: string | null }>;
  insertCandidate: (row: QuickSearchCandidateRow) => Promise<{ candidateId: string | null }>;
  finalizeRun: (input: {
    runId: string;
    entryMode: SearchedContactData['entryMode'];
    source: ContactSearchSource;
    providersCalled: LinkedinSearchProvider[];
    creditsSpent: number | null;
    companyConsistency: CompanyConsistencyResult['status'] | null;
    companyMatchedBy: QuickSearchCompanyMatchedBy | null;
  }) => Promise<void>;
}

/** Sólo se asignan empresas reales de SellUp o HubSpot, nunca una «manual» ni vacía. */
export function isSelectableCompany(company: CompanyCandidate | null | undefined): company is CompanyCandidate {
  if (!company || !company.name?.trim()) return false;
  if (company.source === 'sellup') return Boolean(company.sellupAccountId);
  if (company.source === 'hubspot') return Boolean(company.hubspotCompanyId);
  return false;
}

/**
 * Empresa «manual» para el run cuando no hay coincidencia única: lleva lo que dice la fuente
 * (nombre y dominio, para precargar «Reasignar empresa»), sin cuenta ni HubSpot ID.
 */
export function buildUnassignedCompany(profile: LinkedinProviderProfile): CompanyCandidate {
  const domain = normalizeDomain(profile.providerCompanyDomain);
  return {
    source: 'manual',
    name: profile.providerCompanyName?.trim() || QUICK_SEARCH_NO_COMPANY_NAME,
    domain: domain && !isGenericEmailDomain(domain) ? domain : null,
    countryCode: null,
    linkedinUrl: null,
    matchConfidence: 0,
  };
}

/**
 * ¿La empresa asignada coincide con la que dice la fuente? Mismo verificador que usan Apollo,
 * Lusha y «Reasignar empresa». `possible_mismatch` sugiere un cambio de trabajo.
 */
export function evaluateQuickSearchCompanyConsistency(
  profile: Pick<LinkedinProviderProfile, 'email' | 'providerCompanyName' | 'providerCompanyWebsiteUrl' | 'providerCompanyDomain'>,
  company: Pick<CompanyCandidate, 'name' | 'domain'>,
): CompanyConsistencyResult {
  return checkCompanyConsistency({
    email: profile.email,
    apolloOrganizationName: profile.providerCompanyName,
    apolloOrganizationWebsiteUrl: profile.providerCompanyWebsiteUrl ?? profile.providerCompanyDomain,
    companyDomain: company.domain ?? null,
    companyName: company.name,
  });
}

export function buildQuickSearchCandidateRow(input: {
  runId: string;
  data: SearchedContactData;
  company: CompanyCandidate | null;
  consistency: CompanyConsistencyResult | null;
  companyMatchedBy: QuickSearchCompanyMatchedBy | null;
}): QuickSearchCandidateRow {
  const { data, company, consistency } = input;
  const p = data.profile;
  const hubspot = p.provider === 'hubspot' ? data.hubspotContact ?? null : null;
  const metadata: Record<string, unknown> = {
    provider: p.provider,
    entry_mode: data.entryMode,
    ...(data.entryMode === 'linkedin_single' ? { linkedin_source: 'user_input' } : {}),
    ...(data.entryMode === 'email_single' ? { email_source: 'user_input' } : {}),
    organization: {
      name: p.providerCompanyName,
      website_url: p.providerCompanyWebsiteUrl,
      domain: p.providerCompanyDomain,
    },
    ...(consistency ? { company_consistency: consistency } : {}),
    company_auto_assignment: company
      ? { status: 'assigned', matched_by: input.companyMatchedBy, company_name: company.name }
      : { status: 'unassigned' },
    provider_phone_available: p.phoneAvailable,
    providers_called: data.providersCalled,
    credits_spent: data.creditsSpent,
    searched_at: data.searchedAt,
    hito: QUICK_SEARCH_HITO,
    // Un candidato de un contacto de HubSpot es «Primero HubSpot»: revelar LinkedIn/teléfono
    // y la vinculación al aprobar ya saben tratarlo.
    ...(hubspot ? { hubspot_first: true, hubspot_contact_id: hubspot.id } : {}),
  };
  return {
    enrichment_run_id: input.runId,
    first_name: p.firstName,
    last_name: p.lastName,
    full_name: p.fullName,
    title: p.title,
    seniority: p.seniority,
    department: null,
    country: p.country ?? company?.countryCode ?? null,
    linkedin_url: data.linkedinUrl,
    email: p.email,
    // Sólo HubSpot trae teléfono (el del CRM); el de los proveedores sigue el flujo de reveal.
    phone: hubspot ? (p.phone ?? null) : null,
    source: p.provider,
    source_contact_id: p.sourceContactId,
    ...(hubspot ? { matched_hubspot_contact_id: hubspot.id } : {}),
    // Un registro real de HubSpot no es una inferencia de un proveedor.
    confidence: hubspot ? 1 : 0.9,
    status: 'pending_review',
    duplicate_status: 'no_match', // LinkedIn y correo se comprobaron antes de crear.
    enrichment_metadata: metadata,
  };
}

export async function createQuickSearchCandidate(
  input: {
    data: SearchedContactData;
    company: CompanyCandidate | null;
    companyMatchedBy: QuickSearchCompanyMatchedBy | null;
  },
  deps: QuickSearchCandidateCreationDeps,
): Promise<QuickSearchCandidateCreationResult> {
  const fail = (error: QuickSearchCandidateCreationError): QuickSearchCandidateCreationResult => ({
    ok: false,
    error,
    message: QUICK_SEARCH_CREATE_COPY[error],
  });
  const { data } = input;
  const company = isSelectableCompany(input.company) ? input.company : null;

  // Pudo entrar a «Por revisar» por otro camino mientras se buscaba.
  if (data.linkedinSlug && (await deps.findPendingCandidateByLinkedin(data.linkedinSlug))) return fail('already_pending');
  if (data.profile.email && (await deps.findPendingCandidateByEmail(data.profile.email))) return fail('already_pending');

  const request = await deps.createRequest(company ?? buildUnassignedCompany(data.profile));
  if (!request.success || !request.requestId) return fail('request_failed');
  const accountId = company ? await deps.loadRequestAccountId(request.requestId) : null;

  // Sólo hay intención de proveedor (apollo | lusha) en el run; un candidato de HubSpot no gastó.
  const runProvider: LinkedinSearchProvider = data.profile.provider === 'lusha' ? 'lusha' : 'apollo';
  const run = await deps.createRun({ requestId: request.requestId, provider: runProvider });
  if (!run.runId) return fail('run_failed');

  const consistency = company ? evaluateQuickSearchCompanyConsistency(data.profile, company) : null;
  const companyMatchedBy = company ? input.companyMatchedBy : null;
  const row = buildQuickSearchCandidateRow({ runId: run.runId, data, company, consistency, companyMatchedBy });
  const inserted = await deps.insertCandidate(row);
  if (!inserted.candidateId) return fail('insert_failed');

  await deps.finalizeRun({
    runId: run.runId,
    entryMode: data.entryMode,
    source: data.profile.provider,
    providersCalled: data.providersCalled,
    creditsSpent: data.creditsSpent,
    companyConsistency: consistency?.status ?? null,
    companyMatchedBy,
  });

  return { ok: true, candidateId: inserted.candidateId, runId: run.runId, accountId, company, companyConsistency: consistency };
}
