/**
 * batch-durable-candidates.ts — ¿el lote YA contiene filas que no se pueden
 * borrar semánticamente porque un contribuyente posterior falle?
 *
 * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-1 (BATCH SURVIVAL) · P0 G2.
 *
 * El defecto que cierra: hoy el estado terminal del lote se calcula SÓLO con el
 * resultado del ÚLTIMO contribuyente. Un lote que ya contiene, por ejemplo, 7
 * candidatos gratuitos durables pasa a `failed` (o a `completed`) porque el
 * escritor de pago insertó 0 o murió. Eso es falso a nivel de LOTE: las 7 filas
 * siguen ahí, y el usuario deja de verlas anunciadas como algo que revisar.
 *
 * La invariante que se defiende:
 *
 *   DATO DURABLE SOBREVIVE AL FALLO DE UN CONTRIBUYENTE.
 *
 * Un contribuyente con 0 filas insertadas o con un error puede añadir telemetría
 * de error, pero no puede hacer desaparecer semánticamente —a nivel de lote— lo
 * que ya estaba persistido.
 *
 * Puro: sin I/O, sin Supabase, sin env, sin React. La sonda real la inyecta
 * cada llamador.
 *
 * ALCANCE: sólo los dos caminos de estado identificados en G2
 * (`resolveBatchStatusForPersistenceOutcome` y `markWizardBatchFailed`). Este
 * módulo NO reescribe la máquina de estados del lote.
 */

// ─── Criterio de fila durable ─────────────────────────────────────────────────

/**
 * Estados de `prospect_candidates.status` que cuentan como CONTENIDO DURABLE del
 * lote. Son exactamente los siete del CHECK de la migración 040.
 *
 * Por qué los siete y no un subconjunto: la tabla NO tiene ninguna columna de
 * borrado —ni `deleted_at`, ni `archived_at`, ni un estado de borrado— así que
 * ninguna fila presente está semánticamente eliminada. Los siete valores son
 * estados del CICLO DE REVISIÓN, no de eliminación: `discarded` y `duplicate`
 * son RESULTADOS de revisión que la ficha del lote sigue mostrando, y borrar el
 * lote entero por haberlos revisado sería otra mentira, no menos.
 *
 * Se enumera de forma EXPLÍCITA y cerrada a propósito: si una migración futura
 * añade un estado que sí signifique «erasado», tiene que decidirse aquí a mano.
 * Un estado desconocido NO cuenta como durable (fail-closed): nunca puede
 * fabricar supervivencia por sí solo.
 *
 * 🔴 Este criterio NO depende de `isUsefulReviewCandidate` ni de ninguna regla de
 * visibilidad de UI. Esa pregunta —«¿esta fila se le enseña al usuario?»— es de
 * otra capa y tiene su propio defecto abierto (CUT-4: el helper oculta
 * candidatos CO sin `tax_identifier`). Aquí se responde una pregunta más baja:
 * «¿esta fila está persistida y no está borrada?». Atar la supervivencia del
 * lote a un filtro de UI roto haría que un defecto de presentación borrase datos
 * reales.
 */
export const DURABLE_PROSPECT_CANDIDATE_STATUSES = [
  'generated',
  'normalized',
  'needs_review',
  'approved',
  'discarded',
  'duplicate',
  'converted_to_account',
] as const;

export type DurableProspectCandidateStatus =
  (typeof DURABLE_PROSPECT_CANDIDATE_STATUSES)[number];

const DURABLE_STATUS_SET: ReadonlySet<string> = new Set(
  DURABLE_PROSPECT_CANDIDATE_STATUSES,
);

/** Fail-closed: un estado que no está en la lista NO acredita contenido durable. */
export function isDurableProspectCandidateStatus(
  status: unknown,
): status is DurableProspectCandidateStatus {
  return typeof status === 'string' && DURABLE_STATUS_SET.has(status);
}

// ─── Conocimiento sobre lo que el lote ya contenía ────────────────────────────

/** Por qué no se pudo saber cuántas filas durables tenía el lote. */
export type DurableCandidateProbeFailure =
  | 'read_failed'
  | 'count_unavailable'
  | 'not_probed';

/**
 * Lo que el llamador SABE sobre las filas durables que el lote ya contenía.
 *
 * `known: false` significa literalmente «no se pudo determinar», y NO se puede
 * convertir en «hay cero» (§ 10). Son dos hechos distintos y el estado terminal
 * que merece cada uno también.
 */
export type DurableCandidateKnowledge =
  | { known: true; count: number }
  | { known: false; reason: DurableCandidateProbeFailure };

export const DURABLE_CANDIDATES_NOT_PROBED: DurableCandidateKnowledge = {
  known: false,
  reason: 'not_probed',
};

/** Un lote recién creado no puede contener nada: cero CONOCIDO, sin leer nada. */
export const NO_PRE_EXISTING_DURABLE_CANDIDATES: DurableCandidateKnowledge = {
  known: true,
  count: 0,
};

/** Conteo saneado: sólo un entero finito no negativo acredita filas. */
function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value > 0 ? Math.floor(value) : 0;
}

export function durableCandidatesFromCount(
  count: unknown,
): DurableCandidateKnowledge {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return { known: false, reason: 'count_unavailable' };
  }
  return { known: true, count: sanitizeCount(count) };
}

// ─── Aritmética honesta (§ 8 — sin doble conteo) ──────────────────────────────

/**
 * Totales del lote. `preExisting` se lee ANTES de que este contribuyente
 * inserte, así que el total es la SUMA. Si alguna vez se leyera DESPUÉS, el
 * total sería la lectura tal cual y sumar otra vez contaría dos veces las mismas
 * filas: por eso el momento de la lectura viaja en el nombre del campo y no en
 * un comentario.
 */
export type BatchDurableTotals = {
  preExistingDurableCandidates: number;
  insertedByThisContributor: number;
  totalDurableCandidates: number;
  preExistingKnown: boolean;
};

export function resolveBatchDurableTotals(input: {
  preExisting: DurableCandidateKnowledge;
  insertedNow: number;
}): BatchDurableTotals {
  const preExisting = input.preExisting.known ? sanitizeCount(input.preExisting.count) : 0;
  const insertedNow = sanitizeCount(input.insertedNow);
  return {
    preExistingDurableCandidates: preExisting,
    insertedByThisContributor: insertedNow,
    totalDurableCandidates: preExisting + insertedNow,
    preExistingKnown: input.preExisting.known,
  };
}

// ─── Decisión de estado terminal ──────────────────────────────────────────────

/** Vocabulario EXISTENTE de `prospect_batches.status`. No se crea ninguno nuevo. */
export type BatchTerminalStatus = 'failed' | 'ready_for_review' | 'completed';

/**
 * `preserve` = NO se escribe estado.
 *
 * § 10 — una lectura imposible no puede fabricar `ready_for_review` (sería
 * inventar contenido) ni escribir `failed` (sería AFIRMAR que hay cero, que es
 * justo la conversión prohibida). No tocar el estado deja el lote como estaba,
 * que es lo único cierto, y el fallo del proveedor se sigue reportando por su
 * canal.
 */
export type BatchStatusDecision =
  | { action: 'write'; status: BatchTerminalStatus }
  | { action: 'preserve'; reason: 'durable_candidate_count_unavailable' };

const PRESERVE: BatchStatusDecision = {
  action: 'preserve',
  reason: 'durable_candidate_count_unavailable',
};

/**
 * Estado terminal del lote tras el paso de un contribuyente que SÍ recorrió el
 * bucle de escritura.
 *
 * Matriz (CUT-1 § 6), con `preExisting` = filas durables que el lote ya tenía:
 *
 *   pre>0, nuevas 0, fallos 0   ⇒ ready_for_review   (antes: completed)
 *   pre>0, nuevas 0, fallos>0   ⇒ ready_for_review   (antes: failed)
 *   pre>0, nuevas>0             ⇒ ready_for_review
 *   pre 0, nuevas>0             ⇒ ready_for_review   (sin cambio)
 *   pre 0, nuevas 0, fallos>0   ⇒ failed             (sin cambio)
 *   pre 0, nuevas 0, fallos 0   ⇒ completed          (sin cambio)
 */
export function resolveBatchTerminalStatusDecision(input: {
  preExisting: DurableCandidateKnowledge;
  persistedCandidates: number;
  persistenceFailureCount: number;
}): BatchStatusDecision {
  const insertedNow = sanitizeCount(input.persistedCandidates);

  // Lo que ESTE contribuyente escribió es verdad propia del llamador y no
  // depende de ninguna lectura: si insertó algo, el lote tiene contenido.
  if (insertedNow > 0) return { action: 'write', status: 'ready_for_review' };

  if (!input.preExisting.known) return PRESERVE;

  if (sanitizeCount(input.preExisting.count) > 0) {
    return { action: 'write', status: 'ready_for_review' };
  }

  return {
    action: 'write',
    status: sanitizeCount(input.persistenceFailureCount) > 0 ? 'failed' : 'completed',
  };
}

/**
 * Estado terminal del lote cuando el proveedor o el pipeline FALLA antes de
 * escribir nada (la segunda mitad de G2: `markWizardBatchFailed`).
 *
 * Aquí el llamador no tiene verdad propia sobre filas: no llegó a escribir. Sólo
 * decide lo que el lote ya contenía.
 *
 *   contiene filas durables  ⇒ ready_for_review  (hay algo real que revisar)
 *   lote vacío               ⇒ failed            (comportamiento previo, intacto)
 *   no se pudo determinar    ⇒ preserve          (§ 10)
 *
 * Idempotente por construcción: la decisión sale del contenido del lote, no de
 * cuántas veces se haya invocado, así que un reintento converge al mismo estado
 * (§ 11) y nunca oscila `ready_for_review` → `failed` (§ 12).
 */
export function resolveBatchFailureStatusDecision(input: {
  durableCandidates: DurableCandidateKnowledge;
}): BatchStatusDecision {
  if (!input.durableCandidates.known) return PRESERVE;
  return sanitizeCount(input.durableCandidates.count) > 0
    ? { action: 'write', status: 'ready_for_review' }
    : { action: 'write', status: 'failed' };
}
