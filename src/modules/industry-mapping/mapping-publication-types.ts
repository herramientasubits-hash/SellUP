// mapping-publication-types.ts — Provider Industry Mapping Publication Domain
// Service (Q3F-5AJ). Injectable DB/RPC client contract and the structured
// validation-failure error. Row shapes for snapshots/concept
// entries/associations are reused from mapping-draft-types.ts (SnapshotRow,
// ConceptEntryRow, AssociationRow) — not duplicated here.

import {
  MappingDraftError,
  type MappingDraftDbError,
} from './mapping-draft-types';
import type { MappingPublicationValidationIssue } from './mapping-publication-validator';

// ── Table identity (industries — migration 057, read-only from this service) ──

export const INDUSTRIES_TABLE = 'industries';

// ── Physical publication RPC contract (migration 082, SECTION 10) ───────────
// publish_provider_industry_mapping_snapshot(p_snapshot_id UUID, p_publisher_id
// UUID, p_expected_content_revision BIGINT) RETURNS void.

export const PUBLISH_MAPPING_SNAPSHOT_RPC = 'publish_provider_industry_mapping_snapshot';

/** Canonical RAISE EXCEPTION message identities from migration 082 SECTION 10. */
export const PUBLICATION_RPC_RAISE = {
  SNAPSHOT_NOT_FOUND: 'SNAPSHOT_NOT_FOUND',
  VOCABULARY_NOT_REGISTERED: 'VOCABULARY_NOT_REGISTERED',
  VOCABULARY_DEPRECATED: 'VOCABULARY_DEPRECATED',
  SNAPSHOT_SCOPE_INTEGRITY_ERROR: 'SNAPSHOT_SCOPE_INTEGRITY_ERROR',
  SNAPSHOT_NOT_DRAFT: 'SNAPSHOT_NOT_DRAFT',
  PUBLISHER_REQUIRED: 'PUBLISHER_REQUIRED',
  SELF_APPROVAL_FORBIDDEN: 'SELF_APPROVAL_FORBIDDEN',
  VERSION_LABEL_REQUIRED: 'VERSION_LABEL_REQUIRED',
  CHANGE_REASON_REQUIRED: 'CHANGE_REASON_REQUIRED',
  DRAFT_CONTENT_CHANGED_AFTER_VALIDATION: 'DRAFT_CONTENT_CHANGED_AFTER_VALIDATION',
} as const;

// ── Injectable DB/RPC client contract ────────────────────────────────────────
// Minimal structural surface actually used by the publication service: a
// list-capable select().eq() chain (thenable, matching the real
// @supabase/supabase-js PostgrestFilterBuilder, which resolves to
// {data, error} when awaited directly), a .maybeSingle() terminal for
// single-row loads, and .rpc(). The real Supabase client satisfies this
// structurally — call sites outside this module cast it with
// `as unknown as MappingPublicationDbClient` (same convention as
// MappingDraftDbClient / IdempotencyDbClient). Tests inject hand-written
// fakes; no Supabase network is ever used here.

export type MappingPublicationListResult = {
  data: Record<string, unknown>[] | null;
  error: MappingDraftDbError | null;
};

export type MappingPublicationRowResult = {
  data: Record<string, unknown> | null;
  error: MappingDraftDbError | null;
};

export interface MappingPublicationSelectChain extends PromiseLike<MappingPublicationListResult> {
  eq(column: string, value: string): MappingPublicationSelectChain;
  maybeSingle(): Promise<MappingPublicationRowResult>;
}

export interface MappingPublicationTableClient {
  select(columns: string): MappingPublicationSelectChain;
}

export type MappingPublicationRpcResult = {
  data: unknown;
  error: MappingDraftDbError | null;
};

export interface MappingPublicationDbClient {
  from(table: string): MappingPublicationTableClient;
  rpc(fn: string, params: Record<string, unknown>): Promise<MappingPublicationRpcResult>;
}

// ── Structured validation-failure error ──────────────────────────────────────
// Carries the full typed validator result — issues are never flattened into
// one English string.

export class MappingPublicationValidationError extends MappingDraftError {
  constructor(
    message: string,
    public readonly issues: readonly MappingPublicationValidationIssue[],
  ) {
    super('MAPPING_PUBLICATION_VALIDATION_FAILED', message);
    this.name = 'MappingPublicationValidationError';
  }
}
