/**
 * wizard-result-copy.ts — qué se le dice al usuario cuando una corrida termina,
 * con la CAUSA de mayor prioridad ganando siempre.
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 8.
 *
 * El defecto observado: LIVE-QA-2 (lote `62fdf47b`) encontró UNA empresa
 * elegible, el writer no la pudo guardar porque `prospect_candidates.identity_key`
 * no existía en Producción, y la UI dijo
 *
 *   «Todos los resultados ya habían sido sugeridos recientemente.»
 *
 * Ese texto no era una elección arbitraria: la distribución de descartes de la
 * corrida tenía 3 `duplicate_in_hubspot` + 5 `seen_in_previous_round`, así que
 * `recentlySuggestedCount = 8` y el resolutor de QUERY-QUALITY-2 lo eligió con
 * toda corrección. Lo que faltaba era la causa que estaba POR ENCIMA: un fallo
 * de almacenamiento no es una razón de historial, y decirle al usuario que sus
 * resultados «ya se habían sugerido» le pide justo lo contrario de lo que debe
 * hacer (repetir la búsqueda y pagarla otra vez).
 *
 * Orden de prioridad, en un solo lugar y testeado:
 *
 *   1. fallo de persistencia   — error técnico; el gasto ya ocurrió
 *   2. persistencia parcial    — hay algo que revisar, y algo se perdió
 *   3. historial / calidad     — la distribución real de descartes
 *
 * Puro: sin I/O, sin React, sin env.
 */

import {
  resolveNoNewCandidatesCopy,
  type NoNewCandidatesBreakdown,
  type NoNewCandidatesCopy,
} from './wizard-no-new-candidates-copy';

// ─── Entrada ──────────────────────────────────────────────────────────────────

/**
 * Cifras de persistencia proyectadas hacia el cliente. `null` cuando el servidor
 * no las envió (una corrida previa a este hito, o un camino que no persiste).
 */
export type WizardPersistenceOutcome = {
  eligibleBeforePersistence: number;
  persistedCandidates: number;
  persistenceFailureCount: number;
  persistenceFailed: boolean;
  persistenceErrorCode: string | null;
};

export type WizardResultCopyCause =
  | 'persistence_failed'
  | 'persistence_partial'
  | NoNewCandidatesCopy['cause'];

export type WizardResultCopy = {
  /** De qué familia salió el texto. Es lo que un test afirma sin leer prosa. */
  source: 'persistence_failure' | 'no_new_candidates';
  cause: WizardResultCopyCause;
  /** Titular. `null` cuando lo pone el panel (familia `no_new_candidates`). */
  heading: string | null;
  body: string;
  /** Nota de auditoría; NO se muestra al usuario final. */
  auditNote: string | null;
  /**
   * § 8 — afirmación explícita de que este texto NO habla de historial. La UI y
   * los tests la leen en vez de comparar prosa.
   */
  claimsRecentlySuggested: boolean;
};

// ─── Textos de fallo de almacenamiento ────────────────────────────────────────

export const PERSISTENCE_FAILED_HEADING = 'No pudimos guardar los resultados.';
export const PERSISTENCE_PARTIAL_HEADING = 'Guardamos solo parte de los resultados.';

/**
 * Advertencia común a los dos casos: el gasto ya ocurrió, así que repetir la
 * búsqueda no recupera nada y sí vuelve a cobrar.
 */
const ALREADY_SPENT_WARNING =
  'La búsqueda ya fue ejecutada y pudo consumir créditos. No vuelvas a generar ' +
  'la búsqueda. Intenta nuevamente después de que se corrija el problema de ' +
  'almacenamiento.';

function pluralizeCompanies(count: number): string {
  return count === 1 ? '1 empresa candidata' : `${count} empresas candidatas`;
}

function buildPersistenceFailedBody(eligible: number): string {
  const subject = eligible > 0 ? pluralizeCompanies(eligible) : 'empresas candidatas';
  const pronoun = eligible === 1 ? 'guardarla' : 'guardarlas';
  return `Encontramos ${subject}, pero no fue posible ${pronoun}. ${ALREADY_SPENT_WARNING}`;
}

function buildPersistencePartialBody(eligible: number, persisted: number): string {
  return (
    `Guardamos ${persisted} de ${eligible} empresas encontradas; las demás no se ` +
    `pudieron guardar. ${ALREADY_SPENT_WARNING}`
  );
}

// ─── Resolución ───────────────────────────────────────────────────────────────

/**
 * Cierto cuando hay que hablar de almacenamiento antes que de cualquier otra
 * cosa. Exige las DOS señales: que el writer declare el fallo y que hubiera algo
 * que perder. Un `persistenceFailed` sin empresas elegibles no tiene nada que
 * anunciar como pérdida.
 */
export function isPersistenceFailureRelevant(
  persistence: WizardPersistenceOutcome | null | undefined,
): boolean {
  if (!persistence) return false;
  if (!persistence.persistenceFailed && persistence.persistenceFailureCount <= 0) return false;
  return persistence.eligibleBeforePersistence > 0;
}

/**
 * Texto final de la corrida.
 *
 * Cuando la persistencia falla, el resolutor de historial/calidad NI SE CONSULTA:
 * su distribución sigue siendo verdad, pero no es la causa que el usuario tiene
 * que leer, y una disyunción entre ambas es cómo se produjo el copy engañoso.
 */
export function resolveWizardResultCopy(input: {
  persistence?: WizardPersistenceOutcome | null;
  noNewCandidates?: NoNewCandidatesBreakdown | null;
}): WizardResultCopy {
  const persistence = input.persistence ?? null;

  if (isPersistenceFailureRelevant(persistence) && persistence !== null) {
    const eligible = Math.max(0, Math.trunc(persistence.eligibleBeforePersistence));
    const persisted = Math.max(0, Math.trunc(persistence.persistedCandidates));
    const partial = persisted > 0 && persisted < eligible;
    return {
      source: 'persistence_failure',
      cause: partial ? 'persistence_partial' : 'persistence_failed',
      heading: partial ? PERSISTENCE_PARTIAL_HEADING : PERSISTENCE_FAILED_HEADING,
      body: partial
        ? buildPersistencePartialBody(eligible, persisted)
        : buildPersistenceFailedBody(eligible),
      auditNote: null,
      claimsRecentlySuggested: false,
    };
  }

  const fallback = resolveNoNewCandidatesCopy(
    input.noNewCandidates ?? {
      recentlySuggestedCount: 0,
      qualityRejectedCount: 0,
      noveltyExhausted: false,
      secondRoundSkippedReason: null,
    },
  );

  return {
    source: 'no_new_candidates',
    cause: fallback.cause,
    heading: null,
    body: fallback.body,
    auditNote: fallback.auditNote,
    claimsRecentlySuggested:
      fallback.cause === 'all_recently_suggested' || fallback.cause === 'mixed',
  };
}
