/**
 * lusha-identity-search-core.ts — Resolución PURA de la identidad nativa de Lusha
 * (Agente 2A · AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1).
 *
 * Decide DOS cosas, ninguna de las cuales toca la red:
 *
 *   1. Qué UNA petición se le manda a `POST /v3/contacts/search`.
 *   2. Si lo que contestó identifica a EXACTAMENTE una persona inequívoca.
 *
 * ── POR QUÉ UNA SOLA PETICIÓN Y NO CINCO ─────────────────────────────────────
 *
 * Lusha cobra Contact Search por `api_search`: **1 crédito por petición a la API**, y
 * el mínimo se cobra incluso cuando la respuesta no trae resultados. Así que una
 * cascada "prueba LinkedIn, si falla prueba email, si falla prueba nombre+dominio" no
 * es un fallback: son hasta cuatro cobros por un solo candidato.
 *
 * La prioridad de este módulo NO es un orden de reintento — es un orden de CALIDAD.
 * Se elige el mejor identificador disponible, se manda UNA petición, y lo que conteste
 * es la respuesta. Si no alcanza, es terminal.
 *
 *     1. LinkedIn URL exacta       ← identifica a UNA persona en el mundo
 *     2. email exacto              ← idem
 *     3. nombre + dominio          ← identifica a una persona DENTRO de una empresa
 *     4. nombre + nombre de empresa ← lo mismo, con un ancla más débil
 *
 * Los dos primeros son identificadores globales; los dos últimos necesitan el ancla de
 * empresa PRECISAMENTE porque un nombre solo no identifica a nadie. Un nombre sin
 * ancla no produce petición: `no_identifier`, 0 llamadas, 0 créditos.
 *
 * ── QUÉ NO HACE ──────────────────────────────────────────────────────────────
 *
 * No hay coincidencia difusa, ni por cargo, ni búsqueda de "alguien de RRHH", ni
 * Prospecting, ni sustitución de persona. Si la respuesta no señala a UNA identidad,
 * NO se elige la primera: se declara terminal y no se revela ningún teléfono.
 *
 * PURO por contrato: sin I/O, sin fetch, sin Supabase, sin process.env, sin Date.now().
 */

import type { ProviderContactIdentityResolutionSource } from './provider-contact-identity-core';

/** Datos del candidato con los que se puede construir una búsqueda. */
export interface LushaIdentitySearchCandidateFacts {
  firstName: string | null;
  lastName: string | null;
  linkedinUrl: string | null;
  email: string | null;
  companyName: string | null;
  companyDomain: string | null;
}

/**
 * Clave con la que se resolvió (o se intentaría resolver) la identidad, en orden de
 * calidad decreciente. Es la MISMA lista que la procedencia persistida, sin el valor
 * `provider_native_origin`: aquí nunca se llega sin pagar.
 */
export const LUSHA_IDENTITY_SEARCH_MATCH_KEYS = [
  'linkedin_url',
  'email',
  'name_company_domain',
  'name_company_name',
] as const;

export type LushaIdentitySearchMatchKey =
  (typeof LUSHA_IDENTITY_SEARCH_MATCH_KEYS)[number];

/** Traducción a la procedencia que se PERSISTE. Una sola autoridad, sin duplicar. */
export const LUSHA_IDENTITY_MATCH_KEY_TO_RESOLUTION_SOURCE: Readonly<
  Record<LushaIdentitySearchMatchKey, ProviderContactIdentityResolutionSource>
> = {
  linkedin_url: 'provider_search_linkedin_url',
  email: 'provider_search_email',
  name_company_domain: 'provider_search_name_company_domain',
  name_company_name: 'provider_search_name_company_name',
};

/**
 * La ÚNICA petición que se va a emitir. El shape es el del array `contacts[]` de
 * `/v3/contacts/search`, que exige que cada item lleve uno de:
 * `id | linkedinUrl | email | (firstName + lastName + (companyName | companyDomain))`.
 * Un item que no cumpla eso es HTTP 400 (confirmado en vivo, 17B.4D).
 */
export interface LushaIdentitySearchQuery {
  matchKey: LushaIdentitySearchMatchKey;
  contact: {
    firstName?: string;
    lastName?: string;
    linkedinUrl?: string;
    email?: string;
    companyName?: string;
    companyDomain?: string;
  };
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normaliza un dominio para COMPARARLO, nunca para enviarlo. Minúsculas, sin `www.` y
 * sin punto final. No intenta parsear una URL: el dato de origen es un dominio, y un
 * parser de más aquí solo añadiría formas de equivocarse.
 */
function normalizeDomain(value: string | null): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  return cleaned.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

/** Normaliza un nombre de empresa para COMPARARLO. Colapsa espacios y mayúsculas. */
function normalizeCompanyName(value: string | null): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  return cleaned.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Construye la ÚNICA petición, con el mejor identificador disponible.
 *
 * Devuelve `null` cuando no hay ningún identificador exacto utilizable. Ese `null` es
 * un desenlace de pleno derecho (`no_identifier`) y significa 0 llamadas y 0 créditos:
 * es DELIBERADAMENTE distinto de "buscamos y no lo encontramos", que cuesta 1 crédito.
 */
export function buildLushaIdentitySearchQuery(
  facts: LushaIdentitySearchCandidateFacts,
): LushaIdentitySearchQuery | null {
  const linkedinUrl = cleanText(facts.linkedinUrl);
  if (linkedinUrl) {
    return { matchKey: 'linkedin_url', contact: { linkedinUrl } };
  }

  const email = cleanText(facts.email);
  if (email) {
    return { matchKey: 'email', contact: { email } };
  }

  const firstName = cleanText(facts.firstName);
  const lastName = cleanText(facts.lastName);
  // Sin nombre Y apellido no hay item válido: el contrato del endpoint exige los dos
  // junto al ancla de empresa, y mandar medio nombre sería pagar por un 400.
  if (!firstName || !lastName) return null;

  const companyDomain = cleanText(facts.companyDomain);
  if (companyDomain) {
    return {
      matchKey: 'name_company_domain',
      contact: { firstName, lastName, companyDomain },
    };
  }

  const companyName = cleanText(facts.companyName);
  if (companyName) {
    return {
      matchKey: 'name_company_name',
      contact: { firstName, lastName, companyName },
    };
  }

  return null;
}

/**
 * UN resultado de la respuesta, ya saneado por el cliente. Deliberadamente el mismo
 * shape que `LushaContactSearchResult.sanitizedResults`, que NO trae ni emails ni
 * teléfonos: la búsqueda de identidad no revela nada.
 */
export interface LushaIdentitySearchResultItem {
  id: string | null;
  companyName: string | null;
  companyDomain: string | null;
}

/**
 * Desenlace de la resolución. Los cuatro no-resueltos son distintos porque cuestan
 * cosas distintas y le dicen cosas distintas al operador:
 *
 *   * `not_found`   — el proveedor contestó y no conoce a esta persona. Costó 1.
 *   * `ambiguous`   — contestó con más de una, o con una que no encaja con la empresa.
 *     Elegir cualquiera sería adivinar. Costó 1.
 *   * `error`       — error o timeout. No sabemos qué sabe el proveedor y puede
 *     habernos cobrado igual. Fail-closed.
 *   * `no_identifier` — no había con qué buscar. NO se emitió petición: costó 0.
 */
export type LushaIdentitySearchOutcome =
  | { status: 'resolved'; contactId: string; matchKey: LushaIdentitySearchMatchKey }
  | { status: 'not_found' }
  | { status: 'ambiguous'; reason: 'multiple_results' | 'company_mismatch' }
  | { status: 'error'; reason: 'provider_error' | 'provider_timeout' | 'unreadable_response' }
  | { status: 'no_identifier' };

/**
 * ¿Es esta identidad incompatible con la empresa del candidato?
 *
 * Se responde por REFUTACIÓN, nunca por suposición: solo devuelve `true` cuando los
 * dos lados declaran el MISMO tipo de ancla y esas anclas difieren. Un ancla ausente
 * en cualquiera de los dos lados no refuta nada, y tratar "no lo sé" como "no encaja"
 * descartaría identidades correctas — que en este flujo significa no revelar un
 * teléfono que el operador ya pagó por llegar a pedir.
 *
 * El dominio manda sobre el nombre: dos empresas pueden llamarse igual, pero un
 * dominio es una identidad.
 */
export function isLushaIdentityCompanyMismatch(args: {
  candidate: Pick<LushaIdentitySearchCandidateFacts, 'companyName' | 'companyDomain'>;
  result: LushaIdentitySearchResultItem;
}): boolean {
  const candidateDomain = normalizeDomain(args.candidate.companyDomain);
  const resultDomain = normalizeDomain(args.result.companyDomain);
  if (candidateDomain && resultDomain) {
    return candidateDomain !== resultDomain;
  }

  const candidateName = normalizeCompanyName(args.candidate.companyName);
  const resultName = normalizeCompanyName(args.result.companyName);
  if (candidateName && resultName) {
    return candidateName !== resultName;
  }

  return false;
}

/**
 * Evalúa la respuesta de UNA petición. Solo `resolved` habilita el reveal.
 *
 * Regla que no se relaja: **exactamente uno**. Con dos o más no se elige el primero,
 * porque "el primero" no es una identidad — es un orden que el proveedor eligió por
 * nosotros. Un id vacío o ilegible cuenta como respuesta ilegible, no como ausencia:
 * el proveedor devolvió algo y no lo entendimos, que es un hecho distinto de "no hay".
 */
export function evaluateLushaIdentitySearchResponse(args: {
  candidate: Pick<LushaIdentitySearchCandidateFacts, 'companyName' | 'companyDomain'>;
  matchKey: LushaIdentitySearchMatchKey;
  response:
    | { status: 'success'; results: readonly LushaIdentitySearchResultItem[] }
    | { status: 'no_results' }
    | { status: 'provider_timeout' }
    | { status: 'provider_error' }
    | { status: 'unreadable' };
}): LushaIdentitySearchOutcome {
  const { response } = args;

  if (response.status === 'provider_timeout') {
    return { status: 'error', reason: 'provider_timeout' };
  }
  if (response.status === 'provider_error') {
    return { status: 'error', reason: 'provider_error' };
  }
  if (response.status === 'unreadable') {
    return { status: 'error', reason: 'unreadable_response' };
  }
  if (response.status === 'no_results') {
    return { status: 'not_found' };
  }

  const results = response.results;
  if (results.length === 0) return { status: 'not_found' };
  if (results.length > 1) {
    return { status: 'ambiguous', reason: 'multiple_results' };
  }

  const only = results[0];
  const contactId = cleanText(only?.id ?? null);
  if (!only || !contactId) {
    // Un único resultado SIN id utilizable: el proveedor habló y no podemos usar lo
    // que dijo. No es "no existe" — es que no lo entendimos.
    return { status: 'error', reason: 'unreadable_response' };
  }

  if (isLushaIdentityCompanyMismatch({ candidate: args.candidate, result: only })) {
    return { status: 'ambiguous', reason: 'company_mismatch' };
  }

  return { status: 'resolved', contactId, matchKey: args.matchKey };
}
