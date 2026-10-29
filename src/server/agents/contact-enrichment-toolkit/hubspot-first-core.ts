// AGENT2-HUBSPOT-FIRST-1 — «Primero HubSpot» (núcleo puro)
//
// Antes de pagar Apollo o Lusha, los contactos que YA están en HubSpot para la empresa se
// ofrecen como candidatos a revisión (gratis). Este núcleo decide cuáles entran y si bastan
// para no gastar proveedores. Sin red ni Supabase.
//
// Qué entra: contactos de HubSpot con nombre, que no existan ya como contacto de SellUp
// (por correo o LinkedIn) y que el clasificador de relevancia considere del perfil que busca
// UBITS (RR. HH. / People / Learning). Qué NO hace: crear contactos finales ni escribir en
// HubSpot — el candidato queda en `pending_review` y lo aprueba una persona.

import type { ExistingContactSnapshot } from '@/modules/contact-enrichment/types';
import type { HubSpotOwnerDirectory } from '@/server/integrations/hubspot-free-company-policy';
import { classifyContactRelevance, type ContactRelevanceCategory } from './contact-relevance-classifier';

/**
 * Cuántos contactos relevantes CON CORREO de HubSpot bastan para no llamar a los proveedores.
 * Por debajo de esto se corre Apollo/Lusha como siempre, y los de HubSpot quedan en la misma
 * lista de revisión.
 */
export const HUBSPOT_FIRST_MIN_RELEVANT_WITH_EMAIL = 3;

export interface HubSpotFirstCandidateRow {
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  title: string | null;
  seniority: null;
  department: null;
  country: null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  source: 'hubspot';
  source_contact_id: string;
  matched_hubspot_contact_id: string;
  confidence: number;
  status: 'pending_review';
  duplicate_status: 'no_match';
  enrichment_metadata: Record<string, unknown>;
}

/**
 * AGENT2-HUBSPOT-FIRST-OWNERSHIP-1 — de quién es cada contacto en HubSpot. Un contacto de OTRO
 * vendedor activo no se ofrece (misma regla que la toma de empresas libres): sí los sin dueño,
 * los de una bolsa, los de un dueño desactivado y los del propio vendedor.
 */
export interface HubSpotFirstOwnership {
  /** Dueño de HubSpot del vendedor que busca; null si no se pudo saber. */
  sellerOwnerId: string | null;
  /** Directorio de dueños; null si HubSpot no lo devolvió (entonces sólo pasan sin dueño o propios). */
  directory: HubSpotOwnerDirectory | null;
  /**
   * Dueño de HubSpot del vendedor dueño de la FICHA en SellUp (AGENT2-HUBSPOT-FIRST-ACCOUNT-OWNER-1).
   * Decisión de la dueña 22-10: sus contactos se ofrecen aunque busque otra persona (un líder, la
   * dueña). Grupo LALA: 99 de 100 contactos eran del dueño de la ficha y se descartaban.
   */
  accountOwnerId?: string | null;
}

export function isOfferableHubSpotContact(ownerId: string | null | undefined, ownership: HubSpotFirstOwnership): boolean {
  const owner = ownerId?.trim() || null;
  if (owner === null) return true;
  if (ownership.sellerOwnerId && owner === ownership.sellerOwnerId) return true;
  if (ownership.accountOwnerId && owner === ownership.accountOwnerId) return true;
  const directory = ownership.directory;
  return !!directory && (directory.poolIds.has(owner) || directory.deactivatedIds.has(owner));
}

const LEADERSHIP_TITLE =
  /\b(chro|cpo|vp|vice ?presiden|director|directora|gerente|subgerente|head|jef[ea]|l[ií]der|lead|manager|chief|presidente)/i;

/**
 * Orden en que conviene revisar (menor = antes). Primero quien decide la formación (líder de
 * formación/aprendizaje), luego quien lidera RR. HH./talento/cultura, luego la gerencia general,
 * y al final los cargos operativos. Puro y estable: sólo depende del cargo y la categoría.
 */
export function hubspotFirstPriority(title: string | null | undefined, category: ContactRelevanceCategory | null): number {
  const leader = LEADERSHIP_TITLE.test(title ?? '');
  if (category === 'learning') return leader ? 0 : 3;
  if (category === 'hr' || category === 'people' || category === 'talent' || category === 'culture') return leader ? 1 : 4;
  if (category === 'executive_sponsor') return 2;
  return leader ? 4 : 5;
}

export interface HubSpotFirstSelection {
  rows: HubSpotFirstCandidateRow[];
  /** Cuántos de esos tienen correo: lo que cuenta para saltarse a los proveedores. */
  relevantWithEmail: number;
  skippedNoName: number;
  skippedKnownInSellUp: number;
  skippedNotRelevant: number;
  skippedAlreadyInRun: number;
  /**
   * AGENT2A-COMPANY-SEARCH-COUNTS — ya estaban en «Por revisar» de una búsqueda ANTERIOR. Antes
   * se volvían a insertar en cada búsqueda y la misma persona quedaba dos veces por revisar.
   */
  skippedAlreadyPending: number;
  /** AGENT2-HUBSPOT-FIRST-OWNERSHIP-1 — contactos de otro vendedor activo en HubSpot. */
  skippedOtherSeller: number;
}

function emailKey(value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase();
  return key ? key : null;
}

function linkedinKey(value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase().replace(/\/+$/, '');
  return key ? key : null;
}

export function selectHubSpotFirstCandidates(input: {
  hubspotContacts: readonly ExistingContactSnapshot[];
  sellupContacts: readonly ExistingContactSnapshot[];
  /** IDs de HubSpot que ya son candidatos de esta corrida (reintento idempotente). */
  alreadyInRunHubspotIds: ReadonlySet<string>;
  /** IDs de HubSpot que ya esperan revisión en OTRA corrida (búsquedas anteriores). */
  alreadyPendingHubspotIds?: ReadonlySet<string>;
  /** Sin esto no se filtra por dueño (pruebas antiguas); la etapa siempre lo pasa. */
  ownership?: HubSpotFirstOwnership;
}): HubSpotFirstSelection {
  const knownEmails = new Set(input.sellupContacts.map((c) => emailKey(c.email)).filter((k): k is string => k !== null));
  const knownLinkedin = new Set(
    input.sellupContacts.map((c) => linkedinKey(c.linkedinUrl)).filter((k): k is string => k !== null),
  );

  const result: HubSpotFirstSelection = {
    rows: [],
    relevantWithEmail: 0,
    skippedNoName: 0,
    skippedKnownInSellUp: 0,
    skippedNotRelevant: 0,
    skippedAlreadyInRun: 0,
    skippedAlreadyPending: 0,
    skippedOtherSeller: 0,
  };
  const seenInThisBatch = new Set<string>();
  const priorities = new Map<HubSpotFirstCandidateRow, number>();

  for (const contact of input.hubspotContacts) {
    const hubspotId = contact.id?.trim();
    const fullName = contact.fullName?.trim();
    // `normalizeContactSnapshot` rellena «HubSpot Contact <id>» cuando no hay nombre: no es un nombre.
    if (!hubspotId || !fullName || fullName.startsWith('HubSpot Contact ')) {
      result.skippedNoName += 1;
      continue;
    }
    if (input.alreadyInRunHubspotIds.has(hubspotId) || seenInThisBatch.has(hubspotId)) {
      result.skippedAlreadyInRun += 1;
      continue;
    }
    if (input.alreadyPendingHubspotIds?.has(hubspotId)) {
      result.skippedAlreadyPending += 1;
      continue;
    }
    if (input.ownership && !isOfferableHubSpotContact(contact.ownerId, input.ownership)) {
      result.skippedOtherSeller += 1;
      continue;
    }
    const email = emailKey(contact.email);
    const linkedin = linkedinKey(contact.linkedinUrl);
    if ((email && knownEmails.has(email)) || (linkedin && knownLinkedin.has(linkedin))) {
      result.skippedKnownInSellUp += 1;
      continue;
    }
    const relevance = classifyContactRelevance({
      fullName,
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title,
      email: contact.email,
      linkedinUrl: contact.linkedinUrl,
      phone: contact.phone,
    });
    if (!relevance.shouldInsertForReview) {
      result.skippedNotRelevant += 1;
      continue;
    }
    seenInThisBatch.add(hubspotId);
    if (email) result.relevantWithEmail += 1;
    const row: HubSpotFirstCandidateRow = {
      first_name: contact.firstName ?? null,
      last_name: contact.lastName ?? null,
      full_name: fullName,
      title: contact.title ?? null,
      seniority: null,
      department: null,
      country: null,
      linkedin_url: contact.linkedinUrl ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      source: 'hubspot',
      source_contact_id: hubspotId,
      matched_hubspot_contact_id: hubspotId,
      // Es un registro real de HubSpot, no una inferencia de un proveedor.
      confidence: 1,
      status: 'pending_review',
      duplicate_status: 'no_match',
      enrichment_metadata: {
        hubspot_first: true,
        hubspot_contact_id: hubspotId,
        relevance: {
          status: relevance.relevanceStatus,
          category: relevance.matchedCategory,
          score: relevance.relevanceScore,
        },
      },
    };
    priorities.set(row, hubspotFirstPriority(contact.title, relevance.matchedCategory));
    result.rows.push(row);
  }
  // Lo más importante primero (Array.prototype.sort es estable: empate ⇒ orden de HubSpot).
  result.rows.sort((a, b) => (priorities.get(a) ?? 9) - (priorities.get(b) ?? 9));
  return result;
}

/** ¿HubSpot ya trae suficientes contactos relevantes como para no gastar proveedores? */
export function isSatisfiedByHubSpot(
  relevantWithEmail: number,
  min: number = HUBSPOT_FIRST_MIN_RELEVANT_WITH_EMAIL,
): boolean {
  return relevantWithEmail >= min;
}
