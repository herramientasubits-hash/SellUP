/**
 * wizard-two-round-progress.ts — cierre de la modalidad Apollo de dos rondas.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 11.
 *
 * Puro y sin DOM.
 *
 * La regla que gobierna este módulo: NO afirmar que la ronda 2 corrió.
 *
 * Lo cumplido sólo se afirma DESPUÉS, y sólo con el número real de rondas que el
 * backend reportó. Durante la corrida el chat cuenta la etapa EN VIVO, tal como
 * el servidor la anota (`run-progress.ts`, AGENT1-RUN-LIVE-PROGRESS-1); la lista
 * de «etapas de esta ejecución» que se pintaba como plan se retiró.
 *
 * Un indicador que dice «ronda 2 de 2» porque la barra llegó al 90 % es una
 * afirmación falsa sobre gasto: la ronda 2 son créditos de Apollo, y decir que
 * ocurrió cuando no ocurrió desalinea el copy de la contabilidad.
 */

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
