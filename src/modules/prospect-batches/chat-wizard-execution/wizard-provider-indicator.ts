/**
 * A1-APOLLO-WIZARD-1 — ¿qué proveedor de búsqueda va a correr?
 *
 * Módulo PURO: sin env, sin I/O, sin DOM. Combina las decisiones que ya toma el
 * backend y las reduce a un único estado presentable.
 *
 * Fuente de verdad de cada entrada:
 *   - `serverDiscoveryProvider`: lo que devuelve `resolveWizardDiscoveryProvider()`
 *     en el servidor — exactamente la misma función que enruta la ejecución en
 *     `executeProspectWizardGeneration` (paso 5a). `null` = el servidor todavía
 *     no lo resolvió; nunca se adivina en el cliente.
 *   - `lushaRoute`: la decisión efectiva de Lusha (flag de servidor + criterios),
 *     la misma que gobierna qué acción se invoca en el paso final.
 *   - `skippedProvider`: proveedor que el backend omitió al ejecutar
 *     (`providerSkipped` de un resultado `PROVIDER_UNAVAILABLE`).
 *
 * Regla que gobierna este módulo: el indicador nombra al proveedor que
 * REALMENTE correría, no al que estaría disponible en teoría. Cuando no hay
 * resolución, lo dice; no inventa un default.
 */

import type { WizardDiscoveryProviderKey } from './wizard-provider-resolver';

/** Proveedores nombrables en el indicador del wizard moderno. */
export type WizardIndicatorProviderKey = WizardDiscoveryProviderKey | 'lusha';

/** Ruta efectiva de Lusha tal como la resuelve el bridge de criterios. */
export type WizardIndicatorLushaRoute =
  | 'lusha'
  | 'blocked_lusha_disabled'
  | 'default_ai';

export type WizardProviderIndicator =
  /** El servidor todavía no resolvió el proveedor. */
  | { status: 'unresolved'; provider: null }
  /** Proveedor resuelto: es el que correría la búsqueda. */
  | { status: 'resolved'; provider: WizardIndicatorProviderKey }
  /**
   * Resuelto pero no ejecutable ahora. `provider` se conserva cuando se sabe
   * cuál fue omitido; es `null` cuando la ruta quedó bloqueada sin haber
   * seleccionado proveedor (no se nombra un proveedor que nunca se eligió).
   */
  | { status: 'unavailable'; provider: WizardIndicatorProviderKey | null };

export type WizardProviderIndicatorInput = {
  serverDiscoveryProvider: WizardDiscoveryProviderKey | null;
  lushaRoute: WizardIndicatorLushaRoute | null;
  skippedProvider: WizardIndicatorProviderKey | null;
};

/**
 * Reduce las decisiones del backend a un estado de indicador.
 *
 * Precedencia:
 *   1. Un proveedor omitido por el backend gana: ya se sabe qué se intentó y que
 *      no se pudo. Conservar el nombre es lo que evita que el usuario crea que
 *      corrió otra cosa.
 *   2. Ruta Lusha honrada → Lusha.
 *   3. Ruta Lusha bloqueada → no disponible, sin nombre (no hubo selección).
 *   4. Ruta default_ai (o sin dato de ruta) → lo que resolvió el servidor.
 */
export function resolveWizardProviderIndicator(
  input: WizardProviderIndicatorInput,
): WizardProviderIndicator {
  if (input.skippedProvider !== null) {
    return { status: 'unavailable', provider: input.skippedProvider };
  }

  if (input.lushaRoute === 'lusha') {
    return { status: 'resolved', provider: 'lusha' };
  }

  if (input.lushaRoute === 'blocked_lusha_disabled') {
    return { status: 'unavailable', provider: null };
  }

  if (input.serverDiscoveryProvider === null) {
    return { status: 'unresolved', provider: null };
  }

  return { status: 'resolved', provider: input.serverDiscoveryProvider };
}
