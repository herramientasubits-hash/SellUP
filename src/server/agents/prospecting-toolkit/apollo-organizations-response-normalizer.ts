/**
 * A1-APOLLO-WIZARD-1 — Normalizador de la respuesta de Apollo Organization Search.
 *
 * Puro: sin fetch, sin env, sin Supabase. Recibe el payload ya deserializado.
 *
 * Por qué existe:
 *   La documentación moderna se centra en `organizations[]`, pero soporte
 *   confirmó que respuestas históricas o mixtas pueden traer también
 *   `accounts[]`. El cliente anterior hacía `accounts ?? organizations`, es
 *   decir: le daba prioridad al array equivocado y, peor, usaba `accounts[*].id`
 *   —que es el id del registro en el workspace— como si fuera el Apollo
 *   Organization ID. Dos empresas distintas podían colisionar y una misma
 *   empresa podía aparecer con dos identidades.
 *
 * Contrato de precedencia:
 *   1. `organizations[]` es la fuente principal de campos empresariales.
 *   2. `accounts[]` sólo COMPLETA campos ausentes y aporta metadata del
 *      workspace (`providerAccountId`).
 *   3. `accounts` nunca sobrescribe un campo empresarial válido de `organizations`.
 *   4. El emparejamiento es `accounts[*].organization_id === organizations[*].id`.
 *   5. Deduplicación defensiva por Apollo Organization ID.
 *
 * Todo campo es opcional: una respuesta sin `primary_domain`, sin `country` o
 * sin `founded_year` es válida y no debe romper nada.
 */

// ─── Tipos de entrada (tolerantes) ────────────────────────────────────────────

/** Forma cruda tolerante — todo opcional porque Apollo omite campos según plan. */
export type ApolloRawOrganization = {
  id?: string | null;
  organization_id?: string | null;
  name?: string | null;
  primary_domain?: string | null;
  all_domains?: readonly (string | null | undefined)[] | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  phone?: string | null;
  founded_year?: number | string | null;
  country?: string | null;
  city?: string | null;
  industry?: string | null;
  industries?: readonly string[] | null;
  keywords?: readonly string[] | null;
  organization_keywords?: readonly string[] | null;
  estimated_num_employees?: number | null;
  employee_count?: number | null;
  short_description?: string | null;
  seo_description?: string | null;
  description?: string | null;
  technologies?: readonly string[] | null;
  /** Presente en `accounts[*]`: apunta a la organización canónica. */
  [key: string]: unknown;
};

export type ApolloOrganizationsRawPayload = {
  organizations?: readonly ApolloRawOrganization[] | null;
  accounts?: readonly ApolloRawOrganization[] | null;
  pagination?: {
    page?: number | null;
    per_page?: number | null;
    total_entries?: number | null;
    total_pages?: number | null;
  } | null;
} | null | undefined;

// ─── Tipos de salida ──────────────────────────────────────────────────────────

/** Referencia al registro del PROVEEDOR. No es la identidad de la empresa. */
export type ApolloProviderReference = {
  provider: 'apollo';
  /** Apollo Organization ID. Identifica el registro de Apollo, no a la empresa. */
  providerOrganizationId: string;
  /** `accounts[*].id` — id del registro en el workspace. Nunca es el org id. */
  providerAccountId: string | null;
};

export type NormalizedApolloOrganization = {
  providerReference: ApolloProviderReference;
  name: string | null;
  primaryDomain: string | null;
  /** primary_domain + all_domains, normalizados y deduplicados. Alias de identidad. */
  normalizedDomains: string[];
  websiteUrl: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  foundedYear: number | null;
  country: string | null;
  city: string | null;
  industry: string | null;
  industries: string[];
  keywords: string[];
  organizationKeywords: string[];
  estimatedNumEmployees: number | null;
  shortDescription: string | null;
  seoDescription: string | null;
  description: string | null;
  technologies: string[];
  /** Campos que `accounts` completó porque `organizations` no los traía. */
  filledFromAccountFields: string[];
};

export type ApolloResponsePagination = {
  page: number | null;
  perPage: number | null;
  totalEntries: number | null;
  totalPages: number | null;
};

export type ApolloOrganizationsNormalizationMeta = {
  organizations_array_present: boolean;
  accounts_array_present: boolean;
  organizations_raw_count: number;
  accounts_raw_count: number;
  /** Orgs provenientes sólo de `accounts` porque no había entrada en `organizations`. */
  accounts_only_count: number;
  /** Orgs de `accounts` que completaron campos ausentes de `organizations`. */
  accounts_merged_count: number;
  duplicates_removed_count: number;
  dropped_without_id_count: number;
  source_priority: 'organizations_first';
};

export type ApolloOrganizationsNormalizationResult = {
  organizations: NormalizedApolloOrganization[];
  pagination: ApolloResponsePagination;
  meta: ApolloOrganizationsNormalizationMeta;
};

// ─── Normalización de dominios ────────────────────────────────────────────────

/**
 * Normaliza un dominio: quita protocolo, `www.`, puerto, path, query, mayúsculas
 * y slash final. Devuelve null si no queda un hostname con punto — un valor sin
 * punto no es un dominio, es ruido.
 */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0] ?? '';
  value = value.split('?')[0] ?? '';
  value = value.split('#')[0] ?? '';
  value = value.split('@').pop() ?? '';
  value = value.split(':')[0] ?? '';
  value = value.replace(/^www\./, '');
  value = value.replace(/\.+$/, '');

  if (!value || !value.includes('.')) return null;
  if (!/^[a-z0-9.-]+$/.test(value)) return null;
  if (value.startsWith('.') || value.includes('..')) return null;

  return value;
}

/**
 * `primary_domain` primero, luego `all_domains`. `all_domains` es alias de
 * identidad: amplía el conjunto, no reemplaza al dominio principal.
 */
export function buildNormalizedDomains(
  primaryDomain: string | null | undefined,
  allDomains: readonly (string | null | undefined)[] | null | undefined,
  websiteUrl?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined): void => {
    const normalized = normalizeDomain(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  push(primaryDomain);
  for (const domain of allDomains ?? []) push(domain);
  // El website sólo entra si no hay ningún dominio declarado: es la derivación
  // más débil y no debe desplazar a primary_domain.
  if (out.length === 0) push(websiteUrl);

  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const str = readString(item);
    if (!str) continue;
    const key = str.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(str);
  }
  return out;
}

/**
 * El Apollo Organization ID de una entrada.
 *
 * En `organizations[*]` es `id`. En `accounts[*]` es `organization_id`, y `id`
 * es el id de la cuenta del workspace. Confundirlos es exactamente el defecto
 * que este módulo cierra, así que el origen se pasa explícito.
 */
function resolveOrganizationId(
  entry: ApolloRawOrganization,
  origin: 'organizations' | 'accounts',
): string | null {
  if (origin === 'organizations') {
    return readString(entry.id) ?? readString(entry.organization_id);
  }
  return readString(entry.organization_id);
}

function toNormalized(
  entry: ApolloRawOrganization,
  organizationId: string,
  providerAccountId: string | null,
): NormalizedApolloOrganization {
  return {
    providerReference: {
      provider: 'apollo',
      providerOrganizationId: organizationId,
      providerAccountId,
    },
    name: readString(entry.name),
    primaryDomain: normalizeDomain(entry.primary_domain),
    normalizedDomains: buildNormalizedDomains(
      entry.primary_domain,
      entry.all_domains,
      entry.website_url,
    ),
    websiteUrl: readString(entry.website_url),
    linkedinUrl: readString(entry.linkedin_url),
    phone: readString(entry.phone),
    foundedYear: readNumber(entry.founded_year),
    country: readString(entry.country),
    city: readString(entry.city),
    industry: readString(entry.industry),
    industries: readStringArray(entry.industries),
    keywords: readStringArray(entry.keywords),
    organizationKeywords: readStringArray(entry.organization_keywords),
    estimatedNumEmployees:
      readNumber(entry.estimated_num_employees) ?? readNumber(entry.employee_count),
    shortDescription: readString(entry.short_description),
    seoDescription: readString(entry.seo_description),
    description: readString(entry.description),
    technologies: readStringArray(entry.technologies),
    filledFromAccountFields: [],
  };
}

/** Campos empresariales que `accounts` puede completar, nunca sobrescribir. */
const ACCOUNT_FILLABLE_SCALAR_FIELDS = [
  'name',
  'primaryDomain',
  'websiteUrl',
  'linkedinUrl',
  'phone',
  'foundedYear',
  'country',
  'city',
  'industry',
  'shortDescription',
  'seoDescription',
  'description',
  'estimatedNumEmployees',
] as const;

const ACCOUNT_FILLABLE_ARRAY_FIELDS = [
  'industries',
  'keywords',
  'organizationKeywords',
  'technologies',
] as const;

/**
 * Fusiona una entrada de `accounts` sobre la organización canónica. Devuelve un
 * objeto nuevo — no muta.
 */
function mergeAccountIntoOrganization(
  organization: NormalizedApolloOrganization,
  account: NormalizedApolloOrganization,
  accountId: string | null,
): NormalizedApolloOrganization {
  const filled: string[] = [];
  const merged: NormalizedApolloOrganization = {
    ...organization,
    providerReference: {
      ...organization.providerReference,
      // El account id es metadata del workspace: se adopta si la organización
      // aún no lo tiene, sin tocar jamás providerOrganizationId.
      providerAccountId: organization.providerReference.providerAccountId ?? accountId,
    },
  };

  for (const field of ACCOUNT_FILLABLE_SCALAR_FIELDS) {
    if (merged[field] === null && account[field] !== null) {
      (merged as Record<string, unknown>)[field] = account[field];
      filled.push(field);
    }
  }

  for (const field of ACCOUNT_FILLABLE_ARRAY_FIELDS) {
    if (merged[field].length === 0 && account[field].length > 0) {
      (merged as Record<string, unknown>)[field] = [...account[field]];
      filled.push(field);
    }
  }

  if (merged.normalizedDomains.length === 0 && account.normalizedDomains.length > 0) {
    merged.normalizedDomains = [...account.normalizedDomains];
    filled.push('normalizedDomains');
  }

  merged.filledFromAccountFields = filled;
  return merged;
}

// ─── Normalizador principal ───────────────────────────────────────────────────

/**
 * Normaliza el payload de `mixed_companies/search`.
 *
 * Tolerante por diseño: un payload nulo, sin arrays o con entradas sin id
 * produce un resultado vacío con metadata explicativa, nunca una excepción.
 */
export function normalizeApolloOrganizationsResponse(
  payload: ApolloOrganizationsRawPayload,
): ApolloOrganizationsNormalizationResult {
  const rawOrganizations = Array.isArray(payload?.organizations) ? payload!.organizations! : null;
  const rawAccounts = Array.isArray(payload?.accounts) ? payload!.accounts! : null;

  let droppedWithoutId = 0;
  let duplicatesRemoved = 0;

  // ── 1. organizations[] — fuente principal ─────────────────────────────────
  const byOrganizationId = new Map<string, NormalizedApolloOrganization>();
  const order: string[] = [];

  for (const entry of rawOrganizations ?? []) {
    const organizationId = resolveOrganizationId(entry, 'organizations');
    if (!organizationId) { droppedWithoutId++; continue; }
    if (byOrganizationId.has(organizationId)) { duplicatesRemoved++; continue; }
    byOrganizationId.set(organizationId, toNormalized(entry, organizationId, null));
    order.push(organizationId);
  }

  // ── 2. accounts[] — sólo completa ─────────────────────────────────────────
  let accountsOnly = 0;
  let accountsMerged = 0;
  const seenAccountOrgIds = new Set<string>();

  for (const entry of rawAccounts ?? []) {
    const organizationId = resolveOrganizationId(entry, 'accounts');
    const accountId = readString(entry.id);

    if (!organizationId) {
      // Sin organization_id no hay forma legítima de emparejar. Usar
      // `accounts[*].id` como org id es precisamente el bug que evitamos.
      droppedWithoutId++;
      continue;
    }

    if (seenAccountOrgIds.has(organizationId)) { duplicatesRemoved++; continue; }
    seenAccountOrgIds.add(organizationId);

    const accountAsOrganization = toNormalized(entry, organizationId, accountId);
    const existing = byOrganizationId.get(organizationId);

    if (!existing) {
      // Sólo en accounts: se acepta como organización, con su procedencia clara.
      byOrganizationId.set(organizationId, accountAsOrganization);
      order.push(organizationId);
      accountsOnly++;
      continue;
    }

    const merged = mergeAccountIntoOrganization(existing, accountAsOrganization, accountId);
    byOrganizationId.set(organizationId, merged);
    accountsMerged++;
  }

  const pagination = payload?.pagination ?? null;

  return {
    organizations: order.map((id) => byOrganizationId.get(id)!),
    pagination: {
      page: readNumber(pagination?.page),
      perPage: readNumber(pagination?.per_page),
      totalEntries: readNumber(pagination?.total_entries),
      totalPages: readNumber(pagination?.total_pages),
    },
    meta: {
      organizations_array_present: rawOrganizations !== null,
      accounts_array_present: rawAccounts !== null,
      organizations_raw_count: rawOrganizations?.length ?? 0,
      accounts_raw_count: rawAccounts?.length ?? 0,
      accounts_only_count: accountsOnly,
      accounts_merged_count: accountsMerged,
      duplicates_removed_count: duplicatesRemoved,
      dropped_without_id_count: droppedWithoutId,
      source_priority: 'organizations_first',
    },
  };
}
