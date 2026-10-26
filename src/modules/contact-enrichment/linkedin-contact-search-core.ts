// Agente 2A — Buscar contacto por LinkedIn: núcleo puro (F2 · AGENT2A-LINKEDIN-CONTACT-SEARCH).
//
// Sin red ni Supabase: todo lo de afuera entra por dependencias, para probar el flujo completo
// con dobles. Dos pasos, separados por la decisión del usuario:
//
//   1. searchContactByLinkedin — URL → validar/normalizar → ¿ya existe en SellUp (contactos o
//      candidatos por revisar) por su LinkedIn? → enriquecer (Apollo; si no trae datos, Lusha)
//      → ¿el email encontrado ya existe en SellUp o en HubSpot? → vista previa firmada.
//   2. createLinkedinContactCandidate — vista previa firmada + empresa elegida → request (crea o
//      vincula la cuenta, #587) → run CON account_id desde el inicio → candidato pending_review.
//
// Reglas de gasto:
//   - URL inválida o persona ya conocida por su LinkedIn ⇒ ningún proveedor, cero créditos;
//   - el email se compara contra SellUp y HubSpot DESPUÉS de enriquecer (es el dato que trae el
//     proveedor): si ya existe, no se crea candidato y se avisa del gasto hecho;
//   - crear el candidato no vuelve a llamar a ningún proveedor.
//
// Pendiente (BACKLOG F2-b): buscar en HubSpot por la URL (`hs_linkedin_url`) antes de gastar,
// con la URL normalizada en los dos lados; y la decisión 2 (asociar un contacto existente a
// otra empresa). Hoy ninguno de los dos ocurre aquí.
//
// Datos personales: la URL de LinkedIn no se registra en logs ni en el uso de proveedores.

import { checkCompanyConsistency, type CompanyConsistencyResult } from '@/server/agents/contact-enrichment-toolkit/company-consistency-checker';
import {
  LINKEDIN_PROFILE_URL_ERROR_COPY,
  normalizeLinkedinProfileUrl,
  type LinkedinProfileUrlRejection,
} from './linkedin-profile-url';
import type { CompanyCandidate } from './types';

export type LinkedinSearchProvider = 'apollo' | 'lusha';

/** Lo que un proveedor sabe de la persona. Nunca incluye teléfonos (siguen el flujo de reveal). */
export interface LinkedinProviderProfile {
  provider: LinkedinSearchProvider;
  /** Id de la persona en el proveedor (Apollo person id / Lusha contact id). */
  sourceContactId: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  title: string | null;
  seniority: string | null;
  country: string | null;
  email: string | null;
  /** Empresa actual según el proveedor (puede no coincidir con la que elija el usuario). */
  providerCompanyName: string | null;
  providerCompanyDomain: string | null;
  providerCompanyWebsiteUrl: string | null;
  /** El proveedor dice que tiene teléfono (sin revelarlo). null = no lo dice. */
  phoneAvailable: boolean | null;
}

export interface LinkedinProviderUsage {
  provider_key: LinkedinSearchProvider;
  operation_key: string;
  /** null = costo desconocido (nunca se inventa un 0). */
  credits_used: number | null;
  status: 'success' | 'error';
  results_returned: number;
  error_code?: string;
}

export type LinkedinProviderLookup =
  | { kind: 'found'; profile: LinkedinProviderProfile; usage: LinkedinProviderUsage[] }
  | { kind: 'not_found'; usage: LinkedinProviderUsage[] }
  | { kind: 'error'; message: string; usage: LinkedinProviderUsage[] }
  /** El proveedor no está habilitado o no tiene credenciales: no se llamó. */
  | { kind: 'unavailable'; usage: LinkedinProviderUsage[] };

export interface KnownContactMatch {
  fullName: string | null;
  companyName: string | null;
}

export type HubSpotEmailCheck = 'clear' | 'unavailable' | 'skipped_no_email';

/** Lo que viaja firmado entre la búsqueda y la creación del candidato. */
export interface LinkedinSearchPreviewData {
  linkedinUrl: string;
  linkedinSlug: string;
  profile: LinkedinProviderProfile;
  /** Proveedores que se llamaron (para el run y el reporte de gasto). */
  providersCalled: LinkedinSearchProvider[];
  creditsSpent: number | null;
  searchedAt: string;
}

/** Lo que ve el usuario en la vista previa (sin la URL). */
export interface LinkedinSearchPreview {
  provider: LinkedinSearchProvider;
  fullName: string;
  title: string | null;
  providerCompanyName: string | null;
  providerCompanyDomain: string | null;
  email: string | null;
  phoneAvailable: boolean | null;
  /** Para precargar el buscador de empresa: dominio del proveedor o, si no, su nombre. */
  suggestedCompanyQuery: string;
}

export type LinkedinSearchResult =
  | { status: 'disabled' }
  | { status: 'invalid_url'; reason: LinkedinProfileUrlRejection; message: string }
  | {
      status: 'already_known';
      where: 'sellup_contact' | 'sellup_pending_candidate' | 'hubspot_contact';
      matchedBy: 'linkedin' | 'email';
      match: KnownContactMatch;
      /** true si se gastó enriqueciendo antes de descubrirlo (coincidencia por email). */
      creditsSpent: boolean;
      message: string;
    }
  | { status: 'not_found'; message: string; creditsSpent: boolean }
  | { status: 'provider_error'; message: string }
  | {
      status: 'found';
      preview: LinkedinSearchPreview;
      token: string;
      hubspotCheck: HubSpotEmailCheck;
    };

export const LINKEDIN_SEARCH_COPY = {
  disabled: 'La búsqueda por LinkedIn no está activada en este entorno.',
  notFound: 'No encontramos datos para este perfil.',
  providerError: 'No pudimos consultar los proveedores en este momento. No es que el perfil no exista: intenta de nuevo.',
  knownSellUpContact: 'Esta persona ya es un contacto en SellUp. No se gastaron créditos.',
  knownPendingCandidate: 'Esta persona ya está en «Por revisar». No se gastaron créditos.',
  knownSellUpContactByEmail:
    'El correo que encontramos ya pertenece a un contacto de SellUp. No se creó un candidato nuevo.',
  knownHubSpotByEmail:
    'El correo que encontramos ya existe en HubSpot. No se creó un candidato nuevo para no duplicarlo.',
} as const;

export interface LinkedinSearchDeps {
  isEnabled: () => boolean;
  findSellUpContactByLinkedin: (slug: string) => Promise<KnownContactMatch | null>;
  findPendingCandidateByLinkedin: (slug: string) => Promise<KnownContactMatch | null>;
  lookupApollo: (canonicalUrl: string) => Promise<LinkedinProviderLookup>;
  lookupLusha: (canonicalUrl: string) => Promise<LinkedinProviderLookup>;
  findSellUpContactByEmail: (email: string) => Promise<KnownContactMatch | null>;
  /** Lanza si HubSpot no responde: la búsqueda sigue y la sincronización al aprobar vuelve a mirar. */
  findHubSpotContactByEmail: (email: string) => Promise<KnownContactMatch | null>;
  logUsage: (usage: LinkedinProviderUsage) => Promise<void>;
  signPreview: (data: LinkedinSearchPreviewData) => string;
  nowIso: () => string;
}

/** Hay «datos» cuando el proveedor trae un canal para contactar: hoy, el email. */
export function hasContactData(profile: LinkedinProviderProfile): boolean {
  return Boolean(profile.email && profile.email.trim());
}

function sumCredits(usage: readonly LinkedinProviderUsage[]): number | null {
  let total = 0;
  for (const entry of usage) {
    if (entry.credits_used === null) return null;
    total += entry.credits_used;
  }
  return total;
}

export function buildLinkedinSearchPreview(profile: LinkedinProviderProfile): LinkedinSearchPreview {
  return {
    provider: profile.provider,
    fullName: profile.fullName,
    title: profile.title,
    providerCompanyName: profile.providerCompanyName,
    providerCompanyDomain: profile.providerCompanyDomain,
    email: profile.email,
    phoneAvailable: profile.phoneAvailable,
    suggestedCompanyQuery: profile.providerCompanyDomain?.trim() || profile.providerCompanyName?.trim() || '',
  };
}

export async function searchContactByLinkedin(
  rawUrl: unknown,
  deps: LinkedinSearchDeps,
): Promise<LinkedinSearchResult> {
  if (!deps.isEnabled()) return { status: 'disabled' };

  // 1. Validar y normalizar: una URL inválida nunca toca un proveedor.
  const normalized = normalizeLinkedinProfileUrl(typeof rawUrl === 'string' ? rawUrl : '');
  if (!normalized.ok) {
    return {
      status: 'invalid_url',
      reason: normalized.reason,
      message: LINKEDIN_PROFILE_URL_ERROR_COPY[normalized.reason],
    };
  }

  // 2. ¿Ya la conocemos por su LinkedIn? Antes de gastar.
  const contact = await deps.findSellUpContactByLinkedin(normalized.slug);
  if (contact) {
    return {
      status: 'already_known',
      where: 'sellup_contact',
      matchedBy: 'linkedin',
      match: contact,
      creditsSpent: false,
      message: LINKEDIN_SEARCH_COPY.knownSellUpContact,
    };
  }
  const pending = await deps.findPendingCandidateByLinkedin(normalized.slug);
  if (pending) {
    return {
      status: 'already_known',
      where: 'sellup_pending_candidate',
      matchedBy: 'linkedin',
      match: pending,
      creditsSpent: false,
      message: LINKEDIN_SEARCH_COPY.knownPendingCandidate,
    };
  }

  // 3. Enriquecer: Apollo primero; si no trae datos, Lusha.
  const usage: LinkedinProviderUsage[] = [];
  const providersCalled: LinkedinSearchProvider[] = [];
  const apollo = await deps.lookupApollo(normalized.canonicalUrl);
  if (apollo.kind !== 'unavailable') providersCalled.push('apollo');
  usage.push(...apollo.usage);

  let chosen: LinkedinProviderProfile | null =
    apollo.kind === 'found' && hasContactData(apollo.profile) ? apollo.profile : null;
  let lusha: LinkedinProviderLookup | null = null;
  if (!chosen) {
    lusha = await deps.lookupLusha(normalized.canonicalUrl);
    if (lusha.kind !== 'unavailable') providersCalled.push('lusha');
    usage.push(...lusha.usage);
    if (lusha.kind === 'found' && hasContactData(lusha.profile)) chosen = lusha.profile;
    // Ninguno trae email: se usa el perfil que exista (nombre y cargo), Apollo primero.
    else if (apollo.kind === 'found') chosen = apollo.profile;
    else if (lusha.kind === 'found') chosen = lusha.profile;
  }

  // El gasto se registra siempre, también cuando no se encontró nada o hubo error.
  for (const entry of usage) await deps.logUsage(entry);
  const creditsSpentTotal = sumCredits(usage);
  const spentSomething = usage.length > 0;

  if (!chosen) {
    const anyError = apollo.kind === 'error' || lusha?.kind === 'error';
    const anyRan = providersCalled.length > 0;
    if (anyError || !anyRan) {
      return { status: 'provider_error', message: LINKEDIN_SEARCH_COPY.providerError };
    }
    return { status: 'not_found', message: LINKEDIN_SEARCH_COPY.notFound, creditsSpent: spentSomething };
  }

  // 4. ¿El email encontrado ya existe? SellUp primero, luego HubSpot.
  let hubspotCheck: HubSpotEmailCheck = 'skipped_no_email';
  const email = chosen.email?.trim().toLowerCase() || null;
  if (email) {
    const sellupByEmail = await deps.findSellUpContactByEmail(email);
    if (sellupByEmail) {
      return {
        status: 'already_known',
        where: 'sellup_contact',
        matchedBy: 'email',
        match: sellupByEmail,
        creditsSpent: spentSomething,
        message: LINKEDIN_SEARCH_COPY.knownSellUpContactByEmail,
      };
    }
    try {
      const hubspot = await deps.findHubSpotContactByEmail(email);
      if (hubspot) {
        return {
          status: 'already_known',
          where: 'hubspot_contact',
          matchedBy: 'email',
          match: hubspot,
          creditsSpent: spentSomething,
          message: LINKEDIN_SEARCH_COPY.knownHubSpotByEmail,
        };
      }
      hubspotCheck = 'clear';
    } catch {
      // HubSpot caído no bloquea: al aprobar, la sincronización vuelve a buscar por email y
      // vincula en vez de duplicar (#362).
      hubspotCheck = 'unavailable';
    }
  }

  // 5. Vista previa firmada.
  const data: LinkedinSearchPreviewData = {
    linkedinUrl: normalized.canonicalUrl,
    linkedinSlug: normalized.slug,
    profile: { ...chosen, email },
    providersCalled,
    creditsSpent: creditsSpentTotal,
    searchedAt: deps.nowIso(),
  };
  return {
    status: 'found',
    preview: buildLinkedinSearchPreview(data.profile),
    token: deps.signPreview(data),
    hubspotCheck,
  };
}

// ── Paso 2: asociar a una empresa y crear el candidato ────────────────────────

export type LinkedinCandidateCreationError =
  | 'disabled'
  | 'invalid_preview'
  | 'expired_preview'
  | 'company_required'
  | 'already_pending'
  | 'request_failed'
  | 'account_unresolved'
  | 'run_failed'
  | 'insert_failed';

export const LINKEDIN_CREATE_COPY: Record<LinkedinCandidateCreationError, string> = {
  disabled: LINKEDIN_SEARCH_COPY.disabled,
  invalid_preview: 'No pudimos validar la búsqueda. Vuelve a buscar el perfil.',
  expired_preview: 'La búsqueda caducó (30 minutos). Vuelve a buscar el perfil.',
  company_required: 'Elige la empresa del contacto antes de crearlo.',
  already_pending: 'Esta persona ya está en «Por revisar».',
  request_failed: 'No pudimos preparar la empresa elegida. Intenta de nuevo.',
  account_unresolved:
    'No pudimos crear ni vincular la empresa en SellUp, así que no se creó el candidato. Intenta de nuevo o elige otra empresa.',
  run_failed: 'No pudimos registrar la búsqueda. Intenta de nuevo.',
  insert_failed: 'No pudimos crear el candidato. Intenta de nuevo.',
};

export type LinkedinCandidateCreationResult =
  | {
      ok: true;
      candidateId: string;
      runId: string;
      accountId: string;
      companyConsistency: CompanyConsistencyResult;
      message: string;
    }
  | { ok: false; error: LinkedinCandidateCreationError; message: string };

export interface LinkedinCandidateRow {
  enrichment_run_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  title: string | null;
  seniority: string | null;
  department: null;
  country: string | null;
  linkedin_url: string;
  email: string | null;
  phone: null;
  source: LinkedinSearchProvider;
  source_contact_id: string | null;
  confidence: number;
  status: 'pending_review';
  duplicate_status: 'no_match';
  enrichment_metadata: Record<string, unknown>;
}

export interface LinkedinCandidateCreationDeps {
  isEnabled: () => boolean;
  verifyPreview: (token: unknown) => { ok: true; data: LinkedinSearchPreviewData } | { ok: false; expired: boolean };
  findPendingCandidateByLinkedin: (slug: string) => Promise<KnownContactMatch | null>;
  /** Crea la request de la empresa elegida (crea o vincula la cuenta en SellUp, #587). */
  createRequest: (company: CompanyCandidate) => Promise<{ success: boolean; requestId?: string }>;
  loadRequestAccountId: (requestId: string) => Promise<string | null>;
  /** Crea el run (intento 1) de la request: hereda su account_id (RPC create_contact_enrichment_attempt). */
  createRun: (input: { requestId: string; provider: LinkedinSearchProvider }) => Promise<{ runId: string | null }>;
  insertCandidate: (row: LinkedinCandidateRow) => Promise<{ candidateId: string | null }>;
  finalizeRun: (input: {
    runId: string;
    provider: LinkedinSearchProvider;
    providersCalled: LinkedinSearchProvider[];
    creditsSpent: number | null;
    companyConsistency: CompanyConsistencyResult['status'];
  }) => Promise<void>;
}

/** Sólo se aceptan empresas reales de SellUp o HubSpot, nunca una «manual» ni vacía. */
export function isSelectableCompany(company: CompanyCandidate | null | undefined): company is CompanyCandidate {
  if (!company || !company.name?.trim()) return false;
  if (company.source === 'sellup') return Boolean(company.sellupAccountId);
  if (company.source === 'hubspot') return Boolean(company.hubspotCompanyId);
  return false;
}

/**
 * ¿La empresa elegida coincide con la que dice el proveedor? Mismo verificador que usan Apollo,
 * Lusha y «Reasignar empresa». `possible_mismatch` sugiere un cambio de trabajo.
 */
export function evaluateLinkedinCompanyConsistency(
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

export function buildLinkedinCandidateRow(input: {
  runId: string;
  data: LinkedinSearchPreviewData;
  company: CompanyCandidate;
  consistency: CompanyConsistencyResult;
}): LinkedinCandidateRow {
  const { data, company, consistency } = input;
  const p = data.profile;
  return {
    enrichment_run_id: input.runId,
    first_name: p.firstName,
    last_name: p.lastName,
    full_name: p.fullName,
    title: p.title,
    seniority: p.seniority,
    department: null,
    country: p.country ?? company.countryCode ?? null,
    linkedin_url: data.linkedinUrl,
    email: p.email,
    phone: null, // El teléfono sigue el flujo de reveal existente.
    source: p.provider,
    source_contact_id: p.sourceContactId,
    confidence: 0.9,
    status: 'pending_review',
    duplicate_status: 'no_match', // Ya se comprobó LinkedIn y email antes de gastar.
    enrichment_metadata: {
      provider: p.provider,
      entry_mode: 'linkedin_single',
      linkedin_source: 'user_input',
      organization: {
        name: p.providerCompanyName,
        website_url: p.providerCompanyWebsiteUrl,
        domain: p.providerCompanyDomain,
      },
      company_consistency: consistency,
      provider_phone_available: p.phoneAvailable,
      providers_called: data.providersCalled,
      credits_spent: data.creditsSpent,
      searched_at: data.searchedAt,
      hito: 'AGENT2A-LINKEDIN-CONTACT-SEARCH',
    },
  };
}

export async function createLinkedinContactCandidate(
  input: { token: unknown; company: CompanyCandidate | null | undefined },
  deps: LinkedinCandidateCreationDeps,
): Promise<LinkedinCandidateCreationResult> {
  const fail = (error: LinkedinCandidateCreationError): LinkedinCandidateCreationResult => ({
    ok: false,
    error,
    message: LINKEDIN_CREATE_COPY[error],
  });

  if (!deps.isEnabled()) return fail('disabled');
  const verified = deps.verifyPreview(input.token);
  if (!verified.ok) return fail(verified.expired ? 'expired_preview' : 'invalid_preview');
  const data = verified.data;

  // Sin empresa no hay candidato: el run necesita su cuenta desde el inicio.
  if (!isSelectableCompany(input.company)) return fail('company_required');
  const company = input.company;

  // Pudo entrar a «Por revisar» por otro camino mientras el usuario elegía la empresa.
  if (await deps.findPendingCandidateByLinkedin(data.linkedinSlug)) return fail('already_pending');

  const request = await deps.createRequest(company);
  if (!request.success || !request.requestId) return fail('request_failed');

  // El run nace CON account_id (evita B1b): sin cuenta resuelta no se crea nada.
  const accountId = await deps.loadRequestAccountId(request.requestId);
  if (!accountId) return fail('account_unresolved');

  const run = await deps.createRun({ requestId: request.requestId, provider: data.profile.provider });
  if (!run.runId) return fail('run_failed');

  const consistency = evaluateLinkedinCompanyConsistency(data.profile, company);
  const row = buildLinkedinCandidateRow({ runId: run.runId, data, company, consistency });
  const inserted = await deps.insertCandidate(row);
  if (!inserted.candidateId) return fail('insert_failed');

  await deps.finalizeRun({
    runId: run.runId,
    provider: data.profile.provider,
    providersCalled: data.providersCalled,
    creditsSpent: data.creditsSpent,
    companyConsistency: consistency.status,
  });

  return {
    ok: true,
    candidateId: inserted.candidateId,
    runId: run.runId,
    accountId,
    companyConsistency: consistency,
    message: `Listo. Dejé a ${data.profile.fullName} en «Por revisar» con ${company.name}. No creé el contacto final: requiere tu aprobación.`,
  };
}
