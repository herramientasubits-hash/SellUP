/**
 * Agente 1 · «Competidores de una empresa» — el MAPA de una referencia (Fase C de
 * la auditoría del 21-10; puro).
 *
 * Junta todas las búsquedas de competidores de la misma referencia (cada país es
 * un lote) en una sola vista y dice cuáles competidoras ya son clientes de UBITS en
 * HubSpot: «3 de sus 10 competidores ya trabajan con UBITS» es un argumento de
 * venta directo para la referencia.
 */

import { isCompetitorSmallCompany } from './competitor-small-companies';

export type CompetitorMapState =
  | 'ubits_customer'
  | 'in_hubspot'
  | 'approved'
  | 'in_review'
  | 'small'
  | 'not_competitor';

export const COMPETITOR_MAP_STATE_LABELS: Record<CompetitorMapState, string> = {
  ubits_customer: 'Cliente UBITS',
  in_hubspot: 'Ya en HubSpot',
  approved: 'Aprobada',
  in_review: 'Por revisar',
  small: 'Pequeña',
  not_competitor: 'Descartada',
};

/** Orden en la vista: lo que más sirve para vender primero. */
const STATE_ORDER: CompetitorMapState[] = ['ubits_customer', 'in_hubspot', 'approved', 'in_review', 'small'];

export type CompetitorMapCandidate = {
  name: string;
  domain: string | null;
  country_code: string | null;
  status: string | null;
  matched_hubspot_company_id: string | null;
  metadata: unknown;
};

export type CompetitorMapEntry = {
  key: string;
  name: string;
  domain: string | null;
  countryCodes: string[];
  state: CompetitorMapState;
};

export type CompetitorMap = {
  entries: CompetitorMapEntry[];
  countryCodes: string[];
  competitors: number;
  ubitsCustomers: number;
};

function stateOf(candidate: CompetitorMapCandidate, customerIds: ReadonlySet<string>): CompetitorMapState | null {
  const hubspotId = candidate.matched_hubspot_company_id;
  if (hubspotId && customerIds.has(hubspotId)) return 'ubits_customer';
  switch (candidate.status) {
    case 'duplicate':
      return hubspotId ? 'in_hubspot' : null;
    case 'approved':
    case 'converted':
      return 'approved';
    case 'needs_review':
      return 'in_review';
    case 'discarded':
      return isCompetitorSmallCompany(candidate.metadata) ? 'small' : 'not_competitor';
    default:
      return null;
  }
}

/**
 * Una entrada por empresa (dominio o nombre), con todos sus países. Si la misma
 * aparece en dos estados, gana el más útil (cliente > HubSpot > aprobada…). Las
 * descartadas como «no es competidor» no cuentan.
 */
export function buildCompetitorMap(
  candidates: readonly CompetitorMapCandidate[],
  customerHubSpotIds: ReadonlySet<string>,
): CompetitorMap {
  const byKey = new Map<string, CompetitorMapEntry>();
  for (const candidate of candidates) {
    const state = stateOf(candidate, customerHubSpotIds);
    if (!state || state === 'not_competitor') continue;
    const name = candidate.name?.trim();
    if (!name) continue;
    const domain = candidate.domain?.trim().toLowerCase().replace(/^www\./, '') || null;
    const key = domain ?? `name:${name.toLowerCase()}`;
    const country = candidate.country_code;
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, { key, name, domain, countryCodes: country ? [country] : [], state });
      continue;
    }
    const countryCodes = country && !previous.countryCodes.includes(country) ? [...previous.countryCodes, country] : previous.countryCodes;
    const better = STATE_ORDER.indexOf(state) < STATE_ORDER.indexOf(previous.state) ? state : previous.state;
    byKey.set(key, { ...previous, countryCodes, state: better });
  }
  const entries = [...byKey.values()].sort(
    (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name),
  );
  const countryCodes = [...new Set(entries.flatMap((e) => e.countryCodes))].sort();
  return {
    entries,
    countryCodes,
    competitors: entries.length,
    ubitsCustomers: entries.filter((e) => e.state === 'ubits_customer').length,
  };
}

/** «3 de sus 10 competidores ya trabajan con UBITS» (o nada si ninguno). */
export function describeCompetitorMapHeadline(referenceName: string, map: CompetitorMap): string | null {
  if (map.ubitsCustomers === 0) return null;
  const total = map.competitors;
  return map.ubitsCustomers === 1
    ? `1 de los ${total} competidores de ${referenceName} ya trabaja con UBITS.`
    : `${map.ubitsCustomers} de los ${total} competidores de ${referenceName} ya trabajan con UBITS.`;
}
