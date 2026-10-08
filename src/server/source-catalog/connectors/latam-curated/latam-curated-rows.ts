/**
 * latam-curated-rows.ts — filas de `latam_curated_directory`: la capa común de
 * listas curadas gratuitas (universidades, reguladores, bolsas, exportadores,
 * multinacionales y rankings) que se suma a la capa gratuita de cada país.
 *
 * SOURCES-LATAM-CURATED-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Cada lista llega como entradas sueltas (`LatamCuratedEntry`, una por línea de
 * los extractores). Aquí se unen por país + número fiscal o, si la lista no lo
 * publica, por país + nombre normalizado: la misma universidad que está en SNIES y
 * en Merco es UNA fila con las dos listas como origen. El número fiscal que falte
 * lo pone en la corrida el registro oficial del país por nombre (coincidencia
 * fuerte), igual que con DENUE.
 *
 * Identidad: país + nombre normalizado (NATIVE_RECORD_GRAIN), estable aunque el
 * número fiscal aparezca después.
 *
 * Quedan FUERA: entradas sin país o sin nombre, y lo que no tiene macro (ni por
 * tipo de lista ni por sector): la capa nunca ofrece una muestra genérica.
 */

import { buildRecordIdentityKey, type RecordIdentityKey } from '../../record-identity';
import {
  LATAM_CURATED_KINDS,
  LATAM_CURATED_MACRO_TABLE_VERSION,
  resolveLatamCuratedMacro,
  type LatamCuratedKind,
} from '@/server/prospect-batches/country-source-discovery/latam-curated-macro-table';
import { isNonCorporateDomain, normalizeWebsiteHost } from '../co-public-entities/co-domain';

export const LATAM_CURATED_SOURCE_KEY = 'latam_curated_directory' as const;
export const LATAM_CURATED_IDENTITY_NAMESPACE = 'latam-curated' as const;

/** Una entidad tal como la publica UNA lista (salida de los extractores). */
export type LatamCuratedEntry = {
  country: string;
  /** Clave estable de la lista («co_snies», «merco_empresas_co_2025»…). */
  list: string;
  /** Nombre corto para la ficha («SNIES – MinEducación»). */
  list_label: string;
  year?: number | null;
  name: string;
  tax_id?: string | null;
  tax_type?: string | null;
  website?: string | null;
  kind: LatamCuratedKind;
  is_public?: boolean | null;
  sector?: string | null;
  /** La lista implica empresa grande (p. ej. Merco, GPTW 1.000+, Pacto Global «Company»). */
  size_large?: boolean | null;
  /** Trabajadores que publica la lista, si los da. */
  workers?: number | null;
  city?: string | null;
  region?: string | null;
};

export type LatamCuratedRow = {
  source_key: typeof LATAM_CURATED_SOURCE_KEY;
  country_code: string;
  source_year: number;
  tax_id: string | null;
  normalized_tax_id: string | null;
  legal_name: string;
  normalized_legal_name: string;
  city: string | null;
  region: string | null;
  priority_score: number;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

export type LatamCuratedExclusion = 'invalid_entry' | 'no_macro';

/** Formas societarias al final del nombre que no distinguen a la entidad. */
const LEGAL_FORM_TAIL =
  /\s+(S\s?A\s?S|S\s?A\s?C|S\s?A\s?A|S\s?A\s?E\s?C\s?A|S\s?A\s?E|S\s?A\s?B\s?DE\s?C\s?V|S\s?A\s?DE\s?C\s?V|S\s?DE\s?R\s?L\s?DE\s?C\s?V|S\s?DE\s?R\s?L|S\s?R\s?L|S\s?P\s?A|S\s?A|LTDA|LIMITADA|E\s?I\s?R\s?L|INC|CORP|LLC|CIA|SOCIEDAD ANONIMA(\s+ABIERTA|\s+CERRADA)?|SOCIEDAD DE RESPONSABILIDAD LIMITADA)\s*$/;

/** Nombre comparable: mayúsculas sin tildes, sin signos y sin la forma societaria final. */
export function normalizeLatamCuratedName(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';
  let text = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' Y ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(LEGAL_FORM_TAIL, '').trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

/** Sólo dígitos y la letra de control final (RUT chileno), o `null`. */
export function normalizeLatamCuratedTaxId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.toUpperCase().replace(/[^0-9K]/g, '');
  return /^\d{6,14}K?$/.test(compact) ? compact : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

/** Dominio propio de la web, o `null` (redes sociales y correos gratuitos fuera). */
export function latamCuratedDomain(url: string | null | undefined): string | null {
  const host = normalizeWebsiteHost(url ?? null);
  if (host === null || !host.includes('.') || isNonCorporateDomain(host)) return null;
  if (/(^|\.)(facebook|instagram|twitter|x|google|youtube|linkedin|wix|wordpress|blogspot)\.com$/.test(host)) return null;
  return host.replace(/^www\./, '');
}

type Merged = {
  country: string;
  name: string;
  normalizedName: string;
  taxId: string | null;
  normalizedTaxId: string | null;
  taxType: string | null;
  domain: string | null;
  kind: LatamCuratedKind;
  isPublic: boolean | null;
  sector: string | null;
  sizeLargeLabel: string | null;
  workers: number | null;
  city: string | null;
  region: string | null;
  origins: { list: string; label: string; year: number | null }[];
};

/** Las listas con tipo de regulador mandan sobre los rankings al decidir la macro. */
const KIND_RANK: Record<LatamCuratedKind, number> = {
  university: 0, school: 0, insurer: 0, bank: 0, financial: 0, health_provider: 0,
  listed_company: 1, exporter: 1, multinational: 1, ranking: 2,
};

/** Une las entradas por país + número fiscal o país + nombre. */
export function mergeLatamCuratedEntries(entries: readonly LatamCuratedEntry[]): Merged[] {
  const byKey = new Map<string, Merged>();
  const keyByTax = new Map<string, string>();
  for (const entry of entries) {
    const country = cleanText(entry.country)?.toUpperCase() ?? null;
    const name = cleanText(entry.name);
    const normalizedName = normalizeLatamCuratedName(name);
    if (country === null || !/^[A-Z]{2}$/.test(country) || name === null || normalizedName.length < 2) continue;
    if (!LATAM_CURATED_KINDS.has(entry.kind)) continue;
    const normalizedTaxId = normalizeLatamCuratedTaxId(entry.tax_id);
    const nameKey = `${country}:${normalizedName}`;
    const key = (normalizedTaxId !== null ? keyByTax.get(`${country}:${normalizedTaxId}`) : undefined) ?? nameKey;
    const origin = { list: entry.list, label: entry.list_label, year: entry.year ?? null };
    const current = byKey.get(key);
    if (current === undefined) {
      byKey.set(key, {
        country,
        name,
        normalizedName,
        taxId: normalizedTaxId !== null ? cleanText(entry.tax_id) : null,
        normalizedTaxId,
        taxType: cleanText(entry.tax_type),
        domain: latamCuratedDomain(entry.website),
        kind: entry.kind,
        isPublic: entry.is_public ?? null,
        sector: cleanText(entry.sector),
        sizeLargeLabel: entry.size_large === true ? entry.list_label : null,
        workers: typeof entry.workers === 'number' && entry.workers > 0 ? Math.trunc(entry.workers) : null,
        city: cleanText(entry.city),
        region: cleanText(entry.region),
        origins: [origin],
      });
      if (normalizedTaxId !== null) keyByTax.set(`${country}:${normalizedTaxId}`, key);
      continue;
    }
    if (!current.origins.some((o) => o.list === origin.list)) current.origins.push(origin);
    if (current.normalizedTaxId === null && normalizedTaxId !== null) {
      current.taxId = cleanText(entry.tax_id);
      current.normalizedTaxId = normalizedTaxId;
      current.taxType = cleanText(entry.tax_type);
      keyByTax.set(`${country}:${normalizedTaxId}`, key);
    }
    current.domain ??= latamCuratedDomain(entry.website);
    if (KIND_RANK[entry.kind] < KIND_RANK[current.kind]) {
      current.kind = entry.kind;
      current.isPublic = entry.is_public ?? current.isPublic;
    }
    current.sector ??= cleanText(entry.sector);
    if (current.sizeLargeLabel === null && entry.size_large === true) current.sizeLargeLabel = entry.list_label;
    if (typeof entry.workers === 'number' && entry.workers > (current.workers ?? 0)) current.workers = Math.trunc(entry.workers);
    current.city ??= cleanText(entry.city);
    current.region ??= cleanText(entry.region);
  }
  return [...byKey.values()];
}

/**
 * Relevancia dentro de una macro: grande por lista primero, luego trabajadores
 * publicados, luego cuántas listas la nombran, luego si trae web.
 */
export function latamCuratedPriorityScore(merged: Pick<Merged, 'sizeLargeLabel' | 'workers' | 'origins' | 'domain'>): number {
  return (
    (merged.sizeLargeLabel !== null ? 500_000 : 0) +
    Math.min(merged.workers ?? 0, 99_999) +
    Math.min(merged.origins.length, 9) * 100_000 +
    (merged.domain !== null ? 1 : 0)
  );
}

/** Fila de una entidad ya unida, o por qué no entra. */
export function buildLatamCuratedRow(
  merged: Merged,
  params: { sourceYear: number; importedAt: string },
): { row: LatamCuratedRow } | { excluded: LatamCuratedExclusion } {
  const macro = resolveLatamCuratedMacro({ kind: merged.kind, isPublic: merged.isPublic, sector: merged.sector });
  if (macro === null) return { excluded: 'no_macro' };
  const identity = buildRecordIdentityKey(LATAM_CURATED_IDENTITY_NAMESPACE, `${merged.country}:${merged.normalizedName}`);
  if (identity.status !== 'resolved') return { excluded: 'invalid_entry' };
  return {
    row: {
      source_key: LATAM_CURATED_SOURCE_KEY,
      country_code: merged.country,
      source_year: params.sourceYear,
      tax_id: merged.taxId,
      normalized_tax_id: merged.normalizedTaxId,
      legal_name: merged.name,
      normalized_legal_name: merged.normalizedName,
      city: merged.city,
      region: merged.region,
      priority_score: latamCuratedPriorityScore(merged),
      raw_data: {
        kind: merged.kind,
        is_public: merged.isPublic,
        sector: merged.sector,
        macro_industry_key: macro,
        macro_table_version: LATAM_CURATED_MACRO_TABLE_VERSION,
        ...(merged.taxType ? { tax_type: merged.taxType } : {}),
        ...(merged.domain ? { website_domain: merged.domain } : {}),
        ...(merged.sizeLargeLabel ? { official_size_band: 'large', official_size_source: merged.sizeLargeLabel } : {}),
        ...(merged.workers !== null ? { workers: merged.workers } : {}),
        origins: merged.origins,
      },
      imported_at: params.importedAt,
      record_identity_key: identity.recordIdentityKey,
    },
  };
}

/** Entradas → filas, con el recuento de exclusiones. */
export function buildLatamCuratedRows(
  entries: readonly LatamCuratedEntry[],
  params: { sourceYear: number; importedAt: string },
): { rows: LatamCuratedRow[]; excluded: Record<LatamCuratedExclusion, number> } {
  const excluded: Record<LatamCuratedExclusion, number> = { invalid_entry: 0, no_macro: 0 };
  const rows: LatamCuratedRow[] = [];
  for (const merged of mergeLatamCuratedEntries(entries)) {
    const out = buildLatamCuratedRow(merged, params);
    if ('row' in out) rows.push(out.row);
    else excluded[out.excluded] += 1;
  }
  rows.sort((a, b) => a.country_code.localeCompare(b.country_code) || a.normalized_legal_name.localeCompare(b.normalized_legal_name));
  return { rows, excluded };
}
