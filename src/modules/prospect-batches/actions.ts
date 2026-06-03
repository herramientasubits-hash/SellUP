'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { runProspectGenerationAgent } from '@/server/agents/prospect-generation';
import { runAgentSourceDiscoveryPreflight, type SourceDiscoveryPreflightResult } from '@/server/agents/prospecting-toolkit/source-discovery-preflight';
import { runIncrementalProspectingSearch } from '@/server/agents/prospecting-toolkit/incremental-search';
import { testHubSpotConnection } from '@/server/services/hubspot-connection';
import { checkHubSpotCompanyCommercialStatus } from '@/server/agents/prospecting-toolkit/hubspot-commercial-checker';
import { createHubSpotCompany, type CreateHubSpotCompanySentAudit } from '@/server/integrations/hubspot-company-create';
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
    .select('id, name, legal_name, country_code, tax_identifier, duplicate_status, status, review_flags, legal_status')
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
    .select('batch_id, status, name, legal_name, country_code, tax_identifier, duplicate_status, review_flags, legal_status')
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
    .select('status, name, legal_name, country_code, tax_identifier, duplicate_status, review_flags, legal_status')
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
    .select('status, name, legal_name, country_code, tax_identifier, duplicate_status, review_flags, legal_status')
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

const EMAIL_TO_HUBSPOT_OWNER_ID: Record<string, string> = {
  'soporte@sellup.co': '12345678',
  'growth@sellup.co': '87654321',
  'admin@sellup.co': '11223344',
  'qa@sellup.co': '44332211',
};

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

  await logProspectCandidateAudit({
    batchId: candidate.batch_id,
    candidateId: id,
    actorUserId: internalUserId,
    actionType: 'candidate_converted_to_account',
    details: {
      candidate_name: candidate.name,
      account_id: account.id,
      account_source: accountSource,
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
    const linkedInObj = webEnrichment.linkedin_company as Record<string, unknown> | null;
    const linkedinConfirmedUrl = (linkedInObj?.url as string | undefined) ?? null;
    const linkedinFallbackUrl =
      (enrichment.linkedin_url as string | undefined) ??
      (enrichment.linkedin as string | undefined) ??
      null;
    const linkedinUrl = linkedinConfirmedUrl ?? linkedinFallbackUrl;

    const { data: userRow } = await supabase
      .from('internal_users')
      .select('email')
      .eq('id', internalUserId)
      .single();
    const userEmail = userRow?.email?.toLowerCase().trim() ?? '';
    const mappedOwnerId = EMAIL_TO_HUBSPOT_OWNER_ID[userEmail] ?? 'skipped_missing_mapping';

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

/**
 * Aprueba un candidato y lo convierte a cuenta SellUp en un solo paso.
 * Reutiliza las validaciones y guardrails existentes de approveCandidate
 * y convertCandidateToAccount — no duplica lógica.
 *
 * El vendedor solo necesita hacer un click: "Aprobar".
 */
export async function approveAndConvertCandidateAction(
  id: string
): Promise<{ accountId: string; hubspotSync: HubSpotSyncResult }> {
  await approveCandidate(id);
  return await convertCandidateToAccount(id);
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
  const minTargetCount = isColombia ? 5 : 10;
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
