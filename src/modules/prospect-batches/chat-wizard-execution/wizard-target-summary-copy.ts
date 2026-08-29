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
  | 'target_reached'
  // AGENT1-LOCAL-CUT8 — filas del resumen canónico de aceptación.
  | 'accepted_for_target'
  | 'remaining_target';

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

// ─── Resumen canónico de aceptación (AGENT1-LOCAL-CUT8) ───────────────────────

/**
 * El resumen que el panel de éxito pinta cuando el servidor envió la aceptación
 * canónica de CUT-7.
 *
 * ── Por qué vive aquí y no en un módulo nuevo ────────────────────────────────
 *
 * Porque devuelve el MISMO `WizardTargetSummary` que ya renderiza el panel, con
 * las mismas etiquetas y el mismo `NOT_MEASURED_VALUE`. Un segundo bloque de
 * copy con su propio formato y su propia palabra para «no se midió» es como dos
 * superficies que describen la misma corrida empiezan a contradecirse.
 *
 * ── 🔴 CERO aritmética de aceptación ─────────────────────────────────────────
 *
 * No suma, no resta y no compara conteos contra el objetivo. Cada número sale
 * ya resuelto de `resolveAcceptedForTarget`; aquí sólo se decide cómo se
 * ESCRIBE. Recalcular `targetReached` a partir de `acceptedForTargetTotal >=
 * requestedTarget` sería una segunda autoridad, aunque diera el mismo resultado.
 *
 * ── 🔴 No medir no es fallar ─────────────────────────────────────────────────
 *
 * Con `paidAcceptanceMeasured === false` la mitad de pago aportó cero al conteo
 * porque no se sabe cuánto aportó, no porque se sepa que aportó nada. Entonces:
 *
 *   · lo aceptado y lo que falta se pintan «Sin medir», nunca un cero ni una
 *     cifra que se leería como exacta;
 *   · el veredicto se pinta «Sin medir» en vez de «No» — inferir el fallo del
 *     objetivo desde la ausencia de medición es afirmar más de lo que se sabe;
 *   · salvo que el objetivo YA esté alcanzado. `targetReached === true` con la
 *     mitad de pago sin medir significa que lo gratuito solo ya cubrió lo
 *     pedido: medir la otra mitad sólo podría sumar, jamás quitar, así que el
 *     «Sí» es firme y esconderlo restaría un logro real.
 *
 * Las filas persistidas se pintan SIEMPRE con su número: el universo durable se
 * conoce aunque la aceptación no, y ocultarlo diría que no hay nada que revisar
 * cuando sí lo hay.
 */
export type WizardAcceptedForTargetSummaryInput = {
  requestedTarget: number;
  acceptedForTargetTotal: number;
  remainingTarget: number;
  targetReached: boolean;
  persistedTotalCandidates: number;
  paidAcceptanceMeasured: boolean;
};

export const ACCEPTED_FOR_TARGET_LABEL = 'Empresas que cuentan hacia el objetivo';
export const REMAINING_TARGET_LABEL = 'Faltan para el objetivo';

export function buildWizardAcceptedForTargetSummary(
  input: WizardAcceptedForTargetSummaryInput,
): WizardTargetSummary {
  // El «Sí» firme sobrevive a la falta de medición; el «No» no.
  const targetReached: boolean | null = input.targetReached
    ? true
    : input.paidAcceptanceMeasured
      ? false
      : null;

  const acceptanceKnown = input.paidAcceptanceMeasured || input.targetReached;

  const targetValue =
    targetReached === null ? NOT_MEASURED_VALUE : targetReached ? 'Sí' : 'No';

  const targetHint =
    targetReached === null
      ? `El objetivo era ${input.requestedTarget}. No pudimos medir cuántas empresas de la búsqueda pagada quedaron completas, así que no afirmamos que no se alcanzara.`
      : `${input.acceptedForTargetTotal} de ${input.requestedTarget} empresas cuentan hacia el objetivo.`;

  return {
    rows: [
      {
        key: 'persisted_candidates',
        label: PERSISTED_CANDIDATES_LABEL,
        value: String(input.persistedTotalCandidates),
        hint: 'Filas creadas en el listado de prospectos, completas o no. Todas se pueden revisar.',
      },
      {
        key: 'accepted_for_target',
        label: ACCEPTED_FOR_TARGET_LABEL,
        value: acceptanceKnown ? String(input.acceptedForTargetTotal) : NOT_MEASURED_VALUE,
        hint: 'Son las únicas que cuentan hacia lo que pediste. Pueden ser menos que las guardadas.',
      },
      {
        key: 'remaining_target',
        label: REMAINING_TARGET_LABEL,
        value: acceptanceKnown ? String(input.remainingTarget) : NOT_MEASURED_VALUE,
        hint: `Pediste ${input.requestedTarget}.`,
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
