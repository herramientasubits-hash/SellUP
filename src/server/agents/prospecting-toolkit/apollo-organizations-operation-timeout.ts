/**
 * apollo-organizations-operation-timeout.ts — tope de tiempo para UNA llamada de
 * red a Apollo (búsqueda de una página o enrichment).
 *
 * WS6 · F (timeouts) — hasta este corte ni `searchApolloOrganizationsPage` ni
 * `enrichApolloOrganization` tenían tope propio: una respuesta colgada se comía
 * el presupuesto de la invocación entera (300 s) y la corrida moría sin dejar
 * desenlace. `apollo-client.ts` es compartido con el Agente 2 y no expone el
 * `signal` de `fetch` en esas dos funciones, así que el tope se aplica AQUÍ, por
 * carrera: pasado el plazo, el llamador deja de esperar.
 *
 * 🔴 Un tope vencido es un cobro INDETERMINADO, nunca «no cobrado»: la petición
 * ya salió y Apollo pudo procesarla. Por eso el error que se lanza se llama
 * `TimeoutError` —el mismo nombre que produce `AbortSignal.timeout`—, que la
 * clasificación ya trata como `timedOut` + `requestSent` ⇒ `billingState:
 * 'unknown'`, sin reintento.
 *
 * Puro salvo el temporizador, que se limpia siempre.
 */

/** Tope por defecto de una petición de página de Organization Search. */
export const APOLLO_PAGE_REQUEST_TIMEOUT_MS = 30_000;

/** Tope mínimo: con menos tiempo que esto no tiene sentido esperar nada. */
export const APOLLO_OPERATION_MIN_TIMEOUT_MS = 1_000;

/** Error de tope vencido. `name === 'TimeoutError'` a propósito (ver arriba). */
export class ApolloOperationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`apollo_operation_timeout_after_${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/** Normaliza el tope: finito, entero y nunca por debajo del mínimo. */
export function resolveApolloOperationTimeoutMs(preferredMs: number | null | undefined): number {
  if (typeof preferredMs !== 'number' || !Number.isFinite(preferredMs)) {
    return APOLLO_PAGE_REQUEST_TIMEOUT_MS;
  }
  return Math.max(APOLLO_OPERATION_MIN_TIMEOUT_MS, Math.trunc(preferredMs));
}

/**
 * Espera `operation` como mucho `timeoutMs`. Vencido el plazo, rechaza con
 * `ApolloOperationTimeoutError`. La operación original no se cancela (el cliente
 * compartido no lo permite); su resultado tardío se ignora.
 */
export async function raceApolloOperationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const ms = resolveApolloOperationTimeoutMs(timeoutMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ApolloOperationTimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    // Un rechazo tardío de la operación original no debe quedar sin manejar.
    operation.catch(() => undefined);
  }
}
