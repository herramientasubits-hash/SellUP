// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — pure mapping helpers. No IO, no clock.

import type { DiscardDispositionCode } from './types';

/**
 * Maps the Apollo two-round pure taxonomy (`ApolloCandidateFinalDisposition`
 * from `candidate-final-disposition.ts`) to the durable disposition code this
 * module persists. Deliberately typed as `string` (not imported from the
 * orchestrator) so this module has zero import dependency on the Apollo
 * pipeline — it only needs to agree on the string values.
 *
 * `null` means "not a terminal rejection" (e.g. the candidate was actually
 * persisted, or is pending review) — the caller must not persist a row for it.
 */
export function mapApolloFinalDispositionToCode(
  finalDisposition: string,
): DiscardDispositionCode | null {
  switch (finalDisposition) {
    case 'country_rejected_final':
      return 'country_rejected';
    case 'sector_subindustry_rejected_final':
      return 'sector_rejected';
    case 'ownership_rejected_final':
      return 'ownership_domain_rejected';
    case 'hubspot_duplicate_final':
      return 'hubspot_duplicate';
    case 'sellup_duplicate_final':
      return 'sellup_duplicate';
    case 'cooldown_final':
      return 'cooldown_active';
    case 'enrichment_budget_exhausted_final':
      return 'enrichment_budget_exhausted';
    case 'not_selected_for_enrichment_final':
      return 'not_selected_for_enrichment';
    case 'target_cap_final':
      return 'target_cap_reached';
    case 'insufficient_evidence_not_enriched_final':
    case 'unclassified_final':
      // Safety-net dispositions the pure taxonomy documents as "should not
      // happen in practice" — still real candidates the pipeline left out of
      // evaluation, so they get a row, bucketed as 'other' rather than lost.
      return 'other';
    // 'provisionally_persisted_pending_writer_final' and
    // 'persisted_review_only_final' are NOT rejections — the candidate either
    // goes to the writer or is already a needs_review row. No disposition row.
    default:
      return null;
  }
}

/**
 * `prospect_discarded_dispositions.source_primary` allows `'tavily'` (not a
 * valid `prospect_candidates.source_primary` value — that CHECK constraint,
 * widened by migrations 048/051/052, has no `'tavily'` entry). When "Enviar a
 * revisión" creates a new `prospect_candidates` row from a disposition, the
 * value must be mapped into that narrower, existing vocabulary instead of
 * violating the constraint.
 */
export function toCandidateSourcePrimary(
  dispositionSourcePrimary: string | null,
): string | null {
  if (dispositionSourcePrimary === 'tavily') return 'other';
  return dispositionSourcePrimary;
}

function normalizeForKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Idempotency key material within a batch: normalized domain > provider
 * identifier > normalized canonical name, in that order of preference — the
 * same preference order `NormalizedOrganizationIdentity` already encodes.
 * Matches the DB's `UNIQUE (batch_id, source_key)` constraint.
 */
export function computeDiscardDispositionSourceKey(input: {
  domain?: string | null;
  providerIdentifier?: string | null;
  name: string;
}): string {
  const domain = input.domain?.trim().toLowerCase();
  if (domain) return `domain:${domain}`;

  const providerId = input.providerIdentifier?.trim();
  if (providerId) return `provider:${providerId}`;

  return `name:${normalizeForKey(input.name)}`;
}

// ─── X3 · evidencia del gate de ownership ─────────────────────────────────────

/**
 * 🔴 AGENT1-OWNERSHIP-OBSERVABILITY-X3 — el veredicto del gate, tal como lo
 * produjo `evaluateCompanyOwnership`, reducido a lo que hace falta persistir.
 *
 * Estructural a propósito, igual que el resto de este módulo: acepta la forma de
 * `ApolloPreWriterOwnershipEvaluation` sin importar nada del pipeline de Apollo.
 * Aquí no se evalúa ownership, no se deriva `allowed` de la confianza y no se
 * normaliza ningún nombre: sólo se cambia de caja para que quepa en `evidence`.
 */
export interface OwnershipGateVerdictLike {
  allowed: boolean;
  confidence: string;
  reason: string;
  matchedSignals: readonly string[];
  missingSignals: readonly string[];
  evaluationName: string;
  recoveredFromDomain: boolean;
  effectiveDomain: string | null;
}

/**
 * Cómo se obtuvo —o por qué no existe— el veredicto de ownership de una fila.
 *
 * `not_evaluated` NO es un rechazo implícito ni un pase: es el hecho de que el
 * gate nunca corrió sobre esa empresa. Le pasa a toda candidata que murió antes,
 * en el gate BARATO de elegibilidad — los ocho `invalid_domain` de la
 * certificación son exactamente eso: Apollo no devolvió dominio, así que no
 * había nada que comparar y `evaluateCompanyOwnership` jamás se invocó.
 *
 * Distinguirlo de `null` importa: sin este campo, una fila sin `ownership_gate`
 * no deja saber si el gate absolvió, si rechazó, o si ni siquiera miró.
 */
export type OwnershipGateEvidenceSource = 'pre_writer_final_gate' | 'not_evaluated';

export interface OwnershipGateEvidence {
  allowed: boolean;
  confidence: string;
  reason: string;
  matched_signals: string[];
  missing_signals: string[];
  evaluation_name: string;
  recovered_from_domain: boolean;
  effective_domain: string | null;
}

/**
 * Proyecta el veredicto a `evidence.ownership_gate`. `null` ⇒ el gate no corrió.
 *
 * Copia, nunca recalcula: cada campo sale del veredicto que ya existía. Si el
 * llamador no tiene veredicto, la respuesta es `null` — jamás un veredicto
 * fabricado a partir del motivo del descarte.
 */
export function toOwnershipGateEvidence(
  verdict: OwnershipGateVerdictLike | null | undefined,
): OwnershipGateEvidence | null {
  if (!verdict) return null;
  return {
    allowed: verdict.allowed,
    confidence: verdict.confidence,
    reason: verdict.reason,
    matched_signals: [...verdict.matchedSignals],
    missing_signals: [...verdict.missingSignals],
    evaluation_name: verdict.evaluationName,
    recovered_from_domain: verdict.recoveredFromDomain,
    effective_domain: verdict.effectiveDomain,
  };
}

/** La etiqueta que acompaña a `ownership_gate`, presente o ausente. */
export function resolveOwnershipGateEvidenceSource(
  verdict: OwnershipGateVerdictLike | null | undefined,
): OwnershipGateEvidenceSource {
  return verdict ? 'pre_writer_final_gate' : 'not_evaluated';
}
