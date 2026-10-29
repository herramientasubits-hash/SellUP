// Agente 2A — Completar candidato de HubSpot: adaptadores de proveedores
// (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION).
//
// Sólo servidor. Traducen Apollo y Lusha al contrato del núcleo puro
// (`candidate-identity-completion-core.ts`) y dicen cuánto se gastó. Reutilizan los clientes que
// el Agente 2A ya usa en producción; no hay endpoints nuevos:
//
//   - Apollo `POST /api/v1/people/match` por CORREO (+ nombre y empresa como desempate). Sin
//     `reveal_phone_number` ni `reveal_personal_emails`: sólo se quiere saber QUIÉN es (id) y su
//     LinkedIn. 1 crédito por llamada respondida, igual que la búsqueda por LinkedIn.
//   - Lusha `POST /v3/contacts/search` por correo: vista SIN revelar (id + LinkedIn). Nunca
//     `enrich`, nunca teléfonos. Créditos: los que reporte Lusha; si no los reporta, desconocido.
//
// Ninguna línea registra el correo ni la URL de LinkedIn (datos personales).

import { matchApolloPerson } from '@/server/integrations/apollo-client';
import { searchLushaContactsV3 } from '@/server/integrations/lusha-client';
import { getApolloApiKey } from '@/server/services/apollo-connection';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { isLushaContactEnrichmentEnabled, resolveLushaSearchTimeoutMs } from '@/lib/feature-flags.server';
import type {
  ApolloIdentityLookup,
  ApolloIdentityQuery,
  IdentityProviderUsage,
  LushaLinkedinLookup,
} from './candidate-identity-completion-core';

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function lookupApolloIdentityByEmail(
  query: ApolloIdentityQuery,
  deps: { matchPerson?: typeof matchApolloPerson; getApiKey?: typeof getApolloApiKey } = {},
): Promise<ApolloIdentityLookup> {
  const { matchPerson = matchApolloPerson, getApiKey = getApolloApiKey } = deps;

  const apiKey = await getApiKey().catch(() => null);
  if (!apiKey) return { kind: 'unavailable', usage: [] };

  let response: Awaited<ReturnType<typeof matchApolloPerson>>;
  try {
    response = await matchPerson({
      email: query.email,
      ...(query.firstName ? { first_name: query.firstName } : {}),
      ...(query.lastName ? { last_name: query.lastName } : {}),
      ...(query.organizationName ? { organization_name: query.organizationName } : {}),
      ...(query.domain ? { domain: query.domain } : {}),
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
  return {
    kind: 'found',
    person: {
      id: clean(person.id),
      firstName: clean(person.first_name),
      lastName: clean(person.last_name),
      linkedinUrl: clean(person.linkedin_url),
    },
    usage,
  };
}

const LUSHA_NOT_FOUND_STATUSES = new Set(['no_results']);

export async function lookupLushaLinkedinByEmail(
  query: ApolloIdentityQuery,
  deps: {
    isEnabled?: () => boolean;
    getApiKey?: typeof getLushaApiKey;
    search?: typeof searchLushaContactsV3;
    timeoutMs?: number;
  } = {},
): Promise<LushaLinkedinLookup> {
  const { isEnabled = isLushaContactEnrichmentEnabled, getApiKey = getLushaApiKey, search = searchLushaContactsV3 } = deps;
  if (!isEnabled()) return { kind: 'unavailable', usage: [] };
  const apiKey = await getApiKey().catch(() => null);
  if (!apiKey) return { kind: 'unavailable', usage: [] };
  const timeoutMs = deps.timeoutMs ?? resolveLushaSearchTimeoutMs();

  const found = await search({
    apiKey,
    timeoutMs,
    contacts: [
      {
        email: query.email,
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
  const fullName = clean(match.fullName);
  const [first, ...rest] = (fullName ?? '').split(/\s+/);
  return {
    kind: 'found',
    person: {
      firstName: first || null,
      lastName: rest.join(' ') || null,
      fullName,
      linkedinUrl: clean(match.linkedinUrl),
    },
    usage,
  };
}
