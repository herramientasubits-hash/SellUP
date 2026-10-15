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
import { classifyContactRelevance } from './contact-relevance-classifier';

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

export interface HubSpotFirstSelection {
  rows: HubSpotFirstCandidateRow[];
  /** Cuántos de esos tienen correo: lo que cuenta para saltarse a los proveedores. */
  relevantWithEmail: number;
  skippedNoName: number;
  skippedKnownInSellUp: number;
  skippedNotRelevant: number;
  skippedAlreadyInRun: number;
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
  };
  const seenInThisBatch = new Set<string>();

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
    result.rows.push({
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
    });
  }
  return result;
}

/** ¿HubSpot ya trae suficientes contactos relevantes como para no gastar proveedores? */
export function isSatisfiedByHubSpot(
  relevantWithEmail: number,
  min: number = HUBSPOT_FIRST_MIN_RELEVANT_WITH_EMAIL,
): boolean {
  return relevantWithEmail >= min;
}
