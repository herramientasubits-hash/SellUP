// Agente 2A — Buscar contacto por LinkedIn: adaptadores de proveedores (F2).
//
// Sólo servidor. Traducen las respuestas de Apollo y Lusha al perfil del núcleo puro
// (`linkedin-contact-search-core.ts`) y dicen cuánto se gastó. Reutilizan los clientes que el
// Agente 2A ya usa en producción; no hay endpoints nuevos:
//
//   - Apollo `POST /api/v1/people/match` con `linkedin_url` y `reveal_personal_emails: true`
//     (los mismos parámetros que la completion de #589). Nunca `reveal_phone_number`: el teléfono
//     sigue el flujo de reveal existente. 1 crédito por llamada respondida.
//   - Lusha `POST /v3/contacts/search` con `contacts[].linkedinUrl` (vista sin revelar) y, si hay
//     id, `POST /v3/contacts/enrich` con `reveal: ['emails']` (nunca teléfonos). Créditos: los que
//     reporte Lusha; si no los reporta, desconocido (null), nunca 0.
//
// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE — también por CORREO (búsqueda puntual por correo):
//   - Apollo `people/match` con `email` (sin `reveal_personal_emails`: el correo ya se tiene).
//   - Lusha `POST /v3/contacts/search` con `contacts[].email`: la vista SIN revelar ya trae
//     nombre, cargo, empresa y LinkedIn; no se llama a `enrich` (no hace falta revelar nada).
//
// Ninguna línea registra la URL de LinkedIn ni el correo (datos personales).

import { matchApolloPerson } from '@/server/integrations/apollo-client';
import { enrichLushaContactsV3, searchLushaContactsV3 } from '@/server/integrations/lusha-client';
import { getApolloApiKey } from '@/server/services/apollo-connection';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { normalizeApolloPerson } from '@/server/agents/contact-enrichment-toolkit/contact-normalizer';
import { normalizeDomain } from '@/server/agents/contact-enrichment-toolkit/company-consistency-checker';
import { isLushaContactEnrichmentEnabled, resolveLushaSearchTimeoutMs } from '@/lib/feature-flags.server';
import type {
  LinkedinProviderLookup,
  LinkedinProviderProfile,
  LinkedinProviderUsage,
} from './linkedin-contact-search-core';

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function splitName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null };
  const [first, ...rest] = fullName.split(/\s+/);
  return { firstName: first || null, lastName: rest.join(' ') || null };
}

// ── Apollo ────────────────────────────────────────────────────────────────────

type ApolloLookupDeps = { matchPerson?: typeof matchApolloPerson; getApiKey?: typeof getApolloApiKey };

export async function lookupApolloByLinkedin(
  canonicalUrl: string,
  deps: ApolloLookupDeps = {},
): Promise<LinkedinProviderLookup> {
  return lookupApolloPerson({ linkedin_url: canonicalUrl, reveal_personal_emails: true }, deps);
}

/** Apollo por correo: el correo ya se tiene, así que no se pide revelar correos personales. */
export async function lookupApolloByEmail(email: string, deps: ApolloLookupDeps = {}): Promise<LinkedinProviderLookup> {
  const clean_ = clean(email)?.toLowerCase();
  if (!clean_) return { kind: 'not_found', usage: [] };
  const found = await lookupApolloPerson({ email: clean_ }, deps);
  // Apollo puede no devolver el correo (bloqueado): el buscado es el de la persona.
  if (found.kind === 'found' && !found.profile.email) {
    return { ...found, profile: { ...found.profile, email: clean_ } };
  }
  return found;
}

async function lookupApolloPerson(
  params: Parameters<typeof matchApolloPerson>[0],
  deps: ApolloLookupDeps,
): Promise<LinkedinProviderLookup> {
  const { matchPerson = matchApolloPerson, getApiKey = getApolloApiKey } = deps;

  const apiKey = await getApiKey().catch(() => null);
  if (!apiKey) return { kind: 'unavailable', usage: [] };

  let result: Awaited<ReturnType<typeof matchApolloPerson>>;
  try {
    result = await matchPerson(params);
  } catch {
    return {
      kind: 'error',
      message: 'apollo_request_failed',
      usage: [{ provider_key: 'apollo', operation_key: 'person_match', credits_used: null, status: 'error', results_returned: 0, error_code: 'request_failed' }],
    };
  }

  if (!result.success) {
    return {
      kind: 'error',
      message: result.error?.error ?? 'apollo_error',
      // Una respuesta de error no se da por cobrada ni por gratis: desconocido.
      usage: [{ provider_key: 'apollo', operation_key: 'person_match', credits_used: null, status: 'error', results_returned: 0, error_code: result.error?.error }],
    };
  }

  const person = result.data ?? null;
  const normalized = person ? normalizeApolloPerson(person) : null;
  const usage: LinkedinProviderUsage[] = [
    { provider_key: 'apollo', operation_key: 'person_match', credits_used: 1, status: 'success', results_returned: normalized ? 1 : 0 },
  ];
  if (!person || !normalized) return { kind: 'not_found', usage };

  const websiteUrl = clean(person.organization?.website_url);
  const profile: LinkedinProviderProfile = {
    provider: 'apollo',
    sourceContactId: clean(person.id),
    firstName: normalized.firstName,
    lastName: normalized.lastName,
    fullName: normalized.fullName,
    title: normalized.title,
    seniority: normalized.seniority,
    country: normalized.country,
    email: normalized.email,
    providerCompanyName: clean(person.organization?.name),
    providerCompanyDomain: normalizeDomain(websiteUrl),
    providerCompanyWebsiteUrl: websiteUrl,
    phoneAvailable: null,
    linkedinUrl: clean(person.linkedin_url),
  };
  return { kind: 'found', profile, usage };
}

// ── Lusha ─────────────────────────────────────────────────────────────────────

const LUSHA_NOT_FOUND_STATUSES = new Set(['no_results']);

export async function lookupLushaByLinkedin(
  canonicalUrl: string,
  deps: {
    isEnabled?: () => boolean;
    getApiKey?: typeof getLushaApiKey;
    search?: typeof searchLushaContactsV3;
    enrich?: typeof enrichLushaContactsV3;
    timeoutMs?: number;
  } = {},
): Promise<LinkedinProviderLookup> {
  const {
    isEnabled = isLushaContactEnrichmentEnabled,
    getApiKey = getLushaApiKey,
    search = searchLushaContactsV3,
    enrich = enrichLushaContactsV3,
  } = deps;
  if (!isEnabled()) return { kind: 'unavailable', usage: [] };
  const apiKey = await getApiKey().catch(() => null);
  if (!apiKey) return { kind: 'unavailable', usage: [] };
  const timeoutMs = deps.timeoutMs ?? resolveLushaSearchTimeoutMs();

  const usage: LinkedinProviderUsage[] = [];
  const found = await search({ apiKey, timeoutMs, contacts: [{ linkedinUrl: canonicalUrl }] });
  usage.push({
    provider_key: 'lusha',
    operation_key: 'lusha_contact_search',
    credits_used: typeof found.creditsCharged === 'number' ? found.creditsCharged : null,
    status: found.ok || LUSHA_NOT_FOUND_STATUSES.has(found.status) ? 'success' : 'error',
    results_returned: found.resultsReturned ?? 0,
    ...(found.ok ? {} : { error_code: found.status }),
  });
  if (!found.ok && !LUSHA_NOT_FOUND_STATUSES.has(found.status)) {
    return { kind: 'error', message: found.status, usage };
  }
  const match = found.sanitizedResults?.find((r) => clean(r.id));
  if (!match?.id) return { kind: 'not_found', usage };

  const enriched = await enrich({ apiKey, timeoutMs, contacts: [{ id: match.id }], reveal: ['emails'] });
  usage.push({
    provider_key: 'lusha',
    operation_key: 'lusha_contact_enrich',
    credits_used: typeof enriched.creditsCharged === 'number' ? enriched.creditsCharged : null,
    status: enriched.ok || LUSHA_NOT_FOUND_STATUSES.has(enriched.status) ? 'success' : 'error',
    results_returned: enriched.resultsReturned ?? 0,
    ...(enriched.ok ? {} : { error_code: enriched.status }),
  });
  if (!enriched.ok && !LUSHA_NOT_FOUND_STATUSES.has(enriched.status)) {
    return { kind: 'error', message: enriched.status, usage };
  }
  const person = enriched.sanitizedResults?.find((r) => r.id === match.id) ?? enriched.sanitizedResults?.[0];

  const fullName = clean(person?.fullName) ?? clean(match.fullName) ??
    ([clean(person?.firstName), clean(person?.lastName)].filter(Boolean).join(' ') || null);
  if (!fullName) return { kind: 'not_found', usage };
  const names = person?.firstName || person?.lastName
    ? { firstName: clean(person?.firstName), lastName: clean(person?.lastName) }
    : splitName(fullName);
  const companyDomain = normalizeDomain(clean(person?.companyDomain) ?? clean(match.companyDomain));

  const profile: LinkedinProviderProfile = {
    provider: 'lusha',
    sourceContactId: match.id,
    firstName: names.firstName,
    lastName: names.lastName,
    fullName,
    title: clean(person?.title) ?? clean(match.title),
    seniority: null,
    country: null,
    email: clean(person?.internalEmail)?.toLowerCase() ?? null,
    providerCompanyName: clean(person?.companyName) ?? clean(match.companyName),
    providerCompanyDomain: companyDomain,
    providerCompanyWebsiteUrl: companyDomain,
    phoneAvailable: null,
  };
  return { kind: 'found', profile, usage };
}

/**
 * Lusha por correo: sólo `contacts/search` (vista sin revelar). Trae nombre, cargo, empresa y
 * LinkedIn; el correo es el que se buscó. No se llama a `enrich`: no hay nada que revelar.
 */
export async function lookupLushaByEmail(
  email: string,
  deps: {
    isEnabled?: () => boolean;
    getApiKey?: typeof getLushaApiKey;
    search?: typeof searchLushaContactsV3;
    timeoutMs?: number;
  } = {},
): Promise<LinkedinProviderLookup> {
  const { isEnabled = isLushaContactEnrichmentEnabled, getApiKey = getLushaApiKey, search = searchLushaContactsV3 } = deps;
  const address = clean(email)?.toLowerCase();
  if (!address) return { kind: 'not_found', usage: [] };
  if (!isEnabled()) return { kind: 'unavailable', usage: [] };
  const apiKey = await getApiKey().catch(() => null);
  if (!apiKey) return { kind: 'unavailable', usage: [] };
  const timeoutMs = deps.timeoutMs ?? resolveLushaSearchTimeoutMs();

  const found = await search({ apiKey, timeoutMs, contacts: [{ email: address }] });
  const usage: LinkedinProviderUsage[] = [
    {
      provider_key: 'lusha',
      operation_key: 'lusha_contact_search',
      credits_used: typeof found.creditsCharged === 'number' ? found.creditsCharged : null,
      status: found.ok || LUSHA_NOT_FOUND_STATUSES.has(found.status) ? 'success' : 'error',
      results_returned: found.resultsReturned ?? 0,
      ...(found.ok ? {} : { error_code: found.status }),
    },
  ];
  if (!found.ok && !LUSHA_NOT_FOUND_STATUSES.has(found.status)) {
    return { kind: 'error', message: found.status, usage };
  }
  const match = found.sanitizedResults?.find((r) => clean(r.fullName) || clean(r.id));
  const fullName = clean(match?.fullName);
  if (!match || !fullName) return { kind: 'not_found', usage };
  const names = splitName(fullName);
  const companyDomain = normalizeDomain(clean(match.companyDomain));
  const profile: LinkedinProviderProfile = {
    provider: 'lusha',
    sourceContactId: clean(match.id),
    firstName: names.firstName,
    lastName: names.lastName,
    fullName,
    title: clean(match.title),
    seniority: null,
    country: null,
    email: address,
    providerCompanyName: clean(match.companyName),
    providerCompanyDomain: companyDomain,
    providerCompanyWebsiteUrl: companyDomain,
    phoneAvailable: null,
    linkedinUrl: clean(match.linkedinUrl),
  };
  return { kind: 'found', profile, usage };
}
