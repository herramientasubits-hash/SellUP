// Agente 2A — ¿Qué pegó el usuario en la búsqueda puntual: un LinkedIn, un correo o el ID de
// HubSpot del contacto? AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE + ID de contacto (Bryan 17-11). Puro.

import { normalizeEmailInput } from './email-contact-search-core';

export type ContactSearchInputKind =
  | { kind: 'email'; email: string }
  | { kind: 'linkedin'; raw: string }
  | { kind: 'hubspot_contact_id'; id: string }
  /** Un enlace de una EMPRESA de HubSpot: aquí se buscan personas. */
  | { kind: 'hubspot_company_link' }
  | { kind: 'empty' }
  | { kind: 'unknown' };

export const CONTACT_SEARCH_INPUT_COPY = {
  empty: 'Pega el enlace del perfil de LinkedIn, el correo o el ID de HubSpot de la persona.',
  unknown:
    'No reconocí ni un enlace de LinkedIn, ni un correo, ni un ID de HubSpot. Pega el perfil (linkedin.com/in/nombre-apellido), el correo (nombre@empresa.com) o el ID del contacto en HubSpot (solo números).',
  hubspotCompanyLink:
    'Ese enlace es de una empresa de HubSpot, no de un contacto. Para buscar los contactos de una empresa elige «Contactos de una empresa».',
} as const;

/** El ID de un contacto de HubSpot: solo dígitos (se tolera un «#» delante). */
const HUBSPOT_CONTACT_ID_RE = /^#?\s*(\d{3,20})$/;
/** Enlace de un CONTACTO de HubSpot: `.../contact/123` o `.../record/0-1/123`. */
const HUBSPOT_CONTACT_URL_RE = /hubspot\.com\/.*?\/(?:contact|record\/0-1)\/(\d{3,20})(?:[/?#]|$)/i;
/** Enlace de una EMPRESA de HubSpot: `.../company/123` o `.../record/0-2/123`. */
const HUBSPOT_COMPANY_URL_RE = /hubspot\.com\/.*?\/(?:company|record\/0-2)\/\d+/i;

/**
 * Un correo se reconoce por su forma; un número (o el enlace de un contacto de HubSpot) es el ID
 * del contacto en HubSpot; cualquier texto con «linkedin» va a la validación de LinkedIn (que
 * explica qué está mal si no es un perfil). Lo demás no se busca.
 */
export function detectContactSearchInput(raw: unknown): ContactSearchInputKind {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { kind: 'empty' };
  const email = normalizeEmailInput(value);
  if (email) return { kind: 'email', email };
  const id = HUBSPOT_CONTACT_ID_RE.exec(value)?.[1] ?? HUBSPOT_CONTACT_URL_RE.exec(value)?.[1] ?? null;
  if (id) return { kind: 'hubspot_contact_id', id };
  if (HUBSPOT_COMPANY_URL_RE.test(value)) return { kind: 'hubspot_company_link' };
  if (/linkedin/i.test(value) || /^\/?in\//i.test(value)) return { kind: 'linkedin', raw: value };
  return { kind: 'unknown' };
}
