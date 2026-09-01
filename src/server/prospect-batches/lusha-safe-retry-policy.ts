/**
 * AGENT1-LUSHA-CUT-L4 — la POLÍTICA de reintento seguro. Pura y diminuta.
 *
 * ── Qué decide, y qué se niega a decidir ─────────────────────────────────────
 *
 * Decide UNA cosa: si el desenlace durable de un intento autoriza a hacer OTRA
 * llamada al proveedor. Nada más. No sabe de HTTP, no lee status, no conoce la
 * tabla del soporte humano.
 *
 * 🔴 Eso último es el punto. La tabla vive en `classifyLushaProspectingOutcome`
 * (CUT-L2) y es la ÚNICA autoridad. Aquí sólo se CONSUME su veredicto ya
 * canónico. Reimplementar «429 y 5xx son seguros» en un segundo sitio habría
 * creado dos verdades que pueden divergir, y la que cuesta dinero es la que se
 * quedaría desactualizada.
 *
 * ── Por qué NO se usa `mayAutomaticallyRetryLushaProspecting` ────────────────
 *
 * Existe, es de CUT-L2, y devuelve `true` también para
 * `safe_to_retry_not_dispatched`. Eso es CIERTO —un rechazo local previo al envío
 * no costó nada— y sin embargo NO es el alcance de CUT-L4:
 *
 *     un rechazo local es un fallo de SellUp, no del proveedor.
 *     Repetirlo automáticamente repite el mismo fallo mientras la causa siga ahí,
 *     y lo hace un segundo después.
 *
 * CUT-L4 se limita a lo que el proveedor CONFIRMÓ por soporte HUMANO: 429 y 5xx
 * devuelven 0 créditos. Por eso este módulo es más ESTRECHO que el predicado de
 * CUT-L2, y por eso lo llama además de exigir la clase: si un día la taxonomía se
 * ensanchara, esta puerta seguiría igual de angosta.
 *
 * ── Sin reloj y sin red ──────────────────────────────────────────────────────
 *
 * La espera se inyecta (`LushaRetrySleep`). En pruebas es `async () => {}` y la
 * suite no espera un segundo real; en producción es un temporizador. Un módulo de
 * política que llamara a `setTimeout` por su cuenta sería un módulo que no se
 * puede probar sin esperar.
 */

import type {
  LushaBillingCertainty,
  LushaProspectingOutcomeClass,
  LushaRetryContract,
} from '@/server/integrations/lusha-prospecting-failure-taxonomy';
import { mayAutomaticallyRetryLushaProspecting } from '@/server/integrations/lusha-prospecting-failure-taxonomy';

// ─── Los dos números del corte ────────────────────────────────────────────────

/**
 * Intentos por petición LÓGICA: el original y, como mucho, UN reintento.
 *
 * 🔴 No es el techo real, es su MITAD DE RUNTIME. La otra mitad es un CHECK de la
 * migración 136 (`attempt_no <= 2`). Que existan las dos es deliberado: un techo
 * con un solo guardia es una opinión, y subir esta constante sin migración no
 * consigue un tercer intento — la base lo rechaza.
 */
export const LUSHA_MAX_ATTEMPTS_PER_LOGICAL_REQUEST = 2 as const;

/**
 * Espera antes del reintento, en milisegundos.
 *
 * La guía pública de Lusha recomienda backoff exponencial para 429 y 5xx
 * empezando alrededor de 1 segundo. Como en CUT-L4 sólo existe UN reintento, no
 * hay segundo intervalo exponencial que calcular: hay un único retardo.
 *
 * 🔴 Y no se inventa `Retry-After`. El cliente actual no recibe ni valida esa
 * cabecera para Prospecting, así que honrarla sería fabricar un contrato.
 */
export const LUSHA_SAFE_RETRY_INITIAL_DELAY_MS = 1000 as const;

/**
 * Las ÚNICAS clases de desenlace que autorizan un reintento automático.
 *
 * Salen literalmente del contrato confirmado por un agente HUMANO de Lusha:
 * `429` y `5xx` devuelven 0 créditos de búsqueda y de datos.
 */
export const LUSHA_SAFE_RETRY_OUTCOME_CLASSES: readonly LushaProspectingOutcomeClass[] = [
  'http_429_rate_limited',
  'http_5xx_provider_failure',
];

// ─── La evidencia sobre la que se decide ──────────────────────────────────────

/**
 * Lo mínimo de un intento LIQUIDADO que hace falta para decidir.
 *
 * 🔴 Es una forma DURABLE, no un objeto en vuelo. La decisión se toma sobre lo
 * que la base tiene escrito del intento anterior; que el mismo proceso «recuerde»
 * haber visto un 429 no autoriza nada, porque un proceso que se reinició no
 * recuerda nada y tiene que llegar a la MISMA conclusión.
 */
export type LushaSettledAttemptEvidence = {
  attemptNo: number;
  state: string | null;
  outcomeClass: LushaProspectingOutcomeClass | null;
  billingCertainty: LushaBillingCertainty | null;
  retryContract: LushaRetryContract | string | null;
};

export type LushaSafeRetryDecision =
  | { allowed: true; nextAttemptNo: number }
  | { allowed: false; reason: LushaSafeRetryRefusal };

export type LushaSafeRetryRefusal =
  /** El desenlace no está entre los que el proveedor confirmó a 0 créditos. */
  | 'outcome_not_provably_free'
  /** El intento anterior no llegó a un estado terminal legible. */
  | 'attempt_not_settled'
  /** Ya se agotaron los intentos de este corte. */
  | 'attempts_exhausted';

/**
 * ¿Autoriza este intento liquidado a hacer OTRA llamada al proveedor?
 *
 * Las cuatro condiciones de facturación se exigen JUNTAS aunque hoy sean
 * redundantes entre sí. La redundancia es el diseño: si mañana una de ellas se
 * escribiera mal en alguna ruta, las otras tres siguen bloqueando. En el lado que
 * cuesta dinero, el AND es más barato que la confianza.
 */
export function decideLushaSafeRetry(
  evidence: LushaSettledAttemptEvidence,
): LushaSafeRetryDecision {
  if (evidence.state !== 'definitely_not_charged') {
    return { allowed: false, reason: 'attempt_not_settled' };
  }
  if (evidence.billingCertainty !== 'definitely_not_charged') {
    return { allowed: false, reason: 'outcome_not_provably_free' };
  }
  if (evidence.retryContract !== 'retryable_by_contract') {
    return { allowed: false, reason: 'outcome_not_provably_free' };
  }
  if (
    evidence.outcomeClass === null ||
    !LUSHA_SAFE_RETRY_OUTCOME_CLASSES.includes(evidence.outcomeClass)
  ) {
    return { allowed: false, reason: 'outcome_not_provably_free' };
  }
  // La puerta de CUT-L2, además de la clase. Más ancha que ésta, nunca más
  // estrecha: si algún día se cerrara allí, aquí deja de autorizarse también.
  if (!mayAutomaticallyRetryLushaProspecting({ retryContract: 'retryable_by_contract' })) {
    return { allowed: false, reason: 'outcome_not_provably_free' };
  }
  if (
    !Number.isInteger(evidence.attemptNo) ||
    evidence.attemptNo < 1 ||
    evidence.attemptNo >= LUSHA_MAX_ATTEMPTS_PER_LOGICAL_REQUEST
  ) {
    return { allowed: false, reason: 'attempts_exhausted' };
  }
  return { allowed: true, nextAttemptNo: evidence.attemptNo + 1 };
}

// ─── La espera, inyectada ─────────────────────────────────────────────────────

/** Espera inyectable. En pruebas, `async () => {}`. */
export type LushaRetrySleep = (ms: number) => Promise<void>;

/**
 * La espera de PRODUCCIÓN. Vive aquí y no en línea para que la política se pueda
 * importar sin arrastrar un temporizador, y para que la ruta real tenga un solo
 * sitio del que sacarla.
 */
export const lushaRealRetrySleep: LushaRetrySleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Espera nula. Es lo que usan las suites: la política no debe medir el tiempo. */
export const lushaNoopRetrySleep: LushaRetrySleep = async () => {};
