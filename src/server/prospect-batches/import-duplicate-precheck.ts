// ── Importar candidatos — aviso previo de duplicados (vista previa) ──────────
//
// AGENT1-AUDIT-WS5-IMPORT-PRECHECK-1 — la ruta `check-duplicates` leía TODAS
// las filas de `prospect_candidates` y `accounts` sin paginar (PostgREST corta
// en 1000: más allá de eso el aviso era falso «sin coincidencias»), comparaba
// el NIT crudo («900.123.456» ≠ «900123456-7») y lo hacía con la sesión del
// vendedor (la RLS le esconde los lotes de los demás). Ahora consulta SÓLO lo
// que hace falta: por los dominios, NIT (en sus formas) y nombres normalizados
// del archivo, en bloques. Es un AVISO de la vista previa; la decisión real de
// duplicado la toma la ruta de importación (admisión + reclamo global).

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeCompanyName, normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import { resolveImportTaxIdentifier } from '@/modules/prospect-batches/import-tax-identifier';

export interface ImportPrecheckItem {
  index: number;
  company_name: string;
  country_code?: string | null;
  domain?: string | null;
  website?: string | null;
  tax_identifier?: string | null;
}

export interface ImportPrecheckResult {
  index: number;
  duplicate_status: 'no_match' | 'possible_duplicate' | 'exact_duplicate' | 'insufficient_data';
  reason?: string;
}

/** Valores por consulta `in(...)`: corto para no pasar el largo de URL de PostgREST. */
export const PRECHECK_IN_CHUNK_SIZE = 100;

interface ExistingCompanyRow {
  normalized_name: string | null;
  country_code: string | null;
  domain: string | null;
  tax_identifier: string | null;
}

/** La normalización simple de la ruta de importación (`normalized_name` de las filas importadas). */
function simpleNormalizedName(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** Formas con que un NIT puede estar guardado: crudo, normalizado por país y sólo dígitos. */
export function taxIdentifierVariants(raw: string | null | undefined, countryCode: string | null | undefined): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  const resolved = resolveImportTaxIdentifier(trimmed, countryCode ?? null).value;
  const variants = new Set<string>([trimmed]);
  if (resolved) {
    variants.add(resolved);
    const resolvedDigits = digitsOnly(resolved);
    if (resolvedDigits.length >= 6) variants.add(resolvedDigits);
  }
  const rawDigits = digitsOnly(trimmed);
  if (rawDigits.length >= 6) variants.add(rawDigits);
  return [...variants];
}

/** La clave de comparación de un NIT: dígitos del valor normalizado por país (o del crudo). */
function taxComparisonKey(raw: string | null | undefined, countryCode: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const resolved = resolveImportTaxIdentifier(trimmed, countryCode ?? null).value ?? trimmed;
  const digits = digitsOnly(resolved);
  return digits.length >= 6 ? digits : resolved.toLowerCase();
}

function nameVariants(companyName: string): string[] {
  return [...new Set([normalizeCompanyName(companyName), simpleNormalizedName(companyName)].filter((n) => n.length >= 3))];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function fetchByColumn(
  client: SupabaseClient,
  table: 'prospect_candidates' | 'accounts',
  column: 'domain' | 'tax_identifier' | 'normalized_name',
  values: readonly string[],
): Promise<ExistingCompanyRow[]> {
  const rows: ExistingCompanyRow[] = [];
  for (const part of chunks([...new Set(values)], PRECHECK_IN_CHUNK_SIZE)) {
    let query = client
      .from(table)
      .select('normalized_name, country_code, domain, tax_identifier')
      .in(column, part);
    query = table === 'accounts' ? query.is('deleted_at', null) : query.neq('status', 'discarded');
    const { data, error } = await query;
    // Fallo de lectura ⇒ se propaga: la ruta responde error, no «sin coincidencias».
    if (error) throw new Error(`precheck ${table}.${column}: ${error.message}`);
    rows.push(...((data ?? []) as ExistingCompanyRow[]));
  }
  return rows;
}

/** Calcula el aviso de duplicado por fila con consultas dirigidas. */
export async function precheckImportDuplicates(
  client: SupabaseClient,
  items: readonly ImportPrecheckItem[],
): Promise<ImportPrecheckResult[]> {
  const prepared = items.map((item) => ({
    item,
    domain: normalizeDomain(item.domain ?? '') ?? normalizeDomain(item.website ?? ''),
    taxVariants: taxIdentifierVariants(item.tax_identifier, item.country_code),
    taxKey: taxComparisonKey(item.tax_identifier, item.country_code),
    names: item.company_name ? nameVariants(item.company_name) : [],
  }));

  const domains = prepared.flatMap((p) => (p.domain ? [p.domain, `www.${p.domain}`] : []));
  const taxes = prepared.flatMap((p) => p.taxVariants);
  const names = prepared.flatMap((p) => p.names);

  const [byDomain, byTax, byName] = await Promise.all([
    domains.length > 0
      ? Promise.all([
          fetchByColumn(client, 'prospect_candidates', 'domain', domains),
          fetchByColumn(client, 'accounts', 'domain', domains),
        ]).then((r) => r.flat())
      : Promise.resolve([] as ExistingCompanyRow[]),
    taxes.length > 0
      ? Promise.all([
          fetchByColumn(client, 'prospect_candidates', 'tax_identifier', taxes),
          fetchByColumn(client, 'accounts', 'tax_identifier', taxes),
        ]).then((r) => r.flat())
      : Promise.resolve([] as ExistingCompanyRow[]),
    names.length > 0
      ? Promise.all([
          fetchByColumn(client, 'prospect_candidates', 'normalized_name', names),
          fetchByColumn(client, 'accounts', 'normalized_name', names),
        ]).then((r) => r.flat())
      : Promise.resolve([] as ExistingCompanyRow[]),
  ]);

  const existingTaxKeys = new Set(
    byTax.map((r) => taxComparisonKey(r.tax_identifier, r.country_code)).filter((k): k is string => !!k),
  );
  const existingDomains = new Set(
    byDomain.map((r) => normalizeDomain(r.domain ?? '')).filter((d): d is string => !!d),
  );

  return prepared.map(({ item, domain, taxKey, names: itemNames }) => {
    if (!item.company_name) return { index: item.index, duplicate_status: 'insufficient_data' };
    if (taxKey && existingTaxKeys.has(taxKey)) {
      return { index: item.index, duplicate_status: 'exact_duplicate', reason: 'Mismo identificador fiscal' };
    }
    if (domain && existingDomains.has(domain)) {
      return { index: item.index, duplicate_status: 'exact_duplicate', reason: 'Mismo dominio web' };
    }
    const nameMatch = byName.some(
      (r) =>
        !!r.normalized_name &&
        itemNames.includes(r.normalized_name) &&
        (!item.country_code || !r.country_code || r.country_code === item.country_code),
    );
    if (nameMatch) {
      return { index: item.index, duplicate_status: 'possible_duplicate', reason: 'Nombre similar en el mismo país' };
    }
    return { index: item.index, duplicate_status: 'no_match' };
  });
}
