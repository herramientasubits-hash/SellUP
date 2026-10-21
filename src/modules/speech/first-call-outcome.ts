/**
 * Agente 3 · cómo se guarda «La usé» y su resultado (puro). Va dentro del JSON de la
 * preparación (`pack.outcome`, sin migración) con lo que hace falta para aprender
 * (auditoría 21-10): la versión usada —si es la principal, su enfoque, que antes quedaba
 * vacío—, si el vendedor editó el texto y los resultados anteriores (antes cada cambio
 * borraba el anterior). Lo leen el tablero y el redactor (`approach-results.ts`).
 */

import { FIRST_CONTACT_APPROACHES, type FirstContactApproach, type FirstContactOutcome } from '@/server/agents/first-call/approaches';

/** Cambios de resultado que se guardan (el vigente va aparte). */
export const OUTCOME_HISTORY_MAX = 10;

export interface StoredFirstCallOutcome {
  result: FirstContactOutcome;
  at: string;
  approach: FirstContactApproach | null;
  edited: boolean;
  history?: Array<{ result: string; at: string | null }>;
}

function isApproach(value: unknown): value is FirstContactApproach {
  return typeof value === 'string' && (FIRST_CONTACT_APPROACHES as readonly string[]).includes(value);
}

export function buildFirstCallOutcome(input: {
  /** `pack.outcome` que ya estaba (o nada). */
  previous: unknown;
  outcome: FirstContactOutcome;
  /** La versión que dice la tarjeta (`null` = la principal o no dijo). */
  approach: FirstContactApproach | null | undefined;
  /** `pack.approach`: el enfoque de la versión principal. */
  mainApproach: unknown;
  edited: boolean;
  nowIso: string;
}): StoredFirstCallOutcome {
  const previous = input.previous && typeof input.previous === 'object' ? (input.previous as Record<string, unknown>) : null;
  // La versión usada: la que llega, la ya guardada o, si no dijo, la principal.
  const approach = isApproach(input.approach)
    ? input.approach
    : isApproach(previous?.approach)
      ? previous.approach
      : isApproach(input.mainApproach)
        ? input.mainApproach
        : null;
  const history = [
    ...(Array.isArray(previous?.history) ? (previous.history as StoredFirstCallOutcome['history'] & unknown[]) : []),
    ...(typeof previous?.result === 'string' ? [{ result: previous.result, at: typeof previous.at === 'string' ? previous.at : null }] : []),
  ].slice(-OUTCOME_HISTORY_MAX);
  return { result: input.outcome, at: input.nowIso, approach, edited: input.edited, ...(history.length > 0 ? { history } : {}) };
}
