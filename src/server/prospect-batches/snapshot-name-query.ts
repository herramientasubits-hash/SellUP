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
export function workforceFromRawData(raw: unknown, source: string): OfficialWorkforce | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const workers = record['workers'];
  const year = record['metrics_year'];
  if (typeof workers !== 'number' || !Number.isInteger(workers) || workers < 0) return null;
  if (typeof year !== 'number' || !Number.isInteger(year)) return null;
  const bracket = record['sales_bracket'];
  return { workers, year, source, salesBracket: typeof bracket === 'string' ? bracket : null };
}

/** Adapt a (service-role) client into a read-only name query for one source. */
export function buildSnapshotNameQuery(
  client: SupabaseClient,
  sourceKey: string,
  countryCode: string,
  options: { withWorkforce?: boolean } = {},
): SnapshotNameQuery {
  const columns: string = options.withWorkforce
    ? 'normalized_tax_id, legal_name, normalized_legal_name, raw_data'
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
          const workforce = workforceFromRawData(row['raw_data'], sourceKey);
          return workforce === null ? base : { ...base, workforce };
        },
      );
    } catch {
      return [];
    }
  };
}
