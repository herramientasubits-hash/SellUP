/**
 * Evidence Persistence Policy — Hito v1.5
 *
 * Política source-first/evidence-first: decide si un candidato debe persistirse,
 * con qué confidence cap y qué warnings, a partir de:
 *   - country_evidence: strong / query_only / weak
 *   - business_fit:    high / medium / low / reject
 *
 * El source URL gate y el business-fit gate ya habrán bloqueado los candidatos
 * claramente inválidos antes de que llegue aquí. Esta política es la última
 * capa antes de escribir en la base de datos.
 *
 * Sin IA. Sin llamadas externas. Determinístico.
 */

import type { BusinessFitResult } from './business-fit-gate';
import type { CountryEvidenceResult } from './country-evidence-gate';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type EvidencePersistenceDecision = 'blocked' | 'needs_review' | 'ok';

export type EvidencePersistencePolicyResult = {
  /** Decisión final de persistencia. */
  decision: EvidencePersistenceDecision;
  /**
   * Cap máximo de confidence_score (0-100). null = sin modificación.
   * Se aplica antes de escribir para que la UI muestre confianza real,
   * no la inflada por país inferido de la query.
   */
  confidenceCap: number | null;
  /** Warnings a incluir en metadata.evidence_policy del candidato. */
  warnings: string[];
  /** Código de razón primaria (para metadata y trazabilidad). */
  primaryReason: string;
  /**
   * True cuando recommended_action debe forzarse a 'review_manually'.
   * Sobreescribe el valor del scorer si viene inflado.
   */
  forceReviewManually: boolean;
};

export type EvidencePersistencePolicyInput = {
  countryEvidence: CountryEvidenceResult;
  businessFit: BusinessFitResult;
};

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Computa la política de persistencia evidence-first.
 *
 * Orden de evaluación (primero gana):
 *
 * R1: country_evidence = query_only
 *     → needs_review, confidence capped at 45, forceReviewManually
 *     Razón: el país solo aparece en la query; el sitio no confirma presencia local.
 *     No se bloquea (puede ser empresa real) pero tampoco puede tener alta confianza.
 *
 * R2: country_evidence = weak + businessFit = medium/low
 *     → blocked
 *     Razón: sin evidencia de país y sin señal fuerte de fit, el riesgo es alto.
 *
 * R3: country_evidence = weak + businessFit = high
 *     → needs_review, confidence capped at 40, forceReviewManually
 *     Razón: empresa con buen fit pero sin confirmación geográfica — puede ser válida,
 *     requiere revisión humana con confianza reducida.
 *
 * R4: country_evidence = strong + businessFit = high
 *     → ok (mejor candidato; sin modificaciones)
 *
 * Default: needs_review sin cap (conservador)
 */
export function computeEvidencePersistencePolicy(
  input: EvidencePersistencePolicyInput,
): EvidencePersistencePolicyResult {
  const { countryEvidence, businessFit } = input;
  const warnings: string[] = [];

  if (countryEvidence.warning) {
    warnings.push(countryEvidence.warning);
  }

  // R1: Solo evidencia de país en la query
  if (countryEvidence.evidenceLevel === 'query_only') {
    warnings.push(
      'País no confirmado por evidencia del sitio — solo presente en la query de búsqueda. ' +
      'No se puede asignar confianza alta.',
    );
    return {
      decision: 'needs_review',
      confidenceCap: 45,
      warnings,
      primaryReason: 'country_evidence_query_only',
      forceReviewManually: true,
    };
  }

  // R2: Sin evidencia de país + fit no fuerte → bloquear
  if (
    countryEvidence.evidenceLevel === 'weak' &&
    (businessFit.fit === 'medium' || businessFit.fit === 'low')
  ) {
    warnings.push(
      'Sin evidencia de país en URL, dominio, snippet ni título. ' +
      'Sin señales fuertes de fit B2B tech. Candidato no persistible.',
    );
    return {
      decision: 'blocked',
      confidenceCap: null,
      warnings,
      primaryReason: 'no_country_evidence_with_weak_fit',
      forceReviewManually: false,
    };
  }

  // R3: Sin evidencia de país + fit alto → needs_review con cap reducido
  if (countryEvidence.evidenceLevel === 'weak') {
    warnings.push(
      'País sin evidencia directa en el sitio. ' +
      'Empresa con señales de fit B2B pero sin confirmación geográfica.',
    );
    return {
      decision: 'needs_review',
      confidenceCap: 40,
      warnings,
      primaryReason: 'no_country_evidence_high_fit',
      forceReviewManually: true,
    };
  }

  // R4: Evidencia fuerte + fit alto → candidato sólido
  if (countryEvidence.evidenceLevel === 'strong' && businessFit.fit === 'high') {
    return {
      decision: 'ok',
      confidenceCap: null,
      warnings,
      primaryReason: 'strong_evidence_high_fit',
      forceReviewManually: false,
    };
  }

  // Default: conservador
  return {
    decision: 'needs_review',
    confidenceCap: null,
    warnings,
    primaryReason: 'default_conservative',
    forceReviewManually: false,
  };
}
