// ── Public API — Provider Industry Mapping DRAFT + Publication Domain
// Services (Q3F-5AI + Q3F-5AJ) ───────────────────────────────────────────────
// LOAD1/LOAD2, runtime activation of migration 082, Agent 1 integration, and
// provider calls are explicitly out of scope for these services.

// Types
export type {
  RelationSemantics,
  SnapshotStatus,
  MappingSnapshot,
  MappingConceptEntry,
  MappingAssociation,
  OwnedDraftContext,
  MappingDraftErrorCode,
  MappingDraftDbClient,
  MappingDraftDbError,
} from './mapping-draft-types';
export { MappingDraftError, RELATION_SEMANTICS_VALUES } from './mapping-draft-types';

// Shared DRAFT-author guard (HA1)
export { requireOwnedDraft } from './mapping-draft-guard';
export type { RequireOwnedDraftInput } from './mapping-draft-guard';

// Snapshot-level DRAFT mutations
export { createMappingDraft, updateMappingDraftMetadata } from './mapping-draft-snapshot-service';
export type {
  CreateMappingDraftInput,
  UpdateMappingDraftMetadataInput,
} from './mapping-draft-snapshot-service';

// Concept-entry DRAFT mutations
export {
  addConceptEntry,
  updateConceptEntryRawLabel,
  removeConceptEntry,
} from './mapping-draft-concept-service';
export type {
  AddConceptEntryInput,
  UpdateConceptEntryRawLabelInput,
  RemoveConceptEntryInput,
} from './mapping-draft-concept-service';

// Association DRAFT mutations
export {
  addMappingAssociation,
  updateMappingAssociation,
  removeMappingAssociation,
} from './mapping-draft-association-service';
export type {
  AddMappingAssociationInput,
  UpdateMappingAssociationInput,
  RemoveMappingAssociationInput,
} from './mapping-draft-association-service';

// Pre-publication validator (pure, Q3F-5AJ)
export { validateProviderIndustryMappingForPublication } from './mapping-publication-validator';
export type {
  MappingPublicationValidatorInput,
  MappingPublicationValidationResult,
  MappingPublicationValidationIssue,
  MappingPublicationValidationIssueCode,
  PublicationValidatorSnapshotInput,
  PublicationValidatorConceptEntryInput,
  PublicationValidatorAssociationInput,
  PublicationValidatorCanonicalIndustryInput,
} from './mapping-publication-validator';

// Publication Domain Service (PV1 revision-pin + publication RPC, Q3F-5AJ)
export { publishMappingSnapshot } from './mapping-publication-service';
export type {
  PublishMappingSnapshotInput,
  PublishMappingSnapshotResult,
} from './mapping-publication-service';
export { MappingPublicationValidationError } from './mapping-publication-types';
export type { MappingPublicationDbClient } from './mapping-publication-types';

// Trusted snapshot loaders — LOAD1 + LOAD2 (Q3F-5AK). The canonical resolver
// is NOT implemented by these loaders; they only prove NS1 (the resolver
// never receives a null mapping snapshot).
export { loadPublishedIndustryMappingSnapshot } from './mapping-snapshot-load1';
export type { LoadPublishedIndustryMappingSnapshotInput } from './mapping-snapshot-load1';
export { loadHistoricalIndustryMappingSnapshot } from './mapping-snapshot-load2';
export type { LoadHistoricalIndustryMappingSnapshotInput } from './mapping-snapshot-load2';
export {
  MappingSnapshotLoadError,
  SOURCE_VOCABULARIES_TABLE,
  CATALOG_VERSIONS_TABLE,
} from './mapping-snapshot-load-types';
export type {
  MappingSnapshotLoadErrorCode,
  MappingSnapshotLoadErrorContext,
  MappingSnapshotLoadDbClient,
  IndustryProviderMappingSnapshot,
  MappingSnapshotConceptEntry,
  MappingSnapshotAssociation,
  CanonicalIndustryReference,
} from './mapping-snapshot-load-types';
