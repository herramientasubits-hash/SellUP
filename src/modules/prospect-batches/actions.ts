'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { runProspectGenerationAgent } from '@/server/agents/prospect-generation';
import { runAgentSourceDiscoveryPreflight, type SourceDiscoveryPreflightResult } from '@/server/agents/prospecting-toolkit/source-discovery-preflight';
import { runIncrementalProspectingSearch } from '@/server/agents/prospecting-toolkit/incremental-search';
import { testHubSpotConnection } from '@/server/services/hubspot-connection';
import { checkHubSpotCompanyCommercialStatus } from '@/server/agents/prospecting-toolkit/hubspot-commercial-checker';
import { detectCandidateDuplicates } from '@/server/prospect-batches/duplicate-detection';
import { lookupTaxIdentifierForCandidate, type TaxIdentifierLookupMetadata } from '@/server/prospect-batches/tax-identifier-lookup';
import { checkIsColombiaProviderConfigured } from '@/server/prospect-batches/tax-identifier-providers/colombia';
import { createHubSpotCompany, type CreateHubSpotCompanySentAudit, type CreateHubSpotCompanyResult } from '@/server/integrations/hubspot-company-create';
import {
  APPROVE_BLOCK_MESSAGES,
  isStructuredCandidate,
  isUsefulReviewCandidate,
  type ProspectBatch,
  type ProspectBatchWithMeta,
  type ProspectCandidate,
  type ProspectCandidateWithReviewer,
  type ProspectCandidateAudit,
  type BatchesSummary,
  type BatchDetailSummary,
  type CreateBatchInput,
  type UpdateBatchInput,
  type CreateCandidateInput,
  type UpdateCandidateInput,
  type MarkDuplicateInput,
  type InternalUserOption,
  type CandidateAuditAction,
  type BatchStatus,
  type DuplicateStatus,
} from './types';

// ── HubSpot sync types ─────────────────────────────────────────

export type HubSpotSyncStatus =
  | 'skipped_flag_off'
  | 'skipped_no_connection'
  | 'skipped_missing_write_scope'
  | 'skipped_rollback'
  | 'blocked_duplicate'
  | 'blocked_inactive_or_liquidation'
  | 'failed_lookup'
  | 'failed_create'
  | 'synced';

export interface HubSpotSyncResult {
  attempted: boolean;
  status: HubSpotSyncStatus;
  hubspotCompanyId?: string;
  message?: string;
  sentPropertyKeys?: string[];
  sentPropertiesAudit?: CreateHubSpotCompanySentAudit | null;
  skippedProperties?: string[];
  ownerMappingStatus?: 'mapped' | 'skipped_missing_mapping' | 'skipped';
  owner_assigned?: boolean;
  owner_id?: string;
  owner_email?: string;
  account_executive_assigned?: boolean;
  account_executive_property?: string;
  account_executive_value?: string;
  properties_sent?: Record<string, string>;
  properties_skipped?: string[];
  warnings?: string[];
}

// ── Auth helpers ──────────────────────────────────────────────

async function requireActiveUser(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');
  return { internalUserId: internalUser.id };
}

async function requireAdmin(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();

  if (role?.key !== 'admin') {
    throw new Error('Acceso restringido: se requiere rol admin');
  }

  return { internalUserId: internalUser.id };
}

// ── Utilidades ────────────────────────────────────────────────

function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(website: string): string | null {
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ── Auditoría ─────────────────────────────────────────────────

export async function logProspectCandidateAudit(params: {
  batchId: string;
  candidateId?: string;
  actorUserId?: string;
  actionType: CandidateAuditAction;
  details?: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createClient();
  await supabase.from('prospect_candidate_audit').insert({
    batch_id: params.batchId,
    candidate_id: params.candidateId ?? null,
    actor_user_id: params.actorUserId ?? null,
    action_type: params.actionType,
    details: params.details ?? {},
  });
}

// ── Summaries ─────────────────────────────────────────────────

export async function getProspectBatchesSummary(): Promise<BatchesSummary> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data: batches } = await supabase
    .from('prospect_batches')
    .select('status, metadata')
    .is('archived_at', null);

  const { data: approvedCandidates } = await supabase
    .from('prospect_candidates')
    .select('id, name, legal_name, country_code, tax_identifier, duplicate_status, status, review_flags, legal_status, source_primary')
    .eq('status', 'approved');

  const list = batches ?? [];
  const approvedList = (approvedCandidates ?? []).filter(isUsefulReviewCandidate);

  return {
    total: list.length,
    ready_for_review: list.filter((b) => {
      const meta = b.metadata as Record<string, unknown> | null;
      return b.status === 'ready_for_review' && meta?.review_ready !== false;
    }).length,
    in_review: list.filter((b) => b.status === 'in_review').length,
    completed: list.filter((b) => b.status === 'completed').length,
    total_approved_candidates: approvedList.length,
  };
}

// ── Listado de lotes ──────────────────────────────────────────

export async function getProspectBatchesList(): Promise<ProspectBatchWithMeta[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data: batches, error } = await supabase
    .from('prospect_batches')
    .select(`
      *,
      owner:internal_users!prospect_batches_owner_id_fkey(id, full_name, email),
      created_by_user:internal_users!prospect_batches_created_by_fkey(id, full_name)
    `)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Error al cargar lotes: ${error.message}`);
  if (!batches) return [];

  const batchIds = batches.map((b) => b.id);

  const { data: candidates } = await supabase
    .from('prospect_candidates')
    .select('batch_id, status, name, legal_name, country_code, tax_identifier, duplicate_status, review_flags, legal_status, source_primary')
    .in('batch_id', batchIds);

  const list = candidates ?? [];

  return batches.map((b) => {
    const usefulCandidates = list.filter((c) => c.batch_id === b.id && isUsefulReviewCandidate(c));
    const approved = usefulCandidates.filter((c) => c.status === 'approved').length;
    const discarded = usefulCandidates.filter((c) => c.status === 'discarded').length;
    const converted = usefulCandidates.filter((c) => c.status === 'converted_to_account').length;
    const needsReview = usefulCandidates.filter((c) => c.status === 'needs_review' || c.status === 'generated' || c.status === 'normalized').length;
    const duplicates = usefulCandidates.filter((c) => c.duplicate_status === 'possible_duplicate' || c.duplicate_status === 'exact_duplicate' || c.status === 'duplicate').length;

    return {
      ...b,
      total_candidates: usefulCandidates.length,
      approved_count: approved,
      discarded_count: discarded,
      converted_count: converted,
      needs_review_count: needsReview,
      duplicate_count: duplicates,
    } as ProspectBatchWithMeta;
  });
}

// ── Detalle de lote ───────────────────────────────────────────

export async function getProspectBatchById(id: string): Promise<ProspectBatchWithMeta | null> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data: batch, error } = await supabase
    .from('prospect_batches')
    .select(`
      *,
      owner:internal_users!prospect_batches_owner_id_fkey(id, full_name, email),
      created_by_user:internal_users!prospect_batches_created_by_fkey(id, full_name)
    `)
    .eq('id', id)
    .single();

  if (error || !batch) return null;

  const { data: candidates } = await supabase
    .from('prospect_candidates')
    .select('status, name, legal_name, country_code, tax_identifier, duplicate_status, review_flags, legal_status, source_primary')
    .eq('batch_id', id);

  const list = candidates ?? [];
  const usefulCandidates = list.filter(isUsefulReviewCandidate);
  const approved = usefulCandidates.filter((c) => c.status === 'approved').length;
  const discarded = usefulCandidates.filter((c) => c.status === 'discarded').length;
  const converted = usefulCandidates.filter((c) => c.status === 'converted_to_account').length;
  const needsReview = usefulCandidates.filter((c) => c.status === 'needs_review' || c.status === 'generated' || c.status === 'normalized').length;
  const duplicates = usefulCandidates.filter((c) => c.duplicate_status === 'possible_duplicate' || c.duplicate_status === 'exact_duplicate' || c.status === 'duplicate').length;

  return {
    ...batch,
    total_candidates: usefulCandidates.length,
    approved_count: approved,
    discarded_count: discarded,
    converted_count: converted,
    needs_review_count: needsReview,
    duplicate_count: duplicates,
  } as ProspectBatchWithMeta;
}

export async function getBatchDetailSummary(batchId: string): Promise<BatchDetailSummary> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data: candidates } = await supabase
    .from('prospect_candidates')
    .select('status, name, legal_name, country_code, tax_identifier, duplicate_status, review_flags, legal_status, source_primary')
    .eq('batch_id', batchId);

  const list = candidates ?? [];
  const usefulCandidates = list.filter(isUsefulReviewCandidate);
  const approved = usefulCandidates.filter((c) => c.status === 'approved').length;
  const discarded = usefulCandidates.filter((c) => c.status === 'discarded').length;
  const converted = usefulCandidates.filter((c) => c.status === 'converted_to_account').length;
  const needsReview = usefulCandidates.filter((c) => c.status === 'needs_review' || c.status === 'generated' || c.status === 'normalized').length;
  const duplicates = usefulCandidates.filter((c) => c.duplicate_status === 'possible_duplicate' || c.duplicate_status === 'exact_duplicate' || c.status === 'duplicate').length;

  return {
    total_candidates: usefulCandidates.length,
    needs_review: needsReview,
    approved: approved,
    discarded: discarded,
    converted: converted,
    duplicates: duplicates,
  };
}

// ── CRUD lotes ────────────────────────────────────────────────

const MVP_MAX_CANDIDATES = 25;

export async function createProspectBatch(input: CreateBatchInput): Promise<ProspectBatch> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  if (input.target_count !== undefined && input.target_count > MVP_MAX_CANDIDATES) {
    throw new Error(`El máximo permitido en el MVP es ${MVP_MAX_CANDIDATES} empresas candidatas por lote`);
  }

  const { data, error } = await supabase
    .from('prospect_batches')
    .insert({
      name: input.name,
      description: input.description ?? null,
      country: input.country ?? null,
      country_code: input.country_code ?? null,
      industry: input.industry ?? null,
      target_count: input.target_count ?? null,
      search_depth: input.search_depth ?? 'standard',
      status: 'draft',
      source: 'manual',
      owner_id: input.owner_id ?? internalUserId,
      created_by: internalUserId,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Error al crear lote: ${error?.message}`);

  await logProspectCandidateAudit({
    batchId: data.id,
    actorUserId: internalUserId,
    actionType: 'batch_created',
    details: { name: data.name, source: data.source },
  });

  revalidatePath('/prospect-batches');
  return data as ProspectBatch;
}

export async function updateProspectBatch(
  id: string,
  input: UpdateBatchInput
): Promise<ProspectBatch> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  if (input.target_count !== undefined && input.target_count > MVP_MAX_CANDIDATES) {
    throw new Error(`El máximo permitido en el MVP es ${MVP_MAX_CANDIDATES} empresas candidatas por lote`);
  }

  const { data: existing } = await supabase
    .from('prospect_batches')
    .select('status')
    .eq('id', id)
    .single();

  const { data, error } = await supabase
    .from('prospect_batches')
    .update({
      ...input,
      ...(input.status && existing?.status !== input.status
        ? { completed_at: input.status === 'completed' ? new Date().toISOString() : null }
        : {}),
    })
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new Error(`Error al actualizar lote: ${error?.message}`);

  const auditAction =
    input.status && input.status !== existing?.status
      ? 'batch_status_changed'
      : 'batch_updated';

  await logProspectCandidateAudit({
    batchId: id,
    actorUserId: internalUserId,
    actionType: auditAction,
    details: input.status
      ? { from_status: existing?.status, to_status: input.status }
      : { updated_fields: Object.keys(input) },
  });

  revalidatePath('/prospect-batches');
  revalidatePath(`/prospect-batches/${id}`);
  return data as ProspectBatch;
}

export async function archiveProspectBatch(id: string): Promise<void> {
  const { internalUserId } = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from('prospect_batches')
    .update({ archived_at: new Date().toISOString(), archived_by: internalUserId })
    .eq('id', id);

  if (error) throw new Error(`Error al archivar lote: ${error.message}`);

  await logProspectCandidateAudit({
    batchId: id,
    actorUserId: internalUserId,
    actionType: 'batch_updated',
    details: { action: 'archived' },
  });

  revalidatePath('/prospect-batches');
}

// ── Candidatos ────────────────────────────────────────────────

export async function getCandidatesByBatch(
  batchId: string
): Promise<ProspectCandidateWithReviewer[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('prospect_candidates')
    .select(`
      *,
      reviewer:internal_users!prospect_candidates_reviewed_by_fkey(id, full_name, email)
    `)
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Error al cargar candidatos: ${error.message}`);
  return (data ?? []) as ProspectCandidateWithReviewer[];
}

export async function createProspectCandidate(
  input: CreateCandidateInput
): Promise<ProspectCandidate> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const domain = input.website ? extractDomain(input.website) : null;
  const normalizedName = normalizeName(input.name);

  const { data, error } = await supabase
    .from('prospect_candidates')
    .insert({
      batch_id: input.batch_id,
      name: input.name,
      legal_name: input.legal_name ?? null,
      normalized_name: normalizedName,
      website: input.website ?? null,
      domain: input.domain ?? domain,
      country: input.country ?? null,
      country_code: input.country_code ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      industry: input.industry ?? null,
      company_size: input.company_size ?? null,
      tax_identifier: input.tax_identifier ?? null,
      tax_identifier_type: input.tax_identifier_type ?? null,
      source_primary: input.source_primary ?? 'manual',
      status: 'needs_review',
      review_notes: input.review_notes ?? null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Error al crear candidato: ${error?.message}`);

  await logProspectCandidateAudit({
    batchId: input.batch_id,
    candidateId: data.id,
    actorUserId: internalUserId,
    actionType: 'candidate_created',
    details: { name: data.name, source_primary: data.source_primary },
  });

  revalidatePath(`/prospect-batches/${input.batch_id}`);
  return data as ProspectCandidate;
}

export async function updateProspectCandidate(
  id: string,
  input: UpdateCandidateInput
): Promise<ProspectCandidate> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('prospect_candidates')
    .select('batch_id, name')
    .eq('id', id)
    .single();

  const updates: Record<string, unknown> = { ...input };
  if (input.name) updates.normalized_name = normalizeName(input.name);
  if (input.website) updates.domain = extractDomain(input.website);

  const { data, error } = await supabase
    .from('prospect_candidates')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new Error(`Error al actualizar candidato: ${error?.message}`);

  if (existing) {
    await logProspectCandidateAudit({
      batchId: existing.batch_id,
      candidateId: id,
      actorUserId: internalUserId,
      actionType: 'candidate_updated',
      details: { updated_fields: Object.keys(input) },
    });
    revalidatePath(`/prospect-batches/${existing.batch_id}`);
  }

  return data as ProspectCandidate;
}

export async function approveCandidate(id: string): Promise<ProspectCandidate> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  // ── Guardia server-side: rechaza si duplicate_status bloquea la aprobación ──
  const { data: current } = await supabase
    .from('prospect_candidates')
    .select('duplicate_status, review_status')
    .eq('id', id)
    .single();

  if (current?.duplicate_status) {
    const blockMsg = APPROVE_BLOCK_MESSAGES[current.duplicate_status as DuplicateStatus];
    if (blockMsg) {
      throw new Error(blockMsg);
    }
  }

  // Para candidatos estructurados: exigir review_status = ready_for_approval
  const currentReviewStatus = (current as Record<string, unknown> | null)?.review_status as string | null | undefined;
  if (currentReviewStatus !== null && currentReviewStatus !== undefined) {
    if (currentReviewStatus !== 'ready_for_approval') {
      throw new Error(
        'Este candidato viene de una fuente oficial. Primero debe marcarse como listo para aprobación.'
      );
    }
  }
  // ── Fin guardia ───────────────────────────────────────────────────────────

  const approveUpdates: Record<string, unknown> = {
    status: 'approved',
    reviewed_by: internalUserId,
    reviewed_at: new Date().toISOString(),
  };
  // Sincronizar review_status para candidatos estructurados
  if (currentReviewStatus !== null && currentReviewStatus !== undefined) {
    approveUpdates.review_status = 'approved';
  }

  const { data, error } = await supabase
    .from('prospect_candidates')
    .update(approveUpdates)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new Error(`Error al aprobar candidato: ${error?.message}`);

  await logProspectCandidateAudit({
    batchId: data.batch_id,
    candidateId: id,
    actorUserId: internalUserId,
    actionType: 'candidate_approved',
    details: { candidate_name: data.name },
  });

  revalidatePath(`/prospect-batches/${data.batch_id}`);
  return data as ProspectCandidate;
}

export async function discardCandidate(id: string, reason?: string): Promise<ProspectCandidate> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const { data: currentForDiscard } = await supabase
    .from('prospect_candidates')
    .select('review_status')
    .eq('id', id)
    .single();
  const currentDiscardReviewStatus = (currentForDiscard as Record<string, unknown> | null)?.review_status as string | null | undefined;

  const discardUpdates: Record<string, unknown> = {
    status: 'discarded',
    review_notes: reason ?? null,
    reviewed_by: internalUserId,
    reviewed_at: new Date().toISOString(),
  };
  if (currentDiscardReviewStatus !== null && currentDiscardReviewStatus !== undefined) {
    discardUpdates.review_status = 'rejected';
  }

  const { data, error } = await supabase
    .from('prospect_candidates')
    .update(discardUpdates)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new Error(`Error al descartar candidato: ${error?.message}`);

  await logProspectCandidateAudit({
    batchId: data.batch_id,
    candidateId: id,
    actorUserId: internalUserId,
    actionType: 'candidate_discarded',
    details: { candidate_name: data.name, reason: reason ?? null },
  });

  revalidatePath(`/prospect-batches/${data.batch_id}`);
  return data as ProspectCandidate;
}

export async function markCandidateReadyForApprovalAction(
  candidateId: string
): Promise<{ ok: boolean; error?: string; candidateId?: string; reviewStatus?: string }> {
  try {
    const { internalUserId } = await requireActiveUser();
    const supabase = await createClient();

    if (!candidateId || !/^[0-9a-f-]{36}$/i.test(candidateId)) {
      return { ok: false, error: 'ID de candidato inválido' };
    }

    const { data: candidate } = await supabase
      .from('prospect_candidates')
      .select('id, batch_id, name, status, duplicate_status, review_status, review_flags, metadata')
      .eq('id', candidateId)
      .single();

    if (!candidate) return { ok: false, error: 'Candidato no encontrado' };

    const reviewStatus = (candidate as Record<string, unknown>).review_status as string | null | undefined;
    const reviewFlags = (candidate as Record<string, unknown>).review_flags as string[] | null | undefined;

    if (reviewStatus === null || reviewStatus === undefined) {
      return { ok: false, error: 'Esta acción solo aplica a candidatos de fuentes oficiales estructuradas' };
    }

    if (candidate.status !== 'needs_review') {
      return { ok: false, error: `El candidato debe estar en estado "necesita revisión" para marcarlo como listo (estado actual: ${candidate.status})` };
    }

    if (reviewStatus !== 'needs_manual_review') {
      return { ok: false, error: `El candidato ya fue procesado (review_status: ${reviewStatus})` };
    }

    // ── Bloqueos de negocio ───────────────────────────────────────
    if (Array.isArray(reviewFlags) && reviewFlags.includes('liquidation_signal')) {
      return { ok: false, error: 'No se puede marcar como listo: la empresa tiene señal de liquidación o disolución en su razón social.' };
    }
    if (Array.isArray(reviewFlags) && reviewFlags.includes('inactive_company')) {
      return { ok: false, error: 'No se puede marcar como listo: la empresa puede estar inactiva o disuelta. Verifica el estado antes de continuar.' };
    }
    if (candidate.duplicate_status === 'exact_duplicate') {
      return { ok: false, error: 'No se puede marcar como listo: el candidato está marcado como duplicado exacto.' };
    }
    if (Array.isArray(reviewFlags) && reviewFlags.includes('no_tax_id')) {
      return { ok: false, error: 'No se puede marcar como listo: el candidato no tiene NIT/identificación fiscal.' };
    }
    // ── Fin bloqueos ──────────────────────────────────────────────

    const { data, error } = await supabase
      .from('prospect_candidates')
      .update({
        review_status: 'ready_for_approval',
        reviewed_by: internalUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', candidateId)
      .select()
      .single();

    if (error || !data) {
      return { ok: false, error: `Error al marcar candidato como listo: ${error?.message ?? 'sin datos'}` };
    }

    // Audit — acción no crítica; usa 'candidate_updated' porque 'candidate_marked_ready_for_approval'
    // aún no está en el CHECK constraint de prospect_candidate_audit (migration 040).
    try {
      await logProspectCandidateAudit({
        batchId: data.batch_id,
        candidateId,
        actorUserId: internalUserId,
        actionType: 'candidate_updated',
        details: { candidate_name: data.name, action: 'marked_ready_for_approval' },
      });
    } catch (auditErr) {
      console.warn('[markCandidateReadyForApprovalAction] Audit non-critical failure:', auditErr);
    }

    revalidatePath(`/prospect-batches/${data.batch_id}`);
    return { ok: true, candidateId: data.id, reviewStatus: 'ready_for_approval' };
  } catch (err) {
    console.error('[markCandidateReadyForApprovalAction] Unexpected error:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado al marcar candidato como listo',
    };
  }
}

export async function markCandidateDuplicateReviewedAction(
  candidateId: string
): Promise<{ ok: boolean; error?: string; candidateId?: string; duplicateStatus?: string }> {
  try {
    const { internalUserId } = await requireActiveUser();
    const supabase = await createClient();

    if (!candidateId || !/^[0-9a-f-]{36}$/i.test(candidateId)) {
      return { ok: false, error: 'ID de candidato inválido' };
    }

    const { data: candidate } = await supabase
      .from('prospect_candidates')
      .select('id, batch_id, name, duplicate_status, review_status, commercial_trace')
      .eq('id', candidateId)
      .single();

    if (!candidate) return { ok: false, error: 'Candidato no encontrado' };

    const reviewStatus = (candidate as Record<string, unknown>).review_status as string | null | undefined;

    if (reviewStatus === null || reviewStatus === undefined) {
      return { ok: false, error: 'Esta acción solo aplica a candidatos de fuentes oficiales estructuradas' };
    }

    if (reviewStatus !== 'ready_for_approval') {
      return { ok: false, error: 'El candidato debe estar listo para aprobación antes de marcar duplicidad revisada' };
    }

    if (candidate.duplicate_status !== 'unchecked') {
      return { ok: false, error: `La duplicidad ya fue verificada (estado actual: ${candidate.duplicate_status})` };
    }

    const existingTrace = ((candidate as Record<string, unknown>).commercial_trace as Record<string, unknown> | null) ?? {};
    const updatedTrace = {
      ...existingTrace,
      duplicateReviewedBy: internalUserId,
      duplicateReviewedAt: new Date().toISOString(),
      duplicateReviewMethod: 'manual',
    };

    const { data, error } = await supabase
      .from('prospect_candidates')
      .update({
        duplicate_status: 'no_match',
        updated_at: new Date().toISOString(),
        commercial_trace: updatedTrace,
      })
      .eq('id', candidateId)
      .select()
      .single();

    if (error || !data) {
      return { ok: false, error: `Error al marcar duplicidad revisada: ${error?.message ?? 'sin datos'}` };
    }

    try {
      await logProspectCandidateAudit({
        batchId: data.batch_id,
        candidateId,
        actorUserId: internalUserId,
        actionType: 'candidate_updated',
        details: {
          candidate_name: data.name,
          action: 'duplicate_reviewed_manual',
          previous_duplicate_status: 'unchecked',
          new_duplicate_status: 'no_match',
        },
      });
    } catch (auditErr) {
      console.warn('[markCandidateDuplicateReviewedAction] Audit non-critical failure:', auditErr);
    }

    revalidatePath(`/prospect-batches/${data.batch_id}`);
    return { ok: true, candidateId: data.id, duplicateStatus: 'no_match' };
  } catch (err) {
    console.error('[markCandidateDuplicateReviewedAction] Unexpected error:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado al marcar duplicidad revisada',
    };
  }
}

export async function markCandidateDuplicate(
  id: string,
  matchData: MarkDuplicateInput
): Promise<ProspectCandidate> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const { data: currentForDup } = await supabase
    .from('prospect_candidates')
    .select('review_status')
    .eq('id', id)
    .single();
  const currentDupReviewStatus = (currentForDup as Record<string, unknown> | null)?.review_status as string | null | undefined;

  const dupUpdates: Record<string, unknown> = {
    status: 'duplicate',
    duplicate_status: matchData.duplicate_status,
    matched_account_id: matchData.matched_account_id ?? null,
    matched_hubspot_company_id: matchData.matched_hubspot_company_id ?? null,
    review_notes: matchData.review_notes ?? null,
    reviewed_by: internalUserId,
    reviewed_at: new Date().toISOString(),
  };
  if (currentDupReviewStatus !== null && currentDupReviewStatus !== undefined) {
    dupUpdates.review_status = matchData.duplicate_status === 'exact_duplicate'
      ? 'blocked_duplicate'
      : 'rejected';
  }

  const { data, error } = await supabase
    .from('prospect_candidates')
    .update(dupUpdates)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new Error(`Error al marcar duplicado: ${error?.message}`);

  await logProspectCandidateAudit({
    batchId: data.batch_id,
    candidateId: id,
    actorUserId: internalUserId,
    actionType: 'candidate_marked_duplicate',
    details: {
      candidate_name: data.name,
      duplicate_status: matchData.duplicate_status,
      matched_account_id: matchData.matched_account_id ?? null,
    },
  });

  revalidatePath(`/prospect-batches/${data.batch_id}`);
  return data as ProspectCandidate;
}

// ── HubSpot liquidation / inactive guardrails ─────────────────

const LIQUIDATION_NAME_SIGNALS = [
  'EN LIQUIDACION',
  'EN LIQUIDACIÓN',
  ' LIQUIDACION',
  ' LIQUIDACIÓN',
  'LIQUIDADA',
  'DISUELTA',
  'EN DISOLUCION',
  'EN DISOLUCIÓN',
];

const INACTIVE_REVIEW_FLAGS = ['inactive_company', 'possible_inactive'];

function hasLiquidationOrInactiveSignal(
  name: string,
  reviewFlagsAtConversion?: string[] | null,
  candidateReviewFlags?: string[] | null,
): boolean {
  const upper = name.toUpperCase();
  if (LIQUIDATION_NAME_SIGNALS.some((s) => upper.includes(s))) return true;
  const allFlags = [
    ...(Array.isArray(reviewFlagsAtConversion) ? reviewFlagsAtConversion : []),
    ...(Array.isArray(candidateReviewFlags) ? candidateReviewFlags : []),
  ];
  return INACTIVE_REVIEW_FLAGS.some((f) => allFlags.includes(f));
}

// ── HubSpot sync helper ───────────────────────────────────────

function getHubSpotAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

async function updateAccountHubSpotMeta(
  accountId: string,
  metaPatch: Record<string, unknown>,
  existingMeta: Record<string, unknown>
): Promise<void> {
  const admin = getHubSpotAdminClient();
  await admin
    .from('accounts')
    .update({
      metadata: { ...existingMeta, ...metaPatch },
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);
}

/**
 * Busca en Supabase si existe un mapeo activo entre el email del usuario y un hubspot_owner_id.
 * Normaliza el email a lowercase y remueve espacios en blanco.
 * En caso de error o de no encontrar el mapeo, retorna null para aplicar el fallback seguro.
 */
export async function getHubSpotOwnerMapping(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail) return null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('hubspot_owner_mappings')
      .select('hubspot_owner_id')
      .eq('internal_user_email', cleanEmail)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.warn('[getHubSpotOwnerMapping] Error al consultar mapeo en Supabase:', error.message);
      return null;
    }

    if (data?.hubspot_owner_id) {
      console.log(`[getHubSpotOwnerMapping] Mapeo encontrado para ${cleanEmail}: ${data.hubspot_owner_id}`);
    } else {
      console.log(`[getHubSpotOwnerMapping] No se encontró mapeo activo para ${cleanEmail}`);
    }

    return data?.hubspot_owner_id ?? null;
  } catch (err) {
    console.warn('[getHubSpotOwnerMapping] Error inesperado resolviendo owner:', err);
    return null;
  }
}

async function attemptHubSpotSync(params: {
  accountId: string;
  accountName: string;
  accountMeta: Record<string, unknown>;
  accountCountry: string | null;
  accountCountryCode: string | null;
  accountTaxIdentifier: string | null;
  accountWebsite: string | null;
  accountDomain: string | null;
  accountCity: string | null;
  accountRegion: string | null;
  accountLegalName?: string | null;
  accountCompanySize?: string | null;
  candidateDuplicateStatus: string | null;
  candidateReviewFlags?: string[] | null;
  hubspotOwnerId?: string | null;
  linkedinUrl?: string | null;
  industry?: string | null;
  approvedByEmail?: string | null;
  approvedByName?: string | null;
  description?: string | null;
}): Promise<HubSpotSyncResult> {
  const {
    accountId,
    accountName,
    accountMeta,
    accountCountry,
    accountCountryCode,
    accountTaxIdentifier,
    accountWebsite,
    accountDomain,
    accountCity,
    accountRegion,
    accountLegalName,
    accountCompanySize,
    candidateDuplicateStatus,
    candidateReviewFlags,
    hubspotOwnerId,
    linkedinUrl,
    industry,
    approvedByEmail,
    approvedByName,
    description,
  } = params;

  const nowStr = new Date().toISOString();

  // 1. Feature flag
  const flagEnabled = process.env.HUBSPOT_COMPANY_AUTO_CREATE_ENABLED === 'true';
  if (!flagEnabled) {
    await updateAccountHubSpotMeta(accountId, { hubspot_sync_status: 'skipped_flag_off', hubspot_sync_method: 'auto', hubspot_sync_attempted_at: nowStr }, accountMeta);
    return { attempted: false, status: 'skipped_flag_off' };
  }

  // 2. Rollback guard
  if (accountMeta.rollback_logical === true) {
    await updateAccountHubSpotMeta(accountId, { hubspot_sync_status: 'skipped_rollback', hubspot_sync_method: 'auto', hubspot_sync_attempted_at: nowStr }, accountMeta);
    return { attempted: false, status: 'skipped_rollback' };
  }

  // 3. Liquidation / inactive guard — blocks before any API call
  const reviewFlagsAtConversion = Array.isArray(accountMeta.review_flags_at_conversion)
    ? (accountMeta.review_flags_at_conversion as string[])
    : null;
  if (hasLiquidationOrInactiveSignal(accountName, reviewFlagsAtConversion, candidateReviewFlags ?? null)) {
    await updateAccountHubSpotMeta(accountId, {
      hubspot_sync_status: 'blocked_inactive_or_liquidation',
      hubspot_sync_blocked_reason: 'inactive_or_liquidation_signal',
      hubspot_sync_method: 'auto',
      hubspot_sync_attempted_at: nowStr,
    }, accountMeta);
    return { attempted: false, status: 'blocked_inactive_or_liquidation', message: 'Empresa con señal de liquidación o inactividad' };
  }

  // 4. Validate HubSpot connection + write scope
  let connectionResult;
  try {
    connectionResult = await testHubSpotConnection();
  } catch {
    await updateAccountHubSpotMeta(accountId, { hubspot_sync_status: 'skipped_no_connection', hubspot_sync_method: 'auto', hubspot_sync_attempted_at: nowStr }, accountMeta);
    return { attempted: false, status: 'skipped_no_connection' };
  }

  if (!connectionResult.success) {
    await updateAccountHubSpotMeta(accountId, { hubspot_sync_status: 'skipped_no_connection', hubspot_sync_method: 'auto', hubspot_sync_attempted_at: nowStr }, accountMeta);
    return { attempted: false, status: 'skipped_no_connection' };
  }

  if (!connectionResult.hubspotScopes?.canWriteCompanies) {
    await updateAccountHubSpotMeta(accountId, { hubspot_sync_status: 'skipped_missing_write_scope', hubspot_sync_method: 'auto', hubspot_sync_attempted_at: nowStr }, accountMeta);
    return { attempted: false, status: 'skipped_missing_write_scope' };
  }

  // 4. Candidate duplicate guard — only proceed if no_match
  if (candidateDuplicateStatus !== 'no_match') {
    await updateAccountHubSpotMeta(accountId, {
      hubspot_sync_status: 'blocked_duplicate',
      hubspot_sync_blocked_reason: `candidate_duplicate_status:${candidateDuplicateStatus ?? 'null'}`,
      hubspot_sync_method: 'auto',
      hubspot_sync_attempted_at: nowStr,
    }, accountMeta);
    return { attempted: true, status: 'blocked_duplicate', message: `candidate.duplicate_status=${candidateDuplicateStatus}` };
  }

  // 5. Colombia requires tax_identifier
  if (accountCountryCode === 'CO' && !accountTaxIdentifier) {
    await updateAccountHubSpotMeta(accountId, {
      hubspot_sync_status: 'blocked_duplicate',
      hubspot_sync_blocked_reason: 'co_missing_tax_identifier',
      hubspot_sync_method: 'auto',
      hubspot_sync_attempted_at: nowStr,
    }, accountMeta);
    return { attempted: false, status: 'blocked_duplicate', message: 'Colombia requires tax_identifier' };
  }

  // 6. Final HubSpot duplicate check (read-only)
  const domain = accountDomain ?? (accountWebsite ? (() => {
    try {
      const url = accountWebsite.startsWith('http') ? accountWebsite : `https://${accountWebsite}`;
      return new URL(url).hostname.replace(/^www\./, '');
    } catch { return null; }
  })() : null);

  let finalCheck;
  try {
    finalCheck = await checkHubSpotCompanyCommercialStatus({
      name: accountName,
      domain: domain ?? null,
      taxId: accountTaxIdentifier ?? null,
      countryCode: accountCountryCode ?? null,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message.slice(0, 200) : 'Error desconocido';
    await updateAccountHubSpotMeta(accountId, {
      hubspot_sync_status: 'failed_lookup',
      hubspot_sync_error: errMsg,
      hubspot_sync_method: 'auto',
      hubspot_sync_attempted_at: nowStr,
    }, accountMeta);
    return { attempted: true, status: 'failed_lookup' };
  }

  if (finalCheck.hubspotMatchStatus !== 'no_match') {
    await updateAccountHubSpotMeta(accountId, {
      hubspot_sync_status: 'blocked_duplicate',
      hubspot_sync_blocked_reason: finalCheck.hubspotMatchStatus,
      hubspot_match_status_at_sync: finalCheck.hubspotMatchStatus,
      hubspot_sync_method: 'auto',
      hubspot_sync_attempted_at: nowStr,
    }, accountMeta);
    return { attempted: true, status: 'blocked_duplicate', message: `HubSpot match: ${finalCheck.hubspotMatchStatus}` };
  }

  // 7. Create company in HubSpot with enriched mapping
  const createResult = await createHubSpotCompany({
    name: accountName,
    country: accountCountry ?? null,
    countryCode: accountCountryCode ?? null,
    taxIdentifier: accountTaxIdentifier ?? null,
    website: accountWebsite ?? null,
    domain: domain ?? null,
    city: accountCity ?? null,
    region: accountRegion ?? null,
    legalName: accountLegalName ?? null,
    numberOfEmployees: accountCompanySize ?? null,
    hubspotOwnerId: hubspotOwnerId ?? null,
    linkedinUrl: linkedinUrl ?? null,
    industry: industry ?? null,
    approvedByEmail: approvedByEmail ?? null,
    approvedByName: approvedByName ?? null,
    description: description ?? null,
  });

  if (createResult.ok && createResult.hubspotCompanyId) {
    const admin = getHubSpotAdminClient();
    await admin
      .from('accounts')
      .update({
        hubspot_company_id: createResult.hubspotCompanyId,
        metadata: {
          ...accountMeta,
          hubspot_sync_status: 'synced',
          hubspot_sync_method: 'auto',
          hubspot_sync_attempted_at: nowStr,
          hubspot_synced_at: nowStr,
          hubspot_company_id: createResult.hubspotCompanyId,
          hubspot_match_status_at_sync: 'no_match',
          hubspot_sync_source: 'candidate_conversion',
          // Full audit object for diagnosing HubSpot property issues
          hubspot_sync: {
            status: 'synced',
            company_id: createResult.hubspotCompanyId,
            sent_property_keys: createResult.sentPropertyKeys ?? null,
            sent_properties_audit: createResult.sentPropertiesAudit ?? null,
            skipped_properties: createResult.skippedProperties ?? null,
            blocked_reason: null,
            owner_mapping_status: createResult.ownerMappingStatus ?? 'skipped',
            owner_assigned: createResult.owner_assigned ?? false,
            owner_id: createResult.owner_id ?? null,
            owner_email: createResult.owner_email ?? null,
            account_executive_assigned: createResult.account_executive_assigned ?? false,
            account_executive_property: createResult.account_executive_property ?? null,
            account_executive_value: createResult.account_executive_value ?? null,
            lifecyclestage_sent: 'marketingqualifiedlead',
            properties_sent: createResult.properties_sent ?? null,
            properties_skipped: createResult.properties_skipped ?? null,
            warnings: createResult.warnings ?? [],
            synced_at: nowStr,
          },
          // Flat keys kept for backwards compatibility
          hubspot_sent_property_keys: createResult.sentPropertyKeys ?? null,
          hubspot_sent_country: createResult.sentPropertiesAudit?.country ?? null,
          hubspot_sent_nit: createResult.sentPropertiesAudit?.nit ?? null,
          hubspot_sent_domain: createResult.sentPropertiesAudit?.domain ?? null,
        },
        updated_at: nowStr,
      })
      .eq('id', accountId);

    return {
      attempted: true,
      status: 'synced',
      hubspotCompanyId: createResult.hubspotCompanyId,
      sentPropertyKeys: createResult.sentPropertyKeys,
      sentPropertiesAudit: createResult.sentPropertiesAudit,
      skippedProperties: createResult.skippedProperties,
      ownerMappingStatus: createResult.ownerMappingStatus,
      owner_assigned: createResult.owner_assigned,
      owner_id: createResult.owner_id,
      owner_email: createResult.owner_email,
      account_executive_assigned: createResult.account_executive_assigned,
      account_executive_property: createResult.account_executive_property,
      account_executive_value: createResult.account_executive_value,
      properties_sent: createResult.properties_sent,
      properties_skipped: createResult.properties_skipped,
      warnings: createResult.warnings,
    };
  }

  await updateAccountHubSpotMeta(accountId, {
    hubspot_sync_status: 'failed_create',
    hubspot_sync_method: 'auto',
    hubspot_sync_attempted_at: nowStr,
    hubspot_sync_error: createResult.error?.slice(0, 200) ?? 'unknown',
  }, accountMeta);
  return {
    attempted: true,
    status: 'failed_create',
    message: 'Error al crear en HubSpot',
    sentPropertyKeys: createResult.sentPropertyKeys,
    sentPropertiesAudit: createResult.sentPropertiesAudit,
    skippedProperties: createResult.skippedProperties,
    ownerMappingStatus: createResult.ownerMappingStatus,
    owner_assigned: createResult.owner_assigned,
    owner_id: createResult.owner_id,
    owner_email: createResult.owner_email,
    account_executive_assigned: createResult.account_executive_assigned,
    account_executive_property: createResult.account_executive_property,
    account_executive_value: createResult.account_executive_value,
    properties_sent: createResult.properties_sent,
    properties_skipped: createResult.properties_skipped,
    warnings: createResult.warnings,
  };
}

// ── Conversión candidate → account ───────────────────────────

export async function convertCandidateToAccount(id: string): Promise<{ accountId: string; hubspotSync: HubSpotSyncResult }> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const { data: candidate } = await supabase
    .from('prospect_candidates')
    .select('*, batch:prospect_batches!prospect_candidates_batch_id_fkey(source)')
    .eq('id', id)
    .single();

  if (!candidate) throw new Error('Candidato no encontrado');
  if (candidate.status !== 'approved') {
    throw new Error('Solo se pueden convertir candidatos aprobados');
  }

  const batchSource = (candidate.batch as { source?: string })?.source ?? 'manual';
  const accountSource = batchSource === 'agent_1' ? 'agent_1' : 'manual';

  const candidateRaw = candidate as ProspectCandidate & Record<string, unknown>;
  const isStructured = isStructuredCandidate({
    review_status: (candidateRaw.review_status as ProspectCandidate['review_status']) ?? null,
    source_primary: candidate.source_primary,
  });

  const sourceTrace = candidateRaw.source_trace as Record<string, unknown> | null ?? null;
  const accountMeta: Record<string, unknown> = {
    converted_from_candidate_id: id,
    batch_id: candidate.batch_id,
  };
  if (isStructured) {
    accountMeta.source_trace = sourceTrace;
    accountMeta.source_key = sourceTrace?.sourceKey ?? null;
    accountMeta.source_provider = sourceTrace?.sourceProvider ?? null;
    accountMeta.review_flags_at_conversion = (candidateRaw.review_flags as string[] | null) ?? null;
    accountMeta.commercial_fit_status = (candidateRaw.commercial_fit_status as string | null) ?? null;
  }

  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .insert({
      name: candidate.name,
      legal_name: candidate.legal_name ?? null,
      normalized_name: candidate.normalized_name ?? null,
      website: candidate.website ?? null,
      domain: candidate.domain ?? null,
      country: candidate.country ?? null,
      country_code: candidate.country_code ?? null,
      city: candidate.city ?? null,
      region: candidate.region ?? null,
      industry: candidate.industry ?? null,
      company_size: candidate.company_size ?? null,
      tax_identifier: candidate.tax_identifier ?? null,
      tax_identifier_type: candidate.tax_identifier_type ?? null,
      source: accountSource,
      pipeline_status: 'new',
      created_by: internalUserId,
      metadata: accountMeta,
    })
    .select()
    .single();

  if (accountError || !account) {
    throw new Error(`Error al crear cuenta: ${accountError?.message}`);
  }

  const { error: updateError } = await supabase
    .from('prospect_candidates')
    .update({
      status: 'converted_to_account',
      converted_account_id: account.id,
      reviewed_by: internalUserId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateError) throw new Error(`Error al actualizar candidato: ${updateError.message}`);

  // ── Resolver mapeo de owner antes del audit ──
  const { data: userRow } = await supabase
    .from('internal_users')
    .select('email, full_name')
    .eq('id', internalUserId)
    .single();
  const userEmail = userRow?.email?.toLowerCase().trim() ?? '';
  const userFullName = userRow?.full_name ?? '';

  let mappedOwnerId: string | null = null;
  let ownerMappingResolution: 'resolved_supabase' | 'missing_supabase' | 'error_supabase' | 'empty_email' = 'missing_supabase';

  if (!userEmail) {
    ownerMappingResolution = 'empty_email';
  } else {
    try {
      mappedOwnerId = await getHubSpotOwnerMapping(userEmail);
      if (mappedOwnerId) {
        ownerMappingResolution = 'resolved_supabase';
      } else {
        ownerMappingResolution = 'missing_supabase';
      }
    } catch (err) {
      console.error('[convertCandidateToAccount] Error resolving owner mapping:', err);
      ownerMappingResolution = 'error_supabase';
    }
  }

  await logProspectCandidateAudit({
    batchId: candidate.batch_id,
    candidateId: id,
    actorUserId: internalUserId,
    actionType: 'candidate_converted_to_account',
    details: {
      candidate_name: candidate.name,
      account_id: account.id,
      account_source: accountSource,
      hubspot_owner_mapping: {
        email: userEmail,
        resolution: ownerMappingResolution,
        owner_id: mappedOwnerId,
      }
    },
  });

  revalidatePath(`/prospect-batches/${candidate.batch_id}`);
  revalidatePath('/accounts');

  // HubSpot auto-sync — never throws; failure does not fail the conversion
  let hubspotSync: HubSpotSyncResult;
  try {
    const metadata = (candidate.metadata as Record<string, unknown> | null) ?? {};
    const enrichment = (metadata.enrichment as Record<string, unknown> | null) ?? {};
    const webEnrichment = (enrichment.web as Record<string, unknown> | null) ?? {};

    const getLinkedInUrl = () => {
      if (candidate.linkedin_url) return candidate.linkedin_url;
      const meta = (candidate.metadata as Record<string, unknown> | null) ?? {};
      const importObj = meta.import as Record<string, unknown> | undefined;
      if (importObj?.linkedin_url && typeof importObj.linkedin_url === 'string') {
        return importObj.linkedin_url;
      }
      const externalObj = meta.external as Record<string, unknown> | undefined;
      if (externalObj?.linkedin_url && typeof externalObj.linkedin_url === 'string') {
        return externalObj.linkedin_url;
      }
      const validationObj = meta.validation as Record<string, unknown> | undefined;
      const normalizedKeys = validationObj?.normalized_keys as Record<string, unknown> | undefined;
      const normUrl = normalizedKeys?.normalized_linkedin_url;
      if (normUrl && typeof normUrl === 'string' && normUrl.includes('/company/')) {
        return normUrl;
      }
      return null;
    };
    const linkedinUrl = getLinkedInUrl();

    const publicDescObj = webEnrichment.public_description as Record<string, unknown> | null;
    const description =
      (publicDescObj?.text as string | undefined) ??
      (enrichment.description as string | undefined) ??
      (enrichment.public_description as string | undefined) ??
      ((candidate.metadata?.ai_evaluation as Record<string, unknown> | null)?.description as string | undefined) ??
      null;

    hubspotSync = await attemptHubSpotSync({
      accountId: account.id,
      accountName: account.name,
      accountMeta,
      accountCountry: account.country ?? null,
      accountCountryCode: account.country_code ?? null,
      accountTaxIdentifier: account.tax_identifier ?? null,
      accountWebsite: account.website ?? null,
      accountDomain: account.domain ?? null,
      accountCity: account.city ?? null,
      accountRegion: account.region ?? null,
      accountLegalName: (account as Record<string, unknown>).legal_name as string | null ?? null,
      accountCompanySize: (account as Record<string, unknown>).company_size as string | null ?? null,
      candidateDuplicateStatus: (candidateRaw.duplicate_status as string | null) ?? null,
      candidateReviewFlags: (candidateRaw.review_flags as string[] | null) ?? null,
      hubspotOwnerId: mappedOwnerId,
      linkedinUrl,
      industry: candidate.industry ?? null,
      approvedByEmail: mappedOwnerId ? null : userEmail,
      approvedByName: userFullName,
      description,
    });
  } catch {
    hubspotSync = { attempted: false, status: 'failed_create', message: 'Error inesperado en sync' };
  }

  if (hubspotSync) {
    const { data: currentCandidate } = await supabase
      .from('prospect_candidates')
      .select('metadata')
      .eq('id', id)
      .single();

    const existingMeta = currentCandidate?.metadata && typeof currentCandidate.metadata === 'object'
      ? (currentCandidate.metadata as Record<string, unknown>)
      : {};

    const updatedMeta = {
      ...existingMeta,
      hubspot_sync: {
        status: hubspotSync.status,
        company_id: hubspotSync.hubspotCompanyId ?? null,
        sent_property_keys: hubspotSync.sentPropertyKeys ?? null,
        sent_properties_audit: hubspotSync.sentPropertiesAudit ?? null,
        skipped_properties: hubspotSync.skippedProperties ?? null,
        blocked_reason: hubspotSync.status === 'blocked_duplicate' || hubspotSync.status === 'blocked_inactive_or_liquidation'
          ? hubspotSync.message ?? null
          : null,
        owner_mapping_status: hubspotSync.ownerMappingStatus ?? 'skipped',
        owner_assigned: hubspotSync.owner_assigned ?? false,
        owner_id: hubspotSync.owner_id ?? null,
        owner_email: hubspotSync.owner_email ?? null,
        account_executive_assigned: hubspotSync.account_executive_assigned ?? false,
        account_executive_property: hubspotSync.account_executive_property ?? null,
        account_executive_value: hubspotSync.account_executive_value ?? null,
        lifecyclestage_sent: hubspotSync.status === 'synced' ? 'marketingqualifiedlead' : null,
        properties_sent: hubspotSync.properties_sent ?? null,
        properties_skipped: hubspotSync.properties_skipped ?? null,
        warnings: hubspotSync.warnings ?? [],
        synced_at: new Date().toISOString(),
      },
    };

    await supabase
      .from('prospect_candidates')
      .update({ metadata: updatedMeta })
      .eq('id', id);
  }

  if (hubspotSync.status === 'synced') {
    revalidatePath(`/accounts/${account.id}`);
  }

  return { accountId: account.id, hubspotSync };
}

// ── Approve + convert unificado (16AK.14) ────────────────────

export interface CandidateApprovalResult {
  success: boolean;
  sellup: {
    approved: boolean;
    account_created: boolean;
    account_id?: string;
    status: 'approved' | 'failed';
  };
  hubspot: {
    attempted: boolean;
    action: 'created' | 'linked_existing' | 'skipped_possible_match' | 'skipped_not_configured' | 'failed' | 'not_required';
    company_id?: string;
    company_name?: string;
    error?: string;
  };
  message: string;
}

/**
 * Aprueba un candidato y lo convierte a cuenta SellUp en un solo paso.
 * Sincroniza o vincula con HubSpot de forma segura sin crear duplicados.
 */
export async function approveAndConvertCandidateAction(
  id: string
): Promise<CandidateApprovalResult> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  // 1. Cargar candidato
  const { data: candidate, error: candidateErr } = await supabase
    .from('prospect_candidates')
    .select('*, batch:prospect_batches!prospect_candidates_batch_id_fkey(source)')
    .eq('id', id)
    .single();

  if (candidateErr || !candidate) {
    return {
      success: false,
      sellup: { approved: false, account_created: false, status: 'failed' },
      hubspot: { attempted: false, action: 'failed', error: 'Candidato no encontrado' },
      message: 'Candidato no encontrado en SellUp.',
    };
  }

  // 2. Guardia server-side: rechaza si duplicate_status bloquea la aprobación
  if (candidate.duplicate_status) {
    const blockMsg = APPROVE_BLOCK_MESSAGES[candidate.duplicate_status as DuplicateStatus];
    if (blockMsg) {
      return {
        success: false,
        sellup: { approved: false, account_created: false, status: 'failed' },
        hubspot: { attempted: false, action: 'failed', error: blockMsg },
        message: blockMsg,
      };
    }
  }

  // Para candidatos estructurados: exigir review_status = ready_for_approval (o ya procesado)
  const reviewStatus = candidate.review_status ?? null;
  if (reviewStatus !== null && reviewStatus !== undefined) {
    if (reviewStatus !== 'ready_for_approval' && reviewStatus !== 'approved' && reviewStatus !== 'synced_to_hubspot') {
      return {
        success: false,
        sellup: { approved: false, account_created: false, status: 'failed' },
        hubspot: { attempted: false, action: 'failed', error: 'Candidato no listo para aprobación' },
        message: 'Este candidato viene de una fuente oficial. Primero debe marcarse como listo para aprobación.',
      };
    }
  }

  const nowStr = new Date().toISOString();

  // 3. Resolver/Vincular cuenta en SellUp
  let accountId = candidate.matched_account_id;
  if (!accountId && candidate.metadata?.validation?.sellup_duplicate_check?.matched_account_id) {
    accountId = (candidate.metadata.validation.sellup_duplicate_check as Record<string, unknown>).matched_account_id as string | null;
  }

  let accountCreated = false;
  let accountMeta = (candidate.metadata || {}) as Record<string, unknown>;

  if (accountId) {
    const { data: existingAccount } = await supabase
      .from('accounts')
      .select('id, name, metadata, hubspot_company_id')
      .eq('id', accountId)
      .single();

    if (existingAccount) {
      accountId = existingAccount.id;
      accountMeta = (existingAccount.metadata || {}) as Record<string, unknown>;
    } else {
      accountId = null;
    }
  }

  if (!accountId) {
    const batchSource = (candidate.batch as { source?: string })?.source ?? 'manual';
    const accountSource = batchSource === 'agent_1' ? 'agent_1' : 'manual';
    const sourceTrace = candidate.source_trace as Record<string, unknown> | null ?? null;
    const newAccountMeta: Record<string, unknown> = {
      converted_from_candidate_id: id,
      batch_id: candidate.batch_id,
    };
    if (reviewStatus !== null && reviewStatus !== undefined) {
      newAccountMeta.source_trace = sourceTrace;
      newAccountMeta.source_key = sourceTrace?.sourceKey ?? null;
      newAccountMeta.source_provider = sourceTrace?.sourceProvider ?? null;
      newAccountMeta.review_flags_at_conversion = (candidate.review_flags as string[] | null) ?? null;
      newAccountMeta.commercial_fit_status = (candidate.commercial_fit_status as string | null) ?? null;
    }

    const { data: newAccount, error: accountError } = await supabase
      .from('accounts')
      .insert({
        name: candidate.name,
        legal_name: candidate.legal_name ?? null,
        normalized_name: candidate.normalized_name ?? null,
        website: candidate.website ?? null,
        domain: candidate.domain ?? null,
        country: candidate.country ?? null,
        country_code: candidate.country_code ?? null,
        city: candidate.city ?? null,
        region: candidate.region ?? null,
        industry: candidate.industry ?? null,
        company_size: candidate.company_size ?? null,
        tax_identifier: candidate.tax_identifier ?? null,
        tax_identifier_type: candidate.tax_identifier_type ?? null,
        source: accountSource,
        pipeline_status: 'new',
        created_by: internalUserId,
        metadata: newAccountMeta,
      })
      .select()
      .single();

    if (accountError || !newAccount) {
      return {
        success: false,
        sellup: { approved: false, account_created: false, status: 'failed' },
        hubspot: { attempted: false, action: 'failed', error: accountError?.message || 'Error al crear cuenta' },
        message: `Error al crear cuenta en SellUp: ${accountError?.message || 'error desconocido'}`
      };
    }

    accountId = newAccount.id;
    accountCreated = true;
    accountMeta = newAccountMeta;
  }

  // 4. Resolver sincronización / vinculación a HubSpot
  const validation = (candidate.metadata?.validation || {}) as Record<string, unknown>;
  const hsCheck = (validation.hubspot_duplicate_check || {}) as Record<string, unknown>;
  const hsStatus = hsCheck.status as string | undefined;
  const matchedCompanyId = (hsCheck.matched_company_id || candidate.matched_hubspot_company_id) as string | null | undefined;
  const matchedCompanyName = hsCheck.matched_company_name as string | null | undefined;

  let isHubSpotConfigured = false;
  let hasWriteScope = false;
  let connectionError: string | undefined;

  try {
    const connTest = await testHubSpotConnection();
    isHubSpotConfigured = connTest.success;
    hasWriteScope = !!connTest.hubspotScopes?.canWriteCompanies;
    if (!connTest.success) {
      connectionError = connTest.message || connTest.error;
    }
  } catch (e) {
    connectionError = e instanceof Error ? e.message : 'Error al conectar con HubSpot';
  }

  let hubspotAttempted = false;
  let hubspotAction: 'created' | 'linked_existing' | 'skipped_possible_match' | 'skipped_not_configured' | 'failed' | 'not_required' = 'not_required';
  let hubspotCompanyId: string | null = null;
  let hubspotCompanyName: string | null = null;
  let hubspotError: string | null = null;
  let createResult: CreateHubSpotCompanyResult | null = null;
  let ownerMappingDetails: Record<string, unknown> | null = null;

  // Caso A — match HubSpot confirmado
  if (hsStatus === 'match' || matchedCompanyId) {
    hubspotAttempted = true;
    hubspotAction = 'linked_existing';
    hubspotCompanyId = matchedCompanyId ?? null;
    hubspotCompanyName = matchedCompanyName ?? null;
  }
  // Caso B — possible_match HubSpot
  else if (hsStatus === 'possible_match') {
    hubspotAttempted = false;
    hubspotAction = 'skipped_possible_match';
    hubspotCompanyName = matchedCompanyName ?? null;
  }
  // Caso C / D — no_match HubSpot u otros estados (e.g. unchecked, error en validación previa)
  else {
    if (!isHubSpotConfigured || !hasWriteScope) {
      hubspotAttempted = false;
      hubspotAction = 'skipped_not_configured';
      hubspotError = connectionError ?? 'HubSpot no configurado o sin permisos de escritura';
    } else {
      hubspotAttempted = true;

      // Enriquecimiento y fallbacks para campos adicionales
      const enrichment = (candidate.metadata?.enrichment as Record<string, unknown> | null) ?? {};
      const webEnrichment = (enrichment.web as Record<string, unknown> | null) ?? {};

      const getLinkedInUrl = () => {
        if (candidate.linkedin_url) return candidate.linkedin_url;
        const meta = (candidate.metadata as Record<string, unknown> | null) ?? {};
        const importObj = meta.import as Record<string, unknown> | undefined;
        if (importObj?.linkedin_url && typeof importObj.linkedin_url === 'string') {
          return importObj.linkedin_url;
        }
        const externalObj = meta.external as Record<string, unknown> | undefined;
        if (externalObj?.linkedin_url && typeof externalObj.linkedin_url === 'string') {
          return externalObj.linkedin_url;
        }
        const validationObj = meta.validation as Record<string, unknown> | undefined;
        const normalizedKeys = validationObj?.normalized_keys as Record<string, unknown> | undefined;
        const normUrl = normalizedKeys?.normalized_linkedin_url;
        if (normUrl && typeof normUrl === 'string' && normUrl.includes('/company/')) {
          return normUrl;
        }
        return null;
      };
      const linkedinUrl = getLinkedInUrl();

      const publicDescObj = webEnrichment.public_description as Record<string, unknown> | null;
      const description =
        (publicDescObj?.text as string | undefined) ??
        (enrichment.description as string | undefined) ??
        (enrichment.public_description as string | undefined) ??
        ((candidate.metadata?.ai_evaluation as Record<string, unknown> | null)?.description as string | undefined) ??
        null;

      const { data: userRow } = await supabase
        .from('internal_users')
        .select('email, full_name')
        .eq('id', internalUserId)
        .single();
      const userEmail = userRow?.email?.toLowerCase().trim() ?? '';
      const userFullName = userRow?.full_name ?? '';

      // Resolviendo el mapping dinámicamente desde Supabase
      let mappedOwnerId: string | null = null;
      let ownerMappingResolution: 'resolved_supabase' | 'missing_supabase' | 'error_supabase' | 'empty_email' = 'missing_supabase';

      if (!userEmail) {
        ownerMappingResolution = 'empty_email';
      } else {
        try {
          mappedOwnerId = await getHubSpotOwnerMapping(userEmail);
          if (mappedOwnerId) {
            ownerMappingResolution = 'resolved_supabase';
          } else {
            ownerMappingResolution = 'missing_supabase';
          }
        } catch (err) {
          console.error('[approveAndConvertCandidateAction] Error resolving owner mapping:', err);
          ownerMappingResolution = 'error_supabase';
        }
      }

      ownerMappingDetails = {
        email: userEmail,
        resolution: ownerMappingResolution,
        owner_id: mappedOwnerId,
      };

      createResult = await createHubSpotCompany({
        name: candidate.name,
        country: candidate.country ?? null,
        countryCode: candidate.country_code ?? null,
        taxIdentifier: candidate.tax_identifier ?? null,
        website: candidate.website ?? null,
        domain: candidate.domain ?? null,
        city: candidate.city ?? null,
        region: candidate.region ?? null,
        legalName: candidate.legal_name ?? null,
        numberOfEmployees: candidate.company_size ?? null,
        hubspotOwnerId: mappedOwnerId,
        linkedinUrl,
        industry: candidate.industry ?? null,
        description,
        approvedByEmail: mappedOwnerId ? null : userEmail,
        approvedByName: userFullName,
      });

      if (createResult.ok && createResult.hubspotCompanyId) {
        hubspotAction = 'created';
        hubspotCompanyId = createResult.hubspotCompanyId;
        hubspotCompanyName = candidate.name;
      } else {
        hubspotAction = 'failed';
        hubspotError = createResult.error || 'Error al crear en HubSpot';
      }
    }
  }

  // 5. Aplicar cambios a las tablas en Supabase
  const accountMetadataPatch: Record<string, unknown> = {};
  if (hubspotAction === 'created' || hubspotAction === 'linked_existing') {
    accountMetadataPatch.hubspot_sync_status = 'synced';
    accountMetadataPatch.hubspot_sync_method = 'auto';
    accountMetadataPatch.hubspot_sync_attempted_at = nowStr;
    accountMetadataPatch.hubspot_synced_at = nowStr;
    accountMetadataPatch.hubspot_company_id = hubspotCompanyId;
    accountMetadataPatch.hubspot_match_status_at_sync = hubspotAction === 'created' ? 'no_match' : 'match';
    accountMetadataPatch.hubspot_sync_source = 'candidate_conversion';
    accountMetadataPatch.hubspot_sync = {
      status: 'synced',
      company_id: hubspotCompanyId,
      synced_at: nowStr,
      owner_mapping_status: hubspotAction === 'created' ? (createResult?.ownerMappingStatus ?? 'mapped') : 'skipped',
      owner_assigned: createResult?.owner_assigned ?? false,
      owner_id: createResult?.owner_id ?? null,
      owner_email: createResult?.owner_email ?? null,
      account_executive_assigned: createResult?.account_executive_assigned ?? false,
      account_executive_property: createResult?.account_executive_property ?? null,
      account_executive_value: createResult?.account_executive_value ?? null,
      lifecyclestage_sent: 'marketingqualifiedlead',
      properties_sent: createResult?.properties_sent ?? null,
      properties_skipped: createResult?.properties_skipped ?? null,
      warnings: createResult?.warnings ?? [],
    };
  } else if (hubspotAction === 'skipped_possible_match') {
    accountMetadataPatch.hubspot_sync_status = 'blocked_duplicate';
    accountMetadataPatch.hubspot_sync_blocked_reason = 'skipped_possible_match';
    accountMetadataPatch.hubspot_sync_method = 'auto';
    accountMetadataPatch.hubspot_sync_attempted_at = nowStr;
  } else if (hubspotAction === 'skipped_not_configured') {
    accountMetadataPatch.hubspot_sync_status = 'skipped_no_connection';
    accountMetadataPatch.hubspot_sync_method = 'auto';
    accountMetadataPatch.hubspot_sync_attempted_at = nowStr;
  } else if (hubspotAction === 'failed') {
    accountMetadataPatch.hubspot_sync_status = 'failed_create';
    accountMetadataPatch.hubspot_sync_method = 'auto';
    accountMetadataPatch.hubspot_sync_attempted_at = nowStr;
    accountMetadataPatch.hubspot_sync_error = hubspotError?.slice(0, 200) || 'unknown';
  }

  const updatedAccountMetadata = {
    ...accountMeta,
    ...accountMetadataPatch,
  };

  const accountUpdates: Record<string, unknown> = {
    metadata: updatedAccountMetadata,
    updated_at: nowStr,
  };

  if (hubspotCompanyId) {
    accountUpdates.hubspot_company_id = hubspotCompanyId;
  }

  await supabase
    .from('accounts')
    .update(accountUpdates)
    .eq('id', accountId);

  // Formatear candidate.metadata.hubspot_sync para compatibilidad del panel de detalle
  const candidateHubspotSync: Record<string, unknown> = {
    status: hubspotAction === 'created' || hubspotAction === 'linked_existing' ? 'synced' :
            hubspotAction === 'skipped_possible_match' ? 'blocked_duplicate' :
            hubspotAction === 'skipped_not_configured' ? 'skipped_no_connection' :
            hubspotAction === 'failed' ? 'failed_create' : 'skipped_flag_off',
    company_id: hubspotCompanyId ?? null,
    blocked_reason: hubspotAction === 'skipped_possible_match' ? 'skipped_possible_match' :
                    hubspotAction === 'skipped_not_configured' ? 'HubSpot no está configurado' :
                    hubspotAction === 'failed' ? hubspotError : null,
    synced_at: hubspotAction === 'created' || hubspotAction === 'linked_existing' ? nowStr : null,
    owner_assigned: createResult?.owner_assigned ?? false,
    owner_id: createResult?.owner_id ?? null,
    owner_email: createResult?.owner_email ?? null,
    account_executive_assigned: createResult?.account_executive_assigned ?? false,
    account_executive_property: createResult?.account_executive_property ?? null,
    account_executive_value: createResult?.account_executive_value ?? null,
    lifecyclestage_sent: hubspotAction === 'created' ? 'marketingqualifiedlead' : null,
    properties_sent: createResult?.properties_sent ?? null,
    properties_skipped: createResult?.properties_skipped ?? null,
    warnings: createResult?.warnings ?? [],
  };

  const approvalMetadata = {
    approved_at: nowStr,
    approved_by: internalUserId,
    sellup: {
      account_created: accountCreated,
      account_id: accountId,
      action: accountCreated ? 'created' : 'linked_existing',
    },
    hubspot: {
      attempted: hubspotAttempted,
      action: hubspotAction,
      company_id: hubspotCompanyId ?? undefined,
      company_name: hubspotCompanyName ?? undefined,
      error: hubspotError ?? undefined,
      owner_assigned: createResult?.owner_assigned ?? false,
      owner_id: createResult?.owner_id ?? null,
      owner_email: createResult?.owner_email ?? null,
      account_executive_assigned: createResult?.account_executive_assigned ?? false,
      account_executive_property: createResult?.account_executive_property ?? null,
      account_executive_value: createResult?.account_executive_value ?? null,
      properties_sent: createResult?.properties_sent ?? null,
      properties_skipped: createResult?.properties_skipped ?? null,
      warnings: createResult?.warnings ?? [],
      synced_at: nowStr,
    },
  };

  const candidateMeta = (candidate.metadata || {}) as Record<string, unknown>;
  const updatedCandidateMeta = {
    ...candidateMeta,
    approval: approvalMetadata,
    hubspot_sync: candidateHubspotSync,
  };

  const candidateUpdates: Record<string, unknown> = {
    status: 'converted_to_account',
    converted_account_id: accountId,
    reviewed_by: internalUserId,
    reviewed_at: nowStr,
    metadata: updatedCandidateMeta,
    updated_at: nowStr,
  };

  if (reviewStatus !== null && reviewStatus !== undefined) {
    candidateUpdates.review_status = (hubspotAction === 'created' || hubspotAction === 'linked_existing')
      ? 'synced_to_hubspot'
      : 'approved';
  }

  await supabase
    .from('prospect_candidates')
    .update(candidateUpdates)
    .eq('id', id);

  // 6. Registrar logs de auditoría
  try {
    await logProspectCandidateAudit({
      batchId: candidate.batch_id,
      candidateId: id,
      actorUserId: internalUserId,
      actionType: 'candidate_approved',
      details: { candidate_name: candidate.name },
    });

    await logProspectCandidateAudit({
      batchId: candidate.batch_id,
      candidateId: id,
      actorUserId: internalUserId,
      actionType: 'candidate_converted_to_account',
      details: {
        candidate_name: candidate.name,
        account_id: accountId,
        account_source: accountCreated ? 'manual' : 'linked_existing',
        ...(ownerMappingDetails ? { hubspot_owner_mapping: ownerMappingDetails } : {}),
      },
    });
  } catch (auditErr) {
    console.warn('[approveAndConvertCandidateAction] Non-critical audit error:', auditErr);
  }

  revalidatePath(`/prospect-batches/${candidate.batch_id}`);
  revalidatePath('/accounts');

  let responseMessage = '';
  if (hubspotAction === 'created') {
    if (createResult?.owner_assigned === false || createResult?.ownerMappingStatus === 'skipped_missing_mapping') {
      responseMessage = 'Candidato aprobado y empresa creada en HubSpot, pero no se encontró owner para asignar.';
    } else {
      responseMessage = 'Candidato aprobado y empresa creada en HubSpot.';
    }
    if (createResult?.properties_skipped && createResult.properties_skipped.length > 0) {
      responseMessage += ' Algunos campos no existen en HubSpot y fueron omitidos.';
    }
  } else if (hubspotAction === 'linked_existing') {
    responseMessage = 'Candidato aprobado y vinculado a empresa existente en HubSpot.';
  } else if (hubspotAction === 'skipped_possible_match') {
    responseMessage = 'Candidato aprobado en SellUp, pero HubSpot requiere revisión por posible coincidencia.';
  } else if (hubspotAction === 'skipped_not_configured') {
    responseMessage = 'Candidato aprobado en SellUp. HubSpot no está configurado.';
  } else if (hubspotAction === 'failed') {
    responseMessage = `Candidato aprobado en SellUp, pero falló la creación en HubSpot.`;
  } else {
    responseMessage = 'Candidato aprobado en SellUp.';
  }

  return {
    success: true,
    sellup: {
      approved: true,
      account_created: accountCreated,
      account_id: accountId,
      status: 'approved',
    },
    hubspot: {
      attempted: hubspotAttempted,
      action: hubspotAction,
      company_id: hubspotCompanyId ?? undefined,
      company_name: hubspotCompanyName ?? undefined,
      error: hubspotError ?? undefined,
    },
    message: responseMessage,
  };
}

// ── Usuarios para selectores ──────────────────────────────────

export async function getActiveUsers(): Promise<InternalUserOption[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from('internal_users')
    .select('id, full_name, email')
    .eq('access_status', 'active')
    .order('full_name', { ascending: true });

  return (data ?? []) as InternalUserOption[];
}

// ── Auditoría de un lote ──────────────────────────────────────

export async function getBatchAudit(batchId: string): Promise<ProspectCandidateAudit[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from('prospect_candidate_audit')
    .select(`
      *,
      actor:internal_users!prospect_candidate_audit_actor_user_id_fkey(full_name, email)
    `)
    .eq('batch_id', batchId)
    .order('created_at', { ascending: false });

  return (data ?? []) as ProspectCandidateAudit[];
}

// ── Cambio de estado de lote (shortcut) ───────────────────────

export async function changeBatchStatus(id: string, status: BatchStatus): Promise<void> {
  await updateProspectBatch(id, { status });
}

// ── Agente 1: Generación asistida de empresas candidatas ──────

export interface GenerateAIBatchInput {
  country: string;
  countryCode: string;
  industry: string;
  targetCount: number;
  searchDepth: 'basic' | 'standard';
  /** Hito 16AJ.6 — apagado por defecto. Si true, ejecuta preflight read-only de fuentes estructuradas. */
  structuredSourcePreflight?: boolean;
  /** Hito 16AJ.6 — fuente explícita. Si omitido, se resuelve por countryCode. */
  structuredSourceKey?: string | null;
  /** Hito 16AJ.9 — Crear también lote estructurado */
  createStructuredSourceBatch?: boolean;
  /** Hito 16AK.2D — Página de paginación RUES (1-5). Default: 1. Solo en modo manual. */
  structuredSourcePage?: number;
  /** Hito 16AK.7C — Si true, auto-pagina RUES (páginas 1–5) hasta encontrar candidatos nuevos. */
  structuredSourcePageAuto?: boolean;
}

export interface GenerateAIBatchResult {
  ok?: boolean;
  batchId: string | null;
  candidatesCreated: number;
  estimatedCostUsd: number;
  /** Hito 16AJ.6 — presente solo si structuredSourcePreflight=true. Read-only, no escribe candidatos. */
  structuredSourcePreflight?: SourceDiscoveryPreflightResult;
  /** Hito 16AJ.9 — Lote estructurado creado opcionalmente */
  structuredSourceBatch?: {
    ok: boolean;
    batchId?: string | null;
    sourceKey?: string;
    candidatesWritten?: number;
    candidatesSkipped?: number;
    warnings?: string[];
    errors?: string[];
    /** Hito 16AK.7C — página efectiva usada */
    pageUsed?: number;
    /** Hito 16AK.7C — páginas revisadas en auto-paginación */
    pagesScanned?: number[];
    /** Hito 16AK.7C — true si se usó auto-paginación */
    autoMode?: boolean;
  };
  /** Hito 16AK.10 — Estrategia de fuentes aplicada en esta generación */
  sourceStrategy?: 'official_source_satisfied' | 'official_plus_commercial' | 'commercial_fallback' | 'commercial_only' | 'no_useful_candidates' | 'official_source_only_no_useful_candidates';
  /** Hito 16AK.10 — Disposición de la fuente comercial (Apollo) */
  commercialBatch?: {
    skipped: boolean;
    reason?: 'official_source_satisfied' | 'official_source_failed' | 'insufficient_official_results' | 'chile_preview_no_apollo';
    batchId?: string | null;
  };
  message?: string;
  omittedCandidatesCount?: number;
  usefulCandidatesCount?: number;
}

export async function runProspectPreflight(params: {
  country: string;
  countryCode: string;
  industry: string;
  targetCount: number;
  searchDepth: 'basic' | 'standard';
}): Promise<SourceDiscoveryPreflightResult> {
  await requireActiveUser();
  return await runAgentSourceDiscoveryPreflight({
    countryCode: params.countryCode,
    country: params.country,
    industry: params.industry,
    targetCount: Math.min(params.targetCount, 5),
    searchDepth: params.searchDepth,
    enabled: true,
  });
}

export async function generateAIProspectBatch(
  input: GenerateAIBatchInput
): Promise<GenerateAIBatchResult> {
  const { internalUserId } = await requireActiveUser();

  if (!input.country || !input.countryCode) {
    throw new Error('País requerido para la generación asistida');
  }
  if (!input.industry) {
    throw new Error('Industria requerida para la generación asistida');
  }
  const isColombia = input.countryCode === 'CO';
  const isChileInput = input.countryCode === 'CL';
  const minTargetCount = (isColombia || isChileInput) ? 5 : 10;
  if (input.targetCount < minTargetCount || input.targetCount > MVP_MAX_CANDIDATES) {
    throw new Error(`La cantidad debe estar entre ${minTargetCount} y ${MVP_MAX_CANDIDATES}`);
  }

  const result = await runProspectGenerationAgent({
    country: input.country,
    countryCode: input.countryCode,
    industry: input.industry,
    targetCount: input.targetCount,
    searchDepth: input.searchDepth,
    internalUserId,
    structuredSourcePreflight: input.structuredSourcePreflight ?? false,
    structuredSourceKey: input.structuredSourceKey ?? null,
    createStructuredSourceBatch: input.createStructuredSourceBatch ?? false,
    structuredSourcePage: input.structuredSourcePage ?? 1,
    structuredSourcePageAuto: input.structuredSourcePageAuto ?? false,
  });

  if (!result.success) {
    throw new Error(result.error ?? 'El agente no pudo generar candidatos');
  }

  revalidatePath('/prospect-batches');
  if (result.batchId) {
    revalidatePath(`/prospect-batches/${result.batchId}`);
  }
  if (result.structuredSourceBatch?.batchId) {
    revalidatePath(`/prospect-batches/${result.structuredSourceBatch.batchId}`);
  }

  return {
    ok: result.ok,
    batchId: result.batchId,
    candidatesCreated: result.candidatesCreated,
    estimatedCostUsd: result.estimatedCostUsd,
    structuredSourcePreflight: result.structuredSourcePreflight,
    structuredSourceBatch: result.structuredSourceBatch,
    sourceStrategy: result.sourceStrategy,
    commercialBatch: result.commercialBatch,
    message: result.message,
    omittedCandidatesCount: result.omittedCandidatesCount,
    usefulCandidatesCount: result.usefulCandidatesCount,
  };
}

// ── Agente 1 (Tavily): Búsqueda web multi-query ───────────────

export interface GenerateTavilyBatchInput {
  country: string;
  countryCode: string;
  industry: string;
}

const TAVILY_TARGET_COUNT = 10;

export interface GenerateTavilyBatchResult {
  batchId: string;
  candidatesCreated: number;
  status: string;
}

export async function generateTavilyProspectBatch(
  input: GenerateTavilyBatchInput
): Promise<GenerateTavilyBatchResult> {
  const { internalUserId } = await requireActiveUser();

  if (!input.country || !input.countryCode) {
    throw new Error('País requerido para la búsqueda web');
  }
  if (!input.industry) {
    throw new Error('Industria requerida para la búsqueda web');
  }

  const now = new Date();
  const batchName = `IA web · ${input.country} · ${input.industry} · ${now.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}`;

  const result = await runIncrementalProspectingSearch({
    country: input.country,
    countryCode: input.countryCode,
    industry: input.industry,
    webSearchProvider: 'tavily',
    targetInternal: TAVILY_TARGET_COUNT,
    dryRun: false,
    triggeredByUserId: internalUserId,
    ownerId: internalUserId,
    batchName,
  });

  if (!result.batchId) {
    const firstWarning = result.warnings[0] ?? 'La búsqueda incremental no pudo generar candidatos';
    throw new Error(firstWarning);
  }

  revalidatePath('/prospect-batches');
  revalidatePath(`/prospect-batches/${result.batchId}`);

  return {
    batchId: result.batchId,
    candidatesCreated: result.candidatesCreated ?? result.usefulCandidatesCount,
    status: result.metadata.stopped_reason,
  };
}

// ── Rollback lógico de conversión candidate → account ─────────

export async function rollbackCandidateAccountConversionAction(
  candidateId: string,
  reason: string
): Promise<{
  ok: boolean;
  candidateId?: string;
  accountId?: string;
  accountRolledBack?: boolean;
  candidateStatus?: string;
  error?: string;
}> {
  try {
    const { internalUserId } = await requireAdmin();
    const supabase = await createClient();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!candidateId || !uuidRegex.test(candidateId)) {
      return { ok: false, error: 'ID de candidato inválido' };
    }

    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      return { ok: false, error: 'El motivo del rollback es obligatorio' };
    }

    // 1. Leer candidato
    const { data: candidate } = await supabase
      .from('prospect_candidates')
      .select('id, batch_id, name, status, review_status, source_primary, converted_account_id, commercial_trace, metadata')
      .eq('id', candidateId)
      .single();

    if (!candidate) {
      return { ok: false, error: 'Candidato no encontrado' };
    }

    // 2. Validar estado del candidato
    if (candidate.status !== 'converted_to_account') {
      return {
        ok: false,
        error: `Solo se puede revertir una conversión. El candidato está en estado: ${candidate.status}`,
      };
    }

    if (!candidate.converted_account_id) {
      return { ok: false, error: 'El candidato no tiene account vinculada para revertir' };
    }

    // 3. Validar que es candidato estructurado
    const candidateRaw = candidate as typeof candidate & Record<string, unknown>;
    const candidateReviewStatus = candidateRaw.review_status as string | null | undefined;
    const candidateSource = candidateRaw.source_primary as string | null | undefined;
    const isStructured = candidateReviewStatus !== null && candidateReviewStatus !== undefined;
    const isStructuredSource = candidateSource === 'socrata_colombia' || candidateSource === 'denue_mexico';

    if (!isStructured && !isStructuredSource) {
      return {
        ok: false,
        error: 'Esta acción solo aplica a candidatos de fuentes estructuradas oficiales (RUES, DENUE)',
      };
    }

    const accountId = candidate.converted_account_id;

    // 4. Leer account
    const { data: account } = await supabase
      .from('accounts')
      .select('id, name, hubspot_company_id, metadata')
      .eq('id', accountId)
      .single();

    if (!account) {
      return { ok: false, error: 'La cuenta vinculada no fue encontrada' };
    }

    // 5. Bloquear si ya tiene rollback aplicado
    const accountMeta = (account.metadata as Record<string, unknown>) ?? {};
    if (accountMeta.rollback_logical === true) {
      return {
        ok: false,
        error: 'Esta conversión ya fue revertida previamente',
      };
    }

    // 6. Bloquear si la account está sincronizada a HubSpot
    if (account.hubspot_company_id) {
      return {
        ok: false,
        error: 'No se puede revertir una cuenta ya sincronizada con HubSpot desde este flujo.',
      };
    }
    // También revisar metadata por si hay referencia HubSpot en metadata
    if (accountMeta.hubspot_id || accountMeta.hubspot_company_id) {
      return {
        ok: false,
        error: 'No se puede revertir una cuenta con referencia HubSpot en metadata.',
      };
    }

    const nowStr = new Date().toISOString();

    // 7. Actualizar account — rollback lógico en metadata
    const updatedAccountMeta: Record<string, unknown> = {
      ...accountMeta,
      rollback_logical: true,
      rollback_scope: 'candidate_to_account_conversion',
      rollback_reason: trimmedReason,
      rollback_by: internalUserId,
      rollback_at: nowStr,
      converted_candidate_id: candidateId,
      operational_status: 'rolled_back',
      hidden_from_active_pipeline: true,
    };

    const { error: accountUpdateError } = await supabase
      .from('accounts')
      .update({
        metadata: updatedAccountMeta,
        updated_at: nowStr,
      })
      .eq('id', accountId);

    if (accountUpdateError) {
      return {
        ok: false,
        error: `Error al marcar la cuenta como rollback: ${accountUpdateError.message}`,
      };
    }

    // 8. Actualizar candidato — vuelve a approved, commercial_trace registra rollback
    // Se conserva converted_account_id para trazabilidad (Opción C)
    const existingTrace = ((candidateRaw.commercial_trace) as Record<string, unknown> | null) ?? {};
    const updatedTrace: Record<string, unknown> = {
      ...existingTrace,
      conversionRollback: true,
      conversionRollbackAt: nowStr,
      conversionRollbackBy: internalUserId,
      conversionRollbackReason: trimmedReason,
      rolledBackAccountId: accountId,
    };

    const candidateUpdates: Record<string, unknown> = {
      status: 'approved',
      commercial_trace: updatedTrace,
      updated_at: nowStr,
    };

    // Mantener review_status en approved si era estructurado
    if (isStructured) {
      candidateUpdates.review_status = 'approved';
    }

    const { error: candidateUpdateError } = await supabase
      .from('prospect_candidates')
      .update(candidateUpdates)
      .eq('id', candidateId);

    if (candidateUpdateError) {
      return {
        ok: false,
        error: `Error al actualizar el candidato: ${candidateUpdateError.message}`,
      };
    }

    // 9. Audit log
    try {
      await logProspectCandidateAudit({
        batchId: candidate.batch_id,
        candidateId,
        actorUserId: internalUserId,
        actionType: 'candidate_updated',
        details: {
          candidate_name: candidate.name,
          action: 'conversion_rollback',
          rolled_back_account_id: accountId,
          rollback_reason: trimmedReason,
          previous_status: 'converted_to_account',
          new_status: 'approved',
        },
      });
    } catch (auditErr) {
      console.warn('[rollbackCandidateAccountConversionAction] Audit non-critical failure:', auditErr);
    }

    revalidatePath(`/prospect-batches/${candidate.batch_id}`);
    revalidatePath('/accounts');

    return {
      ok: true,
      candidateId,
      accountId,
      accountRolledBack: true,
      candidateStatus: 'approved',
    };
  } catch (err) {
    console.error('[rollbackCandidateAccountConversionAction] Unexpected error:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado al aplicar rollback',
    };
  }
}

export async function rollbackStructuredAgentBatchAction(
  batchId: string,
  reason?: string
): Promise<{
  ok: boolean;
  batchId: string;
  candidatesUpdated: number;
  batchStatus: string;
  rollbackLogical: boolean;
  error?: string;
}> {
  const { internalUserId } = await requireAdmin();
  const supabase = await createClient();

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(batchId)) {
    return {
      ok: false,
      batchId,
      candidatesUpdated: 0,
      batchStatus: '',
      rollbackLogical: false,
      error: 'El ID del lote no es un UUID válido.',
    };
  }

  // 1. Leer lote
  const { data: batch, error: batchErr } = await supabase
    .from('prospect_batches')
    .select('*')
    .eq('id', batchId)
    .single();

  if (batchErr || !batch) {
    return {
      ok: false,
      batchId,
      candidatesUpdated: 0,
      batchStatus: '',
      rollbackLogical: false,
      error: 'El lote de prospección no existe.',
    };
  }

  // 2. Validar que es lote estructurado de Agente 1 (socrata_colombia / co_rues)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (batch.metadata as Record<string, any>) || {};
  const isAgent1 = meta.initiated_by === 'agent_1';
  const isStructured = meta.batch_type === 'structured';
  const isCoRues = meta.source_key === 'co_rues';
  const isSocrata = batch.source === 'socrata_colombia';

  if (!isAgent1 || !isStructured || !isCoRues || !isSocrata) {
    return {
      ok: false,
      batchId,
      candidatesUpdated: 0,
      batchStatus: batch.status,
      rollbackLogical: false,
      error: 'Esta acción solo está permitida para lotes estructurados de co_rues creados por el Agente 1.',
    };
  }

  // 3. Validar que no está ya cancelado
  if (batch.status === 'cancelled') {
    return {
      ok: false,
      batchId,
      candidatesUpdated: 0,
      batchStatus: batch.status,
      rollbackLogical: false,
      error: 'El lote ya se encuentra cancelado.',
    };
  }

  // 4. Validar que el estado actual permita rollback
  const allowedStatuses = ['ready_for_review', 'preview', 'draft', 'in_review'];
  if (!allowedStatuses.includes(batch.status)) {
    return {
      ok: false,
      batchId,
      candidatesUpdated: 0,
      batchStatus: batch.status,
      rollbackLogical: false,
      error: `No se puede aplicar rollback a un lote en estado '${batch.status}'.`,
    };
  }

  // 5. Validar candidatos convertidos o vinculados a cuentas
  const { data: candidates, error: candErr } = await supabase
    .from('prospect_candidates')
    .select('id, name, converted_account_id, account_id, metadata')
    .eq('batch_id', batchId);

  if (candErr) {
    return {
      ok: false,
      batchId,
      candidatesUpdated: 0,
      batchStatus: batch.status,
      rollbackLogical: false,
      error: 'Error al consultar las empresas candidatas del lote.',
    };
  }

  const hasConverted = candidates?.some((c) => c.converted_account_id !== null);
  if (hasConverted) {
    return {
      ok: false,
      batchId,
      candidatesUpdated: 0,
      batchStatus: batch.status,
      rollbackLogical: false,
      error: 'No se puede aplicar rollback porque existen candidatos convertidos.',
    };
  }

  const hasAccountLinked = candidates?.some((c) => c.account_id !== null);
  if (hasAccountLinked) {
    return {
      ok: false,
      batchId,
      candidatesUpdated: 0,
      batchStatus: batch.status,
      rollbackLogical: false,
      error: 'No se puede aplicar rollback porque existen candidatos asociados a una cuenta.',
    };
  }

  const rollbackReason = reason || '16AJ.10 structured co_rues agent_1 QA rollback';
  const nowStr = new Date().toISOString();

  // 6. Actualizar candidatos de forma secuencial segura
  let candidatesUpdated = 0;
  if (candidates && candidates.length > 0) {
    const updatePromises = candidates.map((c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentMeta = (c.metadata as Record<string, any>) || {};
      const updatedMeta = {
        ...currentMeta,
        rollback_logical: true,
        rollback_logical_at: nowStr,
        rollback_reason: rollbackReason,
        rollback_scope: 'agent_1_structured_batch',
        rollback_by: internalUserId,
      };

      return supabase
        .from('prospect_candidates')
        .update({
          status: 'discarded',
          review_status: 'rejected',
          updated_at: nowStr,
          metadata: updatedMeta,
        })
        .eq('id', c.id);
    });

    const updateResults = await Promise.all(updatePromises);
    const errors = updateResults.filter((r) => r.error);
    if (errors.length > 0) {
      console.error('Error al actualizar candidatos durante rollback:', errors);
      return {
        ok: false,
        batchId,
        candidatesUpdated: 0,
        batchStatus: batch.status,
        rollbackLogical: false,
        error: 'Error al actualizar uno o más candidatos durante el rollback lógico.',
      };
    }
    candidatesUpdated = candidates.length;
  }

  // 7. Actualizar el lote
  const updatedBatchMeta = {
    ...meta,
    rollback_logical: true,
    rollback_logical_at: nowStr,
    rollback_reason: rollbackReason,
    rollback_scope: 'agent_1_structured_batch',
    rollback_by: internalUserId,
  };

  const { error: batchUpdateErr } = await supabase
    .from('prospect_batches')
    .update({
      status: 'cancelled',
      updated_at: nowStr,
      metadata: updatedBatchMeta,
    })
    .eq('id', batchId);

  if (batchUpdateErr) {
    console.error('Error al actualizar lote durante rollback:', batchUpdateErr);
    return {
      ok: false,
      batchId,
      candidatesUpdated,
      batchStatus: batch.status,
      rollbackLogical: false,
      error: 'Error al cancelar el lote de prospección.',
    };
  }

  // 8. Log de auditoría
  await logProspectCandidateAudit({
    batchId,
    actorUserId: internalUserId,
    actionType: 'batch_status_changed',
    details: {
      from_status: batch.status,
      to_status: 'cancelled',
      rollback: true,
      reason: rollbackReason,
      candidates_count: candidatesUpdated,
    },
  });

  revalidatePath('/prospect-batches');
  revalidatePath(`/prospect-batches/${batchId}`);

  return {
    ok: true,
    batchId,
    candidatesUpdated,
    batchStatus: 'cancelled',
    rollbackLogical: true,
  };
}

// ── Rehydrate structured batch candidates ─────────────────────

export type RehydrateBatchResult = {
  ok: boolean;
  updatedCount: number;
  skippedCount: number;
  warnings: string[];
  errors: string[];
  error?: string;
};

/**
 * Recalcula enrichment (sector, review_flags, completitud, metadata.enrichment)
 * para candidatos RUES/co_rues existentes en un lote estructurado.
 *
 * GARANTÍAS:
 *   - Solo admin.
 *   - Solo lotes structured/co_rues/socrata_colombia.
 *   - NO cambia status/review_status/duplicate_status/converted_account_id.
 *   - NO toca HubSpot ni accounts.
 *   - NO crea deals, contactos, tasks ni notes.
 */
export async function rehydrateStructuredBatchCandidatesAction(
  batchId: string,
): Promise<RehydrateBatchResult> {
  // Importación dinámica para evitar bundle en cliente
  const { rehydrateStructuredCandidateEnrichment } =
    await import('@/server/agents/prospecting-toolkit/rehydrate-structured-candidate');

  const { internalUserId } = await requireAdmin();
  const supabase = await createClient();

  if (!batchId || !/^[0-9a-f-]{36}$/.test(batchId)) {
    return { ok: false, updatedCount: 0, skippedCount: 0, warnings: [], errors: [], error: 'UUID de lote inválido' };
  }

  // Cargar lote
  const { data: batchRaw, error: batchError } = await supabase
    .from('prospect_batches')
    .select('id, status, metadata, source')
    .eq('id', batchId)
    .single();

  if (batchError || !batchRaw) {
    return { ok: false, updatedCount: 0, skippedCount: 0, warnings: [], errors: [], error: 'Lote no encontrado' };
  }

  const batchMeta = (batchRaw.metadata ?? {}) as Record<string, unknown>;
  const batchType = batchMeta.batch_type as string | undefined;
  const sourceKey = batchMeta.source_key as string | undefined;
  const sourceProvider = batchMeta.source_provider as string | undefined;
  const batchSource = batchRaw.source as string | undefined;

  const isRues =
    batchType === 'structured' &&
    (sourceKey === 'co_rues' || sourceProvider === 'socrata_colombia' || batchSource === 'socrata_colombia');

  if (!isRues) {
    return {
      ok: false,
      updatedCount: 0,
      skippedCount: 0,
      warnings: [],
      errors: [],
      error: 'Este lote no es de tipo structured RUES/co_rues. Solo se pueden reprocesar lotes de fuente oficial colombiana.',
    };
  }

  // Cargar candidatos del lote
  const { data: candidatesRaw, error: candidatesError } = await supabase
    .from('prospect_candidates')
    .select('id, name, tax_identifier, website, city, region, review_flags, metadata, sector_code, sector_description, legal_status, converted_account_id')
    .eq('batch_id', batchId);

  if (candidatesError) {
    return { ok: false, updatedCount: 0, skippedCount: 0, warnings: [], errors: [], error: `Error al cargar candidatos: ${candidatesError.message}` };
  }

  const candidates = candidatesRaw ?? [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let updatedCount = 0;
  let skippedCount = 0;

  for (const rawCandidate of candidates) {
    try {
      const candidate = rawCandidate as {
        id: string;
        name: string;
        tax_identifier: string | null;
        website: string | null;
        city: string | null;
        region: string | null;
        review_flags: string[] | null;
        metadata: Record<string, unknown>;
        sector_code: string | null;
        sector_description: string | null;
        legal_status: string | null;
        converted_account_id: string | null;
      };

      const enrichment = rehydrateStructuredCandidateEnrichment({
        id: candidate.id,
        name: candidate.name,
        tax_identifier: candidate.tax_identifier,
        website: candidate.website,
        city: candidate.city,
        region: candidate.region,
        review_flags: candidate.review_flags as import('@/server/agents/prospecting-toolkit/structured-candidate-types').ReviewFlag[] | null,
        metadata: candidate.metadata ?? {},
        sector_code: candidate.sector_code,
        sector_description: candidate.sector_description,
        legal_status: candidate.legal_status,
      });

      const updatedMetadata: Record<string, unknown> = {
        ...candidate.metadata,
        enrichment: enrichment.metadata_enrichment_patch,
      };

      const { error: updateError } = await supabase
        .from('prospect_candidates')
        .update({
          sector_description: enrichment.sector_description,
          review_flags: enrichment.review_flags,
          data_completeness_score: enrichment.data_completeness_score,
          metadata: updatedMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id);

      if (updateError) {
        errors.push(`${candidate.name}: ${updateError.message}`);
        skippedCount++;
      } else {
        updatedCount++;
        if (candidate.city === null && !candidate.sector_code) {
          warnings.push(`${candidate.name}: sin ciudad ni sector en DB — enrichment parcial.`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      errors.push(`${rawCandidate.name ?? rawCandidate.id}: ${msg}`);
      skippedCount++;
    }
  }

  await logProspectCandidateAudit({
    batchId,
    actorUserId: internalUserId,
    actionType: 'batch_updated',
    details: {
      action: 'rehydrate_enrichment',
      updated_count: updatedCount,
      skipped_count: skippedCount,
      warnings_count: warnings.length,
      errors_count: errors.length,
    },
  });

  revalidatePath(`/prospect-batches/${batchId}`);

  return { ok: true, updatedCount, skippedCount, warnings, errors };
}

// ── Importación externa de candidatos ────────────────────────

export interface ExternalImportCandidate {
  company_name: string;
  country?: string;
  country_code?: string;
  website?: string;
  industry?: string;
  city?: string;
  region?: string;
  tax_identifier?: string;
  tax_identifier_type?: string;
  linkedin_url?: string;
  company_size?: string;
  description?: string;
  notes?: string;
  source_url?: string;
  contact_name?: string;
  contact_role?: string;
  contact_email?: string;
  owner_email?: string;
}

export interface ExternalImportInput {
  import_type: 'paste' | 'csv' | 'xlsx';
  candidates: ExternalImportCandidate[];
  recognized_columns: string[];
  unrecognized_columns: string[];
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  warning_rows: number;
  defaults?: {
    country?: string;
    country_code?: string;
    industry?: string;
  };
}

export interface ExternalImportResult {
  batchId: string;
  candidatesCreated: number;
}

export interface ImportDuplicateCheckItem {
  index: number;
  company_name: string;
  country_code?: string | null;
  domain?: string | null;
  tax_identifier?: string | null;
}

export interface ImportDuplicateResult {
  index: number;
  duplicate_status: 'no_match' | 'possible_duplicate' | 'exact_duplicate' | 'insufficient_data';
  reason?: string;
}

export async function checkImportDuplicates(
  items: ImportDuplicateCheckItem[]
): Promise<ImportDuplicateResult[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const results: ImportDuplicateResult[] = items.map((item) => ({
    index: item.index,
    duplicate_status: 'no_match' as const,
  }));

  if (items.length === 0) return results;

  // Batch query: buscar por normalized_name + country_code en candidates y accounts
  const { data: existingCandidates } = await supabase
    .from('prospect_candidates')
    .select('normalized_name, country_code, domain, tax_identifier')
    .not('status', 'eq', 'discarded');

  const { data: existingAccounts } = await supabase
    .from('accounts')
    .select('normalized_name, country_code, domain, tax_identifier')
    .is('deleted_at', null);

  const candidates = existingCandidates ?? [];
  const accounts = existingAccounts ?? [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.company_name) {
      results[i].duplicate_status = 'insufficient_data';
      continue;
    }

    const normalizedName = item.company_name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let found: 'possible_duplicate' | 'exact_duplicate' | null = null;
    let reason: string | undefined;

    // 1. Exacto por tax_identifier
    if (item.tax_identifier && !found) {
      const taxMatch = [
        ...candidates.filter((c) => c.tax_identifier === item.tax_identifier),
        ...accounts.filter((a) => a.tax_identifier === item.tax_identifier),
      ];
      if (taxMatch.length > 0) {
        found = 'exact_duplicate';
        reason = 'Mismo identificador fiscal';
      }
    }

    // 2. Exacto por domain
    if (item.domain && !found) {
      const domainMatch = [
        ...candidates.filter((c) => c.domain === item.domain),
        ...accounts.filter((a) => a.domain === item.domain),
      ];
      if (domainMatch.length > 0) {
        found = 'exact_duplicate';
        reason = 'Mismo dominio web';
      }
    }

    // 3. Posible por nombre normalizado + country_code
    if (!found) {
      const nameMatches = [
        ...candidates.filter(
          (c) =>
            c.normalized_name === normalizedName &&
            (!item.country_code || !c.country_code || c.country_code === item.country_code)
        ),
        ...accounts.filter(
          (a) =>
            a.normalized_name === normalizedName &&
            (!item.country_code || !a.country_code || a.country_code === item.country_code)
        ),
      ];
      if (nameMatches.length > 0) {
        found = 'possible_duplicate';
        reason = 'Nombre similar en el mismo país';
      }
    }

    if (found) {
      results[i].duplicate_status = found;
      results[i].reason = reason;
    }
  }

  return results;
}

export async function createExternalCandidatesBatch(
  input: ExternalImportInput
): Promise<ExternalImportResult> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const now = new Date();
  const dateLabel = now.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  // Inferir país e industria del lote (considerando defaults)
  const countryCodes = [...new Set(input.candidates.map((c) => c.country_code).filter(Boolean))];
  const industries = [...new Set(input.candidates.map((c) => c.industry).filter(Boolean))];

  const batchCountryCode = countryCodes.length === 1
    ? (countryCodes[0] as string)
    : (countryCodes.length === 0 ? (input.defaults?.country_code ?? null) : null);
  const batchCountry = batchCountryCode
    ? (input.candidates.find((c) => c.country_code === batchCountryCode)?.country ?? input.defaults?.country ?? null)
    : null;
  const batchIndustry = industries.length === 1
    ? (industries[0] as string)
    : (industries.length === 0 ? (input.defaults?.industry ?? 'Importación externa') : 'Importación externa');

  const rowsUsingDefaultCountry = input.candidates.filter(
    (c) => !c.country_code && !c.country && !!input.defaults?.country_code
  ).length;
  const rowsUsingDefaultIndustry = input.candidates.filter(
    (c) => !c.industry && !!input.defaults?.industry
  ).length;

  const batchName = `Importación externa · ${dateLabel}`;

  const { data: batch, error: batchError } = await supabase
    .from('prospect_batches')
    .insert({
      name: batchName,
      description: 'Candidatos cargados manualmente o desde archivo externo.',
      country: batchCountry,
      country_code: batchCountryCode,
      industry: batchIndustry,
      status: 'ready_for_review',
      source: 'external_import',
      owner_id: internalUserId,
      created_by: internalUserId,
      metadata: {
        import_type: input.import_type,
        imported_rows_count: input.total_rows,
        valid_rows_count: input.valid_rows,
        invalid_rows_count: input.invalid_rows,
        warning_rows_count: input.warning_rows,
        recognized_columns: input.recognized_columns,
        unrecognized_columns: input.unrecognized_columns,
        source_label: 'Importación externa',
        created_from_external_research: true,
        enrichment_auto_run: false,
        hubspot_sync_on_import: false,
        default_country: input.defaults?.country ?? null,
        default_country_code: input.defaults?.country_code ?? null,
        default_industry: input.defaults?.industry ?? null,
        defaults_applied: !!(input.defaults?.country_code || input.defaults?.industry),
        rows_using_default_country_count: rowsUsingDefaultCountry,
        rows_using_default_industry_count: rowsUsingDefaultIndustry,
      },
    })
    .select()
    .single();

  if (batchError || !batch) {
    throw new Error(`Error al crear lote: ${batchError?.message}`);
  }

  await logProspectCandidateAudit({
    batchId: batch.id,
    actorUserId: internalUserId,
    actionType: 'batch_created',
    details: { name: batch.name, source: 'external_import', import_type: input.import_type },
  });

  // Insertar candidatos
  let candidatesCreated = 0;

  for (const candidate of input.candidates) {
    const website = candidate.website?.trim() || null;
    let domain: string | null = null;
    if (website) {
      try {
        const url = website.startsWith('http') ? website : `https://${website}`;
        domain = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        domain = null;
      }
    }

    const normalizedName = candidate.company_name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const notesArr: string[] = [];
    if (candidate.description) notesArr.push(`Descripción: ${candidate.description}`);
    if (candidate.notes) notesArr.push(candidate.notes);

    const { error: candidateError } = await supabase.from('prospect_candidates').insert({
      batch_id: batch.id,
      name: candidate.company_name.trim(),
      normalized_name: normalizedName,
      website,
      domain,
      country: candidate.country?.trim() || null,
      country_code: candidate.country_code?.trim().toUpperCase() || null,
      city: candidate.city?.trim() || null,
      region: candidate.region?.trim() || null,
      industry: candidate.industry?.trim() || null,
      company_size: candidate.company_size?.trim() || null,
      tax_identifier: candidate.tax_identifier?.trim() || null,
      tax_identifier_type: candidate.tax_identifier_type?.trim() || null,
      source_primary: 'external_import',
      status: 'needs_review',
      review_notes: notesArr.length > 0 ? notesArr.join('\n') : null,
      metadata: {
        ...(candidate.linkedin_url ? { linkedin_url: candidate.linkedin_url.trim() } : {}),
        ...(candidate.source_url ? { source_url: candidate.source_url.trim() } : {}),
        ...(candidate.contact_name ? { contact_name: candidate.contact_name.trim() } : {}),
        ...(candidate.contact_role ? { contact_role: candidate.contact_role.trim() } : {}),
        ...(candidate.contact_email ? { contact_email: candidate.contact_email.trim() } : {}),
        ...(candidate.owner_email ? { owner_email: candidate.owner_email.trim() } : {}),
        imported_from: input.import_type,
      },
    });

    if (!candidateError) candidatesCreated++;
  }

  revalidatePath('/prospect-batches');
  revalidatePath(`/prospect-batches/${batch.id}`);

  return { batchId: batch.id, candidatesCreated };
}

interface ActionsImportMeta {
  confidence?: string;
  company_size?: string;
  source_url?: string;
  source_evidence?: string;
  linkedin_url?: string;
}

interface ActionsCandidateMeta {
  linkedin_url?: string;
  import?: ActionsImportMeta;
  source_url?: string;
  confidence?: string;
  tax_identifier_lookup?: Record<string, unknown>;
}

export async function validateImportedCandidatesBatch(
  batchId: string,
  userId: string,
  supabaseClient?: SupabaseClient
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = supabaseClient || (await createClient());

    // 1. Cargar batch
    const { data: batch, error: batchError } = await supabase
      .from('prospect_batches')
      .select('*')
      .eq('id', batchId)
      .single();

    if (batchError || !batch) {
      return { success: false, error: `Batch no encontrado: ${batchError?.message}` };
    }

    // 2. Verificar source === 'external_import'
    if (batch.source !== 'external_import') {
      return { success: false, error: 'El lote no es de tipo importación externa' };
    }

    // 3. Cargar candidates
    const { data: candidates, error: candidatesError } = await supabase
      .from('prospect_candidates')
      .select('*')
      .eq('batch_id', batchId);

    if (candidatesError || !candidates) {
      return { success: false, error: `Error al cargar candidatos: ${candidatesError?.message}` };
    }

    let validated_candidates = 0;
    let sellup_matches_count = 0;
    let hubspot_matches_count = 0;
    let hubspot_possible_matches_count = 0;
    let hubspot_checked_candidates_count = 0;
    let hubspot_errors_count = 0;
    let possible_duplicates_count = 0;
    let no_match_count = 0;
    let warnings_count = 0;
    let failed_count = 0;
    let hubspotStatusForBatch = 'not_configured';

    let lookup_attempted = false;
    let lookup_reason_skipped: string | null = null;
    let lookup_success_count = 0;
    let lookup_fail_count = 0;
    let lookup_total_candidates_found = 0;
    let lookup_best_candidate_found = false;
    let lookup_used_for_duplicate_detection = false;

    for (const candidate of candidates) {
      try {
        const candidateMeta = (candidate.metadata || {}) as unknown as ActionsCandidateMeta;
        const linkedinUrl = candidateMeta.linkedin_url || candidateMeta.import?.linkedin_url || null;

        // Búsqueda automática de NIT (Socrata/RUES) si aplica
        let taxIdentifierCandidate: string | null = null;
        const currentMetadata = { ...candidateMeta };

        const isCO = candidate.country_code?.toUpperCase() === 'CO';
        const hasNoTaxId = !candidate.tax_identifier || candidate.tax_identifier.trim() === '';
        const isExternalImport = candidate.source_primary === 'external_import';
        const hasCompanyName = !!candidate.name && candidate.name.trim().length > 0;

        const lookup = currentMetadata.tax_identifier_lookup as TaxIdentifierLookupMetadata | undefined;
        const hasValidLookup =
          !!lookup &&
          lookup.status !== 'failed' &&
          (lookup.best_candidate !== undefined ||
           lookup.best_candidate_skip_reason !== undefined);

        if (isCO && hasNoTaxId && isExternalImport && hasCompanyName && !hasValidLookup) {
          lookup_attempted = true;
          const isProviderConfigured = await checkIsColombiaProviderConfigured();
          if (isProviderConfigured) {
            try {
              const lookupResult = await lookupTaxIdentifierForCandidate({
                candidateId: candidate.id,
                userId,
                supabase,
              });
              if (lookupResult.success && lookupResult.lookup) {
                lookup_success_count++;
                currentMetadata.tax_identifier_lookup = lookupResult.lookup as unknown as Record<string, unknown>;
                const bestCandidate = lookupResult.lookup.best_candidate;
                if (bestCandidate) {
                  taxIdentifierCandidate = bestCandidate.normalized_tax_identifier;
                  lookup_best_candidate_found = true;
                }
                const count = lookupResult.lookup.candidates?.length ?? 0;
                lookup_total_candidates_found += count;
              } else {
                lookup_fail_count++;
              }
            } catch (lookupErr) {
              lookup_fail_count++;
              console.error(`[validateImportedCandidatesBatch] Automated NIT lookup failed for candidate ${candidate.id}:`, lookupErr);
            }
          } else {
            lookup_reason_skipped = 'provider_not_configured';
          }
        } else if (hasValidLookup && lookup) {
          const bestCandidate = lookup.best_candidate;
          if (bestCandidate) {
            taxIdentifierCandidate = bestCandidate.normalized_tax_identifier as string | null;
          }
        }

        if (taxIdentifierCandidate) {
          lookup_used_for_duplicate_detection = true;
        }

        // --- Detección universal de duplicados ---
        const dupResult = await detectCandidateDuplicates({
          supabase,
          candidate: {
            id: candidate.id,
            name: candidate.name,
            website: candidate.website,
            domain: candidate.domain,
            country_code: candidate.country_code,
            tax_identifier: candidate.tax_identifier,
            tax_identifier_candidate: taxIdentifierCandidate,
            normalized_name: candidate.normalized_name,
            linkedin_url: linkedinUrl,
          },
          includeHubSpot: true,
        });

        // Actualizar contadores de batch HubSpot
        if (dupResult.hubspot_connected) {
          hubspotStatusForBatch = 'connected';
          hubspot_checked_candidates_count++;
          const hsStatus = dupResult.hubspot_duplicate_check.status;
          if (hsStatus === 'match') hubspot_matches_count++;
          else if (hsStatus === 'possible_match') hubspot_possible_matches_count++;
          else if (hsStatus === 'error') hubspot_errors_count++;
        }

        // --- Quality Check ---
        const missing_fields: string[] = [];
        const warnings: string[] = [];

        const has_website = !!candidate.website;
        const has_linkedin = !!linkedinUrl;
        const has_country = !!candidate.country_code;
        const has_industry = !!candidate.industry;
        const has_tax_identifier = !!candidate.tax_identifier;
        const has_company_size = !!candidate.company_size;
        const has_external_evidence = !!(
          candidateMeta.source_url ||
          candidateMeta.import?.source_url ||
          candidateMeta.import?.source_evidence
        );

        const import_confidence = candidateMeta.import?.confidence || candidateMeta.confidence || 'alta';

        if (!has_tax_identifier) {
          missing_fields.push('tax_identifier');
          warnings.push('missing_tax_identifier');
        }
        if (!has_linkedin) {
          missing_fields.push('linkedin_url');
          warnings.push('missing_linkedin');
        }
        if (!has_website) {
          missing_fields.push('website');
          warnings.push('missing_website');
        }
        if (!has_industry) {
          missing_fields.push('industry');
          warnings.push('missing_industry');
        }

        const lowerConf = String(import_confidence).toLowerCase();
        if (lowerConf === 'baja' || lowerConf === 'low') {
          warnings.push('low_confidence');
        } else if (lowerConf === 'media' || lowerConf === 'medium') {
          warnings.push('medium_confidence');
        }

        if (candidate.review_notes) {
          warnings.push('external_review_note');
        }

        const quality_check = {
          missing_fields,
          warnings,
          import_confidence,
          has_website,
          has_linkedin,
          has_country,
          has_industry,
          has_tax_identifier,
          has_external_evidence,
          has_company_size,
        };

        // --- Contadores de batch ---
        const sellupStatus = dupResult.sellup_duplicate_check.status;

        if (sellupStatus === 'duplicate') {
          sellup_matches_count++;
        }
        if (dupResult.db_duplicate_status === 'possible_duplicate') {
          possible_duplicates_count++;
        } else if (dupResult.db_duplicate_status === 'no_match') {
          no_match_count++;
        }

        warnings_count += warnings.length;

        // --- Guardar metadata por candidato ---
        const validation = {
          validated_at: new Date().toISOString(),
          validated_by: userId,
          validation_source: 'post_import_auto',
          validation_status: 'validated',
          sellup_duplicate_check: dupResult.sellup_duplicate_check,
          hubspot_duplicate_check: dupResult.hubspot_duplicate_check,
          normalized_keys: dupResult.normalized_keys,
          quality_check,
        };

        const updatedMetadata = {
          ...currentMetadata,
          validation,
        };

        // Actualizar candidato
        await supabase
          .from('prospect_candidates')
          .update({
            duplicate_status: dupResult.db_duplicate_status,
            matched_account_id: dupResult.db_matched_account_id,
            matched_hubspot_company_id: dupResult.db_matched_hubspot_company_id,
            confidence_score: dupResult.db_confidence_score,
            metadata: updatedMetadata,
          })
          .eq('id', candidate.id);

        validated_candidates++;
      } catch (candErr) {
        console.error(`Error validando candidato ${candidate.id}:`, candErr);
        failed_count++;
      }
    }

    // 4. Actualizar metadata del lote
    const batchMeta = (batch.metadata || {}) as Record<string, unknown>;
    if (process.env.NODE_ENV === 'development') {
      console.info('[validateImportedCandidatesBatch] hubspot_config_detected:', hubspotStatusForBatch !== 'not_configured');
      console.info('[validateImportedCandidatesBatch] hubspot_checked_candidates_count:', hubspot_checked_candidates_count);
      console.info('[validateImportedCandidatesBatch] hubspot_matches_count:', hubspot_matches_count);
      console.info('[validateImportedCandidatesBatch] hubspot_possible_matches_count:', hubspot_possible_matches_count);
      console.info('[validateImportedCandidatesBatch] hubspot_errors_count:', hubspot_errors_count);
    }

    let autoLookupStatus: "completed" | "no_result" | "failed" | "skipped" = "skipped";
    if (lookup_attempted) {
      if (lookup_success_count > 0) {
        if (lookup_total_candidates_found > 0) {
          autoLookupStatus = "completed";
        } else {
          autoLookupStatus = "no_result";
        }
      } else if (lookup_fail_count > 0) {
        autoLookupStatus = "failed";
      }
    } else {
      if (candidates.length === 0) {
        lookup_reason_skipped = "no_candidates";
      } else if (!candidates.some(c => c.country_code?.toUpperCase() === 'CO')) {
        lookup_reason_skipped = "not_colombia_batch";
      } else if (!candidates.some(c => !c.tax_identifier || c.tax_identifier.trim() === '')) {
        lookup_reason_skipped = "all_candidates_have_tax_identifier";
      } else {
        lookup_reason_skipped = "already_validated";
      }
    }

    const tax_identifier_auto_lookup = {
      attempted: lookup_attempted,
      reason_skipped: lookup_reason_skipped,
      status: autoLookupStatus,
      candidates_count: lookup_total_candidates_found,
      best_candidate_found: lookup_best_candidate_found,
      used_for_duplicate_detection: lookup_used_for_duplicate_detection,
    };

    const import_validation = {
      validated_at: new Date().toISOString(),
      validation_source: 'post_import_auto',
      total_candidates: candidates.length,
      validated_candidates,
      sellup_matches_count,
      hubspot_matches_count,
      hubspot_possible_matches_count,
      hubspot_checked_candidates_count,
      hubspot_errors_count,
      possible_duplicates_count,
      no_match_count,
      warnings_count,
      failed_count,
      hubspot_status: hubspotStatusForBatch,
      tax_identifier_auto_lookup,
    };

    const updatedBatchMeta = {
      ...batchMeta,
      import_validation,
    };

    await supabase
      .from('prospect_batches')
      .update({
        metadata: updatedBatchMeta,
      })
      .eq('id', batchId);

    try {
      revalidatePath('/prospect-batches');
      revalidatePath(`/prospect-batches/${batchId}`);
    } catch (revalErr) {
      console.warn('[validateImportedCandidatesBatch] revalidatePath skipped/failed:', revalErr);
    }

    return { success: true };
  } catch (err) {
    console.error('Error en validateImportedCandidatesBatch:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}
