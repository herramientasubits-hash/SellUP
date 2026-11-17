// Agente 2A — Buscar contacto por su ID de HubSpot: núcleo puro (Bryan 17-11).
//
// Tercera entrada de la búsqueda puntual (junto a LinkedIn y correo), en la misma caja del
// panel. Si el contacto no está en SellUp, lo trae de HubSpot y crea el candidato en «Por
// revisar», igual que la búsqueda por correo cuando el correo ya está en HubSpot. Nunca llama a
// Apollo ni a Lusha: CERO créditos siempre.
//
// Orden:
//   1. ¿ya es contacto de SellUp (`contacts.hubspot_contact_id`)? ⇒ «ya está aprobado»;
//   2. ¿ya hubo un candidato de ese contacto de HubSpot? Por revisar ⇒ se avisa (y se ofrece
//      abrirlo); aprobado ⇒ «ya fue aprobado»; rechazado ⇒ «ya fue rechazado». Sólo se avisa:
//      no se crea otro (decisión 4 de Bryan, 17-11);
//   3. HubSpot por ID: no existe ⇒ se dice (quizá era el ID de una empresa); HubSpot caído ⇒
//      «no pudimos consultar», que no es «no existe»;
//   4. el correo y el LinkedIn del contacto, contra SellUp y «Por revisar»;
//   5. regla de dueño de «Primero HubSpot»: de otro vendedor activo ⇒ no se ofrece;
//   6. el candidato sale de ese contacto (empresa = su empresa asociada en HubSpot).
//
// Sin red ni Supabase: todo entra por dependencias.

import { normalizeLinkedinProfileUrl } from './linkedin-profile-url';
import { profileFromHubSpotContact, type HubSpotEmailContact } from './email-contact-search-core';
import {
  buildLinkedinSearchPreview,
  type KnownContactMatch,
  type LinkedinSearchPreview,
  type SearchedContactData,
} from './linkedin-contact-search-core';

/** Un contacto de HubSpot leído por su ID (con su correo, que puede no tener). */
export interface HubSpotIdContact extends HubSpotEmailContact {
  email: string | null;
}

/** Estado de un candidato que ya salió de este contacto de HubSpot. */
export type KnownCandidateStatus = 'pending_review' | 'approved' | 'discarded';

export interface KnownCandidateMatch extends KnownContactMatch {
  status: KnownCandidateStatus;
}

export type HubSpotIdKnownWhere =
  | 'sellup_contact'
  | 'sellup_pending_candidate'
  | 'sellup_approved_candidate'
  | 'sellup_discarded_candidate'
  | 'hubspot_contact';

export type HubSpotIdSearchResult =
  | { status: 'disabled' }
  | { status: 'invalid_input'; message: string }
  | {
      status: 'already_known';
      where: HubSpotIdKnownWhere;
      matchedBy: 'hubspot_id' | 'email' | 'linkedin';
      match: KnownContactMatch;
      creditsSpent: false;
      message: string;
    }
  | { status: 'not_found'; message: string; creditsSpent: false }
  | { status: 'provider_error'; message: string }
  | { status: 'found'; preview: LinkedinSearchPreview; data: SearchedContactData; hubspotCheck: 'clear' };

export const HUBSPOT_ID_SEARCH_COPY = {
  invalid: 'Ese ID de HubSpot no parece válido: debe tener solo números.',
  notFound:
    'No hay un contacto con ese ID en HubSpot. Si es el ID de una empresa, búscala en «Contactos de una empresa».',
  hubspotUnavailable:
    'No pudimos consultar HubSpot en este momento. No es que el contacto no exista: intenta de nuevo.',
  knownSellUpContact: 'Este contacto ya está aprobado: ya es contacto de SellUp. No se gastaron créditos.',
  knownApprovedCandidate: 'Este contacto ya fue aprobado. No se gastaron créditos.',
  knownDiscardedCandidate:
    'Este contacto ya fue rechazado en una revisión anterior, así que no lo vuelvo a dejar en «Por revisar». No se gastaron créditos.',
  knownPendingCandidate: 'Este contacto ya está en «Por revisar». No se gastaron créditos.',
  knownSellUpContactByEmail: 'El correo de este contacto ya pertenece a un contacto de SellUp. No se gastaron créditos.',
  knownPendingCandidateByEmail: 'El correo de este contacto ya está en «Por revisar». No se gastaron créditos.',
  knownSellUpContactByLinkedin:
    'El LinkedIn de este contacto ya pertenece a un contacto de SellUp. No se gastaron créditos.',
  knownPendingCandidateByLinkedin: 'El LinkedIn de este contacto ya está en «Por revisar». No se gastaron créditos.',
  hubspotOtherSeller:
    'Este contacto de HubSpot es de otro vendedor. No se creó un candidato. No se gastaron créditos.',
} as const;

export interface HubSpotIdSearchDeps {
  isEnabled: () => boolean;
  findSellUpContactByHubSpotId: (hubspotContactId: string) => Promise<KnownContactMatch | null>;
  /** El candidato de ese contacto de HubSpot (uno por revisar manda; si no, el más reciente). */
  findCandidateByHubSpotId: (hubspotContactId: string) => Promise<KnownCandidateMatch | null>;
  /** null ⇒ HubSpot dice que no existe. LANZA si HubSpot no responde. */
  findHubSpotContactById: (hubspotContactId: string) => Promise<HubSpotIdContact | null>;
  /** Regla de dueño de «Primero HubSpot». Si falla al decidir, se trata como NO ofrecible. */
  isHubSpotContactOfferable: (contact: HubSpotIdContact) => Promise<boolean>;
  findSellUpContactByEmail: (email: string) => Promise<KnownContactMatch | null>;
  findPendingCandidateByEmail: (email: string) => Promise<KnownContactMatch | null>;
  findSellUpContactByLinkedin: (slug: string) => Promise<KnownContactMatch | null>;
  findPendingCandidateByLinkedin: (slug: string) => Promise<KnownContactMatch | null>;
  nowIso: () => string;
}

const HUBSPOT_ID_RE = /^\d{3,20}$/;

function known(
  where: HubSpotIdKnownWhere,
  matchedBy: 'hubspot_id' | 'email' | 'linkedin',
  match: KnownContactMatch,
  message: string,
): HubSpotIdSearchResult {
  return { status: 'already_known', where, matchedBy, match, creditsSpent: false, message };
}

function text(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** El aviso según cómo terminó el candidato anterior de este contacto. */
function knownCandidateResult(candidate: KnownCandidateMatch): HubSpotIdSearchResult {
  const match: KnownContactMatch = {
    fullName: candidate.fullName,
    companyName: candidate.companyName,
    candidateId: candidate.status === 'pending_review' ? (candidate.candidateId ?? null) : null,
  };
  if (candidate.status === 'pending_review') {
    return known('sellup_pending_candidate', 'hubspot_id', match, HUBSPOT_ID_SEARCH_COPY.knownPendingCandidate);
  }
  if (candidate.status === 'approved') {
    return known('sellup_approved_candidate', 'hubspot_id', match, HUBSPOT_ID_SEARCH_COPY.knownApprovedCandidate);
  }
  return known('sellup_discarded_candidate', 'hubspot_id', match, HUBSPOT_ID_SEARCH_COPY.knownDiscardedCandidate);
}

export async function searchContactByHubSpotId(rawId: unknown, deps: HubSpotIdSearchDeps): Promise<HubSpotIdSearchResult> {
  if (!deps.isEnabled()) return { status: 'disabled' };
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!HUBSPOT_ID_RE.test(id)) return { status: 'invalid_input', message: HUBSPOT_ID_SEARCH_COPY.invalid };

  // 1–2. ¿Ya lo conocemos por su ID de HubSpot?
  const contact = await deps.findSellUpContactByHubSpotId(id);
  if (contact) return known('sellup_contact', 'hubspot_id', contact, HUBSPOT_ID_SEARCH_COPY.knownSellUpContact);
  const candidate = await deps.findCandidateByHubSpotId(id);
  if (candidate) return knownCandidateResult(candidate);

  // 3. HubSpot por ID. Caído no es «no existe».
  let hubspot: HubSpotIdContact | null;
  try {
    hubspot = await deps.findHubSpotContactById(id);
  } catch {
    return { status: 'provider_error', message: HUBSPOT_ID_SEARCH_COPY.hubspotUnavailable };
  }
  if (!hubspot) return { status: 'not_found', message: HUBSPOT_ID_SEARCH_COPY.notFound, creditsSpent: false };

  // HubSpot devuelve el contacto vigente (un ID fusionado lleva al que quedó): si cambió, se
  // vuelve a mirar SellUp con el ID vigente.
  if (hubspot.id !== id) {
    const merged = await deps.findSellUpContactByHubSpotId(hubspot.id);
    if (merged) return known('sellup_contact', 'hubspot_id', merged, HUBSPOT_ID_SEARCH_COPY.knownSellUpContact);
    const mergedCandidate = await deps.findCandidateByHubSpotId(hubspot.id);
    if (mergedCandidate) return knownCandidateResult(mergedCandidate);
  }

  // 4. El correo y el LinkedIn del contacto, contra SellUp y «Por revisar».
  const email = text(hubspot.email)?.toLowerCase() ?? null;
  if (email) {
    const byEmail = await deps.findSellUpContactByEmail(email);
    if (byEmail) return known('sellup_contact', 'email', byEmail, HUBSPOT_ID_SEARCH_COPY.knownSellUpContactByEmail);
    const pendingByEmail = await deps.findPendingCandidateByEmail(email);
    if (pendingByEmail) {
      return known('sellup_pending_candidate', 'email', pendingByEmail, HUBSPOT_ID_SEARCH_COPY.knownPendingCandidateByEmail);
    }
  }
  const linkedin = hubspot.linkedinUrl ? normalizeLinkedinProfileUrl(hubspot.linkedinUrl) : null;
  if (linkedin?.ok) {
    const byLinkedin = await deps.findSellUpContactByLinkedin(linkedin.slug);
    if (byLinkedin) {
      return known('sellup_contact', 'linkedin', byLinkedin, HUBSPOT_ID_SEARCH_COPY.knownSellUpContactByLinkedin);
    }
    const pendingByLinkedin = await deps.findPendingCandidateByLinkedin(linkedin.slug);
    if (pendingByLinkedin) {
      return known(
        'sellup_pending_candidate',
        'linkedin',
        pendingByLinkedin,
        HUBSPOT_ID_SEARCH_COPY.knownPendingCandidateByLinkedin,
      );
    }
  }

  // 5. Regla de dueño de «Primero HubSpot».
  const offerable = await deps.isHubSpotContactOfferable(hubspot).catch(() => false);
  if (!offerable) {
    const name = [text(hubspot.firstName), text(hubspot.lastName)].filter(Boolean).join(' ') || null;
    return known('hubspot_contact', 'hubspot_id', { fullName: name, companyName: null }, HUBSPOT_ID_SEARCH_COPY.hubspotOtherSeller);
  }

  // 6. El candidato sale de ese contacto: cero créditos.
  const profile = profileFromHubSpotContact(hubspot, email);
  const data: SearchedContactData = {
    entryMode: 'hubspot_id_single',
    linkedinUrl: linkedin?.ok ? linkedin.canonicalUrl : null,
    linkedinSlug: linkedin?.ok ? linkedin.slug : null,
    profile: { ...profile, linkedinUrl: linkedin?.ok ? linkedin.canonicalUrl : null },
    hubspotContact: { id: hubspot.id, associatedCompanyId: hubspot.associatedCompanyId },
    providersCalled: [],
    creditsSpent: 0,
    searchedAt: deps.nowIso(),
  };
  return { status: 'found', preview: buildLinkedinSearchPreview(data.profile), data, hubspotCheck: 'clear' };
}
