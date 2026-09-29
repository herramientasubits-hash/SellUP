/**
 * SOURCES-DO-INRUN-RNC-1 — DGII República Dominicana snapshot read (INJECTED I/O
 * boundary).
 *
 * The ONLY place the rd_dgii_bulk name→RNC read touches Supabase. It wraps a
 * caller-supplied `SupabaseClient` into the pure `DominicanSnapshotQuery` seam
 * the resolver consumes, so the resolver + the shared intake enrichment layer
 * stay free of any client/env. It lives OUTSIDE `src/server/agents/prospect-intake/`
 * on purpose: that tree is guarded to be strictly pure.
 *
 * Strictly READ-ONLY: one bounded SELECT on `source_company_snapshots` filtered
 * to `source_key = 'rd_dgii_bulk'` / `country_code = 'DO'` and an exact
 * `normalized_legal_name IN (…)` list, served by the existing
 * `(source_key, normalized_legal_name)` index. It never inserts, updates,
 * deletes or upserts. Any failure degrades to `[]` (fail-soft).
 *
 * Client note: `source_company_snapshots` is RLS-locked to `service_role`; the
 * caller supplies a client built through the approved `createSupabaseAdminClient`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DominicanSnapshotQuery,
  DominicanSnapshotRow,
} from '@/server/agents/prospect-intake/resolvers/dominican-republic-official-source-resolver';

/** Upper bound on rows returned per lookup (homonyms across suffix spellings). */
export const DOMINICAN_SNAPSHOT_QUERY_LIMIT = 25;
/** Upper bound on name spellings sent per lookup. */
export const DOMINICAN_SNAPSHOT_MAX_NAMES = 12;

const SELECTED_COLUMNS =
  'normalized_tax_id, legal_name, normalized_legal_name, ' +
  'taxpayer_status:raw_data->>taxpayer_status, is_active_taxpayer:raw_data->>is_active_taxpayer';

function toRow(record: Record<string, unknown>): DominicanSnapshotRow {
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  const active = record['is_active_taxpayer'];
  return {
    rnc: text(record['normalized_tax_id']),
    legalName: text(record['legal_name']),
    normalizedLegalName: text(record['normalized_legal_name']),
    taxpayerStatus: text(record['taxpayer_status']),
    isActiveTaxpayer: active === true || active === 'true',
  };
}

/**
 * Adapt a (service-role) Supabase client into a read-only DGII snapshot query.
 * Fails soft: an error or a thrown exception resolves to `[]`.
 */
export function buildDominicanSnapshotQuery(client: SupabaseClient): DominicanSnapshotQuery {
  return async (normalizedLegalNames: string[]) => {
    const names = [...new Set(normalizedLegalNames.filter((n) => n.trim().length > 0))].slice(
      0,
      DOMINICAN_SNAPSHOT_MAX_NAMES,
    );
    if (names.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select(SELECTED_COLUMNS)
        .eq('source_key', 'rd_dgii_bulk')
        .eq('country_code', 'DO')
        .in('normalized_legal_name', names)
        .limit(DOMINICAN_SNAPSHOT_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as unknown as Record<string, unknown>[]).map(toRow);
    } catch {
      return [];
    }
  };
}
