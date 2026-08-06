/**
 * wizard-target-summary-copy.ts — resumen de la corrida con las cuatro cifras
 * separadas.
 *
 * AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 · § H.
 *
 * El defecto que cierra: el panel decía «Se generaron 5 candidatos» y el usuario
 * no tenía forma de saber que tres de esos cinco eran filas guardadas SÓLO para
 * revisión —sin subindustria demostrada, sin número de empleados— y que sólo dos
 * contaban hacia el objetivo de cinco. Un único número respondía a dos preguntas
 * distintas, y la respuesta favorecía siempre a la más halagüeña.
 *
 * Aquí las dos preguntas tienen su propia fila:
 *
 *   ¿cuántas empresas fueron guardadas para revisión?
 *   ¿cuántas empresas completas y válidas cuentan hacia el objetivo?
 *
 * Puro: sin I/O, sin React, sin env.
 */

// ─── Entrada ──────────────────────────────────────────────────────────────────

/**
 * Cifras canónicas de la corrida, tal como el writer las publicó.
 *
 * Todo es `number | null` porque una corrida anterior a este hito no las trae, y
 * `null` significa «no medido», nunca cero: un cero afirmaría que no hubo
 * ninguna, que es una afirmación distinta y más fuerte.
 */
export type WizardTargetSummaryInput = {
  persistedCandidates: number | null;
  completeValidCandidates: number | null;
  reviewOnlyCandidates: number | null;
  targetEligibleCompanies: number | null;
};

export type WizardTargetSummaryRowKey =
  | 'persisted_candidates'
  | 'complete_valid_candidates'
  | 'review_only_candidates'
  | 'target_reached';

export type WizardTargetSummaryRow = {
  key: WizardTargetSummaryRowKey;
  label: string;
  /** Texto ya formateado. Nunca una cifra cruda que el consumidor deba interpretar. */
  value: string;
  /** Aclaración de una línea. `null` cuando la etiqueta se basta. */
  hint: string | null;
};

export type WizardTargetSummary = {
  rows: WizardTargetSummaryRow[];
  /**
   * § H — afirmación explícita de que el resumen NO presenta las filas guardadas
   * como empresas válidas. La UI y los tests la leen en vez de comparar prosa.
   */
  claimsAllPersistedAreValid: false;
  /** `null` cuando no se pudo medir. Nunca `false` para un dato ausente. */
  targetReached: boolean | null;
};

// ─── Etiquetas ────────────────────────────────────────────────────────────────

export const PERSISTED_CANDIDATES_LABEL = 'Candidatos guardados';
export const COMPLETE_VALID_CANDIDATES_LABEL = 'Empresas completas y válidas';
export const REVIEW_ONLY_CANDIDATES_LABEL = 'Candidatos que requieren revisión';
export const TARGET_REACHED_LABEL = 'Objetivo alcanzado';

/** Lo que se muestra cuando una cifra no se midió. Nunca un cero. */
export const NOT_MEASURED_VALUE = 'Sin medir';

function formatCount(value: number | null): string {
  return value === null ? NOT_MEASURED_VALUE : String(value);
}

/**
 * Construye el resumen de la corrida.
 *
 * `targetReached` es fail-closed: sin empresas completas medidas o sin objetivo
 * conocido, no se afirma que se alcanzó. La ausencia de medición nunca se
 * convierte en un «sí».
 */
export function buildWizardTargetSummary(
  input: WizardTargetSummaryInput,
): WizardTargetSummary {
  const targetReached =
    input.completeValidCandidates === null ||
    input.targetEligibleCompanies === null ||
    input.targetEligibleCompanies <= 0
      ? null
      : input.completeValidCandidates >= input.targetEligibleCompanies;

  const targetValue =
    targetReached === null
      ? NOT_MEASURED_VALUE
      : targetReached
        ? 'Sí'
        : 'No';

  const targetHint =
    input.targetEligibleCompanies === null
      ? null
      : input.completeValidCandidates === null
        ? `El objetivo era ${input.targetEligibleCompanies}. No pudimos medir cuántas empresas quedaron completas.`
        : `${input.completeValidCandidates} de ${input.targetEligibleCompanies} empresas completas y válidas.`;

  return {
    rows: [
      {
        key: 'persisted_candidates',
        label: PERSISTED_CANDIDATES_LABEL,
        value: formatCount(input.persistedCandidates),
        hint: 'Filas creadas en el listado de prospectos, completas o no.',
      },
      {
        key: 'complete_valid_candidates',
        label: COMPLETE_VALID_CANDIDATES_LABEL,
        value: formatCount(input.completeValidCandidates),
        hint: 'Cumplen subindustria, LinkedIn, empleados, propiedad, calidad y duplicidad. Son las únicas que cuentan hacia el objetivo.',
      },
      {
        key: 'review_only_candidates',
        label: REVIEW_ONLY_CANDIDATES_LABEL,
        value: formatCount(input.reviewOnlyCandidates),
        hint: 'Se guardaron para que las revises, pero no cuentan hacia el objetivo.',
      },
      {
        key: 'target_reached',
        label: TARGET_REACHED_LABEL,
        value: targetValue,
        hint: targetHint,
      },
    ],
    claimsAllPersistedAreValid: false,
    targetReached,
  };
}
