// Agente 2A — «Ver más números»: proyección PURA de los teléfonos YA almacenados
// (AGENT2A-PHONE-REVEAL-4O-G)
//
// QUÉ RESUELVE. Desde 4O-C/4O-D la colección canónica de la migración 109 SÍ
// recibe todos los números que Apollo y Lusha devuelven, pero el drawer sigue
// mostrando exactamente uno: el escalar `contact_enrichment_candidates.phone`.
// Los números adicionales —ya observados, ya pagados, ya persistidos— no tienen
// ninguna superficie donde leerse. Este módulo es la mitad PURA de la que se la da.
//
// ── LO QUE ESTE MÓDULO NO ES ───────────────────────────────────
//
// No es una búsqueda. No hay proveedor, no hay reveal, no hay reserva, no hay
// crédito y no hay escritura en ningún punto de este archivo ni de los que lo
// usan: la única operación de la cadena es un SELECT sobre filas que ya existen.
// «Ver más números» ≠ «Buscar más números»; la segunda no existe todavía y este
// hito deliberadamente no la prepara.
//
// LÓGICA PURA. Sin red, sin Supabase, sin `process.env`, sin reloj propio. La
// única dependencia es `phone-collection-core.ts`, que es igual de puro y que es
// donde ya viven —una sola vez— el predicado de elegibilidad y el orden canónico.
// Reimplementarlos aquí crearía dos definiciones de «teléfono mostrable» que se
// separarían en silencio, así que se REUSAN.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
//
// La proyección que sale de aquí es lo ÚNICO que puede llegar al navegador, y es
// deliberadamente más pobre que la fila: no lleva `dedupe_key`, ni
// `suppressed_at`/`suppression_reason`, ni ids de corrida / reserva / usage-log,
// ni el id del proveedor, ni marcas de tiempo internas. Un test estático fija esa
// lista, porque «no lo mandamos» es una propiedad que se pierde por descuido en
// cuanto alguien añade un campo «que ya que estamos».
//
// El tombstone se OBEDECE, no se muestra: una fila suprimida se descarta antes de
// proyectarse y no aparece enmascarada, ni hasheada, ni como hueco. Para quien
// mira la pantalla, deja de existir.
//
// Ningún valor de retorno de este módulo es un mensaje de error con el número
// dentro: no se construyen mensajes aquí.

import type { PhoneSource, PhoneType } from '@/server/agents/contact-enrichment-toolkit/phone-classification';
import {
  isCandidatePhoneEligibleForPrimary,
  normalizeCandidatePhone,
  sortCandidatePhones,
  type CandidatePhoneAcquisitionMode,
  type CandidatePhoneProvider,
  type CandidatePhoneStatus,
  type CanonicalCandidatePhone,
} from './phone-collection-core';

// ── Filas tal como salen del SELECT ────────────────────────────

/** Fila de `contact_enrichment_candidate_phones`, en el subconjunto que se lee. */
export interface StoredCandidatePhoneRow {
  readonly id: string;
  readonly normalized_phone: string | null;
  readonly display_phone: string | null;
  readonly dedupe_key: string;
  readonly phone_type: string | null;
  readonly phone_status: string | null;
  readonly is_primary: boolean | null;
  readonly last_seen_at: string | null;
  /**
   * Se LEE para poder descartar la fila, y se descarta aquí dentro. Nunca viaja
   * al cliente: la proyección no tiene este campo.
   */
  readonly suppressed_at: string | null;
}

/** Fila de `contact_enrichment_candidate_phone_sources`, subconjunto leído. */
export interface StoredCandidatePhoneSourceRow {
  readonly candidate_phone_id: string;
  readonly provider: string | null;
  readonly acquisition_mode: string | null;
}

// ── Proyección que ve el navegador ─────────────────────────────

/**
 * UN teléfono almacenado, tal como la UI puede mostrarlo.
 *
 * `sources` reutiliza el vocabulario `PhoneSource` que el drawer YA sabe rotular
 * (`PHONE_SOURCE_LABELS`) en vez de publicar un vocabulario nuevo: un mismo hecho
 * —«esto vino de un reveal de Apollo»— no debe tener dos nombres según la
 * pantalla que lo enseñe. Es una LISTA porque el mismo número observado por
 * Apollo y por Lusha es UNA fila con DOS procedencias, y aplanarlo a una sola
 * fuente inventaría una exclusividad que la base no afirma.
 */
export interface StoredCandidatePhoneView {
  /** Id opaco de la fila. Sirve de `key` estable en React; no es PII derivada. */
  readonly id: string;
  /** El número tal como se guardó para mostrar. Nunca se re-normaliza aquí. */
  readonly number: string;
  /** `null` cuando no hay tipo: la UI lo rotula «Tipo desconocido». */
  readonly type: PhoneType | null;
  readonly isPrimary: boolean;
  /** Deduplicada y en orden estable. Vacía si no hay procedencia registrada. */
  readonly sources: readonly PhoneSource[];
}

// ── Vocabularios: fila → `PhoneSource` ─────────────────────────

const PHONE_TYPES: readonly PhoneType[] = [
  'personal_mobile',
  'mobile',
  'direct_dial',
  'work',
  'hq',
  'other',
  'unknown',
];

const PHONE_STATUSES: readonly CandidatePhoneStatus[] = ['valid', 'invalid', 'unknown'];

/**
 * Orden de presentación de las procedencias de UN número. Fijo, para que
 * «Apollo · Lusha» no cambie de orden entre dos renders del mismo dato.
 */
const SOURCE_DISPLAY_ORDER: readonly PhoneSource[] = [
  'apollo_reveal',
  'lusha_reveal',
  'apollo_cache',
  'apollo_search',
  'provider_payload',
  'manual',
  'unknown',
];

/**
 * Traduce `(provider, acquisition_mode)` de la tabla de procedencias al
 * vocabulario `PhoneSource` del drawer.
 *
 * FAIL-SAFE hacia `unknown`: una combinación que este mapa no reconozca se rotula
 * «Fuente desconocida» y NUNCA se asimila a una conocida. Rotular de más es peor
 * que rotular de menos — «Apollo reveal» sobre algo que no lo era es una
 * afirmación falsa sobre de dónde salió un dato personal.
 */
export function resolveStoredPhoneSourceKey(
  provider: string | null,
  acquisitionMode: string | null,
): PhoneSource {
  const mode = typeof acquisitionMode === 'string' ? acquisitionMode.trim() : '';
  switch (typeof provider === 'string' ? provider.trim() : '') {
    case 'apollo':
      if (mode === 'search') return 'apollo_search';
      if (mode === 'cache') return 'apollo_cache';
      // `reveal`, `waterfall` y `manual` son el MISMO hecho para quien lee la
      // pantalla: Apollo reveló este número. El disparo (automático, en cascada o
      // a mano) es contabilidad de la corrida, no procedencia del dato.
      if (mode === 'reveal' || mode === 'waterfall' || mode === 'manual') {
        return 'apollo_reveal';
      }
      return 'unknown';
    case 'apollo_cache':
      // Reutilización de un reveal ya pagado: distinta de `apollo_reveal` a
      // propósito, y esa distinción ya es doctrina del subsistema.
      return 'apollo_cache';
    case 'lusha':
      if (mode === 'reveal' || mode === 'waterfall' || mode === 'manual') {
        return 'lusha_reveal';
      }
      return 'unknown';
    case 'manual':
      return 'manual';
    default:
      return 'unknown';
  }
}

// ── Helpers ────────────────────────────────────────────────────

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPhoneType(value: string | null): PhoneType | null {
  const clean = cleanText(value);
  if (!clean) return null;
  return PHONE_TYPES.includes(clean as PhoneType) ? (clean as PhoneType) : null;
}

/**
 * Estado de la fila. Un valor ausente o no reconocido cae a `unknown` —
 * NO a `invalid`: `unknown` es la ausencia de evidencia y debe seguir siendo
 * distinguible de que un proveedor haya AFIRMADO que el número no sirve.
 */
function asPhoneStatus(value: string | null): CandidatePhoneStatus {
  const clean = cleanText(value);
  if (!clean) return 'unknown';
  return PHONE_STATUSES.includes(clean as CandidatePhoneStatus)
    ? (clean as CandidatePhoneStatus)
    : 'unknown';
}

/**
 * Forma interna: la canónica de `phone-collection-core.ts` MÁS el id de la fila.
 * Se extiende en vez de duplicarse para poder pasar los registros tal cual a
 * `isCandidatePhoneEligibleForPrimary` y a `sortCandidatePhones`, que son las
 * definiciones únicas de «mostrable» y de «en qué orden».
 */
interface StoredPhoneRecord extends CanonicalCandidatePhone {
  readonly id: string;
}

const EPOCH = '1970-01-01T00:00:00.000Z';

function toRecord(
  row: StoredCandidatePhoneRow,
  sources: readonly StoredCandidatePhoneSourceRow[],
): StoredPhoneRecord {
  const lastSeenAt = cleanText(row.last_seen_at) ?? EPOCH;
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    // `keyKind` no se lee de la base (la tabla no lo guarda) y no participa en
    // nada de lo que hace este módulo; se declara para satisfacer la forma.
    keyKind: 'opaque',
    normalizedPhone: cleanText(row.normalized_phone),
    displayPhone: cleanText(row.display_phone),
    extension: null,
    phoneType: asPhoneType(row.phone_type),
    phoneStatus: asPhoneStatus(row.phone_status),
    isPrimary: row.is_primary === true,
    firstSeenAt: lastSeenAt,
    lastSeenAt,
    suppressedAt: cleanText(row.suppressed_at),
    sources: sources.map((source) => ({
      provider: (cleanText(source.provider) ?? 'unknown') as CandidatePhoneProvider,
      acquisitionMode: (cleanText(source.acquisition_mode) ??
        'manual') as CandidatePhoneAcquisitionMode,
      phase: null,
      rawProviderType: null,
      rawProviderStatus: null,
      waterfallRunId: null,
      reservationId: null,
      providerUsageLogId: null,
      sourceEventKey: '',
      observedAt: lastSeenAt,
    })),
  };
}

function projectSources(
  sources: readonly StoredCandidatePhoneSourceRow[],
): readonly PhoneSource[] {
  const keys = new Set<PhoneSource>();
  for (const source of sources) {
    keys.add(resolveStoredPhoneSourceKey(source.provider, source.acquisition_mode));
  }
  return SOURCE_DISPLAY_ORDER.filter((key) => keys.has(key));
}

// ── Construcción de la colección mostrable ─────────────────────

export interface BuildStoredCandidatePhonesInput {
  readonly phones: readonly StoredCandidatePhoneRow[];
  readonly sources: readonly StoredCandidatePhoneSourceRow[];
  /**
   * El escalar que la pantalla YA muestra arriba
   * (`contact_enrichment_candidates.phone`). Se usa SOLO para no volver a
   * listar el mismo número como si fuera adicional. `null` si el candidato no
   * tiene teléfono escalar.
   */
  readonly primaryScalarPhone: string | null;
}

/**
 * Los teléfonos ADICIONALES: los que están almacenados y mostrables y que NO son
 * el que la pantalla ya enseña arriba.
 *
 * Se excluyen dos cosas, por dos razones distintas:
 *
 *   * la fila marcada `is_primary` — es, por definición, la que alimenta el
 *     escalar; y
 *   * cualquier fila cuyo número sea EL MISMO que el escalar aunque no esté
 *     marcada. Esto no es redundante con lo anterior: el escalar y la colección
 *     se escriben en la misma transacción pero son columnas distintas, y una fila
 *     que nunca llegó a elegirse principal puede contener exactamente el número
 *     que ya se ve. Listarlo como «número adicional» sería decirle al operador
 *     que hay algo nuevo cuando no lo hay.
 *
 * La comparación se hace por `dedupe_key` —la clave canónica de «mismo número»
 * que ya usa la migración para deduplicar— y no por igualdad de cadenas, así que
 * `+57 300 123 4567` y `+573001234567` colapsan como deben.
 */
export function selectAdditionalStoredPhones(
  input: BuildStoredCandidatePhonesInput,
): readonly StoredCandidatePhoneView[] {
  const sourcesByPhoneId = new Map<string, StoredCandidatePhoneSourceRow[]>();
  for (const source of input.sources) {
    const bucket = sourcesByPhoneId.get(source.candidate_phone_id);
    if (bucket) bucket.push(source);
    else sourcesByPhoneId.set(source.candidate_phone_id, [source]);
  }

  const scalar = cleanText(input.primaryScalarPhone);
  const scalarDedupeKey = scalar
    ? normalizeCandidatePhone({
        displayPhone: scalar,
        sanitizedPhone: scalar,
        countryCode: null,
      }).dedupeKey
    : null;

  const displayable = input.phones
    .map((row) => toRecord(row, sourcesByPhoneId.get(row.id) ?? []))
    // Misma definición de «mostrable» que la de la migración y la del elector de
    // principal: viva, con número, y no afirmada inválida.
    .filter(isCandidatePhoneEligibleForPrimary);

  const additional = displayable.filter(
    (record) => !record.isPrimary && record.dedupeKey !== scalarDedupeKey,
  );

  // Orden canónico (tipo → estado → especificidad → recencia → clave). Nunca el
  // orden físico con el que la base devolvió las filas.
  return sortCandidatePhones(additional).map((record) => {
    const stored = record as StoredPhoneRecord;
    return {
      id: stored.id,
      // `display_phone` es la forma que el proveedor dio al número; el
      // normalizado es el respaldo cuando no hay display. NO se reformatea y NO
      // se reescribe nada en la base.
      number: stored.displayPhone ?? stored.normalizedPhone ?? '',
      type: stored.phoneType,
      isPrimary: stored.isPrimary,
      sources: projectSources(sourcesByPhoneId.get(stored.id) ?? []),
    };
  });
}

/**
 * Cuántos números adicionales hay. Es lo ÚNICO que necesita el drawer para
 * decidir si el CTA existe, y por eso se calcula por separado: mientras el
 * operador no lo pida, ningún número adicional viaja al navegador.
 */
export function countAdditionalStoredPhones(
  input: BuildStoredCandidatePhonesInput,
): number {
  return selectAdditionalStoredPhones(input).length;
}
