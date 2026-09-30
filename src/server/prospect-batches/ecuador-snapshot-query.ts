/**
 * SOURCES-EC-RUC-BY-NAME-1 — Superintendencia de Compañías snapshot read
 * (INJECTED I/O boundary) for the Ecuador name → RUC resolver.
 *
 * Strictly READ-ONLY: one bounded SELECT on `source_company_snapshots` filtered to
 * `source_key = 'ec_scvs'` / `country_code = 'EC'` and an exact
 * `normalized_legal_name = <core>`, served by the existing
 * `(source_key, normalized_legal_name)` index. Never writes and never calls SCVS
 * live. Any failure degrades to `[]` (fail-soft).
 *
 * Client note: `source_company_snapshots` is RLS-locked to `service_role`; the
 * caller supplies a client built through the approved `createSupabaseAdminClient`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EcuadorSnapshotQuery,
  EcuadorSnapshotRow,
} from '@/server/agents/prospect-intake/resolvers/ecuador-official-source-resolver';

/** Upper bound on rows per lookup (homonyms and repeated expedientes). */
export const ECUADOR_SNAPSHOT_QUERY_LIMIT = 10;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapt a (service-role) Supabase client into the read-only SCVS query. */
export function buildEcuadorSnapshotQuery(client: SupabaseClient): EcuadorSnapshotQuery {
  return async (core: string) => {
    if (typeof core !== 'string' || core.trim().length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('normalized_tax_id, legal_name, normalized_legal_name')
        .eq('source_key', 'ec_scvs')
        .eq('country_code', 'EC')
        .eq('normalized_legal_name', core)
        .limit(ECUADOR_SNAPSHOT_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as Record<string, unknown>[]).map(
        (row): EcuadorSnapshotRow => ({
          ruc: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
        }),
      );
    } catch {
      return [];
    }
  };
}
