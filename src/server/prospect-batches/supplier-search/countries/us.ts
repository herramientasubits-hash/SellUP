/**
 * Estados Unidos — «Proveedores de una empresa» por compras públicas, EN VIVO por agencia
 * (consultas en `us.server.ts`) con USAspending.gov API v2 (sin llave ni registro). Aquí,
 * lo puro: configuración, nombre de la agencia, cuerpos de las consultas y su lectura.
 *
 *  1. Proveedores de la agencia (awarding, toptier o subtier) en los NAICS de la industria
 *     pedida, sólo contratos (tipos A–D), de los últimos 12 meses, de más a menos monto
 *     (`spending_by_category/recipient`, ~1,3 s por página de 100).
 *  2. Los contratos de esos proveedores con la agencia en TODOS los NAICS
 *     (`spending_by_award`, ~1 s por página de 100): la industria de cada uno es la de lo
 *     que más le vende a ESA agencia (tabla BORRADOR `us-naics-macro-table.ts`, regla del
 *     50 %), y su contrato más grande es la prueba.
 *
 * Proveedor = recipient con UEI (12 caracteres; el EIN no se publica). Fuera los
 * gobiernos (estados, condados, ciudades, universidades y hospitales públicos: categoría
 * «government» de USAspending) y los nombres que no son una empresa («MULTIPLE RECIPIENTS»,
 * «REDACTED DUE TO PII»…). Piso US$100 mil en la ventana (recomendado en la Fase 0).
 */

import { normalizePublicEntityName } from '../public-buyer-suppliers';
import type { LiveCountrySource } from './types';

/** `source_key` de las filas que entran por aquí (y de su entrada del Catálogo de fuentes). */
export const US_USASPENDING_SOURCE_KEY = 'us_usaspending_buyer_suppliers';
/** Piso del monto obligado entidad × proveedor en la ventana (USD). */
export const US_MIN_PAIR_AMOUNT_USD = 100_000;
/** Proveedores que se clasifican (los de más monto en los NAICS de la industria). */
export const US_SUPPLIER_LIMIT = 40;
/** Contratos A–D (definitive contracts, purchase orders, delivery orders, BPA calls). */
export const US_CONTRACT_AWARD_TYPES = ['A', 'B', 'C', 'D'] as const;

export const US_API_BASE = 'https://api.usaspending.gov/api/v2';
export const US_AGENCY_SEARCH_URL = `${US_API_BASE}/autocomplete/awarding_agency_office/`;
export const US_RECIPIENTS_URL = `${US_API_BASE}/search/spending_by_category/recipient/`;
export const US_AWARDS_URL = `${US_API_BASE}/search/spending_by_award/`;

/**
 * Nombre de la agencia sin lo que la gente omite: «U.S. Department of the Army» → «ARMY»,
 * «Department of Veterans Affairs» → «VETERANS AFFAIRS». Se aplica igual a lo que
 * escribe la persona y a los nombres de USAspending.
 */
export function normalizeUsAgencyName(raw: string): string {
  return normalizePublicEntityName(raw)
    .replace(/^(?:THE )?(?:U S(?: A)?|USA|US|UNITED STATES(?: OF AMERICA)?) /, '')
    .replace(/^(?:DEPARTMENT|DEPT) OF (?:THE )?/, '')
    .trim();
}

export const US_COUNTRY: LiveCountrySource = {
  kind: 'live',
  countryCode: 'US',
  sourceKey: US_USASPENDING_SOURCE_KEY,
  // El UEI de SAM.gov no es un número fiscal: 'other' (el EIN no se publica).
  taxIdentifierType: 'other',
  normalizeBuyerName: normalizeUsAgencyName,
};

/** Una agencia candidata: «toptier|Department of Veterans Affairs». */
export type UsAgencyRef = { tier: 'toptier' | 'subtier'; name: string };

export function encodeUsAgency(agency: UsAgencyRef): string {
  return `${agency.tier}|${agency.name}`;
}

export function decodeUsAgency(taxId: string): UsAgencyRef | null {
  const [tier, ...rest] = taxId.split('|');
  const name = rest.join('|').trim();
  return (tier === 'toptier' || tier === 'subtier') && name ? { tier, name } : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Agencias de la búsqueda de USAspending (toptier = cabeza; subtier = dependencia). */
export function parseUsAgencies(payload: unknown): Array<UsAgencyRef & { abbreviation: string | null }> {
  const results = asRecord(asRecord(payload)?.results);
  const out: Array<UsAgencyRef & { abbreviation: string | null }> = [];
  for (const tier of ['toptier', 'subtier'] as const) {
    const rows = results?.[`${tier}_agency`];
    if (!Array.isArray(rows)) continue;
    for (const raw of rows) {
      const row = asRecord(raw);
      const name = asText(row?.name);
      if (name) out.push({ tier, name, abbreviation: asText(row?.abbreviation) });
    }
  }
  return out;
}

/** UEI de SAM.gov: 12 caracteres alfanuméricos en mayúsculas. */
export function usUei(raw: unknown): string | null {
  const text = asText(raw)?.toUpperCase() ?? '';
  return /^[A-Z0-9]{12}$/.test(text) ? text : null;
}

/** Nombres de USAspending que no son un proveedor identificable. */
const NOT_A_COMPANY = /^(?:MULTIPLE RECIPIENTS|REDACTED|MISCELLANEOUS|UNKNOWN|CONFIDENTIAL)/i;

type TimePeriod = { start_date: string; end_date: string };

/** Ventana de 12 meses que termina hoy. */
export function usTimePeriod(nowIso: string): TimePeriod {
  const end = nowIso.slice(0, 10);
  const monthDay = end.slice(4) === '-02-29' ? '-02-28' : end.slice(4);
  return { start_date: `${Number(end.slice(0, 4)) - 1}${monthDay}`, end_date: end };
}

function baseFilters(agency: UsAgencyRef, period: TimePeriod): Record<string, unknown> {
  return {
    agencies: [{ type: 'awarding', tier: agency.tier, name: agency.name }],
    time_period: [period],
    award_type_codes: [...US_CONTRACT_AWARD_TYPES],
  };
}

/** Consulta 1: proveedores de la agencia en los NAICS de la industria (opcional: sólo gobiernos). */
export function buildUsRecipientsBody(input: {
  agency: UsAgencyRef;
  period: TimePeriod;
  naicsPrefixes: readonly string[];
  onlyGovernment?: boolean;
}): Record<string, unknown> {
  return {
    filters: {
      ...baseFilters(input.agency, input.period),
      naics_codes: { require: [...input.naicsPrefixes] },
      ...(input.onlyGovernment ? { recipient_type_names: ['government'] } : {}),
    },
    limit: 100,
    page: 1,
  };
}

/** Consulta 2: contratos de unos proveedores con la agencia (todos los NAICS), de más a menos monto. */
export function buildUsAwardsBody(input: { agency: UsAgencyRef; period: TimePeriod; ueis: readonly string[] }): Record<string, unknown> {
  return {
    filters: { ...baseFilters(input.agency, input.period), recipient_search_text: [...input.ueis] },
    fields: ['Award ID', 'Recipient Name', 'Recipient UEI', 'Award Amount', 'NAICS', 'generated_internal_id', 'Start Date'],
    sort: 'Award Amount',
    order: 'desc',
    limit: 100,
    page: 1,
  };
}

export type UsRecipientRow = { uei: string; name: string; amount: number };

/** Proveedores de la consulta 1 (con UEI, nombre de empresa y monto ≥ piso). */
export function parseUsRecipients(payload: unknown, minAmount: number): UsRecipientRow[] {
  const rows = asRecord(payload)?.results;
  if (!Array.isArray(rows)) return [];
  const out: UsRecipientRow[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    const uei = usUei(row?.uei);
    const name = asText(row?.name);
    const amount = Number(row?.amount);
    if (!uei || !name || NOT_A_COMPANY.test(name) || !Number.isFinite(amount) || amount < minAmount) continue;
    out.push({ uei, name, amount });
  }
  return out;
}

/** UEI de los gobiernos de la consulta 1 con `onlyGovernment`. */
export function parseUsGovernmentUeis(payload: unknown): Set<string> {
  const rows = asRecord(payload)?.results;
  return new Set((Array.isArray(rows) ? rows : []).map((r) => usUei(asRecord(r)?.uei)).filter((u): u is string => u !== null));
}

export type UsAwardFacts = {
  /** NAICS (6 dígitos) → monto de los contratos con la agencia. */
  amountByNaics: Record<string, number>;
  contractCount: number;
  lastStartDate: string | null;
  topAward: { amount: number; url: string } | null;
};

/** Contratos de la consulta 2 → hechos por UEI (sólo los UEI pedidos). */
export function parseUsAwards(payload: unknown, wanted: ReadonlySet<string>): Map<string, UsAwardFacts> {
  const out = new Map<string, UsAwardFacts>();
  const rows = asRecord(payload)?.results;
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const row = asRecord(raw);
    const uei = usUei(row?.['Recipient UEI']);
    if (!row || !uei || !wanted.has(uei)) continue;
    const amount = Number(row['Award Amount']);
    const facts = out.get(uei) ?? { amountByNaics: {}, contractCount: 0, lastStartDate: null, topAward: null };
    facts.contractCount += 1;
    const naics = asText(asRecord(row.NAICS)?.code);
    if (naics && /^\d{2,6}$/.test(naics) && Number.isFinite(amount) && amount > 0) {
      facts.amountByNaics[naics] = (facts.amountByNaics[naics] ?? 0) + amount;
    }
    const start = asText(row['Start Date'])?.slice(0, 10) ?? null;
    if (start && /^\d{4}-\d{2}-\d{2}$/.test(start) && (facts.lastStartDate === null || start > facts.lastStartDate)) facts.lastStartDate = start;
    const id = asText(row.generated_internal_id);
    if (id && /^[A-Za-z0-9_.-]+$/.test(id) && Number.isFinite(amount) && (facts.topAward === null || amount > facts.topAward.amount)) {
      facts.topAward = { amount, url: `https://www.usaspending.gov/award/${encodeURIComponent(id)}` };
    }
    out.set(uei, facts);
  }
  return out;
}
