/**
 * apollo-candidate-identity-readers.ts — los ÚNICOS lectores de identidad
 * autorizados para un resultado de Apollo Organization Search.
 *
 * AGENT1-APOLLO-NULL-DOMAIN-IDENTITY-1 · § 1-3.
 *
 * ── El defecto que este módulo cierra ────────────────────────────────────────
 *
 * `mapApolloOrganizationToSearchResult` construye la `url` del resultado así:
 *
 *     const url = website ?? `https://apollo.io/companies/${org.id}`;
 *
 * Cuando Apollo NO devuelve `website_url` ni `primary_domain`, esa URL sintética
 * es lo único que queda en `result.url`. `metadata.domain` ya vale `null` —el
 * provider nunca inventó un dominio—, pero SIETE lectores distintos aguas abajo
 * re-derivaban el dominio desde `result.url` y resucitaban `apollo.io`:
 *
 *     normalizeDomain('https://apollo.io/companies/A') === 'apollo.io'
 *     normalizeDomain('https://apollo.io/companies/B') === 'apollo.io'
 *
 * Dos organizaciones DISTINTAS quedaban con la misma identidad de dominio. El
 * seen-registry las declaraba duplicadas, el dedupe multi-query las colapsaba en
 * una sola entrada y la persistencia escribía `domain='apollo.io'` /
 * `identity_key='domain:apollo.io'`. Producción tiene la huella: dos filas de
 * `prospect_discarded_dispositions` con `source_key='domain:apollo.io'` y once
 * lotes cuyo checkpoint durable guarda la clave `dom:apollo.io`.
 *
 * ── 🔴 La regla ──────────────────────────────────────────────────────────────
 *
 * `https://apollo.io/companies/{id}` es una URL de PERFIL: sirve para navegar y
 * para trazar de dónde salió el candidato. NO es el sitio de la empresa y NO
 * funda identidad. Por eso los lectores de aquí leen `metadata` y NUNCA
 * `result.url`, y por eso la guarda estática
 * `agent1-apollo-null-domain-identity.test.ts` falla si una ruta de identidad,
 * dedupe o persistencia vuelve a derivar un dominio desde la URL de un resultado
 * Apollo.
 *
 * `apollo.io` como dominio sólo es legítimo cuando Apollo lo DECLARA en
 * `primary_domain` / `website_url` — es decir, cuando llega por `metadata`. Ese
 * caso pasa por aquí y se conserva intacto: la corrección no es una lista negra
 * de la cadena «apollo.io», es dejar de leer la URL sintética.
 *
 * ── Política de identidad (reutilizada, no inventada) ────────────────────────
 *
 * `provider-seen-identity.ts` ya fijó la política para una empresa de un
 * proveedor de pago: **el id del proveedor basta por sí solo, y una empresa sin
 * dominio no deja de ser identificable** (§ 22.12 de aquel hito, que ya prohibía
 * inventar un dominio). Este módulo aplica esa MISMA política a la ruta de
 * descubrimiento de Agente 1. No abre una segunda política.
 *
 * Puro: sin I/O, sin env, sin reloj, sin proveedor.
 */

import type { WebSearchResult } from './types';

/** El proveedor de búsqueda cuyos resultados gobierna este módulo. */
const APOLLO_ORGANIZATIONS_PROVIDER_KEY = 'apollo_organizations';

/** Namespace de la identidad de proveedor en `prospect_candidates.identity_key`. */
export const APOLLO_PROVIDER_IDENTITY_PREFIX = 'provider:apollo:';

// ─── Helpers de lectura ───────────────────────────────────────────────────────

function readMetadata(result: WebSearchResult): Record<string, unknown> {
  const meta = result.metadata;
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function readApolloProfile(result: WebSearchResult): Record<string, unknown> {
  const profile = readMetadata(result)['apollo_profile'];
  return profile && typeof profile === 'object' && !Array.isArray(profile)
    ? (profile as Record<string, unknown>)
    : {};
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// ─── Clasificación ────────────────────────────────────────────────────────────

/**
 * ¿Este resultado viene de Apollo Organization Search?
 *
 * Se mira el proveedor declarado y, como respaldo, las dos marcas que el mapper
 * estampa en metadata. Un resultado de Tavily o de Google CSE nunca entra por
 * aquí: su `url` SÍ es el sitio real de la empresa y su comportamiento no cambia.
 */
export function isApolloOrganizationsResult(result: WebSearchResult): boolean {
  if (result.provider === APOLLO_ORGANIZATIONS_PROVIDER_KEY) return true;
  if (result.source === APOLLO_ORGANIZATIONS_PROVIDER_KEY) return true;
  const meta = readMetadata(result);
  if (meta['source_key'] === APOLLO_ORGANIZATIONS_PROVIDER_KEY) return true;
  return meta['source_provider'] === 'apollo';
}

/**
 * ¿Esta URL es la URL de perfil sintética de Apollo?
 *
 * Existe para que los guardias puedan NOMBRAR lo que rechazan, no para filtrar
 * por la cadena: la corrección real es no leer la URL para identidad. Un
 * `website_url` que Apollo declare como `https://apollo.io` llega por metadata,
 * no por aquí, y se conserva.
 */
export function isApolloSyntheticProfileUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== 'apollo.io' && !hostname.endsWith('.apollo.io')) return false;
    // Sólo la ruta de perfil. `https://apollo.io` a secas es un sitio real y
    // podría ser el website que Apollo declaró para su propia organización.
    return new URL(url).pathname.toLowerCase().startsWith('/companies/');
  } catch {
    return false;
  }
}

// ─── Lectores canónicos ───────────────────────────────────────────────────────

/**
 * El dominio que Apollo DECLARÓ para esta organización, o `null`.
 *
 * 🔴 Nunca lee `result.url`. Si Apollo no declaró dominio, la respuesta es
 * `null` y el llamador debe seguir adelante con la identidad de proveedor — no
 * fabricar un dominio, no descartar en silencio.
 */
export function readApolloCandidateDomain(result: WebSearchResult): string | null {
  const declared = readNonEmptyString(readMetadata(result)['domain']);
  if (declared) return declared;
  return readNonEmptyString(readApolloProfile(result)['primary_domain']);
}

/**
 * El sitio web que Apollo DECLARÓ para esta organización, o `null`.
 *
 * 🔴 Nunca cae a `result.url`: para una organización sin dominio esa URL es el
 * perfil de Apollo, no el sitio de la empresa, y persistirla como `website`
 * volvía a fabricar identidad por la puerta de atrás (`normalizeDomain(website)`).
 */
export function readApolloCandidateWebsite(result: WebSearchResult): string | null {
  const declared = readNonEmptyString(readMetadata(result)['website']);
  if (declared) return declared;
  return readNonEmptyString(readApolloProfile(result)['website_url']);
}

/**
 * El id de organización que Apollo emitió. Es la identidad ESTABLE de una
 * organización sin dominio, y la única que sobrevive a que cambie de web.
 */
export function readApolloProviderOrganizationId(result: WebSearchResult): string | null {
  const meta = readMetadata(result);
  return (
    readNonEmptyString(meta['apollo_organization_id']) ??
    readNonEmptyString(meta['organization_id']) ??
    readNonEmptyString(readApolloProfile(result)['organization_id'])
  );
}

/**
 * Clave de identidad de proveedor, con el namespace de `identity_key`.
 *
 * `null` cuando no hay id: sin señal no se fabrica una clave, exactamente como
 * `resolveProviderSeenObservation` devuelve `null` en lugar de rellenar.
 */
export function buildApolloProviderIdentityKey(
  organizationId: string | null | undefined,
): string | null {
  const id = readNonEmptyString(organizationId);
  return id === null ? null : `${APOLLO_PROVIDER_IDENTITY_PREFIX}${id}`;
}

/**
 * Clave de deduplicación de un resultado dentro de una ronda multi-query.
 *
 * Devuelve las DOS señales por separado —no una sola clave colapsada— porque el
 * dedupe las usa como ejes independientes, igual que el seen-registry: basta que
 * UNA coincida para reconocer la organización, y que las dos falten significa
 * «no se puede deduplicar», nunca «es la misma que la anterior».
 */
export function readApolloDedupeIdentity(result: WebSearchResult): {
  providerOrganizationId: string | null;
  domain: string | null;
} {
  const domain = readApolloCandidateDomain(result);
  return {
    providerOrganizationId: readApolloProviderOrganizationId(result),
    domain: domain === null ? null : domain.toLowerCase().replace(/^www\./, ''),
  };
}
