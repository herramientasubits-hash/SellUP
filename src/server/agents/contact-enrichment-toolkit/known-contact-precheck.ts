// AGENT2-KNOWN-CONTACT-PRECHECK-1 — no pagar people/match por alguien que ya es contacto
//
// La búsqueda de personas de Apollo (gratis) devuelve el apellido oculto: «Go***z». Para
// conocerlo entero hay que completar el perfil con people/match, que cuesta 1 crédito. En los
// 60 días previos al 20-10, TODAS las completaciones que no terminaron en candidato fueron de
// personas que ya eran contacto (SellUp o HubSpot): se pagaba para descubrir a alguien que ya
// teníamos.
//
// Esta comprobación usa lo que ya está en la corrida —los nombres de los contactos existentes
// de la empresa— para no completar a quien coincide con seguridad: mismo nombre de pila y un
// apellido que encaja en el patrón oculto (empieza y termina igual). Es conservadora: sin
// apellido (ni completo ni oculto) no descarta a nadie, porque dos personas pueden llamarse
// igual de nombre. Pura: sin red.

import type { NormalizedApolloContact } from './contact-normalizer';

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9*\s-]/g, ' ')
    .trim();
}

function tokens(value: string | null | undefined): string[] {
  return value ? fold(value).split(/[\s-]+/).filter((t) => t.length > 0) : [];
}

/** «Go***z» → { prefix: 'go', suffix: 'z' }. Sin asteriscos o vacío ⇒ null. */
export function parseObfuscatedLastName(value: string | null | undefined): { prefix: string; suffix: string } | null {
  const folded = value ? fold(value).replace(/\s+/g, '') : '';
  const first = folded.indexOf('*');
  if (first <= 0) return null;
  const last = folded.lastIndexOf('*');
  const prefix = folded.slice(0, first);
  const suffix = folded.slice(last + 1);
  return prefix ? { prefix, suffix } : null;
}

function lastNameMatches(candidateTokens: string[], lastName: string | null, obfuscated: { prefix: string; suffix: string } | null): boolean {
  if (lastName) {
    const wanted = tokens(lastName);
    return wanted.length > 0 && wanted.every((t) => candidateTokens.includes(t));
  }
  if (obfuscated) {
    return candidateTokens.some(
      (t) => t.length > obfuscated.prefix.length && t.startsWith(obfuscated.prefix) && t.endsWith(obfuscated.suffix),
    );
  }
  return false;
}

/** ¿Esta persona de Apollo es, con seguridad, uno de los contactos que la empresa ya tiene? */
export function isAlreadyKnownContact(contact: NormalizedApolloContact, existingContactNames: readonly string[]): boolean {
  const first = tokens(contact.firstName)[0];
  if (!first) return false;
  const obfuscatedRaw = contact.enrichmentMetadata?.last_name_obfuscated;
  const obfuscated = parseObfuscatedLastName(typeof obfuscatedRaw === 'string' ? obfuscatedRaw : null);
  if (!contact.lastName && !obfuscated) return false;

  return existingContactNames.some((name) => {
    const existing = tokens(name);
    if (existing[0] !== first) return false;
    return lastNameMatches(existing.slice(1), contact.lastName, obfuscated);
  });
}
