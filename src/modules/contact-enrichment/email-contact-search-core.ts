// Agente 2A — Buscar contacto por CORREO: núcleo puro (AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE).
//
// Hermano de la búsqueda por LinkedIn: misma caja del panel, mismos tipos y el mismo final
// (el candidato se crea con lo encontrado). Sin red ni Supabase: todo entra por dependencias.
//
// Orden, de lo gratis a lo pagado:
//   1. validar el correo (uno inválido no toca nada);
//   2. ¿ya es contacto de SellUp o candidato por revisar? ⇒ se avisa, cero créditos;
//   3. ¿existe en HubSpot? ⇒ el candidato sale de ESE contacto (nombre, cargo, teléfono,
//      LinkedIn, empresa asociada), cero créditos. Si es de otro vendedor activo, no se ofrece
//      (misma regla que «Primero HubSpot»). HubSpot caído no bloquea: se sigue con proveedores;
//   4. Apollo por correo; si no encuentra a la persona, Lusha por correo;
//   5. si la fuente trae un LinkedIn que ya es contacto o candidato, se avisa (ya hubo gasto).
// Sin datos ⇒ no se crea nada (decisión C de Bryan, 29-10).
//
// Datos personales: el correo no se registra en logs ni en el uso de proveedores.

import { normalizeLinkedinProfileUrl } from './linkedin-profile-url';
import {
  buildLinkedinSearchPreview,
  sumCredits,
  type HubSpotEmailCheck,
  type KnownContactMatch,
  type LinkedinProviderLookup,
  type LinkedinProviderProfile,
  type LinkedinProviderUsage,
  type LinkedinSearchProvider,
  type LinkedinSearchResult,
  type SearchedContactData,
} from './linkedin-contact-search-core';

/** Un contacto de HubSpot encontrado por correo, con lo justo para crear el candidato. */
export interface HubSpotEmailContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  phone: string | null;
  mobilePhone: string | null;
  linkedinUrl: string | null;
  ownerId: string | null;
  associatedCompanyId: string | null;
}

export type EmailSearchResult =
  | Exclude<LinkedinSearchResult, { status: 'invalid_url' }>
  | { status: 'invalid_input'; message: string };

export const EMAIL_SEARCH_COPY = {
  invalid: 'Ese correo no parece válido. Revisa que tenga la forma nombre@empresa.com.',
  notFound: 'No encontramos datos para este correo.',
  providerError: 'No pudimos consultar los proveedores en este momento. No es que el correo no exista: intenta de nuevo.',
  knownSellUpContact: 'Este correo ya pertenece a un contacto de SellUp. No se gastaron créditos.',
  knownPendingCandidate: 'Este correo ya está en «Por revisar». No se gastaron créditos.',
  hubspotOtherSeller:
    'Este correo ya existe en HubSpot y el contacto es de otro vendedor. No se creó un candidato. No se gastaron créditos.',
  knownSellUpContactByLinkedin:
    'El LinkedIn que encontramos ya pertenece a un contacto de SellUp. No se creó un candidato nuevo.',
  knownPendingCandidateByLinkedin:
    'El LinkedIn que encontramos ya está en «Por revisar». No se creó un candidato nuevo.',
} as const;

export interface EmailSearchDeps {
  isEnabled: () => boolean;
  findSellUpContactByEmail: (email: string) => Promise<KnownContactMatch | null>;
  findPendingCandidateByEmail: (email: string) => Promise<KnownContactMatch | null>;
  /** Lanza si HubSpot no responde: se sigue con los proveedores. */
  findHubSpotContactByEmail: (email: string) => Promise<HubSpotEmailContact | null>;
  /** Regla de dueño de «Primero HubSpot». Si falla al decidir, se trata como NO ofrecible. */
  isHubSpotContactOfferable: (contact: HubSpotEmailContact) => Promise<boolean>;
  lookupApollo: (email: string) => Promise<LinkedinProviderLookup>;
  lookupLusha: (email: string) => Promise<LinkedinProviderLookup>;
  findSellUpContactByLinkedin: (slug: string) => Promise<KnownContactMatch | null>;
  findPendingCandidateByLinkedin: (slug: string) => Promise<KnownContactMatch | null>;
  logUsage: (usage: LinkedinProviderUsage) => Promise<void>;
  nowIso: () => string;
}

const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

/** Correo normalizado (minúsculas, sin `mailto:` ni `<>`), o null si no es un correo. */
export function normalizeEmailInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^<|>$/g, '')
    .trim()
    .toLowerCase();
  if (!value || value.length > 254) return null;
  return EMAIL_PATTERN.test(value) ? value : null;
}

function text(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** El perfil de un contacto de HubSpot, con la forma que comparten todas las fuentes. */
export function profileFromHubSpotContact(contact: HubSpotEmailContact, email: string): LinkedinProviderProfile {
  const firstName = text(contact.firstName);
  const lastName = text(contact.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || email;
  return {
    provider: 'hubspot',
    sourceContactId: contact.id,
    firstName,
    lastName,
    fullName,
    title: text(contact.jobTitle),
    seniority: null,
    country: null,
    email,
    // HubSpot no dice «empresa actual»: la empresa es la asociada (se resuelve aparte, y si no
    // hay asociada, por el dominio del correo).
    providerCompanyName: null,
    providerCompanyDomain: null,
    providerCompanyWebsiteUrl: null,
    phoneAvailable: null,
    linkedinUrl: text(contact.linkedinUrl),
    phone: text(contact.phone) ?? text(contact.mobilePhone),
  };
}

function knownResult(
  where: 'sellup_contact' | 'sellup_pending_candidate' | 'hubspot_contact',
  matchedBy: 'linkedin' | 'email',
  match: KnownContactMatch,
  creditsSpent: boolean,
  message: string,
): EmailSearchResult {
  return { status: 'already_known', where, matchedBy, match, creditsSpent, message };
}

export async function searchContactByEmail(rawEmail: unknown, deps: EmailSearchDeps): Promise<EmailSearchResult> {
  if (!deps.isEnabled()) return { status: 'disabled' };

  // 1. Un correo inválido nunca toca nada.
  const email = normalizeEmailInput(rawEmail);
  if (!email) return { status: 'invalid_input', message: EMAIL_SEARCH_COPY.invalid };

  // 2. ¿Ya lo conocemos? Antes de gastar.
  const contact = await deps.findSellUpContactByEmail(email);
  if (contact) return knownResult('sellup_contact', 'email', contact, false, EMAIL_SEARCH_COPY.knownSellUpContact);
  const pending = await deps.findPendingCandidateByEmail(email);
  if (pending) {
    return knownResult('sellup_pending_candidate', 'email', pending, false, EMAIL_SEARCH_COPY.knownPendingCandidate);
  }

  // 3. HubSpot: si ya está, el candidato sale de ahí y no se gasta nada.
  let hubspotCheck: HubSpotEmailCheck = 'clear';
  let hubspotContact: HubSpotEmailContact | null = null;
  try {
    hubspotContact = await deps.findHubSpotContactByEmail(email);
  } catch {
    hubspotCheck = 'unavailable';
  }
  if (hubspotContact) {
    const offerable = await deps.isHubSpotContactOfferable(hubspotContact).catch(() => false);
    if (!offerable) {
      const name = [text(hubspotContact.firstName), text(hubspotContact.lastName)].filter(Boolean).join(' ') || null;
      return knownResult(
        'hubspot_contact',
        'email',
        { fullName: name, companyName: null },
        false,
        EMAIL_SEARCH_COPY.hubspotOtherSeller,
      );
    }
    const profile = profileFromHubSpotContact(hubspotContact, email);
    const linkedin = profile.linkedinUrl ? normalizeLinkedinProfileUrl(profile.linkedinUrl) : null;
    if (linkedin?.ok) {
      const known = await findKnownByLinkedin(linkedin.slug, deps, false);
      if (known) return known;
    }
    const data: SearchedContactData = {
      entryMode: 'email_single',
      linkedinUrl: linkedin?.ok ? linkedin.canonicalUrl : null,
      linkedinSlug: linkedin?.ok ? linkedin.slug : null,
      profile: { ...profile, linkedinUrl: linkedin?.ok ? linkedin.canonicalUrl : null },
      hubspotContact: { id: hubspotContact.id, associatedCompanyId: hubspotContact.associatedCompanyId },
      providersCalled: [],
      creditsSpent: 0,
      searchedAt: deps.nowIso(),
    };
    return { status: 'found', preview: buildLinkedinSearchPreview(data.profile), data, hubspotCheck: 'clear' };
  }

  // 4. Proveedores: Apollo primero; si no encuentra a la persona, Lusha.
  const usage: LinkedinProviderUsage[] = [];
  const providersCalled: LinkedinSearchProvider[] = [];
  const apollo = await deps.lookupApollo(email);
  if (apollo.kind !== 'unavailable') providersCalled.push('apollo');
  usage.push(...apollo.usage);
  let chosen: LinkedinProviderProfile | null = apollo.kind === 'found' ? apollo.profile : null;
  let lusha: LinkedinProviderLookup | null = null;
  if (!chosen) {
    lusha = await deps.lookupLusha(email);
    if (lusha.kind !== 'unavailable') providersCalled.push('lusha');
    usage.push(...lusha.usage);
    if (lusha.kind === 'found') chosen = lusha.profile;
  }

  for (const entry of usage) await deps.logUsage(entry);
  const spentSomething = usage.length > 0;

  if (!chosen) {
    const anyError = apollo.kind === 'error' || lusha?.kind === 'error';
    if (anyError || providersCalled.length === 0) {
      return { status: 'provider_error', message: EMAIL_SEARCH_COPY.providerError };
    }
    return { status: 'not_found', message: EMAIL_SEARCH_COPY.notFound, creditsSpent: spentSomething };
  }

  // 5. El LinkedIn que trajo la fuente, contra SellUp.
  const linkedin = chosen.linkedinUrl ? normalizeLinkedinProfileUrl(chosen.linkedinUrl) : null;
  if (linkedin?.ok) {
    const known = await findKnownByLinkedin(linkedin.slug, deps, spentSomething);
    if (known) return known;
  }

  const data: SearchedContactData = {
    entryMode: 'email_single',
    linkedinUrl: linkedin?.ok ? linkedin.canonicalUrl : null,
    linkedinSlug: linkedin?.ok ? linkedin.slug : null,
    // El correo del candidato es SIEMPRE el que escribió el usuario.
    profile: { ...chosen, email, linkedinUrl: linkedin?.ok ? linkedin.canonicalUrl : null },
    hubspotContact: null,
    providersCalled,
    creditsSpent: sumCredits(usage),
    searchedAt: deps.nowIso(),
  };
  return { status: 'found', preview: buildLinkedinSearchPreview(data.profile), data, hubspotCheck };
}

async function findKnownByLinkedin(
  slug: string,
  deps: Pick<EmailSearchDeps, 'findSellUpContactByLinkedin' | 'findPendingCandidateByLinkedin'>,
  creditsSpent: boolean,
): Promise<EmailSearchResult | null> {
  const contact = await deps.findSellUpContactByLinkedin(slug);
  if (contact) {
    return knownResult('sellup_contact', 'linkedin', contact, creditsSpent, EMAIL_SEARCH_COPY.knownSellUpContactByLinkedin);
  }
  const pending = await deps.findPendingCandidateByLinkedin(slug);
  if (pending) {
    return knownResult(
      'sellup_pending_candidate',
      'linkedin',
      pending,
      creditsSpent,
      EMAIL_SEARCH_COPY.knownPendingCandidateByLinkedin,
    );
  }
  return null;
}
