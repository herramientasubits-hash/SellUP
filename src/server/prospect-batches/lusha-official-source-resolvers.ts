/**
 * Q3F-5BB.10C2 — Official-source resolver wiring for the Lusha pending-review flow.
 *
 * Builds the injected `OfficialSourceResolver[]` the pure core hands to
 * `enrichNormalizedProspectWithOfficialSources`. Today that is exactly ONE
 * resolver — Colombia (co_siis) name→NIT. No promise of MX/PE/EC/… enrichment is
 * made here; unsupported countries fall through to the shared "unsupported"
 * result (soft warning) automatically.
 *
 * Safe client: the co_siis read is RLS-locked to `service_role`, so it uses the
 * approved, env-guarded `createSupabaseAdminClient` factory (NOT an inline
 * `createClient(process.env…)`). The client is used strictly READ-ONLY (a bounded
 * SELECT against `source_company_snapshots`). It is NEVER used to write — every
 * write in the Lusha flow still goes through the RLS session client's
 * `insertBatch` / `insertCandidates` deps.
 *
 * Best-effort: if the approved factory cannot produce a client (missing/unsafe
 * env — it fails closed by design), this returns `[]`, and enrichment degrades to
 * the shared "source_catalog_unavailable" soft warning. It never throws, so it can
 * never break the Lusha flow.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { OfficialSourceResolver } from '@/server/agents/prospect-intake';
import { createColombiaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/colombia-official-source-resolver';
import { buildColombiaSnapshotQuery } from '@/server/prospect-batches/colombia-snapshot-query';

/**
 * Build the read-only official-source resolvers for the Lusha flow. Returns `[]`
 * (never throws) when a safe service-role client is unavailable.
 */
export function buildLushaOfficialSourceResolvers(): OfficialSourceResolver[] {
  let snapshotClient;
  try {
    snapshotClient = createSupabaseAdminClient();
  } catch {
    // Env missing/unsafe (factory fails closed) → no resolver; enrichment is a
    // soft "source_catalog_unavailable" and the Lusha flow continues unaffected.
    return [];
  }

  return [
    createColombiaOfficialSourceResolver({
      querySnapshots: buildColombiaSnapshotQuery(snapshotClient),
    }),
  ];
}
