// server.ts — Provider Industry Mapping Server-Only Application Boundary
// (Q3F-5AN.1).
//
// Public entry point for the industry-mapping application boundary. This
// file is intentionally thin: it wires the real authenticated Supabase
// server client (session/actor resolution only) and the real service-role
// Supabase client (all domain DB/RPC calls) into the injectable wrapper
// core in mapping-runtime-wrappers.ts, which carries the actual actor-
// injection and actor-surface-hardening logic and is what the offline test
// suite exercises directly via dependency injection.
//
// Runtime actor model: ACTOR_B — INTERNAL_USER_RESOLVED. The domain services
// underneath remain ACTOR_C — TRUSTED_APPLICATION_ARGUMENT; this file (via
// mapping-runtime-wrappers.ts) is the only trusted caller allowed to supply
// that argument, and it always derives it from the authenticated session,
// never from caller input.
//
// Not a transport boundary: no 'use server', no route handler, no page. Only
// import this file from other server-only code — it transitively reads
// SUPABASE_SERVICE_ROLE_KEY and uses next/headers-based cookie access, both
// of which are unavailable/inert in a client bundle.

import { createClient } from '@/lib/supabase/server';
import type { IndustryMappingAuthSessionClient } from './mapping-runtime-actor';
import {
  createIndustryMappingDraftDbClient,
  createIndustryMappingPublicationDbClient,
  createIndustryMappingSnapshotLoadDbClient,
} from './mapping-runtime-db-client';
import {
  createMappingDraftForActor,
  updateMappingDraftMetadataForActor,
  addConceptEntryForActor,
  updateConceptEntryRawLabelForActor,
  removeConceptEntryForActor,
  addMappingAssociationForActor,
  updateMappingAssociationForActor,
  removeMappingAssociationForActor,
  publishMappingSnapshotForActor,
  loadPublishedIndustryMappingSnapshotForRuntime,
  loadHistoricalIndustryMappingSnapshotForRuntime,
  type CreateMappingDraftForActorInput,
  type UpdateMappingDraftMetadataForActorInput,
  type AddConceptEntryForActorInput,
  type UpdateConceptEntryRawLabelForActorInput,
  type RemoveConceptEntryForActorInput,
  type AddMappingAssociationForActorInput,
  type UpdateMappingAssociationForActorInput,
  type RemoveMappingAssociationForActorInput,
  type PublishMappingSnapshotForActorInput,
} from './mapping-runtime-wrappers';

import type { MappingSnapshot, MappingConceptEntry, MappingAssociation } from './mapping-draft-types';
import type { PublishMappingSnapshotResult } from './mapping-publication-service';
import type { LoadPublishedIndustryMappingSnapshotInput } from './mapping-snapshot-load1';
import type { LoadHistoricalIndustryMappingSnapshotInput } from './mapping-snapshot-load2';
import type { IndustryProviderMappingSnapshot } from './mapping-snapshot-load-types';

/** Resolves the current authenticated Supabase server client for actor resolution only. */
async function currentAuthClient(): Promise<IndustryMappingAuthSessionClient> {
  const supabase = await createClient();
  return supabase as unknown as IndustryMappingAuthSessionClient;
}

// ── Snapshot-level DRAFT mutations ──────────────────────────────────────────

export type CreateMappingDraftForCurrentActorInput = CreateMappingDraftForActorInput;

/** Creates a DRAFT mapping snapshot authored by the current actor. Service-role DB client. */
export async function createMappingDraftForCurrentActor(
  input: CreateMappingDraftForCurrentActorInput,
): Promise<MappingSnapshot> {
  const authClient = await currentAuthClient();
  const db = createIndustryMappingDraftDbClient();
  return createMappingDraftForActor(authClient, db, input);
}

export type UpdateMappingDraftMetadataForCurrentActorInput = UpdateMappingDraftMetadataForActorInput;

/** Updates DRAFT metadata as the current actor. Service-role DB client. */
export async function updateMappingDraftMetadataForCurrentActor(
  input: UpdateMappingDraftMetadataForCurrentActorInput,
): Promise<MappingSnapshot> {
  const authClient = await currentAuthClient();
  const db = createIndustryMappingDraftDbClient();
  return updateMappingDraftMetadataForActor(authClient, db, input);
}

// ── Concept-entry DRAFT mutations ───────────────────────────────────────────

export type AddConceptEntryForCurrentActorInput = AddConceptEntryForActorInput;

/** Adds a concept entry to an owned DRAFT as the current actor. Service-role DB client. */
export async function addConceptEntryForCurrentActor(
  input: AddConceptEntryForCurrentActorInput,
): Promise<MappingConceptEntry> {
  const authClient = await currentAuthClient();
  const db = createIndustryMappingDraftDbClient();
  return addConceptEntryForActor(authClient, db, input);
}

export type UpdateConceptEntryRawLabelForCurrentActorInput = UpdateConceptEntryRawLabelForActorInput;

/** Updates a concept entry's raw label as the current actor. Service-role DB client. */
export async function updateConceptEntryRawLabelForCurrentActor(
  input: UpdateConceptEntryRawLabelForCurrentActorInput,
): Promise<MappingConceptEntry> {
  const authClient = await currentAuthClient();
  const db = createIndustryMappingDraftDbClient();
  return updateConceptEntryRawLabelForActor(authClient, db, input);
}

export type RemoveConceptEntryForCurrentActorInput = RemoveConceptEntryForActorInput;

/** Removes a concept entry from an owned DRAFT as the current actor. Service-role DB client. */
export async function removeConceptEntryForCurrentActor(
  input: RemoveConceptEntryForCurrentActorInput,
): Promise<void> {
  const authClient = await currentAuthClient();
  const db = createIndustryMappingDraftDbClient();
  return removeConceptEntryForActor(authClient, db, input);
}

// ── Association DRAFT mutations ─────────────────────────────────────────────

export type AddMappingAssociationForCurrentActorInput = AddMappingAssociationForActorInput;

/** Adds a mapping association as the current actor. Service-role DB client. */
export async function addMappingAssociationForCurrentActor(
  input: AddMappingAssociationForCurrentActorInput,
): Promise<MappingAssociation> {
  const authClient = await currentAuthClient();
  const db = createIndustryMappingDraftDbClient();
  return addMappingAssociationForActor(authClient, db, input);
}

export type UpdateMappingAssociationForCurrentActorInput = UpdateMappingAssociationForActorInput;

/** Updates a mapping association as the current actor. Service-role DB client. */
export async function updateMappingAssociationForCurrentActor(
  input: UpdateMappingAssociationForCurrentActorInput,
): Promise<MappingAssociation> {
  const authClient = await currentAuthClient();
  const db = createIndustryMappingDraftDbClient();
  return updateMappingAssociationForActor(authClient, db, input);
}

export type RemoveMappingAssociationForCurrentActorInput = RemoveMappingAssociationForActorInput;

/** Removes a mapping association as the current actor. Service-role DB client. */
export async function removeMappingAssociationForCurrentActor(
  input: RemoveMappingAssociationForCurrentActorInput,
): Promise<void> {
  const authClient = await currentAuthClient();
  const db = createIndustryMappingDraftDbClient();
  return removeMappingAssociationForActor(authClient, db, input);
}

// ── Publication ──────────────────────────────────────────────────────────────

export type PublishMappingSnapshotForCurrentActorInput = PublishMappingSnapshotForActorInput;

/** Publishes a DRAFT mapping snapshot with the current actor as publisher. Service-role DB client. */
export async function publishMappingSnapshotForCurrentActor(
  input: PublishMappingSnapshotForCurrentActorInput,
): Promise<PublishMappingSnapshotResult> {
  const authClient = await currentAuthClient();
  const db = createIndustryMappingPublicationDbClient();
  return publishMappingSnapshotForActor(authClient, db, input);
}

// ── Loaders (no actor identity required) ────────────────────────────────────

/** Loads the current published mapping snapshot for a scope. Service-role DB client; no actor resolution. */
export async function loadPublishedIndustryMappingSnapshot(
  input: LoadPublishedIndustryMappingSnapshotInput,
): Promise<IndustryProviderMappingSnapshot> {
  const db = createIndustryMappingSnapshotLoadDbClient();
  return loadPublishedIndustryMappingSnapshotForRuntime(db, input);
}

/** Loads an exact historical mapping snapshot by id. Service-role DB client; no actor resolution. */
export async function loadHistoricalIndustryMappingSnapshot(
  input: LoadHistoricalIndustryMappingSnapshotInput,
): Promise<IndustryProviderMappingSnapshot> {
  const db = createIndustryMappingSnapshotLoadDbClient();
  return loadHistoricalIndustryMappingSnapshotForRuntime(db, input);
}
