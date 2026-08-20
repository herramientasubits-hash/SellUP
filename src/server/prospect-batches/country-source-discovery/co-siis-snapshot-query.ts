/**
 * co-siis-snapshot-query.ts — la ÚNICA frontera de E/S del descubrimiento
 * gratuito de Colombia.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 6, 27, 28.
 *
 * ── 🔴 Sólo lectura, y acotada ───────────────────────────────────────────────
 *
 * Un `SELECT … LIMIT` sobre `source_company_snapshots`, filtrado a
 * `source_key = 'co_siis'` / `country_code = 'CO'` y a los códigos CIIU que el
 * índice canónico resolvió. No hay `insert`, `update`, `delete` ni `upsert`, y no
 * existe ninguna dep que pudiera hacerlos. Fail-soft: cualquier error resuelve a
 * `[]`, que el orquestador traduce a «la fuente no aportó» y sigue hacia el
 * proveedor de pago.
 *
 * ── 🔴 No es la ruta de enriquecimiento oficial ──────────────────────────────
 *
 * `colombia-snapshot-query.ts` sigue existiendo, intacta, sirviendo a la
 * identidad legal (nombre → NIT) por `querySnapshotByName`. Esta consulta es otra
 * cosa: filtra por INDUSTRIA para descubrir empresas, no por nombre para
 * identificar una. Se separan a propósito (§ 6) para que ampliar el
 * descubrimiento no le cambie el significado a un dato del que ya dependen la
 * deduplicación fiscal y el enriquecimiento post-aprobación.
 *
 * ── 🔴 El cero a la izquierda ────────────────────────────────────────────────
 *
 * El CIIU es de 4 dígitos, pero 575 de las 10.000 filas de co_siis lo guardan con
 * 3 caracteres porque la importación perdió el cero inicial ('111' por '0111').
 * Por eso cada código viaja en sus DOS formas: filtrar sólo por la canónica
 * dejaría fuera, en silencio, a todo el sector agropecuario y minero.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoSiisSnapshotQuery, CoSiisSnapshotRow } from './co-siis-discovery-adapter';

/** `source_key` de la porción colombiana del snapshot. */
export const CO_SIIS_SNAPSHOT_SOURCE_KEY = 'co_siis' as const;

/** Nombre de la clave CIIU dentro de `raw_data`. */
const CO_SIIS_RAW_CIIU_KEY = 'CIIU';

/** Las dos formas con las que un mismo código puede estar guardado. */
function expandCiiuCodeForms(codes: readonly string[]): string[] {
  const forms = new Set<string>();
  for (const code of codes) {
    const trimmed = code.trim();
    if (trimmed === '') continue;
    forms.add(trimmed);
    forms.add(trimmed.replace(/^0+/, '') || trimmed);
  }
  return [...forms];
}

type SnapshotSelectRow = {
  record_identity_key: string;
  legal_name: string | null;
  normalized_legal_name: string | null;
  tax_id: string | null;
  sector: string | null;
  city: string | null;
  department: string | null;
  raw_data: Record<string, unknown> | null;
};

/**
 * Adapta un cliente (de `service_role`) a la consulta de descubrimiento.
 *
 * Este módulo NO construye el cliente: lo recibe. Quien lo construye usa la
 * factoría aprobada y env-guarded, igual que el resto de lecturas de esta tabla.
 */
export function buildCoSiisDiscoverySnapshotQuery(client: SupabaseClient): CoSiisSnapshotQuery {
  return async ({ ciiuCodes, limit }): Promise<readonly CoSiisSnapshotRow[]> => {
    const forms = expandCiiuCodeForms(ciiuCodes);
    if (forms.length === 0 || limit <= 0) return [];

    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select(
          'record_identity_key, legal_name, normalized_legal_name, tax_id, sector, city, department, raw_data',
        )
        .eq('source_key', CO_SIIS_SNAPSHOT_SOURCE_KEY)
        .eq('country_code', 'CO')
        .in(`raw_data->>${CO_SIIS_RAW_CIIU_KEY}`, forms)
        // Orden estable: dos corridas idénticas leen las mismas filas. Sin él, el
        // «no determinista» de Postgres haría irreproducible cualquier diagnóstico.
        .order('record_identity_key', { ascending: true })
        .limit(limit);

      if (error || !data) return [];

      return (data as SnapshotSelectRow[]).map((row) => ({
        record_identity_key: row.record_identity_key,
        legal_name: row.legal_name,
        normalized_legal_name: row.normalized_legal_name,
        tax_id: row.tax_id,
        sector: row.sector,
        city: row.city,
        department: row.department,
        ciiu:
          typeof row.raw_data?.[CO_SIIS_RAW_CIIU_KEY] === 'string'
            ? (row.raw_data[CO_SIIS_RAW_CIIU_KEY] as string)
            : null,
      }));
    } catch {
      return [];
    }
  };
}
