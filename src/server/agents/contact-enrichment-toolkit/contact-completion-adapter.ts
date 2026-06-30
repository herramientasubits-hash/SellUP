// Agente 2A — Contact Completion Adapter
// Hito 17A.3C — Completa selectivamente los mejores candidatos Apollo (relevantes
// y de calidad) usando people/match ANTES de dejarlos como pending_review, para
// que un candidato solo llegue a revisión si tiene datos realmente accionables.
//
// Reglas:
//  - Solo se intenta completar candidatos que ya pasaron relevancia/calidad.
//  - Tope duro de candidatos a completar por run (control de costo / créditos).
//  - No se llama a Apollo si el candidato ya es accionable (ahorra créditos).
//  - No se llama a Apollo si falta identidad mínima para el match.
//  - No usa LLM. No guarda payload crudo: solo metadata resumida.
//  - No usa Lusha ni teléfonos async (reveal diferido) en este hito.

import {
  matchApolloPerson,
  type ApolloPerson,
  type MatchPersonParams,
  type ApolloEnrichResult,
} from '@/server/integrations/apollo-client';
import { normalizeApolloPerson, type NormalizedApolloContact } from './contact-normalizer';
import type {
  ContactRelevanceResult,
  ContactRelevanceStatus,
} from './contact-relevance-classifier';

// ── Constantes de configuración local ──────────────────────────

/** Tope de candidatos a completar por run (control de costo / créditos). */
export const MAX_COMPLETION_CANDIDATES = 3;

/**
 * Créditos estimados por email completado (modelo operativo interno, inspirado
 * en flujos n8n anteriores: completion_credits = emails + 8 * phones).
 */
export const COMPLETION_CREDIT_EMAIL = 1;

/**
 * Créditos estimados por teléfono completado (modelo operativo interno).
 * 8× el costo de un email — mucho más caro en el modelo anterior de n8n.
 */
export const COMPLETION_CREDIT_PHONE = 8;

/**
 * Completion de teléfonos desactivada por default.
 * Apollo requiere un webhook separado para revelar números reales (caro).
 * Activar solo cuando el flujo de reveal esté implementado y presupuestado.
 */
export const PHONE_COMPLETION_ENABLED = false;

/**
 * Presupuesto máximo de créditos de completion por run (guardrail de costo).
 * Conservador: permite hasta 3 emails (= MAX_COMPLETION_CANDIDATES × 1 crédito).
 * Si se activa phone_completion, bajar este valor o ajustar.
 */
export const MAX_COMPLETION_CREDITS_PER_RUN = 10;

/** Canales accionables que cuentan para dejar un candidato revisable. */
export const ACTIONABLE_CHANNEL_FIELDS = ['email', 'linkedin_url', 'phone'] as const;
export type ActionableChannelField = (typeof ACTIONABLE_CHANNEL_FIELDS)[number];

// ── Tipos públicos ─────────────────────────────────────────────

export interface CompleteContactInput {
  candidate: NormalizedApolloContact;
  companyName: string;
  companyDomain?: string | null;
  /** Veredicto de relevancia del candidato (gobierna reglas de un solo token). */
  relevanceStatus?: ContactRelevanceStatus;
}

export interface CompletionProviderUsage {
  provider: 'apollo';
  operation: 'person_match';
  creditsUsed: number;
  estimatedCostUsd?: number;
}

export interface CompleteContactResult {
  status: 'completed' | 'skipped' | 'error';
  contact: NormalizedApolloContact;
  /** Campos que se completaron respecto al candidato base (email/linkedin_url/phone/full_name). */
  completedFields: string[];
  /** ¿El candidato ya era accionable antes de intentar completar? */
  wasActionableBefore: boolean;
  /** ¿El candidato quedó accionable después del proceso? */
  isActionableAfter: boolean;
  providerUsage?: CompletionProviderUsage;
  reason?: string;
}

export interface ContactCompletionDeps {
  matchPerson?: (params: MatchPersonParams) => Promise<ApolloEnrichResult<ApolloPerson>>;
  /** Costo unitario por crédito Apollo (para estimar el costo del match). */
  unitCostUsd?: number;
}

// ── Guardrail de costo de completion ──────────────────────────

export interface CompletionCostGuardrailResult {
  allowed: boolean;
  /** Créditos estimados antes de ejecutar completion. */
  estimatedCredits: number;
  /** Presupuesto máximo configurado para este run. */
  maxCredits: number;
  /** Razón del bloqueo (undefined si está permitido). */
  blockedReason?: string;
}

/**
 * Estima los créditos de completion antes de ejecutar el run.
 * Modelo operativo interno (inspirado en flujos n8n):
 *   credits = candidates × (CREDIT_EMAIL + (phoneEnabled ? CREDIT_PHONE : 0))
 */
export function estimateCompletionCredits(
  candidatesCount: number,
  phoneEnabled: boolean = PHONE_COMPLETION_ENABLED,
): number {
  const perCandidate = COMPLETION_CREDIT_EMAIL + (phoneEnabled ? COMPLETION_CREDIT_PHONE : 0);
  return candidatesCount * perCandidate;
}

/**
 * Calcula los créditos reales de completion basados en los campos que se completaron.
 * Modelo operativo interno (n8n): email=1, phone=8.
 * Siempre devuelve al menos 1 cuando el match fue llamado (costo de la llamada API).
 */
export function calculateActualCompletionCredits(
  completedFields: string[],
  phoneEnabled: boolean = PHONE_COMPLETION_ENABLED,
): number {
  const emailCredits = completedFields.includes('email') ? COMPLETION_CREDIT_EMAIL : 0;
  const phoneCredits =
    phoneEnabled && completedFields.includes('phone') ? COMPLETION_CREDIT_PHONE : 0;
  return Math.max(1, emailCredits + phoneCredits);
}

/**
 * Verifica si la completion está dentro del presupuesto máximo del run.
 * Se ejecuta ANTES del loop de completion para evitar gastar créditos.
 */
export function checkCompletionCostGuardrail(
  candidatesCount: number,
  options: {
    phoneEnabled?: boolean;
    maxCreditsPerRun?: number;
  } = {},
): CompletionCostGuardrailResult {
  const phoneEnabled = options.phoneEnabled ?? PHONE_COMPLETION_ENABLED;
  const maxCredits = options.maxCreditsPerRun ?? MAX_COMPLETION_CREDITS_PER_RUN;
  const estimatedCredits = estimateCompletionCredits(candidatesCount, phoneEnabled);
  const allowed = estimatedCredits <= maxCredits;
  return {
    allowed,
    estimatedCredits,
    maxCredits,
    blockedReason: allowed
      ? undefined
      : `completion bloqueada: ${estimatedCredits} créditos estimados supera el límite de ${maxCredits}`,
  };
}

// ── Helpers de calidad de nombre / canal ───────────────────────

function nameTokens(fullName: string | null | undefined): string[] {
  return (fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function headlineOf(contact: NormalizedApolloContact): string | null {
  const headline = contact.enrichmentMetadata?.headline;
  return typeof headline === 'string' && headline.trim().length > 0 ? headline.trim() : null;
}

function hasUsableTitle(contact: NormalizedApolloContact): boolean {
  return !!(contact.title?.trim() || headlineOf(contact));
}

function channelsOf(contact: NormalizedApolloContact): {
  hasEmail: boolean;
  hasLinkedin: boolean;
  hasPhone: boolean;
  hasAny: boolean;
} {
  const hasEmail = !!contact.email?.trim();
  const hasLinkedin = !!contact.linkedinUrl?.trim();
  const hasPhone = !!contact.phone?.trim();
  return { hasEmail, hasLinkedin, hasPhone, hasAny: hasEmail || hasLinkedin || hasPhone };
}

// ── Parte 4 — Filtro accionable final ──────────────────────────

/**
 * Un candidato es accionable (revisable) solo si:
 *  - tiene nombre utilizable,
 *  - tiene cargo (title o headline),
 *  - y al menos un canal: email, linkedin_url o phone.
 *
 * Casos límite (según el hito):
 *  - nombre de un solo token sin canal → false.
 *  - nombre completo + title + linkedin/email → true.
 *  - nombre completo + title sin canal → false.
 *  - primer nombre (un token) + title + email → true SOLO si relevancia alta/media.
 *  - sin title → false.
 */
export function isActionableContactCandidate(
  contact: NormalizedApolloContact,
  relevanceStatus?: ContactRelevanceStatus,
): boolean {
  if (!hasUsableTitle(contact)) return false;

  const tokens = nameTokens(contact.fullName);
  if (tokens.length === 0) return false;

  const { hasEmail, hasAny } = channelsOf(contact);
  if (!hasAny) return false;

  const isCompleteName = tokens.length >= 2;
  if (isCompleteName) return true;

  // Nombre de un solo token: solo accionable con email y relevancia alta/media.
  const strongRelevance =
    relevanceStatus === 'high_relevance' || relevanceStatus === 'medium_relevance';
  return hasEmail && strongRelevance;
}

// ── Parte 3 — Merge seguro de datos enriquecidos ───────────────

/**
 * Combina el candidato base (de people search) con el contacto enriquecido
 * (de people/match) sin pisar datos buenos con null.
 *  - Conserva el valor base cuando existe; rellena huecos desde el completado.
 *  - Si el full_name completo (≥2 tokens) viene del match y el base era de un
 *    solo token, adopta el nombre (y first/last) del match.
 *  - Conserva sourceContactId del base.
 *  - No guarda payload crudo: la metadata de match resumida la añade el caller.
 */
export function mergeCompletedContactData(
  base: NormalizedApolloContact,
  completed: NormalizedApolloContact,
): NormalizedApolloContact {
  const baseTokens = nameTokens(base.fullName);
  const completedTokens = nameTokens(completed.fullName);
  const adoptCompletedName = baseTokens.length < 2 && completedTokens.length >= 2;

  return {
    firstName: adoptCompletedName ? completed.firstName : (base.firstName ?? completed.firstName),
    lastName: adoptCompletedName ? completed.lastName : (base.lastName ?? completed.lastName),
    fullName: adoptCompletedName ? completed.fullName : base.fullName || completed.fullName,
    title: base.title ?? completed.title,
    seniority: base.seniority ?? completed.seniority,
    department: base.department ?? completed.department,
    country: base.country ?? completed.country,
    linkedinUrl: base.linkedinUrl ?? completed.linkedinUrl,
    email: base.email ?? completed.email,
    phone: base.phone ?? completed.phone,
    source: 'apollo',
    sourceContactId: base.sourceContactId ?? completed.sourceContactId,
    confidence: Math.max(base.confidence, completed.confidence),
    // Conserva la metadata del search base (incl. headline / organization).
    enrichmentMetadata: { ...base.enrichmentMetadata },
  };
}

/** Campos (canal + full_name) que pasaron de ausentes a presentes tras el merge. */
function diffCompletedFields(
  base: NormalizedApolloContact,
  merged: NormalizedApolloContact,
): string[] {
  const fields: string[] = [];
  if (!base.email?.trim() && !!merged.email?.trim()) fields.push('email');
  if (!base.linkedinUrl?.trim() && !!merged.linkedinUrl?.trim()) fields.push('linkedin_url');
  if (!base.phone?.trim() && !!merged.phone?.trim()) fields.push('phone');
  if (nameTokens(base.fullName).length < 2 && nameTokens(merged.fullName).length >= 2) {
    fields.push('full_name');
  }
  return fields;
}

// ── Identidad mínima para llamar a people/match ────────────────

function buildMatchParams(input: CompleteContactInput): MatchPersonParams | null {
  const { candidate, companyName, companyDomain } = input;
  const params: MatchPersonParams = {};

  if (candidate.firstName?.trim()) params.first_name = candidate.firstName.trim();
  if (candidate.lastName?.trim()) params.last_name = candidate.lastName.trim();
  if (companyName?.trim()) params.organization_name = companyName.trim();
  if (companyDomain?.trim()) params.domain = companyDomain.trim();
  if (candidate.linkedinUrl?.trim()) params.linkedin_url = candidate.linkedinUrl.trim();
  if (candidate.email?.trim()) params.email = candidate.email.trim();

  // Identidad mínima para un match útil: LinkedIn, email, o nombre + empresa.
  const hasStrongId = !!params.linkedin_url || !!params.email;
  const hasNameAndCompany =
    !!(params.first_name || params.last_name) &&
    !!(params.organization_name || params.domain);

  if (!hasStrongId && !hasNameAndCompany) return null;
  return params;
}

// ── Parte 1 — Completador selectivo ────────────────────────────

/**
 * Intenta completar un candidato relevante usando Apollo people/match.
 *  - Si ya es accionable → 'skipped' (no consume créditos).
 *  - Si falta identidad mínima para el match → 'skipped'.
 *  - Si Apollo devuelve datos → merge seguro y 'completed'.
 *  - Si Apollo no encuentra persona o falla → 'skipped' / 'error' (no rompe el run).
 */
export async function completeContactWithApollo(
  input: CompleteContactInput,
  deps: ContactCompletionDeps = {},
): Promise<CompleteContactResult> {
  const { matchPerson = matchApolloPerson, unitCostUsd } = deps;
  const { candidate, relevanceStatus } = input;

  const wasActionableBefore = isActionableContactCandidate(candidate, relevanceStatus);
  if (wasActionableBefore) {
    return {
      status: 'skipped',
      contact: candidate,
      completedFields: [],
      wasActionableBefore: true,
      isActionableAfter: true,
      reason: 'candidate_already_actionable',
    };
  }

  const matchParams = buildMatchParams(input);
  if (!matchParams) {
    return {
      status: 'skipped',
      contact: candidate,
      completedFields: [],
      wasActionableBefore: false,
      isActionableAfter: false,
      reason: 'insufficient_input_for_match',
    };
  }

  let result: ApolloEnrichResult<ApolloPerson>;
  try {
    result = await matchPerson(matchParams);
  } catch (err) {
    return {
      status: 'error',
      contact: candidate,
      completedFields: [],
      wasActionableBefore: false,
      isActionableAfter: false,
      reason: err instanceof Error ? err.message : 'Error inesperado en people/match',
    };
  }

  const providerUsage: CompletionProviderUsage = {
    provider: 'apollo',
    operation: 'person_match',
    creditsUsed: 1,
    ...(typeof unitCostUsd === 'number' && unitCostUsd >= 0
      ? { estimatedCostUsd: Number(unitCostUsd.toFixed(6)) }
      : {}),
  };

  if (!result.success) {
    return {
      status: 'error',
      contact: candidate,
      completedFields: [],
      wasActionableBefore: false,
      isActionableAfter: false,
      providerUsage,
      reason: result.error?.message ?? 'Error en people/match',
    };
  }

  const matchedPerson = result.data;
  const completedContact = matchedPerson ? normalizeApolloPerson(matchedPerson) : null;
  if (!completedContact) {
    // El match consumió crédito pero no devolvió datos utilizables.
    return {
      status: 'skipped',
      contact: candidate,
      completedFields: [],
      wasActionableBefore: false,
      isActionableAfter: false,
      providerUsage,
      reason: 'no_match_data',
    };
  }

  const merged = mergeCompletedContactData(candidate, completedContact);
  const completedFields = diffCompletedFields(candidate, merged);
  const isActionableAfter = isActionableContactCandidate(merged, relevanceStatus);

  // Créditos reales basados en lo que se completó (modelo operativo n8n: email=1, phone=8).
  const actualCredits = calculateActualCompletionCredits(completedFields);

  return {
    status: 'completed',
    contact: merged,
    completedFields,
    wasActionableBefore: false,
    isActionableAfter,
    providerUsage: {
      ...providerUsage,
      creditsUsed: actualCredits,
      ...(typeof unitCostUsd === 'number' && unitCostUsd >= 0
        ? { estimatedCostUsd: Number((actualCredits * unitCostUsd).toFixed(6)) }
        : {}),
    },
  };
}

// ── Selección de candidatos a completar ────────────────────────

export interface ClassifiedCandidate {
  contact: NormalizedApolloContact;
  relevance: ContactRelevanceResult;
}

/** Cuenta de campos base presentes (señal de completitud para desempatar). */
function baseFieldsCount(contact: NormalizedApolloContact): number {
  let count = 0;
  if (contact.email?.trim()) count += 1;
  if (contact.linkedinUrl?.trim()) count += 1;
  if (contact.phone?.trim()) count += 1;
  if (contact.title?.trim()) count += 1;
  if (nameTokens(contact.fullName).length >= 2) count += 1;
  return count;
}

const RELEVANCE_RANK: Record<ContactRelevanceStatus, number> = {
  high_relevance: 0,
  medium_relevance: 1,
  low_relevance: 2,
  not_relevant: 3,
  insufficient_data: 4,
};

/**
 * Selecciona, entre los candidatos revisables, los mejores para completar.
 * Prioridad: high → medium → relevanceScore → qualityScore → más campos base.
 * Devuelve a lo sumo `max` candidatos (control de costo).
 */
export function selectCandidatesForCompletion(
  classified: ClassifiedCandidate[],
  max: number = MAX_COMPLETION_CANDIDATES,
): ClassifiedCandidate[] {
  const eligible = classified.filter((c) => c.relevance.shouldInsertForReview);
  const sorted = [...eligible].sort((a, b) => {
    const byStatus =
      RELEVANCE_RANK[a.relevance.relevanceStatus] - RELEVANCE_RANK[b.relevance.relevanceStatus];
    if (byStatus !== 0) return byStatus;
    if (b.relevance.relevanceScore !== a.relevance.relevanceScore) {
      return b.relevance.relevanceScore - a.relevance.relevanceScore;
    }
    if (b.relevance.qualityScore !== a.relevance.qualityScore) {
      return b.relevance.qualityScore - a.relevance.qualityScore;
    }
    return baseFieldsCount(b.contact) - baseFieldsCount(a.contact);
  });
  return sorted.slice(0, Math.max(0, max));
}
