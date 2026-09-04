// ============================================================
// budgets — lectura administrativa del presupuesto del Wizard
// (AGENT1-WIZARD-BUDGET-ADMIN-F1B)
// ============================================================
//
// Server-only. No lleva 'use server': no es una server action y no puede
// invocarse desde el navegador. Sólo la llama la página de proveedores, que ya
// redirige a los no-admin antes de pedir nada.
//
// ── QUÉ ES ESTE PRESUPUESTO ─────────────────────────────────────
//
// `wizard_monthly_budget_periods` es el POZO INTERNO que autoriza el gasto del
// Wizard (Agente 1). Es provider-agnostic: Apollo, Tavily y Lusha descuentan del
// MISMO pozo. No es la cuota contratada de ningún proveedor.
//
// La cuota de Apollo (`tool_catalog.monthly_credits_allowance`) es otra cosa:
// cuántos créditos vendió Apollo. Este módulo NO la lee y NO la deriva. 500
// créditos de Apollo no son 500 créditos del Wizard — se miden distinto y los
// gobierna quien no es la misma persona. La página muestra las dos cifras una al
// lado de la otra, pero ninguna alimenta a la otra.
//
// ── DE SÓLO LECTURA ─────────────────────────────────────────────
//
// Nada aquí escribe. En particular no escribe `credits_consumed` ni
// `credits_reserved`: esos dos contadores son propiedad exclusiva de
// `try_reserve_wizard_credits` / `confirm_wizard_credits` /
// `release_wizard_credits`.

import { getAdminClient } from './queries';
import {
  readWizardBudgetPeriodSnapshot,
  type BudgetPeriodLookupClient,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-reservations';
import { getPilotBudgetPeriodStart } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-reconciliation';
import { WIZARD_BUDGET_TIMEZONE } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight.server';
import { estimateCreditsForProvider } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-estimate';
import { estimateLushaRunCredits } from '@/server/prospect-batches/lusha-run-liability';

// ─── Vocabulario ──────────────────────────────────────────────────────────────

export type WizardBudgetActor = {
  id: string;
  email: string | null;
  fullName: string | null;
};

export type WizardBudgetPeriodRow = {
  periodStart: string;
  budgetCredits: number;
  creditsConsumed: number;
  creditsReserved: number;
  /**
   * `budget_credits - credits_consumed - credits_reserved`.
   *
   * Sale de `readWizardBudgetPeriodSnapshot`, la MISMA función y la MISMA
   * fórmula que ya explica el bloqueo previo del wizard, que a su vez repite la
   * aritmética del paso 10 de `try_reserve_wizard_credits`. No hay una segunda
   * fórmula: si esta pantalla dijera un número distinto del que la reserva
   * compara, la pantalla estaría mintiendo.
   */
  availableCredits: number;
  isClosed: boolean;
  updatedAt: string | null;
  updatedBy: WizardBudgetActor | null;
};

export type WizardBudgetChangeEntry = {
  id: string;
  periodStart: string;
  changedAt: string;
  changedBy: WizardBudgetActor | null;
  previousBudgetCredits: number | null;
  newBudgetCredits: number | null;
  previousIsClosed: boolean | null;
  newIsClosed: boolean | null;
  previousMaxCreditsPerExecution: number | null;
  newMaxCreditsPerExecution: number | null;
};

/**
 * Coste del PEOR caso de una corrida por proveedor, en créditos del pozo.
 *
 * Los tres números salen de las MISMAS funciones que la reserva usa para pedir
 * créditos: `estimateCreditsForProvider` (Apollo/Tavily) y
 * `estimateLushaRunCredits` (Lusha). No hay constantes copiadas aquí — si el
 * techo de un proveedor cambia, esta pantalla cambia con él.
 *
 * `null` cuando el techo no se puede resolver (configuración incoherente): un
 * diagnóstico que falla desaparece, no inventa un número.
 */
export type WizardRunWorstCaseCredits = {
  apollo: number | null;
  tavily: number | null;
  lusha: number | null;
};

export type WizardBudgetAdminSnapshot = {
  /** Derivado en el SERVIDOR con `getPilotBudgetPeriodStart(WIZARD_BUDGET_TIMEZONE)`. */
  periodStart: string;
  timezone: string;
  /** `null` cuando el mes vigente todavía no tiene fila de presupuesto. */
  period: WizardBudgetPeriodRow | null;
  maxCreditsPerExecution: number | null;
  maxCreditsUpdatedAt: string | null;
  maxCreditsUpdatedBy: WizardBudgetActor | null;
  lastChange: WizardBudgetChangeEntry | null;
  worstCaseCreditsByProvider: WizardRunWorstCaseCredits;
  /** `true` cuando faltan credenciales service_role o la lectura falló. */
  unavailable: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof getAdminClient>;

async function resolveActors(
  admin: AdminClient,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, WizardBudgetActor>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return new Map();

  const { data, error } = await admin
    .from('internal_users')
    .select('id, email, full_name')
    .in('id', unique);

  if (error || !data) return new Map();

  return new Map(
    (data as { id: string; email: string | null; full_name: string | null }[]).map((row) => [
      row.id,
      { id: row.id, email: row.email ?? null, fullName: row.full_name ?? null },
    ]),
  );
}

function resolveWorstCaseCredits(): WizardRunWorstCaseCredits {
  const safely = (fn: () => number): number | null => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  return {
    apollo: safely(() => estimateCreditsForProvider('apollo_organizations')),
    tavily: safely(() => estimateCreditsForProvider('tavily')),
    lusha: safely(() => estimateLushaRunCredits()),
  };
}

const EMPTY_SNAPSHOT = (periodStart: string): WizardBudgetAdminSnapshot => ({
  periodStart,
  timezone: WIZARD_BUDGET_TIMEZONE,
  period: null,
  maxCreditsPerExecution: null,
  maxCreditsUpdatedAt: null,
  maxCreditsUpdatedBy: null,
  lastChange: null,
  worstCaseCreditsByProvider: resolveWorstCaseCredits(),
  unavailable: true,
});

// ─── Lectura ──────────────────────────────────────────────────────────────────

/**
 * Instantánea administrativa del presupuesto del Wizard para el período VIGENTE.
 *
 * El período no se recibe por parámetro en ningún caso: se deriva aquí con la
 * misma función y la misma zona horaria que usa la reserva. Dos husos distintos
 * resolverían dos períodos distintos y esta pantalla administraría una fila que
 * la reserva no mira.
 */
export async function getWizardBudgetAdminSnapshot(): Promise<WizardBudgetAdminSnapshot> {
  const periodStart = getPilotBudgetPeriodStart(WIZARD_BUDGET_TIMEZONE);

  let admin: AdminClient;
  try {
    admin = getAdminClient();
  } catch {
    return EMPTY_SNAPSHOT(periodStart);
  }

  const [snapshot, periodMeta, settings, lastChange] = await Promise.all([
    readWizardBudgetPeriodSnapshot(periodStart, admin as unknown as BudgetPeriodLookupClient),
    admin
      .from('wizard_monthly_budget_periods')
      .select('is_closed, updated_at, updated_by')
      .eq('period_start', periodStart)
      .maybeSingle(),
    admin
      .from('wizard_pilot_settings')
      .select('max_credits_per_execution, updated_at, updated_by')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from('wizard_budget_period_changes')
      .select(
        'id, period_start, changed_at, changed_by, previous_budget_credits, new_budget_credits, previous_is_closed, new_is_closed, previous_max_credits_per_execution, new_max_credits_per_execution',
      )
      .order('changed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const periodRow = (periodMeta.data ?? null) as
    | { is_closed: boolean; updated_at: string | null; updated_by: string | null }
    | null;
  const settingsRow = (settings.data ?? null) as
    | { max_credits_per_execution: number; updated_at: string | null; updated_by: string | null }
    | null;
  const changeRow = (lastChange.data ?? null) as
    | {
        id: string;
        period_start: string;
        changed_at: string;
        changed_by: string | null;
        previous_budget_credits: number | null;
        new_budget_credits: number | null;
        previous_is_closed: boolean | null;
        new_is_closed: boolean | null;
        previous_max_credits_per_execution: number | null;
        new_max_credits_per_execution: number | null;
      }
    | null;

  const actors = await resolveActors(admin, [
    periodRow?.updated_by,
    settingsRow?.updated_by,
    changeRow?.changed_by,
  ]);

  return {
    periodStart,
    timezone: WIZARD_BUDGET_TIMEZONE,
    period:
      snapshot === null
        ? null
        : {
            periodStart,
            budgetCredits: snapshot.budgetCredits,
            creditsConsumed: snapshot.creditsConsumed,
            creditsReserved: snapshot.creditsReserved,
            availableCredits: snapshot.availableCredits,
            isClosed: periodRow?.is_closed ?? false,
            updatedAt: periodRow?.updated_at ?? null,
            updatedBy: periodRow?.updated_by ? actors.get(periodRow.updated_by) ?? null : null,
          },
    maxCreditsPerExecution: settingsRow?.max_credits_per_execution ?? null,
    maxCreditsUpdatedAt: settingsRow?.updated_at ?? null,
    maxCreditsUpdatedBy: settingsRow?.updated_by ? actors.get(settingsRow.updated_by) ?? null : null,
    lastChange:
      changeRow === null
        ? null
        : {
            id: changeRow.id,
            periodStart: changeRow.period_start,
            changedAt: changeRow.changed_at,
            changedBy: changeRow.changed_by ? actors.get(changeRow.changed_by) ?? null : null,
            previousBudgetCredits: changeRow.previous_budget_credits,
            newBudgetCredits: changeRow.new_budget_credits,
            previousIsClosed: changeRow.previous_is_closed,
            newIsClosed: changeRow.new_is_closed,
            previousMaxCreditsPerExecution: changeRow.previous_max_credits_per_execution,
            newMaxCreditsPerExecution: changeRow.new_max_credits_per_execution,
          },
    worstCaseCreditsByProvider: resolveWorstCaseCredits(),
    unavailable: false,
  };
}
