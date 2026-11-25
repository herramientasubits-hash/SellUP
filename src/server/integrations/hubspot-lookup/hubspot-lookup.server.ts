/**
 * Consulta de HubSpot desde SellUp (lecturas). SÓLO LECTURA: nunca escribe en HubSpot.
 *
 * Cada petición tiene techo de espera y un único reintento ante 429: es una pantalla que
 * alguien está mirando, no un proceso de fondo. Si HubSpot no contesta, se dice
 * («no disponible») y SellUp sigue funcionando con lo suyo.
 */

import { getHubSpotToken } from '@/server/integrations/hubspot-company-create';
import { fetchHubSpotWithRetry } from '@/server/integrations/hubspot-rate-limit';
import {
  HUBSPOT_ACTIVITY_OBJECTS,
  HUBSPOT_ASSOCIATIONS_LIMIT,
  HUBSPOT_LOOKUP_COMPANY_PROPERTIES,
  HUBSPOT_LOOKUP_CONTACT_PROPERTIES,
  associationIds,
  buildHubSpotLookupPlan,
  createdActivityItem,
  isHubSpotObjectId,
  mapHubSpotActivity,
  mapHubSpotCompany,
  mapHubSpotContact,
  mergeLookupHits,
  ownerDisplayName,
  sortAndTrimActivity,
  type HubSpotActivityItem,
  type HubSpotActivityKind,
  type HubSpotCompanyView,
  type HubSpotContactView,
} from './hubspot-lookup-core';
import {
  buildPropertySections,
  ownerIdsInValues,
  parsePropertyDefinitions,
  parsePropertyGroups,
  readablePropertyNames,
  type HubSpotPropertyDefinition,
  type HubSpotPropertyGroupDefinition,
  type HubSpotPropertySection,
} from './hubspot-properties-core';
import { parseSearchCriteria } from '@/modules/global-search/search-criteria';

const HUBSPOT_API = 'https://api.hubapi.com';
const REQUEST_TIMEOUT_MS = 8_000;
const RETRY = { maxRetries: 1 } as const;
const OWNER_CACHE_TTL_MS = 30 * 60 * 1000;
const STAGE_CACHE_TTL_MS = 30 * 60 * 1000;

export type HubSpotLookupFailure = 'not_connected' | 'unavailable';

export class HubSpotLookupError extends Error {
  constructor(readonly reason: HubSpotLookupFailure, message?: string) {
    super(message ?? reason);
    this.name = 'HubSpotLookupError';
  }
}

type RawObject = { id: string; properties?: Record<string, string | null | undefined> };

async function requireToken(): Promise<string> {
  const token = await getHubSpotToken();
  if (!token) throw new HubSpotLookupError('not_connected');
  return token;
}

async function hubspotGet(token: string, path: string): Promise<Response> {
  return fetchHubSpotWithRetry(`${HUBSPOT_API}${path}`, { headers: { Authorization: `Bearer ${token}` } }, REQUEST_TIMEOUT_MS, RETRY);
}

async function hubspotPost(token: string, path: string, body: unknown): Promise<Response> {
  return fetchHubSpotWithRetry(
    `${HUBSPOT_API}${path}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    REQUEST_TIMEOUT_MS,
    RETRY,
  );
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new HubSpotLookupError('unavailable', `${what}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Lectura que puede faltar sin tumbar la ficha (p. ej. correos sin permiso). */
async function optional<T>(run: () => Promise<T>, fallback: T, label: string): Promise<{ value: T; failed: boolean }> {
  try {
    return { value: await run(), failed: false };
  } catch (error) {
    console.warn(`[hubspot-lookup] ${label} no disponible:`, error instanceof Error ? error.message : error);
    return { value: fallback, failed: true };
  }
}

// ── Búsqueda ────────────────────────────────────────────────────────────────

/** Una búsqueda que falla no tumba las demás; si fallan todas, HubSpot no está disponible. */
async function settledLists<T>(runs: ReadonlyArray<Promise<T[]>>, what: string): Promise<T[][]> {
  const settled = await Promise.allSettled(runs);
  const ok = settled.filter((r): r is PromiseFulfilledResult<T[]> => r.status === 'fulfilled').map((r) => r.value);
  if (ok.length === 0 && settled.length > 0) {
    const first = settled[0] as PromiseRejectedResult;
    throw first.reason instanceof HubSpotLookupError ? first.reason : new HubSpotLookupError('unavailable', `${what}: ${String(first.reason)}`);
  }
  settled.forEach((r) => {
    if (r.status === 'rejected') console.warn(`[hubspot-lookup] ${what}:`, r.reason instanceof Error ? r.reason.message : r.reason);
  });
  return ok;
}

async function searchObjects(token: string, objectType: 'companies' | 'contacts', body: unknown): Promise<RawObject[]> {
  // Rutas literales: la guarda estática de «0 escrituras» sólo admite búsquedas y lecturas.
  const res =
    objectType === 'companies'
      ? await hubspotPost(token, '/crm/v3/objects/companies/search', body)
      : await hubspotPost(token, '/crm/v3/objects/contacts/search', body);
  return (await readJson<{ results?: RawObject[] }>(res, `búsqueda de ${objectType}`)).results ?? [];
}

/**
 * Búsqueda general en HubSpot por lo escrito: texto libre (nombre, dominio, correo…), número
 * fiscal, teléfono e ID (ver `buildHubSpotLookupPlan`). Sólo lectura.
 */
export async function searchHubSpotCompaniesAndContacts(
  query: string,
): Promise<{ companies: HubSpotCompanyView[]; contacts: HubSpotContactView[] }> {
  const token = await requireToken();
  const plan = buildHubSpotLookupPlan(parseSearchCriteria(query));
  const [companyLists, contactLists] = await Promise.all([
    settledLists<RawObject>(
      [
        batchRead(token, 'companies', plan.companyIds, HUBSPOT_LOOKUP_COMPANY_PROPERTIES),
        ...plan.companySearches.map((body) => searchObjects(token, 'companies', body)),
      ],
      'búsqueda de empresas',
    ),
    settledLists<RawObject>(
      [
        batchRead(token, 'contacts', plan.contactIds, HUBSPOT_LOOKUP_CONTACT_PROPERTIES),
        ...plan.contactSearches.map((body) => searchObjects(token, 'contacts', body)),
      ],
      'búsqueda de contactos',
    ),
  ]);
  const valid = (lists: RawObject[][]) => lists.map((list) => list.filter((r) => isHubSpotObjectId(r.id)));
  return {
    companies: mergeLookupHits(valid(companyLists)).map((r) => mapHubSpotCompany(r.id, r.properties)),
    contacts: mergeLookupHits(valid(contactLists)).map((r) => mapHubSpotContact(r.id, r.properties)),
  };
}

// ── Una empresa / un contacto ───────────────────────────────────────────────

export async function readHubSpotCompany(companyId: string): Promise<HubSpotCompanyView | null> {
  const token = await requireToken();
  const res = await hubspotGet(
    token,
    `/crm/v3/objects/companies/${encodeURIComponent(companyId)}?properties=${HUBSPOT_LOOKUP_COMPANY_PROPERTIES.join(',')}`,
  );
  if (res.status === 404) return null;
  const body = await readJson<RawObject>(res, 'empresa');
  return mapHubSpotCompany(body.id, body.properties);
}

export async function readHubSpotContact(contactId: string): Promise<HubSpotContactView | null> {
  const token = await requireToken();
  const res = await hubspotGet(
    token,
    `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=${HUBSPOT_LOOKUP_CONTACT_PROPERTIES.join(',')}`,
  );
  if (res.status === 404) return null;
  const body = await readJson<RawObject>(res, 'contacto');
  const contact = mapHubSpotContact(body.id, body.properties);
  if (contact.companyId) return contact;
  // Sin «empresa principal» en la propiedad: la primera empresa asociada.
  const assoc = await optional(
    async () => associationIds(await readJson(await hubspotGet(token, `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/companies?limit=5`), 'empresas del contacto')),
    [] as string[],
    'empresas del contacto',
  );
  return { ...contact, companyId: assoc.value[0] ?? null };
}

async function batchRead(token: string, objectType: string, ids: readonly string[], properties: readonly string[]): Promise<RawObject[]> {
  if (ids.length === 0) return [];
  const out: RawObject[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const body = await readJson<{ results?: RawObject[] }>(
      await hubspotPost(token, `/crm/v3/objects/${objectType}/batch/read`, {
        inputs: chunk.map((id) => ({ id })),
        properties: [...properties],
      }),
      `lectura de ${objectType}`,
    );
    out.push(...(body.results ?? []));
  }
  return out;
}

async function associatedIds(token: string, fromType: 'companies' | 'contacts', fromId: string, toType: string): Promise<string[]> {
  const body = await readJson(
    await hubspotGet(token, `/crm/v4/objects/${fromType}/${encodeURIComponent(fromId)}/associations/${toType}?limit=${HUBSPOT_ASSOCIATIONS_LIMIT}`),
    `${toType} asociados`,
  );
  return associationIds(body);
}

/** Contactos asociados a la empresa en HubSpot (hasta 100). */
export async function readHubSpotCompanyContacts(companyId: string): Promise<HubSpotContactView[]> {
  const token = await requireToken();
  const ids = await associatedIds(token, 'companies', companyId, 'contacts');
  const rows = await batchRead(token, 'contacts', ids, HUBSPOT_LOOKUP_CONTACT_PROPERTIES);
  return rows
    .map((r) => mapHubSpotContact(r.id, r.properties))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
}

// ── Dueños y etapas (con caché en memoria del servidor) ─────────────────────

type OwnerRecord = { id?: string; userId?: number | string | null; firstName?: string | null; lastName?: string | null; email?: string | null };

/** Directorio de dueños (activos y archivados) → nombre. Una lectura por instancia cada 30 min. */
let ownerDirectory: { names: Map<string, string>; at: number } | null = null;
let ownerDirectoryInFlight: Promise<Map<string, string> | null> | null = null;
let ownerDirectoryFailedAt = 0;
const OWNER_FAILURE_TTL_MS = 60 * 1000;

async function readOwnerPages(token: string, archived: boolean, into: Map<string, string>): Promise<void> {
  let after: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const body = await readJson<{ results?: OwnerRecord[]; paging?: { next?: { after?: string } } }>(
      await hubspotGet(token, `/crm/v3/owners?limit=500&archived=${archived}${after ? `&after=${encodeURIComponent(after)}` : ''}`),
      'dueños',
    );
    for (const owner of body.results ?? []) {
      const name = ownerDisplayName(owner);
      if (owner.id && name && !into.has(String(owner.id))) into.set(String(owner.id), name);
      // Quién creó un registro viene como usuario de HubSpot (no como dueño).
      if (owner.userId != null && name && !into.has(`user:${owner.userId}`)) into.set(`user:${owner.userId}`, name);
    }
    after = body.paging?.next?.after;
    if (!after) return;
  }
}

async function loadOwnerDirectory(): Promise<Map<string, string> | null> {
  const now = Date.now();
  if (ownerDirectory && now - ownerDirectory.at < OWNER_CACHE_TTL_MS) return ownerDirectory.names;
  if (now - ownerDirectoryFailedAt < OWNER_FAILURE_TTL_MS) return null;
  if (ownerDirectoryInFlight) return ownerDirectoryInFlight;
  ownerDirectoryInFlight = (async () => {
    try {
      const token = await getHubSpotToken();
      if (!token) return null;
      const names = new Map<string, string>();
      await readOwnerPages(token, false, names);
      await readOwnerPages(token, true, names);
      ownerDirectory = { names, at: Date.now() };
      return names;
    } catch (error) {
      ownerDirectoryFailedAt = Date.now();
      console.warn('[hubspot-lookup] directorio de dueños no disponible:', error instanceof Error ? error.message : error);
      return null;
    } finally {
      ownerDirectoryInFlight = null;
    }
  })();
  return ownerDirectoryInFlight;
}

/** Nombres de los dueños de HubSpot pedidos (los que no se encuentren, sin nombre). */
export async function resolveHubSpotOwnerNames(ownerIds: ReadonlyArray<string | null>): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const wanted = Array.from(new Set(ownerIds.filter((id): id is string => isHubSpotObjectId(id ?? undefined))));
  if (wanted.length === 0) return names;
  const directory = await loadOwnerDirectory();
  if (!directory) return names;
  for (const id of wanted) {
    const name = directory.get(id);
    if (name) names.set(id, name);
  }
  return names;
}

/** Nombre de un usuario de HubSpot (p. ej. quién creó el registro). */
export async function resolveHubSpotUserName(userId: string | null | undefined): Promise<string | null> {
  if (!userId || !isHubSpotObjectId(userId)) return null;
  const directory = await loadOwnerDirectory();
  return directory?.get(`user:${userId}`) ?? null;
}

let stageCache: { labels: Map<string, string>; at: number } | null = null;

async function dealStageLabels(token: string): Promise<Map<string, string>> {
  if (stageCache && Date.now() - stageCache.at < STAGE_CACHE_TTL_MS) return stageCache.labels;
  const body = await readJson<{ results?: Array<{ label?: string; stages?: Array<{ id: string; label?: string }> }> }>(
    await hubspotGet(token, '/crm/v3/pipelines/deals'),
    'etapas de negocios',
  );
  const labels = new Map<string, string>();
  for (const pipeline of body.results ?? []) {
    for (const stage of pipeline.stages ?? []) {
      if (stage.id && stage.label) labels.set(stage.id, stage.label);
    }
  }
  stageCache = { labels, at: Date.now() };
  return labels;
}

// ── Actividad ───────────────────────────────────────────────────────────────

export interface HubSpotActivityResult {
  items: Array<HubSpotActivityItem & { ownerName: string | null }>;
  /** Tipos que no se pudieron leer (p. ej. correos sin permiso). */
  missingKinds: HubSpotActivityKind[];
}

/** Actividad de una empresa o de un contacto en HubSpot: notas, llamadas, reuniones, tareas, correos y negocios. */
const ACTIVITY_CACHE_TTL_MS = 60 * 1000;
const ACTIVITY_CACHE_MAX = 200;
const activityCache = new Map<string, { result: HubSpotActivityResult; at: number }>();

export async function readHubSpotActivity(fromType: 'companies' | 'contacts', fromId: string): Promise<HubSpotActivityResult> {
  // Abrir y cerrar la misma ficha en un minuto no vuelve a leer ~13 veces HubSpot.
  const cacheKey = `${fromType}:${fromId}`;
  const hit = activityCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ACTIVITY_CACHE_TTL_MS) return hit.result;
  const result = await readHubSpotActivityUncached(fromType, fromId);
  if (activityCache.size >= ACTIVITY_CACHE_MAX) activityCache.delete(activityCache.keys().next().value as string);
  activityCache.set(cacheKey, { result, at: Date.now() });
  return result;
}

async function readHubSpotActivityUncached(fromType: 'companies' | 'contacts', fromId: string): Promise<HubSpotActivityResult> {
  const token = await requireToken();
  const needsStages = HUBSPOT_ACTIVITY_OBJECTS.some((o) => o.kind === 'deal');
  const stagesPromise = needsStages
    ? optional(() => dealStageLabels(token), new Map<string, string>(), 'etapas de negocios')
    : Promise.resolve({ value: new Map<string, string>(), failed: false });

  const perKind = await Promise.all(
    HUBSPOT_ACTIVITY_OBJECTS.map(async (object) => {
      const result = await optional(
        async () => {
          const ids = await associatedIds(token, fromType, fromId, object.objectType);
          return batchRead(token, object.objectType, ids, object.properties);
        },
        [] as RawObject[],
        `${object.objectType} de ${fromType}/${fromId}`,
      );
      return { object, ...result };
    }),
  );
  const stages = (await stagesPromise).value;
  const items = sortAndTrimActivity(
    perKind.flatMap(({ object, value }) => value.map((r) => mapHubSpotActivity(object.kind, r.id, r.properties, stages))),
  );
  const [owners, created] = await Promise.all([
    resolveHubSpotOwnerNames(items.map((i) => i.ownerId)),
    readCreatedItem(token, fromType, fromId),
  ]);
  const withOwners = items.map((item) => ({ ...item, ownerName: item.ownerId ? owners.get(item.ownerId) ?? null : null }));
  return {
    // «Creado en HubSpot» va en su fecha (un registro importado puede tener actividad anterior).
    items: created ? [...withOwners, created].sort((a, b) => isoTime(b.occurredAt) - isoTime(a.occurredAt)) : withOwners,
    missingKinds: perKind.filter((k) => k.failed).map((k) => k.object.kind),
  };
}

function isoTime(iso: string | null): number {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : 0;
}

/** «Creado en HubSpot» (fecha y quién), como el «Created» de la ficha de HubSpot. */
async function readCreatedItem(token: string, fromType: 'companies' | 'contacts', fromId: string) {
  const record = await optional(
    async () =>
      readJson<RawObject>(
        await hubspotGet(token, `/crm/v3/objects/${fromType}/${encodeURIComponent(fromId)}?properties=createdate,hs_created_by_user_id`),
        'fecha de creación',
      ),
    null,
    `creación de ${fromType}/${fromId}`,
  );
  if (!record.value) return null;
  const props = record.value.properties ?? {};
  const createdBy = await resolveHubSpotUserName(props.hs_created_by_user_id ?? null);
  return createdActivityItem(fromId, props.createdate, createdBy);
}

// ── Todos los datos del registro ────────────────────────────────────────────

const PROPERTY_SCHEMA_TTL_MS = 30 * 60 * 1000;
const PROPERTY_VALUES_TTL_MS = 60 * 1000;
const PROPERTY_VALUES_CACHE_MAX = 200;

type PropertySchema = { definitions: HubSpotPropertyDefinition[]; groups: HubSpotPropertyGroupDefinition[] };
const schemaCache = new Map<string, { schema: PropertySchema; at: number }>();
const propertyValuesCache = new Map<string, { sections: HubSpotPropertySection[]; at: number }>();

/** Las propiedades del portal (nombre, etiqueta, grupo, opciones). Una lectura cada 30 min. */
async function readPropertySchema(token: string, objectType: 'companies' | 'contacts'): Promise<PropertySchema> {
  const hit = schemaCache.get(objectType);
  if (hit && Date.now() - hit.at < PROPERTY_SCHEMA_TTL_MS) return hit.schema;
  const [definitions, groups] = await Promise.all([
    hubspotGet(token, `/crm/v3/properties/${objectType}`).then((res) => readJson(res, `propiedades de ${objectType}`)),
    optional(
      async () => readJson(await hubspotGet(token, `/crm/v3/properties/${objectType}/groups`), `grupos de ${objectType}`),
      null,
      `grupos de ${objectType}`,
    ),
  ]);
  const schema = { definitions: parsePropertyDefinitions(definitions), groups: parsePropertyGroups(groups.value) };
  schemaCache.set(objectType, { schema, at: Date.now() });
  return schema;
}

/**
 * Todos los datos de una empresa o un contacto de HubSpot, agrupados como en su ficha.
 * `null` si el registro no existe.
 */
export async function readHubSpotRecordProperties(
  objectType: 'companies' | 'contacts',
  objectId: string,
): Promise<HubSpotPropertySection[] | null> {
  const cacheKey = `${objectType}:${objectId}`;
  const hit = propertyValuesCache.get(cacheKey);
  if (hit && Date.now() - hit.at < PROPERTY_VALUES_TTL_MS) return hit.sections;

  const token = await requireToken();
  const schema = await readPropertySchema(token, objectType);
  const names = readablePropertyNames(schema.definitions);
  if (names.length === 0) return [];
  // Por lotes (POST batch/read): cientos de nombres no caben en la dirección de un GET.
  const rows = await batchRead(token, objectType, [objectId], names);
  const row = rows.find((r) => r.id === objectId) ?? rows[0];
  if (!row) return null;
  const values = row.properties ?? {};
  const owners = await resolveHubSpotOwnerNames(ownerIdsInValues(schema.definitions, values));
  const sections = buildPropertySections(schema.definitions, schema.groups, values, owners);

  if (propertyValuesCache.size >= PROPERTY_VALUES_CACHE_MAX) {
    propertyValuesCache.delete(propertyValuesCache.keys().next().value as string);
  }
  propertyValuesCache.set(cacheKey, { sections, at: Date.now() });
  return sections;
}
