/**
 * AGENT1-LUSHA-CUT-L2 §§ A–H — Semántica de fallo de Lusha Company Prospecting.
 *
 * ── El hecho HUMANO que gobierna todo este módulo ────────────────────────────
 *
 * El soporte de Lusha confirmó, por un agente HUMANO, para
 * `POST /v3/companies/prospecting`:
 *
 *   · HTTP 429 ⇒ rate limit ⇒ 0 créditos. Desenlace de facturación SEGURO.
 *   · HTTP 5xx ⇒ fallo del servidor ⇒ 0 créditos. Desenlace SEGURO.
 *   · Petición DESPACHADA cuya respuesta se pierde (timeout, conexión cerrada,
 *     499) ⇒ Lusha PUDO procesar la consulta y DEDUCIR créditos.
 *
 *   Y, decisivo para el tercer caso:
 *
 *     NO hay Idempotency-Key.
 *     NO hay requestId suministrado por el cliente.
 *     NO hay API de recuperación de la respuesta.
 *     NO hay garantía de replay seguro.
 *
 * De ahí la regla central de este corte:
 *
 *     PETICIÓN DESPACHADA + DESENLACE DESCONOCIDO
 *       = INDETERMINADO
 *       = POSIBLEMENTE COBRADO
 *       = NO SE REINTENTA AUTOMÁTICAMENTE
 *
 * ── Lo que este módulo NO hace ───────────────────────────────────────────────
 *
 * NO reintenta. CUT-L2 clasifica; no añade motor de reintentos ni backoff. Que
 * 429 y 5xx sean «retryable por contrato» describe el CONTRATO del proveedor, no
 * una capacidad que este corte encienda. Ejecutar reintentos es CUT-L4, y sólo
 * después de que CUT-L3 ponga la valla durable de pre-envío.
 *
 * ── Por qué no se reutiliza la taxonomía de Apollo ───────────────────────────
 *
 * `apollo-organizations-error-taxonomy.ts` tiene una forma parecida y fue el
 * modelo de ésta, pero la semántica de FACTURACIÓN difiere: Apollo clasifica sus
 * 4xx genéricos como `not_charged`, y para Lusha el soporte humano NO confirmó
 * eso de ningún 4xx salvo el 429. Colapsar las dos en una abstracción compartida
 * habría propagado a Lusha una certeza que nadie le concedió. Se comparte el
 * PATRÓN, no la tabla.
 *
 * Puro y determinista: sin I/O, sin reloj, sin `process.env`, sin aleatoriedad.
 */

// ─── Categorías ───────────────────────────────────────────────────────────────

/**
 * Clase canónica del desenlace de UNA petición de Prospecting.
 *
 * `http_4xx_non_retryable` y `http_429_rate_limited` están separadas a propósito:
 * el 429 es el ÚNICO 4xx con contrato de facturación confirmado por humano.
 */
export type LushaProspectingOutcomeClass =
  | 'success'
  | 'http_429_rate_limited'
  | 'http_5xx_provider_failure'
  | 'http_4xx_non_retryable'
  | 'post_send_indeterminate'
  | 'malformed_success_payload'
  | 'local_pre_dispatch_failure';

/**
 * Qué se sabe del cobro de este intento.
 *
 * `unknown` es una categoría de primera clase, no un hueco: significa que nadie
 * —ni el proveedor ni el contrato humano— dijo si hubo cargo. Rellenarla con
 * `definitely_not_charged` sería inventar un hecho a favor nuestro.
 *
 * `potentially_charged` es más fuerte que `unknown`: hay una razón CONCRETA para
 * creer que pudo haber cargo (la petición salió y la respuesta se perdió).
 */
export type LushaBillingCertainty =
  | 'definitely_not_charged'
  | 'potentially_charged'
  | 'settled_from_provider'
  | 'unknown';

/**
 * Qué permite el CONTRATO del proveedor sobre reintentar esta misma petición.
 *
 * `retryable_by_contract`        — Lusha confirmó 0 créditos; reintentar no duplica cargo.
 * `safe_to_retry_not_dispatched` — la petición nunca salió; no hay nada que duplicar.
 * `do_not_automatically_retry`   — reintentar a ciegas puede duplicar un cargo real.
 */
export type LushaRetryContract =
  | 'retryable_by_contract'
  | 'safe_to_retry_not_dispatched'
  | 'do_not_automatically_retry';

export type LushaProspectingOutcome = {
  outcomeClass: LushaProspectingOutcomeClass;
  /** Código estático, seguro de loggear y de comparar en tests. */
  code: string;
  /** null cuando no hubo respuesta HTTP (pre-envío, timeout, fallo de red). */
  httpStatus: number | null;
  /**
   * 🔴 true en cuanto `fetch()` fue INVOCADO. No afirma que Lusha recibiera la
   * petición: afirma que este proceso ya no puede probar que NO la recibiera.
   */
  providerRequestDispatched: boolean;
  billingCertainty: LushaBillingCertainty;
  retryContract: LushaRetryContract;
};

// ─── Entrada ──────────────────────────────────────────────────────────────────

export type ClassifyLushaProspectingInput = {
  /** Status HTTP; null si nunca llegó respuesta. */
  httpStatus: number | null;
  /**
   * 🔴 true si `fetch()` llegó a invocarse.
   *
   * Sólo puede ser false cuando el runtime PRUEBA que la petición no salió:
   * validación local previa al fetch, credencial ausente antes del fetch, gate de
   * presupuesto que rechazó antes del fetch. Un `TypeError: fetch failed` NO
   * prueba nada: puede ocurrir después de que los bytes salieran.
   */
  requestDispatched: boolean;
  /** true si el fallo fue timeout / abort. */
  timedOut?: boolean;
  /** true si hubo 2xx pero el cuerpo no era un objeto JSON interpretable. */
  malformedBody?: boolean;
  /**
   * Sólo para `success`: true si el propio response trajo liquidación
   * autoritativa, es decir un `billing.creditsCharged` LEÍBLE. Sin ella la
   * certeza es `unknown`: la búsqueda salió bien, pero el importe no lo dijo
   * nadie.
   *
   * 🔴 La PRESENCIA del bloque `billing` NO es liquidación. Un `{"billing": {}}`
   * no dice cuánto se cobró, así que publicarlo como `settled_from_provider`
   * afirmaría una autoridad que el proveedor no ejerció. El único juez es el
   * valor ya parseado — se pregunta con
   * `lushaBillingSettledFromParsedCredits()`.
   */
  billingSettledByProvider?: boolean;
};

// ─── Clasificación ────────────────────────────────────────────────────────────

/**
 * Clasifica el desenlace de UNA petición de Lusha Company Prospecting.
 *
 * ── La precedencia es el módulo entero ───────────────────────────────────────
 *
 * Primero lo que se puede PROBAR sobre el despacho, después la incertidumbre
 * post-envío, y sólo al final la lectura del status. Al revés, un 499 se leería
 * como «otro 4xx» y perdería justo la distinción que hace falta proteger.
 */
export function classifyLushaProspectingOutcome(
  input: ClassifyLushaProspectingInput,
): LushaProspectingOutcome {
  const status = input.httpStatus;

  // ── 1. PROBADO pre-envío ───────────────────────────────────────────────────
  //
  // La única rama que puede afirmar `definitely_not_charged` sin respaldo del
  // proveedor, porque no hubo proveedor: la petición no salió de este proceso.
  if (input.requestDispatched === false) {
    return {
      outcomeClass: 'local_pre_dispatch_failure',
      code: 'lusha_prospecting_not_dispatched',
      httpStatus: null,
      providerRequestDispatched: false,
      billingCertainty: 'definitely_not_charged',
      retryContract: 'safe_to_retry_not_dispatched',
    };
  }

  // ── 2. Despachada y sin desenlace terminal ─────────────────────────────────
  //
  // Timeout, aborto, conexión cerrada, socket colgado, `fetch failed` genérico:
  // todos caen aquí porque NINGUNO prueba que Lusha no procesara la consulta.
  // Sin Idempotency-Key ni API de recuperación, este estado es terminal para la
  // automatización: sólo un humano puede decidir repetirlo.
  if (status === null || status === undefined) {
    return {
      outcomeClass: 'post_send_indeterminate',
      code: input.timedOut === true
        ? 'lusha_prospecting_timeout_after_dispatch'
        : 'lusha_prospecting_transport_failure_after_dispatch',
      httpStatus: null,
      providerRequestDispatched: true,
      billingCertainty: 'potentially_charged',
      retryContract: 'do_not_automatically_retry',
    };
  }

  // ── 3. 499 — literal, ANTES de la lectura genérica de 4xx ──────────────────
  //
  // 499 significa que el cliente cerró una petición que el servidor ya estaba
  // atendiendo. Es exactamente el caso indeterminado del contrato humano, sólo
  // que con número. Dejarlo caer en `http_4xx_non_retryable` lo convertiría en un
  // error de cliente ordinario y borraría la incertidumbre de cobro.
  if (status === 499) {
    return {
      outcomeClass: 'post_send_indeterminate',
      code: 'lusha_prospecting_http_499_indeterminate',
      httpStatus: 499,
      providerRequestDispatched: true,
      billingCertainty: 'potentially_charged',
      retryContract: 'do_not_automatically_retry',
    };
  }

  // ── 4. 2xx con cuerpo ilegible ─────────────────────────────────────────────
  //
  // 🔴 Un 2xx malformado NO equivale a un 5xx confirmado. El servidor pudo
  // completar una operación facturable y ser SellUp quien no supo leer la
  // respuesta. Por eso `potentially_charged` y no `definitely_not_charged`, y por
  // eso jamás se degrada a «página vacía exitosa».
  if (input.malformedBody === true) {
    return {
      outcomeClass: 'malformed_success_payload',
      code: 'lusha_prospecting_malformed_success_payload',
      httpStatus: status,
      providerRequestDispatched: true,
      billingCertainty: 'potentially_charged',
      retryContract: 'do_not_automatically_retry',
    };
  }

  // ── 5. 429 — contrato humano: 0 créditos ───────────────────────────────────
  //
  // `retryable_by_contract` describe lo que Lusha permite, NO algo que este corte
  // ejecute: CUT-L2 no añade backoff ni reintentos.
  if (status === 429) {
    return {
      outcomeClass: 'http_429_rate_limited',
      code: 'lusha_prospecting_http_429_rate_limited',
      httpStatus: 429,
      providerRequestDispatched: true,
      billingCertainty: 'definitely_not_charged',
      retryContract: 'retryable_by_contract',
    };
  }

  // ── 6. 5xx — contrato humano: 0 créditos ───────────────────────────────────
  if (status >= 500) {
    return {
      outcomeClass: 'http_5xx_provider_failure',
      code: `lusha_prospecting_http_${status}_provider_failure`,
      httpStatus: status,
      providerRequestDispatched: true,
      billingCertainty: 'definitely_not_charged',
      retryContract: 'retryable_by_contract',
    };
  }

  // ── 7. Resto de 4xx ────────────────────────────────────────────────────────
  //
  // 🔴 `unknown`, NUNCA `definitely_not_charged`. El soporte humano confirmó cero
  // créditos para 429 y para 5xx; de 400/401/402/403/404/409/422/451 no dijo
  // nada. Extender la garantía del 429 a todos sus vecinos de rango sería
  // inventar contrato, y hacia el lado que nos conviene.
  if (status >= 400) {
    return {
      outcomeClass: 'http_4xx_non_retryable',
      code: `lusha_prospecting_http_${status}_non_retryable`,
      httpStatus: status,
      providerRequestDispatched: true,
      billingCertainty: 'unknown',
      retryContract: 'do_not_automatically_retry',
    };
  }

  // ── 8. Éxito ───────────────────────────────────────────────────────────────
  //
  // `do_not_automatically_retry` no es una restricción molesta: repetir una
  // búsqueda que YA salió bien es exactamente pagarla dos veces.
  //
  // 🔴 `settled_from_provider` exige un importe LEÍDO, no un bloque `billing`
  // presente: ver `lushaBillingSettledFromParsedCredits()` más abajo.
  if (status >= 200 && status < 300) {
    return {
      outcomeClass: 'success',
      code: 'lusha_prospecting_success',
      httpStatus: status,
      providerRequestDispatched: true,
      billingCertainty:
        input.billingSettledByProvider === true ? 'settled_from_provider' : 'unknown',
      retryContract: 'do_not_automatically_retry',
    };
  }

  // ── 9. Cualquier otro status (1xx/3xx inesperado) ──────────────────────────
  //
  // Se despachó y no encaja en ninguna lectura conocida ⇒ se degrada CERRADO.
  return {
    outcomeClass: 'http_4xx_non_retryable',
    code: `lusha_prospecting_http_${status}_unclassified`,
    httpStatus: status,
    providerRequestDispatched: true,
    billingCertainty: 'unknown',
    retryContract: 'do_not_automatically_retry',
  };
}

// ─── Autoridad de liquidación ─────────────────────────────────────────────────

/**
 * ¿El propio response LIQUIDÓ el importe de este intento?
 *
 * El contrato HUMANO de Lusha nombra un único dato autoritativo del cargo real:
 * `billing.creditsCharged`. De ahí la regla de este predicado:
 *
 *     importe parseado LEÍBLE   ⇒ `settled_from_provider`
 *     importe parseado ausente  ⇒ `unknown`
 *
 * 🔴 Lo que NO cuenta como liquidación: que el bloque `billing` exista. Un
 * `{"billing": {}}` es un sobre vacío — el proveedor no dijo cuánto cobró, y
 * derivar certeza de la presencia del sobre publicaba `settled_from_provider`
 * junto a un `creditsCharged: null`, dos afirmaciones que se contradicen.
 *
 * 🔴 Y lo que tampoco hace: inferir cero. Un importe ilegible NO se convierte en
 * «no costó nada»; se convierte en `unknown`, que es lo que de verdad se sabe.
 *
 * Recibe el valor YA parseado por el extractor de billing del cliente: este
 * corte no añade un segundo parser de facturación. `Number.isFinite` sólo
 * descarta `NaN`/`Infinity`, que no son importes leídos; el `0` explícito SÍ es
 * un valor real del proveedor y liquida.
 */
export function lushaBillingSettledFromParsedCredits(
  creditsCharged: number | null | undefined,
): boolean {
  return typeof creditsCharged === 'number' && Number.isFinite(creditsCharged);
}

// ─── Consulta de replay ───────────────────────────────────────────────────────

/**
 * ¿Puede una automatización repetir esta MISMA petición sin intervención humana?
 *
 * Punto único de consulta a propósito: si mañana aparece un motor de reintentos
 * (CUT-L4), tiene que preguntar AQUÍ y no reimplementar la tabla. Un
 * `post_send_indeterminate` devuelve false, que es la valla semántica del § H.
 */
export function mayAutomaticallyRetryLushaProspecting(
  outcome: Pick<LushaProspectingOutcome, 'retryContract'>,
): boolean {
  return (
    outcome.retryContract === 'retryable_by_contract' ||
    outcome.retryContract === 'safe_to_retry_not_dispatched'
  );
}

/**
 * ¿Este desenlace deja abierta la posibilidad de un cargo real?
 *
 * Útil para reconciliación de presupuesto y para no publicar «no se gastó nada»
 * cuando lo honesto es «no lo sabemos».
 */
export function lushaOutcomeMayHaveBeenCharged(
  outcome: Pick<LushaProspectingOutcome, 'billingCertainty'>,
): boolean {
  return outcome.billingCertainty !== 'definitely_not_charged';
}
