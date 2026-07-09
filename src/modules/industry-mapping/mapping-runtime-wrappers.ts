// mapping-runtime-wrappers.ts — Provider Industry Mapping Server-Only
// Application Boundary (Q3F-5AN.1).
//
// Injectable wrapper core: each function resolves the trusted internal actor
// from an injected auth session client, then calls the existing DRAFT/
// publication/loader domain services (Q3F-5AI/Q3F-5AJ/Q3F-5AK) with an
// injected DB client. This split (authClient/db passed in, rather than
// constructed here) is what makes this file offline-testable with hand-
// written fakes — same DI convention as the domain services themselves and
// as contact-enrichment/candidate-review-core.ts. server.ts is the thin
// production wiring that supplies the real Supabase clients.
//
// Actor-surface hardening: every function below reads only explicitly named
// fields off `input` — it never spreads the raw input object. A runtime
// caller that attaches actorId/createdByActorId/publisherActorId to `input`
// (bypassing the TypeScript `Omit<...>` input types with `as any`) cannot
// influence what is sent to the domain service, because those fields are
// never read from `input` in the first place.

import {
  resolveTrustedIndustryMappingActor,
  type IndustryMappingAuthSessionClient,
} from './mapping-runtime-actor';

import {
  createMappingDraft,
  updateMappingDraftMetadata,
  type CreateMappingDraftInput,
  type UpdateMappingDraftMetadataInput,
} from './mapping-draft-snapshot-service';
import {
  addConceptEntry,
  updateConceptEntryRawLabel,
  removeConceptEntry,
  type AddConceptEntryInput,
  type UpdateConceptEntryRawLabelInput,
  type RemoveConceptEntryInput,
} from './mapping-draft-concept-service';
import {
  addMappingAssociation,
  updateMappingAssociation,
  removeMappingAssociation,
  type AddMappingAssociationInput,
  type UpdateMappingAssociationInput,
  type RemoveMappingAssociationInput,
} from './mapping-draft-association-service';
import {
  publishMappingSnapshot,
  type PublishMappingSnapshotInput,
  type PublishMappingSnapshotResult,
} from './mapping-publication-service';
import {
  deleteMappingDraft,
  type DeleteMappingDraftInput,
  type MappingDraftDeleteDbClient,
} from './mapping-draft-delete-service';
import {
  loadPublishedIndustryMappingSnapshot,
  type LoadPublishedIndustryMappingSnapshotInput,
} from './mapping-snapshot-load1';
import {
  loadHistoricalIndustryMappingSnapshot,
  type LoadHistoricalIndustryMappingSnapshotInput,
} from './mapping-snapshot-load2';

import type {
  MappingDraftDbClient,
  MappingSnapshot,
  MappingConceptEntry,
  MappingAssociation,
} from './mapping-draft-types';
import type { MappingPublicationDbClient } from './mapping-publication-types';
import type {
  MappingSnapshotLoadDbClient,
  IndustryProviderMappingSnapshot,
} from './mapping-snapshot-load-types';

// ── Snapshot-level DRAFT mutations ──────────────────────────────────────────

export type CreateMappingDraftForActorInput = Omit<CreateMappingDraftInput, 'createdByActorId'>;

/** Creates a DRAFT mapping snapshot authored by the resolved actor. */
export async function createMappingDraftForActor(
  authClient: IndustryMappingAuthSessionClient,
  db: MappingDraftDbClient,
  input: CreateMappingDraftForActorInput,
): Promise<MappingSnapshot> {
  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);
  return createMappingDraft(db, {
    sourceVocabularyKey: input.sourceVocabularyKey,
    catalogVersionId: input.catalogVersionId,
    createdByActorId: internalUserId,
    versionLabel: input.versionLabel,
    changeReason: input.changeReason,
  });
}

export type UpdateMappingDraftMetadataForActorInput = Omit<UpdateMappingDraftMetadataInput, 'actorId'>;

/** Updates DRAFT metadata as the resolved actor. */
export async function updateMappingDraftMetadataForActor(
  authClient: IndustryMappingAuthSessionClient,
  db: MappingDraftDbClient,
  input: UpdateMappingDraftMetadataForActorInput,
): Promise<MappingSnapshot> {
  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);

  // Explicit hasOwnProperty-preserving copy: an omitted key must remain
  // omitted so the domain service's "leave column untouched" semantics are
  // preserved — a direct `versionLabel: input.versionLabel` copy would
  // always set the key (even to `undefined`), which the domain service
  // reads via hasOwnProperty, not `!== undefined`.
  const domainInput: UpdateMappingDraftMetadataInput = {
    snapshotId: input.snapshotId,
    actorId: internalUserId,
  };
  if (Object.prototype.hasOwnProperty.call(input, 'versionLabel')) {
    domainInput.versionLabel = input.versionLabel;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'changeReason')) {
    domainInput.changeReason = input.changeReason;
  }

  return updateMappingDraftMetadata(db, domainInput);
}

// ── Concept-entry DRAFT mutations ───────────────────────────────────────────

export type AddConceptEntryForActorInput = Omit<AddConceptEntryInput, 'actorId'>;

/** Adds a concept entry to an owned DRAFT as the resolved actor. */
export async function addConceptEntryForActor(
  authClient: IndustryMappingAuthSessionClient,
  db: MappingDraftDbClient,
  input: AddConceptEntryForActorInput,
): Promise<MappingConceptEntry> {
  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);
  return addConceptEntry(db, {
    snapshotId: input.snapshotId,
    actorId: internalUserId,
    rawLabel: input.rawLabel,
  });
}

export type UpdateConceptEntryRawLabelForActorInput = Omit<UpdateConceptEntryRawLabelInput, 'actorId'>;

/** Updates a concept entry's raw label as the resolved actor. */
export async function updateConceptEntryRawLabelForActor(
  authClient: IndustryMappingAuthSessionClient,
  db: MappingDraftDbClient,
  input: UpdateConceptEntryRawLabelForActorInput,
): Promise<MappingConceptEntry> {
  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);
  return updateConceptEntryRawLabel(db, {
    conceptEntryId: input.conceptEntryId,
    actorId: internalUserId,
    newRawLabel: input.newRawLabel,
  });
}

export type RemoveConceptEntryForActorInput = Omit<RemoveConceptEntryInput, 'actorId'>;

/** Removes a concept entry from an owned DRAFT as the resolved actor. */
export async function removeConceptEntryForActor(
  authClient: IndustryMappingAuthSessionClient,
  db: MappingDraftDbClient,
  input: RemoveConceptEntryForActorInput,
): Promise<void> {
  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);
  return removeConceptEntry(db, {
    conceptEntryId: input.conceptEntryId,
    actorId: internalUserId,
  });
}

// ── Association DRAFT mutations ─────────────────────────────────────────────

export type AddMappingAssociationForActorInput = Omit<AddMappingAssociationInput, 'actorId'>;

/** Adds a mapping association as the resolved actor. */
export async function addMappingAssociationForActor(
  authClient: IndustryMappingAuthSessionClient,
  db: MappingDraftDbClient,
  input: AddMappingAssociationForActorInput,
): Promise<MappingAssociation> {
  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);
  return addMappingAssociation(db, {
    snapshotId: input.snapshotId,
    conceptEntryId: input.conceptEntryId,
    actorId: internalUserId,
    industryId: input.industryId,
    catalogVersionId: input.catalogVersionId,
    relationSemantics: input.relationSemantics,
  });
}

export type UpdateMappingAssociationForActorInput = Omit<UpdateMappingAssociationInput, 'actorId'>;

/** Updates a mapping association as the resolved actor. */
export async function updateMappingAssociationForActor(
  authClient: IndustryMappingAuthSessionClient,
  db: MappingDraftDbClient,
  input: UpdateMappingAssociationForActorInput,
): Promise<MappingAssociation> {
  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);

  const domainInput: UpdateMappingAssociationInput = {
    associationId: input.associationId,
    actorId: internalUserId,
  };
  if (Object.prototype.hasOwnProperty.call(input, 'industryId')) {
    domainInput.industryId = input.industryId;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'catalogVersionId')) {
    domainInput.catalogVersionId = input.catalogVersionId;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'relationSemantics')) {
    domainInput.relationSemantics = input.relationSemantics;
  }

  return updateMappingAssociation(db, domainInput);
}

export type RemoveMappingAssociationForActorInput = Omit<RemoveMappingAssociationInput, 'actorId'>;

/** Removes a mapping association as the resolved actor. */
export async function removeMappingAssociationForActor(
  authClient: IndustryMappingAuthSessionClient,
  db: MappingDraftDbClient,
  input: RemoveMappingAssociationForActorInput,
): Promise<void> {
  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);
  return removeMappingAssociation(db, {
    associationId: input.associationId,
    actorId: internalUserId,
  });
}

// ── Publication ──────────────────────────────────────────────────────────────

export type PublishMappingSnapshotForActorInput = Omit<PublishMappingSnapshotInput, 'publisherActorId'>;

/** Publishes a DRAFT mapping snapshot with the resolved actor as publisher. */
export async function publishMappingSnapshotForActor(
  authClient: IndustryMappingAuthSessionClient,
  db: MappingPublicationDbClient,
  input: PublishMappingSnapshotForActorInput,
): Promise<PublishMappingSnapshotResult> {
  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);
  return publishMappingSnapshot(db, {
    snapshotId: input.snapshotId,
    publisherActorId: internalUserId,
  });
}

// ── DRAFT deletion (Q3F-5AR.0) ──────────────────────────────────────────────
// No archive wrapper exists and none is added here (RB19). This wrapper
// calls only the delete-DRAFT domain service/RPC path — never the archive or
// publish RPC.

export type DeleteMappingDraftForActorInput = Omit<DeleteMappingDraftInput, 'actorId'>;

/** Deletes a DRAFT mapping snapshot as the resolved actor. */
export async function deleteMappingDraftForActor(
  authClient: IndustryMappingAuthSessionClient,
  db: MappingDraftDeleteDbClient,
  input: DeleteMappingDraftForActorInput,
): Promise<void> {
  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);
  return deleteMappingDraft(db, {
    snapshotId: input.snapshotId,
    actorId: internalUserId,
  });
}

// ── Loaders (no actor identity required — RB17) ─────────────────────────────
// These intentionally take no authClient: LOAD1/LOAD2 do not resolve actor
// identity, perform no provider/AI calls, and only forward the exact loader
// input to the service-role-backed domain loader.

/** Loads the current published mapping snapshot for a scope. */
export async function loadPublishedIndustryMappingSnapshotForRuntime(
  db: MappingSnapshotLoadDbClient,
  input: LoadPublishedIndustryMappingSnapshotInput,
): Promise<IndustryProviderMappingSnapshot> {
  return loadPublishedIndustryMappingSnapshot(db, input);
}

/** Loads an exact historical mapping snapshot by id. */
export async function loadHistoricalIndustryMappingSnapshotForRuntime(
  db: MappingSnapshotLoadDbClient,
  input: LoadHistoricalIndustryMappingSnapshotInput,
): Promise<IndustryProviderMappingSnapshot> {
  return loadHistoricalIndustryMappingSnapshot(db, input);
}
