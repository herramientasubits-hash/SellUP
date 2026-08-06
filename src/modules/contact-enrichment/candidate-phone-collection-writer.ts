// Agente 2A — Contrato del writer de la colección de teléfonos del candidato
// (AGENT2A-PHONE-REVEAL-4O-C · ámbito transaccional en 4O-C-R1)
//
// QUÉ ES. El tipo de la dependencia que persiste la colección canónica, más los
// helpers PURos que la acompañan. Existe como módulo propio para que el webhook y
// el recovery compartan UNA sola escritura probada en vez de dos secuencias SQL
// paralelas que se desincronizarían al primer arreglo.
//
// Sin I/O: aquí solo viven tipos y funciones puras. La implementación real
// (Supabase, service role) está en `candidate-phone-collection-persistence.ts`.
//
// ── QUÉ CAMBIÓ EN 4O-C-R1 ──────────────────────────────────────
//
// El writer ya no persiste SOLO la colección: persiste también el estado terminal
// `revealed` del candidato, y lo hace en la MISMA transacción (migración 110). Por
// eso la petición incorpora ahora `terminal`, y por eso el resultado dice si el
// candidato quedó terminalizado — el caller ya no vuelve a escribirlo.
//
// El motivo de meter el parche terminal aquí, en vez de dejar dos escrituras
// ordenadas, es que «ordenadas» solo hace inalcanzable el PEOR estado (escalar con
// teléfono y colección vacía). Seguía siendo alcanzable un estado a medias: parte
// de la colección escrita y ningún estado terminal. Ese estado ya no existe.
//
// PRIVACIDAD. `CandidatePhoneCollectionWriteRequest` lleva números — va al writer,
// nunca a un log. `CandidatePhoneCollectionWriteResult` y
// `describeCandidatePhoneCollectionWrite()` son cifras y banderas: es lo único de
// este subsistema que puede aparecer en `provider_usage_logs`, en `console` o en
// un error. Ni el número, ni el display, ni `dedupe_key` (aunque sea un hash)
// salen jamás por esas vías.

import { normalizeCandidatePhone, type CanonicalCandidatePhone } from './phone-collection-core';
import type {
  ClassifiedPhone,
  PhoneType,
} from '@/server/agents/contact-enrichment-toolkit/phone-classification';

// ── Candidata a principal, con su escalar ya resuelto ──────────

/**
 * Una clave que PODRÍA quedar como principal, acompañada del escalar y del tipo
 * que el candidato tendría si esa clave gana.
 *
 * POR QUÉ VIAJAN JUNTOS. El principal lo elige la base (es la única que sabe qué
 * filas son tombstones), pero el escalar lo calcula la lógica pura. Si se pasaran
 * por separado —una lista de claves y UN escalar— la base podría elegir la
 * segunda clave y el escalar seguiría siendo el de la primera: exactamente la
 * divergencia «principal MOBILE / escalar DIRECT» que este subsistema existe para
 * impedir. Emparejando cada clave con SU escalar, la divergencia deja de ser
 * posible: la base escribe el escalar de la clave que eligió, o ninguno.
 */
export interface CandidatePrimaryPhoneCandidate {
  dedupeKey: string;
  /** Texto que iría a `contact_enrichment_candidates.phone` si esta clave gana. */
  phone: string;
  phoneType: PhoneType;
  rawType: string | null;
}

// ── Parche terminal `revealed` ─────────────────────────────────

/**
 * El estado terminal que la MISMA transacción escribe en el candidato.
 *
 * FORMA CERRADA a propósito. Un `Record<string, unknown>` genérico haría del
 * writer un escritor de columnas arbitrarias; aquí cada campo es un campo que los
 * dos caminos ya escriben hoy, con su misma semántica y sin ninguno nuevo.
 *
 * Los campos específicos de fase son `null` cuando esa fase no los escribe, y
 * `null` significa «no toques la columna», no «ponla a null»: el webhook sella
 * `webhookReceivedAt` y nunca `lastCheckedAt`, el recovery al revés, y sobrescribir
 * el del otro afirmaría una operación que no ocurrió.
 */
export interface CandidateRevealTerminalPatch {
  /** Fase que produjo el resultado. Decide qué fecha de fase se sella. */
  phase: 'webhook' | 'recovery_poll';
  /**
   * Apollo async id que el candidato debe SEGUIR teniendo para que este resultado
   * le pertenezca. El webhook lo pasa (es la columna por la que buscó el
   * candidato); el recovery pasa null porque su id vive en la metadata del
   * usage-log y no en la fila, y allí la guarda es el estado en vuelo.
   */
  expectedRequestId: string | null;
  /**
   * El teléfono que el camino HEREDADO habría escrito, con su tipo. Es el suelo
   * del escalar: si ninguna candidata a principal resulta elegible, esto es lo que
   * se guarda, idéntico a antes de 4O-C.
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
  /** Instante del reveal. Ambas fases lo escriben. */
  revealedAt: string;
  completedAt: string;
  /** Solo el webhook. null ⇒ la columna no se toca. */
  webhookReceivedAt: string | null;
  /** Solo el recovery. null ⇒ la columna no se toca. */
  lastCheckedAt: string | null;
  /** null es un VALOR: Apollo a menudo no reporta cifra. Siempre se escribe. */
  costCredits: number | null;
  costSource: 'reported' | 'unknown';
  /** Solo el recovery lo fija. null ⇒ la columna no se toca. */
  processingBasis: string | null;
  /** Solo se escribe cuando es truthy; nunca fuerza ni sobrescribe con null. */
  apolloPersonId: string | null;
}

// ── Petición ───────────────────────────────────────────────────

export interface CandidatePhoneCollectionWriteRequest {
  candidateId: string;
  /**
   * La colección canónica completa observada en ESTE evento. No es el estado
   * final deseado de la tabla: el writer la funde con lo que ya hubiera, porque
   * un evento posterior no invalida los teléfonos que trajo uno anterior.
   */
  phones: readonly CanonicalCandidatePhone[];
  /**
   * Candidatas a principal EN ORDEN DE PREFERENCIA, ya filtradas a las elegibles
   * por la lógica pura y cada una con su escalar resuelto. El writer promueve la
   * PRIMERA que la base no declare tombstone y no elige por su cuenta: el ranking
   * es una decisión de negocio y no puede vivir en la capa de I/O.
   */
  primaryCandidates: readonly CandidatePrimaryPhoneCandidate[];
  /** ISO-8601 del evento. El writer no lee el reloj. */
  observedAt: string;
  /**
   * Estado terminal `revealed` a aplicar EN LA MISMA TRANSACCIÓN (4O-C-R1). El
   * caller NO vuelve a escribir el candidato: si esto no se aplica, no se aplica
   * nada.
   */
  terminal: CandidateRevealTerminalPatch;
}

// ── Resultado ──────────────────────────────────────────────────

/**
 * Qué hizo realmente la transacción. Vocabulario CERRADO y sin PII.
 *
 *   * `persisted`              — colección, principal y estado terminal escritos.
 *   * `idempotent`             — el MISMO evento ya había cerrado (carrera
 *     perdida contra otra transacción que hizo exactamente este trabajo). El
 *     estado deseado ya está puesto; no se reescribió nada.
 *   * `stale_event`            — el candidato ya está en otro estado terminal, o
 *     ha pasado a otro request id. Este resultado no le pertenece: 0 escrituras.
 *   * `candidate_not_eligible` — la fila del candidato no existe. 0 escrituras.
 *   * `suppressed`             — TODOS los números del evento son tombstones. No
 *     se escribe nada y el candidato NO se terminaliza: el escalar caería al
 *     número heredado, que es uno de esos tombstones, y devolver a la vista un
 *     número suprimido es justo lo que el tombstone impide.
 */
export type CandidatePhoneCollectionWriteStatus =
  | 'persisted'
  | 'idempotent'
  | 'stale_event'
  | 'candidate_not_eligible'
  | 'suppressed';

export interface CandidatePhoneCollectionWriteResult {
  status: CandidatePhoneCollectionWriteStatus;
  /** Filas canónicas creadas por primera vez. */
  inserted_phone_count: number;
  /** Filas canónicas ya existentes que se refrescaron (last_seen_at, tipo, estado). */
  updated_phone_count: number;
  /** Procedencias nuevas añadidas. Las repetidas no cuentan: son idempotentes. */
  inserted_source_count: number;
  /**
   * Números recibidos que NO se persistieron porque su fila ya era un tombstone.
   * Un teléfono suprimido no vuelve por la puerta de atrás de una observación
   * nueva; ese es justo el trabajo del tombstone.
   */
  suppressed_skipped_count: number;
  /**
   * Clave que quedó como principal en la base, o null si ninguna candidata
   * sobrevivió (todas suprimidas, o no había ninguna elegible). El caller usa
   * ESTE valor — no su preferencia — para decidir el escalar, de modo que
   * escalar y colección no puedan discrepar.
   */
  primary_dedupe_key: string | null;
  /** true si la colección acabó con un principal vivo marcado en la base. */
  primary_persisted: boolean;
  /**
   * true si el candidato quedó en `revealed` DENTRO de esta transacción. Cuando es
   * true el caller NO debe volver a escribir el candidato: ya está escrito, y
   * repetirlo solo abriría la ventana que esta transacción cierra.
   */
  candidate_terminalized: boolean;
}

/** Firma de la dependencia inyectada. Debe LANZAR si no puede completar. */
export type PersistCandidatePhoneCollection = (
  request: CandidatePhoneCollectionWriteRequest,
) => Promise<CandidatePhoneCollectionWriteResult>;

// ── Observabilidad PII-free ────────────────────────────────────

/** Forma CERRADA de lo que se puede registrar sobre una escritura de colección. */
export interface CandidatePhoneCollectionLogFields {
  collection_persisted: boolean;
  canonical_phone_count: number;
  source_count: number;
  duplicate_phone_count: number;
  suppressed_skipped_count: number;
  /** true si la colección acabó con un principal vivo. */
  primary_persisted: boolean;
  /**
   * Veredicto CERRADO de la transacción (4O-C-R1). Es lo que hace observable en
   * `provider_usage_logs` la diferencia entre «escrito», «ya estaba» y «no me
   * pertenecía», sin que ninguna de las tres necesite un número para explicarse.
   * Ausente cuando no hubo escritura que describir.
   */
  persistence_status?: CandidatePhoneCollectionWriteStatus;
  /** true si el candidato quedó terminalizado dentro de la misma transacción. */
  candidate_terminalized: boolean;
}

/**
 * Reduce una escritura a cifras registrables. La forma es cerrada a propósito:
 * mientras el log se construya SOLO con esta función, es imposible que un número
 * — o una `dedupe_key`, que es un hash pero sigue derivando del número — se cuele
 * en `provider_usage_logs`.
 */
export function describeCandidatePhoneCollectionWrite(args: {
  result: CandidatePhoneCollectionWriteResult | null;
  duplicatePhoneCount: number;
  canonicalPhoneCount: number;
  sourceCount: number;
}): CandidatePhoneCollectionLogFields {
  return {
    collection_persisted: args.result !== null,
    canonical_phone_count: args.canonicalPhoneCount,
    source_count: args.sourceCount,
    duplicate_phone_count: args.duplicatePhoneCount,
    suppressed_skipped_count: args.result?.suppressed_skipped_count ?? 0,
    primary_persisted: args.result?.primary_persisted ?? false,
    ...(args.result ? { persistence_status: args.result.status } : {}),
    candidate_terminalized: args.result?.candidate_terminalized ?? false,
  };
}

// ── Resolución del escalar a partir del principal persistido ───

/**
 * Elige el texto que va a `contact_enrichment_candidates.phone`.
 *
 * REGLA. Si la base dejó un principal, el escalar es EL DISPLAY de esa fila —
 * nunca su forma normalizada. El display es el número tal como Apollo lo
 * formateó, que es exactamente lo que el camino heredado escribía; la forma
 * normalizada podría ser solo los dígitos, y usarla cambiaría el texto visible
 * de un candidato sin que nadie lo hubiera pedido.
 *
 * FALLBACK. Si no hay principal pero Apollo sí entregó un teléfono, se escribe el
 * del camino heredado, idéntico a hoy. Es el caso degenerado en el que la única
 * fila que había resultó no ser elegible como principal (afirmada inválida, o sin
 * dígitos para una forma canónica): la migración prohíbe marcarla `is_primary`,
 * pero eso no es razón para dejar de guardar un número que ya se pagó y que hoy
 * el producto muestra. La colección queda sin principal, que es la lectura
 * honesta, y el escalar conserva su comportamiento.
 *
 * Nunca devuelve un número distinto del que la colección señala como principal:
 * si hay principal, escalar y principal son el mismo teléfono. Esa es la
 * coherencia que impide el par «principal MOBILE / escalar DIRECT».
 */
export function resolveScalarPhoneFromCollection(args: {
  phones: readonly CanonicalCandidatePhone[];
  primaryDedupeKey: string | null;
  legacyPhone: string | null;
}): string | null {
  if (args.primaryDedupeKey) {
    const primary = args.phones.find(
      (phone) => phone.dedupeKey === args.primaryDedupeKey,
    );
    const display = primary?.displayPhone ?? primary?.normalizedPhone ?? null;
    if (display) return display;
  }
  return args.legacyPhone;
}

/**
 * Resuelve el teléfono que va al candidato: escalar, tipo y `raw_type`.
 *
 * ATAJO DELIBERADO: cuando el principal persistido es el MISMO número que el
 * camino heredado habría escrito —que es el caso en cuanto ese teléfono sea
 * elegible como principal, es decir prácticamente siempre— se devuelve el objeto
 * heredado TAL CUAL. No se recalcula el tipo ni el `raw_type` a partir de la fila
 * canónica aunque se pudiera: recalcularlos podría producir un tipo distinto (la
 * fila AGREGA el mejor tipo de todas las observaciones del número) y este hito no
 * está autorizado a cambiar el dato visible de un candidato. Lo que cambia es lo
 * que se GUARDA DE MÁS, no lo que ya se mostraba.
 *
 * Solo cuando el principal es OTRO número —porque el heredado no era elegible—
 * los valores se derivan de la fila y de su primera procedencia, que es donde el
 * `raw_provider_type` del proveedor quedó intacto.
 */
export function resolvePrimaryPhoneForCandidate(args: {
  phones: readonly CanonicalCandidatePhone[];
  primaryDedupeKey: string | null;
  legacy: ClassifiedPhone;
}): { number: string; type: PhoneType; raw_type: string | null } {
  const scalar = resolveScalarPhoneFromCollection({
    phones: args.phones,
    primaryDedupeKey: args.primaryDedupeKey,
    legacyPhone: args.legacy.number,
  });
  if (scalar === null || scalar === args.legacy.number) {
    return {
      number: args.legacy.number,
      type: args.legacy.type,
      raw_type: args.legacy.raw_type,
    };
  }
  const primary = args.phones.find(
    (phone) => phone.dedupeKey === args.primaryDedupeKey,
  );
  return {
    number: scalar,
    type: primary?.phoneType ?? 'unknown',
    raw_type: primary?.sources[0]?.rawProviderType ?? null,
  };
}

/**
 * Empareja cada clave candidata a principal con el escalar que el candidato
 * tendría si ESA clave gana (AGENT2A-PHONE-REVEAL-4O-C-R1).
 *
 * Es la forma de que la elección del principal pueda ocurrir DENTRO de la
 * transacción —donde se conoce el estado de los tombstones— sin que la lógica de
 * negocio se mude a SQL. Cada entrada se resuelve con la MISMA
 * `resolvePrimaryPhoneForCandidate` que el camino usaba antes, así que el escalar
 * no cambia de regla: solo se calcula para todas las opciones en vez de para una,
 * y la transacción escribe el de la que efectivamente eligió.
 *
 * Nunca devuelve una entrada sin número: una candidata cuyo escalar no se puede
 * resolver no podría ser principal de todas formas.
 */
/**
 * La `dedupe_key` del teléfono que el camino heredado habría escrito.
 *
 * Se calcula con `normalizeCandidatePhone` y con los MISMOS argumentos que usa
 * `buildPrimaryPreference` en la captura: si divergieran, la clave que se manda a
 * comprobar contra los tombstones no sería la del número que se va a escribir, y la
 * comprobación pasaría mirando otra fila.
 */
export function resolveLegacyPhoneDedupeKey(legacy: ClassifiedPhone): string {
  return normalizeCandidatePhone({
    displayPhone: legacy.number,
    sanitizedPhone: legacy.number,
    countryCode: null,
  }).dedupeKey;
}

export function buildCandidatePrimaryPhoneCandidates(args: {
  phones: readonly CanonicalCandidatePhone[];
  primaryPreference: readonly string[];
  legacy: ClassifiedPhone;
}): readonly CandidatePrimaryPhoneCandidate[] {
  return args.primaryPreference.flatMap((dedupeKey) => {
    const resolved = resolvePrimaryPhoneForCandidate({
      phones: args.phones,
      primaryDedupeKey: dedupeKey,
      legacy: args.legacy,
    });
    if (!resolved.number) return [];
    return [
      {
        dedupeKey,
        phone: resolved.number,
        phoneType: resolved.type,
        rawType: resolved.raw_type,
      },
    ];
  });
}
