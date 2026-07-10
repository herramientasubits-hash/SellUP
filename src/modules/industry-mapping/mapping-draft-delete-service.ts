// mapping-draft-delete-service.ts — Provider Industry Mapping DRAFT-Delete
// Domain Service (Q3F-5AR.0).
//
// Frozen interpretation (Q3F-5AQ.0R): DELETE-DRAFT is the cleanup capability
// required for reversible live DRAFT validation. This service is a thin,
// race-safe caller of the migration 082 SECTION 12 physical RPC
// (delete_draft_provider_industry_mapping_snapshot) — it never issues a
// direct table DELETE against provider_industry_mapping_associations,
// provider_industry_concept_entries, or provider_industry_mapping_snapshots,
// and never reproduces the RPC's cascade order in TypeScript. The RPC itself
// re-locks and revalidates snapshot existence, DRAFT status, and author
// ownership (p_actor_id = snapshot.created_by) inside its own transaction —
// this service performs only narrow non-empty-string input validation before
// invoking it.
//
// Actor model: ACTOR_C — TRUSTED_APPLICATION_ARGUMENT. actorId is accepted
// as a domain input because this service is not a browser/client API; the
// server application boundary (mapping-runtime-wrappers.ts + server.ts) is
// the only trusted caller allowed to supply it, always derived from the
// resolved internal user id, never from untrusted input.
//
// No archive call, no publish call: this service is DELETE-DRAFT ONLY.
//
// Migration 085 grants delete-DRAFT RPC EXECUTE to service_role only;
// authenticated/anon/PUBLIC remain without EXECUTE. The application
// transport caller posture (which/how many callers exist under src/app) is
// a separate concern.

import { MappingDraftError, type MappingDraftDbError } from './mapping-draft-types';

// ── Physical delete-DRAFT RPC contract (migration 082, SECTION 12) ──────────
// delete_draft_provider_industry_mapping_snapshot(p_snapshot_id UUID,
// p_actor_id UUID) RETURNS void.

export const DELETE_DRAFT_MAPPING_SNAPSHOT_RPC = 'delete_draft_provider_industry_mapping_snapshot';

/** Canonical RAISE EXCEPTION message identities from migration 082 SECTION 12. */
export const DELETE_DRAFT_RPC_RAISE = {
  SNAPSHOT_NOT_FOUND: 'SNAPSHOT_NOT_FOUND',
  SNAPSHOT_NOT_DRAFT: 'SNAPSHOT_NOT_DRAFT',
  DRAFT_AUTHOR_REQUIRED: 'DRAFT_AUTHOR_REQUIRED',
} as const;

// ── Narrow injectable DB/RPC client contract ─────────────────────────────────
// This service calls only .rpc() — it never reads or writes
// provider_industry_mapping_snapshots / _concept_entries / _associations
// through a table chain, so it intentionally does NOT reuse
// MappingDraftDbClient or MappingPublicationDbClient (both expose a from()
// table surface this service must never call). The real Supabase
// service-role client satisfies this shape structurally — the runtime
// boundary factory (mapping-runtime-db-client.ts) casts it with
// `as unknown as MappingDraftDeleteDbClient`. Tests inject hand-written
// fakes; no Supabase network is ever used here.

export type MappingDraftDeleteRpcResult = {
  data: unknown;
  error: MappingDraftDbError | null;
};

export interface MappingDraftDeleteDbClient {
  rpc(fn: string, params: Record<string, unknown>): Promise<MappingDraftDeleteRpcResult>;
}

// ── deleteMappingDraft ────────────────────────────────────────────────────────

export interface DeleteMappingDraftInput {
  snapshotId: string;
  actorId: string;
}

function requireNonEmptyString(value: string, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(`${field} is required and must be a non-empty string.`);
  }
  return trimmed;
}

function mapDeleteDraftRpcError(error: MappingDraftDbError): MappingDraftError {
  const message = (error.message ?? '').trim();

  if (message.includes(DELETE_DRAFT_RPC_RAISE.SNAPSHOT_NOT_FOUND)) {
    return new MappingDraftError('MAPPING_SNAPSHOT_NOT_FOUND', 'Mapping snapshot not found.', error);
  }
  if (message.includes(DELETE_DRAFT_RPC_RAISE.SNAPSHOT_NOT_DRAFT)) {
    return new MappingDraftError(
      'MAPPING_SNAPSHOT_NOT_DRAFT',
      'Mapping snapshot is not in draft status.',
      error,
    );
  }
  if (message.includes(DELETE_DRAFT_RPC_RAISE.DRAFT_AUTHOR_REQUIRED)) {
    return new MappingDraftError(
      'MAPPING_DRAFT_AUTHOR_REQUIRED',
      'Only the snapshot author may delete this draft.',
      error,
    );
  }

  // Unknown/unexpected RPC failure: the public message must stay stable and
  // must never interpolate the raw physical error text (Postgres message,
  // SQLSTATE, constraint detail/hint, or RPC payload). The original
  // infrastructure error remains available as `cause` for server-side
  // logging only, same convention as mapPublicationRpcError in
  // mapping-publication-service.ts.
  return new MappingDraftError('MAPPING_DRAFT_WRITE_FAILED', 'Failed to delete mapping draft.', error);
}

/**
 * Deletes a DRAFT provider industry mapping snapshot (and its child concept
 * entries/associations) via the migration 082 delete-DRAFT RPC. The caller
 * supplies snapshotId and a trusted actorId — this service never issues a
 * direct table DELETE and never performs a separate pre-delete child
 * cleanup; the RPC owns the transactional child/snapshot deletion order and
 * remains the race-safe lifecycle authority (it re-locks and revalidates
 * snapshot existence, DRAFT status, and author ownership itself).
 */
export async function deleteMappingDraft(
  db: MappingDraftDeleteDbClient,
  input: DeleteMappingDraftInput,
): Promise<void> {
  const snapshotId = requireNonEmptyString(input.snapshotId, 'snapshotId');
  const actorId = requireNonEmptyString(input.actorId, 'actorId');

  const { error } = await db.rpc(DELETE_DRAFT_MAPPING_SNAPSHOT_RPC, {
    p_snapshot_id: snapshotId,
    p_actor_id: actorId,
  });

  if (error) {
    throw mapDeleteDraftRpcError(error);
  }
}
