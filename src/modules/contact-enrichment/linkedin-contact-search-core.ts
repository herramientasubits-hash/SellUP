// Agente 2A — Buscar contacto por LinkedIn: núcleo puro (F2 · AGENT2A-LINKEDIN-CONTACT-SEARCH).
//
// Sin red ni Supabase: todo lo de afuera entra por dependencias, para probar el flujo completo
// con dobles.
//
//   searchContactByLinkedin — URL → validar/normalizar → ¿ya existe en SellUp (contactos o
//   candidatos por revisar) por su LinkedIn? → enriquecer (Apollo; si no trae datos, Lusha)
//   → ¿el email encontrado ya existe en SellUp o en HubSpot? → datos encontrados.
//
// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE: ya no hay vista previa firmada ni un segundo paso que
// espere al usuario. Con datos, la misma acción resuelve la empresa y crea el candidato
// (`contact-quick-search-candidate-core.ts`): si el usuario no decide, queda en «Por revisar».
// La búsqueda por correo (`email-contact-search-core.ts`) comparte estos tipos.
//
// Reglas de gasto:
//   - URL inválida o persona ya conocida por su LinkedIn ⇒ ningún proveedor, cero créditos;
//   - el email se compara contra SellUp y HubSpot DESPUÉS de enriquecer (es el dato que trae el
//     proveedor): si ya existe, no se crea candidato y se avisa del gasto hecho;
//   - crear el candidato no vuelve a llamar a ningún proveedor.
//   - el duplicado por correo contra HubSpot se queda como estaba (decisión de Bryan, 29-10):
//     si el correo encontrado ya existe en HubSpot, no se crea candidato.
//
// Pendiente (BACKLOG F2-b): buscar en HubSpot por la URL (`hs_linkedin_url`) antes de gastar,
// con la URL normalizada en los dos lados; y la decisión 2 (asociar un contacto existente a
// otra empresa). Hoy ninguno de los dos ocurre aquí.
//
// Datos personales: la URL de LinkedIn no se registra en logs ni en el uso de proveedores.

import {
  LINKEDIN_PROFILE_URL_ERROR_COPY,
  normalizeLinkedinProfileUrl,
  type LinkedinProfileUrlRejection,
} from './linkedin-profile-url';

export type LinkedinSearchProvider = 'apollo' | 'lusha';

/** De dónde salen los datos del candidato: un proveedor pagado o un contacto que ya está en HubSpot. */
export type ContactSearchSource = LinkedinSearchProvider | 'hubspot';

/** Por dónde entró la búsqueda puntual. */
export type ContactSearchEntryMode = 'linkedin_single' | 'email_single';

/**
 * Lo que se sabe de la persona. Los proveedores nunca traen teléfonos (siguen el flujo de
 * reveal); sólo un contacto de HubSpot puede llegar con el teléfono que ya tiene el CRM.
 */
export interface LinkedinProviderProfile {
  provider: ContactSearchSource;
  /** Id de la persona en la fuente (Apollo person id / Lusha contact id / HubSpot contact id). */
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
  /** LinkedIn que reporta la fuente (en la búsqueda por LinkedIn manda la URL pegada). */
  linkedinUrl?: string | null;
  /** Sólo HubSpot: el teléfono que ya tiene el contacto en el CRM. */
  phone?: string | null;
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
  /** Sólo candidatos por revisar: su id, para ofrecer «Abrir candidato» si el usuario lo puede ver. */
  candidateId?: string | null;
}

export type HubSpotEmailCheck = 'clear' | 'unavailable' | 'skipped_no_email';

/** Lo que la búsqueda encontró y con lo que se crea el candidato (no sale al navegador). */
export interface SearchedContactData {
  entryMode: ContactSearchEntryMode;
  /** LinkedIn canónico: el pegado o el que trajo la fuente. null si nadie lo conoce. */
  linkedinUrl: string | null;
  linkedinSlug: string | null;
  profile: LinkedinProviderProfile;
  /** Sólo cuando los datos salen de un contacto que ya está en HubSpot. */
  hubspotContact?: { id: string; associatedCompanyId: string | null } | null;
  /** Proveedores que se llamaron (para el run y el reporte de gasto). */
  providersCalled: LinkedinSearchProvider[];
  creditsSpent: number | null;
  searchedAt: string;
}

/** Lo que ve el usuario en la vista previa (sin la URL). */
export interface LinkedinSearchPreview {
  provider: ContactSearchSource;
  fullName: string;
  title: string | null;
  providerCompanyName: string | null;
  providerCompanyDomain: string | null;
  email: string | null;
  phoneAvailable: boolean | null;
  /** ¿La fuente trajo un LinkedIn? (nunca la URL: dato personal). */
  hasLinkedin: boolean;
  /** ¿Ya hay un teléfono (sólo contactos de HubSpot)? */
  hasPhone: boolean;
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
      data: SearchedContactData;
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
  nowIso: () => string;
}

/** Hay «datos» cuando el proveedor trae un canal para contactar: hoy, el email. */
export function hasContactData(profile: LinkedinProviderProfile): boolean {
  return Boolean(profile.email && profile.email.trim());
}

export function sumCredits(usage: readonly LinkedinProviderUsage[]): number | null {
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
    hasLinkedin: Boolean(profile.linkedinUrl?.trim()),
    hasPhone: Boolean(profile.phone?.trim()),
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

  // 5. Datos encontrados: la acción crea el candidato con ellos.
  const data: SearchedContactData = {
    entryMode: 'linkedin_single',
    linkedinUrl: normalized.canonicalUrl,
    linkedinSlug: normalized.slug,
    // El LinkedIn del candidato es SIEMPRE el que pegó el usuario.
    profile: { ...chosen, email, linkedinUrl: normalized.canonicalUrl },
    hubspotContact: null,
    providersCalled,
    creditsSpent: creditsSpentTotal,
    searchedAt: deps.nowIso(),
  };
  return {
    status: 'found',
    preview: buildLinkedinSearchPreview(data.profile),
    data,
    hubspotCheck,
  };
}
