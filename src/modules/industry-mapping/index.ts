// ── Public API — Provider Industry Mapping DRAFT Domain Service (Q3F-5AI) ───
// Publication, pre-publication validation, LOAD1/LOAD2, runtime activation of
// migration 082, Agent 1 integration, and provider calls are explicitly out
// of scope for this service.

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
