// Agente 2A — «Ver más números» del contacto OFICIAL: proyección PURA
// (AGENT2A-PHONE-REVEAL-4O-H4)
//
// ── QUÉ RESUELVE ───────────────────────────────────────────────
//
// 4O-G le dio al CANDIDATO una superficie donde leer los números que la operación
// ya había comprado y guardado. El contacto oficial no tenía ninguna: la 114 creó
// el par de tablas oficiales, la 116 empezó a poblarlas en la
// aprobación, y la pantalla del contacto seguía enseñando exactamente un escalar.
// Los demás números —ya observados, ya pagados, ya persistidos— no tenían dónde
// leerse. Este módulo es la mitad PURA de la que se la da.
//
// ── LO QUE ESTE MÓDULO NO ES ───────────────────────────────────
//
// No es una búsqueda. No hay proveedor, no hay reveal, no hay reserva, no hay
// crédito y no hay escritura en ningún punto de este archivo ni de los que lo usan:
// la única operación de la cadena es un SELECT sobre filas que ya existen.
// «Ver más números» ≠ «Buscar más números»; la segunda no existe todavía y este
// hito deliberadamente no la prepara.
//
// Tampoco es la aprobación, ni el merge a un contacto existente (H3-B), ni la
// edición manual, ni la RPC de privacidad. No los invoca y no los conoce.
//
// LÓGICA PURA. Sin red, sin Supabase, sin `process.env`, sin reloj propio.
//
// ── LAS TRES DIVERGENCIAS CON 4O-G, Y POR QUÉ ──────────────────
//
// El candidato y el contacto oficial NO son la misma colección con otro nombre. La
// 114 se separa de la 109 en sitios concretos, y cada separación obliga a algo aquí:
//
//   1. LA PROCEDENCIA TAMBIÉN SE PUEDE SUPRIMIR. En la 109 el tombstone es por
//      NÚMERO y ninguna fila de procedencia se toca jamás. La 114 le da a la tabla
//      de procedencias la MISMA tríada de supresión, porque la erasure
//      oficial es POR PROVEEDOR (`SUPPRESSIBLE_CONTACT_PHONE_SOURCES`, 4O-E4):
//      retirar la observación de Apollo y dejar viva la de Lusha. Así que aquí se
//      filtran DOS niveles, no uno: la fila canónica y cada procedencia.
//
//   2. HAY DOS ESCALARES VISIBLES, NO UNO. La pantalla del contacto ya muestra
//      `contacts.phone` Y el escalar heredado de móvil. «Adicional» significa «que
//      no está ya en pantalla», así que la exclusión mira los DOS. Esto es una
//      LECTURA para no mentir en el conteo: no se escribe, ni se promueve, ni se
//      reconcilia nada del escalar heredado — esa convergencia es de H5 y este hito
//      no la toca.
//
//   3. LA IDENTIDAD ES EL CONTACTO. `contact_id`, no `candidate_id`. Es la razón de
//      ser de la 114 y no un detalle de nombres.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
//
// La proyección que sale de aquí es lo ÚNICO que puede llegar al navegador, y es
// deliberadamente más pobre que la fila: no lleva `dedupe_key`, ni
// `suppressed_at`/`suppression_reason`/`suppressed_by`, ni ids de corrida / reserva
// / usage-log, ni `candidate_phone_id`, ni `source_event_key`, ni marcas de tiempo
// internas. Un test estático fija esa lista, porque «no lo mandamos» es una
// propiedad que se pierde por descuido en cuanto alguien añade un campo «que ya que
// estamos».
//
// El tombstone se OBEDECE, no se muestra: una fila suprimida se descarta antes de
// proyectarse y no aparece enmascarada, ni hasheada, ni como hueco. Para quien mira
// la pantalla, deja de existir. Lo mismo vale para una procedencia retirada: no se
// rotula «Apollo (retirado)», simplemente no está.
//
// Ningún valor de retorno de este módulo es un mensaje de error con el número
// dentro: no se construyen mensajes aquí.

import type { PhoneSource, PhoneType } from '@/server/agents/contact-enrichment-toolkit/phone-classification';
import { projectStoredPhoneSources } from './stored-phone-provenance-mapping';
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

/** Fila de la tabla oficial de teléfonos, en el subconjunto que se lee. */
export interface StoredOfficialPhoneRow {
  readonly id: string;
  readonly normalized_phone: string | null;
  readonly display_phone: string | null;
  readonly dedupe_key: string;
  readonly phone_type: string | null;
  readonly phone_status: string | null;
  readonly is_primary: boolean | null;
  readonly last_seen_at: string | null;
  /**
   * Se LEE para poder descartar la fila, y se descarta aquí dentro. Nunca viaja al
   * cliente: la proyección no tiene este campo.
   */
  readonly suppressed_at: string | null;
}

/**
 * Fila de la tabla oficial de procedencias, subconjunto leído.
 *
 * `suppressed_at` NO existe en el equivalente del candidato. Aquí sí, y es
 * load-bearing: es lo que permite que una erasure por proveedor retire UNA
 * observación sin destruirla y sin tumbar el número que otro proveedor sigue
 * justificando.
 */
export interface StoredOfficialPhoneSourceRow {
  readonly contact_phone_id: string;
  readonly provider: string | null;
  readonly acquisition_mode: string | null;
  readonly suppressed_at: string | null;
}

// ── Proyección que ve el navegador ─────────────────────────────

/**
 * UN teléfono oficial almacenado, tal como la UI puede mostrarlo.
 *
 * Es la MISMA forma que la del candidato (4O-G) a propósito: un mismo hecho —«este
 * número vino de un reveal de Apollo»— no debe tener dos vocabularios según la
 * pantalla que lo enseñe, y `sources` reutiliza el `PhoneSource` que el drawer YA
 * sabe rotular con `PHONE_SOURCE_LABELS`.
 *
 * `sources` es una LISTA porque el mismo número observado por Apollo y por Lusha es
 * UNA fila canónica con DOS procedencias —exactamente el caso que la 114 existe
 * para representar— y aplanarlo a una sola fuente inventaría una exclusividad que
 * la base no afirma.
 */
export interface StoredOfficialPhoneView {
  /** Id opaco de la fila. Sirve de `key` estable en React; no es PII derivada. */
  readonly id: string;
  /** El número tal como se guardó para mostrar. Nunca se re-normaliza aquí. */
  readonly number: string;
  /** `null` cuando no hay tipo: la UI lo rotula «Tipo desconocido». */
  readonly type: PhoneType | null;
  readonly isPrimary: boolean;
  /** Deduplicada y en orden estable. Vacía si no queda procedencia VIVA. */
  readonly sources: readonly PhoneSource[];
}

// ── Vocabularios ───────────────────────────────────────────────

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
 * Estado de la fila. Un valor ausente o no reconocido cae a `unknown` — NO a
 * `invalid`: `unknown` es la ausencia de evidencia y debe seguir siendo
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
 *
 * Se extiende en vez de duplicarse para poder pasar los registros tal cual a
 * `isCandidatePhoneEligibleForPrimary` y a `sortCandidatePhones`, que son las
 * definiciones únicas de «mostrable» y de «en qué orden» en todo el subsistema. El
 * prefijo `Candidate…` de esos helpers es histórico: la 114 hereda el MISMO
 * vocabulario de tipo y estado que la 109, así que el predicado y el orden valen
 * literalmente igual sobre las dos colecciones. Reimplementarlos aquí crearía dos
 * definiciones de «teléfono mostrable» que se separarían en silencio.
 */
interface StoredOfficialPhoneRecord extends CanonicalCandidatePhone {
  readonly id: string;
}

const EPOCH = '1970-01-01T00:00:00.000Z';

function toRecord(
  row: StoredOfficialPhoneRow,
  liveSources: readonly StoredOfficialPhoneSourceRow[],
): StoredOfficialPhoneRecord {
  const lastSeenAt = cleanText(row.last_seen_at) ?? EPOCH;
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    // `keyKind` no se lee de la base (la tabla no lo guarda) y no participa en nada
    // de lo que hace este módulo; se declara para satisfacer la forma.
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
    sources: liveSources.map((source) => ({
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

/**
 * Una procedencia RETIRADA no cuenta como procedencia.
 *
 * La 114 modela la retirada como tombstone y no como DELETE precisamente para
 * conservar la evidencia de que la observación ocurrió y de qué operación la pagó.
 * Esa evidencia es para una auditoría, no para la pantalla: mostrarla aquí —aunque
 * fuera rotulada «retirada»— reintroduciría en la UI justo el vínculo
 * proveedor↔persona que la erasure acaba de romper.
 */
function isLiveSource(row: StoredOfficialPhoneSourceRow): boolean {
  return cleanText(row.suppressed_at) === null;
}

// ── Construcción de la colección mostrable ─────────────────────

export interface BuildStoredOfficialPhonesInput {
  readonly phones: readonly StoredOfficialPhoneRow[];
  readonly sources: readonly StoredOfficialPhoneSourceRow[];
  /**
   * Los escalares que la pantalla YA muestra arriba. Se usan SOLO para no volver a
   * listar como «adicional» un número que el operador ya está viendo. Entradas
   * nulas o vacías se ignoran.
   *
   * Es una LISTA aunque hoy la lectura pase UNO —`contacts.phone`— porque la ficha
   * pinta también el escalar heredado de móvil, y el día que H5 haga converger ese
   * escalar bastará con añadirlo aquí. Que el conjunto sea plural en el tipo evita
   * que «lo que ya está en pantalla» tenga que dejar de ser un conjunto para poder
   * crecer. Ver la lectura para por qué hoy el móvil NO se consulta.
   */
  readonly visibleScalarPhones: readonly (string | null | undefined)[];
}

/**
 * Los teléfonos ADICIONALES: los que están almacenados y mostrables y que NO son
 * ninguno de los que la pantalla ya enseña arriba.
 *
 * Se excluyen dos cosas, por dos razones distintas:
 *
 *   * la fila marcada `is_primary` — es, por definición, la que alimenta el
 *     escalar principal; y
 *   * cualquier fila cuyo número sea EL MISMO que un escalar visible aunque no esté
 *     marcada. Esto no es redundante con lo anterior: los escalares y la colección
 *     son columnas distintas, y una fila que nunca llegó a elegirse principal puede
 *     contener exactamente el número que ya se ve. Listarlo como «número adicional»
 *     sería decirle al operador que hay algo nuevo cuando no lo hay.
 *
 * La comparación se hace por `dedupe_key` —la clave canónica de «mismo número» que
 * ya usa la 114 para deduplicar— y no por igualdad de cadenas, así que
 * `+57 300 123 4567` y `+573001234567` colapsan como deben.
 */
export function selectAdditionalStoredOfficialPhones(
  input: BuildStoredOfficialPhonesInput,
): readonly StoredOfficialPhoneView[] {
  // Sólo procedencias VIVAS entran siquiera al índice: una retirada no debe poder
  // rotular nada aguas abajo.
  const sourcesByPhoneId = new Map<string, StoredOfficialPhoneSourceRow[]>();
  for (const source of input.sources) {
    if (!isLiveSource(source)) continue;
    const bucket = sourcesByPhoneId.get(source.contact_phone_id);
    if (bucket) bucket.push(source);
    else sourcesByPhoneId.set(source.contact_phone_id, [source]);
  }

  const scalarDedupeKeys = new Set<string>();
  for (const scalar of input.visibleScalarPhones) {
    const clean = cleanText(scalar);
    if (!clean) continue;
    scalarDedupeKeys.add(
      normalizeCandidatePhone({
        displayPhone: clean,
        sanitizedPhone: clean,
        countryCode: null,
      }).dedupeKey,
    );
  }

  const displayable = input.phones
    .map((row) => toRecord(row, sourcesByPhoneId.get(row.id) ?? []))
    // Misma definición de «mostrable» que la de la migración y la del elector de
    // principal: viva, con número, y no afirmada inválida.
    .filter(isCandidatePhoneEligibleForPrimary);

  const additional = displayable.filter(
    (record) => !record.isPrimary && !scalarDedupeKeys.has(record.dedupeKey),
  );

  // Orden canónico (tipo → estado → especificidad → recencia → clave). Nunca el
  // orden físico con el que la base devolvió las filas.
  return sortCandidatePhones(additional).map((record) => {
    const stored = record as StoredOfficialPhoneRecord;
    return {
      id: stored.id,
      // `display_phone` es la forma que el proveedor dio al número; el normalizado
      // es el respaldo cuando no hay display. NO se reformatea y NO se reescribe
      // nada en la base.
      number: stored.displayPhone ?? stored.normalizedPhone ?? '',
      type: stored.phoneType,
      isPrimary: stored.isPrimary,
      sources: projectStoredPhoneSources(sourcesByPhoneId.get(stored.id) ?? []),
    };
  });
}

/**
 * Cuántos números adicionales hay. Es lo ÚNICO que necesita la ficha para decidir
 * si el CTA existe, y por eso se calcula por separado: mientras el operador no lo
 * pida, ningún número adicional viaja al navegador.
 */
export function countAdditionalStoredOfficialPhones(
  input: BuildStoredOfficialPhonesInput,
): number {
  return selectAdditionalStoredOfficialPhones(input).length;
}
