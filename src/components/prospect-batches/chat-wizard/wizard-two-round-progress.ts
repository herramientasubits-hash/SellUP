/**
 * wizard-two-round-progress.ts — estados de progreso y cierre de la modalidad
 * Apollo de dos rondas.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 11.
 *
 * Puro y sin DOM.
 *
 * La regla que gobierna este módulo: NO afirmar que la ronda 2 corrió.
 *
 * La ejecución del wizard es un único viaje al servidor — no hay streaming, así
 * que durante la corrida el cliente no sabe en qué ronda está. Por eso las etapas
 * se presentan como PLAN («esto es lo que puede pasar»), nunca como progreso
 * cumplido. Lo cumplido sólo se afirma DESPUÉS, y sólo con el número real de
 * rondas que el backend reportó.
 *
 * Un indicador que dice «ronda 2 de 2» porque la barra llegó al 90 % es una
 * afirmación falsa sobre gasto: la ronda 2 son créditos de Apollo, y decir que
 * ocurrió cuando no ocurrió desalinea el copy de la contabilidad.
 */

// ─── Etapas planificadas ──────────────────────────────────────────────────────

export type ApolloTwoRoundProgressPhase =
  | 'round_1_search'
  | 'round_1_evaluation'
  | 'round_2_search'
  | 'enrichment_evaluation'
  | 'preparing_candidates';

export type ApolloTwoRoundProgressStep = {
  phase: ApolloTwoRoundProgressPhase;
  label: string;
  /**
   * True cuando la etapa puede no ocurrir. La ronda 2 sólo corre si la ronda 1
   * no alcanzó el objetivo, y la superficie tiene que poder decirlo.
   */
  conditional: boolean;
};

export const APOLLO_TWO_ROUND_PLANNED_STEPS_TITLE = 'Etapas de esta ejecución';

/**
 * Aviso que acompaña a la lista planificada. Sin él, una lista de cinco líneas se
 * lee como cinco cosas que van a pasar.
 */
export const APOLLO_TWO_ROUND_CONDITIONAL_NOTICE =
  'La ronda 2 sólo se ejecuta si la ronda 1 no alcanza el objetivo.';

/**
 * Etapas de una corrida de dos rondas, en orden.
 *
 * `maxRounds` viene de la configuración efectiva: si un operador bajó el máximo a
 * una ronda, la etapa de la ronda 2 desaparece en vez de mentir sobre un techo
 * que ya no existe.
 */
export function buildApolloTwoRoundProgressSteps(input: {
  maxRounds: number;
}): readonly ApolloTwoRoundProgressStep[] {
  const { maxRounds } = input;

  const steps: ApolloTwoRoundProgressStep[] = [
    {
      phase: 'round_1_search',
      label: `Buscando empresas con Apollo — ronda 1 de ${maxRounds}`,
      conditional: false,
    },
    {
      phase: 'round_1_evaluation',
      label: 'Evaluando resultados y duplicados',
      conditional: false,
    },
  ];

  if (maxRounds >= 2) {
    steps.push({
      phase: 'round_2_search',
      label: `Buscando alternativas — ronda 2 de ${maxRounds}`,
      conditional: true,
    });
  }

  steps.push(
    {
      phase: 'enrichment_evaluation',
      label: 'Evaluando empresas para enrichment',
      conditional: false,
    },
    { phase: 'preparing_candidates', label: 'Preparando candidatos', conditional: false },
  );

  return steps;
}

// ─── Cierre de la corrida ─────────────────────────────────────────────────────

export type ApolloTwoRoundOutcomeInput = {
  /** Rondas que el backend reportó como ejecutadas. `null` = no se sabe. */
  roundsExecuted: number | null;
  /** Empresas válidas obtenidas. `null` = no se sabe. */
  eligibleCompaniesFound: number | null;
  targetEligibleCompanies: number;
};

export type ApolloTwoRoundOutcome = {
  /** `Rondas ejecutadas: N`. `null` cuando el dato no llegó. */
  roundsLine: string | null;
  /** `Objetivo alcanzado: sí | no`. `null` cuando no se puede afirmar. */
  targetLine: string | null;
  /** Resumen parcial. Presente sólo cuando NO se alcanzó el objetivo. */
  partialLine: string | null;
  /** Recordatorio de que no se relajaron filtros. Acompaña al parcial. */
  filtersLine: string | null;
};

export const APOLLO_TWO_ROUND_FILTERS_PRESERVED_LINE =
  'No se redujeron los filtros de calidad.';

/**
 * § 11 — cierre honesto de una corrida de dos rondas.
 *
 * Un dato ausente produce `null`, nunca un cero ni un «no»: «Objetivo alcanzado:
 * no» cuando en realidad no se sabe es tan incorrecto como afirmar que sí.
 */
export function summarizeApolloTwoRoundOutcome(
  input: ApolloTwoRoundOutcomeInput,
): ApolloTwoRoundOutcome {
  const { roundsExecuted, eligibleCompaniesFound, targetEligibleCompanies } = input;

  const roundsLine =
    roundsExecuted === null ? null : `Rondas ejecutadas: ${roundsExecuted}`;

  if (eligibleCompaniesFound === null) {
    return { roundsLine, targetLine: null, partialLine: null, filtersLine: null };
  }

  const targetReached = eligibleCompaniesFound >= targetEligibleCompanies;

  if (targetReached) {
    // Objetivo alcanzado: no se enumera nada sobre la ronda 2. Si paró en la
    // ronda 1, `roundsLine` ya dice «Rondas ejecutadas: 1» y ninguna otra línea
    // insinúa una segunda.
    return {
      roundsLine,
      targetLine: 'Objetivo alcanzado: sí',
      partialLine: null,
      filtersLine: null,
    };
  }

  const roundsWord =
    roundsExecuted === null
      ? null
      : `${roundsExecuted} ${roundsExecuted === 1 ? 'ronda' : 'rondas'}`;

  return {
    roundsLine,
    targetLine: 'Objetivo alcanzado: no',
    partialLine:
      roundsWord === null
        ? `Se encontraron ${eligibleCompaniesFound} ${
            eligibleCompaniesFound === 1 ? 'empresa válida' : 'empresas válidas'
          }.`
        : `Se encontraron ${eligibleCompaniesFound} ${
            eligibleCompaniesFound === 1 ? 'empresa válida' : 'empresas válidas'
          } después de ${roundsWord}.`,
    filtersLine: APOLLO_TWO_ROUND_FILTERS_PRESERVED_LINE,
  };
}
