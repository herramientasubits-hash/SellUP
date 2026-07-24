'use server';

import { redirect } from 'next/navigation';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { resolveCompanyForContactEnrichment } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import { startContactEnrichmentRun } from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-runner';
import { executeContactEnrichmentApolloRun } from '@/server/agents/contact-enrichment-toolkit/apollo-enrichment-runner';
import { executeContactEnrichmentLushaRun } from '@/server/agents/contact-enrichment-toolkit/lusha-enrichment-runner';
import { getLushaAccountUsage } from '@/server/integrations/lusha-client';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { isLushaContactEnrichmentEnabled, resolveLushaSearchTimeoutMs } from '@/lib/feature-flags.server';
import { logContactAudit } from '@/modules/contacts/actions';
import {
  runApproveCandidate,
  runDiscardCandidate,
  type CandidateRecord,
  type CandidateReviewPatch,
  type ContactInsertPayload,
  type ExistingContactForDedup,
  type IdentityApprovalOverrideInputV1,
} from './candidate-review-core';
import { resolveOrCreateAccountForHubSpotCandidate } from './hubspot-account-resolver';
import { classifyLushaRunOutcome } from './lusha-run-outcome-classifier';
import type {
  Agent2AInput,
  CompanyCandidate,
  CompanyResolutionResult,
  ContactEnrichmentRunResult,
  PendingContactCandidate,
  ContactCandidateEnrichmentMetadata,
  ContactSource,
  ContactCandidateStatus,
  ContactDuplicateStatus,
  ContactEnrichmentRunStatus,
  PhoneRevealStatus,
} from './types';
import { createInitialContactEnrichmentAttempt } from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-attempt-creator';
import {
  resolveAttemptForRequestProvider,
  type ExistingAttemptProviderAndStatus,
} from './request-attempt-resolution-core';
import { createContactEnrichmentRequest } from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-request-creator';
import type { IntendedProvider, CompanyResolutionSource } from './request-attempt-types';

// ── Auth helper (patrón idéntico a prospect-batches/actions.ts) ───────────────

export async function requireActiveUserForEnrichment(): Promise<{ internalUserId: string }> {
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
  /** attemptId resuelto (Hito 17B.4X.7C.2) — solo presente cuando el caller
   *  vino de runContactEnrichmentApolloForRequestAction. */
  attemptId?: string;
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
  `id, full_name, title, email, linkedin_url, source_contact_id, phone, source, status,
   duplicate_status, confidence, enrichment_metadata, enrichment_run_id, created_at,
   phone_reveal_status,
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
    source_contact_id: (record.source_contact_id as string | null) ?? null,
    phone: (record.phone as string | null) ?? null,
    source: (record.source as ContactSource) ?? 'apollo',
    status: (record.status as ContactCandidateStatus) ?? 'pending_review',
    duplicate_status: (record.duplicate_status as ContactDuplicateStatus) ?? 'unchecked',
    confidence: Number(record.confidence ?? 0),
    enrichment_metadata:
      (record.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {},
    enrichment_run_id: (record.enrichment_run_id as string | null) ?? null,
    created_at: record.created_at as string,
    phone_reveal_status:
      (record.phone_reveal_status as PhoneRevealStatus | null) ?? null,
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
 *  de revisión: incluye seniority/department/first_name/last_name y datos de empresa
 *  del run para resolución de cuenta HubSpot-only — Hito 17A.9H/17A.9H.2). */
const CANDIDATE_REVIEW_SELECT =
  `id, status, full_name, first_name, last_name, title, seniority, department,
   email, phone, linkedin_url, source, enrichment_metadata, enrichment_run_id,
   run:contact_enrichment_runs ( account_id, hubspot_company_id, company_name, company_domain, company_country_code )`;

function mapCandidateRecord(row: unknown): CandidateRecord {
  const r = row as Record<string, unknown>;
  const runRaw = r.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
    | {
        account_id: string | null;
        hubspot_company_id: string | null;
        company_name: string | null;
        company_domain: string | null;
        company_country_code: string | null;
      }
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
    hubspot_company_id: run?.hubspot_company_id ?? null,
    company_name: run?.company_name ?? null,
    company_domain: run?.company_domain ?? null,
    country_code: run?.company_country_code ?? null,
  };
}

export interface ApproveCandidateActionResult {
  ok: boolean;
  contactId?: string;
  message?: string;
  error?: string;
  duplicate?: boolean;
  code?: 'IDENTITY_MISMATCH_REQUIRES_REVIEW' | 'IDENTITY_OVERRIDE_REASON_REQUIRED';
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
  identityOverride?: IdentityApprovalOverrideInputV1,
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
      logAudit: async ({ contactId, accountId, actorUserId, identityOverrideApplied }) => {
        await logContactAudit({
          contactId,
          accountId,
          actorUserId,
          actionType: 'contact_created',
          details: {
            source: 'contact_enrichment_candidate',
            candidate_id: candidateId,
            ...(identityOverrideApplied
              ? { identity_override_used: true, identity_state_at_override: 'mismatch' as const }
              : {}),
          },
        });
      },
      resolveOrCreateAccount: async (args) => {
        return resolveOrCreateAccountForHubSpotCandidate(args, {
          findByHubspotId: async (hid) => {
            const { data } = await admin
              .from('accounts')
              .select('id')
              .eq('hubspot_company_id', hid)
              .is('archived_at', null)
              .maybeSingle();
            return data ? { id: data.id as string } : null;
          },
          findByDomain: async (domain) => {
            const { data } = await admin
              .from('accounts')
              .select('id, hubspot_company_id')
              .eq('domain', domain)
              .is('archived_at', null)
              .maybeSingle();
            return data
              ? { id: data.id as string, hubspot_company_id: (data.hubspot_company_id as string | null) ?? null }
              : null;
          },
          createAccount: async (input) => {
            const normalizedName = input.name
              .toLowerCase()
              .normalize('NFD')
              .replace(/\p{Diacritic}/gu, '')
              .replace(/[^a-z0-9\s]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            const { data, error } = await admin
              .from('accounts')
              .insert({
                name: input.name,
                normalized_name: normalizedName,
                domain: input.domain,
                website: input.website,
                hubspot_company_id: input.hubspot_company_id,
                country_code: input.country_code ?? null,
                source: 'hubspot',
                pipeline_status: 'new',
                metadata: {
                  created_from: 'contact_enrichment_approval',
                  source_hubspot_company_id: input.hubspot_company_id,
                  source_contact_enrichment_run_id: input.run_id ?? null,
                  created_from_candidate_approval: true,
                  country_resolution: {
                    source: input.country_code ? 'contact_enrichment_run' : 'unknown',
                    resolved_country_code: input.country_code ?? null,
                    applied_on_candidate_approval: true,
                  },
                },
                created_by: internalUserId,
                updated_by: internalUserId,
              })
              .select('id')
              .single();
            if (error) return { error: error.message };
            return { id: data.id as string };
          },
          linkHubspotId: async (accountId, hubspotId) => {
            await admin
              .from('accounts')
              .update({ hubspot_company_id: hubspotId, updated_by: internalUserId })
              .eq('id', accountId);
          },
          updateAccountCountryCode: async (accountId, countryCode) => {
            await admin
              .from('accounts')
              .update({ country_code: countryCode, updated_by: internalUserId })
              .eq('id', accountId)
              .is('country_code', null);
          },
        });
      },
      updateRunAccountId: async (runId, accountId, outcome, countryCodeApplied, countryResolutionSource) => {
        const { data: runRow } = await admin
          .from('contact_enrichment_runs')
          .select('summary')
          .eq('id', runId)
          .single();
        const currentSummary = (runRow?.summary as Record<string, unknown>) ?? {};
        await admin
          .from('contact_enrichment_runs')
          .update({
            account_id: accountId,
            summary: {
              ...currentSummary,
              account_created_on_candidate_approval: outcome === 'created',
              account_linked_on_candidate_approval: outcome !== 'created',
              approval_account_resolution: {
                outcome,
                resolved_account_id: accountId,
                country_code_applied: countryCodeApplied ?? null,
                country_resolution_source: countryResolutionSource ?? 'unknown',
              },
            },
          })
          .eq('id', runId);
      },
    }, identityOverride);

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error aprobando el candidato';
    return { ok: false, error: message };
  }
}

// ── Bulk Enrichment Actions (Hito 17A.10C) ───────────────────────────────────

import { checkBulkContactEnrichmentEligibility } from './bulk-enrichment-eligibility';
import { CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS } from './bulk-enrichment-types';
import type { BulkEnrichmentEligibilityResult } from './bulk-enrichment-types';

export interface CheckBulkEnrichmentEligibilityActionResult {
  success: boolean;
  data?: BulkEnrichmentEligibilityResult;
  error?: string;
}

/**
 * Verifica elegibilidad para enriquecimiento bulk. Solo lectura — sin DB writes ni Apollo.
 */
export async function checkBulkEnrichmentEligibilityAction(
  accountIds: string[],
): Promise<CheckBulkEnrichmentEligibilityActionResult> {
  try {
    await requireActiveUserForEnrichment();

    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      throw new Error('Se requiere al menos una cuenta');
    }
    if (accountIds.length > CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS) {
      throw new Error(
        `Máximo ${CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS} cuentas por bulk run`,
      );
    }

    const uniqueIds = [...new Set(accountIds.filter((id) => typeof id === 'string' && id.trim()))];
    const result = await checkBulkContactEnrichmentEligibility(uniqueIds);
    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error verificando elegibilidad';
    return { success: false, error: message };
  }
}

export interface CreateBulkContactEnrichmentRunActionResult {
  success: boolean;
  bulkRunId?: string;
  status?: string;
  eligibility?: BulkEnrichmentEligibilityResult;
  executeUrl?: string;
  error?: string;
}

/**
 * Crea el registro bulk_run con elegibilidad calculada.
 * No ejecuta Apollo — retorna executeUrl para llamar la route POST.
 */
export async function createBulkContactEnrichmentRunAction(
  accountIds: string[],
): Promise<CreateBulkContactEnrichmentRunActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();

    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      throw new Error('Se requiere al menos una cuenta');
    }
    if (accountIds.length > CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS) {
      throw new Error(
        `Máximo ${CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS} cuentas por bulk run`,
      );
    }

    const uniqueIds = [...new Set(accountIds.filter((id) => typeof id === 'string' && id.trim()))];
    const eligibility = await checkBulkContactEnrichmentEligibility(uniqueIds);

    const admin = getServiceRoleClient();

    // Sin elegibles → crear bulk failed, no ejecutar
    if (eligibility.eligible.length === 0) {
      const { data: failedRun, error: insertError } = await admin
        .from('contact_enrichment_bulk_runs')
        .insert({
          triggered_by: internalUserId,
          status: 'failed',
          selected_account_ids: uniqueIds,
          eligible_account_ids: [],
          skipped_accounts: eligibility.skipped,
          total_selected: eligibility.selectedCount,
          total_eligible: 0,
          total_skipped: eligibility.skipped.length,
          estimated_apollo_credits: 0,
          summary: { error: 'Sin cuentas elegibles para enriquecimiento bulk' },
          metadata: { hito: '17A.10C', source: 'bulk_enrichment_action' },
        })
        .select('id')
        .single();

      if (insertError || !failedRun) {
        throw new Error(`No se pudo crear bulk run fallido: ${insertError?.message}`);
      }

      return {
        success: false,
        bulkRunId: failedRun.id as string,
        status: 'failed',
        eligibility,
        error: 'Sin cuentas elegibles para enriquecimiento bulk',
      };
    }

    const eligibleIds = eligibility.eligible.map((e) => e.accountId);

    const { data: bulkRun, error: insertError } = await admin
      .from('contact_enrichment_bulk_runs')
      .insert({
        triggered_by: internalUserId,
        status: 'created',
        selected_account_ids: uniqueIds,
        eligible_account_ids: eligibleIds,
        skipped_accounts: eligibility.skipped,
        total_selected: eligibility.selectedCount,
        total_eligible: eligibility.eligible.length,
        total_skipped: eligibility.skipped.length,
        estimated_apollo_credits: eligibility.estimatedApolloCredits,
        summary: {
          created_by_action: 'createBulkContactEnrichmentRunAction',
          eligible_account_names: eligibility.eligible.map((e) => e.name),
        },
        metadata: { hito: '17A.10C', source: 'bulk_enrichment_action' },
      })
      .select('id')
      .single();

    if (insertError || !bulkRun) {
      throw new Error(`No se pudo crear bulk run: ${insertError?.message}`);
    }

    const bulkRunId = bulkRun.id as string;

    return {
      success: true,
      bulkRunId,
      status: 'created',
      eligibility,
      executeUrl: `/api/contact-enrichment/bulk-runs/${bulkRunId}/execute`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error creando bulk run';
    return { success: false, error: message };
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

// ── Bulk Run Status (Hito 17A.10K) ────────────────────────────────────────────

export type BulkRunStatus =
  | 'created'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export interface GetBulkRunStatusResult {
  ok: true;
  bulkRunId: string;
  status: BulkRunStatus;
  totalSelected: number;
  totalEligible: number;
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
  totalSkipped: number;
  totalCandidatesCreated: number;
  summary: unknown;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GetBulkRunStatusError {
  ok: false;
  error: 'not_found' | 'unauthorized' | 'unknown';
}

/**
 * Lee el estado actual de un bulk run. Solo lectura — sin Apollo, sin writes.
 */
export async function getBulkContactEnrichmentRunStatusAction(
  bulkRunId: string,
): Promise<GetBulkRunStatusResult | GetBulkRunStatusError> {
  try {
    await requireActiveUserForEnrichment();

    if (!bulkRunId || typeof bulkRunId !== 'string') {
      return { ok: false, error: 'not_found' };
    }

    const admin = getServiceRoleClient();
    const { data, error } = await admin
      .from('contact_enrichment_bulk_runs')
      .select(
        'id, status, total_selected, total_eligible, total_processed, total_succeeded, total_failed, total_skipped, total_candidates_created, summary, started_at, completed_at',
      )
      .eq('id', bulkRunId)
      .maybeSingle();

    if (error || !data) {
      return { ok: false, error: 'not_found' };
    }

    const knownStatuses: BulkRunStatus[] = [
      'created',
      'running',
      'completed',
      'completed_with_errors',
      'failed',
    ];
    const status: BulkRunStatus = knownStatuses.includes(data.status as BulkRunStatus)
      ? (data.status as BulkRunStatus)
      : 'failed';

    return {
      ok: true,
      bulkRunId: data.id as string,
      status,
      totalSelected: (data.total_selected as number | null) ?? 0,
      totalEligible: (data.total_eligible as number | null) ?? 0,
      totalProcessed: (data.total_processed as number | null) ?? 0,
      totalSucceeded: (data.total_succeeded as number | null) ?? 0,
      totalFailed: (data.total_failed as number | null) ?? 0,
      totalSkipped: (data.total_skipped as number | null) ?? 0,
      totalCandidatesCreated: (data.total_candidates_created as number | null) ?? 0,
      summary: data.summary,
      startedAt: (data.started_at as string | null) ?? null,
      completedAt: (data.completed_at as string | null) ?? null,
    };
  } catch {
    return { ok: false, error: 'unknown' };
  }
}

// ── Lusha Action (17B.4K) ─────────────────────────────────────────────────────
// Proveedor controlado detrás de ENABLE_LUSHA_CONTACT_ENRICHMENT.
// No crea contactos finales. No toca HubSpot. No revela teléfonos.
// Requiere revisión humana antes de crear contacto oficial.

export interface RunLushaActionResult {
  success: boolean;
  status?: 'ready_for_review' | 'completed' | 'no_reviewable_candidate' | 'disabled' | 'missing_api_key' | 'not_found' | 'invalid_account' | 'invalid_run_status' | 'provider_error' | 'error';
  candidatesCreated?: number;
  duplicatesSkipped?: number;
  rawResultsCount?: number;
  creditsUsed?: number | null;
  providerStatus?: 'success' | 'skipped' | 'error';
  noReviewableContactsFound?: boolean;
  /** attemptId resuelto (Hito 17B.4X.7C.2) — solo presente cuando el caller
   *  vino de runContactEnrichmentLushaForRequestAction. */
  attemptId?: string;
  error?: string;
}

/**
 * Ejecuta Lusha para un run en ready_to_enrich: busca personas en la empresa,
 * normaliza, deduplica y crea candidatos en staging.
 * NO crea contactos finales ni escribe en HubSpot. Requiere revisión humana.
 * Gated por ENABLE_LUSHA_CONTACT_ENRICHMENT.
 */
export async function runContactEnrichmentLushaAction(
  runId: unknown,
): Promise<RunLushaActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();

    if (typeof runId !== 'string' || !runId.trim()) {
      throw new Error('runId inválido');
    }

    const result = await executeContactEnrichmentLushaRun(runId.trim(), internalUserId);
    const outcome = classifyLushaRunOutcome(result);

    return {
      success: outcome.success,
      status: result.status as RunLushaActionResult['status'],
      candidatesCreated: result.candidatesCreated,
      duplicatesSkipped: result.duplicatesSkipped ?? 0,
      rawResultsCount: result.rawResultsCount ?? 0,
      creditsUsed: result.creditsUsed,
      providerStatus: outcome.providerStatus,
      noReviewableContactsFound: result.candidatesCreated === 0,
      error: outcome.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error ejecutando Lusha';
    return { success: false, status: 'error', providerStatus: 'error', error: message };
  }
}

// ── Lusha feature flag check (17B.4K) ────────────────────────────────────────

/**
 * Returns whether the Lusha contact enrichment feature is enabled.
 * Safe to call from client components via server action.
 */
export async function isLushaEnabledAction(): Promise<boolean> {
  return isLushaContactEnrichmentEnabled();
}

// ── Lusha Account Usage Health Check (Agente 2A · 17B.4A) ────────────────────
// Diagnóstico seguro de cuenta Lusha. No busca personas. No crea candidatos.
// No revela emails ni teléfonos. Solo GET /v3/account/usage.

/**
 * Server action para verificar estado de cuenta Lusha.
 * Sin crear candidatos, sin buscar personas, sin revelar PII.
 */
export async function checkLushaAccountUsageAction() {
  await requireActiveUserForEnrichment();

  if (!isLushaContactEnrichmentEnabled()) {
    return {
      ok: false,
      status: 'disabled' as const,
      message: 'Lusha contact enrichment is disabled.',
    };
  }

  const apiKey = await getLushaApiKey();

  if (!apiKey) {
    return {
      ok: false,
      status: 'missing_api_key' as const,
      message: 'Lusha API key is not configured.',
    };
  }

  return getLushaAccountUsage({
    apiKey,
    timeoutMs: resolveLushaSearchTimeoutMs(),
  });
}

// ── Request-level orchestration (Hito 17B.4X.7C.2) ────────────────────────────
// Wires contact_enrichment_requests → contact_enrichment_runs as attempts.
// NO automatic fallback, NO attempt_order=2, NO routing evaluation side
// effects, NO request-level status write (request status is deferred).
// Legacy attempt-id actions (runContactEnrichmentApolloAction/
// runContactEnrichmentLushaAction) and bulk keep working unchanged — both
// now execute through the atomic claim inside the runners.

async function loadExistingAttemptProviderAndStatus(
  attemptId: string,
): Promise<ExistingAttemptProviderAndStatus | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('contact_enrichment_runs')
    .select('intended_provider, status')
    .eq('id', attemptId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    intendedProvider: (data.intended_provider as IntendedProvider | null) ?? null,
    status: data.status as ContactEnrichmentRunStatus,
  };
}

async function resolveAttemptIdForRequestProvider(
  requestId: string,
  provider: IntendedProvider,
  triggeredBy: string,
) {
  return resolveAttemptForRequestProvider(requestId, provider, triggeredBy, {
    createAttempt: (reqId, prov, trig) =>
      createInitialContactEnrichmentAttempt({
        requestId: reqId,
        intendedProvider: prov,
        triggeredBy: trig,
      }),
    loadExistingAttempt: loadExistingAttemptProviderAndStatus,
  });
}

export interface CreateContactEnrichmentRequestActionResult {
  success: boolean;
  requestId?: string;
  error?: string;
}

/**
 * Crea el contact_enrichment_requests de esta empresa confirmada. Context-only:
 * no crea agent_run, no crea contact_enrichment_runs, no toma snapshot de
 * contactos existentes, no llama Apollo/Lusha. El attempt (con snapshot) se
 * crea al ejecutar runContactEnrichmentApolloForRequestAction /
 * runContactEnrichmentLushaForRequestAction.
 */
export async function createContactEnrichmentRequestAction(
  confirmedCompany: CompanyCandidate,
): Promise<CreateContactEnrichmentRequestActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();

    if (!confirmedCompany?.name?.trim()) {
      throw new Error('La empresa confirmada no tiene nombre');
    }

    const result = await createContactEnrichmentRequest({
      accountId: confirmedCompany.sellupAccountId ?? null,
      companyName: confirmedCompany.name,
      companyDomain: confirmedCompany.domain ?? null,
      companyCountryCode: confirmedCompany.countryCode ?? null,
      hubspotCompanyId: confirmedCompany.hubspotCompanyId ?? null,
      companyResolutionSource: confirmedCompany.source as CompanyResolutionSource,
      triggeredBy: internalUserId,
    });

    if (result.status !== 'created') {
      return { success: false, error: result.reason };
    }

    return { success: true, requestId: result.request.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error creando la request de enriquecimiento';
    return { success: false, error: message };
  }
}

/**
 * Ejecuta Apollo a nivel de request: crea (o reutiliza de forma segura) el
 * attempt_order=1 de esta request y ejecuta el runner existente por
 * attemptId. No crea attempt_order=2, no evalúa routing, no aplica
 * fallback automático.
 */
export async function runContactEnrichmentApolloForRequestAction(
  requestId: unknown,
): Promise<RunApolloActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();

    if (typeof requestId !== 'string' || !requestId.trim()) {
      throw new Error('requestId inválido');
    }

    const resolved = await resolveAttemptIdForRequestProvider(
      requestId.trim(),
      'apollo',
      internalUserId,
    );

    if (resolved.outcome === 'rejected') {
      return { success: false, status: 'error', error: resolved.message };
    }

    const result = await executeContactEnrichmentApolloRun(resolved.attemptId, internalUserId);

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
      attemptId: resolved.attemptId,
      error: result.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error ejecutando Apollo para la request';
    return { success: false, status: 'error', error: message };
  }
}

/**
 * Ejecuta Lusha a nivel de request: crea (o reutiliza de forma segura) el
 * attempt_order=1 de esta request y ejecuta el runner existente por
 * attemptId. No crea attempt_order=2, no evalúa routing, no aplica
 * fallback automático.
 */
export async function runContactEnrichmentLushaForRequestAction(
  requestId: unknown,
): Promise<RunLushaActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();

    if (typeof requestId !== 'string' || !requestId.trim()) {
      throw new Error('requestId inválido');
    }

    const resolved = await resolveAttemptIdForRequestProvider(
      requestId.trim(),
      'lusha',
      internalUserId,
    );

    if (resolved.outcome === 'rejected') {
      return { success: false, status: 'error', providerStatus: 'error', error: resolved.message };
    }

    const result = await executeContactEnrichmentLushaRun(resolved.attemptId, internalUserId);
    const outcome = classifyLushaRunOutcome(result);

    return {
      success: outcome.success,
      status: result.status as RunLushaActionResult['status'],
      candidatesCreated: result.candidatesCreated,
      duplicatesSkipped: result.duplicatesSkipped ?? 0,
      rawResultsCount: result.rawResultsCount ?? 0,
      creditsUsed: result.creditsUsed,
      providerStatus: outcome.providerStatus,
      noReviewableContactsFound: result.candidatesCreated === 0,
      attemptId: resolved.attemptId,
      error: outcome.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error ejecutando Lusha para la request';
    return { success: false, status: 'error', providerStatus: 'error', error: message };
  }
}
