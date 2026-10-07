/**
 * pe-sunat-directory-snapshot-query.ts — la lectura (SÓLO LECTURA) del
 * descubrimiento gratuito de Perú.
 *
 * SOURCES-PE-FREE-DISCOVERY-1.
 *
 * Dos SELECT acotados (primero las que traen web oficial) sobre `source_company_snapshots`, filtrados a
 * `pe_sunat_directory` / `PE` y a la macro pedida, ordenado por trabajadores
 * (`priority_score`) y, en los empates, por RUC para que dos
 * corridas idénticas lean las mismas filas.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por la
 * factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PeSunatDirectoryDiscoveryReads,
  PeSunatDirectorySnapshotReadRow,
} from './pe-sunat-directory-discovery-adapter';

type SnapshotSelectRow = {
  record_identity_key: string;
  normalized_tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  priority_score: number | string | null;
  raw_data: Record<string, unknown> | null;
};

const SELECTED_COLUMNS =
  'record_identity_key, normalized_tax_id, legal_name, normalized_legal_name, city, region, priority_score, raw_data';

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function toInteger(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && Number.isInteger(n) ? n : null;
}

function toRow(row: SnapshotSelectRow): PeSunatDirectorySnapshotReadRow {
  const code = row.raw_data?.['ciiu4_code'];
  const activity = row.raw_data?.['activity_text'];
  const domain = row.raw_data?.['website_domain'];
  return {
    record_identity_key: row.record_identity_key,
    ruc: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    region: row.region,
    ciiu4_code: typeof code === 'string' ? code : null,
    activity_text: typeof activity === 'string' ? activity : null,
    website_domain: typeof domain === 'string' ? domain : null,
    employees: toInteger(row.raw_data?.['workers']),
    metrics_year: toInteger(row.raw_data?.['metrics_year']),
    priority_score: toNumber(row.priority_score),
  };
}

/**
 * SOURCES-PE-FREE-LAYER-WEB-FIRST-1 — primero las que traen web oficial (hoy, las
 * municipalidades con dominio del RENAMU) y después el resto, cada grupo de más a
 * menos trabajadores. Perú × Gobierno (lote 656e6835, 07-10): por trabajadores las
 * 49 primeras eran UGEL, ministerios y Fuerzas Armadas sin web; las 49 fueron a
 * «Descartadas» y el rescate sólo recuperó 8, mientras las 169 municipalidades con
 * web oficial nunca llegaban a ofrecerse.
 */
export function buildPeSunatDirectoryDiscoveryReads(client: SupabaseClient): PeSunatDirectoryDiscoveryReads {
  const read = async (macroIndustryKey: string, limit: number, withWebsite: boolean): Promise<PeSunatDirectorySnapshotReadRow[]> => {
    const base = client
      .from('source_company_snapshots')
      .select(SELECTED_COLUMNS)
      .eq('source_key', 'pe_sunat_directory')
      .eq('country_code', 'PE')
      .eq('raw_data->>macro_industry_key', macroIndustryKey);
    const filtered = withWebsite
      ? base.not('raw_data->>website_domain', 'is', null)
      : base.is('raw_data->>website_domain', null);
    const { data, error } = await filtered
      .order('priority_score', { ascending: false })
      .order('normalized_tax_id', { ascending: true })
      .limit(limit);
    if (error || !Array.isArray(data)) throw new Error('pe_sunat_directory_read_failed');
    return (data as unknown as SnapshotSelectRow[]).map(toRow);
  };
  return {
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        const withWebsite = await read(macroIndustryKey, limit, true);
        if (withWebsite.length >= limit) return withWebsite;
        const rest = await read(macroIndustryKey, limit - withWebsite.length, false);
        return [...withWebsite, ...rest];
      } catch {
        return [];
      }
    },
  };
}
