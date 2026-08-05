/**
 * A1-APOLLO-LINKEDIN-EMPLOYEES-1 — contrato de completitud del candidato y
 * regla de conteo hacia el target.
 *
 * Puro: sin I/O, sin reloj, sin proveedor.
 *
 * Por qué existe:
 *   «Persistido» y «completo» no son lo mismo. La corrida del 5 de agosto
 *   persistió dos candidatos sin LinkedIn ni número de empleados y los contó
 *   igual que a un candidato completo. Un candidato incompleto puede persistirse
 *   —con `needs_review`— pero no puede inflar el target.
 *
 * Fail-closed: cualquier condición desconocida NO cuenta. Nada aquí adivina.
 */

import type { CompanyFieldMappingStatus } from './apollo-company-fields-mapping';

// ─── Entradas de la regla (§ 5 del addendum) ──────────────────────────────────

export type GateVerdict = 'pass' | 'fail' | 'unknown';
export type SubindustryMatchVerdict = 'confirmed' | 'not_confirmed' | 'unknown';

export type CandidateTargetEligibilityInput = {
  persistenceSuccess: boolean;
  subindustryMatch: SubindustryMatchVerdict;
  employeeCountStatus: CompanyFieldMappingStatus;
  linkedinStatus: CompanyFieldMappingStatus;
  /** Valor tal como se persiste en `prospect_candidates.duplicate_status`. */
  duplicateStatus: string | null;
  ownershipGate: GateVerdict;
  qualityGate: GateVerdict;
};

export type CandidateTargetEligibility = {
  countsTowardTarget: boolean;
  /** Condiciones que no se cumplieron, en el orden del contrato. */
  failedConditions: string[];
};

/** Único valor de duplicado que el contrato acepta. */
const REQUIRED_DUPLICATE_STATUS = 'no_match';

/**
 * Evalúa si un candidato cuenta hacia el target de la modalidad QA.
 *
 * La conjunción es exactamente la del contrato; ninguna condición se pondera ni
 * se compensa con otra.
 */
export function evaluateCandidateTargetEligibility(
  input: CandidateTargetEligibilityInput,
): CandidateTargetEligibility {
  const failedConditions: string[] = [];

  if (!input.persistenceSuccess) failedConditions.push('persistence_success');
  if (input.subindustryMatch !== 'confirmed') failedConditions.push('subindustry_match');
  if (input.employeeCountStatus !== 'confirmed') failedConditions.push('employee_count_status');
  if (input.linkedinStatus !== 'confirmed') failedConditions.push('linkedin_status');
  if (input.duplicateStatus !== REQUIRED_DUPLICATE_STATUS) failedConditions.push('duplicate_status');
  if (input.ownershipGate !== 'pass') failedConditions.push('ownership_gate');
  if (input.qualityGate !== 'pass') failedConditions.push('quality_gate');

  return { countsTowardTarget: failedConditions.length === 0, failedConditions };
}

/** Traduce el estado de evidencia sectorial de la modalidad al veredicto del contrato. */
export function toSubindustryMatchVerdict(
  sectorEvidenceState: string | null | undefined,
): SubindustryMatchVerdict {
  if (sectorEvidenceState === undefined || sectorEvidenceState === null) return 'unknown';
  return sectorEvidenceState === 'sector_evidence_confirmed' ? 'confirmed' : 'not_confirmed';
}

// ─── Contadores separados (§ 5 del addendum) ──────────────────────────────────

/**
 * Métricas que NO se mezclan: persistir no es completar, y completar no es
 * alcanzar el target.
 */
export type CandidateCompletenessCounters = {
  /** Candidatos escritos en `prospect_candidates`. */
  persisted_candidates: number;
  /** Persistidos que cumplen TODAS las condiciones del contrato. */
  complete_valid_candidates: number;
  /** Persistidos con al menos una condición incumplida. */
  incomplete_candidates: number;
  /** Lo único que puede compararse con el target de la modalidad. */
  target_count: number;
  /** Cuántas veces falló cada condición, para diagnóstico agregado. */
  failed_condition_counts: Record<string, number>;
};

export function buildCandidateCompletenessCounters(
  eligibilities: readonly CandidateTargetEligibility[],
): CandidateCompletenessCounters {
  const failedConditionCounts: Record<string, number> = {};
  let complete = 0;

  for (const eligibility of eligibilities) {
    if (eligibility.countsTowardTarget) {
      complete++;
      continue;
    }
    for (const condition of eligibility.failedConditions) {
      failedConditionCounts[condition] = (failedConditionCounts[condition] ?? 0) + 1;
    }
  }

  return {
    persisted_candidates: eligibilities.length,
    complete_valid_candidates: complete,
    incomplete_candidates: eligibilities.length - complete,
    target_count: complete,
    failed_condition_counts: failedConditionCounts,
  };
}

// ─── Revisión obligatoria del candidato incompleto ────────────────────────────

/** Marca de revisión que un candidato incompleto lleva siempre. */
export const INCOMPLETE_CANDIDATE_REVIEW_FLAG = 'incomplete_provider_company_fields';

/**
 * Estado con el que se persiste un candidato según su completitud.
 *
 * Un candidato incompleto NUNCA se persiste como `high_quality_new`: se degrada
 * a `needs_review`. Sigue persistiéndose —la información parcial es útil— pero
 * no puede pasar por completo.
 */
export function resolveCandidateStatusForCompleteness(
  baseStatus: string,
  eligibility: CandidateTargetEligibility,
): string {
  if (eligibility.countsTowardTarget) return baseStatus;
  return baseStatus === 'high_quality_new' ? 'needs_review' : baseStatus;
}
