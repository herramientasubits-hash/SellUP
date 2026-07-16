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
  | 'concurrency_conflict';

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
  },
): Promise<OptimisticConversionResult> {
  const { candidateId, expectedStatus, updates } = params;
  const statusConditionApplied =
    typeof expectedStatus === 'string' && expectedStatus.length > 0;

  let query = supabase
    .from('prospect_candidates')
    .update(updates as never)
    .eq('id', candidateId);
  if (statusConditionApplied) {
    query = query.eq('status', expectedStatus as string);
  }

  const { data: updatedRows } = await query.select('id');

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
