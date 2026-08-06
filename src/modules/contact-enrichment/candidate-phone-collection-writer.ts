// Agente 2A — Contrato del writer de la colección de teléfonos del candidato
// (AGENT2A-PHONE-REVEAL-4O-C)
//
// QUÉ ES. El tipo de la dependencia que persiste la colección canónica, más los
// helpers PURos que la acompañan. Existe como módulo propio para que el webhook y
// el recovery compartan UNA sola escritura probada en vez de dos secuencias SQL
// paralelas que se desincronizarían al primer arreglo.
//
// Sin I/O: aquí solo viven tipos y funciones puras. La implementación real
// (Supabase, service role) está en `candidate-phone-collection-persistence.ts`.
//
// PRIVACIDAD. `CandidatePhoneCollectionWriteRequest` lleva números — va al writer,
// nunca a un log. `CandidatePhoneCollectionWriteResult` y
// `describeCandidatePhoneCollectionWrite()` son cifras y banderas: es lo único de
// este subsistema que puede aparecer en `provider_usage_logs`, en `console` o en
// un error. Ni el número, ni el display, ni `dedupe_key` (aunque sea un hash)
// salen jamás por esas vías.

import type { CanonicalCandidatePhone } from './phone-collection-core';
import type {
  ClassifiedPhone,
  PhoneType,
} from '@/server/agents/contact-enrichment-toolkit/phone-classification';

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
   * Claves candidatas a principal EN ORDEN DE PREFERENCIA, ya filtradas a las
   * elegibles por la lógica pura. El writer promueve la PRIMERA que no esté
   * suprimida en la base y no elige por su cuenta: el ranking es una decisión de
   * negocio y no puede vivir en la capa de I/O.
   */
  primaryPreference: readonly string[];
  /** ISO-8601 del evento. El writer no lee el reloj. */
  observedAt: string;
}

// ── Resultado ──────────────────────────────────────────────────

export interface CandidatePhoneCollectionWriteResult {
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
    primary_persisted: Boolean(args.result?.primary_dedupe_key),
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
