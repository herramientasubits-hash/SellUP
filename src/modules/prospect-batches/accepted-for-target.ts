/**
 * accepted-for-target.ts — cuántos candidatos cuentan REALMENTE hacia el
 * objetivo que la persona pidió.
 *
 * AGENT1-LOCAL-CUT7-ACCEPTED-FOR-TARGET §§ 1, 4, 5, 6, 7, 9, 10.
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * En la corrida existen siete cantidades emparentadas y NINGUNA es la misma:
 *
 *   descubiertas · persistidas · durables · únicas · visibles · revisables ·
 *   ACEPTADAS HACIA EL OBJETIVO
 *
 * Antes de este corte la última no existía como concepto, así que el wizard
 * usaba la segunda en su lugar: el veredicto de «objetivo alcanzado» se decidía
 * con `persistedCount` gratuito más `candidatesCreated` de pago, es decir con
 * FILAS. Y una fila persistida no es una empresa útil: desde
 * `candidate-completeness-contract.ts` § D un candidato incompleto o ambiguo se
 * guarda a propósito —con `needs_review`— para que alguien lo revise. Contarlo
 * hacia el objetivo declara alcanzada una meta que nadie alcanzó.
 *
 * La ecuación canónica de § 1 vive aquí y sólo aquí:
 *
 *   accepted_for_target_total = accepted_free_for_target + accepted_paid_for_target
 *   0 <= accepted_for_target_total <= requestedTarget
 *   remainingTarget = max(0, requestedTarget - accepted_for_target_total)
 *
 * ── 🔴 NO se inventa una política de calidad (§ 3) ───────────────────────────
 *
 * Este módulo no decide qué candidato es bueno. No sabe de precisión, de
 * identidad fiscal, de dominios ni de duplicados. Recibe de cada mitad la
 * cifra que su PROPIA autoridad —ya existente— resolvió, y se limita a
 * combinarlas con la aritmética del § 6:
 *
 *   · mitad GRATUITA — `ProviderResultDemand`, que a su vez lee el
 *     `residualGap` de `buildPrePaidNoveltyContext`: precisión macro canónica,
 *     dedupe de SellUp y comprobación de HubSpot, ya reajustado a lo REALMENTE
 *     persistido por `withFreeSourcePersistenceOutcome`.
 *   · mitad PAGADA — `complete_valid_candidates` de
 *     `candidate-completeness-contract.ts`, que el writer publica como
 *     `target_count` con el comentario literal «lo único que puede compararse
 *     con el target». Existía desde antes de este corte y el wizard la
 *     ignoraba.
 *
 * Que la mitad gratuita entre como `ProviderResultDemand` no es comodidad: es
 * lo que impide que existan DOS aritméticas del hueco. El número que la ruta de
 * pago recibe para saber cuánto pedir y el número con el que después se juzga
 * si el objetivo se cerró son literalmente el mismo (§ 6).
 *
 * ── 🔴 PERSISTIDO ≠ ACEPTADO, y ninguna fila se borra (§ 10) ─────────────────
 *
 * El resultado lleva las dos familias de cifras a la vez y con nombres
 * distintos. Un candidato durable que no cuenta hacia el objetivo SIGUE
 * existiendo: este módulo no oculta, no borra y no reescribe procedencia. La
 * separación que produce es
 *
 *   UNIVERSO DURABLE   ≠   SUBCONJUNTO ACEPTADO
 *
 * y la primera nunca se recorta para que la segunda cuadre.
 *
 * ── 🔴 Fail-closed: no medir no es cumplir ──────────────────────────────────
 *
 * Una mitad que no midió su aceptación aporta CERO, nunca sus filas. Es la
 * misma postura que `apollo-persisted-candidate-truth.ts` ya sostenía para
 * `complete_valid_candidates === null` («sin medición de completitud el
 * objetivo NO se da por alcanzado»), traída al único sitio donde ahora se
 * decide. Sustituir la ausencia por el total de filas sería exactamente el
 * defecto que este corte cierra, escrito en el camino de degradación.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

import type { ProviderResultDemand } from './prepaid-novelty/provider-result-demand';

// ─── Por qué una mitad no pudo declarar su aceptación ─────────────────────────

/**
 * Códigos estáticos, sin PII. Viajan a telemetría y al resultado de la acción.
 *
 * 🔴 Ninguno significa «cero aceptadas»: significan «no se sabe». El efecto
 * sobre el conteo es el mismo —no suma— pero el motivo tiene que quedar dicho,
 * porque «el writer no midió» y «el writer midió cero» son dos corridas
 * distintas y sólo una es un fallo de instrumentación.
 */
export type AcceptanceUnknownReason =
  /** El contribuyente escribió filas pero no publicó su conteo de completitud. */
  | 'acceptance_not_measured'
  /** El contribuyente no llegó a ejecutarse en esta corrida. */
  | 'contributor_did_not_run';

// ─── Lo que una mitad aporta ──────────────────────────────────────────────────

/**
 * El aporte de UN contribuyente: cuántas filas dejó y cuántas de ellas cuentan.
 *
 * 🔴 Las dos cifras viajan JUNTAS y por campos distintos a propósito. Un tipo
 * que sólo llevara la aceptada dejaría al consumidor reconstruir el universo
 * durable por su cuenta, y un tipo que sólo llevara las filas es el defecto de
 * partida. Que estén juntas es lo que permite comprobar la invariante
 * `aceptadas <= persistidas` en el único sitio donde se combina todo.
 */
export type AcceptedContribution =
  | { measured: true; acceptedForTarget: number; persistedCandidates: number }
  | {
      measured: false;
      reason: AcceptanceUnknownReason;
      /** Las filas SÍ se conocen aunque la aceptación no: § 10, el durable no se pierde. */
      persistedCandidates: number;
    };

/** El contribuyente no corrió: cero filas y cero aceptadas, ambas CONOCIDAS. */
export const CONTRIBUTOR_NOT_RUN: AcceptedContribution = {
  measured: true,
  acceptedForTarget: 0,
  persistedCandidates: 0,
};

/**
 * El aporte de PAGO, derivado de las cifras que el writer ya publica.
 *
 * 🔴 `completeValidCandidates` es la autoridad EXISTENTE
 * (`candidate-completeness-contract.ts` → `target_count`), no una regla nueva.
 * `null`/`undefined` significa «no medido» y produce un aporte SIN medir, que
 * suma cero. Nunca se sustituye por `persistedCandidates`.
 */
export function paidAcceptedContributionFromWriterTruth(input: {
  completeValidCandidates: number | null | undefined;
  persistedCandidates: number;
}): AcceptedContribution {
  const persisted = sanitizeCount(input.persistedCandidates);
  if (input.completeValidCandidates === null || input.completeValidCandidates === undefined) {
    // Un contribuyente que no escribió NADA sí sabe su aceptación: es cero. No
    // hay medición que echar de menos, así que declararlo «no medido» apagaría
    // el objetivo de una corrida que simplemente no encontró empresas.
    if (persisted === 0) return CONTRIBUTOR_NOT_RUN;
    return { measured: false, reason: 'acceptance_not_measured', persistedCandidates: persisted };
  }
  return {
    measured: true,
    acceptedForTarget: sanitizeCount(input.completeValidCandidates),
    persistedCandidates: persisted,
  };
}

// ─── El resultado canónico ────────────────────────────────────────────────────

/**
 * La respuesta ÚNICA a «¿cuántos cuentan hacia el objetivo?» (§ 7).
 *
 * No hay una versión del servidor y otra de la UI, ni una del lado gratuito y
 * otra del de pago: los consumidores reutilizan ESTE tipo. Un mismo hecho con
 * varias formas es cómo dos capas empiezan a discrepar sin que nadie lo note.
 */
export type AcceptedForTargetResult = {
  /** El objetivo del USUARIO. Nunca se reescribe (§ 1). */
  requestedTarget: number;
  acceptedFreeForTarget: number;
  acceptedPaidForTarget: number;
  /** `acceptedFree + acceptedPaid`, acotado por construcción a `requestedTarget`. */
  acceptedForTargetTotal: number;
  /** `max(0, requestedTarget - acceptedForTargetTotal)`. Nunca negativo. */
  remainingTarget: number;
  /** SÓLO `acceptedForTargetTotal >= requestedTarget`. Jamás filas persistidas. */
  targetReached: boolean;
  // ── Universo durable: se reporta, no se recorta (§ 10) ────────────────────
  persistedFreeCandidates: number;
  persistedPaidCandidates: number;
  persistedTotalCandidates: number;
  // ── Trazabilidad de la medición ───────────────────────────────────────────
  freeAcceptanceMeasured: boolean;
  paidAcceptanceMeasured: boolean;
  /** Motivos declarados, en orden libre→pago. Vacío en una corrida medida. */
  acceptanceUnknownReasons: readonly AcceptanceUnknownReason[];
};

function sanitizeCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * Combina las dos mitades con la aritmética del § 6.
 *
 * 🔴 La mitad gratuita entra como `ProviderResultDemand` —la demanda que la
 * ruta de pago YA recibió— y no como un par de números sueltos. Así el hueco
 * con el que se pidió y el hueco con el que se juzga son el mismo objeto, y no
 * puede aparecer una segunda definición que discrepe.
 *
 * Invariantes que se cumplen por CONSTRUCCIÓN, no por comprobación posterior:
 *
 *   aceptadas <= persistidas          — un aceptado es una fila, no una promesa
 *   aceptadas <= objetivo             — nadie acepta más de lo que se pidió
 *   acceptedPaid <= hueco restante    — la mitad de pago no puede sobrellenar
 *   remainingTarget >= 0
 */
export function resolveAcceptedForTarget(input: {
  /** § 6 — el hueco de la mitad gratuita, tal como la ruta de pago lo recibió. */
  demand: ProviderResultDemand;
  /** Filas que la capa gratuita dejó en el lote. Universo durable, no aceptación. */
  freePersistedCandidates: number;
  paid: AcceptedContribution;
}): AcceptedForTargetResult {
  const requestedTarget = sanitizeCount(input.demand.requestedTarget);
  const persistedFree = sanitizeCount(input.freePersistedCandidates);

  // 🔴 Acotado por las FILAS y por el OBJETIVO. La primera cota es la que impide
  // que una aceptación mayor que lo escrito —un estado imposible que sólo puede
  // venir de un error de conteo— fabrique cobertura; la segunda es la invariante
  // de § 14 de la puerta previa al pago, que aquí se vuelve a sostener en vez de
  // darse por buena.
  const acceptedFree = Math.min(
    sanitizeCount(input.demand.acceptedBeforeProvider),
    persistedFree,
    requestedTarget,
  );

  const persistedPaid = sanitizeCount(input.paid.persistedCandidates);
  const remainingAfterFree = Math.max(0, requestedTarget - acceptedFree);
  const acceptedPaid = input.paid.measured
    ? Math.min(
        sanitizeCount(input.paid.acceptedForTarget),
        persistedPaid,
        // § 9 CASO D — la autoridad nunca acepta lógicamente más del hueco que
        // queda, por mucho que el proveedor haya producido de más.
        remainingAfterFree,
      )
    : 0;

  const acceptedTotal = acceptedFree + acceptedPaid;
  const unknownReasons: AcceptanceUnknownReason[] = [];
  if (!input.paid.measured) unknownReasons.push(input.paid.reason);

  return {
    requestedTarget,
    acceptedFreeForTarget: acceptedFree,
    acceptedPaidForTarget: acceptedPaid,
    acceptedForTargetTotal: acceptedTotal,
    remainingTarget: Math.max(0, requestedTarget - acceptedTotal),
    // 🔴 `requestedTarget > 0`: un objetivo de cero no se «alcanza» con cero
    // empresas. Sin esta guarda una corrida degradada a objetivo 0 se anunciaría
    // como cumplida sin haber encontrado nada.
    targetReached: requestedTarget > 0 && acceptedTotal >= requestedTarget,
    persistedFreeCandidates: persistedFree,
    persistedPaidCandidates: persistedPaid,
    persistedTotalCandidates: persistedFree + persistedPaid,
    // La mitad gratuita entra por la demanda, que es una cifra ya resuelta: no
    // hay un caso «sin medir» que declarar por este lado.
    freeAcceptanceMeasured: true,
    paidAcceptanceMeasured: input.paid.measured,
    acceptanceUnknownReasons: unknownReasons,
  };
}

/** Clave del bloque en `metadata`. */
export const ACCEPTED_FOR_TARGET_METADATA_KEY = 'accepted_for_target' as const;

/** Bloque plano y sin PII. snake_case, como el resto de la metadata de corrida. */
export function toAcceptedForTargetMetadata(
  result: AcceptedForTargetResult,
): Record<string, unknown> {
  return {
    requested_target: result.requestedTarget,
    accepted_free_for_target: result.acceptedFreeForTarget,
    accepted_paid_for_target: result.acceptedPaidForTarget,
    accepted_for_target_total: result.acceptedForTargetTotal,
    remaining_target: result.remainingTarget,
    target_reached: result.targetReached,
    persisted_free_candidates: result.persistedFreeCandidates,
    persisted_paid_candidates: result.persistedPaidCandidates,
    persisted_total_candidates: result.persistedTotalCandidates,
    paid_acceptance_measured: result.paidAcceptanceMeasured,
    acceptance_unknown_reasons: [...result.acceptanceUnknownReasons],
  };
}
