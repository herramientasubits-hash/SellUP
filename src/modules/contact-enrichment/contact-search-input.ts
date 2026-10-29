// Agente 2A — ¿Qué pegó el usuario en la búsqueda puntual: un LinkedIn o un correo?
// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE. Puro.

import { normalizeEmailInput } from './email-contact-search-core';

export type ContactSearchInputKind =
  | { kind: 'email'; email: string }
  | { kind: 'linkedin'; raw: string }
  | { kind: 'empty' }
  | { kind: 'unknown' };

export const CONTACT_SEARCH_INPUT_COPY = {
  empty: 'Pega el enlace del perfil de LinkedIn o el correo de la persona.',
  unknown:
    'No reconocí ni un enlace de LinkedIn ni un correo. Pega el perfil (linkedin.com/in/nombre-apellido) o el correo (nombre@empresa.com).',
} as const;

/**
 * Un correo se reconoce por su forma; cualquier texto con «linkedin» va a la validación de
 * LinkedIn (que explica qué está mal si no es un perfil). Lo demás no se busca.
 */
export function detectContactSearchInput(raw: unknown): ContactSearchInputKind {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { kind: 'empty' };
  const email = normalizeEmailInput(value);
  if (email) return { kind: 'email', email };
  if (/linkedin/i.test(value) || /^\/?in\//i.test(value)) return { kind: 'linkedin', raw: value };
  return { kind: 'unknown' };
}
