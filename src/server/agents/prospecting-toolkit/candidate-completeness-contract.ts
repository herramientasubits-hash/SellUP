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
  /**
   * Persistidos con al menos una condición incumplida: existen para que alguien
   * los revise, y por eso NO pueden contarse como resultado exitoso.
   *
   * `review_only_candidates = persisted_candidates - complete_valid_candidates`,
   * por definición y no por acumulación: las dos cifras salen de la misma lista.
   */
  review_only_candidates: number;
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
    review_only_candidates: eligibilities.length - complete,
    target_count: complete,
    failed_condition_counts: failedConditionCounts,
  };
}

// ─── Revisión obligatoria del candidato incompleto ────────────────────────────

/** Marca de revisión que un candidato incompleto lleva siempre. */
export const INCOMPLETE_CANDIDATE_REVIEW_FLAG = 'incomplete_provider_company_fields';

/**
 * Clave del bloque canónico de métricas de objetivo en la metadata del lote.
 *
 * Es la única fuente que responde «cuántas cuentan hacia el objetivo». Vive en
 * su propia clave para que ningún consumidor tenga que deducirlo del total de
 * filas persistidas.
 */
export const CANDIDATE_TARGET_METRICS_METADATA_KEY = 'candidate_target_metrics' as const;

/** Estado de revisión con el que se persiste todo candidato incompleto o ambiguo. */
export const REVIEW_ONLY_CANDIDATE_STATUS = 'needs_review';

/**
 * Estados que YA dicen algo más específico que «revísalo» y por eso no se
 * sobrescriben: `duplicate` nombra la causa exacta, y degradarlo a
 * `needs_review` perdería información sin ganar ninguna.
 */
const MORE_SPECIFIC_THAN_REVIEW: readonly string[] = ['duplicate'];

/**
 * Estado con el que se persiste un candidato según su completitud.
 *
 * Contrato de integración (§ D): un candidato que NO cuenta hacia el objetivo se
 * persiste como `needs_review`. Sigue persistiéndose —la información parcial es
 * útil y el usuario puede revisarla— pero nunca queda con un estado que se lea
 * como «este ya está bien».
 */
export function resolveCandidateStatusForCompleteness(
  baseStatus: string,
  eligibility: CandidateTargetEligibility,
): string {
  if (eligibility.countsTowardTarget) return baseStatus;
  if (MORE_SPECIFIC_THAN_REVIEW.includes(baseStatus)) return baseStatus;
  return REVIEW_ONLY_CANDIDATE_STATUS;
}
