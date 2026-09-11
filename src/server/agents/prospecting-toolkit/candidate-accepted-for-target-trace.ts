/**
 * candidate-accepted-for-target-trace.ts — el veredicto de aceptación de UN
 * candidato, con el id de la fila que lo llevó, conservado en vez de descartado.
 *
 * A1-APOLLO-ACCEPTED-FOR-TARGET-TRACEABILITY § D.1.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * El writer YA decide la aceptación por candidato:
 * `evaluateCandidateSubindustryTargetEligibility` produce
 * `targetEligibility.countsTowardTarget`, y ese booleano es literalmente la
 * respuesta a «¿esta empresa cuenta hacia el objetivo?».
 *
 * El problema no es que falte la decisión: es que se TIRA. En `candidate-writer`
 * el veredicto y el `createdCandidateId` coexisten durante UNA sentencia —el
 * `push` a `persistedTargetEligibilities`, justo después de que la fila
 * exista— y ahí se separan para siempre: el array sólo guarda elegibilidades, y
 * su único consumidor (`buildCandidateCompletenessCounters`) las colapsa a un
 * CONTADOR (`complete_valid_candidates`).
 *
 * Consecuencia medida en Producción: `apollo_benchmark_funnel.accepted_for_target`
 * sale `null` en 16 de 16 filas, y no hay forma de preguntarle a una empresa
 * concreta si fue aceptada — sólo a la corrida entera, y en agregado.
 *
 * ── 🔴 Lo que este módulo NO hace ────────────────────────────────────────────
 *
 * NO evalúa. NO reimplementa el contrato de completitud. NO deduce la
 * aceptación de que la empresa sobreviviera a un filtro, ni de un contador, ni
 * de que exista una fila. LEE `countsTowardTarget` del veredicto que el writer
 * ya tomó y lo empareja con su identidad.
 *
 * Ésa es toda su responsabilidad, y es deliberadamente pequeña: cualquier
 * aritmética aquí sería una SEGUNDA autoridad de aceptación, que es justo lo que
 * CUT-7 (`accepted-for-target.ts`) existe para impedir.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

import type { CandidateTargetEligibilitySummary } from './candidate-completeness-contract';

/** Clave del bloque dentro de `prospect_candidates.source_trace`. */
export const CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY = 'acceptedForTarget' as const;

/**
 * Quién tomó la decisión. Es una CONSTANTE, no un parámetro: si alguna vez hay
 * que escribir otro valor aquí, significa que apareció una segunda autoridad y
 * eso es precisamente lo que hay que impedir, no configurar.
 */
export const ACCEPTED_FOR_TARGET_DECIDED_BY = 'candidate_target_eligibility' as const;

/**
 * El veredicto durable de UN candidato.
 *
 * 🔴 `acceptedForTarget` es el `countsTowardTarget` del writer, VERBATIM. No es
 * «pasó el gate», no es «se persistió» y no es «no tiene motivos de bloqueo»:
 * es el booleano que el contrato de completitud ya resolvió.
 */
export interface CandidateAcceptedForTargetTrace {
  readonly acceptedForTarget: boolean;
  readonly decidedBy: typeof ACCEPTED_FOR_TARGET_DECIDED_BY;
  /**
   * Por qué NO fue aceptado, con los nombres del contrato. Vacío cuando sí.
   *
   * 🔴 Viaja porque «rechazado» sin motivo no es reconstruible: la certificación
   * tiene que poder distinguir un rechazo por ICP de uno por duplicado sin
   * volver a preguntarle al proveedor.
   */
  readonly blockingReasons: readonly string[];
}

/**
 * Empareja el veredicto del writer con su forma durable.
 *
 * 🔴 El único argumento es la elegibilidad que el writer ya calculó. No hay
 * ningún otro insumo, y eso no es minimalismo estético: un segundo parámetro
 * —un conteo, un total del lote, un «sobrevivió al filtro»— sería la puerta por
 * la que entraría una aceptación inferida.
 */
export function buildCandidateAcceptedForTargetTrace(
  eligibility: CandidateTargetEligibilitySummary,
): CandidateAcceptedForTargetTrace {
  const accepted = eligibility.countsTowardTarget === true;
  return {
    acceptedForTarget: accepted,
    decidedBy: ACCEPTED_FOR_TARGET_DECIDED_BY,
    // Un aceptado no arrastra motivos: si los tuviera, el veredicto y su
    // explicación se contradirían dentro de la misma fila.
    blockingReasons: accepted ? [] : [...eligibility.failedConditions],
  };
}

/**
 * El veredicto de un candidato, ya emparejado con la fila que existe.
 *
 * 🔴 `candidateId` es lo que convierte un booleano en TRAZABILIDAD. Sin él la
 * decisión vuelve a ser un contador, que es el estado del que venimos.
 */
export interface PersistedCandidateAcceptance {
  readonly candidateId: string;
  readonly trace: CandidateAcceptedForTargetTrace;
}

/**
 * Agrega los veredictos por candidato a la cifra que el contrato ya publica.
 *
 * 🔴 Esto NO es una segunda aritmética de aceptación: es la comprobación de que
 * la traza por candidato y el contador del contrato dicen lo MISMO. El número
 * que gobierna sigue saliendo de `buildCandidateCompletenessCounters`; esta
 * función existe para que una divergencia se pueda DETECTAR en vez de
 * promediarse en silencio.
 *
 * Se usa en las pruebas y en el replay de la certificación, nunca para decidir.
 */
export function countAcceptedFromTraces(
  acceptances: readonly PersistedCandidateAcceptance[],
): number {
  return acceptances.reduce((total, a) => total + (a.trace.acceptedForTarget ? 1 : 0), 0);
}
