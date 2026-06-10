/**
 * Context Assembler — Elegibilidad Determinística (Hotfix 16AB.24.8)
 *
 * Calcula la elegibilidad final de un candidato aplicando reglas de precedencia
 * fijas. Nunca mejora audit_status, confidence ni evidencia — solo aplica el
 * workflow oficial sobre los valores ya saneados.
 *
 * No llama APIs externas. Sin `any`.
 */

import type {
  AuditabilityStatus,
  EligibilityStatus,
  DuplicateResolutionDetail,
  DeterministicEligibilityResult,
  FinalEligibilitySource,
  Confidence,
  VerificationStatus,
  GlobalDuplicateResolutionStatus,
} from './types';

// ─── Constantes internas ───────────────────────────────────────────────────────

const CONFIRMED_DUPLICATE_STATUSES = new Set<GlobalDuplicateResolutionStatus>([
  'confirmed_duplicate_sellup',
  'confirmed_duplicate_hubspot',
  'confirmed_duplicate_internal',
]);

const REJECTED_VERIFICATION_STATUSES = new Set<VerificationStatus>(['not_found']);

// ─── Parámetros de entrada ────────────────────────────────────────────────────

export type EligibilityGateParams = {
  auditabilityStatus: AuditabilityStatus;
  modelProposedEligibility: EligibilityStatus;
  duplicateResolution: DuplicateResolutionDetail;
  identityStatus: VerificationStatus;
  colombiaOperationStatus: VerificationStatus;
  technologyB2bStatus: VerificationStatus;
  confidence: Confidence;
  hasPrimaryEvidence: boolean;
};

// ─── Cómputo determinístico ───────────────────────────────────────────────────

export function computeFinalEligibility(
  params: EligibilityGateParams,
): DeterministicEligibilityResult {
  const reasoning: string[] = [];
  const source: FinalEligibilitySource = 'deterministic_gates';

  // Precedencia 1: Duplicado confirmado → rejected
  if (CONFIRMED_DUPLICATE_STATUSES.has(params.duplicateResolution.globalStatus)) {
    reasoning.push(`Duplicado confirmado: ${params.duplicateResolution.globalStatus}`);
    return { finalEligibility: 'rejected', finalEligibilitySource: source, reasoning };
  }

  // Precedencia 2: Identidad, Colombia o tecnología B2B rechazadas → rejected
  if (REJECTED_VERIFICATION_STATUSES.has(params.identityStatus)) {
    reasoning.push(`Identidad no encontrada (status: ${params.identityStatus})`);
    return { finalEligibility: 'rejected', finalEligibilitySource: source, reasoning };
  }
  if (REJECTED_VERIFICATION_STATUSES.has(params.colombiaOperationStatus)) {
    reasoning.push(`Operación Colombia no encontrada (status: ${params.colombiaOperationStatus})`);
    return { finalEligibility: 'rejected', finalEligibilitySource: source, reasoning };
  }
  if (REJECTED_VERIFICATION_STATUSES.has(params.technologyB2bStatus)) {
    reasoning.push(`Tecnología B2B no confirmada (status: ${params.technologyB2bStatus})`);
    return { finalEligibility: 'rejected', finalEligibilitySource: source, reasoning };
  }

  // Precedencia 3: Confianza Baja o not_auditable → rejected
  if (params.confidence === 'Baja') {
    reasoning.push('Confianza Baja');
    return { finalEligibility: 'rejected', finalEligibilitySource: source, reasoning };
  }
  if (params.auditabilityStatus === 'not_auditable') {
    reasoning.push('Evidencia no auditable');
    return { finalEligibility: 'rejected', finalEligibilitySource: source, reasoning };
  }

  // Precedencia 4: Posible duplicado, HubSpot no consultado, o conflicto esencial → requires_review
  const hubspotNotChecked =
    params.duplicateResolution.sources.hubspot.status === 'not_checked';
  const hasPossibleOrUnresolvedDuplicate =
    params.duplicateResolution.globalStatus === 'possible_duplicate' ||
    params.duplicateResolution.globalStatus === 'unresolved_duplicate';

  if (hasPossibleOrUnresolvedDuplicate) {
    reasoning.push(`Duplicado sin resolver: ${params.duplicateResolution.globalStatus}`);
    return { finalEligibility: 'requires_review', finalEligibilitySource: source, reasoning };
  }
  if (hubspotNotChecked) {
    reasoning.push('HubSpot no consultado — duplicado no descartable');
    return { finalEligibility: 'requires_review', finalEligibilitySource: source, reasoning };
  }

  // Precedencia 5: partially_auditable con faltantes secundarios → eligible_partially_auditable
  if (params.auditabilityStatus === 'partially_auditable') {
    if (!params.hasPrimaryEvidence) {
      reasoning.push('Sin URL de evidencia principal (partially_auditable)');
      return { finalEligibility: 'requires_review', finalEligibilitySource: source, reasoning };
    }
    reasoning.push(
      'Parcialmente auditable, sin duplicado, con evidencia principal — eligible_partially_auditable',
    );
    return {
      finalEligibility: 'eligible_partially_auditable',
      finalEligibilitySource: source,
      reasoning,
    };
  }

  // Precedencia 6: auditable + todos los gates pasan → eligible_auditable
  if (!params.hasPrimaryEvidence) {
    reasoning.push('Sin URL de evidencia principal (auditable)');
    return { finalEligibility: 'requires_review', finalEligibilitySource: source, reasoning };
  }
  reasoning.push('Auditable, sin duplicado, evidencia completa — eligible_auditable');
  return { finalEligibility: 'eligible_auditable', finalEligibilitySource: source, reasoning };
}
