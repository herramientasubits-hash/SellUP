// Agente 2A — Captura COMPLETA de los teléfonos que Apollo ya entregó
// (AGENT2A-PHONE-REVEAL-4O-C)
//
// CONTEXTO. La auditoría 4O-A demostró que un solo callback de Apollo puede traer
// VARIOS teléfonos, y que SellUp los concatenaba, elegía uno con
// `pickBestApolloPhone()` y tiraba el resto. Los números descartados ya estaban
// pagados: perderlos al escribir significa volver a pagar para recuperarlos.
// 4O-B creó el modelo canónico (migración 109 + phone-collection-core.ts) pero no
// cableó nada. Este módulo es la mitad PURA del cableado: convierte un payload de
// Apollo en la colección canónica que el writer persistirá.
//
// LÓGICA PURA. Sin red, sin Supabase, sin proveedores, sin env, sin reloj propio
// (todo instante entra como argumento) y sin `console`. Se puede probar offline.
//
// ALCANCE. SOLO los payloads terminales de WEBHOOK y RECOVERY. No toca el search
// / discovery de Apollo, no toca la caché, no toca Lusha. Esas tres rutas también
// devuelven teléfonos y también los pierden, pero capturarlas no está autorizado
// en este hito y por eso este módulo no expone ninguna entrada para ellas.
//
// PRIVACIDAD. Nada de lo que este módulo DEVUELVE PARA REGISTRAR contiene el
// número: los conteos de `ApolloPhoneCollectionCapture` son cifras, y los números
// viajan únicamente dentro de `phones`, que va al writer y jamás a un log. La
// firma estructural de § 2 sí deriva del número, pero es interna, vive en memoria
// durante una llamada y nunca se persiste ni se retorna.

import {
  pickBestApolloPhone,
  mapApolloPhoneTypeToPhoneType,
  type ApolloPhoneNumber,
  type ClassifiedPhone,
  type PhoneType,
} from '@/server/agents/contact-enrichment-toolkit/phone-classification';
import {
  mergeCandidatePhoneInputs,
  normalizeCandidatePhone,
  sortCandidatePhones,
  isCandidatePhoneEligibleForPrimary,
  type CanonicalCandidatePhone,
  type CanonicalCandidatePhoneInput,
  type CandidatePhoneAcquisitionMode,
  type CandidatePhoneProvider,
  type CandidatePhoneStatus,
} from './phone-collection-core';
import type {
  ApolloPhoneRevealWebhookPayload,
  ApolloWebhookPhoneNumber,
} from './phone-reveal-webhook-core';

// ═══════════════════════════════════════════════════════════════════
// 1. Recolección con UBICACIÓN
// ═══════════════════════════════════════════════════════════════════

/**
 * Las TRES ubicaciones en las que Apollo puede colocar el mismo array. No es una
 * lista de sitios donde hay cosas distintas: la auditoría confirmó que el mismo
 * objeto aparece repetido, y distinguir la ubicación es justo lo que permite
 * reconocer esa repetición en vez de contarla dos veces.
 */
export type ApolloPhonePayloadLocation = 'root' | 'person' | 'people';

export const APOLLO_PHONE_PAYLOAD_LOCATIONS: readonly ApolloPhonePayloadLocation[] =
  ['root', 'person', 'people'];

/** Una entrada del payload junto con dónde estaba. */
export interface LocatedApolloPhoneEntry {
  entry: ApolloWebhookPhoneNumber;
  location: ApolloPhonePayloadLocation;
  /** Posición dentro de su propia ubicación. Solo para orden estable. */
  index: number;
}

function isPhoneEntryArray(value: unknown): value is ApolloWebhookPhoneNumber[] {
  return Array.isArray(value);
}

/**
 * Reúne TODOS los teléfonos del payload conservando su ubicación.
 *
 * Es el gemelo con procedencia de `collectWebhookPhoneNumbers()`, que sigue
 * existiendo sin cambios porque su salida plana es lo que
 * `pickBestApolloPhone()` necesita y lo que la contabilidad heredada consume. Se
 * mantiene el MISMO orden de recorrido (raíz → person → people) para que el
 * teléfono elegido por el camino heredado no dependa de cuál de las dos
 * funciones lo recolectó.
 */
export function collectLocatedApolloPhoneNumbers(
  payload: ApolloPhoneRevealWebhookPayload | null,
): readonly LocatedApolloPhoneEntry[] {
  if (!payload) return [];
  const out: LocatedApolloPhoneEntry[] = [];

  if (isPhoneEntryArray(payload.phone_numbers)) {
    payload.phone_numbers.forEach((entry, index) => {
      out.push({ entry, location: 'root', index });
    });
  }
  if (isPhoneEntryArray(payload.person?.phone_numbers)) {
    payload.person!.phone_numbers!.forEach((entry, index) => {
      out.push({ entry, location: 'person', index });
    });
  }
  if (Array.isArray(payload.people)) {
    // `people[]` es UNA ubicación aunque tenga varias personas: el reveal es de
    // una sola persona, así que sus arrays son variantes del mismo resultado.
    let index = 0;
    for (const person of payload.people) {
      if (!isPhoneEntryArray(person?.phone_numbers)) continue;
      for (const entry of person.phone_numbers) {
        out.push({ entry, location: 'people', index });
        index += 1;
      }
    }
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 2. Firma estructural de una entrada
// ═══════════════════════════════════════════════════════════════════

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function creditsOf(entry: ApolloWebhookPhoneNumber): number | null {
  const value = entry.credits_consumed;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Firma ESTRUCTURAL de una entrada: todos sus campos observables, en orden fijo.
 *
 * Dos entradas con la misma firma son el mismo objeto serializado dos veces.
 * Dos entradas que difieran en CUALQUIER campo — número distinto, o el mismo
 * número con otro tipo, otro estado u otro cargo — son entradas distintas.
 *
 * INTERNA Y EFÍMERA: incluye el número, así que no se registra, no se persiste y
 * no se devuelve. Existe solo para comparar entradas dentro de una llamada.
 */
function apolloPhoneEntrySignature(entry: ApolloWebhookPhoneNumber): string {
  const credits = creditsOf(entry);
  return JSON.stringify([
    cleanText(entry.raw_number),
    cleanText(entry.sanitized_number),
    cleanText(entry.status_cd),
    cleanText(entry.type_cd),
    credits,
  ]);
}

/**
 * Discriminante PII-FREE de una observación: lo que el proveedor dijo SOBRE el
 * número, nunca el número. Alimenta `source_event_key` (ver
 * `buildCandidatePhoneSourceEventKey`), así que dos observaciones del mismo
 * número que difieren en tipo o estado quedan como DOS procedencias, y dos
 * observaciones idénticas quedan como UNA aunque llegaran en ubicaciones
 * distintas.
 *
 * La ubicación NO entra: si Apollo repite el objeto idéntico en la raíz y bajo
 * `person`, eso es una duplicación de serialización, no dos eventos. Meter la
 * ubicación produciría las «tres fuentes idénticas» que el contrato prohíbe.
 */
export function buildApolloObservationDiscriminator(
  entry: ApolloWebhookPhoneNumber,
): string {
  const type = cleanText(entry.type_cd);
  const status = cleanText(entry.status_cd);
  return `t=${type ?? '-'};s=${status ?? '-'}`;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Contabilidad: créditos sin doble conteo estructural
// ═══════════════════════════════════════════════════════════════════

/**
 * Suma los créditos reportados SIN contar dos veces un registro que Apollo
 * duplicó estructuralmente.
 *
 * EL DEFECTO QUE CORRIGE. `sumWebhookCredits()` suma sobre el array ya
 * concatenado, así que un mismo objeto presente en la raíz y bajo `person`
 * aporta su cargo dos veces y el reveal queda contabilizado al doble.
 *
 * LA REGLA, y por qué es esta y no «deduplicar por número»:
 *
 *   * Dentro de UNA ubicación no se deduplica nada. Si `phone_numbers[]` trae dos
 *     elementos, Apollo emitió dos elementos, y no hay base para decidir que uno
 *     sobra — aunque sean idénticos.
 *   * Entre ubicaciones sí. Una firma que aparece en varias ubicaciones se cuenta
 *     tantas veces como su MÁXIMA multiplicidad en una sola ubicación. Así
 *     `root:[A]` + `person:[A]` cuenta 1, y `root:[A,A]` + `person:[A,A]` cuenta 2.
 *
 * Dos números DISTINTOS con 4 créditos cada uno suman 8: sus firmas difieren, así
 * que nada se colapsa. Los créditos NUNCA se reparten entre números — esta
 * función devuelve el total de la operación, y ese total sigue viviendo en la
 * reserva / la corrida / el usage-log, no en la fila de ningún teléfono.
 *
 * LIMITACIÓN DECLARADA. Apollo no entrega un id de línea de cobro. Si cobrara
 * DOS veces por dos registros byte-idénticos emitidos en ubicaciones distintas,
 * esta función contaría uno solo y el total quedaría corto. No hay dato en el
 * payload que permita distinguir ese caso de la duplicación de serialización que
 * sí está confirmada, así que se elige reconocer la duplicación confirmada. El
 * total realmente cobrado sigue siendo reconciliable contra la reserva.
 *
 * `null` cuando NINGUNA entrada reportó créditos: la ausencia de dato no es cero.
 */
export function sumApolloPhoneCreditsAcrossLocations(
  located: readonly LocatedApolloPhoneEntry[],
): number | null {
  // signature → (location → cuántas veces aparece en ESA ubicación)
  const perSignature = new Map<string, Map<ApolloPhonePayloadLocation, number>>();
  // signature → créditos de esa firma (constantes: los créditos son parte de la firma)
  const creditsBySignature = new Map<string, number>();
  let sawCredits = false;

  for (const { entry, location } of located) {
    const signature = apolloPhoneEntrySignature(entry);
    const byLocation = perSignature.get(signature) ?? new Map();
    byLocation.set(location, (byLocation.get(location) ?? 0) + 1);
    perSignature.set(signature, byLocation);

    const credits = creditsOf(entry);
    if (credits !== null) {
      creditsBySignature.set(signature, credits);
      sawCredits = true;
    }
  }

  if (!sawCredits) return null;

  let total = 0;
  for (const [signature, byLocation] of perSignature) {
    const credits = creditsBySignature.get(signature);
    if (credits === undefined) continue;
    const multiplicity = Math.max(...byLocation.values());
    total += credits * multiplicity;
  }
  return total;
}

// ═══════════════════════════════════════════════════════════════════
// 4. Estado del teléfono a partir de `status_cd`
// ═══════════════════════════════════════════════════════════════════

/**
 * Allowlist CERRADA de `status_cd` → estado canónico.
 *
 * Honestidad sobre su procedencia: Apollo no documenta la enumeración completa y
 * el repositorio nunca había consumido este campo (hasta este hito `status_cd`
 * solo estaba declarado en el tipo). La lista recoge las formas cuyo significado
 * es inequívoco; TODO lo demás cae a `unknown`, que es la ausencia de evidencia y
 * NO un fallo.
 *
 * El sesgo es deliberado y va en una sola dirección: es barato equivocarse
 * llamando `unknown` a un número que Apollo consideraba válido (solo pierde un
 * escalón de desempate), y caro equivocarse llamando `invalid` a un número bueno,
 * porque `invalid` lo excluye de ser principal.
 */
const APOLLO_PHONE_STATUS_MAP: Record<string, CandidatePhoneStatus> = {
  valid: 'valid',
  verified: 'valid',
  confirmed: 'valid',
  invalid: 'invalid',
  invalid_number: 'invalid',
  disconnected: 'invalid',
  unreachable: 'invalid',
};

/** Normaliza `status_cd` al vocabulario cerrado. Desconocido/ausente ⇒ `unknown`. */
export function mapApolloPhoneStatus(
  raw: string | null | undefined,
): CandidatePhoneStatus {
  const key = cleanText(raw)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return 'unknown';
  return APOLLO_PHONE_STATUS_MAP[key] ?? 'unknown';
}

// ═══════════════════════════════════════════════════════════════════
// 5. Construcción de la colección canónica
// ═══════════════════════════════════════════════════════════════════

/** Fase de la operación Apollo que produjo estas observaciones. */
export type ApolloPhoneCapturePhase = 'webhook' | 'recovery_poll';

export interface ApolloPhoneCaptureSourceContext {
  phase: ApolloPhoneCapturePhase;
  /**
   * `phone_reveal_waterfall_runs.id` si la pata corre bajo un waterfall. null si
   * no. Id de fila PROPIO de SellUp, no del proveedor: no es PII.
   */
  waterfallRunId: string | null;
  /** `phone_reveal_credit_reservations.id`, si el camino lo conoce. */
  reservationId: string | null;
  /** `provider_usage_logs.id`, si el camino lo conoce. */
  providerUsageLogId: string | null;
  /** ISO-8601 del momento de la observación. Entra como dato. */
  observedAt: string;
}

/** Proveedor y modo de la captura. Fijos en este hito, declarados por claridad. */
const APOLLO_CAPTURE_PROVIDER: CandidatePhoneProvider = 'apollo';
/**
 * `reveal` incluso cuando la pata corre dentro de un waterfall. El waterfall es
 * la ORQUESTACIÓN que autoriza la pata; lo que Apollo hizo sigue siendo un
 * reveal pagado, y así lo dice el ranking de especificidad de 4O-B (`apollo:reveal`
 * es la observación más específica). La pertenencia al waterfall no se pierde: va
 * en `waterfall_run_id`, que es donde se puede unir con la contabilidad.
 */
const APOLLO_CAPTURE_ACQUISITION_MODE: CandidatePhoneAcquisitionMode = 'reveal';

/**
 * El número que este hito considera «el de la entrada»: el saneado por Apollo y,
 * si no lo trae, el crudo. Es EXACTAMENTE la misma preferencia que
 * `webhookPhoneToApolloPhone()` aplica antes de `pickBestApolloPhone()`, y tiene
 * que seguir siéndolo: si divergieran, el escalar y la colección podrían acabar
 * hablando de dos textos distintos para el mismo teléfono.
 */
function entryNumber(entry: ApolloWebhookPhoneNumber): string | null {
  return cleanText(entry.sanitized_number) ?? cleanText(entry.raw_number);
}

/** Adapta una entrada al shape que consume `pickBestApolloPhone`. */
export function apolloEntryToClassifiablePhone(
  entry: ApolloWebhookPhoneNumber,
): ApolloPhoneNumber {
  return { sanitized_number: entryNumber(entry), type: cleanText(entry.type_cd) };
}

/**
 * Convierte las entradas localizadas en observaciones canónicas.
 *
 * Las entradas sin número utilizable se IGNORAN por completo: no producen fila,
 * ni procedencia, ni ruido. Una entrada vacía no es un teléfono descartado, es
 * un hueco del payload, y `normalizeCandidatePhone` las colapsaría todas en una
 * misma clave opaca constante — una fila que no representa nada.
 */
export function buildApolloCandidatePhoneInputs(
  located: readonly LocatedApolloPhoneEntry[],
  context: ApolloPhoneCaptureSourceContext,
): readonly CanonicalCandidatePhoneInput[] {
  const inputs: CanonicalCandidatePhoneInput[] = [];
  for (const { entry } of located) {
    const number = entryNumber(entry);
    if (!number) continue;
    inputs.push({
      displayPhone: number,
      sanitizedPhone: number,
      // Apollo no entrega el país del NÚMERO en el callback, y 4O-B ya establece
      // que el país no participa en la clave. Declararlo null es lo honesto:
      // inventarlo desde el país del candidato sería afirmar un dato del número
      // que nadie observó.
      countryCode: null,
      phoneType: mapApolloPhoneTypeToPhoneType(entry.type_cd),
      phoneStatus: mapApolloPhoneStatus(entry.status_cd),
      source: {
        provider: APOLLO_CAPTURE_PROVIDER,
        acquisitionMode: APOLLO_CAPTURE_ACQUISITION_MODE,
        phase: context.phase,
        rawProviderType: cleanText(entry.type_cd),
        rawProviderStatus: cleanText(entry.status_cd),
        waterfallRunId: context.waterfallRunId,
        reservationId: context.reservationId,
        providerUsageLogId: context.providerUsageLogId,
        observationDiscriminator: buildApolloObservationDiscriminator(entry),
        observedAt: context.observedAt,
      },
    });
  }
  return inputs;
}

// ═══════════════════════════════════════════════════════════════════
// 6. Captura completa
// ═══════════════════════════════════════════════════════════════════

/** Cifras PII-FREE de la captura. Es lo ÚNICO de aquí que puede ir a un log. */
export interface ApolloPhoneCaptureCounters {
  /** Entradas leídas del payload, incluidas duplicadas y vacías. */
  phone_count: number;
  /** Entradas con número utilizable (las que llegan a la colección). */
  valid_phone_count: number;
  /** Entradas absorbidas por otra: `phone_count` − filas canónicas − vacías. */
  duplicate_phone_count: number;
  /** Filas canónicas distintas resultantes. */
  canonical_phone_count: number;
  /** Procedencias distintas resultantes (≤ `valid_phone_count`). */
  source_count: number;
  /** Tipo del principal elegido. Etiqueta de categoría, NUNCA el número. */
  primary_phone_type: PhoneType | null;
}

export interface ApolloPhoneCollectionCapture {
  /** Colección canónica lista para el writer. CONTIENE NÚMEROS: nunca se loguea. */
  phones: readonly CanonicalCandidatePhone[];
  /**
   * Claves candidatas a principal, EN ORDEN DE PREFERENCIA y ya filtradas a las
   * elegibles. El writer recorre la lista y promueve la primera que no esté
   * suprimida: así la elección del principal es de este módulo (lógica) y la
   * comprobación del tombstone es del writer (estado de la base).
   */
  primaryPreference: readonly string[];
  /**
   * El teléfono que el camino HEREDADO habría escrito en el escalar, tal cual.
   * Se conserva para poder demostrar que el escalar no cambia y para tener un
   * fallback exacto cuando ninguna fila es elegible como principal.
   */
  legacyBest: ClassifiedPhone | null;
  /** Total de créditos reportado, sin doble conteo estructural. null si no hay dato. */
  credits: number | null;
  counters: ApolloPhoneCaptureCounters;
}

/**
 * Ordena las claves candidatas a principal.
 *
 * REGLA DE CABECERA — y es la que hace que «sin regresión visible» sea un hecho
 * demostrable y no una esperanza: si el teléfono que el camino heredado habría
 * elegido es ELEGIBLE como principal, va primero. El resto sigue el orden de
 * 4O-B (`sortCandidatePhones`).
 *
 * Por qué hace falta la cabecera. `pickBestApolloPhone` y el comparador de 4O-B
 * usan el MISMO ranking de tipos, así que coinciden siempre que haya un ganador
 * claro. Difieren en los empates: ante dos móviles el heredado conserva el
 * primero del array y 4O-B desempata por `dedupe_key` (un hash), que es
 * determinista pero NO es el orden del payload. Sin la cabecera, un candidato con
 * dos móviles pasaría a guardar el otro móvil — un cambio silencioso del dato
 * visible que este hito no está autorizado a hacer y que no aportaría nada.
 *
 * Cuando el heredado NO es elegible (número afirmado inválido, o sin dígitos
 * suficientes para una forma canónica) NO puede ser principal: el CHECK
 * `..._primary_requires_live_number` de la migración lo rechazaría. Ahí manda el
 * orden de 4O-B, y el resultado es estrictamente mejor que hoy.
 */
function buildPrimaryPreference(
  phones: readonly CanonicalCandidatePhone[],
  legacyBest: ClassifiedPhone | null,
): readonly string[] {
  const eligible = sortCandidatePhones(phones).filter(
    isCandidatePhoneEligibleForPrimary,
  );
  if (eligible.length === 0) return [];

  const legacyKey = legacyBest
    ? normalizeCandidatePhone({
        displayPhone: legacyBest.number,
        sanitizedPhone: legacyBest.number,
        countryCode: null,
      }).dedupeKey
    : null;

  const keys = eligible.map((phone) => phone.dedupeKey);
  if (!legacyKey || !keys.includes(legacyKey)) return keys;
  return [legacyKey, ...keys.filter((key) => key !== legacyKey)];
}

/**
 * Convierte un payload terminal de Apollo en la colección canónica completa.
 *
 * Lo que garantiza:
 *   * ningún teléfono del payload se pierde — las tres ubicaciones se leen;
 *   * el mismo número en varias ubicaciones o en varios formatos ⇒ UNA fila;
 *   * el mismo objeto repetido ⇒ UNA procedencia, no tres;
 *   * el mismo número con tipos distintos ⇒ una fila con el mejor tipo y las DOS
 *     procedencias, cada una con su `raw_provider_type` intacto;
 *   * los créditos NO se reparten entre números y no se cuentan dos veces;
 *   * el orden del payload no decide nada salvo la cabecera de preferencia, que
 *     existe justamente para no cambiar el dato ya visible.
 */
export function buildApolloPhoneCollectionCapture(args: {
  payload: ApolloPhoneRevealWebhookPayload | null;
  context: ApolloPhoneCaptureSourceContext;
}): ApolloPhoneCollectionCapture {
  const located = collectLocatedApolloPhoneNumbers(args.payload);
  const legacyBest = pickBestApolloPhone(
    located.map(({ entry }) => apolloEntryToClassifiablePhone(entry)),
  );
  const credits = sumApolloPhoneCreditsAcrossLocations(located);

  const inputs = buildApolloCandidatePhoneInputs(located, args.context);
  const phones = mergeCandidatePhoneInputs(inputs);
  const primaryPreference = buildPrimaryPreference(phones, legacyBest);

  const sourceCount = phones.reduce((total, phone) => total + phone.sources.length, 0);
  const primaryPhone = primaryPreference.length
    ? (phones.find((phone) => phone.dedupeKey === primaryPreference[0]) ?? null)
    : null;

  return {
    phones,
    primaryPreference,
    legacyBest,
    credits,
    counters: {
      phone_count: located.length,
      valid_phone_count: inputs.length,
      duplicate_phone_count: inputs.length - phones.length,
      canonical_phone_count: phones.length,
      source_count: sourceCount,
      primary_phone_type: primaryPhone?.phoneType ?? null,
    },
  };
}
