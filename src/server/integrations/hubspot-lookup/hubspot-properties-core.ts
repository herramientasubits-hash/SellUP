/**
 * Todos los datos de un registro de HubSpot (núcleo puro, sin red).
 *
 * Dueña 17-11 (FNL Laboratory): «tiene que mostrar todo de esta empresa, todo, y también
 * de los contactos». La ficha de HubSpot agrupa sus propiedades (Company information,
 * Calificación, Enrichment, Data Validation…). Aquí se traduce la definición de las
 * propiedades del portal + los valores del registro → secciones con etiqueta y valor
 * legible, sólo con lo que tiene dato. Nunca escribe en HubSpot.
 */

import { clean, cleanWebUrl, isHubSpotObjectId } from './hubspot-lookup-core';

/** Largo máximo de un valor de texto (una descripción larga no debe volver enorme la ficha). */
export const HUBSPOT_PROPERTY_VALUE_MAX_CHARS = 2000;

export interface HubSpotPropertyOption {
  value: string;
  label: string;
}

export interface HubSpotPropertyDefinition {
  name: string;
  label: string;
  groupName: string;
  type: string;
  fieldType: string;
  hidden: boolean;
  options: HubSpotPropertyOption[];
  /** `OWNER` cuando el valor es un id de dueño de HubSpot. */
  referencedObjectType: string | null;
  displayOrder: number;
}

export interface HubSpotPropertyGroupDefinition {
  name: string;
  label: string;
  displayOrder: number;
}

/** Cómo pintar el valor. */
export type HubSpotPropertyValueKind = 'text' | 'date' | 'datetime' | 'url' | 'email' | 'phone' | 'number';

export interface HubSpotPropertyEntry {
  name: string;
  label: string;
  value: string;
  kind: HubSpotPropertyValueKind;
}

export interface HubSpotPropertySection {
  name: string;
  label: string;
  entries: HubSpotPropertyEntry[];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** `/crm/v3/properties/{objeto}` → definiciones limpias (lo que no tenga forma se descarta). */
export function parsePropertyDefinitions(body: unknown): HubSpotPropertyDefinition[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: HubSpotPropertyDefinition[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = asString(r.name);
    if (!name || !/^[a-z0-9_]{1,100}$/i.test(name)) continue;
    const options = Array.isArray(r.options)
      ? (r.options as unknown[])
          .map((o) => {
            const option = (o ?? {}) as Record<string, unknown>;
            const value = asString(option.value);
            const label = asString(option.label);
            return value !== null ? { value, label: clean(label) ?? value } : null;
          })
          .filter((o): o is HubSpotPropertyOption => o !== null)
      : [];
    out.push({
      name,
      label: clean(asString(r.label)) ?? name,
      groupName: clean(asString(r.groupName)) ?? 'otros',
      type: clean(asString(r.type)) ?? 'string',
      fieldType: clean(asString(r.fieldType)) ?? 'text',
      hidden: r.hidden === true,
      options,
      referencedObjectType: clean(asString(r.referencedObjectType)),
      displayOrder: asNumber(r.displayOrder, 0),
    });
  }
  return out;
}

/** `/crm/v3/properties/{objeto}/groups` → grupos (para su nombre y su orden). */
export function parsePropertyGroups(body: unknown): HubSpotPropertyGroupDefinition[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((raw, index) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const name = clean(asString(r.name));
      if (!name) return null;
      return { name, label: clean(asString(r.label)) ?? name, displayOrder: asNumber(r.displayOrder, index) };
    })
    .filter((g): g is HubSpotPropertyGroupDefinition => g !== null);
}

/** Las propiedades que se piden al leer el registro: todas las visibles del portal. */
export function readablePropertyNames(definitions: readonly HubSpotPropertyDefinition[]): string[] {
  return definitions.filter((d) => !d.hidden).map((d) => d.name);
}

/** Valor de un dueño de HubSpot: id → nombre (si no se conoce, el id tal cual). */
export function isOwnerProperty(definition: HubSpotPropertyDefinition): boolean {
  return (
    definition.referencedObjectType?.toUpperCase() === 'OWNER' ||
    (definition.name.endsWith('owner_id') && definition.type === 'enumeration' && definition.options.length === 0)
  );
}

/** Los ids de dueño que aparecen en el registro (para buscarles el nombre). */
export function ownerIdsInValues(
  definitions: readonly HubSpotPropertyDefinition[],
  values: Record<string, string | null | undefined>,
): string[] {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (!isOwnerProperty(definition)) continue;
    const raw = clean(values[definition.name]);
    if (raw && isHubSpotObjectId(raw)) ids.add(raw);
  }
  return [...ids];
}

function truncate(value: string): string {
  return value.length > HUBSPOT_PROPERTY_VALUE_MAX_CHARS
    ? `${value.slice(0, HUBSPOT_PROPERTY_VALUE_MAX_CHARS - 1).trimEnd()}…`
    : value;
}

/** Fecha de HubSpot (ISO, `YYYY-MM-DD` o milisegundos en texto) → ISO. */
function toIsoDate(raw: string): string | null {
  const asNumber = /^\d{10,}$/.test(raw) ? Number(raw) : Number.NaN;
  const t = Number.isFinite(asNumber) ? asNumber : Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const BOOLEAN_LABELS: Readonly<Record<string, string>> = { true: 'Sí', false: 'No' };

/** Un valor del registro → lo que se pinta (o null si no hay nada que mostrar). */
export function formatPropertyValue(
  definition: HubSpotPropertyDefinition,
  rawValue: string | null | undefined,
  ownerNames: ReadonlyMap<string, string> = new Map(),
): { value: string; kind: HubSpotPropertyValueKind } | null {
  const raw = clean(rawValue);
  if (!raw) return null;

  if (isOwnerProperty(definition)) {
    return { value: ownerNames.get(raw) ?? raw, kind: 'text' };
  }
  if (definition.type === 'bool' || definition.fieldType === 'booleancheckbox') {
    const label = BOOLEAN_LABELS[raw.toLowerCase()];
    if (label) return { value: label, kind: 'text' };
  }
  if (definition.type === 'enumeration' && definition.options.length > 0) {
    const labels = raw
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => definition.options.find((o) => o.value === part)?.label ?? part);
    return labels.length > 0 ? { value: truncate(labels.join(', ')), kind: 'text' } : null;
  }
  if (definition.type === 'date' || definition.type === 'datetime') {
    const iso = toIsoDate(raw);
    return iso ? { value: iso, kind: definition.type === 'date' ? 'date' : 'datetime' } : { value: raw, kind: 'text' };
  }
  if (definition.type === 'number') {
    return { value: raw, kind: 'number' };
  }
  if (definition.fieldType === 'phonenumber') {
    return { value: raw, kind: 'phone' };
  }
  if (/email/i.test(definition.name) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { value: raw.toLowerCase(), kind: 'email' };
  }
  if (/(^|_)(url|website|domain|linkedin|facebook|twitter|page)(_|$)/i.test(definition.name) || /^https?:\/\//i.test(raw)) {
    const url = /\s/.test(raw) ? null : cleanWebUrl(raw);
    if (url && /\./.test(url)) return { value: url, kind: 'url' };
  }
  return { value: truncate(raw), kind: 'text' };
}

/**
 * Definiciones + valores → secciones como en HubSpot (en el orden del portal), sólo con lo
 * que tiene dato. Un grupo que no viene en la lista de grupos se muestra con su nombre.
 */
export function buildPropertySections(
  definitions: readonly HubSpotPropertyDefinition[],
  groups: readonly HubSpotPropertyGroupDefinition[],
  values: Record<string, string | null | undefined>,
  ownerNames: ReadonlyMap<string, string> = new Map(),
): HubSpotPropertySection[] {
  const groupInfo = new Map(groups.map((g) => [g.name, g]));
  const byGroup = new Map<string, Array<HubSpotPropertyEntry & { order: number }>>();
  for (const definition of definitions) {
    if (definition.hidden) continue;
    const formatted = formatPropertyValue(definition, values[definition.name], ownerNames);
    if (!formatted) continue;
    const list = byGroup.get(definition.groupName) ?? [];
    list.push({ name: definition.name, label: definition.label, ...formatted, order: definition.displayOrder });
    byGroup.set(definition.groupName, list);
  }
  const groupOrder = (name: string) => groupInfo.get(name)?.displayOrder ?? Number.MAX_SAFE_INTEGER;
  const groupLabel = (name: string) => groupInfo.get(name)?.label ?? name;
  return [...byGroup.entries()]
    .sort(([a], [b]) => groupOrder(a) - groupOrder(b) || groupLabel(a).localeCompare(groupLabel(b), 'es'))
    .map(([name, entries]) => ({
      name,
      label: groupLabel(name),
      entries: [...entries]
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'es'))
        .map((entry) => ({ name: entry.name, label: entry.label, value: entry.value, kind: entry.kind })),
    }));
}

/** Filtra las secciones por lo escrito (etiqueta o valor), sin distinguir tildes ni mayúsculas. */
export function filterPropertySections(sections: readonly HubSpotPropertySection[], query: string): HubSpotPropertySection[] {
  const needle = fold(query.trim());
  if (!needle) return [...sections];
  return sections
    .map((section) => {
      if (fold(section.label).includes(needle)) return section;
      return { ...section, entries: section.entries.filter((e) => fold(e.label).includes(needle) || fold(e.value).includes(needle)) };
    })
    .filter((section) => section.entries.length > 0);
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
