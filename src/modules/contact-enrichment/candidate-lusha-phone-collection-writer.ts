// Agente 2A — Contrato del writer TRANSACCIONAL del reveal de Lusha
// (AGENT2A-PHONE-REVEAL-4O-D)
//
// QUÉ ES. El tipo de la dependencia que persiste, EN UNA TRANSACCIÓN, el resultado
// `revealed` de Lusha completo: las filas canónicas de la colección, sus
// procedencias, la designación de un único principal, el escalar visible del
// candidato y su estado terminal. Más los helpers puros que lo acompañan.
//
// Sin I/O: aquí solo viven tipos y funciones puras. La implementación real
// (Supabase, service role, una sola RPC) está en
// `candidate-lusha-phone-collection-persistence.ts`.
//
// ── POR QUÉ UN CONTRATO PROPIO Y NO EL DE 4O-C ─────────────────
//
// Se evaluaron tres opciones:
//
//   A. una RPC específica de Lusha con su propio contrato (ESTA);
//   B. una función interna genérica con dos wrappers;
//   C. ampliar `persist_candidate_apollo_phone_reveal_result` con un parámetro de
//      proveedor.
//
// C queda descartada por dos razones independientes. La primera es de contrato: esa
// función lleva el proveedor EN SU NOMBRE, y hacerla escribir Lusha sin renombrarla
// dejaría el repositorio con una función que miente sobre lo que hace. La segunda es
// que los estados terminales de los dos proveedores NO son el mismo conjunto de
// columnas: el reveal asíncrono sella `phone_reveal_webhook_received_at` /
// `phone_reveal_last_checked_at` y no toca `phone_revealed_by`,
// `phone_reveal_attempt_count` ni `phone_reveal_request_id`; Lusha resuelve de
// forma síncrona y escribe exactamente los otros tres, incluido un
// `phone_reveal_request_id = NULL` que LIMPIA el id del intento anterior. Fundir
// los dos contratos obligaría a que cada mitad admitiera parámetros que su camino
// nunca usa, y una función que acepta columnas que no le corresponden es una
// función más fácil de invocar mal.
//
// B se descarta por proporción: la parte genuinamente común ya está factorizada —
// la lógica pura de 4O-B, y los helpers de emparejamiento clave↔escalar de 4O-C que
// este módulo REUTILIZA tal cual, sin tocarlos. Lo que quedaría por generalizar en
// SQL es la validación y el UPDATE terminal, que es precisamente la parte que
// difiere. Una capa genérica ahí compraría poco y pondría el camino ya probado del
// otro proveedor dentro del radio de cualquier cambio futuro de Lusha.
//
// Consecuencia buscada de A: la migración de este hito NO modifica una sola línea
// de la 110, y los privilegios y las pruebas de las dos funciones son
// independientes.
//
// PRIVACIDAD. `CandidateLushaPhoneCollectionWriteRequest` lleva números — va al
// writer, nunca a un log. `CandidateLushaPhoneCollectionWriteResult` y
// `describeCandidateLushaPhoneCollectionWrite()` son cifras y banderas: es lo único
// de este subsistema que puede aparecer en `provider_usage_logs`, en `console` o en
// un error. Ni el número, ni el display, ni `dedupe_key` (aunque sea un hash) salen
// jamás por esas vías.

import type { CandidatePrimaryPhoneCandidate } from './candidate-phone-collection-writer';
import type { CanonicalCandidatePhone } from './phone-collection-core';
import type { PhoneType } from '@/server/agents/contact-enrichment-toolkit/phone-classification';

// ── Parche terminal `revealed` de Lusha ────────────────────────

/**
 * El estado terminal que la MISMA transacción escribe en el candidato.
 *
 * FORMA CERRADA a propósito. Un `Record<string, unknown>` genérico haría del writer
 * un escritor de columnas arbitrarias; aquí cada campo es un campo que el camino ya
 * escribe hoy, con su misma semántica y sin ninguno nuevo.
 */
export interface CandidateLushaRevealTerminalPatch {
  /**
   * El `phone_reveal_status` que el candidato tenía cuando el core lo cargó y
   * decidió que esta pata le pertenecía.
   *
   * Es el TOKEN DE PERTENENCIA de este resultado, y hace falta porque Lusha no
   * entrega ningún id de seguimiento con el que comparar. La transacción exige, BAJO
   * EL LOCK, que la fila siga en ese estado: si otro escritor la movió en la ventana
   * entre la carga y la escritura, este resultado ya no le pertenece y no se aplica
   * nada. En la práctica vale siempre `no_phone_found`, porque es lo que el gate de
   * elegibilidad exige antes de permitir la pata.
   */
  expectedPhoneRevealStatus: string;
  /**
   * El teléfono que el camino HEREDADO habría escrito, con su tipo. Es el suelo del
   * escalar: si ninguna candidata a principal resulta elegible, esto es lo que se
   * guarda, idéntico a antes de 4O-D.
   */
  legacyPhone: string;
  legacyPhoneType: PhoneType;
  legacyRawType: string | null;
  /**
   * La `dedupe_key` DE ese número heredado.
   *
   * Hace falta porque el fallback solo se puede escribir si el número que hay detrás
   * NO es él mismo un tombstone. Sin esta clave la transacción no puede saberlo, y
   * el único camino que llega al fallback —ninguna candidata elegible— es justo
   * donde un número suprimido volvería al campo visible.
   */
  legacyDedupeKey: string;
  /** Instante del reveal. Se escribe siempre. */
  revealedAt: string;
  completedAt: string;
  /** `internal_users.id` del actor. Id opaco, sin PII. */
  revealedBy: string;
  /**
   * Id de correlación del desenlace, resuelto SIEMPRE por
   * `resolveFinalPhoneRevealRequestId`. Hoy es invariablemente `null` — Lusha
   * resuelve de forma síncrona y no entrega ningún id de seguimiento — y ese `null`
   * se ESCRIBE, no se omite: omitirlo es lo que dejaba en la fila el id del intento
   * anterior junto a `phone_reveal_provider = 'lusha'`.
   */
  requestId: string | null;
  /** null es un VALOR: significa «no reportado», nunca «cero». Siempre se escribe. */
  costCredits: number | null;
  costSource: 'reported' | 'assumed_cap' | 'unknown';
  /** `phone_reveal_attempt_count` ya incrementado por el core. */
  attemptCount: number;
}

// ── Petición ───────────────────────────────────────────────────

export interface CandidateLushaPhoneCollectionWriteRequest {
  candidateId: string;
  /**
   * La colección canónica completa observada en ESTA respuesta. No es el estado
   * final deseado de la tabla: el writer la funde con lo que ya hubiera, porque una
   * respuesta posterior no invalida los teléfonos que trajo una anterior — ni los
   * que trajo el otro proveedor.
   */
  phones: readonly CanonicalCandidatePhone[];
  /**
   * Candidatas a principal EN ORDEN DE PREFERENCIA, ya filtradas a las elegibles por
   * la lógica pura y cada una con su escalar resuelto. El writer promueve la primera
   * que la base no declare tombstone Y que además MEJORE al principal vivo que ya
   * hubiera; no elige por su cuenta.
   */
  primaryCandidates: readonly CandidatePrimaryPhoneCandidate[];
  /** ISO-8601 del evento. El writer no lee el reloj. */
  observedAt: string;
  /** Estado terminal a aplicar EN LA MISMA TRANSACCIÓN. */
  terminal: CandidateLushaRevealTerminalPatch;
}

// ── Resultado ──────────────────────────────────────────────────

/**
 * Qué hizo realmente la transacción. Vocabulario CERRADO y sin PII.
 *
 *   * `persisted`              — colección, principal y estado terminal escritos.
 *   * `idempotent`             — el candidato ya estaba cerrado como `revealed` por
 *     Lusha: otra transacción hizo exactamente este trabajo. El estado deseado ya
 *     está puesto; no se reescribió nada.
 *   * `stale_event`            — el candidato ya no está en el estado que autorizó
 *     esta pata. Este resultado no le pertenece: 0 escrituras.
 *   * `candidate_not_eligible` — la fila del candidato no existe. 0 escrituras.
 *   * `suppressed`             — no queda ninguna candidata electable Y el número
 *     heredado es un tombstone. No se escribe nada y el candidato NO se
 *     terminaliza: el escalar caería al número heredado, que es uno de esos
 *     tombstones, y devolver a la vista un número suprimido es justo lo que el
 *     tombstone impide.
 */
export type CandidateLushaPhoneCollectionWriteStatus =
  | 'persisted'
  | 'idempotent'
  | 'stale_event'
  | 'candidate_not_eligible'
  | 'suppressed';

export interface CandidateLushaPhoneCollectionWriteResult {
  status: CandidateLushaPhoneCollectionWriteStatus;
  /** Filas canónicas creadas por primera vez. */
  inserted_phone_count: number;
  /** Filas canónicas ya existentes que se refrescaron (last_seen_at, tipo, estado). */
  updated_phone_count: number;
  /** Procedencias nuevas añadidas. Las repetidas no cuentan: son idempotentes. */
  inserted_source_count: number;
  /**
   * Números recibidos que NO se persistieron porque su fila ya era un tombstone.
   * Un teléfono suprimido no vuelve por la puerta de atrás de una observación nueva.
   */
  suppressed_skipped_count: number;
  /**
   * Clave que quedó como principal en la base, o null si ninguna sobrevivió. Puede
   * ser una clave QUE NO ESTABA en esta petición: es el caso en el que el principal
   * que ya había era MEJOR que todo lo que trajo Lusha y se conserva.
   */
  primary_dedupe_key: string | null;
  /** true si la colección acabó con un principal vivo marcado en la base. */
  primary_persisted: boolean;
  /**
   * true si el principal que quedó es uno de los teléfonos de ESTA respuesta.
   *
   * Es lo que distingue «Lusha aportó el teléfono visible» de «Lusha aportó
   * teléfonos, pero el que ya estaba sigue siendo mejor». Cuando es false, el
   * escalar y `enrichment_metadata.phone` NO se tocan: siguen describiendo,
   * correctamente, al principal que se conservó.
   */
  candidate_scalar_updated: boolean;
  /** true si el candidato quedó en `revealed` DENTRO de esta transacción. */
  candidate_terminalized: boolean;
}

/** Firma de la dependencia inyectada. Debe LANZAR si no puede completar. */
export type PersistCandidateLushaPhoneCollection = (
  request: CandidateLushaPhoneCollectionWriteRequest,
) => Promise<CandidateLushaPhoneCollectionWriteResult>;

// ── Observabilidad PII-free ────────────────────────────────────

/** Forma CERRADA de lo que se puede registrar sobre una escritura de colección. */
export interface CandidateLushaPhoneCollectionLogFields {
  collection_persisted: boolean;
  canonical_phone_count: number;
  source_count: number;
  duplicate_phone_count: number;
  suppressed_skipped_count: number;
  primary_persisted: boolean;
  /** true si el teléfono visible pasó a ser uno de los de esta respuesta. */
  candidate_scalar_updated: boolean;
  /**
   * Veredicto CERRADO de la transacción. Hace observable en `provider_usage_logs`
   * la diferencia entre «escrito», «ya estaba» y «no me pertenecía», sin que
   * ninguna de las tres necesite un número para explicarse. Ausente cuando no hubo
   * escritura que describir.
   */
  persistence_status?: CandidateLushaPhoneCollectionWriteStatus;
  candidate_terminalized: boolean;
}

/**
 * Reduce una escritura a cifras registrables. La forma es cerrada a propósito:
 * mientras el log se construya SOLO con esta función, es imposible que un número —
 * o una `dedupe_key`, que es un hash pero sigue derivando del número — se cuele en
 * `provider_usage_logs`.
 */
export function describeCandidateLushaPhoneCollectionWrite(args: {
  result: CandidateLushaPhoneCollectionWriteResult | null;
  duplicatePhoneCount: number;
  canonicalPhoneCount: number;
  sourceCount: number;
}): CandidateLushaPhoneCollectionLogFields {
  return {
    collection_persisted: args.result !== null,
    canonical_phone_count: args.canonicalPhoneCount,
    source_count: args.sourceCount,
    duplicate_phone_count: args.duplicatePhoneCount,
    suppressed_skipped_count: args.result?.suppressed_skipped_count ?? 0,
    primary_persisted: args.result?.primary_persisted ?? false,
    candidate_scalar_updated: args.result?.candidate_scalar_updated ?? false,
    ...(args.result ? { persistence_status: args.result.status } : {}),
    candidate_terminalized: args.result?.candidate_terminalized ?? false,
  };
}
