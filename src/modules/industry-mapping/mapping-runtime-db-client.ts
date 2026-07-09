// mapping-runtime-db-client.ts — Provider Industry Mapping Server-Only
// Runtime Boundary (Q3F-5AN.1).
//
// Service-role Supabase client construction for the industry-mapping domain
// DB clients. Reads the service-role secret only from established server
// environment variables — never returned, never logged, never exported from
// this module's public (index.ts) barrel. Same convention as
// contact-enrichment/actions.ts getServiceRoleClient(): a fresh client per
// call, no module-level secret caching.
//
// The real Supabase client satisfies MappingDraftDbClient /
// MappingPublicationDbClient / MappingSnapshotLoadDbClient structurally —
// callers cast it with `as unknown as <Contract>`, same convention already
// used by IdempotencyDbClient and the industry-mapping domain services
// themselves.

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { MappingDraftDbClient } from './mapping-draft-types';
import type { MappingDraftDeleteDbClient } from './mapping-draft-delete-service';
import type { MappingPublicationDbClient } from './mapping-publication-types';
import type { MappingSnapshotLoadDbClient } from './mapping-snapshot-load-types';

function createIndustryMappingServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase service-role credentials are not configured.');
  }
  return createSupabaseClient(url, key);
}

/** Service-role client cast to the DRAFT domain service's structural DB contract. */
export function createIndustryMappingDraftDbClient(): MappingDraftDbClient {
  return createIndustryMappingServiceRoleClient() as unknown as MappingDraftDbClient;
}

/** Service-role client cast to the publication domain service's structural DB/RPC contract. */
export function createIndustryMappingPublicationDbClient(): MappingPublicationDbClient {
  return createIndustryMappingServiceRoleClient() as unknown as MappingPublicationDbClient;
}

/**
 * Service-role client cast to the DRAFT-delete domain service's narrow
 * structural RPC-only contract (Q3F-5AR.0). The delete-DRAFT RPC's EXECUTE
 * privilege remains revoked as of migration 083 — this factory exists so the
 * application call path is coded and offline-tested ahead of that later
 * narrow activation.
 */
export function createIndustryMappingDraftDeleteDbClient(): MappingDraftDeleteDbClient {
  return createIndustryMappingServiceRoleClient() as unknown as MappingDraftDeleteDbClient;
}

/** Service-role client cast to the snapshot loaders' structural DB contract. */
export function createIndustryMappingSnapshotLoadDbClient(): MappingSnapshotLoadDbClient {
  return createIndustryMappingServiceRoleClient() as unknown as MappingSnapshotLoadDbClient;
}
