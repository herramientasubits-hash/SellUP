/**
 * approve-tax-identifier-core.ts — reglas puras de «aprobar identificador fiscal»
 * (AGENT1-AUDIT-WS1). Sin E/S: la ruta lee, decide aquí y escribe.
 *
 * Defectos que cierra:
 *   · cambiaba el identificador de un candidato en CUALQUIER estado (aprobado,
 *     convertido, descartado…): ahora sólo en `needs_review`;
 *   · asumía Colombia (`?? 'CO'`) cuando el candidato no tenía país: ahora no se
 *     inventa un país — sin país no se aprueba;
 *   · dejaba intacta la comprobación de duplicados guardada (SellUp/HubSpot),
 *     hecha con el identificador VIEJO: ahora queda marcada como desactualizada.
 */

import type { PersistedGlobalIdentityClaimOutcome } from '@/server/prospect-batches/global-identity-claims-store';

/** Único estado en el que una persona puede elegir el identificador fiscal. */
export const APPROVE_TAX_IDENTIFIER_ALLOWED_STATUS = 'needs_review';

export const DUPLICATE_CHECK_STALE_REASON = 'tax_identifier_changed';

/** País ISO-2 del candidato en mayúsculas, o `null` si no lo tiene (nunca se inventa). */
export function resolveCandidateCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function staleCopy(check: Record<string, unknown>, markedAt: string): Record<string, unknown> {
  return { ...check, stale: true, stale_reason: DUPLICATE_CHECK_STALE_REASON, stale_marked_at: markedAt };
}

/**
 * Devuelve una metadata NUEVA con las comprobaciones de duplicados guardadas
 * marcadas como desactualizadas. Cubre las dos formas que existen:
 * `metadata.duplicate_check` (escritor del asistente) y
 * `metadata.validation.{sellup,hubspot}_duplicate_check` (importación). Deja
 * además `metadata.duplicate_check_stale` con el antes y el después.
 */
export function markDuplicateChecksStale(
  metadata: Record<string, unknown>,
  input: { markedAt: string; previousTaxIdentifier: string | null; newTaxIdentifier: string },
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...metadata,
    duplicate_check_stale: {
      reason: DUPLICATE_CHECK_STALE_REASON,
      marked_at: input.markedAt,
      previous_tax_identifier: input.previousTaxIdentifier,
      new_tax_identifier: input.newTaxIdentifier,
    },
  };
  if (isRecord(metadata.duplicate_check)) {
    next.duplicate_check = staleCopy(metadata.duplicate_check, input.markedAt);
  }
  if (isRecord(metadata.validation)) {
    const validation = metadata.validation;
    next.validation = {
      ...validation,
      ...(isRecord(validation.sellup_duplicate_check)
        ? { sellup_duplicate_check: staleCopy(validation.sellup_duplicate_check, input.markedAt) }
        : {}),
      ...(isRecord(validation.hubspot_duplicate_check)
        ? { hubspot_duplicate_check: staleCopy(validation.hubspot_duplicate_check, input.markedAt) }
        : {}),
    };
  }
  return next;
}

export type TaxIdentifierClaimReport =
  | { status: 'claimed' }
  | { status: 'claimed_elsewhere' }
  | { status: 'degraded' }
  | { status: 'skipped'; reason: 'unchanged' | 'no_batch' | 'service_unavailable' };

/** Resume el reclamo de la identidad fiscal nueva para la respuesta de la ruta. */
export function summarizeTaxIdentifierClaim(
  candidateId: string,
  outcome: PersistedGlobalIdentityClaimOutcome,
): TaxIdentifierClaimReport {
  if (outcome.degraded) return { status: 'degraded' };
  return outcome.claimedElsewhere.some((conflict) => conflict.candidateId === candidateId)
    ? { status: 'claimed_elsewhere' }
    : { status: 'claimed' };
}
