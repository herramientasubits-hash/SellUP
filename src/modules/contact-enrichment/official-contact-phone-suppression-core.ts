/**
 * Agente 2A — contrato PURO de la supresión de privacidad sobre el modelo OFICIAL de
 * múltiples teléfonos (AGENT2A-PHONE-REVEAL-4O-H2).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ ES ESTE ARCHIVO
 * ═══════════════════════════════════════════════════════════════════
 *
 * La migración 114 creó `contact_phones` + `contact_phone_sources` y no cableó nada. La 115
 * añade la ÚNICA operación que las borra: `suppress_official_contact_phone_sources`, una
 * función transaccional. Este módulo es su contrato del lado de TypeScript:
 *
 *   * el nombre de la RPC y la forma exacta de sus parámetros;
 *   * los vocabularios cerrados que la 114/115 aceptan, para que un valor no pueda añadirse
 *     en un solo lado y producir un 23514 en ejecución — el defecto de #238;
 *   * el predicado de SUPRIMIBILIDAD, DERIVADO y no inventado (ver abajo);
 *   * el parser fail-closed del envelope.
 *
 * PURO: sin red, sin Supabase, sin reloj, sin env, sin flags, sin logging. La única E/S vive
 * en `official-contact-phone-suppression-persistence.ts`, que hace exactamente una
 * `admin.rpc(...)` y nada más.
 *
 * ═══════════════════════════════════════════════════════════════════
 * LA SUPRIMIBILIDAD SE **DERIVA**
 * ═══════════════════════════════════════════════════════════════════
 *
 * La procedencia oficial es un PAR `(provider, acquisition_mode)`. El escalar heredado
 * `contacts.phone_source` es una sola cadena fusionada, y 4O-E4 ya decidió —y fijó en
 * pruebas— qué valores de ESA cadena puede destruir una supresión:
 * `SUPPRESSIBLE_CONTACT_PHONE_SOURCES`. La migración 112 ya posee la traducción exhaustiva y
 * sin pérdida del par a la cadena.
 *
 * Así que este módulo NO escribe una segunda autoridad sobre qué procedencia puede borrarse.
 * COMPONE las dos que existen:
 *
 *   suprimible(par) ⇔ deriveLegacyPhoneSource(par) ∈ SUPPRESSIBLE_CONTACT_PHONE_SOURCES
 *
 * Consecuencias DECLARADAS (y fijadas por pruebas), no descubiertas más tarde:
 *
 *   * `manual` sobrevive a una supresión de Apollo Y a una de Lusha. Una DSAR dirigida a un
 *     proveedor no tiene autoridad sobre evidencia que escribió una persona.
 *   * `unknown` sobrevive: una supresión por proveedor no puede AFIRMAR que una procedencia
 *     sin atribuir era de Apollo. Para una AUTORIDAD de borrado, fail-closed es borrar menos.
 *   * `(apollo, search)` sobrevive a una supresión de Apollo, porque el contrato heredado
 *     nunca autorizó destruir un escalar `apollo_search`. Si esa decisión se revisa, se revisa
 *     en UN sitio —la allowlist heredada— y las dos capas se mueven juntas.
 */

import {
  SUPPRESSIBLE_CONTACT_PHONE_SOURCES,
  isSuppressibleContactPhoneSource,
} from './phone-cache-suppression-core';
import type { CandidatePhoneSuppressionReason } from './phone-collection-core';

/** Nombre de la función de la migración 115. Un literal, no una plantilla. */
export const SUPPRESS_OFFICIAL_CONTACT_PHONE_SOURCES_FN =
  'suppress_official_contact_phone_sources' as const;

// ── Vocabularios de la 114, espejo exacto ──────────────────────

/**
 * `contact_phone_sources.provider`. Espejo del CHECK
 * `contact_phone_sources_provider_check` de la 114, en el mismo orden.
 */
export const OFFICIAL_PHONE_PROVIDERS = [
  'apollo',
  'lusha',
  'apollo_cache',
  'manual',
  'unknown',
] as const;

export type OfficialPhoneProvider = (typeof OFFICIAL_PHONE_PROVIDERS)[number];

/**
 * `contact_phone_sources.acquisition_mode`. Espejo del CHECK
 * `contact_phone_sources_acquisition_mode_check` de la 114.
 */
export const OFFICIAL_PHONE_ACQUISITION_MODES = [
  'search',
  'reveal',
  'waterfall',
  'cache',
  'manual',
] as const;

export type OfficialPhoneAcquisitionMode =
  (typeof OFFICIAL_PHONE_ACQUISITION_MODES)[number];

/**
 * Alcance del borrado.
 *
 * `all_suppressible_providers` es el alcance a NIVEL DE PERSONA: el que significa de verdad
 * la única DSAR cableada. Su clave es un id de persona de Apollo, y es tentador leerla como
 * «una supresión de Apollo»; no lo es. El id de Apollo es la CLAVE DE CACHÉ —identifica a QUÉ
 * PERSONA— y lo que la operación borra ya cruza proveedores hoy: tombstonea la colección
 * ENTERA del candidato (`all_candidate_phones`) y limpia un escalar cuya procedencia es
 * `lusha_reveal`.
 *
 * `single_provider` existe porque el modelo de la 114 lo hace representable y porque es la
 * única forma correcta de las dos operaciones que vienen después —una retractación de
 * proveedor y una petición de borrado por proveedor—. Está implementado, concedido y probado;
 * simplemente no tiene llamador cableado todavía, igual que el alcance `exact_phone` de la 112.
 */
export const OFFICIAL_PHONE_SUPPRESSION_SCOPES = [
  'all_suppressible_providers',
  'single_provider',
] as const;

export type OfficialPhoneSuppressionScope =
  (typeof OFFICIAL_PHONE_SUPPRESSION_SCOPES)[number];

/**
 * El alcance que usa la DSAR cableada. Cablearla a `single_provider = apollo` habría sido una
 * REGRESIÓN de privacidad disfrazada de precisión: la procedencia de Lusha seguiría viva, el
 * número canónico seguiría vivo, y el escalar heredado quedaría limpio a su lado — una
 * colección oficial que aún guarda el número que una DSAR mandó borrar.
 */
export const DSAR_OFFICIAL_PHONE_SUPPRESSION_SCOPE: OfficialPhoneSuppressionScope =
  'all_suppressible_providers';

/** Estados que la RPC puede devolver. Cerrado a propósito. */
export const OFFICIAL_PHONE_SUPPRESSION_STATUSES = [
  'suppressed',
  'already_suppressed',
  'no_official_collection',
  'contact_not_found',
  'invalid_input',
] as const;

export type OfficialPhoneSuppressionStatus =
  (typeof OFFICIAL_PHONE_SUPPRESSION_STATUSES)[number];

/**
 * Estados en los que la superficie oficial del contacto quedó CONSISTENTE.
 *
 * `no_official_collection` cuenta como liquidado y es la clave de la inercia en Producción:
 * el contacto no tiene colección oficial, así que no hay nada que borrar y nada quedó a
 * medias. `contact_not_found` e `invalid_input` NO cuentan: son fallos que el llamador debe
 * reportar como tales y nunca como éxito.
 */
export const OFFICIAL_PHONE_SETTLED_STATUSES: readonly OfficialPhoneSuppressionStatus[] =
  ['suppressed', 'already_suppressed', 'no_official_collection'];

// ── Traducción par → escalar heredado (espejo de la 112) ────────

/**
 * `(provider, acquisition_mode)` → `contacts.phone_source`.
 *
 * Espejo EXACTO del `CASE` de la migración 112 (paso 6) y de la 115 (paso 6). El orden de las
 * ramas importa: `apollo_cache` y `lusha` se deciden SOLO por el proveedor, y sólo `apollo`
 * consulta el modo. Cuando el par no mapea a ningún valor que el vocabulario heredado ya use,
 * `unknown` es una afirmación verdadera sobre lo que SellUp sabe y un miembro existente de ese
 * vocabulario — no una conjetura disfrazada de hecho.
 */
export function deriveLegacyPhoneSource(
  provider: string,
  acquisitionMode: string,
): string {
  if (provider === 'apollo_cache') return 'apollo_cache';
  if (provider === 'lusha') return 'lusha_reveal';
  if (provider === 'apollo') {
    if (acquisitionMode === 'reveal' || acquisitionMode === 'waterfall') {
      return 'apollo_reveal';
    }
    if (acquisitionMode === 'search') return 'apollo_search';
    return 'unknown';
  }
  if (provider === 'manual') return 'manual';
  return 'unknown';
}

/**
 * ¿Puede una supresión de privacidad retirar esta procedencia oficial?
 *
 * La composición completa: se deriva el valor heredado y se pregunta a la allowlist de 4O-E4.
 * No hay una segunda lista aquí a propósito — una allowlist duplicada es la forma en que dos
 * capas empiezan a discrepar sobre qué es borrable.
 */
export function isSuppressibleOfficialPhoneSource(
  provider: string,
  acquisitionMode: string,
): boolean {
  return isSuppressibleContactPhoneSource(
    deriveLegacyPhoneSource(provider, acquisitionMode),
  );
}

/**
 * Los pares suprimibles, enumerados. Existe para que las pruebas puedan comparar el conjunto
 * DERIVADO contra el predicado SQL de la 115 en las dos direcciones: si la 115 ensanchara su
 * `WHERE` o este módulo estrechara el suyo, la paridad fallaría en vez de divergir en silencio.
 */
export function suppressibleOfficialSourcePairs(): Array<{
  provider: OfficialPhoneProvider;
  acquisitionMode: OfficialPhoneAcquisitionMode;
}> {
  const pairs: Array<{
    provider: OfficialPhoneProvider;
    acquisitionMode: OfficialPhoneAcquisitionMode;
  }> = [];
  for (const provider of OFFICIAL_PHONE_PROVIDERS) {
    for (const acquisitionMode of OFFICIAL_PHONE_ACQUISITION_MODES) {
      if (isSuppressibleOfficialPhoneSource(provider, acquisitionMode)) {
        pairs.push({ provider, acquisitionMode });
      }
    }
  }
  return pairs;
}

/**
 * Re-exportada para que un lector de este módulo no tenga que ir a buscar la allowlist que lo
 * gobierna. Es la MISMA referencia, no una copia.
 */
export { SUPPRESSIBLE_CONTACT_PHONE_SOURCES };

// ── Parámetros de la RPC ───────────────────────────────────────

export interface OfficialPhoneSuppressionRequest {
  contactId: string;
  scope: OfficialPhoneSuppressionScope;
  /** Obligatorio con `single_provider`; DEBE ser null con el alcance de todos. */
  provider: OfficialPhoneProvider | null;
  /** Acota a un número canónico. `null` = toda la colección del contacto. */
  dedupeKey: string | null;
  /** Vocabulario de la 114 (= el de la 109). La 112 posee la traducción desde el de la 099. */
  suppressionReason: CandidatePhoneSuppressionReason;
  /** `internal_users.id` del operador. */
  suppressedBy: string | null;
  suppressedAt: string;
}

export interface OfficialPhoneSuppressionParams {
  p_contact_id: string;
  p_provider_scope: OfficialPhoneSuppressionScope;
  p_provider: string | null;
  p_dedupe_key: string | null;
  p_suppression_reason: CandidatePhoneSuppressionReason;
  p_suppressed_by: string | null;
  p_suppressed_at: string;
}

/**
 * Nombres `p_*` posicionales de la 115. Se construyen aquí y no en el llamador para que la
 * firma exista en UN sitio: un parámetro renombrado en la migración rompe este archivo y sus
 * pruebas, no una llamada suelta a mitad de una server action.
 */
export function buildOfficialPhoneSuppressionParams(
  request: OfficialPhoneSuppressionRequest,
): OfficialPhoneSuppressionParams {
  return {
    p_contact_id: request.contactId,
    p_provider_scope: request.scope,
    p_provider: request.scope === 'single_provider' ? request.provider : null,
    p_dedupe_key: request.dedupeKey,
    p_suppression_reason: request.suppressionReason,
    p_suppressed_by: request.suppressedBy,
    p_suppressed_at: request.suppressedAt,
  };
}

// ── Envelope ───────────────────────────────────────────────────

export interface OfficialPhoneSuppressionOutcome {
  status: OfficialPhoneSuppressionStatus;
  sourcesSuppressed: number;
  phonesTombstoned: number;
  survivorCount: number;
  /** SHA-256 por diseño de la 114. NUNCA el número. */
  primaryDedupeKey: string | null;
  primaryChanged: boolean;
  scalarSynced: boolean;
  /** El escalar quedó intacto porque su procedencia no es suprimible (4O-E4 «FIX M1»). */
  scalarGuardedByProvenance: boolean;
  /** La superficie oficial del contacto quedó consistente. */
  contactSettled: boolean;
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/**
 * Parser FAIL-CLOSED del envelope.
 *
 * LANZA en vez de degradar. Un envelope que no se entiende no puede convertirse en «0 filas
 * suprimidas»: eso es indistinguible de un borrado que no hizo falta, y la diferencia entre
 * «no había nada» y «no sé qué pasó» es exactamente la que una auditoría de privacidad
 * necesita. `invalid_input` también lanza: significa que el llamador construyó mal la
 * petición, y tratarlo como un resultado lo dejaría pasar como éxito silencioso.
 */
export function parseOfficialPhoneSuppressionEnvelope(
  envelope: unknown,
): OfficialPhoneSuppressionOutcome {
  if (typeof envelope !== 'object' || envelope === null) {
    throw new Error(
      'official contact phone suppression returned a non-object envelope',
    );
  }

  const row = envelope as Record<string, unknown>;
  const status = row.status;

  if (typeof status !== 'string') {
    throw new Error(
      'official contact phone suppression envelope has no status',
    );
  }

  if (status === 'invalid_input') {
    const detail = typeof row.detail === 'string' ? row.detail : 'unknown';
    throw new Error(
      `official contact phone suppression rejected the request: ${detail}`,
    );
  }

  if (
    !(OFFICIAL_PHONE_SUPPRESSION_STATUSES as readonly string[]).includes(status)
  ) {
    throw new Error(
      `official contact phone suppression returned an unknown status: ${status}`,
    );
  }

  const typed = status as OfficialPhoneSuppressionStatus;

  return {
    status: typed,
    sourcesSuppressed: readCount(row.sources_suppressed),
    phonesTombstoned: readCount(row.phones_tombstoned),
    survivorCount: readCount(row.survivor_count),
    primaryDedupeKey:
      typeof row.primary_dedupe_key === 'string' ? row.primary_dedupe_key : null,
    primaryChanged: row.primary_changed === true,
    scalarSynced: row.scalar_synced === true,
    scalarGuardedByProvenance: row.scalar_guarded_by_provenance === true,
    // Cruzado contra la lista de estados liquidados y no leído a ciegas: un `true` del
    // servidor junto a un estado que NO liquida sería un fail-open, y el estado es el hecho
    // mecánico mientras el booleano es una conveniencia.
    contactSettled:
      row.contact_settled === true &&
      OFFICIAL_PHONE_SETTLED_STATUSES.includes(typed),
  };
}
