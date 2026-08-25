/**
 * phone-reveal-lusha-attempt-diagnostics.ts — evento estructurado y SIN PII del
 * desenlace de la pata Lusha del phone reveal
 * (Agente 2A · AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1).
 *
 * ══════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ══════════════════════════════════════════════════════════════
 *
 * La corrida real 2a49e0f7 cerró con `lusha_outcome = error` y
 * `error_code = lusha_reveal_error`, y eso era TODO lo que quedaba registrado. Ese
 * código no distingue ninguna de las preguntas que hay que responder para arreglar
 * un fallo de reveal:
 *
 *   * ¿llegó a salir una petición, o murió en un gate nuestro?
 *   * si salió, ¿qué contestó el proveedor — 401, 404, 429, 5xx?
 *   * ¿el id con el que se pidió venía de una búsqueda de ESTA corrida, de una
 *     identidad persistida antes, o del propio candidato?
 *   * ¿el cuerpo se pudo leer?
 *
 * Peor: `lusha_reveal_error` AFIRMA algo falso cuando el fallo fue local. Dice que
 * hubo un reveal que falló, cuando lo que hubo fue un reveal que nunca ocurrió.
 *
 * ══════════════════════════════════════════════════════════════
 * PRIVACIDAD — LO QUE ESTE MÓDULO NO PUEDE EMITIR
 * ══════════════════════════════════════════════════════════════
 *
 * El tipo del evento es CERRADO y todos sus campos son vocabularios mecánicos,
 * booleanos o números. Es imposible construirlo con:
 *
 *   nombre · email · teléfono · LinkedIn · id nativo del proveedor ·
 *   API key · cuerpo crudo de la respuesta · cuerpo crudo de la petición
 *
 * Ninguno de ellos tiene campo donde ir, y `http_status_class` guarda la CLASE
 * (`4xx`) y no el número exacto salvo en los códigos que ya son vocabulario del
 * clasificador. Ese estrechamiento es deliberado: la clase basta para operar y no
 * puede convertirse en una huella del contacto.
 *
 * Módulo PURO: no hace I/O, no lee flags y no conoce el esquema. Quien lo emite
 * decide dónde va.
 */

/** Familia de endpoint con la que se pidió el teléfono. Vocabulario cerrado. */
export type PhoneRevealLushaEndpointFamily =
  /** POST /v3/contacts/enrich con `reveal: ['phones']` — la ruta viva. */
  | 'v3_contacts_enrich'
  /** No se llegó a elegir endpoint: la pata murió antes. */
  | 'none';

/** Clase del status HTTP. Nunca el número exacto. */
export type PhoneRevealLushaHttpStatusClass =
  | '2xx'
  | '4xx'
  | '5xx'
  /** No hubo respuesta: red caída, timeout, o petición no emitida. */
  | 'none';

/**
 * Categoría OPERATIVA del fallo: lo que determina qué hacer, no qué pasó.
 * Es la que la UI traduce a copy y la que un humano usa para decidir si el
 * problema es nuestro, del plan contratado, o del momento.
 */
export type PhoneRevealLushaErrorCategory =
  /** Gate NUESTRO, anterior a cualquier byte. Nunca es culpa del proveedor. */
  | 'local_block'
  /** Credencial o permiso: 401/403. Configuración, no disponibilidad. */
  | 'credential_or_entitlement'
  /** El id no existe para el proveedor: 404. Contrato de identidad. */
  | 'identity_contract'
  /** 429. */
  | 'rate_limited'
  /** 5xx, red caída o timeout. */
  | 'provider_unavailable'
  /** Saldo agotado: 402. */
  | 'insufficient_credits'
  /** Respondió, pero el cuerpo no encaja con ningún contrato conocido. */
  | 'response_parse_error'
  /** Sin fallo. */
  | 'none';

/** Cómo acabó la lectura del cuerpo de la respuesta. */
export type PhoneRevealLushaResponseParseOutcome =
  | 'parsed'
  | 'unparseable'
  /** No hubo cuerpo que leer. */
  | 'not_applicable';

/** De dónde salió el id nativo con el que se pidió el teléfono. */
export type PhoneRevealLushaIdentitySource =
  /** Búsqueda pagada en ESTA autorización. */
  | 'run_identity_search'
  /** Identidad persistida por una autorización anterior; 0 búsquedas nuevas. */
  | 'persisted_identity'
  /** El candidato nació en Lusha y su `source_contact_id` ya era nativo. */
  | 'candidate_native'
  /** No se resolvió ninguno — ésta es la marca del fallo de 2a49e0f7. */
  | 'none';

/** Desenlace de la pata. */
export type PhoneRevealLushaAttemptResult =
  | 'revealed'
  | 'no_phone'
  | 'error'
  | 'timeout';

/** Verdad del costo, mismo vocabulario que la liquidación. */
export type PhoneRevealLushaCostTruth = 'reported' | 'assumed_cap' | 'unknown';

export const PHONE_REVEAL_LUSHA_ATTEMPT_OUTCOME_EVENT =
  'phone_reveal_lusha_attempt_outcome' as const;

/**
 * El evento. Todos los campos son obligatorios a propósito: un diagnóstico con
 * huecos opcionales vuelve a ser el `lusha_reveal_error` del que este hito sale.
 */
export interface PhoneRevealLushaAttemptOutcomeEvent {
  event: typeof PHONE_REVEAL_LUSHA_ATTEMPT_OUTCOME_EVENT;
  endpoint_family: PhoneRevealLushaEndpointFamily;
  request_emitted: boolean;
  http_status_class: PhoneRevealLushaHttpStatusClass;
  /** Código mecánico del proveedor o del gate local. Nunca texto libre del proveedor. */
  provider_error_code: string | null;
  provider_error_category: PhoneRevealLushaErrorCategory;
  response_parse_outcome: PhoneRevealLushaResponseParseOutcome;
  /** Lusha revela de forma SÍNCRONA. Se declara para que un cambio a async se note. */
  async_or_sync: 'sync';
  provider_identity_source: PhoneRevealLushaIdentitySource;
  /** Operación de la reserva, para correlacionar con la pata económica correcta. */
  reservation_operation_key: 'phone_reveal';
  cost_truth: PhoneRevealLushaCostTruth;
  /** Sólo si el proveedor los reportó. `null` NUNCA significa 0. */
  credits_reported: number | null;
  result: PhoneRevealLushaAttemptResult;
}

/** Hechos observados por el ejecutor de la pata. */
export interface PhoneRevealLushaAttemptFacts {
  requestEmitted: boolean;
  /** Status HTTP exacto. Se degrada a clase aquí y no viaja crudo. */
  httpStatus: number | null;
  providerErrorCode: string | null;
  /** `true` cuando hubo respuesta pero su cuerpo no se pudo interpretar. */
  responseUnparseable: boolean;
  identitySource: PhoneRevealLushaIdentitySource;
  creditsReported: number | null;
  costTruth: PhoneRevealLushaCostTruth;
  result: PhoneRevealLushaAttemptResult;
}

/** Degrada un status HTTP a su CLASE. Fuera de rango ⇒ `none`. */
function toHttpStatusClass(
  httpStatus: number | null,
): PhoneRevealLushaHttpStatusClass {
  if (typeof httpStatus !== 'number' || !Number.isFinite(httpStatus)) return 'none';
  if (httpStatus >= 200 && httpStatus < 300) return '2xx';
  if (httpStatus >= 400 && httpStatus < 500) return '4xx';
  if (httpStatus >= 500 && httpStatus < 600) return '5xx';
  return 'none';
}

/**
 * Códigos del clasificador de respuesta de Lusha, mapeados a la categoría
 * OPERATIVA que les corresponde. Declarado como dato para que la precedencia sea
 * legible y testeable sin seguir ramas.
 */
const PROVIDER_ERROR_CATEGORY_BY_CODE: Readonly<
  Record<string, PhoneRevealLushaErrorCategory>
> = {
  provider_auth_error: 'credential_or_entitlement',
  provider_permission_error: 'credential_or_entitlement',
  invalid_contact_id: 'identity_contract',
  rate_limited: 'rate_limited',
  insufficient_credits: 'insufficient_credits',
  provider_error: 'provider_unavailable',
  provider_network_error: 'provider_unavailable',
  malformed_provider_response: 'response_parse_error',
};

/**
 * Categoría del fallo. PRECEDENCIA, y el orden importa:
 *
 *   1. sin petición emitida ⇒ `local_block`, SIEMPRE. Es la afirmación más fuerte
 *      que se puede hacer y no la puede desmentir ningún código posterior: si no
 *      salieron bytes, el proveedor no participó y no puede ser la causa.
 *   2. código conocido del proveedor ⇒ su categoría.
 *   3. timeout ⇒ `provider_unavailable`.
 *   4. cuerpo ilegible ⇒ `response_parse_error`.
 *   5. sin error ⇒ `none`.
 */
export function resolvePhoneRevealLushaErrorCategory(
  facts: PhoneRevealLushaAttemptFacts,
): PhoneRevealLushaErrorCategory {
  if (!facts.requestEmitted) {
    return facts.result === 'error' ? 'local_block' : 'none';
  }
  const mapped = facts.providerErrorCode
    ? PROVIDER_ERROR_CATEGORY_BY_CODE[facts.providerErrorCode]
    : undefined;
  if (mapped) return mapped;
  if (facts.result === 'timeout') return 'provider_unavailable';
  if (facts.responseUnparseable) return 'response_parse_error';
  return facts.result === 'error' ? 'provider_unavailable' : 'none';
}

/**
 * Construye el evento. PURA y total: para cualquier combinación de hechos devuelve
 * un evento completo, porque el camino que más necesita diagnóstico es justamente
 * el que peor se porta.
 */
export function buildPhoneRevealLushaAttemptOutcomeEvent(
  facts: PhoneRevealLushaAttemptFacts,
): PhoneRevealLushaAttemptOutcomeEvent {
  return {
    event: PHONE_REVEAL_LUSHA_ATTEMPT_OUTCOME_EVENT,
    endpoint_family: facts.requestEmitted ? 'v3_contacts_enrich' : 'none',
    request_emitted: facts.requestEmitted,
    http_status_class: toHttpStatusClass(facts.httpStatus),
    provider_error_code: facts.providerErrorCode,
    provider_error_category: resolvePhoneRevealLushaErrorCategory(facts),
    response_parse_outcome: !facts.requestEmitted
      ? 'not_applicable'
      : facts.responseUnparseable
        ? 'unparseable'
        : 'parsed',
    async_or_sync: 'sync',
    provider_identity_source: facts.identitySource,
    reservation_operation_key: 'phone_reveal',
    cost_truth: facts.costTruth,
    credits_reported: facts.creditsReported,
    result: facts.result,
  };
}
