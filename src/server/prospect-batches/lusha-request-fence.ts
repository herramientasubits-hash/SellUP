/**
 * AGENT1-LUSHA-CUT-L3 — la VALLA DURABLE de una petición de Lusha Prospecting.
 *
 * ── La ventana que este módulo cierra ────────────────────────────────────────
 *
 * CUT-L2 dejó escrito, con todas las letras, el límite de su propia frontera de
 * despacho: es de MEMORIA. Un `let providerRequestDispatched = false` dentro de
 * `searchLushaCompaniesV3` sabe si los bytes pudieron salir mientras el proceso
 * viva. Si el proceso MUERE entre el `fetch()` y la clasificación, esa verdad se
 * pierde con él, y al reanudar SellUp no tiene ningún testigo de que la petición
 * existió. Con la reserva de corrida devolviendo `already_reserved` sobre el
 * mismo `client_request_id`, la corrida se vuelve a ejecutar y vuelve a pedir la
 * MISMA página al proveedor.
 *
 * El soporte HUMANO de Lusha confirmó que eso puede costar dos veces:
 *
 *     NO hay Idempotency-Key.
 *     NO hay requestId suministrado por el cliente.
 *     NO hay API de recuperación de la respuesta.
 *
 * De ahí la regla central del corte, y es de ORDEN, no de intención:
 *
 *     escribir DURABLEMENTE que la petición puede salir
 *       → COMMIT
 *         → sólo entonces `fetch()`
 *
 * ── El sesgo, dicho antes de que alguien lo descubra ─────────────────────────
 *
 * 🔴 El estado `dispatch_unsafe` NO afirma «Lusha recibió la petición». Afirma
 * «SellUp ya no puede reanudar esto solo». Si el proceso cae DESPUÉS de marcar y
 * ANTES de que salga un byte, la petición queda suprimida sin haber costado nada.
 * Eso es una pérdida de COMPLETITUD, y se acepta a cambio de no volver a cobrar
 * una búsqueda que quizá ya se pagó. La dirección contraria —suponer que no
 * salió— es la que duplica cargos.
 *
 * ── Por qué NO se reutiliza la valla de página de Apollo ─────────────────────
 *
 * Agente 1 YA tiene una: `apollo-two-round/page-fence.ts`, con estados
 * `request_started | succeeded | indeterminate` y la misma intuición de fondo. Se
 * evaluó y NO sirve aquí, por tres razones concretas — ninguna de estilo:
 *
 *   1. DÓNDE VIVE. La de Apollo aterriza en `prospect_batches.metadata`, es decir
 *      exige que la fila del lote YA exista. En la ruta de Lusha las peticiones
 *      pagadas ocurren DENTRO de `persistLushaPendingReviewBatch`, antes de que
 *      `reserveBatch` materialice nada, y la mitad gratuita puede no haber escrito
 *      lote ninguno (`prePaid.batchId === null`). No hay fila a la que colgarse.
 *   2. ATOMICIDAD. Un merge de JSONB es leer-modificar-escribir: puede converger,
 *      pero no puede conceder «exactamente un trabajador gana». El § 8 de este
 *      corte exige reclamo atómico, y eso pide una unicidad de la BASE.
 *   3. CREDENCIAL. `prospect_batches.metadata` lo escribe el cliente de SESIÓN
 *      bajo RLS. Una valla de gasto que el usuario puede escribir no es una valla.
 *
 * Lo que sí se toma de allí es el CRITERIO —el vocabulario de estados y la
 * disciplina de no guardar payload— no la implementación. La semántica de
 * facturación sigue siendo la de Lusha, y sale de CUT-L2.
 *
 * ── Lo que este módulo NO hace ───────────────────────────────────────────────
 *
 * NO reintenta. Ni un `429` ni un `5xx`, que CUT-L2 clasifica como
 * `retryable_by_contract`, se vuelven a pedir aquí: eso describe lo que el
 * proveedor PERMITE, y ejecutarlo es CUT-L4. En CUT-L3, CUALQUIER fila de valla
 * existente bloquea la re-ejecución.
 *
 * NO reinterpreta la facturación. El estado terminal se DERIVA de la taxonomía de
 * CUT-L2 (`classifyLushaProspectingOutcome`), que sigue siendo la única autoridad.
 *
 * NO conoce Supabase, ni entorno, ni reloj, ni red. La persistencia llega
 * inyectada como `LushaRequestFenceStore`.
 */

import type {
  LushaProspectingOutcomeClass,
  LushaBillingCertainty,
} from '@/server/integrations/lusha-prospecting-failure-taxonomy';

// ─── Identidad ────────────────────────────────────────────────────────────────

/**
 * Versión del formato de la clave. Cambiarla INVALIDA todas las vallas vivas —
 * es decir, autoriza a repetir peticiones que ya tenían fila. No se toca sin
 * entender eso.
 */
export const LUSHA_REQUEST_FENCE_KEY_VERSION = 'v2';

/** Prefijo del espacio de nombres: esta valla es de Prospecting de Agente 1. */
export const LUSHA_REQUEST_FENCE_NAMESPACE = 'lusha_prospecting';

/** Separador de la clave. Ningún componente puede contenerlo. */
const KEY_SEPARATOR = '|';

/**
 * Qué distingue UNA petición lógica de Prospecting de otra.
 *
 * 🔴 `operationId` lo acuña el SERVIDOR —`lusha_prospecting_operations`— y
 * sobrevive al reinicio. Ésa es la corrección entera de este arreglo. La versión
 * anterior usaba aquí `clientRequestId`, que lo genera el NAVEGADOR con
 * `crypto.randomUUID()` y por tanto es fresco por clic:
 *
 *     el proceso cae
 *       → la valla previa queda `dispatch_unsafe`
 *         → la usuaria vuelve a hacer clic
 *           → clientRequestId NUEVO ⇒ clave de valla NUEVA
 *             → la MISMA página lógica podía volver a llegar a Lusha
 *
 * Con `operationId`, un clic nuevo se reencuentra con la MISMA operación por
 * (actor, firma canónica) y por tanto reconstruye las MISMAS claves de valla.
 *
 * 🔴 `branchIndex` y `page` NO son decoración. Una corrida multi-rama pide varias
 * páginas por rama; colapsarlas haría que la página 1 heredara la valla de la 0 y
 * la corrida se cortaría sola tras la primera petición legítima.
 */
export type LushaRequestFenceIdentity = {
  /** Identidad DURABLE de la operación lógica, acuñada por el servidor. */
  operationId: string;
  /** Índice de rama dentro del plan de la corrida. */
  branchIndex: number;
  /** Página solicitada al proveedor, base 0. */
  page: number;
};

/** Contexto NO identificante que acompaña la fila. Sólo ids internos y cifras. */
export type LushaRequestFenceContext = {
  /** Usuario interno que disparó la corrida. */
  triggeredByUserId: string | null;
  /** Reserva de presupuesto viva. Evidencia, NUNCA parte de la clave — ver abajo. */
  reservationId: string | null;
  /**
   * Uuid del navegador. TRAZA de correlación con la reserva y con el lote.
   *
   * 🔴 Se conserva a propósito: dejó de ser autoridad de replay, no dejó de ser
   * útil. Quitar observabilidad no era el objetivo del arreglo.
   */
  clientRequestId: string | null;
};

/** El id de petición de Lusha NO puede ser clave de valla. Ver `§ 12`. */
export class LushaRequestFenceIdentityError extends Error {}

function assertKeyComponent(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LushaRequestFenceIdentityError(
      `lusha_request_fence_identity_incomplete:${field}`,
    );
  }
  if (value.includes(KEY_SEPARATOR)) {
    throw new LushaRequestFenceIdentityError(
      `lusha_request_fence_identity_separator:${field}`,
    );
  }
  return value.trim();
}

function assertIndex(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new LushaRequestFenceIdentityError(
      `lusha_request_fence_identity_index:${field}`,
    );
  }
  return value;
}

/**
 * Clave determinista de UNA petición lógica.
 *
 * Texto plano y legible a propósito: se puede leer en la tabla y correlacionar
 * con la corrida sin desenrollar un hash. No lleva país, sector, dominio ni
 * ningún dato de empresa — sólo un uuid de ejecución y dos índices.
 *
 * 🔴 NO incluye `reservationId`. Suena tentador («es la generación de la
 * corrida») y es justo al revés: si una reserva se recreara para la misma
 * operación, meterla en la clave acuñaría una identidad NUEVA para una petición
 * VIEJA y autorizaría el replay que este corte existe para impedir. Se guarda en
 * la fila como evidencia, no como identidad.
 *
 * 🔴 NO incluye `clientRequestId`. Es fresco por clic, así que meterlo devolvería
 * exactamente el defecto que este arreglo cierra: una caída seguida de un clic
 * nuevo acuñaría clave virgen y la misma página podría volver a comprarse.
 *
 * 🔴 NO incluye el `x-request-id` de Lusha: ese valor sólo existe DESPUÉS de que
 * el proveedor responda, así que no puede vallar nada anterior al envío.
 */
export function buildLushaRequestFenceKey(identity: LushaRequestFenceIdentity): string {
  const operationId = assertKeyComponent(identity.operationId, 'operationId');
  const branchIndex = assertIndex(identity.branchIndex, 'branchIndex');
  const page = assertIndex(identity.page, 'page');
  return [
    LUSHA_REQUEST_FENCE_NAMESPACE,
    LUSHA_REQUEST_FENCE_KEY_VERSION,
    operationId,
    `b${branchIndex}`,
    `p${page}`,
  ].join(KEY_SEPARATOR);
}

// ─── Estados durables ─────────────────────────────────────────────────────────

/**
 * El estado más pequeño que representa el contrato con verdad.
 *
 *   `prepared`               — fila durable creada. El proveedor NO se ha tocado.
 *   `dispatch_unsafe`        — cruzada la frontera: la petición PUDO salir.
 *   `succeeded`              — respuesta válida recibida y registrada.
 *   `definitely_not_charged` — 429 / 5xx / rechazo local PROBADO antes del envío.
 *   `indeterminate`          — 499, timeout post-envío, 2xx ilegible.
 *   `unknown`                — 4xx genérico: nadie confirmó nada sobre el cobro.
 *
 * 🔴 `definitely_not_charged` NO habilita reintento en CUT-L3. Describe el
 * CONTRATO (lo que CUT-L4 podrá aprovechar), no una acción de este corte.
 */
export type LushaRequestFenceState =
  | 'prepared'
  | 'dispatch_unsafe'
  | 'succeeded'
  | 'definitely_not_charged'
  | 'indeterminate'
  | 'unknown';

export const LUSHA_REQUEST_FENCE_STATES: readonly LushaRequestFenceState[] = [
  'prepared',
  'dispatch_unsafe',
  'succeeded',
  'definitely_not_charged',
  'indeterminate',
  'unknown',
];

/** Estados que ya no admiten ninguna transición. */
export const LUSHA_REQUEST_FENCE_TERMINAL_STATES: readonly LushaRequestFenceState[] = [
  'succeeded',
  'definitely_not_charged',
  'indeterminate',
  'unknown',
];

export function isLushaRequestFenceTerminalState(
  state: LushaRequestFenceState,
): boolean {
  return LUSHA_REQUEST_FENCE_TERMINAL_STATES.includes(state);
}

/**
 * Estado terminal a partir del desenlace CANÓNICO de CUT-L2.
 *
 * 🔴 Una sola verdad: aquí no se vuelve a leer el status HTTP ni se reconstruye
 * la tabla del soporte humano. Se consume `outcomeClass`, que ya la aplicó.
 */
export function resolveLushaRequestFenceTerminalState(
  outcomeClass: LushaProspectingOutcomeClass,
): LushaRequestFenceState {
  switch (outcomeClass) {
    case 'success':
      return 'succeeded';
    case 'http_429_rate_limited':
    case 'http_5xx_provider_failure':
    case 'local_pre_dispatch_failure':
      return 'definitely_not_charged';
    case 'post_send_indeterminate':
    case 'malformed_success_payload':
      return 'indeterminate';
    case 'http_4xx_non_retryable':
      return 'unknown';
    default: {
      // Degrada CERRADO: una clase desconocida jamás se lee como «no costó».
      return 'indeterminate';
    }
  }
}

/**
 * ¿Una fila en este estado autoriza a que CUT-L3 vuelva a pedir al proveedor?
 *
 * NUNCA. Ni siquiera `prepared`, y la razón es que `prepared` es AMBIGUO: puede
 * ser un trabajador vivo a mitad de vuelo (que no debe duplicarse) o un proceso
 * muerto antes del envío (que sería seguro repetir). Sin lease ni latido no se
 * distinguen, y equivocarse hacia «estaba muerto» es exactamente cómo se paga dos
 * veces. Se bloquea, y la pérdida se declara.
 */
export function mayReExecuteLushaFencedRequest(): boolean {
  return false;
}

// ─── Persistencia inyectada ───────────────────────────────────────────────────

/** Evidencia terminal. Cifras, estados e ids internos: nunca payload del proveedor. */
export type LushaRequestFenceSettlement = {
  state: LushaRequestFenceState;
  outcomeClass: LushaProspectingOutcomeClass | null;
  billingCertainty: LushaBillingCertainty | null;
  retryContract: string | null;
  httpStatus: number | null;
  /** `x-request-id` de Lusha. TRAZA, jamás clave ni autoridad de replay. */
  providerRequestId: string | null;
  creditsCharged: number | null;
  resultsReturned: number | null;
  rateLimit: {
    minuteLimit: number | null;
    minuteRemaining: number | null;
    dailyLimit: number | null;
    dailyRemaining: number | null;
  } | null;
};

export type LushaRequestFenceClaimResult =
  | { status: 'claimed' }
  | { status: 'already_claimed'; state: LushaRequestFenceState }
  /** La migración 134 no está aplicada. Fallo CERRADO en el llamador. */
  | { status: 'capability_absent' }
  | { status: 'failed'; code: string };

export type LushaRequestFenceDispatchMarkResult =
  | { status: 'marked' }
  | { status: 'not_claimable'; state: LushaRequestFenceState | null }
  | { status: 'capability_absent' }
  | { status: 'failed'; code: string };

export type LushaRequestFenceSettleResult =
  | { status: 'settled' }
  | { status: 'already_terminal'; state: LushaRequestFenceState }
  | { status: 'not_found' }
  | { status: 'capability_absent' }
  | { status: 'failed'; code: string };

/**
 * La frontera durable. Tres operaciones, cada una su propia transacción
 * COMPROMETIDA — que estén separadas es el corte entero: si `markDispatchUnsafe`
 * compartiera transacción con la respuesta, una caída dura las perdería juntas.
 */
export type LushaRequestFenceStore = {
  claim: (
    identity: LushaRequestFenceIdentity,
    context: LushaRequestFenceContext,
  ) => Promise<LushaRequestFenceClaimResult>;
  markDispatchUnsafe: (fenceKey: string) => Promise<LushaRequestFenceDispatchMarkResult>;
  settle: (
    fenceKey: string,
    settlement: LushaRequestFenceSettlement,
  ) => Promise<LushaRequestFenceSettleResult>;
};

// ─── Bloqueo ──────────────────────────────────────────────────────────────────

export type LushaRequestFenceBlockedReason =
  /** Ya existe fila para esta petición lógica: otro trabajador o una corrida previa. */
  | 'already_fenced'
  /** La 134 no está aplicada: sin valla no se despacha. */
  | 'capability_absent'
  /** La valla no pudo escribirse (RPC caída, credencial ausente, identidad inválida). */
  | 'fence_unavailable';

export type LushaRequestFenceBlock = {
  reason: LushaRequestFenceBlockedReason;
  /** Estado que bloqueó, cuando lo hubo. `null` para averías. */
  state: LushaRequestFenceState | null;
  /** Código estable, seguro de loggear y de comparar en pruebas. */
  code: string;
};

/** Códigos estables del bloqueo. */
export const LUSHA_REQUEST_FENCE_BLOCKED_CODE = 'lusha_request_fence_blocked' as const;
export const LUSHA_REQUEST_FENCE_CAPABILITY_ABSENT_CODE =
  'lusha_request_fence_capability_absent' as const;
export const LUSHA_REQUEST_FENCE_UNAVAILABLE_CODE =
  'lusha_request_fence_unavailable' as const;

/** Se lanza cuando la marca de despacho no se pudo comprometer. Aborta el envío. */
export class LushaRequestFenceDispatchDenied extends Error {
  readonly block: LushaRequestFenceBlock;
  constructor(block: LushaRequestFenceBlock) {
    super(block.code);
    this.name = 'LushaRequestFenceDispatchDenied';
    this.block = block;
  }
}

// ─── El orden ─────────────────────────────────────────────────────────────────

/**
 * Lo que el ejecutor devuelve por cada petición vallada, ya sea porque corrió o
 * porque la valla la detuvo.
 */
export type FencedLushaRequestOutcome<T> =
  | { status: 'executed'; result: T; fenceKey: string; dispatchMarked: boolean }
  | { status: 'blocked'; block: LushaRequestFenceBlock; fenceKey: string | null };

/**
 * Ejecuta UNA petición de Prospecting detrás de la valla durable.
 *
 * El orden, que es la propiedad entera:
 *
 *   1. `claim` — INSERT atómico. Si la fila ya existe, se BLOQUEA y `run` no se
 *      invoca: el proveedor es inalcanzable desde aquí (§ 8, § 15).
 *   2. `run(beforeDispatch)` — el trabajo real recibe un callback. Ese callback
 *      es lo ÚNICO que puede autorizar el envío, y su implementación es una
 *      transacción durable COMPROMETIDA. El llamador lo invoca inmediatamente
 *      antes de `fetch()`.
 *   3. `settle` — el desenlace de CUT-L2 se deriva a estado terminal y se graba.
 *
 * 🔴 `settle` es best-effort y NUNCA lanza: la contabilidad no puede tumbar una
 * corrida que el proveedor ya cobró. Lo que sí queda es la fila en
 * `dispatch_unsafe`, que es el estado SEGURO —no replayable— si la liquidación
 * falla.
 *
 * 🔴 Si `run` LANZA, se liquida igual: `indeterminate` si la marca llegó a
 * comprometerse, `definitely_not_charged` si no. Esa segunda mitad sólo es
 * legítima porque la marca es la última instrucción antes del `fetch()`: sin
 * marca no hubo envío.
 */
export async function runFencedLushaProspectingRequest<T>(args: {
  store: LushaRequestFenceStore;
  identity: LushaRequestFenceIdentity;
  context: LushaRequestFenceContext;
  run: (beforeDispatch: () => Promise<void>) => Promise<T>;
  /** Deriva la evidencia terminal del resultado. `null` ⇒ desenlace ilegible. */
  settlementFrom: (result: T) => LushaRequestFenceSettlement | null;
  /** Telemetría segura. Nunca lanza hacia arriba. */
  onSettlementIssue?: (issue: { fenceKey: string; code: string }) => void;
}): Promise<FencedLushaRequestOutcome<T>> {
  const { store, identity, context, run, settlementFrom, onSettlementIssue } = args;

  let fenceKey: string;
  try {
    fenceKey = buildLushaRequestFenceKey(identity);
  } catch (err: unknown) {
    return {
      status: 'blocked',
      fenceKey: null,
      block: {
        reason: 'fence_unavailable',
        state: null,
        code:
          err instanceof LushaRequestFenceIdentityError
            ? err.message
            : LUSHA_REQUEST_FENCE_UNAVAILABLE_CODE,
      },
    };
  }

  let claim: LushaRequestFenceClaimResult;
  try {
    claim = await store.claim(identity, context);
  } catch {
    // Sin valla no se despacha. Fallo CERRADO, igual que la puerta de presupuesto.
    return {
      status: 'blocked',
      fenceKey,
      block: {
        reason: 'fence_unavailable',
        state: null,
        code: LUSHA_REQUEST_FENCE_UNAVAILABLE_CODE,
      },
    };
  }

  if (claim.status === 'already_claimed') {
    return {
      status: 'blocked',
      fenceKey,
      block: {
        reason: 'already_fenced',
        state: claim.state,
        code: `${LUSHA_REQUEST_FENCE_BLOCKED_CODE}_${claim.state}`,
      },
    };
  }
  if (claim.status === 'capability_absent') {
    return {
      status: 'blocked',
      fenceKey,
      block: {
        reason: 'capability_absent',
        state: null,
        code: LUSHA_REQUEST_FENCE_CAPABILITY_ABSENT_CODE,
      },
    };
  }
  if (claim.status === 'failed') {
    return {
      status: 'blocked',
      fenceKey,
      block: {
        reason: 'fence_unavailable',
        state: null,
        code: claim.code || LUSHA_REQUEST_FENCE_UNAVAILABLE_CODE,
      },
    };
  }

  let dispatchMarked = false;
  /**
   * La marca fue DENEGADA. Importa por una razón concreta: cuando la fila la
   * gobierna otro dueño, liquidarla desde aquí reescribiría SU estado —un
   * `dispatch_unsafe` ajeno degradado a «no cobrado»— y borraría justo la
   * incertidumbre que hay que conservar. Denegada ⇒ no se liquida nada.
   */
  let dispatchDenied = false;

  const beforeDispatch = async (): Promise<void> => {
    const marked = await store.markDispatchUnsafe(fenceKey);
    if (marked.status === 'marked') {
      dispatchMarked = true;
      return;
    }
    dispatchDenied = true;
    const block: LushaRequestFenceBlock =
      marked.status === 'not_claimable'
        ? {
            reason: 'already_fenced',
            state: marked.state,
            code: `${LUSHA_REQUEST_FENCE_BLOCKED_CODE}_${marked.state ?? 'missing'}`,
          }
        : marked.status === 'capability_absent'
          ? {
              reason: 'capability_absent',
              state: null,
              code: LUSHA_REQUEST_FENCE_CAPABILITY_ABSENT_CODE,
            }
          : {
              reason: 'fence_unavailable',
              state: null,
              code: marked.code || LUSHA_REQUEST_FENCE_UNAVAILABLE_CODE,
            };
    throw new LushaRequestFenceDispatchDenied(block);
  };

  const settleQuietly = async (settlement: LushaRequestFenceSettlement): Promise<void> => {
    try {
      const settled = await store.settle(fenceKey, settlement);
      if (settled.status === 'failed' || settled.status === 'capability_absent') {
        onSettlementIssue?.({ fenceKey, code: settled.status === 'failed' ? settled.code : LUSHA_REQUEST_FENCE_CAPABILITY_ABSENT_CODE });
      }
    } catch {
      onSettlementIssue?.({ fenceKey, code: 'lusha_request_fence_settle_threw' });
    }
  };

  try {
    const result = await run(beforeDispatch);
    if (!dispatchDenied) {
      const settlement = settlementFrom(result);
      await settleQuietly(settlement ?? unreadableSettlement(dispatchMarked));
    }
    return { status: 'executed', result, fenceKey, dispatchMarked };
  } catch (err: unknown) {
    if (!dispatchDenied) await settleQuietly(unreadableSettlement(dispatchMarked));
    throw err;
  }
}

/**
 * Liquidación cuando no hay desenlace legible: o el ejecutor lanzó, o el
 * resultado no traía `providerOutcome`.
 *
 * 🔴 El sesgo es asimétrico A PROPÓSITO. Con marca comprometida ⇒ `indeterminate`
 * (pudo cobrarse). Sin marca ⇒ `definitely_not_charged`, y eso sólo es afirmable
 * porque la marca es la ÚLTIMA instrucción antes del `fetch()`.
 */
function unreadableSettlement(dispatchMarked: boolean): LushaRequestFenceSettlement {
  return {
    state: dispatchMarked ? 'indeterminate' : 'definitely_not_charged',
    outcomeClass: dispatchMarked ? 'post_send_indeterminate' : 'local_pre_dispatch_failure',
    billingCertainty: dispatchMarked ? 'potentially_charged' : 'definitely_not_charged',
    retryContract: dispatchMarked
      ? 'do_not_automatically_retry'
      : 'safe_to_retry_not_dispatched',
    httpStatus: null,
    providerRequestId: null,
    creditsCharged: null,
    resultsReturned: null,
    rateLimit: null,
  };
}
