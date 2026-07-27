/**
 * Q3F-5BB.10C2 — Colombia SIIS snapshot read (INJECTED I/O boundary).
 *
 * This is the ONLY place the co_siis official-source read touches Supabase. It
 * wraps a caller-supplied `SupabaseClient` into the pure `ColombiaSnapshotQuery`
 * seam the resolver consumes, so the resolver + the shared intake enrichment layer
 * stay free of any client/env. It lives OUTSIDE `src/server/agents/prospect-intake/`
 * on purpose: that tree is guarded to be strictly pure (no supabase/env/fetch).
 *
 * The read is strictly READ-ONLY: it delegates to the existing, index-backed
 * `querySnapshotByName` (a bounded `SELECT ... LIMIT` on `source_company_snapshots`
 * filtered to `source_key = 'co_siis'` / `country_code = 'CO'`). It never inserts,
 * updates, deletes or upserts. Any failure degrades to `[]` (fail-soft) so the
 * enrichment step can never break the Lusha flow.
 *
 * Client note: `source_company_snapshots` is RLS-locked to `service_role`, so the
 * caller must supply a service-role client built through an approved factory
 * (`createSupabaseAdminClient`). This module does not build one — it only adapts
 * whatever read client it is given.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { querySnapshotByName } from '@/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-colombia';
import type { ColombiaSnapshotQuery } from '@/server/agents/prospect-intake/resolvers/colombia-official-source-resolver';

/**
 * Adapt a (service-role) Supabase client into a read-only Colombia snapshot query.
 * Fails soft: on any thrown error the query resolves to `[]`.
 */
export function buildColombiaSnapshotQuery(client: SupabaseClient): ColombiaSnapshotQuery {
  return async (normalizedName: string, exact: boolean) => {
    try {
      return await querySnapshotByName(client, normalizedName, exact);
    } catch {
      return [];
    }
  };
}
