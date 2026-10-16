/**
 * Agent 1 v1.16K-O — Idempotent approval helpers.
 *
 * Pure, read-only helpers used by approveAndConvertCandidateAction to:
 *   1. Re-derive an existing account before inserting a new one (FIX 1).
 *   2. Sanitize HubSpot errors before persisting them in metadata (FIX 2).
 *
 * No Supabase singleton, no HubSpot call, no Tavily/LLM/LinkedIn here — only
 * logic that operates on an injected client / value, so it is unit-testable
 * without any real DB or external service.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeDomain, extractDomainFromWebsite } from '@/server/agents/prospecting-toolkit/normalization';

export type ExistingAccountMatchBy = 'tax_identifier' | 'domain';

export interface ExistingAccountMatch {
  accountId: string;
  matchedBy: ExistingAccountMatchBy;
  accountName: string | null;
}

export interface CandidateAccountKeys {
  tax_identifier?: string | null;
  country_code?: string | null;
  domain?: string | null;
  website?: string | null;
}

/**
 * 16K-O FIX 1 — Re-deriva una cuenta existente para un candidato antes de
 * insertar una nueva. Busca primero por tax_identifier + country_code (ambos
 * requeridos) y, como fallback, por dominio normalizado.
 *
 * Es read-only: nunca crea ni modifica cuentas. Devuelve null si no hay match.
 * Evita crear cuentas duplicadas cuando matched_account_id está en null pero la
 * empresa ya existe en `accounts` (caso SITECO-like).
 */
export async function findExistingAccountForCandidate(
  supabase: Pick<SupabaseClient, 'from'>,
  candidate: CandidateAccountKeys,
): Promise<ExistingAccountMatch | null> {
  const ACC_SELECT = 'id, name';

  // 1. tax_identifier + country_code — ambos deben existir
  const taxId = candidate.tax_identifier?.trim() ?? '';
  const countryCode = candidate.country_code?.trim() ?? '';
  if (taxId.length >= 4 && countryCode.length > 0) {
    const { data } = await supabase
      .from('accounts')
      .select(ACC_SELECT)
      .eq('tax_identifier', taxId)
      .eq('country_code', countryCode)
      .is('archived_at', null)
      .limit(1);
    if (Array.isArray(data) && data.length > 0) {
      const row = data[0] as { id: string; name?: string | null };
      return { accountId: row.id, matchedBy: 'tax_identifier', accountName: row.name ?? null };
    }
  }

  // 2. fallback — dominio normalizado (candidate.domain o derivado del website)
  const normalizedDomain =
    normalizeDomain(candidate.domain ?? '') ?? extractDomainFromWebsite(candidate.website);
  if (normalizedDomain) {
    const { data } = await supabase
      .from('accounts')
      .select(ACC_SELECT)
      .eq('domain', normalizedDomain)
      .is('archived_at', null)
      .limit(1);
    if (Array.isArray(data) && data.length > 0) {
      const row = data[0] as { id: string; name?: string | null };
      return { accountId: row.id, matchedBy: 'domain', accountName: row.name ?? null };
    }
  }

  return null;
}

/**
 * 16K-O FIX 2 — Sanitiza un error de HubSpot para guardarlo en metadata sin
 * exponer secrets (tokens Bearer, private app tokens, headers de autorización,
 * api keys). El resultado se acota a 200 caracteres.
 */
export function sanitizeHubSpotErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Error desconocido al crear en HubSpot';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/pat-[A-Za-z0-9-]+/gi, '[REDACTED_TOKEN]')
    .replace(/(authorization["':\s]*)[^\s,"']+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key["':=\s]*)[^\s,"']+/gi, '$1[REDACTED]')
    .slice(0, 200);
}

// ─────────────────────────────────────────────────────────────────────────────
// Q3F-5AW.2 (Phase 1) — Idempotencia + update condicional optimista
// ─────────────────────────────────────────────────────────────────────────────
//
// Estos helpers reducen el riesgo de doble conversión del mismo candidate.id:
//   1. isCandidateAlreadyConverted — corta la aprobación temprano cuando el
//      candidato ya fue convertido (status + converted_account_id presentes).
//   2. applyOptimisticCandidateConversionUpdate — hace el UPDATE final condicionado
//      al status esperado (.eq('status', expectedStatus)); si afecta 0 filas,
//      relee y resuelve idempotentemente o reporta conflicto de concurrencia.
//
// Todo es read/write pero con cliente INYECTADO, así que es unit-testable sin
// Supabase real ni servicios externos. No construye el CandidateApprovalResult
// (eso vive en actions.ts) para no crear un ciclo de imports.

/** Estado del status del schema DB que marca conversión completada. */
export const CONVERTED_TO_ACCOUNT_STATUS = 'converted_to_account';

export interface ApprovalCandidateState {
  status?: string | null;
  converted_account_id?: string | null;
}

/**
 * true si el candidato ya está convertido a cuenta (status === converted_to_account
 * y converted_account_id no vacío). Es la condición de corte idempotente: cuando es
 * true no se debe crear una segunda cuenta ni llamar a HubSpot.
 */
export function isCandidateAlreadyConverted(
  candidate: ApprovalCandidateState | null | undefined,
): boolean {
  if (!candidate) return false;
  const accId = candidate.converted_account_id;
  return (
    candidate.status === CONVERTED_TO_ACCOUNT_STATUS &&
    typeof accId === 'string' &&
    accId.trim().length > 0
  );
}

export type OptimisticConversionOutcome =
  | 'updated'
  | 'idempotent_success'
  | 'concurrency_conflict'
  // AGENT1-AUDIT-WS4 — la base respondió con error: NO es «0 filas». Antes el
  // `error` del UPDATE se descartaba y un fallo de la base se leía como carrera.
  | 'update_failed';

export interface OptimisticConversionResult {
  outcome: OptimisticConversionOutcome;
  /** Cuenta ya asociada cuando outcome === 'idempotent_success'. */
  accountId: string | null;
  /** true si el UPDATE aplicó la condición optimista sobre status. */
  statusConditionApplied: boolean;
}

/**
 * Aplica el UPDATE final del candidato condicionado al status esperado.
 *
 * - Si afecta ≥1 fila → outcome 'updated' (esta operación ganó la carrera).
 * - Si afecta 0 filas → relee el candidato:
 *     * ya convertido           → 'idempotent_success' (no crear segunda cuenta).
 *     * cualquier otro estado   → 'concurrency_conflict' (error controlado).
 *
 * El cliente se inyecta; no abre secretos ni llama proveedores.
 */
export async function applyOptimisticCandidateConversionUpdate(
  supabase: Pick<SupabaseClient, 'from'>,
  params: {
    candidateId: string;
    expectedStatus?: string | null;
    updates: Record<string, unknown>;
    /**
     * AGENT1-AUDIT-WS4 — token del candado de aprobación. Con él, sólo quien
     * tiene el candado puede convertir (si otro lo tomó por vencido, 0 filas).
     */
    lockToken?: string | null;
  },
): Promise<OptimisticConversionResult> {
  const { candidateId, expectedStatus, updates, lockToken } = params;
  const statusConditionApplied =
    typeof expectedStatus === 'string' && expectedStatus.length > 0;

  let query = supabase
    .from('prospect_candidates')
    .update(updates as never)
    .eq('id', candidateId);
  if (statusConditionApplied) {
    query = query.eq('status', expectedStatus as string);
  }
  if (typeof lockToken === 'string' && lockToken.length > 0) {
    query = query.eq(APPROVAL_LOCK_TOKEN_FILTER, lockToken);
  }

  const { data: updatedRows, error: updateError } = await query.select('id');

  if (updateError) {
    console.error('[approval-idempotency] el UPDATE final del candidato falló:', {
      candidateId,
      code: (updateError as { code?: string }).code ?? null,
      message: (updateError as { message?: string }).message ?? null,
    });
    return { outcome: 'update_failed', accountId: null, statusConditionApplied };
  }

  if (Array.isArray(updatedRows) && updatedRows.length > 0) {
    return { outcome: 'updated', accountId: null, statusConditionApplied };
  }

  // 0 filas actualizadas: otra operación cambió el status. Releer y resolver.
  const { data: reread } = await supabase
    .from('prospect_candidates')
    .select('status, converted_account_id')
    .eq('id', candidateId)
    .single();

  const state = (reread ?? null) as ApprovalCandidateState | null;
  if (isCandidateAlreadyConverted(state)) {
    return {
      outcome: 'idempotent_success',
      accountId: (state as ApprovalCandidateState).converted_account_id as string,
      statusConditionApplied,
    };
  }

  return { outcome: 'concurrency_conflict', accountId: null, statusConditionApplied };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT1-AUDIT-WS4 — Candado de aprobación (antes de cualquier efecto externo)
// ─────────────────────────────────────────────────────────────────────────────
//
// El corte idempotente del principio y el UPDATE condicional del final no
// bastaban: dos aprobaciones simultáneas pasaban las dos el corte, creaban DOS
// cuentas en SellUp y DOS empresas en HubSpot, y la perdedora respondía «éxito
// idempotente». Ahora la aprobación TOMA el candidato primero, con un UPDATE
// atómico condicionado (status + ausencia de candado vigente), y sólo después
// crea cuenta o llama a HubSpot. El candado vive en `metadata.approval_lock`
// (sin migración: no exige nada que no esté en Producción). Un candado más viejo
// que `APPROVAL_LOCK_TTL_MS` se puede tomar (proceso muerto), comparando su token.

export const APPROVAL_LOCK_METADATA_KEY = 'approval_lock';
/** Filtro PostgREST sobre el token del candado (texto). */
export const APPROVAL_LOCK_TOKEN_FILTER = 'metadata->approval_lock->>token';
/** Filtro PostgREST «no hay candado» (`->>` da NULL si falta o es JSON null). */
export const APPROVAL_LOCK_ABSENT_FILTER = 'metadata->>approval_lock';
/** Más viejo que esto ⇒ la aprobación que lo tomó murió: se puede retomar. */
export const APPROVAL_LOCK_TTL_MS = 5 * 60 * 1000;
export const APPROVAL_ORPHANS_METADATA_KEY = 'approval_orphans';

export interface ApprovalLock {
  token: string;
  locked_at: string;
  locked_by: string | null;
}

/** El candado guardado en la metadata del candidato, o null si no hay uno válido. */
export function readApprovalLock(metadata: Record<string, unknown> | null | undefined): ApprovalLock | null {
  const raw = metadata?.[APPROVAL_LOCK_METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const lock = raw as Record<string, unknown>;
  if (typeof lock.token !== 'string' || lock.token.length === 0) return null;
  return {
    token: lock.token,
    locked_at: typeof lock.locked_at === 'string' ? lock.locked_at : '',
    locked_by: typeof lock.locked_by === 'string' ? lock.locked_by : null,
  };
}

/** ¿El candado sigue vigente? Una fecha ilegible cuenta como vencida. */
export function isApprovalLockFresh(lock: ApprovalLock | null, nowMs: number): boolean {
  if (!lock) return false;
  const lockedAt = Date.parse(lock.locked_at);
  if (!Number.isFinite(lockedAt)) return false;
  return nowMs - lockedAt < APPROVAL_LOCK_TTL_MS;
}

/** Copia de la metadata SIN el candado (lo que se escribe al terminar). */
export function stripApprovalLock(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const next = { ...(metadata ?? {}) };
  delete next[APPROVAL_LOCK_METADATA_KEY];
  return next;
}

export type ApprovalLockClaim =
  | { outcome: 'claimed'; metadata: Record<string, unknown> }
  /** Otra aprobación tiene el candado vigente, o ganó la carrera por tomarlo. */
  | { outcome: 'busy' }
  /** La base respondió con error: no se sabe si se tomó; no seguir. */
  | { outcome: 'error' };

/**
 * Toma el candado de aprobación del candidato. Atómico en la base: el UPDATE
 * sólo afecta la fila si el status sigue siendo `expectedStatus` y no hay
 * candado (o el vencido que leímos sigue ahí, comparando su token).
 */
export async function claimCandidateApprovalLock(
  supabase: Pick<SupabaseClient, 'from'>,
  params: {
    candidateId: string;
    expectedStatus: string;
    /** Metadata leída al cargar el candidato. */
    metadata: Record<string, unknown> | null | undefined;
    token: string;
    actorUserId: string;
    nowIso: string;
  },
): Promise<ApprovalLockClaim> {
  const current = readApprovalLock(params.metadata);
  if (isApprovalLockFresh(current, Date.parse(params.nowIso))) return { outcome: 'busy' };

  const nextMetadata: Record<string, unknown> = {
    ...stripApprovalLock(params.metadata),
    [APPROVAL_LOCK_METADATA_KEY]: {
      token: params.token,
      locked_at: params.nowIso,
      locked_by: params.actorUserId,
    },
  };

  let query = supabase
    .from('prospect_candidates')
    .update({ metadata: nextMetadata } as never)
    .eq('id', params.candidateId)
    .eq('status', params.expectedStatus);
  query = current
    ? query.eq(APPROVAL_LOCK_TOKEN_FILTER, current.token)
    : query.is(APPROVAL_LOCK_ABSENT_FILTER, null);

  const { data, error } = await query.select('id');
  if (error) {
    console.error('[approval-idempotency] no se pudo tomar el candado de aprobación:', {
      candidateId: params.candidateId,
      code: (error as { code?: string }).code ?? null,
      message: (error as { message?: string }).message ?? null,
    });
    return { outcome: 'error' };
  }
  if (Array.isArray(data) && data.length > 0) return { outcome: 'claimed', metadata: nextMetadata };
  return { outcome: 'busy' };
}

/** Lo que se creó y quedó sin candidato que lo apunte (para revisión humana). */
export interface ApprovalOrphanRecord {
  recorded_at: string;
  reason: string;
  account_id: string | null;
  account_created: boolean;
  hubspot_company_id: string | null;
  hubspot_company_created: boolean;
}

/** Se registra huérfano sólo si esta aprobación CREÓ algo. */
export function buildApprovalOrphanRecord(input: {
  nowIso: string;
  reason: string;
  accountId: string | null;
  accountCreated: boolean;
  hubspotCompanyId: string | null;
  hubspotCompanyCreated: boolean;
}): ApprovalOrphanRecord | null {
  if (!input.accountCreated && !input.hubspotCompanyCreated) return null;
  return {
    recorded_at: input.nowIso,
    reason: input.reason,
    account_id: input.accountCreated ? input.accountId : null,
    account_created: input.accountCreated,
    hubspot_company_id: input.hubspotCompanyCreated ? input.hubspotCompanyId : null,
    hubspot_company_created: input.hubspotCompanyCreated,
  };
}

/**
 * Suelta el candado (sólo si sigue siendo nuestro) y, si hay, anota lo creado
 * que quedó huérfano en `metadata.approval_orphans`. Relee la metadata fresca
 * para no pisar lo que otro escribió. Nunca lanza: devuelve si pudo escribir.
 */
export async function releaseCandidateApprovalLock(
  supabase: Pick<SupabaseClient, 'from'>,
  params: { candidateId: string; token: string; orphan?: ApprovalOrphanRecord | null },
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('prospect_candidates')
      .select('metadata')
      .eq('id', params.candidateId)
      .maybeSingle();
    if (error || !data) {
      console.error('[approval-idempotency] no se pudo releer el candidato para soltar el candado:', {
        candidateId: params.candidateId,
        message: (error as { message?: string } | null)?.message ?? 'sin fila',
      });
      return false;
    }
    const metadata = ((data as { metadata?: unknown }).metadata ?? {}) as Record<string, unknown>;
    const ownsLock = readApprovalLock(metadata)?.token === params.token;
    if (!ownsLock && !params.orphan) return true;

    const next = ownsLock ? stripApprovalLock(metadata) : { ...metadata };
    if (params.orphan) {
      const previous = Array.isArray(metadata[APPROVAL_ORPHANS_METADATA_KEY])
        ? (metadata[APPROVAL_ORPHANS_METADATA_KEY] as unknown[])
        : [];
      next[APPROVAL_ORPHANS_METADATA_KEY] = [...previous, params.orphan];
    }
    const { error: updateError } = await supabase
      .from('prospect_candidates')
      .update({ metadata: next } as never)
      .eq('id', params.candidateId);
    if (updateError) {
      console.error('[approval-idempotency] no se pudo soltar el candado / anotar huérfanos:', {
        candidateId: params.candidateId,
        message: (updateError as { message?: string }).message ?? null,
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error('[approval-idempotency] error inesperado soltando el candado:', err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT1-AUDIT-WS4 — Qué ficha de HubSpot se enlaza al aprobar
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalHubSpotLinkSource = 'sellup_account' | 'free_pool' | 'candidate_match';

/**
 * La cuenta de SellUp YA enlazada a HubSpot manda: si la cuenta existente tiene
 * `hubspot_company_id`, se enlaza a esa ficha (nunca se crea otra ni se pisa).
 * Si no, la ficha libre marcada y, por último, la coincidencia guardada.
 */
export function resolveApprovalHubSpotLinkTarget(input: {
  existingAccountHubSpotCompanyId: string | null | undefined;
  freePoolLinkCompanyId: string | null | undefined;
  matchedCompanyId: string | null | undefined;
}): { companyId: string | null; source: ApprovalHubSpotLinkSource | null } {
  const clean = (value: string | null | undefined) =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  const fromAccount = clean(input.existingAccountHubSpotCompanyId);
  if (fromAccount) return { companyId: fromAccount, source: 'sellup_account' };
  const fromPool = clean(input.freePoolLinkCompanyId);
  if (fromPool) return { companyId: fromPool, source: 'free_pool' };
  const fromMatch = clean(input.matchedCompanyId);
  if (fromMatch) return { companyId: fromMatch, source: 'candidate_match' };
  return { companyId: null, source: null };
}

/**
 * ¿La aprobación enlazó una cuenta de SellUp que ya era de OTRA persona? Antes
 * era silencioso; ahora va en la respuesta y en la auditoría.
 */
export function resolveExistingAccountOwnerConflict(input: {
  accountCreated: boolean;
  existingOwnerId: string | null | undefined;
  searcherUserId: string;
}): { linkedToOtherOwner: boolean; existingOwnerId: string | null } {
  const owner = typeof input.existingOwnerId === 'string' && input.existingOwnerId ? input.existingOwnerId : null;
  return {
    linkedToOtherOwner: !input.accountCreated && owner !== null && owner !== input.searcherUserId,
    existingOwnerId: owner,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT1-AUDIT-WS4 — Comprobaciones de duplicados desactualizadas
// ─────────────────────────────────────────────────────────────────────────────
//
// Cuando se corrige el NIT del candidato, `approve-tax-identifier` marca
// `metadata.duplicate_check_stale = true`: lo guardado (coincidencia en SellUp,
// coincidencia/posible coincidencia en HubSpot, ficha libre marcada) se calculó
// con el NIT viejo. La aprobación entonces NO se fía de nada de eso: la cuenta
// de SellUp se re-deriva en vivo (NIT + país o dominio) y en HubSpot decide la
// búsqueda en vivo (ficha libre, si la bandera está encendida, y la guarda
// previa a crear).

export const DUPLICATE_CHECK_STALE_METADATA_KEY = 'duplicate_check_stale';

/** ¿El candidato trae las comprobaciones de duplicados marcadas como desactualizadas? */
export function isDuplicateCheckStale(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.[DUPLICATE_CHECK_STALE_METADATA_KEY] === true;
}

/**
 * Copia de la metadata SIN la evidencia de duplicados guardada (lo que no se
 * puede usar cuando está desactualizada): ficha libre marcada y los chequeos
 * guardados de SellUp y HubSpot.
 */
export function withoutStaleDuplicateEvidence(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(metadata ?? {}) };
  delete next.hubspot_free_pool;
  delete next.duplicate_check;
  const validation = next.validation;
  if (validation && typeof validation === 'object') {
    const cleanValidation = { ...(validation as Record<string, unknown>) };
    delete cleanValidation.hubspot_duplicate_check;
    delete cleanValidation.sellup_duplicate_check;
    next.validation = cleanValidation;
  }
  return next;
}
