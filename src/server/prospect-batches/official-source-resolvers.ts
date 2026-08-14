/**
 * Q3F-5BB.10C2 / AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — provider-neutral
 * official-source resolver wiring, shared by every discovery provider (Lusha,
 * Apollo, and any future one) that adopts the shared intake seam
 * (`@/server/agents/prospect-intake`).
 *
 * Builds the injected `OfficialSourceResolver[]` the pure core hands to
 * `enrichNormalizedProspectWithOfficialSources`. Today that is exactly ONE
 * resolver — Colombia (co_siis) name→NIT. No promise of MX/PE/EC/… enrichment
 * is made here; unsupported countries fall through to the shared
 * "unsupported" result (soft warning) automatically.
 *
 * Safe client: the co_siis read is RLS-locked to `service_role`, so it uses
 * the approved, env-guarded `createSupabaseAdminClient` factory (NOT an
 * inline `createClient(process.env…)`). The client is used strictly
 * READ-ONLY (a bounded SELECT against `source_company_snapshots`). It is
 * NEVER used to write — every write in a caller's flow still goes through
 * that caller's own RLS session client.
 *
 * Best-effort: if the approved factory cannot produce a client (missing/unsafe
 * env — it fails closed by design), this returns `[]`, and enrichment
 * degrades to the shared "source_catalog_unavailable" soft warning. It never
 * throws, so it can never break a caller's flow.
 *
 * Provider-neutral by design: this module has no Lusha- or Apollo-specific
 * logic. Do not add provider-specific branches here — a provider-specific
 * need belongs in that provider's own bridge/wiring module, injecting a
 * provider-specific resolver alongside this one instead.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { OfficialSourceResolver } from '@/server/agents/prospect-intake';
import { createColombiaOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/colombia-official-source-resolver';
import { buildColombiaSnapshotQuery } from '@/server/prospect-batches/colombia-snapshot-query';

/**
 * Build the read-only official-source resolvers shared by every discovery
 * provider. Returns `[]` (never throws) when a safe service-role client is
 * unavailable.
 */
export function buildColombiaOfficialSourceResolvers(): OfficialSourceResolver[] {
  let snapshotClient;
  try {
    snapshotClient = createSupabaseAdminClient();
  } catch {
    // Env missing/unsafe (factory fails closed) → no resolver; enrichment is a
    // soft "source_catalog_unavailable" and the caller's flow continues unaffected.
    return [];
  }

  return [
    createColombiaOfficialSourceResolver({
      querySnapshots: buildColombiaSnapshotQuery(snapshotClient),
    }),
  ];
}
