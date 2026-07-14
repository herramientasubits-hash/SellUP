// actions.ts — TEMPORARY reversible QA harness for the industry-mapping
// child-graph (Q3F-5AT.2). Delete this whole directory, and the DD-27
// allowlist entry in
// src/modules/industry-mapping/__tests__/mapping-runtime-boundary-wiring.test.ts,
// once live QA validation is complete.
//
// Composes only the existing CurrentActor boundary functions exported from
// src/modules/industry-mapping/server.ts — never a lower-level ForActor
// variant, never a domain service or RPC directly, never a direct table
// write. All reads performed by this file (global baseline counts, marker
// lookup, catalog/target lookup, pre/post verification) are read-only and
// exist only because this harness needs proof shapes (cardinality checks,
// global counts) that the module's own narrow structural DB contracts
// (MappingDraftDbClient etc.) do not expose. No Apollo/provider call, no AI
// call. Produces a SYNTHETIC QA graph only.

import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import {
  resolveTrustedIndustryMappingActor,
  type IndustryMappingAuthSessionClient,
} from '@/modules/industry-mapping/mapping-runtime-actor';
import { IndustryMappingRuntimeBoundaryError } from '@/modules/industry-mapping/mapping-runtime-boundary-types';
import { MappingDraftError } from '@/modules/industry-mapping/mapping-draft-types';
import {
  createMappingDraftForCurrentActor,
  addConceptEntryForCurrentActor,
  addMappingAssociationForCurrentActor,
  deleteMappingDraftForCurrentActor,
} from '@/modules/industry-mapping/server';

const QA_HARNESS_ENV_FLAG = 'ENABLE_INDUSTRY_MAPPING_QA_HARNESS';
const QA_OPERATOR_EMAIL = 'egarcia@ubits.co';
const QA_SOURCE_VOCABULARY_KEY = 'apollo_organization_industry';
const QA_VERSION_LABEL = 'Q3F-5AT-LIVE-QA-SYNTHETIC';
const QA_CANONICAL_INDUSTRY_SLUG = 'tecnologia';
const QA_RELATION_SEMANTICS = 'SOURCE_EQUIVALENT_TO_CANONICAL';

type QaHarnessReadClient = ReturnType<typeof createSupabaseJsClient>;

export interface GlobalBaselineCounts {
  sourceVocabularies: number;
  snapshots: number;
  concepts: number;
  associations: number;
}

const FIXED_PRECONDITION: GlobalBaselineCounts = {
  sourceVocabularies: 1,
  snapshots: 0,
  concepts: 0,
  associations: 0,
};

export interface QaHarnessResult {
  command: 'CREATE_TEST_GRAPH' | 'DELETE_TEST_GRAPH' | 'READ_TEST_STATE';
  success: boolean;
  phase: string;
  snapshotId: string | null;
  graphKind: 'synthetic_qa_graph';
  baselineCounts: GlobalBaselineCounts | null;
  createVerified: boolean | null;
  deleteAttempted: boolean;
  deleteResult: 'success' | 'failed' | 'not_attempted';
  cleanupAttempted: boolean;
  cleanupResult: 'success' | 'failed' | 'not_attempted';
  postDeleteCounts: GlobalBaselineCounts | null;
  baselineRestored: boolean | null;
  conceptCount: number | null;
  associationCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

function emptyResult(command: QaHarnessResult['command']): QaHarnessResult {
  return {
    command,
    success: false,
    phase: 'access_gate',
    snapshotId: null,
    graphKind: 'synthetic_qa_graph',
    baselineCounts: null,
    createVerified: null,
    deleteAttempted: false,
    deleteResult: 'not_attempted',
    cleanupAttempted: false,
    cleanupResult: 'not_attempted',
    postDeleteCounts: null,
    baselineRestored: null,
    conceptCount: null,
    associationCount: null,
    errorCode: null,
    errorMessage: null,
  };
}

// ── Access gate (section 9) ──────────────────────────────────────────────────

export class QaHarnessAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'QaHarnessAccessError';
  }
}

class QaHarnessOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause2?: unknown,
  ) {
    super(message);
    this.name = 'QaHarnessOperationError';
  }
}

export interface QaHarnessActor {
  internalUserId: string;
  email: string;
}

/**
 * Requires: env kill switch === 'true', a real authenticated session, and
 * the resolved active internal user's email === the frozen QA operator
 * email (exact match after trim().toLowerCase()). Reuses
 * resolveTrustedIndustryMappingActor (the module's own strict actor
 * boundary) rather than re-deriving actor identity. No NODE_ENV bypass, no
 * "first active user" fallback, no client-supplied email/actor id.
 */
export async function requireQaHarnessAccess(): Promise<QaHarnessActor> {
  if (process.env[QA_HARNESS_ENV_FLAG] !== 'true') {
    throw new QaHarnessAccessError('HARNESS_DISABLED', 'The QA harness is disabled.');
  }

  const supabase = await createClient();
  const authClient = supabase as unknown as IndustryMappingAuthSessionClient;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new QaHarnessAccessError('AUTHENTICATION_REQUIRED', 'An authenticated session is required.');
  }

  const { internalUserId } = await resolveTrustedIndustryMappingActor(authClient);

  const { data: internalUserRow, error: internalUserError } = await supabase
    .from('internal_users')
    .select('email')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();

  if (internalUserError || !internalUserRow?.email) {
    throw new QaHarnessAccessError(
      'OPERATOR_EMAIL_UNRESOLVED',
      'Unable to resolve the operator email for the authenticated session.',
    );
  }

  const normalizedEmail = String(internalUserRow.email).trim().toLowerCase();
  if (normalizedEmail !== QA_OPERATOR_EMAIL) {
    throw new QaHarnessAccessError('OPERATOR_NOT_AUTHORIZED', 'This QA harness operator is not authorized.');
  }

  return { internalUserId, email: normalizedEmail };
}

function sanitizeError(err: unknown): { code: string; message: string } {
  if (err instanceof QaHarnessAccessError || err instanceof QaHarnessOperationError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof IndustryMappingRuntimeBoundaryError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof MappingDraftError) {
    return { code: err.code, message: err.message };
  }
  console.error('[qa-industry-mapping-child-graph-harness] unexpected error', err);
  return { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' };
}

// ── Read-only harness-local Supabase client (verification/baseline only) ───
// Never used for insert/update/delete/rpc — those always go through the
// existing CurrentActor boundary functions imported above.

function createQaHarnessReadClient(): QaHarnessReadClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new QaHarnessOperationError(
      'SUPABASE_CREDENTIALS_MISSING',
      'Supabase service-role credentials are not configured.',
    );
  }
  return createSupabaseJsClient(url, key);
}

async function countRows(db: QaHarnessReadClient, table: string): Promise<number> {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
  if (error) {
    throw new QaHarnessOperationError('BASELINE_COUNT_FAILED', `Failed to count ${table}.`, error);
  }
  return count ?? 0;
}

async function readGlobalBaselineCounts(db: QaHarnessReadClient): Promise<GlobalBaselineCounts> {
  const [sourceVocabularies, snapshots, concepts, associations] = await Promise.all([
    countRows(db, 'provider_industry_source_vocabularies'),
    countRows(db, 'provider_industry_mapping_snapshots'),
    countRows(db, 'provider_industry_concept_entries'),
    countRows(db, 'provider_industry_mapping_associations'),
  ]);
  return { sourceVocabularies, snapshots, concepts, associations };
}

function countsEqual(a: GlobalBaselineCounts, b: GlobalBaselineCounts): boolean {
  return (
    a.sourceVocabularies === b.sourceVocabularies &&
    a.snapshots === b.snapshots &&
    a.concepts === b.concepts &&
    a.associations === b.associations
  );
}

// ── Marker lookup (sections 7, 15) ──────────────────────────────────────────

type MarkerLookup = { kind: 'none' } | { kind: 'one'; snapshotId: string } | { kind: 'drift'; count: number };

async function findActiveQaGraphMarker(db: QaHarnessReadClient, internalUserId: string): Promise<MarkerLookup> {
  const { data, error } = await db
    .from('provider_industry_mapping_snapshots')
    .select('id')
    .eq('status', 'draft')
    .eq('created_by', internalUserId)
    .eq('source_vocabulary_key', QA_SOURCE_VOCABULARY_KEY)
    .eq('version_label', QA_VERSION_LABEL);

  if (error) {
    throw new QaHarnessOperationError('MARKER_LOOKUP_FAILED', 'Failed to look up the active QA graph marker.', error);
  }

  const rows = (data ?? []) as Array<{ id: string }>;
  if (rows.length === 0) return { kind: 'none' };
  if (rows.length === 1) return { kind: 'one', snapshotId: rows[0].id };
  return { kind: 'drift', count: rows.length };
}

// ── Catalog version + canonical target lookup (sections 10, 11) ────────────

async function resolveCurrentCanonicalCatalogVersionId(db: QaHarnessReadClient): Promise<string> {
  const { data, error } = await db.from('industry_catalog_versions').select('id').eq('status', 'published');

  if (error) {
    throw new QaHarnessOperationError(
      'CATALOG_VERSION_LOOKUP_FAILED',
      'Failed to resolve the published catalog version.',
      error,
    );
  }

  const rows = (data ?? []) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new QaHarnessOperationError('NO_PUBLISHED_CATALOG_VERSION', 'No published industry catalog version exists.');
  }
  if (rows.length > 1) {
    throw new QaHarnessOperationError(
      'CATALOG_VERSION_CARDINALITY_DRIFT',
      'More than one published industry catalog version exists.',
    );
  }
  return rows[0].id;
}

interface CanonicalTarget {
  id: string;
  name: string;
  slug: string;
}

async function resolveCanonicalTarget(db: QaHarnessReadClient, catalogVersionId: string): Promise<CanonicalTarget> {
  const { data, error } = await db
    .from('industries')
    .select('id, name, slug')
    .eq('catalog_version_id', catalogVersionId)
    .eq('slug', QA_CANONICAL_INDUSTRY_SLUG);

  if (error) {
    throw new QaHarnessOperationError('TARGET_LOOKUP_FAILED', 'Failed to resolve the canonical target industry.', error);
  }

  const rows = (data ?? []) as CanonicalTarget[];
  if (rows.length === 0) {
    throw new QaHarnessOperationError(
      'TARGET_NOT_FOUND',
      `No industry found for slug "${QA_CANONICAL_INDUSTRY_SLUG}" in the resolved published catalog version.`,
    );
  }
  if (rows.length > 1) {
    throw new QaHarnessOperationError(
      'TARGET_CARDINALITY_DRIFT',
      `More than one industry found for slug "${QA_CANONICAL_INDUSTRY_SLUG}" in the resolved published catalog version.`,
    );
  }
  return rows[0];
}

// ── Create-graph verification (section 12.M, C1-C7) ─────────────────────────

async function verifyCreatedGraph(
  db: QaHarnessReadClient,
  params: {
    snapshotId: string;
    actorInternalUserId: string;
    catalogVersionId: string;
    conceptId: string;
    associationId: string;
  },
): Promise<boolean> {
  const { data: snapshotData, error: snapshotError } = await db
    .from('provider_industry_mapping_snapshots')
    .select('id, status, created_by, source_vocabulary_key, catalog_version_id')
    .eq('id', params.snapshotId)
    .maybeSingle();

  const snapshot = snapshotData as {
    id: string;
    status: string;
    created_by: string;
    source_vocabulary_key: string;
    catalog_version_id: string;
  } | null;

  if (snapshotError || !snapshot) return false;
  if (snapshot.status !== 'draft') return false;
  if (snapshot.created_by !== params.actorInternalUserId) return false;
  if (snapshot.source_vocabulary_key !== QA_SOURCE_VOCABULARY_KEY) return false;
  if (snapshot.catalog_version_id !== params.catalogVersionId) return false;

  const { data: concepts, error: conceptError } = await db
    .from('provider_industry_concept_entries')
    .select('id')
    .eq('snapshot_id', params.snapshotId);

  if (conceptError) return false;
  const conceptRows = (concepts ?? []) as Array<{ id: string }>;
  if (conceptRows.length !== 1 || conceptRows[0].id !== params.conceptId) return false;

  const { data: associations, error: associationError } = await db
    .from('provider_industry_mapping_associations')
    .select('id')
    .eq('concept_entry_id', params.conceptId);

  if (associationError) return false;
  const associationRows = (associations ?? []) as Array<{ id: string }>;
  if (associationRows.length !== 1 || associationRows[0].id !== params.associationId) return false;

  return true;
}

// ── CREATE_TEST_GRAPH (section 12) ──────────────────────────────────────────

export async function createTestGraph(): Promise<QaHarnessResult> {
  const result = emptyResult('CREATE_TEST_GRAPH');

  let actor: QaHarnessActor;
  try {
    actor = await requireQaHarnessAccess();
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'access_gate', errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  const db = createQaHarnessReadClient();

  let baseline: GlobalBaselineCounts;
  try {
    baseline = await readGlobalBaselineCounts(db);
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'read_baseline', errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  if (!countsEqual(baseline, FIXED_PRECONDITION)) {
    return {
      ...result,
      phase: 'precondition_check',
      baselineCounts: baseline,
      errorCode: 'PRECONDITION_NOT_1_0_0_0',
      errorMessage: 'Global baseline counts are not the required 1/0/0/0 precondition.',
    };
  }

  let marker: MarkerLookup;
  try {
    marker = await findActiveQaGraphMarker(db, actor.internalUserId);
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'marker_lookup', baselineCounts: baseline, errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  if (marker.kind === 'one') {
    return {
      ...result,
      phase: 'marker_lookup',
      snapshotId: marker.snapshotId,
      baselineCounts: baseline,
      errorCode: 'ACTIVE_QA_GRAPH_EXISTS',
      errorMessage: 'An active QA graph already exists for this actor; delete it first.',
    };
  }
  if (marker.kind === 'drift') {
    return {
      ...result,
      phase: 'marker_lookup',
      baselineCounts: baseline,
      errorCode: 'QA_GRAPH_CARDINALITY_DRIFT',
      errorMessage: `Found ${marker.count} matching QA graphs for this actor; expected 0 or 1.`,
    };
  }

  let catalogVersionId: string;
  let industry: CanonicalTarget;
  try {
    catalogVersionId = await resolveCurrentCanonicalCatalogVersionId(db);
    industry = await resolveCanonicalTarget(db, catalogVersionId);
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'catalog_or_target_lookup', baselineCounts: baseline, errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  let snapshotId: string;
  try {
    const snapshot = await createMappingDraftForCurrentActor({
      sourceVocabularyKey: QA_SOURCE_VOCABULARY_KEY,
      catalogVersionId,
      versionLabel: QA_VERSION_LABEL,
      changeReason: null,
    });
    snapshotId = snapshot.id;
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'create_snapshot', baselineCounts: baseline, errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  // From this point a failure triggers exactly one automatic cleanup attempt
  // (section 13) because a snapshot row now exists.
  try {
    const concept = await addConceptEntryForCurrentActor({ snapshotId, rawLabel: industry.name });
    const association = await addMappingAssociationForCurrentActor({
      snapshotId,
      conceptEntryId: concept.id,
      industryId: industry.id,
      catalogVersionId,
      relationSemantics: QA_RELATION_SEMANTICS,
    });

    const verified = await verifyCreatedGraph(db, {
      snapshotId,
      actorInternalUserId: actor.internalUserId,
      catalogVersionId,
      conceptId: concept.id,
      associationId: association.id,
    });

    if (!verified) {
      throw new QaHarnessOperationError('CREATE_VERIFICATION_FAILED', 'Post-create verification (C1-C7) failed.');
    }

    return {
      ...result,
      success: true,
      phase: 'complete',
      snapshotId,
      baselineCounts: baseline,
      createVerified: true,
    };
  } catch (err) {
    let cleanupResult: QaHarnessResult['cleanupResult'] = 'failed';
    try {
      await deleteMappingDraftForCurrentActor({ snapshotId });
      cleanupResult = 'success';
    } catch (cleanupErr) {
      console.error('[qa-industry-mapping-child-graph-harness] cleanup attempt failed', cleanupErr);
      cleanupResult = 'failed';
    }

    const sanitized = sanitizeError(err);
    return {
      ...result,
      phase: 'create_children_or_verify',
      snapshotId,
      baselineCounts: baseline,
      createVerified: false,
      cleanupAttempted: true,
      cleanupResult,
      errorCode: sanitized.code,
      errorMessage: sanitized.message,
    };
  }
}

// ── DELETE_TEST_GRAPH (section 14) ──────────────────────────────────────────

async function verifyOwnedQaGraph(
  db: QaHarnessReadClient,
  snapshotId: string,
  internalUserId: string,
): Promise<boolean> {
  const { data: rowData, error } = await db
    .from('provider_industry_mapping_snapshots')
    .select('id, status, created_by, source_vocabulary_key, version_label')
    .eq('id', snapshotId)
    .maybeSingle();

  const data = rowData as {
    id: string;
    status: string;
    created_by: string;
    source_vocabulary_key: string;
    version_label: string | null;
  } | null;

  if (error || !data) return false;
  if (data.status !== 'draft') return false;
  if (data.created_by !== internalUserId) return false;
  if (data.source_vocabulary_key !== QA_SOURCE_VOCABULARY_KEY) return false;
  if (data.version_label !== QA_VERSION_LABEL) return false;
  return true;
}

async function captureConceptIdsForSnapshot(db: QaHarnessReadClient, snapshotId: string): Promise<string[]> {
  const { data, error } = await db.from('provider_industry_concept_entries').select('id').eq('snapshot_id', snapshotId);
  if (error) {
    throw new QaHarnessOperationError('PRE_DELETE_CAPTURE_FAILED', 'Failed to capture concept identities before delete.', error);
  }
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

async function verifyDeletedGraph(
  db: QaHarnessReadClient,
  snapshotId: string,
  preDeleteConceptIds: string[],
): Promise<{ ok: boolean; postCounts: GlobalBaselineCounts; baselineRestored: boolean }> {
  const { data: snapshot } = await db
    .from('provider_industry_mapping_snapshots')
    .select('id')
    .eq('id', snapshotId)
    .maybeSingle();
  const snapshotAbsent = !snapshot;

  const { data: concepts } = await db.from('provider_industry_concept_entries').select('id').eq('snapshot_id', snapshotId);
  const zeroConcepts = (concepts ?? []).length === 0;

  let zeroAssociations = true;
  if (preDeleteConceptIds.length > 0) {
    const { data: associations } = await db
      .from('provider_industry_mapping_associations')
      .select('id')
      .in('concept_entry_id', preDeleteConceptIds);
    zeroAssociations = (associations ?? []).length === 0;
  }

  const postCounts = await readGlobalBaselineCounts(db);
  const baselineRestored = countsEqual(postCounts, FIXED_PRECONDITION);

  return { ok: snapshotAbsent && zeroConcepts && zeroAssociations && baselineRestored, postCounts, baselineRestored };
}

export async function deleteTestGraph(snapshotId: string): Promise<QaHarnessResult> {
  const result = emptyResult('DELETE_TEST_GRAPH');

  if (typeof snapshotId !== 'string' || snapshotId.trim().length === 0) {
    return { ...result, phase: 'input_validation', errorCode: 'INVALID_SNAPSHOT_ID', errorMessage: 'snapshotId must be a non-empty string.' };
  }

  let actor: QaHarnessActor;
  try {
    actor = await requireQaHarnessAccess();
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'access_gate', errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  const db = createQaHarnessReadClient();

  let capturedBaseline: GlobalBaselineCounts;
  try {
    capturedBaseline = await readGlobalBaselineCounts(db);
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'read_baseline', snapshotId, errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  const owned = await verifyOwnedQaGraph(db, snapshotId, actor.internalUserId);
  if (!owned) {
    return {
      ...result,
      phase: 'ownership_verification',
      snapshotId,
      baselineCounts: capturedBaseline,
      errorCode: 'MARKER_MISMATCH',
      errorMessage: 'snapshotId is not this actor’s active QA graph; refusing to delete.',
    };
  }

  let preDeleteConceptIds: string[];
  try {
    preDeleteConceptIds = await captureConceptIdsForSnapshot(db, snapshotId);
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'pre_delete_capture', snapshotId, baselineCounts: capturedBaseline, errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  try {
    await deleteMappingDraftForCurrentActor({ snapshotId });
  } catch (err) {
    const sanitized = sanitizeError(err);
    return {
      ...result,
      phase: 'delete_rpc',
      snapshotId,
      baselineCounts: capturedBaseline,
      deleteAttempted: true,
      deleteResult: 'failed',
      errorCode: sanitized.code,
      errorMessage: sanitized.message,
    };
  }

  const verification = await verifyDeletedGraph(db, snapshotId, preDeleteConceptIds);

  return {
    ...result,
    success: verification.ok,
    phase: 'complete',
    snapshotId,
    baselineCounts: capturedBaseline,
    deleteAttempted: true,
    deleteResult: 'success',
    postDeleteCounts: verification.postCounts,
    baselineRestored: verification.baselineRestored,
    errorCode: verification.ok ? null : 'POST_DELETE_VERIFICATION_MISMATCH',
    errorMessage: verification.ok ? null : 'Post-delete state did not match the expected reversed baseline.',
  };
}

// ── READ_TEST_STATE (section 15) ────────────────────────────────────────────

export async function readTestState(): Promise<QaHarnessResult> {
  const result = emptyResult('READ_TEST_STATE');

  let actor: QaHarnessActor;
  try {
    actor = await requireQaHarnessAccess();
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'access_gate', errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  const db = createQaHarnessReadClient();

  let baseline: GlobalBaselineCounts;
  try {
    baseline = await readGlobalBaselineCounts(db);
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'read_baseline', errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  let marker: MarkerLookup;
  try {
    marker = await findActiveQaGraphMarker(db, actor.internalUserId);
  } catch (err) {
    const sanitized = sanitizeError(err);
    return { ...result, phase: 'marker_lookup', baselineCounts: baseline, errorCode: sanitized.code, errorMessage: sanitized.message };
  }

  if (marker.kind === 'drift') {
    return {
      ...result,
      phase: 'marker_lookup',
      baselineCounts: baseline,
      errorCode: 'QA_GRAPH_CARDINALITY_DRIFT',
      errorMessage: `Found ${marker.count} matching QA graphs for this actor; expected 0 or 1.`,
    };
  }

  if (marker.kind === 'none') {
    return { ...result, success: true, phase: 'complete', baselineCounts: baseline };
  }

  const { data: concepts } = await db.from('provider_industry_concept_entries').select('id').eq('snapshot_id', marker.snapshotId);
  const conceptIds = ((concepts ?? []) as Array<{ id: string }>).map((row) => row.id);

  let associationCount = 0;
  if (conceptIds.length > 0) {
    const { count } = await db
      .from('provider_industry_mapping_associations')
      .select('*', { count: 'exact', head: true })
      .in('concept_entry_id', conceptIds);
    associationCount = count ?? 0;
  }

  return {
    ...result,
    success: true,
    phase: 'complete',
    snapshotId: marker.snapshotId,
    baselineCounts: baseline,
    conceptCount: conceptIds.length,
    associationCount,
  };
}

// React useActionState adapters live in qa-harness-server-actions.ts (a
// dedicated top-level 'use server' module) — Client Components cannot import
// inline 'use server' functions from this plain module directly.
