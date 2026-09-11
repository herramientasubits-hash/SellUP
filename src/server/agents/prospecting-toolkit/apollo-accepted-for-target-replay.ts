/**
 * apollo-accepted-for-target-replay.ts — reconstruir la aceptación de una
 * corrida YA ALMACENADA, sin volver a pagarle a Apollo.
 *
 * A1-APOLLO-ACCEPTED-FOR-TARGET-TRACEABILITY § D.1.
 *
 * ── Qué responde ─────────────────────────────────────────────────────────────
 *
 * Las seis preguntas de la certificación, todas desde filas que ya existen:
 *
 *   1. cuántas empresas encontró Apollo      → `companiesFound`
 *   2. cuántas se descartaron                → `companiesRejected`
 *   3. cuántas llegaron a candidato          → `candidatesPersisted`
 *   4. cuántas fueron accepted_for_target    → `candidatesAccepted`
 *   5. cuánto costó la búsqueda              → `creditsUsed`
 *   6. coste por empresa aceptada            → `creditsPerAccepted`
 *
 * ── 🔴 LA TRAMPA QUE ESTE MÓDULO EXISTE PARA IMPEDIR ─────────────────────────
 *
 * La aceptación es un hecho DE LA CORRIDA; la fila del embudo de Apollo es
 * POR CONSULTA. En Producción (medido el 11-09-2026) las 8 corridas con embudo
 * tienen DOS filas de `organizations_search` cada una, así que estampar el total
 * de la corrida en cada fila DUPLICA la cifra: el lote `483f3584` reportaría 10
 * aceptadas en vez de 5, y `5fa4c263` reportaría 4 en vez de 2.
 *
 * Por eso este módulo trabaja SOBRE LA CORRIDA y nunca por consulta, y por eso
 * `usageRows` entra como lista: los créditos se SUMAN entre las filas de la
 * corrida y la aceptación NO se reparte entre ellas.
 *
 * ── 🔴 De dónde sale `accepted`, exactamente ─────────────────────────────────
 *
 * De `source_trace.acceptedForTarget.acceptedForTarget` de cada fila de
 * `prospect_candidates`, que es el `countsTowardTarget` que el writer decidió
 * (ver `candidate-accepted-for-target-trace.ts`). NO de un contador, NO de que
 * la fila exista y NO de que la empresa sobreviviera a un filtro.
 *
 * El contador del contrato (`complete_valid_candidates`, publicado en
 * `prospect_batches.metadata.accepted_for_target`) se usa SÓLO para
 * CONTRASTAR. Si las dos cifras discrepan, el replay lo declara
 * (`correlationBroken`) en vez de elegir una: una divergencia significa que la
 * correlación se rompió, y promediarla sería inventar.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj. El llamador trae las
 * filas ya leídas.
 */

import {
  CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY,
  ACCEPTED_FOR_TARGET_DECIDED_BY,
} from './candidate-accepted-for-target-trace';

/** Una fila de `prospect_candidates`, en lo que este replay necesita. */
export interface StoredCandidateRow {
  readonly id: string;
  readonly source_trace: Record<string, unknown> | null;
}

/** Una fila de `provider_usage_logs` de `apollo/organizations_search`. */
export interface StoredApolloUsageRow {
  readonly credits_used: number | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface ApolloRunAcceptanceReplayInput {
  /** TODAS las filas de búsqueda de la corrida. Los créditos se suman. */
  readonly usageRows: readonly StoredApolloUsageRow[];
  /** TODAS las filas de candidato del lote de la corrida. */
  readonly candidateRows: readonly StoredCandidateRow[];
  /**
   * `prospect_batches.metadata.accepted_for_target.complete_valid_candidates`
   * —o `accepted_paid_for_target`—, el contador del contrato. `null` = no medido.
   * Se usa SÓLO para contrastar.
   */
  readonly contractAcceptedCount: number | null;
}

export interface ApolloRunAcceptanceReplay {
  readonly companiesFound: number | null;
  readonly companiesRejected: number | null;
  readonly candidatesPersisted: number;
  /** Suma de veredictos POR CANDIDATO. `null` si ninguna fila lleva traza. */
  readonly candidatesAccepted: number | null;
  readonly creditsUsed: number | null;
  readonly creditsPerAccepted: number | null;
  /** Filas con traza de veredicto. Si es 0, la corrida es pre-D.1. */
  readonly candidatesWithTrace: number;
  /**
   * 🔴 `true` cuando la suma por candidato y el contador del contrato NO
   * coinciden. No se resuelve: se declara.
   */
  readonly correlationBroken: boolean;
  readonly contractAcceptedCount: number | null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Lee el veredicto de UNA fila almacenada.
 *
 * 🔴 Exige `decidedBy === 'candidate_target_eligibility'`. Una traza sin esa
 * marca no se acepta como veredicto: es la única defensa contra que algún día
 * otra capa escriba un booleano con el mismo nombre y este replay lo lea como si
 * viniera del writer.
 */
export function readStoredCandidateAcceptance(row: StoredCandidateRow): boolean | null {
  const trace = obj(obj(row.source_trace)?.[CANDIDATE_ACCEPTED_FOR_TARGET_TRACE_KEY]);
  if (trace === null) return null;
  if (trace.decidedBy !== ACCEPTED_FOR_TARGET_DECIDED_BY) return null;
  return typeof trace.acceptedForTarget === 'boolean' ? trace.acceptedForTarget : null;
}

/**
 * Reconstruye la corrida. NUNCA llama a un proveedor: todos los insumos son
 * filas que el llamador ya leyó.
 */
export function replayApolloRunAcceptance(
  input: ApolloRunAcceptanceReplayInput,
): ApolloRunAcceptanceReplay {
  // ── Economía: se SUMA entre las filas de la corrida, no se reparte ─────────
  const creditsSeen = input.usageRows
    .map((r) => num(r.credits_used))
    .filter((c): c is number => c !== null);
  const creditsUsed = creditsSeen.length > 0 ? creditsSeen.reduce((a, b) => a + b, 0) : null;

  // ── Embudo: `paid_raw` y `precision_rejected` del bloque que ya existe ─────
  const funnels = input.usageRows.map((r) =>
    obj(obj(r.metadata)?.apollo_benchmark_funnel),
  );
  const found = funnels
    .map((f) => (f === null ? null : num(f.paid_raw)))
    .filter((v): v is number => v !== null);
  const rejected = funnels
    .map((f) => (f === null ? null : num(f.precision_rejected)))
    .filter((v): v is number => v !== null);

  // ── Aceptación: veredicto POR CANDIDATO ───────────────────────────────────
  const verdicts = input.candidateRows
    .map(readStoredCandidateAcceptance)
    .filter((v): v is boolean => v !== null);
  const candidatesAccepted =
    verdicts.length > 0 ? verdicts.filter((v) => v).length : null;

  // 🔴 Contraste, no resolución. Con el contador ausente no hay nada que
  // contrastar y la correlación NO se declara rota: no medir no es discrepar.
  const correlationBroken =
    candidatesAccepted !== null &&
    input.contractAcceptedCount !== null &&
    candidatesAccepted !== input.contractAcceptedCount;

  return {
    companiesFound: found.length > 0 ? found.reduce((a, b) => a + b, 0) : null,
    companiesRejected: rejected.length > 0 ? rejected.reduce((a, b) => a + b, 0) : null,
    candidatesPersisted: input.candidateRows.length,
    candidatesAccepted,
    creditsUsed,
    // Dividir entre cero no es cero: con 0 aceptadas el coste por aceptada no
    // existe, y decir `0` afirmaría que salió gratis.
    creditsPerAccepted:
      candidatesAccepted !== null && candidatesAccepted > 0 && creditsUsed !== null
        ? creditsUsed / candidatesAccepted
        : null,
    candidatesWithTrace: verdicts.length,
    correlationBroken,
    contractAcceptedCount: input.contractAcceptedCount,
  };
}
