/**
 * SOURCES-GT-HN-BY-NAME-1 — generic snapshot read (INJECTED I/O boundary) for the
 * snapshot-backed name → tax id resolvers.
 *
 * Strictly READ-ONLY: one bounded SELECT on `source_company_snapshots` filtered to
 * one `source_key` / `country_code` and an exact `normalized_legal_name = <core>`,
 * served by the existing `(source_key, normalized_legal_name)` index. Never writes.
 * Any failure degrades to `[]` (fail-soft).
 *
 * Client note: `source_company_snapshots` is RLS-locked to `service_role`; the
 * caller supplies a client built through the approved `createSupabaseAdminClient`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  SnapshotNameQuery,
  SnapshotNameRow,
} from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import type { OfficialWorkforce } from '@/server/agents/prospect-intake/source-enrichment';

/** Upper bound on rows per lookup (homonyms). */
export const SNAPSHOT_NAME_QUERY_LIMIT = 10;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * SOURCES-CL-SII-REGISTRY-1 — `raw_data` con `workers` y `metrics_year` (cargas
 * del SII de Chile) → trabajadores del registro, o `null`.
 */
/**
 * SOURCES-MX-SIZE-BAND-1 — estratificación declarada en México (Ley para el
 * Desarrollo de la Competitividad de la MIPYME): el tramo por número de personas,
 * tomando el rango que cubre a los tres sectores (industria, comercio, servicios).
 * «NO MIPYME» es la grande. Piso y techo; `null` = sin techo.
 */
export const MX_STRATIFICATION_BANDS: Readonly<Record<string, { min: number; max: number | null; label: string }>> = {
  MICRO: { min: 0, max: 10, label: 'micro' },
  PEQUEÑA: { min: 11, max: 50, label: 'pequeña' },
  PEQUENA: { min: 11, max: 50, label: 'pequeña' },
  MEDIANA: { min: 31, max: 250, label: 'mediana' },
  GRANDE: { min: 101, max: null, label: 'grande' },
  'NO MIPYME': { min: 101, max: null, label: 'grande' },
};

function bandFromStratification(raw: Record<string, unknown>, source: string, fallbackYear: number | null): OfficialWorkforce | null {
  const value = raw['stratification'];
  if (typeof value !== 'string') return null;
  const band = MX_STRATIFICATION_BANDS[value.trim().toUpperCase()];
  if (!band) return null;
  const yearValue = raw['last_contract_year'];
  const year = typeof yearValue === 'number' && Number.isInteger(yearValue) ? yearValue : fallbackYear;
  if (year === null) return null;
  return { workers: band.min, year, source, maxWorkers: band.max, sizeBand: band.label };
}

/**
 * SOURCES-PY-CLOSE-1 — tamaño MIPYME que una sociedad paraguaya declaró a la DNCP
 * (Ley 4457/2012, art. 5): micro hasta 10 trabajadores, pequeña hasta 30, mediana
 * hasta 50. Las tres quedan en o bajo el corte de pequeña del filtro de tamaño.
 * Una grande no se categoriza: no hay tramo «grande».
 */
export const PY_MIPYME_BANDS: Readonly<Record<string, { min: number; max: number; label: string }>> = {
  MICRO: { min: 0, max: 10, label: 'micro' },
  PEQUEÑA: { min: 11, max: 30, label: 'pequeña' },
  PEQUENA: { min: 11, max: 30, label: 'pequeña' },
  MEDIANA: { min: 31, max: 50, label: 'mediana' },
};

function bandFromParaguayMipymeSize(raw: Record<string, unknown>, source: string): OfficialWorkforce | null {
  const value = raw['py_mipyme_size'];
  const year = raw['py_mipyme_size_year'];
  if (typeof value !== 'string' || typeof year !== 'number' || !Number.isInteger(year)) return null;
  const band = PY_MIPYME_BANDS[value.trim().toUpperCase()];
  if (!band) return null;
  return { workers: band.min, year, source, maxWorkers: band.max, sizeBand: band.label };
}

/**
 * SOURCES-CR-CLOSE-1 — tramo PYME del MEIC de Costa Rica (Ley 8262 y su
 * reglamento: el índice combina personal, ventas y activos; en personas la
 * micro llega a 10, la pequeña a 35 y la mediana a 100). Micro y pequeña quedan
 * bajo el corte de pequeña del filtro de tamaño; la mediana no decide sola.
 * Aprobado por la dueña el 06-10-2026.
 */
export const CR_MEIC_BANDS: Readonly<Record<string, { min: number; max: number; label: string }>> = {
  MICRO: { min: 0, max: 10, label: 'micro' },
  PEQUEÑA: { min: 11, max: 35, label: 'pequeña' },
  PEQUENA: { min: 11, max: 35, label: 'pequeña' },
  MEDIANA: { min: 36, max: 100, label: 'mediana' },
};

function bandFromCostaRicaMeicSize(raw: Record<string, unknown>, source: string): OfficialWorkforce | null {
  const value = raw['cr_meic_size'];
  const year = raw['cr_meic_size_year'];
  if (typeof value !== 'string' || typeof year !== 'number' || !Number.isInteger(year)) return null;
  const band = CR_MEIC_BANDS[value.trim().toUpperCase()];
  if (!band) return null;
  return { workers: band.min, year, source, maxWorkers: band.max, sizeBand: band.label };
}

/**
 * SOURCES-HN-CLOSE-1 — marca «*MIPYME*» que HonduCompras pega al nombre del
 * proveedor. En Honduras la MIPYME llega hasta 150 personas (micro hasta 10,
 * pequeña hasta 50, mediana hasta 150): todo el tramo queda bajo el umbral ICP de
 * 200, así que el filtro de tamaño la descarta (aprobado por la dueña el
 * 07-10-2026). Una grande no se marca: no hay tramo «grande».
 */
export const HN_MIPYME_BAND = { min: 0, max: 150, label: 'mipyme' } as const;

function bandFromHondurasMipyme(raw: Record<string, unknown>, source: string): OfficialWorkforce | null {
  const year = raw['hn_mipyme_year'];
  if (typeof year !== 'number' || !Number.isInteger(year)) return null;
  return {
    workers: HN_MIPYME_BAND.min,
    year,
    source,
    maxWorkers: HN_MIPYME_BAND.max,
    sizeBand: HN_MIPYME_BAND.label,
    declaredBelowIcp: true,
  };
}

export function workforceFromRawData(raw: unknown, source: string, fallbackYear: number | null = null): OfficialWorkforce | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record['hn_mipyme_year'] !== undefined) return bandFromHondurasMipyme(record, source);
  if (record['py_mipyme_size'] !== undefined) return bandFromParaguayMipymeSize(record, source);
  if (record['cr_meic_size'] !== undefined) return bandFromCostaRicaMeicSize(record, source);
  if (record['sat_iva_agent'] === true) return bandFromGuatemalaIvaAgent(record, source, fallbackYear);
  const workers = record['workers'];
  const year = record['metrics_year'];
  if (workers === undefined && record['stratification'] !== undefined) {
    return bandFromStratification(record, source, fallbackYear);
  }
  if (workers === undefined && record['taxpayer_category'] !== undefined) {
    return bandFromTaxpayerCategory(record, source, fallbackYear);
  }
  if (typeof workers !== 'number' || !Number.isInteger(workers) || workers < 0) return null;
  if (typeof year !== 'number' || !Number.isInteger(year)) return null;
  const bracket = record['sales_bracket'];
  return { workers, year, source, salesBracket: typeof bracket === 'string' ? bracket : null };
}

/**
 * SOURCES-BO-CLOSE-1 — categoría de contribuyente de Impuestos Nacionales de
 * Bolivia: PRICO (principales) y GRACO (grandes) se eligen por impuestos y ventas,
 * NO por trabajadores. Llega al filtro de tamaño como un tramo SIN piso ni techo de
 * personas: queda registrado y explicado, pero no decide (ni aprueba por grande ni
 * descarta por pequeña). «Lo grande no decide solo» (dueña, 06-10-2026).
 */
export const BO_TAXPAYER_CATEGORY_BANDS: Readonly<Record<string, string>> = {
  PRICO: 'principal contribuyente (PRICO)',
  GRACO: 'gran contribuyente (GRACO)',
  // SOURCES-PA-CLOSE-1 — Grandes Contribuyentes de la DGI de Panamá (ingresos ≥
  // B/.20 M y activos ≥ B/.60 M). Mismo trato: «empresa grande» que no decide sola.
  PA_GRAN_CONTRIBUYENTE: 'gran contribuyente (DGI Panamá)',
  // SOURCES-SV-CLOSE-1 — Grandes (DGII 2019 o Hacienda 2012) y Medianos (2012)
  // Contribuyentes de El Salvador: Hacienda clasifica por impuestos pagados y ventas
  // (criterios de 2012), no por trabajadores, y la lista más reciente con NIT es de
  // 2019. Mismo trato: queda en la ficha con su año y NO decide (no es vigente).
  SV_GRAN_CONTRIBUYENTE: 'gran contribuyente (Hacienda El Salvador)',
  SV_MEDIANO_CONTRIBUYENTE: 'mediano contribuyente (Hacienda El Salvador)',
  // SOURCES-NI-CLOSE-2 — Grandes Contribuyentes de la DGI de Nicaragua (lista de
  // 2019-2020 del Internet Archive). Mismo trato: «empresa grande» que no decide sola.
  NI_GRAN_CONTRIBUYENTE: 'gran contribuyente (DGI Nicaragua)',
};

function bandFromTaxpayerCategory(raw: Record<string, unknown>, source: string, fallbackYear: number | null): OfficialWorkforce | null {
  const value = raw['taxpayer_category'];
  if (typeof value !== 'string') return null;
  const band = BO_TAXPAYER_CATEGORY_BANDS[value.trim().toUpperCase()];
  if (!band) return null;
  const yearValue = raw['metrics_year'];
  const year = typeof yearValue === 'number' && Number.isInteger(yearValue) ? yearValue : fallbackYear;
  if (year === null) return null;
  return { workers: 0, year, source, maxWorkers: null, sizeBand: band };
}

/**
 * SOURCES-GT-SIZE-1 — agente de retención del IVA de la SAT de Guatemala. La SAT sólo
 * designa como agentes a contribuyentes grandes (por ventas e impuestos, NO por
 * trabajadores). Mismo trato que los grandes contribuyentes de Bolivia y Panamá: un
 * tramo «grande» SIN piso ni techo de personas, que queda en la ficha y no decide
 * solo. No estar en la lista no prueba nada: `sat_iva_agent: false` no da tramo.
 */
export const GT_SAT_IVA_AGENT_BAND = 'agente de retención del IVA (SAT Guatemala)';

function bandFromGuatemalaIvaAgent(raw: Record<string, unknown>, source: string, fallbackYear: number | null): OfficialWorkforce | null {
  const listDate = raw['sat_list_date'];
  const listYear = typeof listDate === 'string' ? Number.parseInt(listDate.slice(0, 4), 10) : Number.NaN;
  const year = Number.isInteger(listYear) ? listYear : fallbackYear;
  if (year === null) return null;
  return { workers: 0, year, source, maxWorkers: null, sizeBand: GT_SAT_IVA_AGENT_BAND };
}

/** Adapt a (service-role) client into a read-only name query for one source. */
export function buildSnapshotNameQuery(
  client: SupabaseClient,
  sourceKey: string,
  countryCode: string,
  options: { withWorkforce?: boolean } = {},
): SnapshotNameQuery {
  const columns: string = options.withWorkforce
    ? 'normalized_tax_id, legal_name, normalized_legal_name, raw_data, source_year'
    : 'normalized_tax_id, legal_name, normalized_legal_name';
  return async (core: string) => {
    if (typeof core !== 'string' || core.trim().length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select(columns)
        .eq('source_key', sourceKey)
        .eq('country_code', countryCode)
        .eq('normalized_legal_name', core)
        .limit(SNAPSHOT_NAME_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(
        (row): SnapshotNameRow => {
          const base: SnapshotNameRow = {
            taxId: text(row['normalized_tax_id']),
            legalName: text(row['legal_name']),
            normalizedLegalName: text(row['normalized_legal_name']),
          };
          if (!options.withWorkforce) return base;
          const sourceYear = typeof row['source_year'] === 'number' ? (row['source_year'] as number) : null;
          const workforce = workforceFromRawData(row['raw_data'], sourceKey, sourceYear);
          return workforce === null ? base : { ...base, workforce };
        },
      );
    } catch {
      return [];
    }
  };
}
