/**
 * hubspot-free-company-pool.server.ts — lectura de las empresas LIBRES de HubSpot.
 *
 * HUBSPOT-FREE-POOL-SOURCE-1. Sólo lectura: `GET /crm/v3/owners` y
 * `POST /crm/v3/objects/companies/search` (una búsqueda no escribe nada).
 *
 *   · `loadHubSpotOwnerDirectory` — dueños activos, bolsas y desactivados (caché 10 min);
 *   · `assessHubSpotCompanyAvailability` — la regla de `hubspot-free-company-policy`
 *     sobre una ficha ya leída;
 *   · `searchHubSpotFreeCompanies` — las libres de un país × macro industria, para la
 *     capa gratuita del Agente 1.
 *
 * Nunca lanza: HubSpot caído ⇒ `null`/lista vacía y la búsqueda sigue como antes.
 */

import { getHubSpotToken } from './hubspot-company-create';
import { fetchHubSpotWithRetry } from './hubspot-rate-limit';
import {
  buildHubSpotOwnerDirectory,
  classifyHubSpotCompanyAvailability,
  HUBSPOT_FREE_POLICY_PROPERTIES,
  HUBSPOT_RECYCLED_LEAD_STATUS,
  hubSpotMacroIndustryValue,
  hubSpotPaisForCountryCode,
  type HubSpotAvailability,
  type HubSpotFreeReason,
  type HubSpotOwnerDirectory,
  type HubSpotOwnerRecord,
} from './hubspot-free-company-policy';

const HUBSPOT_API = 'https://api.hubapi.com';
const REQUEST_TIMEOUT_MS = 10_000;
const OWNER_DIRECTORY_TTL_MS = 10 * 60 * 1000;
/** Valores por filtro `IN` que HubSpot acepta en una búsqueda. */
const SEARCH_IN_MAX_VALUES = 100;
const SEARCH_PAGE_SIZE = 100;

export type HubSpotFetch = typeof fetch;

type OwnersResponse = { results?: HubSpotOwnerRecord[]; paging?: { next?: { after?: string } } };

/** Un fallo de HubSpot con su causa, para la telemetría del lote (nunca se calla). */
export type HubSpotPoolFailure = { stage: 'token' | 'owners' | 'search' | 'exception'; httpStatus: number | null; message: string | null };

async function readOwners(
  token: string,
  archived: boolean,
  fetchFn: HubSpotFetch,
): Promise<{ owners: HubSpotOwnerRecord[] } | { failure: HubSpotPoolFailure }> {
  const owners: HubSpotOwnerRecord[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const url = `${HUBSPOT_API}/crm/v3/owners?limit=500&archived=${archived}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const res = await fetchHubSpotWithRetry(url, { headers: { Authorization: `Bearer ${token}` } }, REQUEST_TIMEOUT_MS, { fetchFn });
    if (!res.ok) return { failure: { stage: 'owners', httpStatus: res.status, message: `archived=${archived}` } };
    const body = (await res.json()) as OwnersResponse;
    owners.push(...(body.results ?? []));
    after = body.paging?.next?.after;
    if (!after) break;
  }
  return { owners };
}

/** Tras un fallo, no se vuelve a pedir el directorio durante este plazo (evita la avalancha). */
const OWNER_DIRECTORY_FAILURE_TTL_MS = 60 * 1000;

let ownerDirectoryCache: { directory: HubSpotOwnerDirectory; loadedAt: number } | null = null;
let ownerDirectoryFailure: { failure: HubSpotPoolFailure; at: number } | null = null;
let ownerDirectoryInFlight: Promise<HubSpotOwnerDirectory | null> | null = null;

/** Sólo para pruebas: vacía la caché del directorio de dueños. */
export function resetHubSpotOwnerDirectoryCache(): void {
  ownerDirectoryCache = null;
  ownerDirectoryFailure = null;
  ownerDirectoryInFlight = null;
}

/** El último fallo del directorio de dueños, si es reciente (telemetría). */
export function lastHubSpotOwnerDirectoryFailure(): HubSpotPoolFailure | null {
  return ownerDirectoryFailure?.failure ?? null;
}

/**
 * Dueños de HubSpot clasificados. `null` si HubSpot no responde.
 *
 * Una sola lectura a la vez: con el caché frío, decenas de chequeos de duplicado en
 * paralelo esperan la MISMA petición en vez de lanzar cada uno 2 × N páginas (medido
 * 15-10: la avalancha produce 429). Un fallo se recuerda un minuto y se registra.
 */
export async function loadHubSpotOwnerDirectory(
  token: string,
  options: { fetchFn?: HubSpotFetch; now?: () => number } = {},
): Promise<HubSpotOwnerDirectory | null> {
  const now = options.now?.() ?? Date.now();
  if (ownerDirectoryCache && now - ownerDirectoryCache.loadedAt < OWNER_DIRECTORY_TTL_MS) {
    return ownerDirectoryCache.directory;
  }
  if (ownerDirectoryFailure && now - ownerDirectoryFailure.at < OWNER_DIRECTORY_FAILURE_TTL_MS) return null;
  if (ownerDirectoryInFlight) return ownerDirectoryInFlight;

  const fetchFn = options.fetchFn ?? fetch;
  const remember = (failure: HubSpotPoolFailure): null => {
    ownerDirectoryFailure = { failure, at: now };
    console.error('[hubspot-free-pool] directorio de dueños no disponible:', failure);
    return null;
  };
  ownerDirectoryInFlight = (async () => {
    try {
      const [active, archived] = await Promise.all([readOwners(token, false, fetchFn), readOwners(token, true, fetchFn)]);
      if ('failure' in active) return remember(active.failure);
      if ('failure' in archived) return remember(archived.failure);
      const directory = buildHubSpotOwnerDirectory(active.owners, archived.owners);
      ownerDirectoryCache = { directory, loadedAt: now };
      ownerDirectoryFailure = null;
      return directory;
    } catch (err) {
      return remember({ stage: 'exception', httpStatus: null, message: err instanceof Error ? err.message : String(err) });
    } finally {
      ownerDirectoryInFlight = null;
    }
  })();
  return ownerDirectoryInFlight;
}

/**
 * La regla sobre una ficha YA leída. `null` cuando la ficha no trae las propiedades
 * que la regla necesita (p. ej. vino del nivel mínimo de propiedades): sin dueño
 * leído NO se puede presumir «sin dueño».
 */
export async function assessHubSpotCompanyAvailability(
  token: string,
  properties: Record<string, unknown>,
  options: { fetchFn?: HubSpotFetch; now?: Date } = {},
): Promise<HubSpotAvailability | null> {
  const complete = HUBSPOT_FREE_POLICY_PROPERTIES.every((name) => name in properties);
  if (!complete) return null;
  const owners = await loadHubSpotOwnerDirectory(token, { fetchFn: options.fetchFn });
  if (!owners) return null;
  return classifyHubSpotCompanyAvailability(properties, owners, options.now ?? new Date());
}

// ─── Búsqueda de libres por país × macro industria ───────────────────────────

/** Lo que la capa gratuita necesita de cada empresa libre. */
export type HubSpotFreeCompany = {
  hubspotCompanyId: string;
  name: string;
  domain: string | null;
  website: string | null;
  countryCode: string;
  city: string | null;
  region: string | null;
  taxIdentifier: string | null;
  employees: number | null;
  linkedinUrl: string | null;
  description: string | null;
  ownerId: string | null;
  numContacts: number;
  freeReason: HubSpotFreeReason;
};

export const HUBSPOT_FREE_POOL_SEARCH_PROPERTIES = [
  'name',
  'domain',
  'website',
  'city',
  'state',
  'pais',
  'industriaespecifica',
  'identificaci_n_fiscal',
  'numberofemployees',
  'linkedin_company_page',
  'description',
  'num_associated_contacts',
  ...HUBSPOT_FREE_POLICY_PROPERTIES,
] as const;

type SearchFilter = { propertyName: string; operator: string; value?: string; values?: string[] };
type SearchResponse = {
  total?: number;
  results?: Array<{ id: string; properties: Record<string, string | null> }>;
  paging?: { next?: { after?: string } };
};

export type HubSpotFreeSearchInput = {
  countryCode: string;
  macroIndustryKey: string;
  /** Cuántas libres como máximo. */
  limit: number;
  /** Ids de HubSpot que ya pasaron por SellUp: no se vuelven a ofrecer. */
  excludeHubSpotCompanyIds?: ReadonlySet<string>;
};

export type HubSpotFreeSearchResult = {
  status: 'ok' | 'unavailable' | 'unsupported_criteria';
  companies: HubSpotFreeCompany[];
  /** Fichas leídas de HubSpot (antes de la regla y de la exclusión). */
  recordsRead: number;
  byReason: Partial<Record<HubSpotFreeReason, number>>;
  /** Por qué no rindió (sólo con `unavailable`, o si se cortó a mitad). */
  failure?: HubSpotPoolFailure;
  /** Leídas que no entraron, por causa: tomadas, sin dominio o nombre, ya ofrecidas. */
  droppedBy?: { not_free: number; no_domain_or_name: number; excluded: number };
};

function cleanDomain(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  return host.length > 0 ? host : null;
}

function positiveInt(value: string | null | undefined): number | null {
  const n = Number(value ?? '');
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Una búsqueda por bolsa: Recycled, dueño bolsa, sin dueño, dueño desactivado. */
export function buildFreePoolSearchSegments(
  owners: HubSpotOwnerDirectory,
): Array<{ reason: HubSpotFreeReason; filters: SearchFilter[] }> {
  const chunks = (ids: ReadonlySet<string>): string[][] => {
    const all = [...ids];
    const out: string[][] = [];
    for (let i = 0; i < all.length; i += SEARCH_IN_MAX_VALUES) out.push(all.slice(i, i + SEARCH_IN_MAX_VALUES));
    return out;
  };
  return [
    { reason: 'recycled', filters: [{ propertyName: 'hs_lead_status', operator: 'EQ', value: HUBSPOT_RECYCLED_LEAD_STATUS }] },
    ...chunks(owners.poolIds).map((values) => ({
      reason: 'pool_owner' as const,
      filters: [{ propertyName: 'hubspot_owner_id', operator: 'IN', values }],
    })),
    { reason: 'no_owner', filters: [{ propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' }] },
    ...chunks(owners.deactivatedIds).map((values) => ({
      reason: 'deactivated_owner' as const,
      filters: [{ propertyName: 'hubspot_owner_id', operator: 'IN', values }],
    })),
  ];
}

async function searchPage(
  token: string,
  filters: SearchFilter[],
  after: string | undefined,
  fetchFn: HubSpotFetch,
): Promise<SearchResponse | HubSpotPoolFailure> {
  const res = await fetchHubSpotWithRetry(
    `${HUBSPOT_API}/crm/v3/objects/companies/search`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filterGroups: [{ filters }],
        properties: HUBSPOT_FREE_POOL_SEARCH_PROPERTIES,
        // Las mejor documentadas primero: más contactos ⇒ menos que pagar después.
        sorts: [{ propertyName: 'num_associated_contacts', direction: 'DESCENDING' }],
        limit: SEARCH_PAGE_SIZE,
        ...(after ? { after } : {}),
      }),
    },
    REQUEST_TIMEOUT_MS,
    { fetchFn },
  );
  if (!res.ok) return { stage: 'search', httpStatus: res.status, message: null };
  return (await res.json()) as SearchResponse;
}

function isFailure(value: SearchResponse | HubSpotPoolFailure): value is HubSpotPoolFailure {
  return 'stage' in value;
}

/**
 * Las libres del país × macro industria, en orden: recicladas, bolsas, sin dueño,
 * dueño desactivado. Cada una pasa otra vez por la regla completa (cliente, negocio
 * abierto, actividad reciente) con su ficha.
 */
export async function searchHubSpotFreeCompanies(
  input: HubSpotFreeSearchInput,
  options: {
    fetchFn?: HubSpotFetch;
    now?: Date;
    resolveToken?: () => Promise<string | null>;
    /** Páginas por bolsa como máximo (cada una de 100). */
    maxPagesPerSegment?: number;
  } = {},
): Promise<HubSpotFreeSearchResult> {
  const empty = (status: HubSpotFreeSearchResult['status'], failure?: HubSpotPoolFailure): HubSpotFreeSearchResult => {
    if (failure) console.error('[hubspot-free-pool] búsqueda no disponible:', failure);
    return { status, companies: [], recordsRead: 0, byReason: {}, ...(failure ? { failure } : {}) };
  };
  const pais = hubSpotPaisForCountryCode(input.countryCode);
  const macro = hubSpotMacroIndustryValue(input.macroIndustryKey);
  const limit = Math.max(0, Math.trunc(input.limit));
  if (!pais || !macro || limit === 0) return empty('unsupported_criteria');

  try {
    const fetchFn = options.fetchFn ?? fetch;
    const token = await (options.resolveToken ?? getHubSpotToken)();
    if (!token) return empty('unavailable', { stage: 'token', httpStatus: null, message: 'token_unavailable' });
    const owners = await loadHubSpotOwnerDirectory(token, { fetchFn });
    if (!owners) {
      return empty('unavailable', lastHubSpotOwnerDirectoryFailure() ?? { stage: 'owners', httpStatus: null, message: null });
    }

    const now = options.now ?? new Date();
    const exclude = input.excludeHubSpotCompanyIds ?? new Set<string>();
    const common: SearchFilter[] = [
      { propertyName: 'pais', operator: 'EQ', value: pais },
      { propertyName: 'industriaespecifica', operator: 'EQ', value: macro },
      { propertyName: 'domain', operator: 'HAS_PROPERTY' },
    ];
    const maxPages = options.maxPagesPerSegment ?? 3;
    const seen = new Set<string>();
    const companies: HubSpotFreeCompany[] = [];
    const byReason: Partial<Record<HubSpotFreeReason, number>> = {};
    let recordsRead = 0;
    const droppedBy = { not_free: 0, no_domain_or_name: 0, excluded: 0 };

    for (const segment of buildFreePoolSearchSegments(owners)) {
      let after: string | undefined;
      for (let page = 0; page < maxPages && companies.length < limit; page += 1) {
        const body = await searchPage(token, [...common, ...segment.filters], after, fetchFn);
        if (isFailure(body)) {
          if (companies.length === 0) return empty('unavailable', body);
          console.error('[hubspot-free-pool] búsqueda cortada a mitad:', body);
          return { status: 'ok', companies, recordsRead, byReason, droppedBy, failure: body };
        }
        for (const row of body.results ?? []) {
          recordsRead += 1;
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          if (exclude.has(row.id)) {
            droppedBy.excluded += 1;
            continue;
          }
          const verdict = classifyHubSpotCompanyAvailability(row.properties, owners, now);
          if (!verdict.free) {
            droppedBy.not_free += 1;
            continue;
          }
          const domain = cleanDomain(row.properties.domain) ?? cleanDomain(row.properties.website);
          const name = nonEmpty(row.properties.name);
          if (!domain || !name) {
            droppedBy.no_domain_or_name += 1;
            continue;
          }
          companies.push({
            hubspotCompanyId: row.id,
            name,
            domain,
            website: nonEmpty(row.properties.website) ?? `https://${domain}`,
            countryCode: input.countryCode.toUpperCase(),
            city: nonEmpty(row.properties.city),
            region: nonEmpty(row.properties.state),
            taxIdentifier: nonEmpty(row.properties.identificaci_n_fiscal),
            employees: positiveInt(row.properties.numberofemployees),
            linkedinUrl: nonEmpty(row.properties.linkedin_company_page),
            description: nonEmpty(row.properties.description),
            ownerId: nonEmpty(row.properties.hubspot_owner_id),
            numContacts: positiveInt(row.properties.num_associated_contacts) ?? 0,
            freeReason: verdict.reason,
          });
          byReason[verdict.reason] = (byReason[verdict.reason] ?? 0) + 1;
          if (companies.length >= limit) break;
        }
        after = body.paging?.next?.after;
        if (!after) break;
      }
      if (companies.length >= limit) break;
    }
    return { status: 'ok', companies, recordsRead, byReason, droppedBy };
  } catch (err) {
    return empty('unavailable', { stage: 'exception', httpStatus: null, message: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * La regla, leída EN ESTE MOMENTO para una ficha (al aprobar). `null` si HubSpot no
 * responde: quien llama no cambia el dueño sin saber.
 */
export async function readHubSpotCompanyAvailabilityById(
  hubspotCompanyId: string,
  options: { fetchFn?: HubSpotFetch; now?: Date; resolveToken?: () => Promise<string | null> } = {},
): Promise<HubSpotAvailability | null> {
  try {
    const fetchFn = options.fetchFn ?? fetch;
    const token = await (options.resolveToken ?? getHubSpotToken)();
    if (!token) return null;
    const url = `${HUBSPOT_API}/crm/v3/objects/companies/${encodeURIComponent(hubspotCompanyId)}?properties=${HUBSPOT_FREE_POLICY_PROPERTIES.join(',')}`;
    const res = await fetchHubSpotWithRetry(url, { headers: { Authorization: `Bearer ${token}` } }, REQUEST_TIMEOUT_MS, {
      fetchFn,
    });
    if (!res.ok) {
      console.error(`[hubspot-free-pool] no se pudo leer la ficha ${hubspotCompanyId} al aprobar: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { properties?: Record<string, unknown> };
    if (!body.properties) return null;
    return await assessHubSpotCompanyAvailability(token, body.properties, { fetchFn, now: options.now });
  } catch (err) {
    console.error(`[hubspot-free-pool] no se pudo leer la ficha ${hubspotCompanyId} al aprobar:`, err);
    return null;
  }
}
