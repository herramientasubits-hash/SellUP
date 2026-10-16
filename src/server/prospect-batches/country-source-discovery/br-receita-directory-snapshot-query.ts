/**
 * br-receita-directory-snapshot-query.ts — la lectura (SÓLO LECTURA) del
 * descubrimiento gratuito de Brasil.
 *
 * SOURCES-BR-LIGHT-1.
 *
 * Un único SELECT acotado sobre `source_company_snapshots`, filtrado a
 * `br_receita_directory` / `BR` y a la macro pedida, ordenado por relevancia
 * (`priority_score`: capital y sucursales activas) y, en los empates, por CNPJ
 * para que dos corridas idénticas lean las mismas filas.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío (fail-soft).
 * Recibe un cliente de `service_role` creado por la factoría aprobada.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildReadKnownSnapshotIdentities,
  readFreshSnapshotWindow,
  snapshotWebsiteDomain,
} from './country-source-fresh-window';
import type {
  BrReceitaDirectoryDiscoveryReads,
  BrReceitaDirectorySnapshotReadRow,
} from './br-receita-directory-discovery-adapter';

type SnapshotSelectRow = {
  record_identity_key: string;
  normalized_tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  raw_data: Record<string, unknown> | null;
};

const SELECTED_COLUMNS = 'record_identity_key, normalized_tax_id, legal_name, normalized_legal_name, city, region, raw_data';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Fila leída → lo que usa el adapter. Exportada para las pruebas. */
export function toBrReceitaDirectoryRow(row: SnapshotSelectRow): BrReceitaDirectorySnapshotReadRow {
  return {
    record_identity_key: row.record_identity_key,
    cnpj: row.normalized_tax_id,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    city: row.city,
    region: row.region,
    cnae: text(row.raw_data?.['cnae_principal']),
    activity_text: text(row.raw_data?.['activity_text']),
    website_domain: text(row.raw_data?.['website_domain']),
    public_entity: row.raw_data?.['public_entity'] === true,
    porte: text(row.raw_data?.['br_porte']),
  };
}

/** Adapta un cliente (de `service_role`) a la lectura de descubrimiento de Brasil. */
export function buildBrReceitaDirectoryDiscoveryReads(client: SupabaseClient): BrReceitaDirectoryDiscoveryReads {
  return {
    async readCompaniesByMacro({ macroIndustryKey, limit }) {
      if (limit <= 0) return [];
      try {
        // AUDIT-A1-WS7 — por páginas y saltando lo que SellUp ya conoce: la ventana
        // fija de siempre se agotaba tras la primera corrida (ver country-source-fresh-window.ts).
        const rows = await readFreshSnapshotWindow<SnapshotSelectRow>({
          size: limit,
          countryCode: 'BR',
          readKnown: buildReadKnownSnapshotIdentities(client),
          taxIdOf: (row) => row.normalized_tax_id,
          domainOf: (row) => snapshotWebsiteDomain(row.raw_data),
          readRange: async (from, to) => {
            const query = client
              .from('source_company_snapshots')
              .select(SELECTED_COLUMNS)
              .eq('source_key', 'br_receita_directory')
              .eq('country_code', 'BR')
              .eq('raw_data->>macro_industry_key', macroIndustryKey)
              .order('priority_score', { ascending: false })
              .order('normalized_tax_id', { ascending: true });
            const { data, error } = await (from === 0 ? query.limit(limit) : query.range(from, to));
            if (error || !Array.isArray(data)) throw new Error('snapshot_read_failed');
            return data as unknown as SnapshotSelectRow[];
          },
        });
        return rows.map(toBrReceitaDirectoryRow);
      } catch {
        return [];
      }
    },
  };
}
