// Agente 2A — Búsqueda por LinkedIn: el LinkedIn buscado se guarda en la persona que ya existía
// (AGENT2A-LINKEDIN-SEARCH-ATTACH-EXISTING). Núcleo puro.
//
// Caso (Bryan 17-11): busco por LinkedIn, el proveedor trae el correo y ese correo ya pertenece a
// un candidato «Por revisar» (traído de HubSpot o creado antes) o a un contacto aprobado de
// SellUp. Antes el LinkedIn buscado se descartaba y había que pagar «Volver a revelar LinkedIn».
// Ahora se guarda en el momento, sin avisarlo en el chat:
//
//   - sin LinkedIn ⇒ se guarda (`set`);
//   - con OTRO LinkedIn ⇒ se REEMPLAZA (`replaced`, decisión 1 de Bryan): el usuario lo acaba de
//     buscar y el proveedor confirmó que ese perfil es el dueño del correo;
//   - con el mismo ⇒ no se escribe (`unchanged`).
//
// HubSpot (decisión 2): se envía en el momento con la regla de siempre, SÓLO si `hs_linkedin_url`
// está vacío allá o si allá hay OTRO perfil (Bryan 17-11: el LinkedIn encontrado reemplaza uno
// distinto; el mismo perfil escrito de otra forma no se reescribe). Si no llega (HubSpot caído, contacto sin
// vínculo), la aprobación vuelve a mirar: el completado de vacíos del autosync lleva
// `contacts.linkedin_url` a `hs_linkedin_url` cuando HubSpot no lo tiene.
//
// Contacto aprobado (decisión 3): mismo guardado sobre `contacts.linkedin_url` — por el escritor
// oficial de contactos (`updateContact`), no por uno nuevo — y el mismo envío a su contacto de
// HubSpot (`contacts.hubspot_contact_id`). El chat ya dice cuál es el contacto y ofrece
// «Abrir contacto».
//
// Escritura condicionada: sólo si el LinkedIn guardado sigue siendo el que se leyó (otro proceso
// pudo escribirlo entre la lectura y este punto). NUNCA lanza: la búsqueda ya ocurrió y ya se
// cobró; guardar el LinkedIn es un extra. Sin URLs en el rastro (dato personal).

import { buildCandidateRevealFill } from './candidate-reveal-hubspot-push-core';
import { linkedinProfileKey } from './linkedin-profile-url';
import type {
  HubSpotContactFillProperties,
  HubSpotExistingContactMatch,
  HubSpotFillEmptyPropertyName,
} from '@/modules/contacts/contact-hubspot-sync-core';

export const LINKEDIN_ATTACH_HITO = 'AGENT2A-LINKEDIN-SEARCH-ATTACH-EXISTING' as const;

/** Clave en `enrichment_metadata` del candidato donde queda el rastro (sin la URL). */
export const LINKEDIN_ATTACH_METADATA_KEY = 'quick_search_linkedin_attach';

export type LinkedinAttachAction = 'set' | 'replaced' | 'unchanged';

export type LinkedinAttachOutcome =
  | LinkedinAttachAction
  /** La URL buscada no es un perfil válido (no debería pasar: ya se normalizó). */
  | 'invalid_url'
  /** El registro no existe (o ya no está «Por revisar» / está archivado). */
  | 'not_found'
  /** Otro proceso cambió el LinkedIn entre la lectura y la escritura: no se pisa. */
  | 'conflict'
  | 'failed';

export type HubSpotLinkedinFillOutcome =
  | 'filled'
  /** HubSpot ya tiene un LinkedIn (el mismo u otro): nunca se pisa. */
  | 'nothing_to_fill'
  | 'not_in_hubspot'
  | 'hubspot_unavailable'
  | 'hubspot_contact_unreadable'
  | 'failed';

function clean(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** ¿Qué hacer con el LinkedIn guardado? `null` = la URL buscada no es un perfil. */
export function planLinkedinAttach(
  current: string | null | undefined,
  searched: string | null | undefined,
): LinkedinAttachAction | null {
  const searchedKey = linkedinProfileKey(searched);
  if (!searchedKey || !clean(searched)) return null;
  if (!clean(current)) return 'set';
  return linkedinProfileKey(current) === searchedKey ? 'unchanged' : 'replaced';
}

// ── HubSpot: sólo `hs_linkedin_url`, si está vacío o es otro perfil ─────────────────

export interface HubSpotLinkedinFillDeps {
  checkConnection: () => Promise<{ connected: boolean; canWriteContacts: boolean }>;
  findHubSpotContactById: (hubspotContactId: string) => Promise<HubSpotExistingContactMatch | null>;
  fillEmptyHubSpotContactProperties: (
    hubspotContactId: string,
    properties: HubSpotContactFillProperties,
  ) => Promise<{ ok: true; written: HubSpotFillEmptyPropertyName[] } | { error: string }>;
}

/**
 * Completa `hs_linkedin_url` del contacto de HubSpot si está vacío, o lo reemplaza si es OTRO perfil
 * (Bryan 17-11). Misma normalización que el envío de lo revelado. NUNCA lanza.
 */
export async function fillHubSpotContactLinkedin(
  hubspotContactId: string | null | undefined,
  linkedinUrl: string | null | undefined,
  deps: HubSpotLinkedinFillDeps,
): Promise<HubSpotLinkedinFillOutcome> {
  const id = clean(hubspotContactId);
  if (!id) return 'not_in_hubspot';
  const url = clean(linkedinUrl);
  if (!url) return 'nothing_to_fill';
  let existing: HubSpotExistingContactMatch | null;
  try {
    const connection = await deps.checkConnection();
    if (!connection.connected || !connection.canWriteContacts) return 'hubspot_unavailable';
    existing = await deps.findHubSpotContactById(id);
  } catch {
    return 'hubspot_contact_unreadable';
  }
  if (!existing) return 'hubspot_contact_unreadable';
  // El LinkedIn buscado reemplaza en HubSpot uno distinto (Bryan 17-11); el mismo perfil no se reescribe.
  const fill = buildCandidateRevealFill({ id, phone: null, linkedinUrl: url }, existing, undefined, {
    replaceDifferentLinkedin: true,
  });
  // No se pudo leer qué está vacío: no se escribe.
  if (fill === null) return 'hubspot_contact_unreadable';
  if (!fill.hs_linkedin_url) return 'nothing_to_fill';
  try {
    const written = await deps.fillEmptyHubSpotContactProperties(existing.id, { hs_linkedin_url: fill.hs_linkedin_url });
    if ('error' in written) return 'failed';
    return written.written.includes('hs_linkedin_url') ? 'filled' : 'nothing_to_fill';
  } catch {
    return 'failed';
  }
}

// ── Candidato «Por revisar» ───────────────────────────────────────────────────

export interface LinkedinAttachCandidate {
  id: string;
  status: string | null;
  linkedinUrl: string | null;
  enrichmentMetadata: Record<string, unknown>;
}

export interface CandidateLinkedinAttachDeps {
  nowIso: string;
  loadCandidate: (candidateId: string) => Promise<LinkedinAttachCandidate | null>;
  /**
   * Escribe el LinkedIn SÓLO si el guardado sigue siendo `expectedCurrent` (tal cual se leyó;
   * null = vacío). Devuelve true si escribió la fila.
   */
  writeCandidateLinkedin: (
    candidateId: string,
    input: { linkedinUrl: string; expectedCurrent: string | null; enrichmentMetadata: Record<string, unknown> },
  ) => Promise<boolean>;
  /** El envío de lo revelado al contacto de HubSpot del candidato (sólo vacíos; nunca lanza). */
  pushToHubSpot: (candidateId: string) => Promise<void>;
}

export function writeLinkedinAttachTrace(
  metadata: Record<string, unknown>,
  action: Exclude<LinkedinAttachAction, 'unchanged'>,
  nowIso: string,
): Record<string, unknown> {
  return {
    ...metadata,
    [LINKEDIN_ATTACH_METADATA_KEY]: {
      hito: LINKEDIN_ATTACH_HITO,
      at: nowIso,
      action,
      source: 'linkedin_quick_search',
    },
  };
}

export async function attachSearchedLinkedinToCandidate(
  input: { candidateId: string; linkedinUrl: string },
  deps: CandidateLinkedinAttachDeps,
): Promise<LinkedinAttachOutcome> {
  try {
    const candidate = await deps.loadCandidate(input.candidateId);
    if (!candidate || candidate.status !== 'pending_review') return 'not_found';
    const action = planLinkedinAttach(candidate.linkedinUrl, input.linkedinUrl);
    if (!action) return 'invalid_url';
    if (action !== 'unchanged') {
      const written = await deps.writeCandidateLinkedin(candidate.id, {
        linkedinUrl: input.linkedinUrl.trim(),
        expectedCurrent: candidate.linkedinUrl,
        enrichmentMetadata: writeLinkedinAttachTrace(candidate.enrichmentMetadata, action, deps.nowIso),
      });
      if (!written) return 'conflict';
    }
    // También con `unchanged`: verifica que HubSpot lo tenga y, si está vacío allá, lo completa.
    await deps.pushToHubSpot(candidate.id);
    return action;
  } catch {
    return 'failed';
  }
}

// ── Contacto aprobado de SellUp ───────────────────────────────────────────────

export interface LinkedinAttachContact {
  id: string;
  linkedinUrl: string | null;
  hubspotContactId: string | null;
}

export interface ContactLinkedinAttachReport {
  outcome: LinkedinAttachOutcome;
  hubspot: HubSpotLinkedinFillOutcome | null;
}

export interface ContactLinkedinAttachDeps {
  loadContact: (contactId: string) => Promise<LinkedinAttachContact | null>;
  /**
   * Guarda el LinkedIn por el escritor oficial de contactos (`updateContact`: auditoría incluida)
   * si el guardado sigue siendo `expectedCurrent`. Devuelve true si se guardó.
   */
  writeContactLinkedin: (
    contactId: string,
    input: { linkedinUrl: string; expectedCurrent: string | null },
  ) => Promise<boolean>;
  fillHubSpotLinkedin: (hubspotContactId: string | null, linkedinUrl: string) => Promise<HubSpotLinkedinFillOutcome>;
}

export async function attachSearchedLinkedinToContact(
  input: { contactId: string; linkedinUrl: string },
  deps: ContactLinkedinAttachDeps,
): Promise<ContactLinkedinAttachReport> {
  try {
    const contact = await deps.loadContact(input.contactId);
    if (!contact) return { outcome: 'not_found', hubspot: null };
    const action = planLinkedinAttach(contact.linkedinUrl, input.linkedinUrl);
    if (!action) return { outcome: 'invalid_url', hubspot: null };
    const url = input.linkedinUrl.trim();
    if (action !== 'unchanged') {
      const written = await deps.writeContactLinkedin(contact.id, { linkedinUrl: url, expectedCurrent: contact.linkedinUrl });
      if (!written) return { outcome: 'conflict', hubspot: null };
    }
    // También con `unchanged`: verifica que HubSpot lo tenga y, si está vacío allá, lo completa.
    let hubspot: HubSpotLinkedinFillOutcome;
    try {
      hubspot = await deps.fillHubSpotLinkedin(contact.hubspotContactId, url);
    } catch {
      hubspot = 'failed';
    }
    return { outcome: action, hubspot };
  } catch {
    return { outcome: 'failed', hubspot: null };
  }
}
