// Agente 2A — Completar candidato de HubSpot: adaptadores de proveedores
// (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION).
//
// Sólo servidor. Traducen Apollo y Lusha al contrato del núcleo puro
// (`candidate-identity-completion-core.ts`) y dicen cuánto se gastó. Reutilizan los clientes que
// el Agente 2A ya usa en producción; no hay endpoints nuevos:
//
//   - Apollo `POST /api/v1/people/match` por CORREO o por LINKEDIN (+ nombre y empresa como
//     desempate). Nunca `reveal_phone_number`. `reveal_personal_emails` SÓLO cuando lo que se
//     busca es el correo (los mismos parámetros que la búsqueda por LinkedIn y la completion de
//     #589). 1 crédito por llamada respondida.
//   - Lusha, por correo: `POST /v3/contacts/search` (vista SIN revelar: id + LinkedIn), nunca
//     `enrich`. Por LinkedIn: el adaptador de la búsqueda por LinkedIn (search + enrich SÓLO de
//     correos). Nunca teléfonos. Créditos: los que reporte Lusha; si no, desconocido.
//
// Ninguna línea registra el correo ni la URL de LinkedIn (datos personales).

import { matchApolloPerson } from '@/server/integrations/apollo-client';
import { searchLushaContactsV3 } from '@/server/integrations/lusha-client';
import { getApolloApiKey } from '@/server/services/apollo-connection';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { normalizeApolloPerson } from '@/server/agents/contact-enrichment-toolkit/contact-normalizer';
import { isLushaContactEnrichmentEnabled, resolveLushaSearchTimeoutMs } from '@/lib/feature-flags.server';
import { lookupLushaByLinkedin } from './linkedin-contact-search-providers.server';
import type {
  IdentityLookup,
  IdentityLookupQuery,
  IdentityProviderUsage,
} from './candidate-identity-completion-core';

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// ── Apollo ────────────────────────────────────────────────────────────────────

export async function lookupApolloIdentity(
  query: IdentityLookupQuery,
  deps: { matchPerson?: typeof matchApolloPerson; getApiKey?: typeof getApolloApiKey } = {},
): Promise<IdentityLookup> {
  const { matchPerson = matchApolloPerson, getApiKey = getApolloApiKey } = deps;

  const identifier = query.channel === 'email' ? clean(query.email) : clean(query.linkedinUrl);
  if (!identifier) return { kind: 'not_found', usage: [] };

  const apiKey = await getApiKey().catch(() => null);
  if (!apiKey) return { kind: 'unavailable', usage: [] };

  let response: Awaited<ReturnType<typeof matchApolloPerson>>;
  try {
    response = await matchPerson({
      ...(query.channel === 'email' ? { email: identifier } : { linkedin_url: identifier }),
      ...(query.firstName ? { first_name: query.firstName } : {}),
      ...(query.lastName ? { last_name: query.lastName } : {}),
      ...(query.organizationName ? { organization_name: query.organizationName } : {}),
      ...(query.domain ? { domain: query.domain } : {}),
      ...(query.wantsEmail ? { reveal_personal_emails: true } : {}),
    });
  } catch {
    return {
      kind: 'error',
      usage: [{ provider_key: 'apollo', operation_key: 'person_match', credits_used: null, status: 'error', results_returned: 0, error_code: 'request_failed' }],
    };
  }

  if (!response.success) {
    return {
      kind: 'error',
      // Una respuesta de error no se da por cobrada ni por gratis: desconocido.
      usage: [{ provider_key: 'apollo', operation_key: 'person_match', credits_used: null, status: 'error', results_returned: 0, error_code: response.error?.error }],
    };
  }

  const person = response.data ?? null;
  const usage: IdentityProviderUsage[] = [
    { provider_key: 'apollo', operation_key: 'person_match', credits_used: 1, status: 'success', results_returned: person ? 1 : 0 },
  ];
  if (!person || !clean(person.id)) return { kind: 'not_found', usage };
  // El normalizador descarta los correos bloqueados (`email_not_unlocked@…`).
  const normalized = normalizeApolloPerson(person);
  return {
    kind: 'found',
    person: {
      id: clean(person.id),
      firstName: clean(person.first_name),
      lastName: clean(person.last_name),
      linkedinUrl: clean(person.linkedin_url),
      email: normalized?.email ?? null,
    },
    usage,
  };
}

// ── Lusha ─────────────────────────────────────────────────────────────────────

const LUSHA_NOT_FOUND_STATUSES = new Set(['no_results']);

async function lookupLushaByEmail(
  query: IdentityLookupQuery,
  deps: {
    isEnabled?: () => boolean;
    getApiKey?: typeof getLushaApiKey;
    search?: typeof searchLushaContactsV3;
    timeoutMs?: number;
  },
): Promise<IdentityLookup> {
  const { isEnabled = isLushaContactEnrichmentEnabled, getApiKey = getLushaApiKey, search = searchLushaContactsV3 } = deps;
  const email = clean(query.email);
  if (!email) return { kind: 'not_found', usage: [] };
  if (!isEnabled()) return { kind: 'unavailable', usage: [] };
  const apiKey = await getApiKey().catch(() => null);
  if (!apiKey) return { kind: 'unavailable', usage: [] };
  const timeoutMs = deps.timeoutMs ?? resolveLushaSearchTimeoutMs();

  const found = await search({
    apiKey,
    timeoutMs,
    contacts: [
      {
        email,
        ...(query.firstName ? { firstName: query.firstName } : {}),
        ...(query.lastName ? { lastName: query.lastName } : {}),
        ...(query.organizationName ? { companyName: query.organizationName } : {}),
        ...(query.domain ? { companyDomain: query.domain } : {}),
      },
    ],
  });
  const usage: IdentityProviderUsage[] = [
    {
      provider_key: 'lusha',
      operation_key: 'lusha_contact_search',
      credits_used: typeof found.creditsCharged === 'number' ? found.creditsCharged : null,
      status: found.ok || LUSHA_NOT_FOUND_STATUSES.has(found.status) ? 'success' : 'error',
      results_returned: found.resultsReturned ?? 0,
      ...(found.ok ? {} : { error_code: found.status }),
    },
  ];
  if (!found.ok && !LUSHA_NOT_FOUND_STATUSES.has(found.status)) return { kind: 'error', usage };

  const match = found.sanitizedResults?.find((r) => clean(r.linkedinUrl));
  if (!match) return { kind: 'not_found', usage };
  return {
    kind: 'found',
    person: { firstName: null, lastName: null, fullName: clean(match.fullName), linkedinUrl: clean(match.linkedinUrl), email: null },
    usage,
  };
}

export async function lookupLushaIdentity(
  query: IdentityLookupQuery,
  deps: {
    isEnabled?: () => boolean;
    getApiKey?: typeof getLushaApiKey;
    search?: typeof searchLushaContactsV3;
    timeoutMs?: number;
    byLinkedin?: typeof lookupLushaByLinkedin;
  } = {},
): Promise<IdentityLookup> {
  if (query.channel === 'email') return lookupLushaByEmail(query, deps);

  const url = clean(query.linkedinUrl);
  if (!url) return { kind: 'not_found', usage: [] };
  const byLinkedin = deps.byLinkedin ?? lookupLushaByLinkedin;
  const lookup = await byLinkedin(url);
  const usage: IdentityProviderUsage[] = lookup.usage;
  if (lookup.kind !== 'found') return { kind: lookup.kind, usage };
  return {
    kind: 'found',
    person: {
      firstName: lookup.profile.firstName,
      lastName: lookup.profile.lastName,
      fullName: lookup.profile.fullName,
      linkedinUrl: url,
      email: lookup.profile.email,
    },
    usage,
  };
}
