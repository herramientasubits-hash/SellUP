/**
 * AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1
 *
 * Official-source resolver wiring for the Apollo macro-v2 runtime. Mirrors
 * `@/server/prospect-batches/lusha-official-source-resolvers.ts` exactly — same
 * factory, same injected read-only Colombia (co_siis) query, same fail-closed
 * degrade-to-`[]` behaviour — so both discovery providers share identical
 * official-source semantics. That file is intentionally left untouched; this is
 * a parallel, Apollo-named entry point rather than a rename, to keep this PR's
 * diff scoped to Apollo adoption only.
 *
 * Safe client: the co_siis read is RLS-locked to `service_role`, so it uses the
 * approved, env-guarded `createSupabaseAdminClient` factory. READ-ONLY. Never
 * used to write.
 *
 * Best-effort: if the approved factory cannot produce a client (missing/unsafe
 * env — it fails closed by design), this returns `[]`, and enrichment degrades
 * to the shared "source_catalog_unavailable" soft warning. Never throws.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { OfficialSourceResolver } from '@/server/agents/prospect-intake';
import { createColombiaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/colombia-official-source-resolver';
import { buildColombiaSnapshotQuery } from '@/server/prospect-batches/colombia-snapshot-query';

/**
 * Build the read-only official-source resolvers for the Apollo macro-v2 flow.
 * Returns `[]` (never throws) when a safe service-role client is unavailable.
 */
export function buildApolloOfficialSourceResolvers(): OfficialSourceResolver[] {
  let snapshotClient;
  try {
    snapshotClient = createSupabaseAdminClient();
  } catch {
    return [];
  }

  return [
    createColombiaOfficialSourceResolver({
      querySnapshots: buildColombiaSnapshotQuery(snapshotClient),
    }),
  ];
}
