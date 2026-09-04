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
// AGENT1-LUSHA-BUDGET-GATE-1 § 5/§ 6 — el techo de Lusha sale de la MISMA función
// cuyo resultado reserva la acción de Lusha. Se resuelve aparte de
// `estimateCreditsForProvider` porque Lusha no pertenece a la unión de
// proveedores elegibles (ver la nota de `WizardBudgetPreflight`).
import {
  estimateLushaRunCredits,
  resolveLushaRequiredCreditsByMacroIndustry,
} from '@/server/prospect-batches/lusha-run-liability';

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
 * Los costes de Apollo/Tavily salen de `estimateCreditsForProvider` y el de
 * Lusha de `estimateLushaRunCredits`: en los tres casos, la misma función cuyo
 * resultado se reserva en la ejecución. No hay una segunda fórmula — si el techo
 * de un proveedor cambia, el aviso cambia con él.
 */
export async function resolveWizardBudgetPreflightForSurface(): Promise<WizardBudgetPreflight | null> {
  try {
    const db = createWizardBudgetServiceClient();
    const snapshot = await readWizardBudgetPeriodSnapshot(
      getPilotBudgetPeriodStart(WIZARD_BUDGET_TIMEZONE),
      db as unknown as BudgetPeriodLookupClient,
    );
    if (!snapshot) return null;

    // AGENT1-WIZARD-BUDGET-UI-APOLLO-DECOUPLE-1 — sólo los proveedores que este
    // pool realmente financia. Apollo es seleccionable
    // (`WIZARD_RUN_SELECTABLE_PROVIDERS` sigue intacto: eso decide qué puede
    // ELEGIR un admin, no quién paga), pero desde
    // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 (#386) reserva su propia cuota de
    // Providers & Consumption, no `wizard_monthly_budget_periods`. Publicar aquí
    // un coste de Apollo comparado contra `snapshot.availableCredits` —el saldo de
    // ESE pool— generaría un aviso previo falso. Tavily sigue financiado por este
    // pool sin cambios.
    const wizardBudgetFundedProviders = WIZARD_RUN_SELECTABLE_PROVIDERS.filter(
      (provider) => provider !== 'apollo_organizations',
    );

    const requiredCreditsByProvider = Object.fromEntries(
      wizardBudgetFundedProviders.map((provider) => [
        provider,
        estimateCreditsForProvider(provider),
      ]),
    ) as Partial<Record<WizardRunSelectableProvider, number>>;

    // Un techo de Lusha no resoluble no puede bloquear ni inventar un número: se
    // publica `null` y la reserva atómica sigue siendo la autoridad.
    let lushaRequiredCredits: number | null = null;
    try {
      lushaRequiredCredits = estimateLushaRunCredits();
    } catch {
      lushaRequiredCredits = null;
    }

    // ── AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 § 12 ──
    //
    // El techo de Lusha no es uno solo: depende de cuántas RAMAS ejecute el plan de
    // la macro industria elegida (2 · 4 · 6). La selección ocurre en el cliente
    // después de renderizar, así que el servidor publica el número de cada macro
    // ROUTABLE y el cliente elige la fila que corresponde.
    //
    // Por qué un mapa resuelto en el servidor y no una cuenta en el cliente: la
    // función autoritativa (`estimateLushaRunCredits`) vive en el módulo de
    // responsabilidad del servidor, y arrastrarla al bundle del navegador para
    // reproducir la cuenta abriría la puerta a que las dos versiones divergieran.
    // Es la MISMA función que la reserva usa, llamada con el MISMO plan.
    //
    // Macro industrias, no sectores: la clave es la misma que la ruta transporta,
    // así que el aviso previo y la reserva se indexan por el mismo vocabulario.
    let lushaRequiredCreditsByMacroIndustry: Record<string, number> | null = null;
    try {
      lushaRequiredCreditsByMacroIndustry = resolveLushaRequiredCreditsByMacroIndustry();
    } catch {
      lushaRequiredCreditsByMacroIndustry = null;
    }

    return {
      availableCredits: snapshot.availableCredits,
      requiredCreditsByProvider,
      lushaRequiredCredits,
      lushaRequiredCreditsByMacroIndustry,
    };
  } catch {
    // Mismo criterio que el resto de la superficie: un diagnóstico que falla
    // desaparece, no bloquea ni inventa un número.
    return null;
  }
}
