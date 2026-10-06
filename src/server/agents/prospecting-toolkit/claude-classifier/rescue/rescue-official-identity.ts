/**
 * Agente 1 · Rescate con Claude — número fiscal oficial de lo que Claude admite.
 *
 * SOURCES-CL-RESCUE-OFFICIAL-IDENTITY-1. Prod 06-10 (Chile, lotes d92a12ec y
 * 0f60a313): Grifols Chile y Clínica Andes Salud Concepción llegaron a revisión
 * por el rescate SIN RUT, aunque el SII tiene «GRIFOLS CHILE S A» y «CLINICA
 * ANDES SALUD CONCEPCION S.A». El rescate admitía sin pasar por las fuentes
 * oficiales (Tavily, Claude-busca-empresas y Apollo sí pasan).
 *
 * Sólo una identidad FUERTE llena las columnas fiscales (la misma regla de
 * siempre); lo demás deja el candidato como estaba. Puro: la búsqueda se inyecta.
 */

/** Lo que el rescate necesita para buscar el número fiscal. */
export type RescueOfficialIdentityInput = {
  name: string;
  website: string | null;
  domain: string | null;
  countryCode: string | null;
  country: string | null;
};

/** Identidad fuerte: columnas fiscales + metadata de la fuente oficial. */
export type RescueOfficialIdentity = {
  columns: {
    tax_identifier: string;
    tax_identifier_type: string | null;
    legal_name: string | null;
    legal_status: string | null;
  };
  metadata: Record<string, unknown>;
};

export type RescueOfficialIdentityResolver = (
  input: RescueOfficialIdentityInput,
) => Promise<RescueOfficialIdentity | null>;

/** Clave de metadata (la misma que escribe el escritor de candidatos). */
export const OFFICIAL_SOURCE_ENRICHMENT_METADATA_KEY = 'official_source_enrichment';

/**
 * Busca la identidad sólo si hace falta y nunca hace fallar el rescate: sin
 * resolvedor, sin nombre, con RUT ya puesto o ante cualquier error ⇒ `null`.
 */
export async function lookUpRescueOfficialIdentity(
  resolve: RescueOfficialIdentityResolver | undefined,
  input: RescueOfficialIdentityInput & { existingTaxIdentifier?: string | null },
): Promise<RescueOfficialIdentity | null> {
  if (!resolve) return null;
  if (input.existingTaxIdentifier && input.existingTaxIdentifier.trim()) return null;
  if (!input.name.trim()) return null;
  try {
    const identity = await resolve(input);
    return identity && identity.columns.tax_identifier ? identity : null;
  } catch {
    return null;
  }
}

/** Mezcla la identidad en las columnas y la metadata de un candidato. */
export function withRescueOfficialIdentity<T extends { metadata: Record<string, unknown> }>(
  patch: T,
  identity: RescueOfficialIdentity | null,
): T {
  if (!identity) return patch;
  return {
    ...patch,
    ...identity.columns,
    metadata: { ...patch.metadata, [OFFICIAL_SOURCE_ENRICHMENT_METADATA_KEY]: identity.metadata },
  };
}
