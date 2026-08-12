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
  /**
   * A1-APOLLO-QA-CONTROL-SURFACE-1 § 10 — proveedor que el servidor resolvió para
   * ESTA corrida (`resolvedDiscoveryProvider`), devuelto por la acción de
   * ejecución.
   *
   * Existe porque `serverDiscoveryProvider` es el predeterminado GLOBAL, y con la
   * selección por corrida activa los dos pueden discrepar: el global sigue en
   * Tavily mientras esta corrida usa Apollo. Mostrar el global ahí sería nombrar
   * a un proveedor que no corrió.
   *
   * `null`/ausente = todavía no hubo resolución por corrida; se conserva el
   * comportamiento anterior. Nunca se deduce de la selección local del navegador:
   * si el usuario pidió Apollo y el servidor resolvió Tavily, aquí llega Tavily.
   */
  runResolvedProvider?: WizardDiscoveryProviderKey | null;
};

/**
 * Reduce las decisiones del backend a un estado de indicador.
 *
 * Precedencia:
 *   1. Un proveedor omitido por el backend gana: ya se sabe qué se intentó y que
 *      no se pudo. Conservar el nombre es lo que evita que el usuario crea que
 *      corrió otra cosa.
 *   2. El proveedor resuelto POR CORRIDA: es un hecho del servidor sobre esta
 *      ejecución concreta, así que manda sobre cualquier predeterminado global.
 *   3. Ruta Lusha honrada → Lusha.
 *   4. Cualquier otra ruta (incluida la de Lusha bloqueada) → lo que resolvió el
 *      servidor para el discovery de Agente 1.
 *
 * AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — la ruta `blocked_lusha_disabled` ya no
 * produce «no disponible». Antes lo hacía, y eso era falso: el proveedor que iba a
 * correr esa búsqueda —Tavily por defecto, Apollo si la corrida lo pide— estaba
 * perfectamente disponible. El indicador nombraba la indisponibilidad de un
 * proveedor OCULTO que el usuario nunca eligió y que no era el de la búsqueda.
 *
 * `unavailable` queda reservado para lo que de verdad lo es: un proveedor que el
 * backend intentó y omitió (`skippedProvider`).
 */
export function resolveWizardProviderIndicator(
  input: WizardProviderIndicatorInput,
): WizardProviderIndicator {
  if (input.skippedProvider !== null) {
    return { status: 'unavailable', provider: input.skippedProvider };
  }

  if (input.runResolvedProvider != null) {
    return { status: 'resolved', provider: input.runResolvedProvider };
  }

  if (input.lushaRoute === 'lusha') {
    return { status: 'resolved', provider: 'lusha' };
  }

  if (input.serverDiscoveryProvider === null) {
    return { status: 'unresolved', provider: null };
  }

  return { status: 'resolved', provider: input.serverDiscoveryProvider };
}
