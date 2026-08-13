/**
 * wizard-budget-preflight.server.ts — única frontera de I/O del bloqueo previo
 * de presupuesto.
 *
 * AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1.
 *
 * Lee el período vigente y resuelve el coste del peor caso de cada proveedor
 * seleccionable. La comparación —y la decisión de bloquear— vive en el núcleo
 * puro (`wizard-budget-preflight.ts`).
 *
 * 🔒 `wizard_monthly_budget_periods` tiene RLS con una ÚNICA policy, para
 * `service_role`. Un cliente de sesión (`authenticated`) no lee cero filas por
 * error: lee cero filas SIEMPRE, y eso se confundiría con «no hay período» —
 * es decir, con «no bloquear». Por eso esta lectura usa el mismo cliente
 * service_role que ya usa la reserva.
 *
 * De sólo lectura: no reserva, no escribe, no llama a ningún proveedor. Nunca
 * autoriza una corrida; sólo puede explicar un rechazo que la reserva atómica
 * emitiría igual.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { readWizardBudgetPeriodSnapshot } from './wizard-budget-reservations';
import type { BudgetPeriodLookupClient } from './wizard-budget-reservations';
import { getPilotBudgetPeriodStart } from './wizard-budget-reconciliation';
import { estimateCreditsForProvider } from './wizard-budget-estimate';
import { WIZARD_RUN_SELECTABLE_PROVIDERS } from './wizard-run-provider-capability';
import type { WizardRunSelectableProvider } from './wizard-run-provider-capability';
import type { WizardBudgetPreflight } from './wizard-budget-preflight';

/**
 * Zona horaria del período de presupuesto del piloto. Compartida con la
 * ejecución: dos husos distintos resolverían dos períodos distintos y la UI
 * avisaría sobre una fila que la reserva no mira.
 */
export const WIZARD_BUDGET_TIMEZONE = 'America/Bogota';

/**
 * Cliente service_role para las operaciones de presupuesto.
 *
 * Las RPC (`try_reserve_wizard_credits`, …) y `wizard_budget_reservations`
 * están REVOKE'd para `authenticated`, y `wizard_monthly_budget_periods` sólo
 * tiene policy de `service_role`: el cliente de sesión (publishable key) no
 * puede con ninguna de las tres.
 */
export function createWizardBudgetServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase service_role credentials required for wizard budget operations');
  }
  return createAdminClient(url, key);
}

/**
 * Instantánea de presupuesto para la superficie del wizard.
 *
 * `null` cuando no se pudo resolver (credenciales ausentes, período sin fila,
 * error de lectura). El llamador NO bloquea en ese caso: la RPC sigue siendo la
 * autoridad, y un fallo de diagnóstico no puede convertirse en un bloqueo
 * universal.
 *
 * Los dos costes salen de `estimateCreditsForProvider`, la misma función cuyo
 * resultado se reserva en la ejecución. No hay una segunda fórmula: si el techo
 * de Apollo cambia, el aviso cambia con él.
 */
export async function resolveWizardBudgetPreflightForSurface(): Promise<WizardBudgetPreflight | null> {
  try {
    const db = createWizardBudgetServiceClient();
    const snapshot = await readWizardBudgetPeriodSnapshot(
      getPilotBudgetPeriodStart(WIZARD_BUDGET_TIMEZONE),
      db as unknown as BudgetPeriodLookupClient,
    );
    if (!snapshot) return null;

    const requiredCreditsByProvider = Object.fromEntries(
      WIZARD_RUN_SELECTABLE_PROVIDERS.map((provider) => [
        provider,
        estimateCreditsForProvider(provider),
      ]),
    ) as Record<WizardRunSelectableProvider, number>;

    return { availableCredits: snapshot.availableCredits, requiredCreditsByProvider };
  } catch {
    // Mismo criterio que el resto de la superficie: un diagnóstico que falla
    // desaparece, no bloquea ni inventa un número.
    return null;
  }
}
