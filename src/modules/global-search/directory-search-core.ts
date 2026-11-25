/**
 * Empresas y contactos de SellUp en la búsqueda general, por TODOS los criterios (dueña 25-11)
 * y desde cualquier pantalla — núcleo puro (sin Supabase): qué filtro se pide a la base, qué
 * filas coinciden de verdad y en qué orden salen.
 *
 * La base se consulta con un filtro amplio (los dígitos de un teléfono o un NIT «en orden»,
 * con lo que haya entre medio) y aquí se confirma con los dígitos SEGUIDOS: así «3001234567»
 * encuentra «+57 300 123 4567» y no cualquier número que tenga esos dígitos sueltos.
 */

import {
  digitsInOrderPattern,
  phoneSuffix,
  type SearchCriteria,
} from './search-criteria';

/** Cuántas filas se piden a la base antes de confirmar en memoria. */
export const DIRECTORY_DB_ROWS = 40;

export interface DirectoryAccountRow {
  id: string;
  name: string;
  legal_name: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  country: string | null;
  tax_identifier: string | null;
  hubspot_company_id: string | null;
  owner_id: string | null;
  created_by: string | null;
  archived_at: string | null;
}

export interface DirectoryContactRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  job_title: string | null;
  hubspot_contact_id: string | null;
  account: {
    id: string;
    name: string;
    owner_id: string | null;
    created_by: string | null;
    archived_at: string | null;
  } | null;
}

/** Qué tan seguro es que sea ESE registro: 0 = por ID … 3 = por nombre. */
export type MatchRank = 0 | 1 | 2 | 3;

function digits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function fold(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Todas las palabras de lo escrito están en el texto (el orden no importa). */
function containsWords(haystack: string | null | undefined, text: string): boolean {
  const words = fold(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const folded = fold(haystack);
  return words.every((word) => folded.includes(word));
}

/** El número fiscal guardado coincide (con o sin el dígito de verificación). */
export function taxMatches(stored: string | null | undefined, criteria: SearchCriteria): boolean {
  if (criteria.taxText && (stored ?? '').replace(/\s/g, '').toUpperCase() === criteria.taxText) return true;
  if (!criteria.taxDigits) return false;
  const storedDigits = digits(stored);
  if (storedDigits.length < 6) return false;
  return storedDigits.includes(criteria.taxDigits) || criteria.taxDigits.includes(storedDigits);
}

/** El teléfono guardado termina igual (sus últimos dígitos, sin el indicativo). */
export function phoneMatches(stored: string | null | undefined, criteria: SearchCriteria): boolean {
  if (!criteria.phoneDigits) return false;
  const storedDigits = digits(stored);
  return storedDigits.length > 0 && storedDigits.includes(phoneSuffix(criteria.phoneDigits));
}

function hostOf(value: string | null | undefined): string {
  return fold(value).replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
}

/** Por qué coincide una empresa; `null` si no coincide. */
export function accountMatchRank(row: DirectoryAccountRow, criteria: SearchCriteria): MatchRank | null {
  if (criteria.sellupId && row.id.toLowerCase() === criteria.sellupId) return 0;
  if (criteria.hubspotId && row.hubspot_company_id === criteria.hubspotId) return 0;
  if (taxMatches(row.tax_identifier, criteria)) return 1;
  if (criteria.domain) {
    const host = criteria.domain;
    if ([row.domain, row.website].some((v) => hostOf(v) === host || hostOf(v).endsWith(`.${host}`))) return 2;
  }
  if (containsWords(row.name, criteria.text) || containsWords(row.legal_name, criteria.text)) return 3;
  if (!criteria.email && /^[^\s]+\.[^\s]+$/.test(criteria.text) && [row.domain, row.website].some((v) => fold(v).includes(fold(criteria.text)))) {
    return 2;
  }
  return null;
}

/** Por qué coincide un contacto; `null` si no coincide. */
export function contactMatchRank(row: DirectoryContactRow, criteria: SearchCriteria): MatchRank | null {
  if (criteria.sellupId && row.id.toLowerCase() === criteria.sellupId) return 0;
  if (criteria.hubspotId && row.hubspot_contact_id === criteria.hubspotId) return 0;
  if (criteria.email && fold(row.email) === criteria.email) return 1;
  if (phoneMatches(row.phone, criteria) || phoneMatches(row.mobile_phone, criteria)) return 1;
  if (criteria.domain && fold(row.email).endsWith(`@${criteria.domain}`)) return 2;
  if (containsWords(row.full_name, criteria.text)) return 3;
  if (row.email && !/\s/.test(criteria.text) && fold(row.email).includes(fold(criteria.text))) return 3;
  return null;
}

/** Lo que puede ir tal cual en un filtro de PostgREST (sin comas, paréntesis ni comillas). */
const SAFE_DOMAIN = /^[a-z0-9.-]+$/;
const SAFE_EMAIL = /^[a-z0-9._+-]+@[a-z0-9.-]+$/;

/**
 * El filtro `or` de PostgREST para las empresas. `safeText` ya viene sin comodines ni comas
 * (`normalizeRecordsQuery`); los patrones de dígitos sólo tienen dígitos y `%`.
 */
export function accountOrFilter(criteria: SearchCriteria, safeText: string): string {
  const filters = [`name.ilike.%${safeText}%`, `legal_name.ilike.%${safeText}%`];
  if (!/\s/.test(safeText)) filters.push(`domain.ilike.%${safeText}%`, `website.ilike.%${safeText}%`);
  if (criteria.domain && SAFE_DOMAIN.test(criteria.domain)) filters.push(`domain.ilike.%${criteria.domain}%`, `website.ilike.%${criteria.domain}%`);
  if (criteria.sellupId) filters.push(`id.eq.${criteria.sellupId}`);
  if (criteria.hubspotId) filters.push(`hubspot_company_id.eq.${criteria.hubspotId}`);
  if (criteria.taxDigits) {
    // Sin el último dígito: encuentra también el número guardado sin (o con otro) dígito de verificación.
    const base = criteria.taxDigits.length >= 9 ? criteria.taxDigits.slice(0, -1) : criteria.taxDigits;
    filters.push(`tax_identifier.ilike.${digitsInOrderPattern(base)}`);
  }
  if (criteria.taxText && /^[A-Z0-9Ñ]+$/.test(criteria.taxText)) filters.push(`tax_identifier.ilike.%${criteria.taxText}%`);
  return [...new Set(filters)].join(',');
}

/** El filtro `or` de PostgREST para los contactos. */
export function contactOrFilter(criteria: SearchCriteria, safeText: string): string {
  const filters = [`full_name.ilike.%${safeText}%`, `email.ilike.%${safeText}%`];
  if (criteria.email && SAFE_EMAIL.test(criteria.email)) filters.push(`email.eq.${criteria.email}`);
  if (criteria.domain && SAFE_DOMAIN.test(criteria.domain)) filters.push(`email.ilike.%@${criteria.domain}`);
  if (criteria.sellupId) filters.push(`id.eq.${criteria.sellupId}`);
  if (criteria.hubspotId) filters.push(`hubspot_contact_id.eq.${criteria.hubspotId}`);
  if (criteria.phoneDigits) {
    const pattern = digitsInOrderPattern(phoneSuffix(criteria.phoneDigits));
    filters.push(`phone.ilike.${pattern}`, `mobile_phone.ilike.${pattern}`);
  }
  return [...new Set(filters)].join(',');
}

/** Las que coinciden, de la más segura a la menos; a igual certeza, como vinieron. */
export function rankMatches<T>(rows: readonly T[], rankOf: (row: T) => MatchRank | null, limit: number): T[] {
  return rows
    .map((row, index) => ({ row, index, rank: rankOf(row) }))
    .filter((entry): entry is { row: T; index: number; rank: MatchRank } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.row);
}

/** Lo que se dice de un registro que lleva otra persona (y no se puede abrir). */
export function otherOwnerNote(ownerName: string | null | undefined): string {
  return ownerName ? `En SellUp la lleva ${ownerName}` : 'En SellUp la lleva otra persona';
}
