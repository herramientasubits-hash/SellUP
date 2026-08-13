// Error code → user-facing message map for wizard execution results.
// Kept in a separate module so tests can import it without a DOM environment.

import { presentProviderSkip } from './wizard-provider-execution-summary';
import type { WizardApolloSkipReason } from '@/modules/prospect-batches/chat-wizard-execution/wizard-apollo-availability';
import type { WizardExecutionFailureCode } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';

export type ExecutionErrorPresentation = { message: string; retryable: boolean };

// ── Copy de «la base no puede guardar» (A1-APOLLO-PERSISTENCE-READINESS-4-FIX) ─
//
// § 1 y § 2. Fragmentos separados porque los dos motivos comparten la segunda
// frase —la que niega el consumo— y difieren SÓLO en el diagnóstico. Escribir
// cada variante entera invitaba a que una edición futura corrigiera una y dejara
// la otra diciendo algo distinto sobre el gasto.

/** La columna de identidad no está: el esquema no admite la escritura. */
export const PERSISTENCE_NOT_READY_LEAD =
  'La base de datos no está preparada para guardar los candidatos.';

/**
 * La sonda no pudo leer. No se afirma que la base esté mal —se afirma que no se
 * sabe—, porque decir «no está preparada» ante una conexión caída sería una
 * conclusión que la señal no sostiene.
 */
export const PERSISTENCE_PROBE_FAILED_LEAD =
  'No fue posible verificar si la base de datos está preparada.';

/**
 * El hecho económico. Es cierto por construcción: el preflight corre antes de
 * estimar créditos, antes de reservar presupuesto y antes de cualquier llamada al
 * proveedor, así que un `PERSISTENCE_NOT_READY` no puede haber gastado nada.
 */
export const PERSISTENCE_NOT_READY_NO_SPEND =
  'La búsqueda no se ejecutó y no se consumieron créditos.';

/** Qué esperar. Nunca «vuelve a intentarlo ahora»: no hay nada que reintentar aún. */
export const PERSISTENCE_NOT_READY_REMEDIATION =
  'Intenta nuevamente después de que se corrija la configuración de almacenamiento.';

/**
 * Mensaje del código sin motivo estructurado. Lleva la remediación porque es el
 * único texto que el usuario va a leer: sin `persistenceNotReady` no hay nada más
 * concreto que decirle.
 */
export const PERSISTENCE_NOT_READY_BASE_MESSAGE = [
  PERSISTENCE_NOT_READY_LEAD,
  PERSISTENCE_NOT_READY_NO_SPEND,
  PERSISTENCE_NOT_READY_REMEDIATION,
].join(' ');

/**
 * § 2 — copy por motivo.
 *
 * `retryable` NO se decide aquí: lo decide el servidor y esta capa lo respeta
 * (ver `mapPersistenceNotReady`). Los valores de esta tabla son el respaldo para
 * cuando el resultado no lo trae, y coinciden con la regla del servidor —
 * columna ausente no se arregla reintentando; una sonda caída sí puede
 * recuperarse sola.
 */
export const PERSISTENCE_NOT_READY_REASON_MESSAGES: Readonly<
  Record<'identity_key_missing' | 'probe_failed', ExecutionErrorPresentation>
> = {
  identity_key_missing: {
    message: `${PERSISTENCE_NOT_READY_LEAD} ${PERSISTENCE_NOT_READY_NO_SPEND}`,
    retryable: false,
  },
  probe_failed: {
    message: `${PERSISTENCE_PROBE_FAILED_LEAD} ${PERSISTENCE_NOT_READY_NO_SPEND}`,
    retryable: true,
  },
};

/**
 * Tabla exhaustiva por tipo: `Record<WizardExecutionFailureCode, …>` obliga a que
 * un código nuevo en el servidor no compile hasta tener copy propio. Es el
 * candado que faltaba — `PERSISTENCE_NOT_READY` existía en el backend y caía al
 * mensaje genérico sin que nada se quejara.
 */
export const EXECUTION_ERROR_MESSAGES: Readonly<
  Record<WizardExecutionFailureCode, ExecutionErrorPresentation>
> = {
  EXECUTION_DISABLED:              { message: 'La generación con IA no está habilitada en este momento.',                           retryable: false },
  UNAUTHENTICATED:                 { message: 'Tu sesión expiró. Vuelve a iniciar sesión para continuar.',                          retryable: false },
  INACTIVE_USER:                   { message: 'Tu usuario no está activo para generar prospectos.',                                 retryable: false },
  IDEMPOTENCY_CONFLICT:            { message: 'Esta búsqueda ya se había enviado. Revisa los prospectos antes de generar otra.',   retryable: false },
  PILOT_PAUSED:                    { message: 'La generación de prospectos está pausada temporalmente.',                            retryable: false },
  NOT_IN_PILOT:                    { message: 'Esta función todavía está disponible solo para el grupo piloto.',                    retryable: false },
  BUDGET_PERIOD_NOT_CONFIGURED:    { message: 'El presupuesto del piloto para este mes todavía no está configurado.',              retryable: false },
  BUDGET_PERIOD_CLOSED:            { message: 'El período presupuestal del piloto está cerrado.',                                  retryable: false },
  EXECUTION_CREDIT_LIMIT_EXCEEDED: { message: 'Esta búsqueda supera el máximo permitido por corrida.',                            retryable: false },
  BUDGET_EXCEEDED:                 { message: 'El presupuesto disponible para generación de prospectos se agotó.',                 retryable: false },
  CONCURRENT_EXECUTION_ACTIVE:     { message: 'Ya tienes una generación en curso. Espera a que termine antes de iniciar otra.',   retryable: false },
  BUDGET_RESERVATION_FAILED:       { message: 'No fue posible reservar el presupuesto para esta búsqueda.',                       retryable: true  },
  PROVIDER_UNAVAILABLE:            { message: 'El servicio de búsqueda no está disponible temporalmente.',                        retryable: true  },
  CATALOG_CHANGED:                 { message: 'La configuración del catálogo cambió. Revisa nuevamente la búsqueda.',             retryable: false },
  INVALID_REQUEST:                 { message: 'Revisa la información seleccionada antes de continuar.',                            retryable: false },
  GENERATION_FAILED:               { message: 'No fue posible completar la generación de prospectos.',                            retryable: true  },
  PERSISTENCE_NOT_READY:           { message: PERSISTENCE_NOT_READY_BASE_MESSAGE,                                                  retryable: false },
};

const FALLBACK: ExecutionErrorPresentation = {
  message: 'No fue posible completar la generación de prospectos.',
  retryable: false,
};

export function mapExecutionError(code: string): ExecutionErrorPresentation {
  // El índice se ensancha a propósito: el parámetro sigue siendo `string` para no
  // romper a los llamadores, y un código desconocido conserva el fallback.
  const table: Readonly<Record<string, ExecutionErrorPresentation | undefined>> =
    EXECUTION_ERROR_MESSAGES;
  return table[code] ?? FALLBACK;
}

/**
 * A1-APOLLO-PERSISTENCE-READINESS-4-FIX § 1 y § 2 — mensaje de un preflight de
 * persistencia bloqueado, resuelto desde el resultado ESTRUCTURADO.
 *
 * No basta con una entrada en la tabla: la tabla es estática y descarta
 * `persistenceNotReady.reason`, que es justo la diferencia que el operador
 * necesita (aplicar la migración vs. mirar la conexión). Y `retryable` viene del
 * servidor: es él quien sabe si el motivo puede recuperarse solo, y machacarlo
 * con un literal del cliente es cómo se pierde esa semántica.
 */
export function mapPersistenceNotReady(
  detail: { reason: 'identity_key_missing' | 'probe_failed' } | undefined,
  serverRetryable?: boolean,
): ExecutionErrorPresentation {
  const base = detail
    ? PERSISTENCE_NOT_READY_REASON_MESSAGES[detail.reason]
    : EXECUTION_ERROR_MESSAGES.PERSISTENCE_NOT_READY;
  return {
    message: base.message,
    retryable: serverRetryable ?? base.retryable,
  };
}

/**
 * A1-APOLLO-WIZARD-1 — mensaje de un proveedor omitido / no disponible.
 *
 * Sin motivo se cae al mensaje genérico de PROVIDER_UNAVAILABLE, así que el
 * comportamiento previo no cambia para quien no pase `skipReason`.
 */
export function mapProviderSkip(
  skipReason: WizardApolloSkipReason | undefined,
): ExecutionErrorPresentation {
  if (!skipReason) return mapExecutionError('PROVIDER_UNAVAILABLE');
  const presentation = presentProviderSkip(skipReason);
  return { message: presentation.detail, retryable: presentation.canRetry };
}

// ── Copy de presupuesto agotado vs. insuficiente (AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1) ─
//
// El mensaje genérico de `BUDGET_EXCEEDED` («se agotó») es correcto sólo cuando
// no queda NADA. Con presupuesto disponible > 0 pero por debajo de lo que esta
// corrida necesita —el caso real de producción con available=5, required=25—
// "se agotó" es falso: sugiere esperar al siguiente período cuando lo que
// realmente bloquea es el tamaño de ESTA corrida.

export const BUDGET_EXHAUSTED_MESSAGE = EXECUTION_ERROR_MESSAGES.BUDGET_EXCEEDED.message;
export const BUDGET_INSUFFICIENT_FOR_RUN_MESSAGE =
  'El presupuesto disponible no alcanza para esta corrida.';

function formatCredits(count: number): string {
  return `${count} ${count === 1 ? 'crédito' : 'créditos'}`;
}

/**
 * AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1 — mensaje de un `BUDGET_EXCEEDED`,
 * resuelto desde el detalle ESTRUCTURADO que el servidor adjunta cuando pudo
 * leer el período (de sólo lectura, best-effort).
 *
 * Sin detalle se cae al mensaje genérico exhausted-style de siempre: la
 * distinción exhausted/insufficient nunca inventa un número que el servidor no
 * confirmó.
 */
export function mapBudgetExceeded(
  detail:
    | { reason: 'exhausted' | 'insufficient_for_run'; availableCredits: number; requiredCredits: number }
    | undefined,
): ExecutionErrorPresentation {
  if (!detail) return mapExecutionError('BUDGET_EXCEEDED');
  const lead =
    detail.reason === 'exhausted' ? BUDGET_EXHAUSTED_MESSAGE : BUDGET_INSUFFICIENT_FOR_RUN_MESSAGE;
  const counts = `Disponibles: ${formatCredits(detail.availableCredits)}. Requeridos: ${formatCredits(detail.requiredCredits)}.`;
  return { message: `${lead} ${counts}`, retryable: false };
}
