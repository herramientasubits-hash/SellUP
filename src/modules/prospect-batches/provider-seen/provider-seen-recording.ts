/**
 * provider-seen-recording.ts — el MOMENTO exacto en el que nace la memoria, y
 * los cuatro momentos en los que no puede nacer.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 · ADDENDUM PROVIDER-SEEN § 4.
 *
 * ── El orden, dicho una sola vez ──────────────────────────────────────────────
 *
 *   respuesta VÁLIDA de un proveedor de pago
 *     → se recuerda lo que devolvió
 *       → recién entonces corre el filtrado de siempre
 *
 * Registrar ANTES del filtrado no es un detalle de implementación: es la razón de
 * ser del hito. Si la memoria se escribiera después de los filtros heredaría sus
 * criterios y volvería a olvidar exactamente lo que hay que recordar —lo
 * rechazado— que es el defecto de hoy (ver `provider-seen-identity`).
 *
 * ── 🔴 Las cuatro cosas que NUNCA generan memoria ────────────────────────────
 *
 *   1. `no_provider_call`            — no hubo petición. El caso de hueco cerrado
 *      gratis, donde el hito base ya garantiza que no se construye ni el cliente.
 *      Sin petición no hay nada visto: fabricar memoria aquí sería inventar que se
 *      pagó por mirar.
 *   2. `provider_response_invalid`   — hubo petición y falló antes de una respuesta
 *      válida (timeout, 4xx, 5xx, cuerpo ilegible). Lo que un error trae no son
 *      «cero empresas»: es ninguna información. 🔴 Distinguirlo importa porque
 *      Lusha responde `ok:true` con `phones:[]` para errores HTTP en la ruta de
 *      teléfono (#303) — derivar el desenlace del tamaño de una lista ya quemó
 *      antes a este repo, y aquí quemaría la memoria para siempre.
 *   3. `provider_not_paid_source`    — el origen no es un proveedor de pago:
 *      `co_siis`, `co_rues`, HubSpot, una importación. Su cobertura ya se conoce
 *      gratis y meterla aquí contaminaría la única pregunta que esta memoria
 *      responde: «¿por qué ya pagué?».
 *   4. `no_identifiable_results`     — la respuesta fue válida pero ninguna fila
 *      traía id ni dominio. Es un hecho, no un fallo, y se separa de las otras tres
 *      para que «respuesta vacía» y «respuesta ilegible» no se confundan.
 *
 * Un fixture o un mock no aparecen como código de bloqueo porque no llegan hasta
 * aquí: la memoria se escribe por una dependencia inyectada que en las pruebas es
 * un doble en memoria, y una prueba estática comprueba que el punto de llamada
 * está DESPUÉS de `search.ok` en el ejecutor real.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

import {
  collectProviderSeenObservations,
  isProviderSeenPaidProvider,
  type ProviderSeenCandidateInput,
  type ProviderSeenEntityType,
  type ProviderSeenObservation,
  type ProviderSeenProvider,
} from './provider-seen-identity';

export type ProviderSeenRecordingBlockReason =
  | 'no_provider_call'
  | 'provider_response_invalid'
  | 'provider_not_paid_source'
  | 'no_identifiable_results';

export type ProviderSeenRecordingPlan =
  | { record: false; reason: ProviderSeenRecordingBlockReason }
  | {
      record: true;
      observations: readonly ProviderSeenObservation[];
      /** Filas sin id NI dominio. Contadas, nunca inventadas. */
      unidentifiableCount: number;
      /** Filas repetidas dentro de la MISMA respuesta. */
      duplicateCount: number;
    };

export type ProviderSeenRecordingInput = {
  /** Clave del origen. Sólo un proveedor de PAGO puede generar memoria. */
  provider: string;
  /** ¿Se llegó a emitir la petición? */
  providerCallMade: boolean;
  /**
   * ¿La respuesta fue VÁLIDA? Es el `ok` del ejecutor, nunca `results.length > 0`.
   * Ver el punto 2 de la cabecera.
   */
  responseValid: boolean;
  results: readonly ProviderSeenCandidateInput[];
  entityType?: ProviderSeenEntityType;
};

/**
 * Decide si esta respuesta puede convertirse en memoria, y con qué identidades.
 *
 * El orden de las guardas es el de la causa REAL: sin llamada no hay respuesta
 * que validar, y sin respuesta válida no hay resultados que leer. Invertirlo
 * haría que un error de proveedor con cuerpo vacío se reportara como «sin
 * resultados identificables», que es una causa distinta.
 */
export function planProviderSeenRecording(
  input: ProviderSeenRecordingInput,
): ProviderSeenRecordingPlan {
  if (!isProviderSeenPaidProvider(input.provider)) {
    return { record: false, reason: 'provider_not_paid_source' };
  }
  if (!input.providerCallMade) {
    return { record: false, reason: 'no_provider_call' };
  }
  if (!input.responseValid) {
    return { record: false, reason: 'provider_response_invalid' };
  }

  const provider: ProviderSeenProvider = input.provider;
  const batch = collectProviderSeenObservations(
    provider,
    input.results,
    input.entityType ?? 'company',
  );

  if (batch.observations.length === 0) {
    return { record: false, reason: 'no_identifiable_results' };
  }

  return {
    record: true,
    observations: batch.observations,
    unidentifiableCount: batch.unidentifiableCount,
    duplicateCount: batch.duplicateCount,
  };
}
