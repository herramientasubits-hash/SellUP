/**
 * Agente 1 · «Competidores de una empresa» — «Verificar tamaño» de una competidora
 * pequeña con Apollo (Fase D de la auditoría del 21-10; puro).
 *
 * Claude estima el tamaño y a veces se equivoca hacia abajo. A demanda (1 crédito
 * de Apollo por empresa, decisión de la dueña 21-10) se confirma con el número de
 * empleados de Apollo: con 200 o más deja de ser «pequeña» y vuelve a revisión; con
 * menos sigue en «Competidoras pequeñas», ahora con el dato confirmado.
 */

import { CLAUDE_SIZE_BELOW_MIN_REASON } from './competitor-small-companies';

/** El mismo piso que el escritor y el rescate. */
export const COMPETITOR_SIZE_VERIFY_THRESHOLD = 200;

/** Nuevo motivo cuando Apollo contradijo a Claude: ya no cuenta como pequeña. */
export const CLAUDE_SIZE_OVERRIDDEN_REASON = 'claude_size_below_min_overridden';

export const COMPETITOR_SIZE_VERIFICATION_KEY = 'competitor_size_verification';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

export type SizeVerificationDecision = 'above' | 'below' | 'unknown';

export function decideVerifiedSize(employees: number | null | undefined): SizeVerificationDecision {
  if (typeof employees !== 'number' || !Number.isFinite(employees) || employees <= 0) return 'unknown';
  return employees >= COMPETITOR_SIZE_VERIFY_THRESHOLD ? 'above' : 'below';
}

export type CompetitorSizeVerification = {
  employees: number | null;
  decision: SizeVerificationDecision;
  source: 'apollo';
  verified_at: string;
};

/** Lo que ya se verificó (no se vuelve a pagar). `null` ⇒ nunca. */
export function readCompetitorSizeVerification(metadata: unknown): CompetitorSizeVerification | null {
  const raw = asRecord(asRecord(metadata)?.[COMPETITOR_SIZE_VERIFICATION_KEY]);
  if (!raw || (raw.decision !== 'above' && raw.decision !== 'below' && raw.decision !== 'unknown')) return null;
  return {
    employees: typeof raw.employees === 'number' ? raw.employees : null,
    decision: raw.decision,
    source: 'apollo',
    verified_at: typeof raw.verified_at === 'string' ? raw.verified_at : '',
  };
}

/**
 * La metadata nueva (copia, sin tocar la original). Con «above» el motivo de
 * descarte del rescate pasa a `claude_size_below_min_overridden` y el piso queda
 * confirmado por Apollo: así deja de ser «pequeña» y puede volver a revisión.
 */
export function buildSizeVerificationMetadata(
  metadata: unknown,
  employees: number | null,
  nowIso: string,
): { metadata: UnknownRecord; decision: SizeVerificationDecision } {
  const base = { ...(asRecord(metadata) ?? {}) };
  const decision = decideVerifiedSize(employees);
  const verification: CompetitorSizeVerification = { employees, decision, source: 'apollo', verified_at: nowIso };
  const next: UnknownRecord = { ...base, [COMPETITOR_SIZE_VERIFICATION_KEY]: verification };
  if (decision === 'above') {
    const rescue = asRecord(base.claude_rescue);
    if (rescue?.discard_reason === CLAUDE_SIZE_BELOW_MIN_REASON) {
      next.claude_rescue = { ...rescue, discard_reason: CLAUDE_SIZE_OVERRIDDEN_REASON, overridden_by: 'apollo_size_verification' };
    }
    next.icp_size_gate = {
      ...(asRecord(base.icp_size_gate) ?? {}),
      decision: 'pass',
      size_status: 'confirmed_above_threshold',
      threshold: COMPETITOR_SIZE_VERIFY_THRESHOLD,
      normalized_min_employees: employees,
      source: 'apollo_size_verification',
    };
  }
  return { metadata: next, decision };
}

export function describeSizeVerification(decision: SizeVerificationDecision, employees: number | null): string {
  if (decision === 'above') return `Apollo confirma ${employees} empleados: volvió a revisión.`;
  if (decision === 'below') return `Apollo confirma ${employees} empleados: sigue como competidora pequeña.`;
  return 'Apollo no tiene el número de empleados de esta empresa.';
}
