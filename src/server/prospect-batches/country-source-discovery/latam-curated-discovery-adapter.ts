/**
 * latam-curated-discovery-adapter.ts — la capa común de listas curadas como
 * fuente gratuita, y su suma a la fuente de cada país.
 *
 * SOURCES-LATAM-CURATED-1.
 *
 * Lee `latam_curated_directory` (universidades, reguladores, bolsas, exportadores,
 * multinacionales, rankings) para un país y una macro, y la SUMA detrás de lo que
 * devuelve la fuente del país: primero lo del país, como siempre; después lo
 * curado que el país no trajo (mismo número fiscal o mismo nombre ⇒ ya está).
 * Un fallo de la capa curada nunca rompe la fuente del país: se ignora.
 *
 * La macro se vuelve a calcular con la tabla de HOY (`latam-curated-macro-table`);
 * la guardada al cargar sólo sirvió para filtrar la lectura.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceDiscoveryResult,
} from './country-source-types';
import { buildCountrySourceOfficialWorkforce } from './country-source-types';
import { LATAM_CURATED_MACRO_TABLE_VERSION, resolveLatamCuratedMacro } from './latam-curated-macro-table';

export const LATAM_CURATED_DISCOVERY_SOURCE_KEY = 'latam_curated_directory' as const;

/** Tope de filas curadas por lectura. */
export const LATAM_CURATED_DISCOVERY_MAX_ROWS = 100;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

const TAX_TYPES = new Set(['NIT', 'RFC', 'RUT', 'RUC', 'CUIT', 'CNPJ', 'RNC', 'RTN', 'cedula_juridica', 'EIN', 'NIF']);

/** Fila curada acotada a lo que esta proyección usa. */
export type LatamCuratedSnapshotReadRow = {
  record_identity_key: string;
  tax_id: string | null;
  tax_type: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  kind: string | null;
  is_public: boolean | null;
  sector: string | null;
  website_domain: string | null;
  official_size_band: string | null;
  official_size_source: string | null;
  workers: number | null;
  origin_labels: readonly string[];
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type LatamCuratedDiscoveryReads = {
  readByCountryAndMacro: (input: {
    countryCode: string;
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly LatamCuratedSnapshotReadRow[]>;
};

const KIND_LABEL: Record<string, string> = {
  university: 'Educación superior',
  school: 'Educación',
  insurer: 'Seguros',
  bank: 'Banca',
  financial: 'Servicios financieros',
  health_provider: 'Prestador de salud',
};

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila curada → empresa de la capa gratuita, o `null` si ya no es de esta macro. */
export function latamCuratedRowToCompany(
  row: LatamCuratedSnapshotReadRow,
  countryCode: string,
  macroIndustryKey: string,
): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  if (legalName === null) return null;
  const macro = resolveLatamCuratedMacro({ kind: row.kind, isPublic: row.is_public, sector: row.sector });
  if (macro !== macroIndustryKey) return null;
  const taxId = row.tax_id?.trim() || null;
  const sizeSource = row.official_size_source?.trim() || null;
  const workforce = buildCountrySourceOfficialWorkforce(row.workers, null, row.origin_labels[0] ?? 'Lista curada');
  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId,
    taxIdentifierType: taxId !== null ? ((row.tax_type && TAX_TYPES.has(row.tax_type) ? row.tax_type : 'other') as CountrySourceCompany['taxIdentifierType']) : null,
    countryCode,
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: row.sector?.trim() || (row.kind ? KIND_LABEL[row.kind] ?? null : null),
    industryCode: null,
    coarseSector: null,
    officialMacroIndustry: { macroIndustryKeys: [macro], tableVersion: LATAM_CURATED_MACRO_TABLE_VERSION },
    ...(row.official_size_band === 'large' && sizeSource !== null
      ? { officialSizeBand: { band: 'large' as const, sourceLabel: sizeSource } }
      : {}),
    ...(workforce !== null ? { officialWorkforce: workforce } : {}),
    originSourceKey: LATAM_CURATED_DISCOVERY_SOURCE_KEY,
    curatedOrigins: row.origin_labels,
  };
}

/** Adapter sólo de la capa curada. */
export function buildLatamCuratedDiscoveryAdapter(reads: LatamCuratedDiscoveryReads): CountrySourceAdapter {
  return async (criteria) => {
    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), LATAM_CURATED_DISCOVERY_MAX_ROWS));
    const empty = { sourceKey: LATAM_CURATED_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };
    if (limit === 0) return empty;
    const rows = await reads.readByCountryAndMacro({
      countryCode: criteria.countryCode.trim().toUpperCase(),
      macroIndustryKey: criteria.macroIndustryKey,
      limit,
    });
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = latamCuratedRowToCompany(row, criteria.countryCode.trim().toUpperCase(), criteria.macroIndustryKey);
      if (company !== null) companies.push(company);
    }
    return { sourceKey: LATAM_CURATED_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

function identityKeys(company: CountrySourceCompany): string[] {
  const keys: string[] = [];
  const tax = company.taxId?.replace(/[^0-9Kk]/g, '').toUpperCase();
  if (tax) keys.push(`tax:${tax}`);
  const name = company.normalizedLegalName?.trim().toUpperCase();
  if (name) keys.push(`name:${name}`);
  return keys;
}

/**
 * La fuente del país y, detrás, lo curado que el país no trajo. El resultado
 * conserva la `sourceKey` del país. Si el país falla, falla igual que antes; si
 * falla lo curado, se devuelve sólo lo del país.
 */
export function withLatamCuratedLayer(
  primary: CountrySourceAdapter,
  curated: CountrySourceAdapter,
): CountrySourceAdapter {
  return async (criteria): Promise<CountrySourceDiscoveryResult> => {
    const base = await primary(criteria);
    let extra: CountrySourceDiscoveryResult | null = null;
    try {
      extra = await curated(criteria);
    } catch {
      extra = null;
    }
    if (extra === null || extra.companies.length === 0) return base;
    const seen = new Set(base.companies.flatMap(identityKeys));
    const added = extra.companies.filter((company) => !identityKeys(company).some((key) => seen.has(key)));
    return {
      sourceKey: base.sourceKey,
      companies: [...base.companies, ...added],
      recordsRead: base.recordsRead + extra.recordsRead,
    };
  };
}

type SnapshotSelectRow = {
  record_identity_key: string;
  tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  raw_data: Record<string, unknown> | null;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toRow(row: SnapshotSelectRow): LatamCuratedSnapshotReadRow {
  const raw = row.raw_data ?? {};
  const origins = Array.isArray(raw['origins']) ? raw['origins'] : [];
  const labels = origins
    .map((o) => (o && typeof o === 'object' ? text((o as Record<string, unknown>)['label']) : null))
    .filter((label): label is string => label !== null);
  const workers = typeof raw['workers'] === 'number' ? (raw['workers'] as number) : null;
  return {
    record_identity_key: row.record_identity_key,
    tax_id: row.tax_id,
    tax_type: text(raw['tax_type']),
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    region: row.region,
    kind: text(raw['kind']),
    is_public: typeof raw['is_public'] === 'boolean' ? (raw['is_public'] as boolean) : null,
    sector: text(raw['sector']),
    website_domain: text(raw['website_domain']),
    official_size_band: text(raw['official_size_band']),
    official_size_source: text(raw['official_size_source']),
    workers,
    origin_labels: labels,
  };
}

/** Lectura real (cliente `service_role`), sólo lectura y fail-soft. */
export function buildLatamCuratedDiscoveryReads(client: SupabaseClient): LatamCuratedDiscoveryReads {
  return {
    async readByCountryAndMacro({ countryCode, macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        const { data, error } = await client
          .from('source_company_snapshots')
          .select('record_identity_key, tax_id, legal_name, normalized_legal_name, city, region, raw_data')
          .eq('source_key', LATAM_CURATED_DISCOVERY_SOURCE_KEY)
          .eq('country_code', countryCode)
          .eq('raw_data->>macro_industry_key', macroIndustryKey)
          .order('priority_score', { ascending: false })
          .order('normalized_legal_name', { ascending: true })
          .limit(limit);
        if (error || !Array.isArray(data)) return [];
        return (data as unknown as SnapshotSelectRow[]).map(toRow);
      } catch {
        return [];
      }
    },
  };
}
