'use server';

import { redirect } from 'next/navigation';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { resolveCompanyForContactEnrichment } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import { startContactEnrichmentRun } from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-runner';
import { executeContactEnrichmentApolloRun } from '@/server/agents/contact-enrichment-toolkit/apollo-enrichment-runner';
import { logContactAudit } from '@/modules/contacts/actions';
import {
  runApproveCandidate,
  runDiscardCandidate,
  type CandidateRecord,
  type CandidateReviewPatch,
  type ContactInsertPayload,
  type ExistingContactForDedup,
} from './candidate-review-core';
import type {
  Agent2AInput,
  CompanyResolutionResult,
  ContactEnrichmentRunResult,
  PendingContactCandidate,
  ContactCandidateEnrichmentMetadata,
  ContactSource,
  ContactCandidateStatus,
  ContactDuplicateStatus,
} from './types';

// ── Auth helper (patrón idéntico a prospect-batches/actions.ts) ───────────────

async function requireActiveUserForEnrichment(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    if (process.env.NODE_ENV === 'development') {
      const { data: devUser } = await supabase
        .from('internal_users')
        .select('id')
        .eq('access_status', 'active')
        .limit(1)
        .single();
      if (devUser) return { internalUserId: devUser.id };
    }
    redirect('/login');
  }

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) {
    if (process.env.NODE_ENV === 'development') {
      const { data: fallback } = await supabase
        .from('internal_users')
        .select('id')
        .eq('access_status', 'active')
        .limit(1)
        .single();
      if (fallback) return { internalUserId: fallback.id };
    }
    redirect('/login');
  }

  return { internalUserId: internalUser.id };
}

// ── Validación de input ───────────────────────────────────────

function validateAgent2AInput(input: unknown): Agent2AInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Input inválido');
  }

  const raw = input as Record<string, unknown>;
  const result: Agent2AInput = {};

  if (typeof raw.companyName === 'string' && raw.companyName.trim()) {
    result.companyName = raw.companyName.trim();
  }
  if (typeof raw.companyDomain === 'string' && raw.companyDomain.trim()) {
    result.companyDomain = raw.companyDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  }
  if (typeof raw.companyCountryCode === 'string' && raw.companyCountryCode.trim()) {
    result.companyCountryCode = raw.companyCountryCode.trim().toUpperCase();
  }
  if (typeof raw.hubspotCompanyId === 'string' && raw.hubspotCompanyId.trim()) {
    result.hubspotCompanyId = raw.hubspotCompanyId.trim();
  }
  if (typeof raw.sellupAccountId === 'string' && raw.sellupAccountId.trim()) {
    result.sellupAccountId = raw.sellupAccountId.trim();
  }

  const hasIdentifier =
    result.companyName ||
    result.companyDomain ||
    result.hubspotCompanyId ||
    result.sellupAccountId;

  if (!hasIdentifier) {
    throw new Error('Debes proveer al menos un identificador: nombre, dominio, HubSpot ID o SellUp Account ID');
  }

  return result;
}

// ── Server Actions ────────────────────────────────────────────

export interface ResolveCompanyActionResult {
  success: boolean;
  data?: CompanyResolutionResult;
  error?: string;
}

export async function resolveContactEnrichmentCompanyAction(
  rawInput: unknown
): Promise<ResolveCompanyActionResult> {
  try {
    await requireActiveUserForEnrichment();
    const input = validateAgent2AInput(rawInput);
    const result = await resolveCompanyForContactEnrichment(input);
    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error resolviendo empresa';
    // No exponemos stack trace
    return { success: false, error: message };
  }
}

export interface StartEnrichmentRunActionResult {
  success: boolean;
  data?: ContactEnrichmentRunResult;
  error?: string;
}

export async function startContactEnrichmentRunAction(
  rawInput: unknown
): Promise<StartEnrichmentRunActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();
    const input = validateAgent2AInput(rawInput);

    // Necesitamos la empresa confirmada — re-resolvemos o la recibimos serializada
    const raw = rawInput as Record<string, unknown>;
    const confirmedCompanyRaw = raw.confirmedCompany;

    if (!confirmedCompanyRaw || typeof confirmedCompanyRaw !== 'object') {
      throw new Error('Falta la empresa confirmada para iniciar el run');
    }

    const confirmedCompany = confirmedCompanyRaw as {
      source: 'sellup' | 'hubspot' | 'manual';
      name: string;
      domain?: string | null;
      countryCode?: string | null;
      hubspotCompanyId?: string;
      sellupAccountId?: string;
      matchConfidence: number;
    };

    if (!confirmedCompany.name?.trim()) {
      throw new Error('La empresa confirmada no tiene nombre');
    }

    const result = await startContactEnrichmentRun({
      confirmedCompany,
      originalInput: input,
      triggeredBy: internalUserId,
    });

    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error iniciando run de enriquecimiento';
    return { success: false, error: message };
  }
}

// ── Apollo: generar candidatos reales (Hito 17A.3A) ───────────

export interface RunApolloActionCostGuardrail {
  phone_completion_enabled: boolean;
  estimated_credits_before_completion: number;
  max_credits_per_run: number;
  guardrail_blocked: boolean;
  blocked_reason?: string;
  actual_credits_email: number;
  actual_credits_phone: number;
  actual_credits_total: number;
  blocked_profiles_count: number;
}

export interface RunApolloActionSearchGuardrail {
  max_search_attempts: number;
  max_results_per_attempt: number;
  max_results_per_run: number;
  estimated_search_credits: number;
  blocked_by_search_budget: boolean;
  stopped_early_reason: 'target_reviewable_reached' | 'search_budget_reached' | 'all_attempts_exhausted' | null;
}

export interface RunApolloActionResult {
  success: boolean;
  status?: 'ready_for_review' | 'completed' | 'skipped' | 'error';
  candidatesCreated?: number;
  duplicatesSkipped?: number;
  possibleDuplicates?: number;
  totalCandidates?: number;
  /** Perfiles crudos encontrados en Apollo (suma de intentos). */
  rawResultsCount?: number;
  /** Perfiles descartados por baja relevancia o datos insuficientes. */
  rejectedByRelevance?: number;
  /** Apollo encontró perfiles pero ninguno pasó el filtro de revisión. */
  noReviewableContactsFound?: boolean;
  /** Candidatos a los que se intentó completar datos vía people/match. */
  completionAttempted?: number;
  /** Candidatos relevantes que quedaron con datos accionables. */
  actionableContactsCount?: number;
  /** Apollo trajo perfiles relevantes pero ninguno quedó accionable. */
  noActionableContactsFound?: boolean;
  providerStatus?: 'success' | 'skipped' | 'error';
  estimatedCostUsd?: number;
  /** Guardrail de costo y completion (Hito 17A.6B). */
  costGuardrail?: RunApolloActionCostGuardrail;
  /** Guardrail de presupuesto de búsqueda (Hito 17A.6D). */
  searchGuardrail?: RunApolloActionSearchGuardrail;
  error?: string;
}

/**
 * Ejecuta Apollo para un run en ready_to_enrich: busca personas reales,
 * normaliza, deduplica contra el snapshot y crea candidatos en staging.
 * NO crea contactos finales ni escribe en HubSpot. Requiere revisión humana.
 */
export async function runContactEnrichmentApolloAction(
  runId: unknown,
): Promise<RunApolloActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();

    if (typeof runId !== 'string' || !runId.trim()) {
      throw new Error('runId inválido');
    }

    const result = await executeContactEnrichmentApolloRun(runId.trim(), internalUserId);

    return {
      success: result.status !== 'error',
      status: result.status,
      candidatesCreated: result.candidatesCreated,
      duplicatesSkipped: result.duplicatesSkipped,
      possibleDuplicates: result.possibleDuplicates,
      totalCandidates: result.totalCandidates,
      rawResultsCount: result.rawResultsCount,
      rejectedByRelevance: result.rejectedByRelevance,
      noReviewableContactsFound: result.noReviewableContactsFound,
      completionAttempted: result.completionAttempted,
      actionableContactsCount: result.actionableContactsCount,
      noActionableContactsFound: result.noActionableContactsFound,
      providerStatus: result.providerStatus,
      estimatedCostUsd: result.estimatedCostUsd,
      costGuardrail: result.costGuardrail,
      searchGuardrail: result.searchGuardrail,
      error: result.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error ejecutando Apollo';
    return { success: false, status: 'error', error: message };
  }
}

// ── Candidatos por revisar (Hito 17A.4A) ──────────────────────
// Lectura de staging para el tab "Candidatos por revisar" en /contacts.
// Solo proyecta `pending_review`; NO toca contactos finales ni HubSpot.

const PENDING_CANDIDATES_LIMIT = 500;

interface CandidateRunContext {
  company_name: string | null;
  company_domain: string | null;
  account_id: string | null;
  hubspot_company_id: string | null;
}

/** Supabase devuelve el embed to-one como objeto, pero el tipado del select
 *  puede inferirlo como arreglo: normalizamos ambos casos. */
function firstRun(run: unknown): CandidateRunContext | null {
  const value = Array.isArray(run) ? run[0] : run;
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  return {
    company_name: (r.company_name as string | null) ?? null,
    company_domain: (r.company_domain as string | null) ?? null,
    account_id: (r.account_id as string | null) ?? null,
    hubspot_company_id: (r.hubspot_company_id as string | null) ?? null,
  };
}

/** Columnas proyectadas para revisión humana — sin payloads crudos del
 *  proveedor. Compartido por el listado y el detalle del side panel. */
const CANDIDATE_SELECT =
  `id, full_name, title, email, linkedin_url, phone, source, status,
   duplicate_status, confidence, enrichment_metadata, enrichment_run_id, created_at,
   run:contact_enrichment_runs ( company_name, company_domain, account_id, hubspot_company_id )`;

/** Mapea una fila cruda de Supabase a la proyección de solo lectura. */
function mapPendingContactCandidate(row: unknown): PendingContactCandidate {
  const record = row as Record<string, unknown>;
  const run = firstRun(record.run);
  return {
    id: record.id as string,
    full_name: (record.full_name as string | null) ?? '',
    title: (record.title as string | null) ?? null,
    email: (record.email as string | null) ?? null,
    linkedin_url: (record.linkedin_url as string | null) ?? null,
    phone: (record.phone as string | null) ?? null,
    source: (record.source as ContactSource) ?? 'apollo',
    status: (record.status as ContactCandidateStatus) ?? 'pending_review',
    duplicate_status: (record.duplicate_status as ContactDuplicateStatus) ?? 'unchecked',
    confidence: Number(record.confidence ?? 0),
    enrichment_metadata:
      (record.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {},
    enrichment_run_id: (record.enrichment_run_id as string | null) ?? null,
    created_at: record.created_at as string,
    company_name: run?.company_name ?? null,
    company_domain: run?.company_domain ?? null,
    account_id: run?.account_id ?? null,
    hubspot_company_id: run?.hubspot_company_id ?? null,
  } satisfies PendingContactCandidate;
}

/**
 * Candidatos en `pending_review` con el contexto de empresa de su run.
 * Proyección de solo lectura para revisión humana — sin payloads crudos.
 */
export async function getPendingContactCandidates(
  limit: number = PENDING_CANDIDATES_LIMIT,
): Promise<PendingContactCandidate[]> {
  await requireActiveUserForEnrichment();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contact_enrichment_candidates')
    .select(CANDIDATE_SELECT)
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getPendingContactCandidates: ${error.message}`);

  return (data ?? []).map(mapPendingContactCandidate);
}

/**
 * Detalle de un único candidato en `pending_review` para el side panel de
 * revisión (ajuste posterior a 17A.4A). Misma proyección de solo lectura que el
 * listado — sin payloads crudos del proveedor — pero filtrada por id. Devuelve
 * `null` si el candidato no existe o ya salió de `pending_review`, para que el
 * panel muestre su estado "no disponible" sin reventar.
 */
export async function getPendingContactCandidateById(
  candidateId: string,
): Promise<PendingContactCandidate | null> {
  await requireActiveUserForEnrichment();

  if (typeof candidateId !== 'string' || !candidateId.trim()) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contact_enrichment_candidates')
    .select(CANDIDATE_SELECT)
    .eq('id', candidateId.trim())
    .eq('status', 'pending_review')
    .maybeSingle();

  if (error) throw new Error(`getPendingContactCandidateById: ${error.message}`);
  if (!data) return null;

  return mapPendingContactCandidate(data);
}

/**
 * Conteo de candidatos en `pending_review` para el badge del pill.
 * Query indexada (idx ...status); barata para el tab por defecto.
 */
export async function getPendingContactCandidatesCount(): Promise<number> {
  await requireActiveUserForEnrichment();
  const supabase = await createClient();

  const { count, error } = await supabase
    .from('contact_enrichment_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_review');

  if (error) throw new Error(`getPendingContactCandidatesCount: ${error.message}`);
  return count ?? 0;
}

// ── Revisión humana: aprobar / rechazar (Hito 17A.4B) ─────────
// Crea contacto oficial al aprobar y mueve el candidato fuera de pending_review.
// El UPDATE sobre contact_enrichment_candidates exige service_role (RLS solo da
// SELECT a authenticated), igual que el writer del toolkit. NO toca Apollo ni
// HubSpot.

/** Cliente service_role para mutar staging (mismo patrón que el writer). */
function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createServiceRoleClient(url, key);
}

/** Columnas necesarias para mapear candidato → contacto (más que la proyección
 *  de revisión: incluye seniority/department/first_name/last_name). */
const CANDIDATE_REVIEW_SELECT =
  `id, status, full_name, first_name, last_name, title, seniority, department,
   email, phone, linkedin_url, source, enrichment_metadata, enrichment_run_id,
   run:contact_enrichment_runs ( account_id )`;

function mapCandidateRecord(row: unknown): CandidateRecord {
  const r = row as Record<string, unknown>;
  const runRaw = r.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
    | { account_id: string | null }
    | null
    | undefined;
  return {
    id: r.id as string,
    status: (r.status as ContactCandidateStatus) ?? 'pending_review',
    full_name: (r.full_name as string | null) ?? '',
    first_name: (r.first_name as string | null) ?? null,
    last_name: (r.last_name as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    seniority: (r.seniority as string | null) ?? null,
    department: (r.department as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    linkedin_url: (r.linkedin_url as string | null) ?? null,
    source: (r.source as ContactSource) ?? 'apollo',
    enrichment_metadata:
      (r.enrichment_metadata as Record<string, unknown>) ?? {},
    enrichment_run_id: (r.enrichment_run_id as string | null) ?? null,
    account_id: run?.account_id ?? null,
  };
}

export interface ApproveCandidateActionResult {
  ok: boolean;
  contactId?: string;
  message?: string;
  error?: string;
  duplicate?: boolean;
}

export interface DiscardCandidateActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * Aprueba un candidato y crea el contacto oficial en `contacts`. Bloquea si no
 * hay cuenta SellUp asociada o si se detecta un duplicado en la cuenta.
 */
export async function approveContactCandidate(
  candidateId: string,
): Promise<ApproveCandidateActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();
    const supabase = await createClient();
    const admin = getServiceRoleClient();

    const result = await runApproveCandidate(candidateId, {
      actorId: internalUserId,
      nowIso: new Date().toISOString(),
      loadCandidate: async (id) => {
        const { data, error } = await supabase
          .from('contact_enrichment_candidates')
          .select(CANDIDATE_REVIEW_SELECT)
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? mapCandidateRecord(data) : null;
      },
      loadExistingContacts: async (accountId): Promise<ExistingContactForDedup[]> => {
        const { data, error } = await supabase
          .from('contacts')
          .select('id, email, linkedin_url, full_name')
          .eq('account_id', accountId)
          .is('archived_at', null);
        if (error) throw new Error(error.message);
        return (data ?? []) as ExistingContactForDedup[];
      },
      insertContact: async (payload: ContactInsertPayload) => {
        const { data, error } = await supabase
          .from('contacts')
          .insert(payload)
          .select('id')
          .single();
        if (error) return { error: error.message };
        return { id: data.id as string };
      },
      updateCandidate: async (id, patch: CandidateReviewPatch) => {
        const { error } = await admin
          .from('contact_enrichment_candidates')
          .update(patch)
          .eq('id', id);
        return { error: error?.message };
      },
      logAudit: async ({ contactId, accountId, actorUserId }) => {
        await logContactAudit({
          contactId,
          accountId,
          actorUserId,
          actionType: 'contact_created',
          details: { source: 'contact_enrichment_candidate', candidate_id: candidateId },
        });
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error aprobando el candidato';
    return { ok: false, error: message };
  }
}

/**
 * Rechaza un candidato: lo marca `discarded` y guarda el motivo. No crea contacto.
 */
export async function discardContactCandidate(
  candidateId: string,
  reason: string,
): Promise<DiscardCandidateActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();
    const admin = getServiceRoleClient();
    const supabase = await createClient();

    const result = await runDiscardCandidate(candidateId, reason, {
      actorId: internalUserId,
      nowIso: new Date().toISOString(),
      loadCandidate: async (id) => {
        const { data, error } = await supabase
          .from('contact_enrichment_candidates')
          .select(CANDIDATE_REVIEW_SELECT)
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? mapCandidateRecord(data) : null;
      },
      updateCandidate: async (id, patch: CandidateReviewPatch) => {
        const { error } = await admin
          .from('contact_enrichment_candidates')
          .update(patch)
          .eq('id', id);
        return { error: error?.message };
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error rechazando el candidato';
    return { ok: false, error: message };
  }
}
