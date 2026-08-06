// Agente 2A — Captura COMPLETA de los teléfonos que Lusha ya entregó
// (AGENT2A-PHONE-REVEAL-4O-D)
//
// CONTEXTO. 4O-C hizo esto mismo para el otro proveedor: leer todos los teléfonos
// de una respuesta terminal, normalizarlos, deduplicarlos y persistirlos con sus
// procedencias en vez de guardar uno y tirar el resto. Lusha se quedó fuera de ese
// hito y seguía reduciendo `results[0].phones[]` a `phones[0]`. Este módulo es la
// mitad PURA del cableado de Lusha: convierte la lista que devuelve el cliente en
// la colección canónica que el writer transaccional persistirá.
//
// LÓGICA PURA. Sin red, sin Supabase, sin proveedores, sin env, sin reloj propio
// (todo instante entra como argumento) y sin `console`. Se puede probar offline.
//
// REUTILIZACIÓN, NO COPIA. La normalización, la deduplicación por `dedupe_key`, la
// agregación de tipo/estado, el ranking y la elegibilidad del principal son los de
// `phone-collection-core.ts` (4O-B), invocados tal cual. Este archivo no reescribe
// ni una de esas reglas: solo adapta la forma de Lusha a su contrato de entrada.
// Que las dos capturas compartan ese núcleo es lo que garantiza que un mismo
// número visto por los dos proveedores acabe en UNA fila canónica con DOS
// procedencias, y no en dos filas que nadie relaciona.
//
// ALCANCE. SOLO la respuesta exitosa del fallback de teléfono
// (`/v3/contacts/enrich` con `reveal: ['phones']`), tal como la lee
// `extractAllLushaPhones`. NO toca el search/enrich general de Lusha, que sigue
// prohibido para teléfonos, NI la caché, NI ninguno de los caminos del otro
// proveedor.
//
// PRIVACIDAD. Los números viajan únicamente dentro de `phones` y `legacyBest`, que
// van al writer y jamás a un log. Lo único registrable de aquí son los `counters`,
// que son cifras y una etiqueta de tipo.

import {
  mergeCandidatePhoneInputs,
  normalizeCandidatePhone,
  sortCandidatePhones,
  isCandidatePhoneEligibleForPrimary,
  type CanonicalCandidatePhone,
  type CanonicalCandidatePhoneInput,
  type CandidatePhoneAcquisitionMode,
  type CandidatePhoneProvider,
} from './phone-collection-core';
import type { LushaRevealedPhone } from '@/server/integrations/lusha-phone-fallback-phones';
import type {
  ClassifiedPhone,
  PhoneType,
} from '@/server/agents/contact-enrichment-toolkit/phone-classification';

// ═══════════════════════════════════════════════════════════════════
// 1. Constantes de procedencia
// ═══════════════════════════════════════════════════════════════════

const LUSHA_CAPTURE_PROVIDER: CandidatePhoneProvider = 'lusha';

/**
 * `reveal`, también cuando la pata corre dentro de un waterfall.
 *
 * POR QUÉ NO `waterfall`. El waterfall es la ORQUESTACIÓN que autoriza la pata; lo
 * que Lusha hizo es un reveal pagado, y el ranking de especificidad de 4O-B lo
 * declara así explícitamente: la lista contiene `lusha:reveal` y NO contiene
 * `lusha:waterfall`. Etiquetarlo `waterfall` lo dejaría fuera del ranking, es
 * decir en el último puesto de especificidad, y una observación pagada pasaría a
 * desempatar PEOR que una lectura de caché.
 *
 * La pertenencia al waterfall no se pierde: viaja en `waterfall_run_id`, que es
 * donde se puede unir con la contabilidad. Y por eso la modalidad legacy no
 * necesita un modo propio — es la misma pata Lusha, autorizada por otra puerta, y
 * su corrida ya la distingue por `run_mode`.
 */
const LUSHA_CAPTURE_ACQUISITION_MODE: CandidatePhoneAcquisitionMode = 'reveal';

/**
 * Fase de la operación. `direct_enrich` es el vocabulario que ya usa la metadata
 * del usage-log de este mismo fallback, no un valor nuevo: Lusha resuelve de forma
 * síncrona en una sola llamada directa, así que no tiene las dos fases
 * (llamada / recepción) que sí distingue el reveal asíncrono del otro proveedor.
 */
export const LUSHA_PHONE_CAPTURE_PHASE = 'direct_enrich';

// ═══════════════════════════════════════════════════════════════════
// 2. Contexto de la observación
// ═══════════════════════════════════════════════════════════════════

export interface LushaPhoneCaptureSourceContext {
  /**
   * `phone_reveal_waterfall_runs.id` si la pata corre bajo una corrida (flujo
   * completo o legacy). null en el disparo manual. Id de fila PROPIO de SellUp, no
   * del proveedor: no es PII.
   */
  waterfallRunId: string | null;
  /** `phone_reveal_credit_reservations.id`, si el camino lo conoce. */
  reservationId: string | null;
  /** `provider_usage_logs.id`, si el camino lo conoce. */
  providerUsageLogId: string | null;
  /** ISO-8601 del momento de la observación. Entra como dato. */
  observedAt: string;
}

/**
 * Discriminante PII-FREE de una observación: lo que el proveedor dijo SOBRE el
 * número, nunca el número.
 *
 * Alimenta `source_event_key`, y de ahí sale la propiedad que se busca: el MISMO
 * número repetido en la respuesta con el MISMO tipo colapsa en UNA procedencia
 * (es el mismo dicho dos veces), y el mismo número con tipos DISTINTOS deja DOS
 * procedencias, cada una conservando su `raw_provider_type`.
 *
 * NO incluye la posición en el array. Si la incluyera, Lusha reordenando su
 * respuesta entre dos reintentos produciría procedencias nuevas para
 * observaciones que ya estaban registradas, y «idempotente» duraría lo que dura
 * un reintento. Lusha no entrega ningún id por número que pudiera hacer ese
 * trabajo, así que no se inventa uno.
 */
export function buildLushaObservationDiscriminator(
  phone: Pick<LushaRevealedPhone, 'rawType'>,
): string {
  return `t=${phone.rawType ?? '-'}`;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Observaciones canónicas
// ═══════════════════════════════════════════════════════════════════

/**
 * Adapta la lista del cliente al contrato de entrada de 4O-B.
 *
 * `phoneStatus: 'unknown'` en todas: Lusha NO reporta un estado de verificación
 * por número en esta respuesta. `unknown` es la ausencia de evidencia y no un
 * fallo — decir `valid` afirmaría una verificación que nadie hizo, y decir
 * `invalid` excluiría el número de ser principal por algo que el proveedor no dijo.
 *
 * `countryCode: null`: Lusha no entrega el país DEL NÚMERO aquí, y 4O-B ya
 * establece que el país no participa en la clave. Derivarlo del país del candidato
 * sería afirmar un dato del número que nadie observó.
 */
export function buildLushaCandidatePhoneInputs(
  phones: readonly LushaRevealedPhone[],
  context: LushaPhoneCaptureSourceContext,
): readonly CanonicalCandidatePhoneInput[] {
  return phones.map((phone) => ({
    displayPhone: phone.number,
    sanitizedPhone: phone.number,
    countryCode: null,
    phoneType: phone.phoneType,
    phoneStatus: 'unknown' as const,
    source: {
      provider: LUSHA_CAPTURE_PROVIDER,
      acquisitionMode: LUSHA_CAPTURE_ACQUISITION_MODE,
      phase: LUSHA_PHONE_CAPTURE_PHASE,
      rawProviderType: phone.rawType,
      // Lusha no manda estado por número en esta respuesta. null es el dato.
      rawProviderStatus: null,
      waterfallRunId: context.waterfallRunId,
      reservationId: context.reservationId,
      providerUsageLogId: context.providerUsageLogId,
      observationDiscriminator: buildLushaObservationDiscriminator(phone),
      observedAt: context.observedAt,
    },
  }));
}

// ═══════════════════════════════════════════════════════════════════
// 4. Captura completa
// ═══════════════════════════════════════════════════════════════════

/** Cifras PII-FREE de la captura. Es lo ÚNICO de aquí que puede ir a un log. */
export interface LushaPhoneCaptureCounters {
  /** Teléfonos utilizables leídos de la respuesta. */
  phone_count: number;
  /** Entradas absorbidas por otra al deduplicar: `phone_count` − filas canónicas. */
  duplicate_phone_count: number;
  /** Filas canónicas distintas resultantes. */
  canonical_phone_count: number;
  /** Procedencias distintas resultantes (≤ `phone_count`). */
  source_count: number;
  /** Tipo del principal preferido. Etiqueta de categoría, NUNCA el número. */
  primary_phone_type: PhoneType | null;
}

export interface LushaPhoneCollectionCapture {
  /** Colección canónica lista para el writer. CONTIENE NÚMEROS: nunca se loguea. */
  phones: readonly CanonicalCandidatePhone[];
  /**
   * Claves candidatas a principal, EN ORDEN DE PREFERENCIA y ya filtradas a las
   * elegibles. El writer recorre la lista y promueve la primera que la base no
   * declare tombstone y que además mejore al principal vivo que ya hubiera: así la
   * PREFERENCIA es de este módulo (lógica de negocio) y la ELEGIBILIDAD es de la
   * transacción (estado real de las filas).
   */
  primaryPreference: readonly string[];
  /**
   * El teléfono que el candidato recibiría si ninguna clave preferida resultara
   * electable. Es el mismo que el cliente publica en su escalar, así que el
   * escalar y la cabecera de preferencia no pueden hablar de números distintos.
   * null si la respuesta no trajo ningún teléfono utilizable.
   */
  legacyBest: ClassifiedPhone | null;
  counters: LushaPhoneCaptureCounters;
}

/**
 * Ordena las claves candidatas a principal.
 *
 * CABECERA: si el teléfono que el escalar del cliente publica es ELEGIBLE como
 * principal, va primero. El resto sigue el orden de 4O-B
 * (`sortCandidatePhones`), que es total y no depende del orden del payload.
 *
 * Por qué hace falta la cabecera. El escalar del cliente y el comparador de 4O-B
 * usan el MISMO ranking de tipos, así que coinciden siempre que haya un ganador
 * claro de tipo. Difieren en los empates: el escalar desempata por el texto del
 * número y 4O-B por `dedupe_key` (un hash). Sin la cabecera, un candidato con dos
 * móviles podría acabar con el escalar señalando uno y la colección marcando el
 * otro como principal — exactamente la divergencia «principal MOBILE / escalar
 * DIRECT» que este subsistema existe para impedir, solo que entre dos números del
 * mismo tipo.
 *
 * Cuando el escalar NO es elegible (sin dígitos suficientes para una forma
 * canónica) no puede ser principal: el CHECK `..._primary_requires_live_number` de
 * la migración 109 lo rechazaría. Ahí manda el orden de 4O-B.
 */
function buildLushaPrimaryPreference(
  phones: readonly CanonicalCandidatePhone[],
  legacyBest: ClassifiedPhone | null,
): readonly string[] {
  const eligible = sortCandidatePhones(phones).filter(
    isCandidatePhoneEligibleForPrimary,
  );
  if (eligible.length === 0) return [];

  const legacyKey = legacyBest ? resolveLushaLegacyDedupeKey(legacyBest) : null;
  const keys = eligible.map((phone) => phone.dedupeKey);
  if (!legacyKey || !keys.includes(legacyKey)) return keys;
  return [legacyKey, ...keys.filter((key) => key !== legacyKey)];
}

/**
 * La `dedupe_key` del teléfono que el escalar publica.
 *
 * Se calcula con `normalizeCandidatePhone` y con los MISMOS argumentos que
 * `buildLushaCandidatePhoneInputs` usa para ese número: si divergieran, la clave
 * que se manda a comprobar contra los tombstones no sería la del número que se va
 * a escribir, y la comprobación pasaría mirando otra fila.
 */
export function resolveLushaLegacyDedupeKey(legacy: ClassifiedPhone): string {
  return normalizeCandidatePhone({
    displayPhone: legacy.number,
    sanitizedPhone: legacy.number,
    countryCode: null,
  }).dedupeKey;
}

/**
 * Convierte la respuesta exitosa de Lusha en la colección canónica completa.
 *
 * Lo que garantiza:
 *   * ningún teléfono utilizable de la respuesta se pierde;
 *   * el mismo número en varios formatos ⇒ UNA fila canónica;
 *   * el mismo número repetido con el mismo tipo ⇒ UNA procedencia;
 *   * el mismo número con tipos distintos ⇒ una fila con el mejor tipo y las DOS
 *     procedencias, cada una con su `raw_provider_type` intacto;
 *   * el costo NO se reparte entre números: aquí no hay ni una columna de costo.
 *     Lo que Lusha cobró vive en la reserva, en la corrida y en el usage-log;
 *   * el orden de la respuesta no decide el principal.
 *
 * `legacyBest.source` es `'lusha_reveal'`, el valor que el camino ya escribía en
 * `enrichment_metadata.phone.source` antes de este hito.
 */
export function buildLushaPhoneCollectionCapture(args: {
  /** La lista completa que devolvió el cliente. */
  phones: readonly LushaRevealedPhone[];
  /** El teléfono que el cliente eligió como escalar, ya resuelto por el ranking. */
  primary: LushaRevealedPhone | null;
  context: LushaPhoneCaptureSourceContext;
}): LushaPhoneCollectionCapture {
  const legacyBest: ClassifiedPhone | null = args.primary
    ? {
        number: args.primary.number,
        type: args.primary.phoneType,
        source: 'lusha_reveal',
        raw_type: args.primary.rawType,
      }
    : null;

  const inputs = buildLushaCandidatePhoneInputs(args.phones, args.context);
  const phones = mergeCandidatePhoneInputs(inputs);
  const primaryPreference = buildLushaPrimaryPreference(phones, legacyBest);

  const sourceCount = phones.reduce((total, phone) => total + phone.sources.length, 0);
  const preferredPhone = primaryPreference.length
    ? (phones.find((phone) => phone.dedupeKey === primaryPreference[0]) ?? null)
    : null;

  return {
    phones,
    primaryPreference,
    legacyBest,
    counters: {
      phone_count: inputs.length,
      duplicate_phone_count: inputs.length - phones.length,
      canonical_phone_count: phones.length,
      source_count: sourceCount,
      primary_phone_type: preferredPhone?.phoneType ?? null,
    },
  };
}
