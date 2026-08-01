/**
 * seen-registry.ts — Registro de organizaciones ya vistas durante una ejecución.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 4.
 *
 * El defecto observado que este módulo cierra: `citi.com` se enriqueció (un
 * crédito) y sólo DESPUÉS se descartó por duplicado. Una organización se
 * reconoce por cuatro identidades independientes, y basta que UNA coincida para
 * que la organización ya se conozca:
 *
 *   1. id de organización del proveedor
 *   2. dominio normalizado (registrable, sin `www.`)
 *   3. URL de LinkedIn de empresa normalizada
 *   4. nombre canónico + dominio conocido
 *
 * La cuarta es deliberadamente compuesta. El nombre comercial POR SÍ SOLO no
 * identifica: "Éxito" existe como supermercado y como decenas de razones
 * sociales sin relación. Un nombre canónico solo se admite como señal de
 * identidad cuando llega acompañado de un dominio que ya conocíamos, que es lo
 * que el § 4 pide con "nombre canónico + dominio conocido".
 *
 * El registro es compartido por TODA la corrida: la ronda 2 no puede procesar ni
 * facturar de nuevo una organización que la ronda 1 ya vio.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

// ─── Normalizadores ───────────────────────────────────────────────────────────

/** Etiquetas de segundo nivel frecuentes en LATAM (`com.co`, `com.pe`). */
const SECOND_LEVEL_LABELS: ReadonlySet<string> = new Set([
  'com', 'co', 'net', 'org', 'gob', 'gov', 'edu', 'ind', 'nom',
]);

/**
 * Dominio registrable en minúsculas y sin `www.`.
 *
 * Devuelve null cuando no hay nada utilizable: un registro vacío es peor que la
 * ausencia de registro, porque `''` coincidiría con todo.
 */
export function normalizeOrganizationDomain(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  if (value === '') return null;

  // Acepta un dominio suelto o una URL completa.
  if (value.includes('://')) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }
  value = value.replace(/^www\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (value === '' || value.includes(' ') || !value.includes('.')) return null;

  const parts = value.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const secondLevel = parts[parts.length - 2];
  if (parts.length > 2 && secondLevel && SECOND_LEVEL_LABELS.has(secondLevel)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/**
 * URL de LinkedIn de empresa reducida a su slug canónico.
 *
 * `https://www.linkedin.com/company/grupo-exito/about/?trk=x` y
 * `linkedin.com/company/grupo-exito` son la misma empresa; sin normalizar, la
 * ronda 2 las vería como dos.
 */
export function normalizeLinkedInCompanyUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === '') return null;

  const match = value.match(/linkedin\.com\/(?:company|school)\/([^/?#]+)/);
  if (!match) return null;
  const slug = decodeURIComponent(match[1] ?? '').replace(/\/+$/, '');
  return slug === '' ? null : `linkedin.com/company/${slug}`;
}

/** Formas jurídicas y relleno que no aportan identidad. */
const NAME_STOPWORDS: ReadonlySet<string> = new Set([
  'sa', 'sas', 'sac', 'srl', 'sl', 'ltda', 'ltd', 'llc', 'inc', 'corp',
  'corporation', 'company', 'compania', 'co', 'group', 'grupo', 'holding',
  'holdings', 'the', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'and', 'of',
  'cia', 'sociedad', 'anonima', 'limitada',
]);

/**
 * Nombre canónico: minúsculas, sin acentos, sin formas jurídicas, tokens
 * ordenados. "Almacenes Éxito S.A." y "Exito, Almacenes SA" colapsan al mismo
 * valor. Devuelve null cuando no queda ningún token significativo.
 */
export function normalizeCanonicalCompanyName(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const tokens = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !NAME_STOPWORDS.has(token));
  if (tokens.length === 0) return null;
  return [...tokens].sort().join(' ');
}

// ─── Contrato ─────────────────────────────────────────────────────────────────

/** Identidades de una organización, tal como llegan del proveedor. */
export type OrganizationIdentityInput = {
  providerOrganizationId?: string | null;
  domain?: string | null;
  linkedinUrl?: string | null;
  name?: string | null;
};

/**
 * Las cuatro identidades normalizadas. `canonicalName` viaja aparte de las
 * demás porque, por sí solo, no decide (ver cabecera).
 */
export type NormalizedOrganizationIdentity = {
  providerOrganizationId: string | null;
  normalizedDomain: string | null;
  normalizedLinkedInUrl: string | null;
  canonicalName: string | null;
};

export function normalizeOrganizationIdentity(
  input: OrganizationIdentityInput,
): NormalizedOrganizationIdentity {
  const providerOrganizationId = input.providerOrganizationId?.trim() || null;
  return {
    providerOrganizationId,
    normalizedDomain: normalizeOrganizationDomain(input.domain),
    normalizedLinkedInUrl: normalizeLinkedInCompanyUrl(input.linkedinUrl),
    canonicalName: normalizeCanonicalCompanyName(input.name),
  };
}

/** § 4: el registro compartido por toda la corrida. */
export type SeenOrganizationRegistry = {
  providerOrganizationIds: Set<string>;
  normalizedDomains: Set<string>;
  normalizedLinkedInUrls: Set<string>;
  canonicalNames: Set<string>;
};

export function createSeenOrganizationRegistry(): SeenOrganizationRegistry {
  return {
    providerOrganizationIds: new Set<string>(),
    normalizedDomains: new Set<string>(),
    normalizedLinkedInUrls: new Set<string>(),
    canonicalNames: new Set<string>(),
  };
}

/** Qué identidad hizo que la organización se reconociera como ya vista. */
export type SeenMatchReason =
  | 'provider_organization_id'
  | 'normalized_domain'
  | 'normalized_linkedin_url'
  | 'canonical_name_with_known_domain';

export type SeenVerdict =
  | { seen: false; identity: NormalizedOrganizationIdentity }
  | {
      seen: true;
      identity: NormalizedOrganizationIdentity;
      matchReason: SeenMatchReason;
    };

/**
 * ¿Conocemos ya esta organización?
 *
 * El orden de comprobación va de la señal más fuerte a la más débil, para que el
 * motivo reportado sea siempre el más defendible de los que aplican.
 */
export function evaluateSeenOrganization(
  registry: SeenOrganizationRegistry,
  input: OrganizationIdentityInput,
): SeenVerdict {
  const identity = normalizeOrganizationIdentity(input);

  if (
    identity.providerOrganizationId !== null &&
    registry.providerOrganizationIds.has(identity.providerOrganizationId)
  ) {
    return { seen: true, identity, matchReason: 'provider_organization_id' };
  }
  if (
    identity.normalizedDomain !== null &&
    registry.normalizedDomains.has(identity.normalizedDomain)
  ) {
    return { seen: true, identity, matchReason: 'normalized_domain' };
  }
  if (
    identity.normalizedLinkedInUrl !== null &&
    registry.normalizedLinkedInUrls.has(identity.normalizedLinkedInUrl)
  ) {
    return { seen: true, identity, matchReason: 'normalized_linkedin_url' };
  }
  // Nombre canónico SÓLO cuenta acompañado de un dominio ya conocido. Un nombre
  // suelto no identifica una empresa y rechazar por él descartaría homónimos
  // legítimos.
  if (
    identity.canonicalName !== null &&
    registry.canonicalNames.has(identity.canonicalName) &&
    identity.normalizedDomain !== null &&
    registry.normalizedDomains.has(identity.normalizedDomain)
  ) {
    return {
      seen: true,
      identity,
      matchReason: 'canonical_name_with_known_domain',
    };
  }

  return { seen: false, identity };
}

/**
 * Registra las identidades de una organización.
 *
 * Inmutable por contrato de retorno: devuelve un registro NUEVO y no muta el
 * recibido, en línea con la regla de inmutabilidad del repo. El orquestador
 * encadena el valor devuelto.
 */
export function registerSeenOrganization(
  registry: SeenOrganizationRegistry,
  identity: NormalizedOrganizationIdentity,
): SeenOrganizationRegistry {
  const next: SeenOrganizationRegistry = {
    providerOrganizationIds: new Set(registry.providerOrganizationIds),
    normalizedDomains: new Set(registry.normalizedDomains),
    normalizedLinkedInUrls: new Set(registry.normalizedLinkedInUrls),
    canonicalNames: new Set(registry.canonicalNames),
  };
  if (identity.providerOrganizationId !== null) {
    next.providerOrganizationIds.add(identity.providerOrganizationId);
  }
  if (identity.normalizedDomain !== null) {
    next.normalizedDomains.add(identity.normalizedDomain);
  }
  if (identity.normalizedLinkedInUrl !== null) {
    next.normalizedLinkedInUrls.add(identity.normalizedLinkedInUrl);
  }
  if (identity.canonicalName !== null) {
    next.canonicalNames.add(identity.canonicalName);
  }
  return next;
}

/** Total de identidades registradas. Alimenta `excluded_seen_organization_count`. */
export function countSeenOrganizations(registry: SeenOrganizationRegistry): number {
  // Los ids de proveedor son la identidad más completa y la que Apollo siempre
  // trae; contar la unión de los cuatro conjuntos inflaría el número al contar
  // varias identidades de la misma empresa.
  return Math.max(
    registry.providerOrganizationIds.size,
    registry.normalizedDomains.size,
  );
}

/** Vista serializable del registro. Sin PII: dominios, slugs e ids de empresa. */
export function toSeenRegistrySnapshot(registry: SeenOrganizationRegistry): {
  provider_organization_id_count: number;
  normalized_domain_count: number;
  normalized_linkedin_url_count: number;
  canonical_name_count: number;
} {
  return {
    provider_organization_id_count: registry.providerOrganizationIds.size,
    normalized_domain_count: registry.normalizedDomains.size,
    normalized_linkedin_url_count: registry.normalizedLinkedInUrls.size,
    canonical_name_count: registry.canonicalNames.size,
  };
}
