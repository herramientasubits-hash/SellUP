'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { runProspectGenerationAgent } from '@/server/agents/prospect-generation';
import type {
  ProspectBatch,
  ProspectBatchWithMeta,
  ProspectCandidate,
  ProspectCandidateWithReviewer,
  ProspectCandidateAudit,
  BatchesSummary,
  BatchDetailSummary,
  CreateBatchInput,
  UpdateBatchInput,
  CreateCandidateInput,
  UpdateCandidateInput,
  MarkDuplicateInput,
  InternalUserOption,
  CandidateAuditAction,
  BatchStatus,
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

  const { data, error } = await supabase
    .from('prospect_candidates')
    .update({
      status: 'approved',
      reviewed_by: internalUserId,
      reviewed_at: new Date().toISOString(),
    })
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

  const { data, error } = await supabase
    .from('prospect_candidates')
    .update({
      status: 'discarded',
      review_notes: reason ?? null,
      reviewed_by: internalUserId,
      reviewed_at: new Date().toISOString(),
    })
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

export async function markCandidateDuplicate(
  id: string,
  matchData: MarkDuplicateInput
): Promise<ProspectCandidate> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('prospect_candidates')
    .update({
      status: 'duplicate',
      duplicate_status: matchData.duplicate_status,
      matched_account_id: matchData.matched_account_id ?? null,
      matched_hubspot_company_id: matchData.matched_hubspot_company_id ?? null,
      review_notes: matchData.review_notes ?? null,
      reviewed_by: internalUserId,
      reviewed_at: new Date().toISOString(),
    })
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
      metadata: { converted_from_candidate_id: id, batch_id: candidate.batch_id },
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
}

export interface GenerateAIBatchResult {
  batchId: string;
  candidatesCreated: number;
  estimatedCostUsd: number;
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
  });

  if (!result.success || !result.batchId) {
    throw new Error(result.error ?? 'El agente no pudo generar candidatos');
  }

  revalidatePath('/prospect-batches');
  revalidatePath(`/prospect-batches/${result.batchId}`);

  return {
    batchId: result.batchId,
    candidatesCreated: result.candidatesCreated,
    estimatedCostUsd: result.estimatedCostUsd,
  };
}
