/**
 * provider-contact-identity-core.ts — Modelo PURO de la identidad provider-native de
 * un candidato (Agente 2A · AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1).
 *
 * ── EL PROBLEMA QUE RESUELVE ─────────────────────────────────────────────────
 *
 * `contact_enrichment_candidates.source` + `source_contact_id` responden UNA pregunta:
 * **de dónde vino este candidato**. Un candidato nacido en Apollo dice `apollo` y lleva
 * un id de Apollo, y eso es correcto para siempre.
 *
 * La pata de teléfono de Lusha necesita responder OTRA pregunta: **¿con qué id conoce
 * Lusha a esta persona?**. Son espacios de id distintos, y mandarle a Lusha el id de
 * Apollo es exactamente la causa raíz del HTTP 422 del RCA del reveal asíncrono.
 *
 * Este módulo es el modelo de esa segunda pregunta. La identidad vive en su propia
 * tabla (`contact_provider_identities`, migración 124) con clave (candidato, proveedor),
 * NO en una columna por proveedor sobre el candidato:
 *
 *   * `provider_key` forma parte de la clave, así que un id de Apollo NO PUEDE leerse
 *     como si fuera de Lusha. El alias cross-provider no es "algo que no hacemos": es
 *     algo que el modelo no sabe representar.
 *   * un proveedor nuevo es una fila, no una migración y un escritor nuevos;
 *   * `source` no cambia de significado, así que ninguna lectura existente se altera.
 *
 * PURO por contrato: sin I/O, sin Supabase, sin fetch, sin process.env, sin Date.now().
 * Misma convención que el resto de los cores de este módulo.
 */

/** Proveedores que pueden tener identidad propia. Espejo del CHECK de la migración 124. */
export const PROVIDER_CONTACT_IDENTITY_PROVIDER_KEYS = ['apollo', 'lusha'] as const;

export type ProviderContactIdentityProviderKey =
  (typeof PROVIDER_CONTACT_IDENTITY_PROVIDER_KEYS)[number];

/**
 * CÓMO se obtuvo el id. Vocabulario CERRADO y espejo exacto del CHECK
 * `contact_provider_identities_resolution_source_check`.
 *
 * La procedencia es económica, no decorativa: `provider_native_origin` significa que
 * NADIE pagó por saberlo (el candidato nació en ese proveedor), mientras que cada
 * `provider_search_*` significa que se pagó una búsqueda y dice con QUÉ clave exacta
 * se resolvió. Un auditor que solo viera "hay un id" no podría distinguir esas dos
 * cosas, y son la diferencia entre 0 y 1 crédito.
 *
 * No existe ningún valor para coincidencia difusa, por cargo ni por empresa sola: no
 * están permitidos, así que tampoco son representables.
 */
export const PROVIDER_CONTACT_IDENTITY_RESOLUTION_SOURCES = [
  'provider_native_origin',
  'provider_search_linkedin_url',
  'provider_search_email',
  'provider_search_name_company_domain',
  'provider_search_name_company_name',
] as const;

export type ProviderContactIdentityResolutionSource =
  (typeof PROVIDER_CONTACT_IDENTITY_RESOLUTION_SOURCES)[number];

/**
 * Parser del vocabulario cerrado. Un valor arbitrario (columna ampliada por otra rama,
 * fila escrita a mano, driver devolviendo algo inesperado) se descarta a `null` en vez
 * de viajar a la auditoría como si fuera una procedencia válida.
 */
export function parseProviderContactIdentityResolutionSource(
  value: unknown,
): ProviderContactIdentityResolutionSource | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return (PROVIDER_CONTACT_IDENTITY_RESOLUTION_SOURCES as readonly string[]).includes(
    trimmed,
  )
    ? (trimmed as ProviderContactIdentityResolutionSource)
    : null;
}

/** Fila de `contact_provider_identities`, proyectada a lo que el waterfall necesita. */
export interface ProviderContactIdentityRecord {
  candidateId: string;
  providerKey: ProviderContactIdentityProviderKey;
  /** Id NATIVO del proveedor. Opaco: nunca se imprime, nunca se registra en logs. */
  providerContactId: string;
  resolutionSource: ProviderContactIdentityResolutionSource;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Id NATIVO de un proveedor para un candidato, buscado en DOS sitios y en este orden:
 *
 *   1. el mapa de identidades (`contact_provider_identities`);
 *   2. el propio candidato, PERO SOLO si su `source` es ese mismo proveedor.
 *
 * El punto 2 es la razón de ser de la condición `source === providerKey`: es lo que
 * impide que el `source_contact_id` de un candidato de Apollo se devuelva jamás como
 * si fuera un id de Lusha. Sin ella este helper sería precisamente el alias prohibido.
 *
 * Devuelve `null` cuando ese proveedor no sabe (todavía) quién es esta persona.
 */
export function resolveProviderNativeContactId(args: {
  providerKey: ProviderContactIdentityProviderKey;
  /** `contact_enrichment_candidates.source`. */
  candidateSource: string | null;
  /** `contact_enrichment_candidates.source_contact_id`. */
  candidateSourceContactId: string | null;
  /** Identidades ya persistidas para ESTE candidato. */
  identities: readonly ProviderContactIdentityRecord[];
}): {
  contactId: string;
  resolutionSource: ProviderContactIdentityResolutionSource;
} | null {
  const persisted = args.identities.find(
    (identity) => identity.providerKey === args.providerKey,
  );
  const persistedId = persisted ? cleanText(persisted.providerContactId) : null;
  if (persisted && persistedId) {
    return {
      contactId: persistedId,
      resolutionSource: persisted.resolutionSource,
    };
  }

  // El candidato solo aporta su id cuando ÉL nació en ese proveedor. Cualquier otro
  // `source` deja este camino cerrado, que es el invariante entero de este milestone.
  if (cleanText(args.candidateSource) !== args.providerKey) return null;

  const nativeId = cleanText(args.candidateSourceContactId);
  if (!nativeId) return null;

  return { contactId: nativeId, resolutionSource: 'provider_native_origin' };
}

/**
 * ¿Hace falta PAGAR una búsqueda de identidad para este proveedor?
 *
 * Es la pregunta que decide si la autorización reserva 1 crédito de más, así que se
 * responde ANTES del clic y con los mismos datos que el runtime usará después. Un
 * `false` aquí es lo que hace que el operador vea 13 y no 14.
 */
export function requiresProviderIdentitySearch(args: {
  providerKey: ProviderContactIdentityProviderKey;
  candidateSource: string | null;
  candidateSourceContactId: string | null;
  identities: readonly ProviderContactIdentityRecord[];
}): boolean {
  return resolveProviderNativeContactId(args) === null;
}
