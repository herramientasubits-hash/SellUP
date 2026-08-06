// Agente 2A — Modelo canónico de MÚLTIPLES teléfonos por candidato
// (AGENT2A-PHONE-REVEAL-4O-B)
//
// CONTEXTO. La auditoría 4O-A demostró que Apollo y Lusha pueden devolver VARIOS
// teléfonos para una misma persona, y que SellUp los reduce a UNO antes de
// persistir: los elementos adicionales del array se pierden en el normalizador y
// nunca llegan a la base de datos. Este módulo es la mitad PURA del modelo que
// deja de perderlos. No captura todavía ningún array real: 4O-B construye el
// vocabulario, las claves y las decisiones; el cableado con los proveedores es
// un hito posterior.
//
// LÓGICA PURA. Sin red, sin Supabase, sin proveedores, sin fetch, sin env, sin
// reloj propio (todo instante entra como argumento). La única dependencia es
// `node:crypto` para SHA-256, que es una función determinista sin E/S y ya es el
// precedente del subsistema (`phone-cache-store.ts` hashea el Apollo person id).
//
// PRIVACIDAD — las dos reglas que gobiernan el archivo:
//
//   1. `dedupe_key` NUNCA contiene el número en claro. Es un SHA-256 con un
//      prefijo que declara SOLO la clase de clave. La razón es el tombstone: una
//      fila suprimida debe conservar su clave (es el UNIQUE que impide que el
//      número vuelva a entrar) pero NO debe conservar el número. Con una clave en
//      claro, `normalized_phone = NULL` sería teatro — el número seguiría
//      legible en la columna de al lado. Advertencia honesta y deliberadamente
//      no disimulada: el espacio de los teléfonos es pequeño, así que un SHA-256
//      sin sal es reversible por fuerza bruta para quien ya tenga la fila. El
//      hash NO es un control criptográfico contra un atacante con acceso a la
//      tabla; es lo que impide que el número quede almacenado EN CLARO tras una
//      supresión, que es exactamente la garantía que el tombstone promete.
//
//   2. `source_event_key` no contiene NADA derivado del teléfono. Se construye
//      solo con identificadores operativos opacos (proveedor, modo, fase, ids de
//      corrida/reserva/usage-log). Ver `buildCandidatePhoneSourceEventKey`.
//
// Ningún error, mensaje ni valor de retorno de este módulo incluye el número.

import { createHash } from 'node:crypto';

import type { PhoneType } from '@/server/agents/contact-enrichment-toolkit/phone-classification';

// ── Vocabularios cerrados ──────────────────────────────────────────

/**
 * Estado de un teléfono canónico. Vocabulario MÍNIMO y cerrado: se declaran los
 * tres estados que el código actual puede justificar y ni uno más. `unknown` no
 * es un fallo — es la ausencia de evidencia, y debe ser distinguible de una
 * invalidez afirmada por el proveedor.
 */
export type CandidatePhoneStatus = 'valid' | 'invalid' | 'unknown';

export const CANDIDATE_PHONE_STATUSES: readonly CandidatePhoneStatus[] = [
  'valid',
  'invalid',
  'unknown',
];

/**
 * Proveedor que observó el teléfono. `apollo_cache` es deliberadamente distinto
 * de `apollo`: un número reutilizado de la caché no es una observación nueva ni
 * pagada, y esa distinción ya es doctrina del subsistema (ver
 * `PHONE_CACHE_HIT_PHONE_SOURCE` en `phone-cache-core.ts`).
 */
export type CandidatePhoneProvider =
  | 'apollo'
  | 'lusha'
  | 'apollo_cache'
  | 'manual'
  | 'unknown';

export const CANDIDATE_PHONE_PROVIDERS: readonly CandidatePhoneProvider[] = [
  'apollo',
  'lusha',
  'apollo_cache',
  'manual',
  'unknown',
];

/** Cómo se obtuvo la observación. */
export type CandidatePhoneAcquisitionMode =
  | 'search'
  | 'reveal'
  | 'waterfall'
  | 'cache'
  | 'manual';

export const CANDIDATE_PHONE_ACQUISITION_MODES: readonly CandidatePhoneAcquisitionMode[] =
  ['search', 'reveal', 'waterfall', 'cache', 'manual'];

/**
 * Prioridad de tipo. Reexportada desde el ranking ÚNICO de `phone-classification.ts`
 * en vez de reescribirla: dos listas equivalentes se separan en silencio, y el
 * contrato de este hito es que un móvil válido gane siempre a `work`/`hq`.
 */
export const CANDIDATE_PHONE_TYPE_RANKING: readonly PhoneType[] = [
  'personal_mobile',
  'mobile',
  'direct_dial',
  'work',
  'hq',
  'other',
  'unknown',
];

function phoneTypeRank(type: PhoneType | null): number {
  if (type === null) return CANDIDATE_PHONE_TYPE_RANKING.length;
  const index = CANDIDATE_PHONE_TYPE_RANKING.indexOf(type);
  return index === -1 ? CANDIDATE_PHONE_TYPE_RANKING.length : index;
}

/**
 * Especificidad de la procedencia, usada SOLO como desempate del principal
 * cuando el tipo y el estado ya empataron. Un reveal pagado es la observación
 * más específica; una lectura de caché es un reveal viejo reutilizado; el tipo
 * que viene gratis en el search es el más débil.
 */
const SOURCE_SPECIFICITY_RANKING: readonly string[] = [
  'apollo:reveal',
  'lusha:reveal',
  'apollo_cache:cache',
  'apollo:search',
];

function sourceSpecificityRank(source: CanonicalCandidatePhoneSource): number {
  const index = SOURCE_SPECIFICITY_RANKING.indexOf(
    `${source.provider}:${source.acquisitionMode}`,
  );
  return index === -1 ? SOURCE_SPECIFICITY_RANKING.length : index;
}

// ── Contratos de entrada ───────────────────────────────────────────

/** Procedencia de UNA observación de UN teléfono. */
export interface CandidatePhoneSourceInput {
  provider: CandidatePhoneProvider;
  acquisitionMode: CandidatePhoneAcquisitionMode;
  /**
   * Fase de la operación cuando el proveedor la distingue. Apollo escribe DOS
   * filas en `provider_usage_logs` por reveal (`start` = llamada real,
   * `webhook` = recepción); sin la fase, las dos observaciones colapsarían en
   * una sola procedencia y se perdería la recepción.
   */
  phase: string | null;
  /** Tipo CRUDO del proveedor, tal cual. Nunca se pierde: se guarda por fuente. */
  rawProviderType: string | null;
  /** Estado CRUDO del proveedor, tal cual. */
  rawProviderStatus: string | null;
  waterfallRunId: string | null;
  reservationId: string | null;
  providerUsageLogId: string | null;
  /**
   * Discriminante OPCIONAL de la observación (AGENT2A-PHONE-REVEAL-4O-C).
   *
   * POR QUÉ EXISTE. Un solo evento HTTP puede traer el MISMO número dos veces:
   * Apollo repite el objeto en `phone_numbers[]`, en `person.phone_numbers[]` y
   * en `people[].phone_numbers[]`. Sin discriminante las dos observaciones
   * comparten clave y colapsan en UNA procedencia, que es exactamente lo que se
   * quiere cuando el objeto es idéntico. Pero si el mismo número llega con
   * `type_cd` o `status_cd` DISTINTOS en dos ubicaciones, eso sí son dos
   * observaciones con contenido distinto, y colapsarlas perdería uno de los dos
   * `raw_provider_type` que la tabla de procedencias existe para conservar.
   *
   * Debe construirse SIN PII: solo con lo que el proveedor dice SOBRE el número
   * (tipo y estado crudos), nunca con el número. Ausente ⇒ la clave es
   * byte-idéntica a la de 4O-B, así que ninguna procedencia previa cambia.
   */
  observationDiscriminator?: string | null;
  /** ISO-8601. Entra como dato: este módulo no lee el reloj. */
  observedAt: string;
}

/** Una observación de un teléfono, tal como la entregaría un proveedor. */
export interface CanonicalCandidatePhoneInput {
  /** El número tal como se muestra (formato del proveedor). */
  displayPhone: string | null;
  /** El número ya saneado por el proveedor, si lo entrega. */
  sanitizedPhone: string | null;
  /**
   * País ISO-3166-1 alpha-2 del candidato, si se conoce. Se acepta para
   * trazabilidad pero NO participa en la clave: ver `normalizeCandidatePhone`.
   */
  countryCode: string | null;
  phoneType: PhoneType;
  phoneStatus: CandidatePhoneStatus;
  source: CandidatePhoneSourceInput;
}

// ── Contratos de salida ────────────────────────────────────────────

export interface CanonicalCandidatePhoneSource {
  provider: CandidatePhoneProvider;
  acquisitionMode: CandidatePhoneAcquisitionMode;
  phase: string | null;
  rawProviderType: string | null;
  rawProviderStatus: string | null;
  waterfallRunId: string | null;
  reservationId: string | null;
  providerUsageLogId: string | null;
  sourceEventKey: string;
  observedAt: string;
}

/** Clase de clave de deduplicación. Se expone porque es auditable y PII-free. */
export type CandidatePhoneKeyKind = 'e164' | 'digits' | 'opaque';

export interface NormalizedCandidatePhone {
  /**
   * Forma canónica CONSERVADORA del número, o null si no hay dígitos usables.
   * Es E.164 (`+…`) SOLO cuando `keyKind === 'e164'`; cuando es `'digits'` son
   * los dígitos nacionales tal cual, SIN prefijo inventado. `keyKind` es lo que
   * declara cuál de las dos cosas es, así que guardar el número nunca equivale a
   * AFIRMAR un E.164 que no se pudo verificar.
   */
  normalizedPhone: string | null;
  displayPhone: string | null;
  /** Extensión conservada por separado; forma parte de la clave. */
  extension: string | null;
  dedupeKey: string;
  keyKind: CandidatePhoneKeyKind;
}

export interface CanonicalCandidatePhone {
  dedupeKey: string;
  keyKind: CandidatePhoneKeyKind;
  normalizedPhone: string | null;
  displayPhone: string | null;
  extension: string | null;
  /** null SOLO en un tombstone: la supresión borra también el tipo. */
  phoneType: PhoneType | null;
  phoneStatus: CandidatePhoneStatus;
  isPrimary: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  suppressedAt: string | null;
  sources: readonly CanonicalCandidatePhoneSource[];
}

// ── Helpers puros ──────────────────────────────────────────────────

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Mínimo de dígitos para que una clave basada en el número sea SEGURA. Por
 * debajo de esto (E.164 admite hasta 15 dígitos y el mínimo nacional razonable
 * ronda 7) dos entradas distintas podrían colapsar por casualidad, así que se
 * cae a una clave opaca por entrada.
 */
const MIN_SAFE_DIGITS = 7;
/** Máximo de E.164 (ITU-T E.164). Por encima, el número no es verificable. */
const MAX_E164_DIGITS = 15;
/** Mínimo de E.164 con prefijo de país incluido. */
const MIN_E164_DIGITS = 8;

/**
 * Separa la extensión del número. Se aceptan las formas que los proveedores
 * usan en la práctica (`x123`, `ext 123`, `ext.123`, `#123`, `,123`).
 * Devuelve el resto del texto y la extensión (solo dígitos) por separado.
 */
function splitExtension(raw: string): { base: string; extension: string | null } {
  const match = raw.match(/(?:\s*(?:ext|extn|extension|x)\s*\.?\s*|\s*[#,]\s*)(\d{1,6})\s*$/i);
  if (!match) return { base: raw, extension: null };
  return {
    base: raw.slice(0, match.index).trim(),
    extension: match[1],
  };
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

// ── 1. Normalización conservadora ──────────────────────────────────

/**
 * Normaliza UNA observación de teléfono y calcula su clave de deduplicación.
 *
 * REGLAS, en el orden en que se aplican:
 *
 *   1. E.164 SOLO cuando es verificable — es decir, cuando el texto trae ya el
 *      prefijo internacional: un `+` explícito, o el prefijo de acceso
 *      internacional `00` (que la ITU reserva para eso y con el que ningún
 *      número NACIONAL empieza). Con 8..15 dígitos ⇒ `+<dígitos>`.
 *   2. En cualquier otro caso, clave conservadora sobre los dígitos. NO se
 *      fabrica E.164 y NO se adivina el código de país: `(555) 000-0001` se
 *      queda en su forma nacional y NO se une a `+15550000001`. Preferimos dos
 *      filas a inventar un país.
 *   3. `countryCode` NO entra en la clave y NUNCA fabrica un prefijo. Mapear
 *      ISO-2 → prefijo telefónico ES adivinar. Tampoco separa claves: la tabla
 *      es UNIQUE (candidate_id, dedupe_key), así que el alcance ya es UNA
 *      persona, y meter el país partiría en dos el mismo número observado una
 *      vez con país y otra sin él.
 *   4. La extensión forma parte SEPARADA de la clave: mismo número con
 *      extensiones distintas son entradas distintas.
 *   5. Sin dígitos suficientes para una clave segura ⇒ clave OPACA y estable
 *      por entrada. Dos entradas inválidas DISTINTAS nunca colapsan entre sí, y
 *      la misma entrada inválida repetida sí es idempotente.
 *
 * La clave devuelta es siempre `<clase>:<sha256>`: nunca contiene el número.
 */
export function normalizeCandidatePhone(
  input: Pick<
    CanonicalCandidatePhoneInput,
    'displayPhone' | 'sanitizedPhone' | 'countryCode'
  >,
): NormalizedCandidatePhone {
  const display = cleanText(input.displayPhone);
  const sanitized = cleanText(input.sanitizedPhone);

  // El saneado del proveedor manda para la clave; el display se conserva para
  // mostrar. Si solo hay uno de los dos, ese sirve para ambas cosas.
  const keySource = sanitized ?? display;

  if (!keySource) {
    // Sin número no hay clave derivable del número. Una entrada vacía no puede
    // colapsar con ninguna otra: se le da una clave opaca propia y constante.
    return {
      normalizedPhone: null,
      displayPhone: display,
      extension: null,
      dedupeKey: `opaque:${sha256Hex('empty:')}`,
      keyKind: 'opaque',
    };
  }

  const { base, extension } = splitExtension(keySource);
  const digits = digitsOf(base);
  const extensionPart = extension ? `;ext=${extension}` : '';

  // ── Caso 1: E.164 verificable ──
  const hasPlus = base.trimStart().startsWith('+');
  const hasInternationalPrefix = !hasPlus && digits.startsWith('00');
  const e164Digits = hasInternationalPrefix ? digits.slice(2) : digits;

  if (
    (hasPlus || hasInternationalPrefix) &&
    e164Digits.length >= MIN_E164_DIGITS &&
    e164Digits.length <= MAX_E164_DIGITS
  ) {
    const normalized = `+${e164Digits}`;
    return {
      normalizedPhone: normalized,
      displayPhone: display ?? normalized,
      extension,
      dedupeKey: `e164:${sha256Hex(`${normalized}${extensionPart}`)}`,
      keyKind: 'e164',
    };
  }

  // ── Caso 2: dígitos suficientes, país desconocido ──
  if (digits.length >= MIN_SAFE_DIGITS && digits.length <= MAX_E164_DIGITS) {
    return {
      // Los dígitos TAL CUAL, sin `+` y sin prefijo inventado. Se conserva el
      // número (si no, ningún teléfono en formato nacional podría llegar a ser
      // principal, porque la migración exige `normalized_phone IS NOT NULL`),
      // pero NO se afirma que sea E.164: eso lo dice `keyKind = 'digits'`.
      normalizedPhone: digits,
      displayPhone: display ?? base,
      extension,
      dedupeKey: `digits:${sha256Hex(`${digits}${extensionPart}`)}`,
      keyKind: 'digits',
    };
  }

  // ── Caso 3: insuficiente para una clave segura ──
  // Clave opaca DERIVADA DE LA ENTRADA: estable (la misma entrada da la misma
  // clave) y discriminante (dos entradas distintas no colapsan).
  return {
    normalizedPhone: null,
    displayPhone: display ?? base,
    extension,
    dedupeKey: `opaque:${sha256Hex(`raw:${keySource}${extensionPart}`)}`,
    keyKind: 'opaque',
  };
}

// ── 2. Clave de evento de procedencia ──────────────────────────────

/**
 * Clave determinista e idempotente de UNA procedencia.
 *
 * SIN PII por construcción: se compone únicamente de vocabularios cerrados
 * (`provider`, `acquisitionMode`), de la fase, y de ids de filas PROPIAS de
 * SellUp (corrida, reserva, usage-log). No entra el teléfono, ni el correo, ni
 * el nombre, ni LinkedIn, ni ningún id del proveedor.
 *
 * IDEMPOTENCIA: `observedAt` queda deliberadamente FUERA. Reprocesar el mismo
 * webhook con un reloj nuevo debe reconocer la misma procedencia, no crear una
 * segunda fila; si el instante entrara en la clave, "idempotente" duraría lo que
 * dura un reintento.
 *
 * Consecuencia asumida y explícita: una procedencia SIN ningún id operativo
 * (típicamente `manual`) queda identificada solo por proveedor+modo+fase, así
 * que dos observaciones manuales sin ids colapsan en una. Es la lectura correcta
 * — sin un identificador que las distinga, no hay evidencia de que sean dos
 * eventos — y es preferible a inventar unicidad con un reloj.
 *
 * DISCRIMINANTE (4O-C): cuando `observationDiscriminator` viene, se añade como
 * último segmento. Es lo que permite que el MISMO número observado dos veces en
 * el MISMO evento HTTP colapse si el proveedor dijo lo mismo de él, y NO colapse
 * si dijo cosas distintas. Ausente ⇒ clave byte-idéntica a la de 4O-B.
 */
export function buildCandidatePhoneSourceEventKey(
  source: Pick<
    CandidatePhoneSourceInput,
    | 'provider'
    | 'acquisitionMode'
    | 'phase'
    | 'waterfallRunId'
    | 'reservationId'
    | 'providerUsageLogId'
  > &
    Partial<Pick<CandidatePhoneSourceInput, 'observationDiscriminator'>>,
): string {
  const part = (value: string | null): string => cleanText(value) ?? '-';
  const base = [
    'v1',
    source.provider,
    source.acquisitionMode,
    part(source.phase),
    part(source.waterfallRunId),
    part(source.reservationId),
    part(source.providerUsageLogId),
  ].join(':');
  const discriminator = cleanText(source.observationDiscriminator ?? null);
  return discriminator ? `${base}:${discriminator}` : base;
}

// ── 3. Fusión ──────────────────────────────────────────────────────

/**
 * Estado agregado de un teléfono a partir de TODAS sus procedencias.
 *
 *   * alguna fuente lo confirma `valid`      ⇒ `valid`
 *   * todas las fuentes EXPLÍCITAS son `invalid` (y hay al menos una) ⇒ `invalid`
 *   * sin evidencia suficiente               ⇒ `unknown`
 *
 * La primera regla es la que importa: una fuente que dice `invalid` NO degrada
 * un número que otra fuente confirmó como válido. Un proveedor que no logró
 * verificar un número está informando de su propia cobertura, no del número.
 */
export function aggregateCandidatePhoneStatus(
  statuses: readonly CandidatePhoneStatus[],
): CandidatePhoneStatus {
  if (statuses.some((status) => status === 'valid')) return 'valid';
  const explicit = statuses.filter((status) => status !== 'unknown');
  if (explicit.length > 0 && explicit.every((status) => status === 'invalid')) {
    return 'invalid';
  }
  return 'unknown';
}

/**
 * Tipo agregado: el MEJOR posicionado en el ranking. Los tipos crudos de todas
 * las fuentes se conservan íntegros en las procedencias, así que elegir uno aquí
 * no pierde información.
 */
export function aggregateCandidatePhoneType(
  types: readonly PhoneType[],
): PhoneType {
  if (types.length === 0) return 'unknown';
  return [...types].sort((a, b) => phoneTypeRank(a) - phoneTypeRank(b))[0];
}

function earliest(a: string, b: string): string {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function latest(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Funde N observaciones en la colección canónica: UNA fila por `dedupe_key`,
 * con TODAS sus procedencias.
 *
 * Lo que garantiza:
 *   * el mismo número en formatos distintos ⇒ una sola fila canónica;
 *   * el mismo número visto por Apollo y por Lusha ⇒ 1 fila + 2 procedencias.
 *     No se escoge una procedencia y se descarta la otra;
 *   * ningún `raw_provider_type` / `raw_provider_status` se pierde;
 *   * los créditos NO se reparten por número: aquí no hay ni una columna de
 *     costo. La contabilidad sigue viviendo en `phone_reveal_waterfall_runs`,
 *     `phone_reveal_credit_reservations` y `provider_usage_logs`.
 *
 * Inmutable: no muta la entrada ni ninguno de sus objetos.
 */
export function mergeCandidatePhoneInputs(
  inputs: readonly CanonicalCandidatePhoneInput[],
): readonly CanonicalCandidatePhone[] {
  const byKey = new Map<
    string,
    {
      normalized: NormalizedCandidatePhone;
      types: PhoneType[];
      statuses: CandidatePhoneStatus[];
      sources: Map<string, CanonicalCandidatePhoneSource>;
      firstSeenAt: string;
      lastSeenAt: string;
    }
  >();

  for (const input of inputs) {
    const normalized = normalizeCandidatePhone(input);
    const sourceEventKey = buildCandidatePhoneSourceEventKey(input.source);
    const source: CanonicalCandidatePhoneSource = {
      provider: input.source.provider,
      acquisitionMode: input.source.acquisitionMode,
      phase: cleanText(input.source.phase),
      rawProviderType: cleanText(input.source.rawProviderType),
      rawProviderStatus: cleanText(input.source.rawProviderStatus),
      waterfallRunId: cleanText(input.source.waterfallRunId),
      reservationId: cleanText(input.source.reservationId),
      providerUsageLogId: cleanText(input.source.providerUsageLogId),
      sourceEventKey,
      observedAt: input.source.observedAt,
    };

    const existing = byKey.get(normalized.dedupeKey);
    if (!existing) {
      byKey.set(normalized.dedupeKey, {
        normalized,
        types: [input.phoneType],
        statuses: [input.phoneStatus],
        sources: new Map([[sourceEventKey, source]]),
        firstSeenAt: source.observedAt,
        lastSeenAt: source.observedAt,
      });
      continue;
    }

    existing.types.push(input.phoneType);
    existing.statuses.push(input.phoneStatus);
    // Idempotencia: la misma procedencia repetida no añade una fila.
    if (!existing.sources.has(sourceEventKey)) {
      existing.sources.set(sourceEventKey, source);
    }
    existing.firstSeenAt = earliest(existing.firstSeenAt, source.observedAt);
    existing.lastSeenAt = latest(existing.lastSeenAt, source.observedAt);
    // Un E.164 verificado gana al formato nacional del mismo número: la clave ya
    // demostró que son el mismo, así que conservamos la forma más informativa.
    if (!existing.normalized.normalizedPhone && normalized.normalizedPhone) {
      existing.normalized = normalized;
    }
  }

  const phones: CanonicalCandidatePhone[] = [...byKey.entries()].map(
    ([dedupeKey, entry]) => ({
      dedupeKey,
      keyKind: entry.normalized.keyKind,
      normalizedPhone: entry.normalized.normalizedPhone,
      displayPhone: entry.normalized.displayPhone,
      extension: entry.normalized.extension,
      phoneType: aggregateCandidatePhoneType(entry.types),
      phoneStatus: aggregateCandidatePhoneStatus(entry.statuses),
      isPrimary: false,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      suppressedAt: null,
      sources: [...entry.sources.values()],
    }),
  );

  return markPrimaryCandidatePhone(sortCandidatePhones(phones));
}

// ── 4. Orden y elección del principal ──────────────────────────────

/**
 * Un teléfono solo puede ser principal si está vivo, tiene número normalizado y
 * no es inválido. Las tres condiciones son EXACTAMENTE las del CHECK
 * `..._primary_requires_live_number` de la migración: si divergieran, esta
 * función elegiría un principal que la base de datos rechazaría al escribirlo.
 */
export function isCandidatePhoneEligibleForPrimary(
  phone: CanonicalCandidatePhone,
): boolean {
  if (phone.suppressedAt !== null) return false;
  if (phone.normalizedPhone === null) return false;
  return phone.phoneStatus !== 'invalid';
}

function bestSourceSpecificity(phone: CanonicalCandidatePhone): number {
  return phone.sources.reduce(
    (best, source) => Math.min(best, sourceSpecificityRank(source)),
    SOURCE_SPECIFICITY_RANKING.length,
  );
}

function statusRank(status: CandidatePhoneStatus): number {
  // `valid` gana a `unknown`; `invalid` queda al final (y además ya está
  // excluido de la elegibilidad).
  if (status === 'valid') return 0;
  if (status === 'unknown') return 1;
  return 2;
}

/**
 * Comparador TOTAL y DETERMINISTA. El orden de llegada del proveedor no
 * participa en ningún escalón: "el primero del array" no es un criterio.
 *
 *   1. mejor `PhoneType`
 *   2. `valid` sobre `unknown`
 *   3. procedencia más específica (reveal > caché > search)
 *   4. `lastSeenAt` más reciente
 *   5. `dedupeKey` ascendente — desempate final, siempre presente y único,
 *      así que el comparador nunca depende del orden de entrada.
 */
export function compareCandidatePhones(
  a: CanonicalCandidatePhone,
  b: CanonicalCandidatePhone,
): number {
  const byType = phoneTypeRank(a.phoneType) - phoneTypeRank(b.phoneType);
  if (byType !== 0) return byType;

  const byStatus = statusRank(a.phoneStatus) - statusRank(b.phoneStatus);
  if (byStatus !== 0) return byStatus;

  const bySource = bestSourceSpecificity(a) - bestSourceSpecificity(b);
  if (bySource !== 0) return bySource;

  const byObserved = Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
  if (Number.isFinite(byObserved) && byObserved !== 0) return byObserved;

  return a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0;
}

/** Orden estable de presentación. Inmutable: devuelve una copia ordenada. */
export function sortCandidatePhones(
  phones: readonly CanonicalCandidatePhone[],
): readonly CanonicalCandidatePhone[] {
  return [...phones].sort(compareCandidatePhones);
}

/**
 * Elige el principal. Devuelve la `dedupe_key` ganadora, o null si no queda
 * ningún teléfono elegible (todos suprimidos, inválidos o sin número).
 */
export function selectPrimaryCandidatePhone(
  phones: readonly CanonicalCandidatePhone[],
): string | null {
  const eligible = phones.filter(isCandidatePhoneEligibleForPrimary);
  if (eligible.length === 0) return null;
  return [...eligible].sort(compareCandidatePhones)[0].dedupeKey;
}

/**
 * Devuelve la colección con `is_primary` recalculado. Exactamente una fila queda
 * en true (o ninguna, si no hay elegibles), que es justo lo que el índice
 * parcial de la migración exige.
 */
export function markPrimaryCandidatePhone(
  phones: readonly CanonicalCandidatePhone[],
): readonly CanonicalCandidatePhone[] {
  const primaryKey = selectPrimaryCandidatePhone(phones);
  return phones.map((phone) => ({
    ...phone,
    isPrimary: primaryKey !== null && phone.dedupeKey === primaryKey,
  }));
}

// ── 5. Supresión y reelección ──────────────────────────────────────

/** Vocabulario de la razón de supresión. Cerrado a propósito. */
export type CandidatePhoneSuppressionReason =
  | 'data_subject_request'
  | 'operator_request'
  | 'provider_retraction';

export interface CandidatePhoneSuppressionInput {
  dedupeKey: string;
  reason: CandidatePhoneSuppressionReason;
  /** `internal_users.id` del operador. Id opaco, sin PII. */
  suppressedBy: string | null;
  /** ISO-8601. Entra como dato: este módulo no lee el reloj. */
  suppressedAt: string;
}

export interface CandidatePhoneSuppressionDecision {
  /** Clave que se convierte en tombstone, o null si no había nada que suprimir. */
  tombstonedDedupeKey: string | null;
  /** Clave que DEJA de ser principal, si la suprimida lo era. */
  demotedPrimaryDedupeKey: string | null;
  /** Clave que pasa a principal tras la supresión, o null si no queda ninguna. */
  nextPrimaryDedupeKey: string | null;
  /**
   * Si el escalar `contact_enrichment_candidates.phone` DEBERÍA quedar en null.
   * 4O-B solo DECIDE: no escribe, no propaga y no toca el escalar, que sigue
   * siendo la verdad visible sin cambios.
   */
  scalarPhoneShouldBecomeNull: boolean;
  /** La colección resultante, con el tombstone aplicado y el principal reelegido. */
  phones: readonly CanonicalCandidatePhone[];
}

/**
 * Calcula el efecto de suprimir un teléfono. PURA: decide, no escribe.
 *
 * El tombstone conserva la fila (la clave es lo que impide que el número
 * reentre) pero NO conserva el número: `normalized_phone`, `display_phone`, la
 * extensión y el tipo se pierden, y `is_primary` cae a false. La migración fija
 * esa misma forma con un CHECK, así que las dos mitades no pueden divergir.
 */
export function applyCandidatePhoneSuppression(
  phones: readonly CanonicalCandidatePhone[],
  input: CandidatePhoneSuppressionInput,
): CandidatePhoneSuppressionDecision {
  const target = phones.find((phone) => phone.dedupeKey === input.dedupeKey);

  if (!target || target.suppressedAt !== null) {
    // Nada que suprimir (o ya suprimido): idempotente, sin efectos.
    return {
      tombstonedDedupeKey: null,
      demotedPrimaryDedupeKey: null,
      nextPrimaryDedupeKey: selectPrimaryCandidatePhone(phones),
      scalarPhoneShouldBecomeNull: selectPrimaryCandidatePhone(phones) === null,
      phones: markPrimaryCandidatePhone(phones),
    };
  }

  const wasPrimary = target.isPrimary;

  const tombstoned: readonly CanonicalCandidatePhone[] = phones.map((phone) =>
    phone.dedupeKey === input.dedupeKey
      ? {
          ...phone,
          normalizedPhone: null,
          displayPhone: null,
          extension: null,
          phoneType: null,
          isPrimary: false,
          suppressedAt: input.suppressedAt,
        }
      : phone,
  );

  const nextPrimaryDedupeKey = selectPrimaryCandidatePhone(tombstoned);

  return {
    tombstonedDedupeKey: input.dedupeKey,
    demotedPrimaryDedupeKey: wasPrimary ? input.dedupeKey : null,
    nextPrimaryDedupeKey,
    scalarPhoneShouldBecomeNull: nextPrimaryDedupeKey === null,
    phones: markPrimaryCandidatePhone(tombstoned),
  };
}
