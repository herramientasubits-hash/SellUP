'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { runProspectGenerationAgent } from '@/server/agents/prospect-generation';
import { runAgentSourceDiscoveryPreflight, type SourceDiscoveryPreflightResult } from '@/server/agents/prospecting-toolkit/source-discovery-preflight';
import { runIncrementalProspectingSearch } from '@/server/agents/prospecting-toolkit/incremental-search';
import {
  APPROVE_BLOCK_MESSAGES,
  isStructuredCandidate,
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
    .select('status')
    .is('archived_at', null);

  const { data: approvedCandidates } = await supabase
    .from('prospect_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'approved');

  const list = batches ?? [];
  return {
    total: list.length,
    ready_for_review: list.filter((b) => b.status === 'ready_for_review').length,
    in_review: list.filter((b) => b.status === 'in_review').length,
    completed: list.filter((b) => b.status === 'completed').length,
    total_approved_candidates: approvedCandidates?.length ?? 0,
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

  const { data: candidateCounts } = await supabase
    .from('prospect_candidates')
    .select('batch_id, status')
    .in('batch_id', batchIds);

  const counts = (candidateCounts ?? []).reduce<Record<string, Record<string, number>>>(
    (acc, c) => {
      if (!acc[c.batch_id]) acc[c.batch_id] = {};
      acc[c.batch_id][c.status] = (acc[c.batch_id][c.status] ?? 0) + 1;
      return acc;
    },
    {}
  );

  return batches.map((b) => {
    const bCounts = counts[b.id] ?? {};
    const total = Object.values(bCounts).reduce((s, v) => s + v, 0);
    return {
      ...b,
      total_candidates: total,
      approved_count: bCounts['approved'] ?? 0,
      discarded_count: bCounts['discarded'] ?? 0,
      converted_count: bCounts['converted_to_account'] ?? 0,
      needs_review_count: bCounts['needs_review'] ?? 0,
      duplicate_count: bCounts['duplicate'] ?? 0,
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

  const { data: candidateCounts } = await supabase
    .from('prospect_candidates')
    .select('status')
    .eq('batch_id', id);

  const counts = (candidateCounts ?? []).reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  const total = Object.values(counts).reduce((s, v) => s + v, 0);

  return {
    ...batch,
    total_candidates: total,
    approved_count: counts['approved'] ?? 0,
    discarded_count: counts['discarded'] ?? 0,
    converted_count: counts['converted_to_account'] ?? 0,
    needs_review_count: counts['needs_review'] ?? 0,
    duplicate_count: counts['duplicate'] ?? 0,
  } as ProspectBatchWithMeta;
}

export async function getBatchDetailSummary(batchId: string): Promise<BatchDetailSummary> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from('prospect_candidates')
    .select('status')
    .eq('batch_id', batchId);

  const counts = (data ?? []).reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  const total = Object.values(counts).reduce((s, v) => s + v, 0);

  return {
    total_candidates: total,
    needs_review: counts['needs_review'] ?? 0,
    approved: counts['approved'] ?? 0,
    discarded: counts['discarded'] ?? 0,
    converted: counts['converted_to_account'] ?? 0,
    duplicates: counts['duplicate'] ?? 0,
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
): Promise<ProspectCandidate> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  // Validar formato UUID básico
  if (!candidateId || !/^[0-9a-f-]{36}$/i.test(candidateId)) {
    throw new Error('ID de candidato inválido');
  }

  const { data: candidate } = await supabase
    .from('prospect_candidates')
    .select('id, batch_id, name, status, duplicate_status, review_status, review_flags, metadata')
    .eq('id', candidateId)
    .single();

  if (!candidate) throw new Error('Candidato no encontrado');

  const reviewStatus = (candidate as Record<string, unknown>).review_status as string | null | undefined;
  const reviewFlags = (candidate as Record<string, unknown>).review_flags as string[] | null | undefined;

  // Validar que es candidato estructurado
  if (reviewStatus === null || reviewStatus === undefined) {
    throw new Error('Esta acción solo aplica a candidatos de fuentes oficiales estructuradas');
  }

  // Validar estado de candidato
  if (candidate.status !== 'needs_review') {
    throw new Error(`El candidato debe estar en estado "necesita revisión" para marcarlo como listo (estado actual: ${candidate.status})`);
  }

  // Validar review_status actual
  if (reviewStatus !== 'needs_manual_review') {
    throw new Error(`El candidato ya fue procesado (review_status: ${reviewStatus})`);
  }

  // ── Bloqueos de negocio ───────────────────────────────────────
  if (Array.isArray(reviewFlags) && reviewFlags.includes('inactive_company')) {
    throw new Error('No se puede marcar como listo: la empresa puede estar inactiva o disuelta. Verifica el estado de la empresa antes de continuar.');
  }
  if (candidate.duplicate_status === 'exact_duplicate') {
    throw new Error('No se puede marcar como listo: el candidato está marcado como duplicado exacto.');
  }
  if (Array.isArray(reviewFlags) && reviewFlags.includes('no_tax_id')) {
    throw new Error('No se puede marcar como listo: el candidato no tiene NIT/identificación fiscal.');
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

  if (error || !data) throw new Error(`Error al marcar candidato como listo: ${error?.message}`);

  await logProspectCandidateAudit({
    batchId: data.batch_id,
    candidateId,
    actorUserId: internalUserId,
    actionType: 'candidate_marked_ready_for_approval',
    details: { candidate_name: data.name },
  });

  revalidatePath(`/prospect-batches/${data.batch_id}`);
  return data as ProspectCandidate;
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

export async function convertCandidateToAccount(id: string): Promise<{ accountId: string }> {
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
  return { accountId: account.id };
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
}

export interface GenerateAIBatchResult {
  batchId: string;
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
  };
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
  if (input.targetCount < 1 || input.targetCount > MVP_MAX_CANDIDATES) {
    throw new Error(`La cantidad debe estar entre 1 y ${MVP_MAX_CANDIDATES}`);
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
  });

  if (!result.success || !result.batchId) {
    throw new Error(result.error ?? 'El agente no pudo generar candidatos');
  }

  revalidatePath('/prospect-batches');
  revalidatePath(`/prospect-batches/${result.batchId}`);
  if (result.structuredSourceBatch?.batchId) {
    revalidatePath(`/prospect-batches/${result.structuredSourceBatch.batchId}`);
  }

  return {
    batchId: result.batchId,
    candidatesCreated: result.candidatesCreated,
    estimatedCostUsd: result.estimatedCostUsd,
    structuredSourcePreflight: result.structuredSourcePreflight,
    structuredSourceBatch: result.structuredSourceBatch,
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
