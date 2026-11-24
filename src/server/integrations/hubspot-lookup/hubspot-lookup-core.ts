/**
 * Consulta de HubSpot desde SellUp (núcleo puro, sin red ni Supabase).
 *
 * Dueña 17-11: «que todos puedan consultar lo que sea desde SellUp en HubSpot»: buscar
 * una empresa o un contacto que no está en SellUp, verlo en la misma ficha de siempre
 * (datos, contactos y actividad) y, si se quiere trabajar, traerlo a SellUp.
 *
 * Este módulo sólo traduce: lo que responde HubSpot entra como datos y sale como lo
 * que pinta SellUp. Nunca escribe en HubSpot.
 */

import {
  HUBSPOT_CHURN_PROPERTIES,
  HUBSPOT_CLIENT_LIFECYCLE_VALUE,
  readHubSpotChurn,
} from '@/server/integrations/hubspot-free-company-policy';

/** Un Company ID / Contact ID de HubSpot: sólo dígitos. */
export function isHubSpotObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,20}$/.test(value);
}

/** Lo mínimo que se escribe para buscar en HubSpot (evita consultas por una letra). */
export const HUBSPOT_LOOKUP_MIN_QUERY = 3;
/** Cuántas empresas y cuántos contactos se traen por búsqueda. */
export const HUBSPOT_LOOKUP_SEARCH_LIMIT = 6;
/** Actividad que se muestra (la más reciente primero). */
export const HUBSPOT_ACTIVITY_MAX_ITEMS = 60;
/** Cuántos registros asociados se leen por tipo (una página de HubSpot). */
export const HUBSPOT_ASSOCIATIONS_LIMIT = 100;
/**
 * Largo máximo del texto de una actividad. Una nota con el mensaje que se mandó se lee
 * entera (dueña 17-11: se cortaba en «Quedo atento a tus comentarios y r…»); la ficha la
 * muestra plegada con «Ver más».
 */
export const HUBSPOT_ACTIVITY_BODY_MAX_CHARS = 4000;

type Props = Record<string, string | null | undefined>;

export function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Sólo enlaces web (http/https): un valor de HubSpot no puede volverse otro esquema. */
export function cleanWebUrl(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  return /^https?:\/\//i.test(withScheme) ? withScheme : null;
}

function cleanDomain(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const host = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  return host.length > 0 ? host : null;
}

/** Normaliza lo escrito: espacios colapsados, largo acotado. `null` si no alcanza. */
export function normalizeLookupQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const query = raw.replace(/\s+/g, ' ').trim().slice(0, 120);
  return query.length >= HUBSPOT_LOOKUP_MIN_QUERY ? query : null;
}

// ── Empresas ────────────────────────────────────────────────────────────────

export const HUBSPOT_LOOKUP_COMPANY_PROPERTIES = [
  'name',
  'domain',
  'website',
  'pais',
  'country',
  'city',
  'state',
  'industriaespecifica',
  'industry',
  'numberofemployees',
  'identificaci_n_fiscal',
  'rfc_mx_',
  'hubspot_owner_id',
  'lifecyclestage',
  'phone',
  'linkedin_company_page',
  'description',
  'createdate',
  'notes_last_updated',
  'num_associated_contacts',
  ...HUBSPOT_CHURN_PROPERTIES,
] as const;

const LIFECYCLE_LABELS: Readonly<Record<string, string>> = {
  subscriber: 'Suscriptor',
  lead: 'Lead',
  marketingqualifiedlead: 'Lead calificado por marketing',
  salesqualifiedlead: 'Lead calificado por ventas',
  opportunity: 'Oportunidad',
  // Portal de UBITS: «Cliente» es `1443029400`; `customer` es «Forecast».
  [HUBSPOT_CLIENT_LIFECYCLE_VALUE]: 'Cliente',
  customer: 'Forecast',
  evangelist: 'Promotor',
  other: 'Otro',
};

/** Etapa del ciclo de vida en palabras de SellUp (o tal cual si es propia del portal). */
export function lifecycleLabel(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  return LIFECYCLE_LABELS[raw.toLowerCase()] ?? raw;
}

/**
 * FEEDBACK 24-11 — un ex cliente sigue en la etapa «Cliente» en HubSpot: se dice que
 * fue cliente y cuándo se fue, para no leerlo como cliente actual.
 */
function companyLifecycleLabel(p: Props): string | null {
  const churn = readHubSpotChurn(p);
  if (churn) return churn.churnedAt ? `Ex cliente (churn ${churn.churnedAt})` : 'Ex cliente (churn)';
  return lifecycleLabel(p.lifecyclestage);
}

export interface HubSpotCompanyView {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  employees: string | null;
  taxId: string | null;
  ownerId: string | null;
  lifecycle: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  description: string | null;
  createdAt: string | null;
  lastActivityAt: string | null;
  contactsCount: number | null;
}

function toInt(value: string | null | undefined): number | null {
  const raw = clean(value);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function cleanEmployees(value: string | null | undefined): string | null {
  const n = toInt(value);
  return n !== null && n > 0 ? String(n) : null;
}

export function mapHubSpotCompany(id: string, properties: Props | undefined): HubSpotCompanyView {
  const p = properties ?? {};
  const domain = cleanDomain(p.domain) ?? cleanDomain(p.website);
  const website = cleanWebUrl(p.website) ?? (domain ? `https://${domain}` : null);
  return {
    id,
    name: clean(p.name) ?? domain ?? `Empresa ${id}`,
    domain,
    website,
    country: clean(p.pais) ?? clean(p.country),
    city: clean(p.city),
    region: clean(p.state),
    industry: clean(p.industriaespecifica) ?? clean(p.industry),
    employees: cleanEmployees(p.numberofemployees),
    taxId: clean(p.identificaci_n_fiscal) ?? clean(p.rfc_mx_),
    ownerId: clean(p.hubspot_owner_id),
    lifecycle: companyLifecycleLabel(p),
    phone: clean(p.phone),
    linkedinUrl: cleanWebUrl(p.linkedin_company_page),
    description: clean(p.description),
    createdAt: clean(p.createdate),
    lastActivityAt: clean(p.notes_last_updated),
    contactsCount: toInt(p.num_associated_contacts),
  };
}

// ── Contactos ───────────────────────────────────────────────────────────────

export const HUBSPOT_LOOKUP_CONTACT_PROPERTIES = [
  'firstname',
  'lastname',
  'email',
  'phone',
  'mobilephone',
  'jobtitle',
  'company',
  'hs_linkedin_url',
  'hubspot_owner_id',
  'lifecyclestage',
  'associatedcompanyid',
  'city',
  'country',
  'createdate',
  'notes_last_updated',
] as const;

export interface HubSpotContactView {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  mobilePhone: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companyId: string | null;
  linkedinUrl: string | null;
  ownerId: string | null;
  lifecycle: string | null;
  city: string | null;
  country: string | null;
  createdAt: string | null;
  lastActivityAt: string | null;
}

export function mapHubSpotContact(id: string, properties: Props | undefined): HubSpotContactView {
  const p = properties ?? {};
  const firstName = clean(p.firstname);
  const lastName = clean(p.lastname);
  const email = clean(p.email)?.toLowerCase() ?? null;
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || email || `Contacto ${id}`;
  const companyId = clean(p.associatedcompanyid);
  return {
    id,
    fullName,
    firstName,
    lastName,
    email,
    phone: clean(p.phone),
    mobilePhone: clean(p.mobilephone),
    jobTitle: clean(p.jobtitle),
    companyName: clean(p.company),
    companyId: isHubSpotObjectId(companyId) ? companyId : null,
    linkedinUrl: cleanWebUrl(p.hs_linkedin_url),
    ownerId: clean(p.hubspot_owner_id),
    lifecycle: lifecycleLabel(p.lifecyclestage),
    city: clean(p.city),
    country: clean(p.country),
    createdAt: clean(p.createdate),
    lastActivityAt: clean(p.notes_last_updated),
  };
}

/** Cuerpo de la búsqueda por texto libre (nombre, dominio, correo…) de HubSpot. */
export function buildLookupSearchBody(query: string, properties: readonly string[]) {
  return {
    query,
    limit: HUBSPOT_LOOKUP_SEARCH_LIMIT,
    properties: [...properties],
    sorts: [{ propertyName: 'notes_last_updated', direction: 'DESCENDING' }],
  };
}

// ── Actividad ───────────────────────────────────────────────────────────────

export type HubSpotActivityKind = 'note' | 'call' | 'meeting' | 'task' | 'email' | 'deal' | 'created';

/** Objetos de HubSpot que se leen como actividad, y sus propiedades. */
export const HUBSPOT_ACTIVITY_OBJECTS: ReadonlyArray<{
  kind: HubSpotActivityKind;
  objectType: string;
  properties: readonly string[];
}> = [
  { kind: 'note', objectType: 'notes', properties: ['hs_timestamp', 'hs_note_body', 'hubspot_owner_id'] },
  {
    kind: 'call',
    objectType: 'calls',
    properties: ['hs_timestamp', 'hs_call_title', 'hs_call_body', 'hs_call_direction', 'hs_call_duration', 'hs_call_status', 'hubspot_owner_id'],
  },
  {
    kind: 'meeting',
    objectType: 'meetings',
    properties: ['hs_timestamp', 'hs_meeting_title', 'hs_meeting_body', 'hs_meeting_start_time', 'hs_meeting_outcome', 'hubspot_owner_id'],
  },
  {
    kind: 'task',
    objectType: 'tasks',
    properties: ['hs_timestamp', 'hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_task_priority', 'hubspot_owner_id'],
  },
  {
    kind: 'email',
    objectType: 'emails',
    properties: ['hs_timestamp', 'hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hubspot_owner_id'],
  },
  {
    kind: 'deal',
    objectType: 'deals',
    properties: ['dealname', 'dealstage', 'pipeline', 'amount', 'deal_currency_code', 'closedate', 'createdate', 'hubspot_owner_id'],
  },
];

export interface HubSpotActivityItem {
  id: string;
  kind: HubSpotActivityKind;
  title: string;
  /** Texto plano (sin HTML), recortado. */
  body: string | null;
  /** Detalles cortos: «Saliente · 5 min», «Completada», «Etapa: Propuesta»… */
  details: string[];
  occurredAt: string | null;
  ownerId: string | null;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/**
 * HTML de HubSpot → texto plano. Se pinta como texto (nunca como HTML), así que esto
 * es para que se lea bien, no una defensa: React ya escapa lo que quede.
 */
export function htmlToPlainText(value: string | null | undefined, maxChars = HUBSPOT_ACTIVITY_BODY_MAX_CHARS): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const text = raw
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

const CALL_DIRECTION: Readonly<Record<string, string>> = { INBOUND: 'Entrante', OUTBOUND: 'Saliente' };
const EMAIL_DIRECTION: Readonly<Record<string, string>> = {
  EMAIL: 'Enviado',
  INCOMING_EMAIL: 'Recibido',
  FORWARDED_EMAIL: 'Reenviado',
};
const TASK_STATUS: Readonly<Record<string, string>> = {
  NOT_STARTED: 'Sin empezar',
  IN_PROGRESS: 'En curso',
  WAITING: 'En espera',
  COMPLETED: 'Completada',
  DEFERRED: 'Aplazada',
};
const MEETING_OUTCOME: Readonly<Record<string, string>> = {
  SCHEDULED: 'Agendada',
  COMPLETED: 'Realizada',
  RESCHEDULED: 'Reagendada',
  NO_SHOW: 'No asistió',
  CANCELED: 'Cancelada',
};

function durationLabel(ms: string | null | undefined): string | null {
  const n = toInt(ms);
  if (n === null || n <= 0) return null;
  const minutes = Math.round(n / 60000);
  return minutes < 1 ? 'Menos de 1 min' : `${minutes} min`;
}

function amountLabel(amount: string | null | undefined, currency: string | null | undefined): string | null {
  const raw = clean(amount);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const formatted = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
  const code = clean(currency);
  return code ? `${formatted} ${code.toUpperCase()}` : formatted;
}

function compact(values: ReadonlyArray<string | null | undefined>): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** Etiquetas de etapa de negocio: id de etapa → nombre (de las pipelines del portal). */
export type DealStageLabels = ReadonlyMap<string, string>;

export function mapHubSpotActivity(
  kind: HubSpotActivityKind,
  id: string,
  properties: Props | undefined,
  dealStages: DealStageLabels = new Map(),
): HubSpotActivityItem {
  const p = properties ?? {};
  const ownerId = clean(p.hubspot_owner_id);
  switch (kind) {
    case 'note':
      return { id, kind, title: 'Nota', body: htmlToPlainText(p.hs_note_body), details: [], occurredAt: clean(p.hs_timestamp), ownerId };
    case 'call':
      return {
        id,
        kind,
        title: clean(p.hs_call_title) ?? 'Llamada',
        body: htmlToPlainText(p.hs_call_body),
        details: compact([CALL_DIRECTION[clean(p.hs_call_direction)?.toUpperCase() ?? ''], durationLabel(p.hs_call_duration)]),
        occurredAt: clean(p.hs_timestamp),
        ownerId,
      };
    case 'meeting':
      return {
        id,
        kind,
        title: clean(p.hs_meeting_title) ?? 'Reunión',
        body: htmlToPlainText(p.hs_meeting_body),
        details: compact([MEETING_OUTCOME[clean(p.hs_meeting_outcome)?.toUpperCase() ?? '']]),
        occurredAt: clean(p.hs_meeting_start_time) ?? clean(p.hs_timestamp),
        ownerId,
      };
    case 'task':
      return {
        id,
        kind,
        title: clean(p.hs_task_subject) ?? 'Tarea',
        body: htmlToPlainText(p.hs_task_body),
        details: compact([TASK_STATUS[clean(p.hs_task_status)?.toUpperCase() ?? '']]),
        occurredAt: clean(p.hs_timestamp),
        ownerId,
      };
    case 'email':
      return {
        id,
        kind,
        title: clean(p.hs_email_subject) ?? 'Correo',
        body: htmlToPlainText(p.hs_email_text),
        details: compact([EMAIL_DIRECTION[clean(p.hs_email_direction)?.toUpperCase() ?? '']]),
        occurredAt: clean(p.hs_timestamp),
        ownerId,
      };
    case 'created':
      return { id, kind, title: 'Creado en HubSpot', body: null, details: [], occurredAt: clean(p.createdate), ownerId: null };
    case 'deal': {
      const stageId = clean(p.dealstage);
      const stage = stageId ? dealStages.get(stageId) ?? stageId : null;
      return {
        id,
        kind,
        title: clean(p.dealname) ?? 'Negocio',
        body: null,
        details: compact([stage ? `Etapa: ${stage}` : null, amountLabel(p.amount, p.deal_currency_code)]),
        occurredAt: clean(p.createdate) ?? clean(p.closedate),
        ownerId,
      };
    }
  }
}

function timeOf(item: HubSpotActivityItem): number {
  if (!item.occurredAt) return 0;
  // HubSpot devuelve ISO o milisegundos en texto, según la propiedad.
  const asNumber = Number(item.occurredAt);
  const t = Number.isFinite(asNumber) && /^\d+$/.test(item.occurredAt) ? asNumber : Date.parse(item.occurredAt);
  return Number.isFinite(t) ? t : 0;
}

/** Fecha ISO normalizada (o null) para pintar. */
export function activityIsoDate(item: HubSpotActivityItem): string | null {
  const t = timeOf(item);
  return t > 0 ? new Date(t).toISOString() : null;
}

/** La más reciente primero, sin repetidas, recortada. */
export function sortAndTrimActivity(items: readonly HubSpotActivityItem[], max = HUBSPOT_ACTIVITY_MAX_ITEMS): HubSpotActivityItem[] {
  const seen = new Set<string>();
  const unique: HubSpotActivityItem[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...item, occurredAt: activityIsoDate(item) });
  }
  return unique.sort((a, b) => timeOf(b) - timeOf(a)).slice(0, max);
}

/**
 * «Creado en HubSpot» como una línea más de la actividad (como el «Created» de la ficha de
 * HubSpot). `createdByName`: quién lo creó, si se sabe.
 */
export function createdActivityItem(
  objectId: string,
  createdate: string | null | undefined,
  createdByName: string | null,
): (HubSpotActivityItem & { ownerName: string | null }) | null {
  const item = mapHubSpotActivity('created', `created-${objectId}`, { createdate });
  const iso = activityIsoDate(item);
  return iso ? { ...item, occurredAt: iso, ownerName: createdByName } : null;
}

/** Ids de una respuesta de asociaciones (v4: `toObjectId`; v3: `id`). */
export function associationIds(body: unknown): string[] {
  const results = (body as { results?: Array<{ toObjectId?: unknown; id?: unknown }> } | null)?.results;
  if (!Array.isArray(results)) return [];
  const ids = results
    .map((r) => (r.toObjectId !== undefined ? String(r.toObjectId) : r.id !== undefined ? String(r.id) : ''))
    .filter(isHubSpotObjectId);
  return Array.from(new Set(ids));
}

/** Nombre de un dueño de HubSpot para pintar. */
export function ownerDisplayName(owner: { firstName?: string | null; lastName?: string | null; email?: string | null } | null): string | null {
  if (!owner) return null;
  const name = [clean(owner.firstName), clean(owner.lastName)].filter(Boolean).join(' ');
  return name || clean(owner.email);
}

// ── Vínculo con SellUp ──────────────────────────────────────────────────────

/**
 * Dónde está el registro de HubSpot en SellUp, desde quien mira:
 *  - `visible`: está y lo puede abrir (se abre la ficha de SellUp);
 *  - `other_owner`: está, pero lo lleva alguien fuera de su alcance (sólo consulta);
 *  - `none`: no está (sólo consulta, y se puede traer).
 */
export type SellUpPresence =
  | { status: 'visible'; id: string }
  | { status: 'other_owner'; ownerName: string | null }
  | { status: 'none' };

export interface SellUpRecordRow {
  id: string;
  owner_id: string | null;
  created_by: string | null;
  owner_name: string | null;
}

/** Decide la presencia en SellUp a partir de las filas que comparten el id de HubSpot. */
export function decideSellUpPresence(
  rows: readonly SellUpRecordRow[],
  isVisible: (row: SellUpRecordRow) => boolean,
): SellUpPresence {
  if (rows.length === 0) return { status: 'none' };
  const visible = rows.find(isVisible);
  if (visible) return { status: 'visible', id: visible.id };
  return { status: 'other_owner', ownerName: rows[0].owner_name };
}
