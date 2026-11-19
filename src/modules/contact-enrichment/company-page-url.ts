// Agente 2A — Enlace a la página de la empresa en una red (LinkedIn, Facebook, Instagram…).
//
// Feedback 19-11: al pegar «linkedin.com/company/cemaco» en «Prospectar contactos», el asistente
// tomaba `linkedin.com` como DOMINIO de la empresa: HubSpot devolvía la empresa «LinkedIn», los
// candidatos quedaban con «LinkedIn» en la columna Empresa y Apollo buscaba gente de LinkedIn.
// El host de una red social nunca es el sitio de la empresa; lo que dice de qué empresa se trata es
// la ruta (`/company/cemaco`). Aquí se lee esa ruta como NOMBRE de la empresa.
//
// Sólo aplica cuando hay ruta: «linkedin.com» a secas sigue siendo el dominio de LinkedIn (también
// puede ser un prospecto). Puro: sin red, sin env.

import { isSharedPlatformHost } from '@/server/agents/prospecting-toolkit/shared-hosts';

export interface CompanyPageUrl {
  /** Host sin `www.` ni subdominio de país de LinkedIn (`es.linkedin.com` → `linkedin.com`). */
  host: string;
  /** Nombre que se lee en la ruta («Cemaco Guatemala»); `null` si la ruta no lo dice (ID numérico). */
  nameGuess: string | null;
  /** Enlace canónico de la página de empresa en LinkedIn; `null` si no es de LinkedIn. */
  linkedinCompanyUrl: string | null;
}

const LINKEDIN_ORG_SECTIONS = new Set(['company', 'school', 'showcase']);
/** Partes de la ruta que no son el nombre (`facebook.com/pages/…`, `youtube.com/c/…`). */
const NON_NAME_SEGMENTS = new Set(['pages', 'pg', 'p', 'c', 'channel', 'user', 'company', 'people', 'groups', 'profile.php']);
const URL_PARTS_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^\s/?#:]+)(?::\d+)?(\/[^\s?#]*)?/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** «cemaco-guatemala-12345» → «Cemaco Guatemala». `null` si no queda nombre. */
export function humanizePageSlug(slug: string): string | null {
  const words = safeDecode(slug)
    .replace(/^@/, '')
    .split(/[-_.\s]+/)
    .filter((w) => w.length > 0);
  // Un número al final es un identificador de LinkedIn/Facebook, no parte del nombre.
  while (words.length > 0 && /^\d+$/.test(words[words.length - 1])) words.pop();
  if (words.length === 0) return null;
  return words.map((w) => w.charAt(0).toLocaleUpperCase('es') + w.slice(1)).join(' ');
}

/**
 * ¿Lo escrito es un enlace a la página de una empresa en una red social o plataforma compartida?
 * Devuelve el nombre que se lee en la ruta. `null` si no es un enlace así (un dominio propio, un
 * nombre, un correo, o el host de la red sin ruta).
 */
export function parseCompanyPageUrl(query: string | null | undefined): CompanyPageUrl | null {
  const q = (query ?? '').trim();
  // Un correo (`ana@empresa.com`) no es un enlace; «instagram.com/@marca» sí.
  if (!q || /\s/.test(q) || /^[^/]*@/.test(q)) return null;
  const parts = URL_PARTS_RE.exec(q);
  if (!parts) return null;
  const rawHost = parts[1].toLowerCase().replace(/\.$/, '');
  if (!isSharedPlatformHost(rawHost)) return null;
  const segments = (parts[2] ?? '').split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return null;

  const isLinkedin = rawHost === 'linkedin.com' || rawHost.endsWith('.linkedin.com');
  const host = isLinkedin ? 'linkedin.com' : rawHost.replace(/^www\./, '');

  if (isLinkedin && LINKEDIN_ORG_SECTIONS.has(segments[0].toLowerCase())) {
    const slug = segments[1] ? safeDecode(segments[1]).toLowerCase() : '';
    return {
      host,
      nameGuess: slug ? humanizePageSlug(slug) : null,
      linkedinCompanyUrl: slug ? `https://www.linkedin.com/${segments[0].toLowerCase()}/${encodeURIComponent(slug)}` : null,
    };
  }
  // Un perfil de persona (`/in/…`) u otra sección de LinkedIn no dice de qué empresa se trata.
  if (isLinkedin) return { host, nameGuess: null, linkedinCompanyUrl: null };

  const nameSegment = segments.find((s) => !NON_NAME_SEGMENTS.has(s.toLowerCase()));
  return { host, nameGuess: nameSegment ? humanizePageSlug(nameSegment) : null, linkedinCompanyUrl: null };
}
