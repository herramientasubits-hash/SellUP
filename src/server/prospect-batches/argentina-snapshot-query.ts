/**
 * SOURCES-AR-CUIT-BY-NAME-1 — Registro Nacional de Sociedades read (INJECTED I/O
 * boundary) for the Argentina name → CUIT resolver.
 *
 * Strictly READ-ONLY: one bounded SELECT on `source_company_snapshots` filtered to
 * `source_key = 'ar_rns_registry'` / `country_code = 'AR'` and an exact
 * `normalized_legal_name IN (<names>)` (one lookup tier, see
 * `buildArRegistryLookupTiers`), served by the existing
 * `(source_key, normalized_legal_name)` index. Never writes. Any failure
 * degrades to `[]` (fail-soft). It lives OUTSIDE `prospect-intake/` on purpose:
 * that tree is guarded to be strictly pure.
 *
 * Client note: `source_company_snapshots` is RLS-locked to `service_role`; the
 * caller supplies a client built through the approved `createSupabaseAdminClient`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ArgentinaSnapshotQuery,
  ArgentinaSnapshotRow,
} from '@/server/agents/prospect-intake/resolvers/argentina-official-source-resolver';

/** Upper bound on rows per lookup (homonyms). */
export const ARGENTINA_SNAPSHOT_QUERY_LIMIT = 10;
/** Upper bound on exact names asked in one lookup (one tier ≈ 70). */
export const ARGENTINA_SNAPSHOT_QUERY_MAX_NAMES = 80;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Adapt a (service-role) Supabase client into the read-only registry query. */
export function buildArgentinaSnapshotQuery(client: SupabaseClient): ArgentinaSnapshotQuery {
  return async (names: readonly string[]) => {
    const asked = [
      ...new Set(
        (Array.isArray(names) ? names : [])
          .filter((n): n is string => typeof n === 'string')
          .map((n) => n.trim())
          .filter((n) => n.length > 0),
      ),
    ].slice(0, ARGENTINA_SNAPSHOT_QUERY_MAX_NAMES);
    if (asked.length === 0) return [];
    try {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('normalized_tax_id, legal_name, normalized_legal_name')
        .eq('source_key', 'ar_rns_registry')
        .eq('country_code', 'AR')
        .in('normalized_legal_name', asked)
        .limit(ARGENTINA_SNAPSHOT_QUERY_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (data as Record<string, unknown>[]).map(
        (row): ArgentinaSnapshotRow => ({
          cuit: text(row['normalized_tax_id']),
          legalName: text(row['legal_name']),
          normalizedLegalName: text(row['normalized_legal_name']),
        }),
      );
    } catch {
      return [];
    }
  };
}
