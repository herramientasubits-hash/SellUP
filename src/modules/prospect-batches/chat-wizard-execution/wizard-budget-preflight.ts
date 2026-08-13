/**
 * wizard-budget-preflight.ts — bloqueo de presupuesto ANTES del primer clic.
 *
 * AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1.
 *
 * Módulo PURO: sin env, sin I/O, sin DOM. La lectura del período vive en
 * `wizard-budget-preflight.server.ts`; aquí sólo se compara lo que esa lectura
 * devolvió con lo que la corrida necesita.
 *
 * Por qué existe: AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1 sí distingue «se agotó» de
 * «no alcanza para esta corrida», pero SÓLO sobre el detalle que el servidor
 * adjunta a un `BUDGET_EXCEEDED` — es decir, después de una ejecución fallida.
 * Con `available = 5` y `required = 25` la pantalla se ofrecía intacta hasta que
 * la usuaria gastaba un clic en descubrir el bloqueo. El aviso tiene que existir
 * ANTES, no como premio por fallar.
 *
 * Dos reglas gobiernan este módulo:
 *
 *   1. La reserva atómica (`try_reserve_wizard_credits`) sigue siendo la ÚNICA
 *      autoridad que decide si una corrida puede gastar. Esto no reserva, no
 *      bloquea nada en la base y no puede DESBLOQUEAR nada: sólo evita ofrecer
 *      un botón cuyo rechazo ya se conoce.
 *   2. Sin snapshot no hay bloqueo. Una lectura fallida deja la pantalla
 *      exactamente como estaba y el rechazo lo sigue emitiendo la RPC. Convertir
 *      «no pude leer» en «no puedes ejecutar» dejaría a todo el mundo bloqueado
 *      por un error de lectura.
 */

import type { WizardRunSelectableProvider } from './wizard-run-provider-capability';

/**
 * Instantánea del período vigente + lo que cuesta el peor caso de cada
 * proveedor seleccionable, resuelto server-side por las MISMAS funciones que
 * calculan la reserva. Se publican los dos proveedores porque la elección por
 * corrida ocurre en el cliente después de renderizar: pedirle al servidor un
 * número por cada cambio de radio añadiría una ida y vuelta para reproducir una
 * cuenta que ya es determinista.
 */
export type WizardBudgetPreflight = {
  availableCredits: number;
  requiredCreditsByProvider: Record<WizardRunSelectableProvider, number>;
};

/**
 * Mismo contrato que el `budgetExceeded` REACTIVO del servidor
 * (`wizard-execution-types.ts`), a propósito: las dos rutas alimentan el mismo
 * redactor (`mapBudgetExceeded`), así que el aviso previo y el posterior no
 * pueden divergir en el texto ni en los números.
 */
export type WizardBudgetPreflightBlock = {
  reason: 'exhausted' | 'insufficient_for_run';
  availableCredits: number;
  requiredCredits: number;
};

/**
 * ¿Se sabe ya que esta corrida no cabe en el presupuesto?
 *
 * `null` = no bloquear. Cubre los tres casos en los que la UI no tiene derecho a
 * adelantarse: snapshot ausente, coste no resoluble para el proveedor elegido, y
 * presupuesto suficiente.
 *
 * La comparación es ESTRICTA (`available < required`): con 25 disponibles y 25
 * requeridos la corrida cabe exacta y debe ofrecerse, que es justo lo que la
 * reserva atómica aceptaría.
 */
export function resolveWizardPreExecutionBudgetBlock(
  preflight: WizardBudgetPreflight | null | undefined,
  provider: WizardRunSelectableProvider,
): WizardBudgetPreflightBlock | null {
  if (!preflight) return null;

  const requiredCredits = preflight.requiredCreditsByProvider[provider];
  // Un coste no resoluble (proveedor sin entrada, valor no finito o no positivo)
  // no puede sostener un bloqueo: sin número que enseñar el aviso mentiría.
  if (typeof requiredCredits !== 'number' || !Number.isFinite(requiredCredits)) return null;
  if (requiredCredits <= 0) return null;

  const { availableCredits } = preflight;
  if (!Number.isFinite(availableCredits)) return null;
  if (availableCredits >= requiredCredits) return null;

  return {
    // «Se agotó» sólo es cierto cuando no queda NADA. Con saldo positivo por
    // debajo del coste, lo que bloquea es el tamaño de ESTA corrida, no el fin
    // del período: la misma distinción que ya hace la ruta reactiva.
    reason: availableCredits <= 0 ? 'exhausted' : 'insufficient_for_run',
    availableCredits,
    requiredCredits,
  };
}
