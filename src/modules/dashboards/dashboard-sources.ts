// TABLEROS-1 — El vocabulario de FUENTES de los tableros, compartido por empresas y
// contactos. Sin E/S.
//
// Cada registro dice de dónde vino: un contacto, su `source` (apollo, lusha,
// hubspot, manual); una empresa candidata, su `source_primary`; una empresa de
// HubSpot enriquecida (#894), «hubspot». Los tableros filtran por fuente y la
// muestran una a una o agrupadas.

export const DASHBOARD_SOURCE_LABELS: Readonly<Record<string, string>> = {
  hubspot: 'HubSpot',
  apollo: 'Apollo',
  lusha: 'Lusha',
  manual: 'Manual',
  public_source: 'Fuente pública',
  socrata_colombia: 'Datos abiertos Colombia',
  denue_mexico: 'DENUE México',
  datos_gob_cl: 'Datos.gob Chile',
  web_ai: 'Búsqueda web con IA',
  preloaded: 'Precargada',
  external_import: 'Importación',
  other: 'Otra',
  unknown: 'Sin fuente',
};

/** El orden en que se listan: lo más usado primero. */
export const DASHBOARD_SOURCE_ORDER: readonly string[] = Object.keys(DASHBOARD_SOURCE_LABELS);

/** Fuentes de prueba: nunca cuentan en un tablero. */
const EXCLUDED_SOURCES = new Set(['mock']);

/** La serie única cuando las fuentes se ven agrupadas. */
export const GROUPED_SOURCE_KEY = 'grouped';
export const GROUPED_SOURCE_LABEL = 'Fuentes elegidas';

/**
 * La clave de fuente de un valor crudo. `null` = no cuenta (una fuente de
 * prueba). Un valor vacío es «Sin fuente»; uno desconocido, «Otra».
 */
export function normalizeDashboardSource(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? '';
  if (!value) return 'unknown';
  if (EXCLUDED_SOURCES.has(value)) return null;
  return value in DASHBOARD_SOURCE_LABELS ? value : 'other';
}

export function dashboardSourceLabel(key: string): string {
  if (key === GROUPED_SOURCE_KEY) return GROUPED_SOURCE_LABEL;
  return DASHBOARD_SOURCE_LABELS[key] ?? DASHBOARD_SOURCE_LABELS.other;
}

/** ¿La fuente pasa el filtro? Sin fuentes elegidas, pasan todas. */
export function sourcePassesFilter(source: string, selected: readonly string[]): boolean {
  return selected.length === 0 || selected.includes(source);
}

/** Ordena claves de fuente como se listan en la UI. */
export function sortSourceKeys(keys: Iterable<string>): string[] {
  const rank = (key: string) => {
    const index = DASHBOARD_SOURCE_ORDER.indexOf(key);
    return index === -1 ? DASHBOARD_SOURCE_ORDER.length : index;
  };
  return [...new Set(keys)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// ── Procedencia de un contacto ─────────────────────────────────────────────────

/** Un contacto aprobado o ya estaba en HubSpot (SellUp lo completó) o es nuevo. */
export type ContactOrigin = 'hubspot_existing' | 'new';

export const CONTACT_ORIGIN_LABELS: Record<ContactOrigin, string> = {
  hubspot_existing: 'Ya estaba en HubSpot',
  new: 'Nuevo',
};

/**
 * «Ya estaba en HubSpot»: vino de HubSpot (búsqueda «Primero HubSpot», traer por
 * id) o coincidió con un contacto de HubSpot al revisarlo. Que un contacto nuevo
 * se sincronice después a HubSpot NO lo vuelve «ya estaba».
 */
export function contactOriginOf(input: { source: string | null; matchedHubspotContactId: string | null }): ContactOrigin {
  if (input.source === 'hubspot') return 'hubspot_existing';
  if (input.matchedHubspotContactId?.trim()) return 'hubspot_existing';
  return 'new';
}
