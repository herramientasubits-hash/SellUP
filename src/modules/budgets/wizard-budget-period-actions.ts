'use server';

// ============================================================
// budgets — mutaciones administrativas del presupuesto del Wizard
// (AGENT1-WIZARD-BUDGET-ADMIN-F1B)
// ============================================================
//
// Hasta este hito el presupuesto que gobierna al Wizard sólo se podía cambiar
// con SQL manual sobre `wizard_monthly_budget_periods`. Estas dos acciones son
// la superficie que sustituye ese SQL — y sólo eso: no cambian la semántica del
// gate, no tocan las RPC de reserva y no pueden mover los contadores de gasto.
//
// ── ORDEN DE LAS BARRERAS (no es cosmético) ─────────────────────
//
//   1. `isCurrentUserAdmin()` — SIEMPRE primero, antes de resolver el cliente
//      service_role. `getAdminClient()` devuelve una llave que ignora RLS: si se
//      obtuviera antes de comprobar el rol, el único obstáculo entre un usuario
//      cualquiera y el presupuesto sería el orden de dos líneas.
//   2. El período lo deriva el SERVIDOR.
//   3. La validación de rango.
//   4. La RPC administrativa, que aplica valor + bitácora en una transacción.
//
// La acción NO confía en ninguna autorización enviada por el cliente: no recibe
// rol, ni id de usuario, ni período. Todo eso se vuelve a derivar aquí.
//
// ── LO QUE ESTAS ACCIONES NO PUEDEN HACER ───────────────────────
//
// No escriben `credits_consumed` ni `credits_reserved`. Ni siquiera nombran esas
// columnas: la única escritura pasa por `admin_set_wizard_budget_period`, cuya
// lista de columnas no las incluye. Son el registro de lo que ya se gastó, y las
// tres RPC de la 064/121 son sus únicas dueñas.
//
// No leen `tool_catalog`. La cuota contratada de Apollo no deriva, no calcula y
// no limita el presupuesto del Wizard: son cantidades distintas.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { isCurrentUserAdmin, getCurrentUser } from '@/modules/access/actions';
import { getAdminClient } from './queries';
import { getPilotBudgetPeriodStart } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-reconciliation';
import { WIZARD_BUDGET_TIMEZONE } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight.server';

export interface WizardBudgetMutationResult {
  success: boolean;
  /** Código devuelto por la RPC cuando la operación se aplicó o quedó sin efecto. */
  outcome?: 'created' | 'updated' | 'no_change';
  error?: string;
}

const SETTINGS_PROVIDERS_PATH = '/settings/providers';

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Cambia el presupuesto del período VIGENTE y, opcionalmente, lo cierra.
 *
 * `periodStart` NO es un parámetro. El navegador no puede elegir qué mes
 * administra: se deriva con `getPilotBudgetPeriodStart(WIZARD_BUDGET_TIMEZONE)`,
 * exactamente la misma función y la misma zona horaria que usa la reserva. Un
 * período enviado por el cliente permitiría configurar un mes que la reserva no
 * mira —el presupuesto se vería cambiado y el wizard seguiría bloqueado— o
 * reescribir un mes ya cerrado.
 *
 * Admin-only.
 */
export async function updateWizardBudgetPeriod(
  budgetCredits: number,
  isClosed: boolean,
): Promise<WizardBudgetMutationResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  // Cerrar el período es `is_closed`, no un presupuesto de 0. Aceptar 0 daría
  // dos maneras de decir lo mismo, y una de ellas deja el período abierto con un
  // pozo vacío: el wizard respondería `insufficient_budget` en vez de
  // `period_closed`, que es un diagnóstico distinto.
  if (!isPositiveInteger(budgetCredits)) {
    return {
      success: false,
      error:
        'El presupuesto debe ser un entero mayor que 0. Para detener el gasto del mes, cierra el período.',
    };
  }

  const currentUser = await getCurrentUser();
  const periodStart = getPilotBudgetPeriodStart(WIZARD_BUDGET_TIMEZONE);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc('admin_set_wizard_budget_period', {
    p_period_start: periodStart,
    p_budget_credits: budgetCredits,
    p_is_closed: isClosed,
    p_changed_by: currentUser?.id ?? null,
  });

  if (error) {
    return { success: false, error: `Error al guardar el presupuesto: ${error.message}` };
  }

  const outcome = data as string | null;
  if (outcome === 'invalid_budget_credits') {
    return { success: false, error: 'El presupuesto debe ser un entero mayor que 0.' };
  }
  if (outcome !== 'created' && outcome !== 'updated' && outcome !== 'no_change') {
    return { success: false, error: `Resultado inesperado al guardar: ${outcome ?? 'desconocido'}` };
  }

  revalidatePath(SETTINGS_PROVIDERS_PATH, 'layout');
  return { success: true, outcome };
}

/**
 * Cambia el techo de créditos por ejecución del Wizard.
 *
 * UPDATE, nunca UPSERT: `wizard_pilot_settings` es un singleton con un trigger
 * que rechaza la segunda fila. Un INSERT aquí no crearía una configuración
 * alternativa, lanzaría una excepción.
 *
 * Este techo es GLOBAL del Wizard: se compara contra el coste estimado de la
 * corrida sea cual sea el proveedor (Apollo, Tavily o Lusha). No es un límite
 * de Apollo.
 *
 * Admin-only.
 */
export async function updateWizardMaxCreditsPerExecution(
  maxCreditsPerExecution: number,
): Promise<WizardBudgetMutationResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  if (!isPositiveInteger(maxCreditsPerExecution)) {
    return {
      success: false,
      error: 'El máximo de créditos por ejecución debe ser un entero mayor que 0.',
    };
  }

  const currentUser = await getCurrentUser();
  const periodStart = getPilotBudgetPeriodStart(WIZARD_BUDGET_TIMEZONE);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc('admin_set_wizard_max_credits_per_execution', {
    p_period_start: periodStart,
    p_max_credits: maxCreditsPerExecution,
    p_changed_by: currentUser?.id ?? null,
  });

  if (error) {
    return { success: false, error: `Error al guardar el límite: ${error.message}` };
  }

  const outcome = data as string | null;
  if (outcome === 'invalid_max_credits') {
    return {
      success: false,
      error: 'El máximo de créditos por ejecución debe ser un entero mayor que 0.',
    };
  }
  if (outcome === 'settings_not_found') {
    return {
      success: false,
      error: 'No existe la configuración del piloto del Wizard (wizard_pilot_settings).',
    };
  }
  if (outcome !== 'updated' && outcome !== 'no_change') {
    return { success: false, error: `Resultado inesperado al guardar: ${outcome ?? 'desconocido'}` };
  }

  revalidatePath(SETTINGS_PROVIDERS_PATH, 'layout');
  return { success: true, outcome };
}
