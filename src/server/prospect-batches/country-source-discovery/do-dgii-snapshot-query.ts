/**
 * do-dgii-snapshot-query.ts — las dos lecturas (SÓLO LECTURA) del descubrimiento
 * gratuito de República Dominicana.
 *
 * SOURCES-DO-FREE-DISCOVERY-1.
 *
 *   1. Padrón DGII (`rd_dgii_bulk`): contribuyentes activos cuya actividad es una
 *      de las de la macro. Paginado en bloques de 1.000 (el máximo que devuelve
 *      PostgREST), orden estable por RNC, hasta el tope pedido.
 *   2. Compras públicas (`do_dgcp`): importe adjudicado por RNC y año, en bloques
 *      de RNC, sumado por RNC.
 *
 * Nunca inserta, actualiza ni borra. Cualquier error degrada a vacío: sin
 * padrón no hay candidatos, y sin compras públicas tampoco (fail-closed hacia el
 * proveedor de pago, que hace exactamente lo de hoy).
 *
 * Este módulo NO construye el cliente: recibe uno de `service_role` creado por
 * la factoría aprobada, igual que el resto de lecturas de esta tabla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DoDgiiActiveRow, DoDgiiDiscoveryReads } from './do-dgii-discovery-adapter';

/** Filas por página del padrón (máximo de PostgREST). */
export const DO_DGII_PAGE_SIZE = 1000;
/** RNC por consulta a compras públicas. Hasta 7 años por RNC ⇒ ≤ 700 filas. */
export const DO_DGCP_RNC_CHUNK = 100;

type DgiiSelectRow = {
  record_identity_key: string;
  normalized_tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  sector: string | null;
};

type DgcpSelectRow = {
  normalized_tax_id: string | null;
  awarded: unknown;
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Adapta un cliente (de `service_role`) a las dos lecturas del adapter. */
export function buildDoDgiiDiscoveryReads(client: SupabaseClient): DoDgiiDiscoveryReads {
  return {
    async readActiveCompaniesByActivity({ activityTexts, limit }) {
      const texts = [...new Set(activityTexts)];
      const cap = Math.max(0, Math.trunc(limit));
      if (texts.length === 0 || cap === 0) return [];

      const rows: DoDgiiActiveRow[] = [];
      try {
        for (let from = 0; from < cap; from += DO_DGII_PAGE_SIZE) {
          const to = Math.min(from + DO_DGII_PAGE_SIZE, cap) - 1;
          const { data, error } = await client
            .from('source_company_snapshots')
            .select('record_identity_key, normalized_tax_id, legal_name, normalized_legal_name, sector')
            .eq('source_key', 'rd_dgii_bulk')
            .eq('country_code', 'DO')
            .eq('raw_data->>is_active_taxpayer', 'true')
            .in('sector', texts)
            .order('normalized_tax_id', { ascending: true })
            .range(from, to);
          if (error || !Array.isArray(data)) return [];
          for (const row of data as DgiiSelectRow[]) {
            rows.push({
              record_identity_key: row.record_identity_key,
              rnc: row.normalized_tax_id,
              legal_name: row.legal_name,
              normalized_legal_name: row.normalized_legal_name,
              sector: row.sector,
            });
          }
          if (data.length < to - from + 1) break;
        }
      } catch {
        return [];
      }
      return rows;
    },

    async readProcurementTotals(rncs) {
      const totals = new Map<string, number>();
      const unique = [...new Set(rncs)];
      if (unique.length === 0) return totals;
      try {
        const pages = await Promise.all(
          chunk(unique, DO_DGCP_RNC_CHUNK).map(async (part) => {
            const { data, error } = await client
              .from('source_company_snapshots')
              .select('normalized_tax_id, awarded:signals->total_awarded_amount_dop')
              .eq('source_key', 'do_dgcp')
              .eq('country_code', 'DO')
              .in('normalized_tax_id', part)
              .limit(DO_DGII_PAGE_SIZE);
            if (error || !Array.isArray(data)) throw new Error('dgcp_read_failed');
            return data as DgcpSelectRow[];
          }),
        );
        for (const page of pages) {
          for (const row of page) {
            const rnc = row.normalized_tax_id?.trim();
            if (!rnc) continue;
            totals.set(rnc, (totals.get(rnc) ?? 0) + toAmount(row.awarded));
          }
        }
      } catch {
        return new Map();
      }
      return totals;
    },
  };
}
