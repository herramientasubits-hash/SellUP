/**
 * checkpoint-merge.ts — Fusión determinista de dos checkpoints de LA MISMA corrida.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-CAS-CLOSE · § 1, § 2.
 *
 * El hueco que cierra: `writeTwoRoundCheckpoint` resuelve la concurrencia con un
 * compare-and-swap sobre `checkpoint_version`. Cuando dos procesos del MISMO run
 * escriben a la vez, uno gana y el otro recibe `stale_rejected`. El adaptador
 * interpretaba ese rechazo como "el estado ya está durable" y devolvía `true`.
 *
 * Eso sólo es cierto si el checkpoint ganador contiene EXACTAMENTE la operación
 * que el perdedor intentaba persistir. Si no la contiene, dar la operación por
 * completada deja un cargo real sin registro recuperable: un reintento posterior
 * la saltaría (corrida vacía tras pagar) o la repetiría (segundo cargo). Ninguno
 * de los dos desenlaces es aceptable para una operación que cuesta créditos.
 *
 * Este módulo aporta las dos piezas que faltaban:
 *
 *   1. `verifyDurableCheckpointContainsOperation` — la prueba, no la suposición,
 *      de que el ganador ya contiene la operación con el mismo estado, el mismo
 *      resultado recuperable y la misma identidad económica.
 *   2. `mergeApolloTwoRoundCheckpoints` — la fusión determinista que permite
 *      REINTENTAR el CAS sobre el documento ganador en vez de descartar lo que el
 *      perdedor había conseguido.
 *
 * Invariantes de la fusión (§ 2):
 *
 *   - `indeterminate` prevalece sobre `completed`;
 *   - ninguna operación desaparece;
 *   - un resultado durable no se reemplaza por ausencia;
 *   - `candidates_persisted` nunca vuelve a `false`;
 *   - los créditos se deduplican por `operation_id`; el mismo gasto no se suma dos
 *     veces, y tampoco se pierde;
 *   - dos corridas distintas (otro `wizard_run_id`, otra identidad, otra config)
 *     NO se fusionan: se rechaza y el llamador degrada a indeterminada.
 *
 * Puro: sin I/O, sin reloj, sin env. Determinista: `merge(a, b)` produce el mismo
 * documento en los dos procesos, que es lo que permite que converjan.
 */

import type {
  ApolloTwoRoundCandidateSnapshot,
  ApolloTwoRoundCheckpointV1,
  ApolloTwoRoundEnrichmentSnapshot,
  ApolloTwoRoundEnrichmentStatus,
  ApolloTwoRoundPendingOrganizationSnapshot,
  ApolloTwoRoundRecordedOperationCredit,
} from './checkpoint';
import { APOLLO_TWO_ROUND_CHECKPOINT_CONTRACT_VERSION } from './checkpoint';
import type { ApolloTwoRoundRoundMetrics } from './observability';
import type { ApolloTwoRoundOperation } from './idempotency';

// ─── Contención de una operación (§ 1) ────────────────────────────────────────

/** Lo que hay que probar del checkpoint ganador. */
export type ApolloTwoRoundOperationDurabilityProbe = {
  operationId: string;
  operationKey: ApolloTwoRoundOperation;
  roundNumber: number;
  /** Estado con el que el perdedor intentaba cerrar la operación. */
  expectedStatus: 'completed' | 'indeterminate';
};

/**
 * Por qué el ganador NO prueba la durabilidad de la operación.
 *
 * Vocabulario estático: cada motivo se puede leer en un warning sin interpretar
 * un mensaje libre.
 */
export type ApolloTwoRoundOperationDurabilityGap =
  | 'checkpoint_version_not_superior'
  | 'operation_absent'
  | 'operation_status_mismatch'
  | 'recoverable_result_absent'
  | 'recoverable_result_mismatch'
  | 'usage_identity_absent'
  | 'usage_identity_mismatch';

export type ApolloTwoRoundOperationDurabilityVerdict =
  | { durable: true; source: 'concurrent_checkpoint_already_contains_operation' }
  | { durable: false; gap: ApolloTwoRoundOperationDurabilityGap };

/**
 * ¿El checkpoint durable YA contiene la operación que este proceso intentaba
 * persistir?
 *
 * Las cinco condiciones del contrato, todas obligatorias: mismo `operationId`,
 * mismo estado, mismo resultado recuperable, misma identidad económica y una
 * `checkpoint_version` superior. Devolver `durable: true` por cualquier razón
 * más débil —por ejemplo "otra escritura ganó el CAS"— es exactamente el defecto
 * que este módulo cierra.
 */
export function verifyDurableCheckpointContainsOperation(
  durable: ApolloTwoRoundCheckpointV1,
  attempted: ApolloTwoRoundCheckpointV1,
  probe: ApolloTwoRoundOperationDurabilityProbe,
): ApolloTwoRoundOperationDurabilityVerdict {
  if (durable.checkpoint_version < attempted.checkpoint_version) {
    return { durable: false, gap: 'checkpoint_version_not_superior' };
  }

  const inCompleted = durable.completed_operation_keys.includes(probe.operationId);
  const inIndeterminate = durable.indeterminate_operation_keys.includes(probe.operationId);
  if (!inCompleted && !inIndeterminate) return { durable: false, gap: 'operation_absent' };

  const durableStatus = inIndeterminate ? 'indeterminate' : 'completed';
  if (durableStatus !== probe.expectedStatus) {
    return { durable: false, gap: 'operation_status_mismatch' };
  }

  const resultGap =
    probe.operationKey === 'organization_enrichment'
      ? compareEnrichmentResult(durable, attempted, probe.operationId)
      : compareSearchResult(durable, attempted, probe.roundNumber);
  if (resultGap !== null) return { durable: false, gap: resultGap };

  const usageGap = compareUsageIdentity(durable, attempted, probe.operationId);
  if (usageGap !== null) return { durable: false, gap: usageGap };

  return { durable: true, source: 'concurrent_checkpoint_already_contains_operation' };
}

/**
 * El resultado recuperable de un enrichment es su snapshot: estado, créditos
 * registrados y sujeto. Si el perdedor no tiene snapshot propio de la operación,
 * no hay nada que comparar y la contención no se puede afirmar.
 */
function compareEnrichmentResult(
  durable: ApolloTwoRoundCheckpointV1,
  attempted: ApolloTwoRoundCheckpointV1,
  operationId: string,
): ApolloTwoRoundOperationDurabilityGap | null {
  const mine = attempted.enrichment_snapshots.find((s) => s.operation_id === operationId) ?? null;
  const theirs = durable.enrichment_snapshots.find((s) => s.operation_id === operationId) ?? null;
  if (mine === null || theirs === null) return 'recoverable_result_absent';
  const same =
    mine.status === theirs.status &&
    mine.recorded_credits === theirs.recorded_credits &&
    mine.operation_subject === theirs.operation_subject &&
    mine.round_number === theirs.round_number &&
    mine.candidate_key === theirs.candidate_key;
  return same ? null : 'recoverable_result_mismatch';
}

/**
 * Cuánto de recuperable tiene una ronda en un checkpoint.
 *
 *   2 — la ronda está REGISTRADA: sus organizaciones ya son candidatos evaluados.
 *   1 — sus organizaciones están PENDIENTES: pagadas y recuperables para evaluar.
 *   0 — no hay nada de esa ronda: lo que la búsqueda trajo se perdería.
 *
 * El orden importa porque el checkpoint ganador puede ir MÁS adelantado que el
 * perdedor —es lo normal: ganó la carrera y siguió—, y exigir que los dos estén
 * en el mismo punto rechazaría el caso que el contrato quiere reconocer.
 */
function searchRecoverableProgress(
  checkpoint: ApolloTwoRoundCheckpointV1,
  roundNumber: number,
): 0 | 1 | 2 {
  if (checkpoint.round_summaries.some((round) => round.roundNumber === roundNumber)) return 2;
  if (checkpoint.pending_organizations.some((org) => org.round_number === roundNumber)) return 1;
  return 0;
}

/**
 * El resultado recuperable de una búsqueda son las organizaciones que trajo.
 *
 * El ganador prueba la contención si conserva esa ronda en un estado AL MENOS tan
 * avanzado como el del perdedor: la ronda registrada (sus organizaciones ya son
 * candidatos) o sus organizaciones aún pendientes de evaluar. Un ganador sin
 * ninguna de las dos cosas habría marcado la búsqueda como completada sin nada
 * que recuperar — corrida vacía después de pagar, que es justo lo que se rechaza.
 *
 * Cuando ambos tienen la ronda REGISTRADA, las métricas sí se comparan: dos
 * lecturas de la misma búsqueda no pueden diferir en lo que trajo ni en lo que
 * costó, y si difieren no hay contención que afirmar.
 */
function compareSearchResult(
  durable: ApolloTwoRoundCheckpointV1,
  attempted: ApolloTwoRoundCheckpointV1,
  roundNumber: number,
): ApolloTwoRoundOperationDurabilityGap | null {
  const mine = searchRecoverableProgress(attempted, roundNumber);
  const theirs = searchRecoverableProgress(durable, roundNumber);
  if (theirs === 0) return 'recoverable_result_absent';
  if (theirs < mine) return 'recoverable_result_mismatch';

  if (mine === 2 && theirs === 2) {
    const mineRound = attempted.round_summaries.find((r) => r.roundNumber === roundNumber);
    const theirsRound = durable.round_summaries.find((r) => r.roundNumber === roundNumber);
    if (mineRound === undefined || theirsRound === undefined) return 'recoverable_result_absent';
    const same =
      mineRound.rawResultsReturned === theirsRound.rawResultsReturned &&
      mineRound.internalRecordedCredits === theirsRound.internalRecordedCredits &&
      mineRound.providerRequestCount === theirsRound.providerRequestCount;
    if (!same) return 'recoverable_result_mismatch';
  }
  return null;
}

/**
 * La identidad económica: `usage_key` y créditos registrados de ESTA operación.
 *
 * Es la atadura entre el checkpoint y la fila de `provider_usage_logs`. Sin ella
 * el ganador podría declarar la operación completada sin que exista la fila que
 * la explica.
 */
function compareUsageIdentity(
  durable: ApolloTwoRoundCheckpointV1,
  attempted: ApolloTwoRoundCheckpointV1,
  operationId: string,
): ApolloTwoRoundOperationDurabilityGap | null {
  const mine = findRecordedCredit(attempted.recorded_operation_credits, operationId);
  const theirs = findRecordedCredit(durable.recorded_operation_credits, operationId);
  if (mine === null || theirs === null) return 'usage_identity_absent';
  const same =
    mine.usage_key === theirs.usage_key &&
    mine.credits === theirs.credits &&
    mine.billing_unknown === theirs.billing_unknown &&
    mine.operation_key === theirs.operation_key &&
    mine.round_number === theirs.round_number;
  return same ? null : 'usage_identity_mismatch';
}

function findRecordedCredit(
  entries: readonly ApolloTwoRoundRecordedOperationCredit[],
  operationId: string,
): ApolloTwoRoundRecordedOperationCredit | null {
  return entries.find((entry) => entry.operation_id === operationId) ?? null;
}

// ─── Fusión (§ 2) ─────────────────────────────────────────────────────────────

/** Por qué dos checkpoints NO se pueden fusionar. Cada motivo detiene la corrida. */
export type ApolloTwoRoundCheckpointMergeRefusal =
  | 'contract_version_mismatch'
  | 'idempotency_key_mismatch'
  | 'request_fingerprint_mismatch'
  | 'wizard_run_id_mismatch'
  | 'config_mismatch';

export type ApolloTwoRoundCheckpointMergeResult =
  | { kind: 'merged'; checkpoint: ApolloTwoRoundCheckpointV1 }
  | { kind: 'refused'; reason: ApolloTwoRoundCheckpointMergeRefusal };

/**
 * Fusiona `incoming` sobre `base` conservando la UNIÓN de todo lo recuperable.
 *
 * `base` es el checkpoint durable (el que ganó el CAS) e `incoming` el estado
 * local del proceso que lo perdió. La fusión es simétrica en su contenido: los
 * desempates se resuelven por PROGRESO observable, no por quién llamó primero,
 * así que los dos procesos convergen al mismo documento.
 *
 * `checkpoint_version` NO se asigna aquí: lo pone el escritor, que es quien ve la
 * versión almacenada. Se hereda la de `base` para que el llamador sepa sobre qué
 * documento fusionó.
 */
export function mergeApolloTwoRoundCheckpoints(
  base: ApolloTwoRoundCheckpointV1,
  incoming: ApolloTwoRoundCheckpointV1,
): ApolloTwoRoundCheckpointMergeResult {
  const refusal = refuseIncompatible(base, incoming);
  if (refusal !== null) return { kind: 'refused', reason: refusal };

  // Indeterminada gana: una operación cuyo cobro no se confirmó no puede quedar
  // completada porque el otro proceso alcanzara a cerrarla.
  const indeterminate = unionSorted(
    base.indeterminate_operation_keys,
    incoming.indeterminate_operation_keys,
  );
  const indeterminateSet = new Set(indeterminate);
  const completed = unionSorted(
    base.completed_operation_keys,
    incoming.completed_operation_keys,
  ).filter((key) => !indeterminateSet.has(key));

  const roundSummaries = mergeRoundSummaries(base.round_summaries, incoming.round_summaries);
  const assessedRounds = new Set(roundSummaries.map((round) => round.roundNumber));
  const candidateSnapshots = mergeCandidateSnapshots(
    base.candidate_snapshots,
    incoming.candidate_snapshots,
  );
  const enrichmentSnapshots = mergeEnrichmentSnapshots(
    base.enrichment_snapshots,
    incoming.enrichment_snapshots,
  );
  const recordedOperationCredits = mergeRecordedOperationCredits(
    base.recorded_operation_credits,
    incoming.recorded_operation_credits,
  );

  const recordedUsageCredits = sumRecordedOperationCredits(recordedOperationCredits);

  return {
    kind: 'merged',
    checkpoint: {
      ...base,
      checkpoint_reason: incoming.checkpoint_reason,
      checkpoint_updated_at: null,
      completed_operation_keys: completed,
      indeterminate_operation_keys: indeterminate,
      seen_organization_keys: unionSorted(
        base.seen_organization_keys,
        incoming.seen_organization_keys,
      ),
      round_summaries: roundSummaries,
      candidate_snapshots: candidateSnapshots,
      // Una ronda ya registrada no tiene nada pendiente: el orquestador borra sus
      // pendientes al registrarla. Conservarlas aquí las resucitaría y haría que
      // un reintento reevaluara organizaciones que ya son candidatos.
      pending_organizations: mergePendingOrganizations(
        base.pending_organizations,
        incoming.pending_organizations,
      ).filter((pending) => !assessedRounds.has(pending.round_number)),
      enrichment_snapshots: enrichmentSnapshots,
      recorded_operation_credits: recordedOperationCredits,
      persisted_candidate_ids: unionSorted(
        base.persisted_candidate_ids,
        incoming.persisted_candidate_ids,
      ),
      // Nunca vuelve a false: los candidatos escritos no se des-escriben.
      candidates_persisted: base.candidates_persisted || incoming.candidates_persisted,
      observed_rejection_reasons: unionSorted(
        base.observed_rejection_reasons,
        incoming.observed_rejection_reasons,
      ) as ApolloTwoRoundCheckpointV1['observed_rejection_reasons'],
      second_round_skipped_reason:
        base.second_round_skipped_reason ?? incoming.second_round_skipped_reason,
      totals: {
        raw_results: Math.max(base.totals.raw_results, incoming.totals.raw_results),
        search_credits: Math.max(base.totals.search_credits, incoming.totals.search_credits),
        enrichment_credits: Math.max(
          base.totals.enrichment_credits,
          incoming.totals.enrichment_credits,
        ),
        enrichments_executed: Math.max(
          base.totals.enrichments_executed,
          incoming.totals.enrichments_executed,
        ),
      },
      spend_accounting: {
        estimated_credits: Math.max(
          base.spend_accounting.estimated_credits,
          incoming.spend_accounting.estimated_credits,
        ),
        reserved_credits: Math.max(
          base.spend_accounting.reserved_credits,
          incoming.spend_accounting.reserved_credits,
        ),
        // Deduplicado por operación: el mismo gasto no se suma dos veces. El
        // máximo contra los escalares previos evita que una fusión ESCONDA gasto
        // que un checkpoint anterior ya había declarado.
        recorded_usage_credits: Math.max(
          recordedUsageCredits,
          base.spend_accounting.recorded_usage_credits,
          incoming.spend_accounting.recorded_usage_credits,
        ),
        confirmed_provider_credits:
          base.spend_accounting.confirmed_provider_credits ??
          incoming.spend_accounting.confirmed_provider_credits,
      },
      checkpoint_write_failures: unionSorted(
        base.checkpoint_write_failures,
        incoming.checkpoint_write_failures,
      ),
      manual_reconciliation_required:
        base.manual_reconciliation_required ||
        incoming.manual_reconciliation_required ||
        indeterminate.length > 0,
      compacted: base.compacted || incoming.compacted,
    },
  };
}

/**
 * Créditos registrados de un conjunto ya deduplicado.
 *
 * Suma lo que el ledger interno registró, incluidas las operaciones cuyo cobro
 * quedó sin confirmar: descontarlas escondería un gasto que pudo ocurrir. Lo que
 * marca ese caso es `billing_unknown` (y, a nivel de corrida,
 * `manual_reconciliation_required`), no un total recortado.
 */
export function sumRecordedOperationCredits(
  entries: readonly ApolloTwoRoundRecordedOperationCredit[],
): number {
  return entries.reduce((total, entry) => total + entry.credits, 0);
}

/** True cuando alguna operación del conjunto dejó su cobro sin confirmar. */
export function hasUnknownOperationBilling(
  entries: readonly ApolloTwoRoundRecordedOperationCredit[],
): boolean {
  return entries.some((entry) => entry.billing_unknown);
}

function refuseIncompatible(
  base: ApolloTwoRoundCheckpointV1,
  incoming: ApolloTwoRoundCheckpointV1,
): ApolloTwoRoundCheckpointMergeRefusal | null {
  if (
    base.version !== APOLLO_TWO_ROUND_CHECKPOINT_CONTRACT_VERSION ||
    incoming.version !== APOLLO_TWO_ROUND_CHECKPOINT_CONTRACT_VERSION
  ) {
    return 'contract_version_mismatch';
  }
  if (base.idempotency_key !== incoming.idempotency_key) return 'idempotency_key_mismatch';
  if (base.request_fingerprint !== incoming.request_fingerprint) {
    return 'request_fingerprint_mismatch';
  }
  // Un checkpoint legacy sin `wizard_run_id` no bloquea la fusión: su identidad ya
  // quedó probada por la clave de idempotencia y la huella. Dos identificadores
  // PRESENTES y distintos sí son dos corridas, y no se mezclan.
  if (
    base.wizard_run_id !== null &&
    incoming.wizard_run_id !== null &&
    base.wizard_run_id !== incoming.wizard_run_id
  ) {
    return 'wizard_run_id_mismatch';
  }
  if (JSON.stringify(base.config) !== JSON.stringify(incoming.config)) return 'config_mismatch';
  return null;
}

function unionSorted(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

/**
 * Progreso observable de una ronda. Se elige la entrada MÁS avanzada, que es la
 * que no pierde nada: las métricas de una ronda sólo crecen.
 */
function roundProgress(round: ApolloTwoRoundRoundMetrics): readonly number[] {
  return [
    round.internalRecordedCredits,
    round.enrichmentsExecuted,
    round.eligibleAfterEnrichment,
    round.newEligibleCompaniesAdded,
    round.normalizedResults,
    round.rawResultsReturned,
    round.providerRequestCount,
  ];
}

function isStrictlyGreater(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

function mergeRoundSummaries(
  base: readonly ApolloTwoRoundRoundMetrics[],
  incoming: readonly ApolloTwoRoundRoundMetrics[],
): ApolloTwoRoundRoundMetrics[] {
  const byRound = new Map<number, ApolloTwoRoundRoundMetrics>();
  for (const round of base) byRound.set(round.roundNumber, { ...round });
  for (const round of incoming) {
    const existing = byRound.get(round.roundNumber);
    if (existing === undefined) {
      byRound.set(round.roundNumber, { ...round });
      continue;
    }
    // Empate ⇒ gana `base`: el documento durable es el canónico.
    if (isStrictlyGreater(roundProgress(round), roundProgress(existing))) {
      byRound.set(round.roundNumber, { ...round });
    }
  }
  return [...byRound.values()].sort((a, b) => a.roundNumber - b.roundNumber);
}

/**
 * Orden de progreso del enrichment de un candidato.
 *
 * `indeterminate` es el más alto porque es el que MÁS restringe: exige
 * conciliación manual y bloquea todo lo dependiente. Degradarlo a `executed`
 * porque el otro proceso lo vio cerrado sería perder exactamente la señal que
 * detiene el gasto.
 */
const ENRICHMENT_PROGRESS: Record<ApolloTwoRoundEnrichmentStatus, number> = {
  not_attempted: 0,
  no_match: 1,
  executed: 2,
  indeterminate: 3,
};

function mergeCandidateSnapshots(
  base: readonly ApolloTwoRoundCandidateSnapshot[],
  incoming: readonly ApolloTwoRoundCandidateSnapshot[],
): ApolloTwoRoundCandidateSnapshot[] {
  const byKey = new Map<string, ApolloTwoRoundCandidateSnapshot>();
  for (const snapshot of base) byKey.set(snapshot.candidate_key, { ...snapshot });
  for (const snapshot of incoming) {
    const existing = byKey.get(snapshot.candidate_key);
    if (existing === undefined) {
      byKey.set(snapshot.candidate_key, { ...snapshot });
      continue;
    }
    const winner =
      ENRICHMENT_PROGRESS[snapshot.enrichment_status] >
      ENRICHMENT_PROGRESS[existing.enrichment_status]
        ? snapshot
        : existing;
    byKey.set(snapshot.candidate_key, {
      ...winner,
      // La evidencia sobrevive aunque el ganador la hubiera soltado al compactar:
      // sin ella un reintento no puede reconstruir el candidato.
      evidence: winner.evidence ?? existing.evidence ?? snapshot.evidence,
    });
  }
  return [...byKey.values()].sort((a, b) => a.candidate_key.localeCompare(b.candidate_key));
}

function mergeEnrichmentSnapshots(
  base: readonly ApolloTwoRoundEnrichmentSnapshot[],
  incoming: readonly ApolloTwoRoundEnrichmentSnapshot[],
): ApolloTwoRoundEnrichmentSnapshot[] {
  const byOperation = new Map<string, ApolloTwoRoundEnrichmentSnapshot>();
  for (const snapshot of base) byOperation.set(snapshot.operation_id, { ...snapshot });
  for (const snapshot of incoming) {
    const existing = byOperation.get(snapshot.operation_id);
    if (existing === undefined) {
      byOperation.set(snapshot.operation_id, { ...snapshot });
      continue;
    }
    if (ENRICHMENT_PROGRESS[snapshot.status] > ENRICHMENT_PROGRESS[existing.status]) {
      byOperation.set(snapshot.operation_id, { ...snapshot });
    }
  }
  return [...byOperation.values()].sort((a, b) => a.operation_id.localeCompare(b.operation_id));
}

function mergePendingOrganizations(
  base: readonly ApolloTwoRoundPendingOrganizationSnapshot[],
  incoming: readonly ApolloTwoRoundPendingOrganizationSnapshot[],
): ApolloTwoRoundPendingOrganizationSnapshot[] {
  const byKey = new Map<string, ApolloTwoRoundPendingOrganizationSnapshot>();
  for (const pending of [...base, ...incoming]) {
    const key = [
      pending.round_number,
      pending.provider_organization_id ?? '',
      pending.domain ?? '',
      pending.linkedin_url ?? '',
      pending.name ?? '',
      pending.provider_rank,
    ].join('|');
    if (!byKey.has(key)) byKey.set(key, { ...pending });
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, pending]) => pending);
}

/**
 * Unión de créditos por `operation_id`.
 *
 * Dos observaciones de la MISMA operación no suman: una operación se cobró una
 * vez. Cuando difieren gana la más restrictiva —el número mayor, y
 * `billing_unknown` en cuanto uno de los dos lo levante— porque subestimar el
 * gasto es lo que dejaría al guard de presupuesto autorizar una llamada de más.
 */
export function mergeRecordedOperationCredits(
  base: readonly ApolloTwoRoundRecordedOperationCredit[],
  incoming: readonly ApolloTwoRoundRecordedOperationCredit[],
): ApolloTwoRoundRecordedOperationCredit[] {
  const byOperation = new Map<string, ApolloTwoRoundRecordedOperationCredit>();
  for (const entry of base) byOperation.set(entry.operation_id, { ...entry });
  for (const entry of incoming) {
    const existing = byOperation.get(entry.operation_id);
    if (existing === undefined) {
      byOperation.set(entry.operation_id, { ...entry });
      continue;
    }
    byOperation.set(entry.operation_id, {
      ...existing,
      usage_key: existing.usage_key ?? entry.usage_key,
      credits: Math.max(existing.credits, entry.credits),
      billing_unknown: existing.billing_unknown || entry.billing_unknown,
    });
  }
  return [...byOperation.values()].sort((a, b) => a.operation_id.localeCompare(b.operation_id));
}
