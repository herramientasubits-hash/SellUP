/**
 * wizard-admin-tavily-trial.ts — prueba de Tavily por corrida, sólo para admins.
 *
 * AGENT1-TAVILY-TRIAL-1.
 *
 * Con el modo automático de proveedores encendido (Producción), el override por
 * corrida está apagado para todos (`isWizardRunProviderOverrideEffective`). Para
 * medir a Tavily sin tocar a los vendedores, la bandera
 * `ENABLE_AGENT1_ADMIN_TAVILY_TRIAL` abre UNA puerta estrecha:
 *
 *   · sólo un administrador (la autoridad se resuelve server-side, igual que el
 *     override de siempre);
 *   · sólo para pedir `tavily`: una petición de Apollo o Lusha se sigue
 *     ignorando, porque en modo automático el proveedor lo decide el sistema;
 *   · la corrida de prueba no activa la pierna de Lusha: la medición es de
 *     Tavily solo.
 *
 * Puro: sin env, sin I/O. Los booleanos llegan resueltos por el llamador.
 */

export type AdminTavilyTrialAvailabilityInput = {
  isAuthenticated: boolean;
  /** Rol admin CONFIRMADO por el servidor. */
  isAdmin: boolean;
  /** `isWizardRunTavilyTrialEffective()` resuelto server-side. */
  trialEffective: boolean;
};

/** ¿Ve este usuario la casilla «Probar esta corrida con Tavily»? */
export function resolveAdminTavilyTrialAvailable(input: AdminTavilyTrialAvailabilityInput): boolean {
  return input.isAuthenticated === true && input.isAdmin === true && input.trialEffective === true;
}

/**
 * La capacidad de override que se le pasa al resolvedor PARA ESTA PETICIÓN.
 *
 * El override normal manda tal cual. La prueba sólo lo habilita cuando lo pedido
 * es `tavily` Y quien lo pide es administrador.
 *
 * 🔴 Por qué se exige el admin aquí y no sólo en el resolvedor: con el override
 * habilitado, el resolvedor manda una petición NO autorizada a Tavily (su
 * degradación segura de siempre). Si la prueba habilitara el override sólo por
 * pedir `tavily`, cualquier vendedor que enviara ese campo a mano obtendría una
 * corrida de Tavily en vez de Apollo. Sin admin, el override queda apagado y la
 * petición se ignora: manda el modo automático.
 */
export function resolveRunOverrideEnabledForRequest(input: {
  overrideEffective: boolean;
  trialEffective: boolean;
  requestedProvider: unknown;
  isAdmin: boolean;
}): boolean {
  if (input.overrideEffective) return true;
  return input.trialEffective && input.isAdmin === true && input.requestedProvider === 'tavily';
}

/**
 * ¿Es ésta una corrida de prueba de Tavily? Sólo cuando la prueba está
 * efectiva, se pidió `tavily` y el servidor resolvió `tavily` (si la autoridad
 * no alcanzó, resolvió otro proveedor y la corrida es normal).
 */
export function isAdminTavilyTrialRequest(input: {
  trialEffective: boolean;
  requestedProvider: unknown;
  resolvedProvider: string;
}): boolean {
  return input.trialEffective && input.requestedProvider === 'tavily' && input.resolvedProvider === 'tavily';
}
