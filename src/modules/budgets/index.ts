// Public API of the budgets module
export type {
  BudgetScopeApplied,
  BudgetCheckResult,
  MatchedRule,
  AdminBudgetSummary,
  AdminProviderBudgetRow,
  BudgetCheckLogEntry,
  UserBudgetContext,
  PeriodBounds,
  PeriodConsumption,
  QuotaSource,
} from './types';

export { getPeriodBounds, periodStartIso, periodEndIso } from './periods';
export { checkBudget, getAdminBudgetSummary, checkProviderQuotaAvailable } from './budget-resolution';
export type { ProviderQuotaAvailability } from './budget-resolution';
export { updateProviderAllowance } from './allowance-actions';
export type { UpdateProviderAllowanceResult } from './allowance-actions';
export { syncProviderQuota, useApiQuotaAsPrimary } from './quota-sync-actions';
export type { QuotaSyncResult, UseApiQuotaResult } from './quota-sync-actions';
export {
  parseBudgetCheck,
  OUTCOME_LABEL,
  SCOPE_LABEL,
  ON_EXCEED_LABEL,
} from './budget-check-parser';
export type { ParsedBudgetCheck, BudgetCheckOutcome } from './budget-check-parser';

// ─── Presupuesto del Wizard (Agente 1) — superficie administrativa ────────────
//
// AGENT1-WIZARD-BUDGET-ADMIN-F1B. Pozo INTERNO compartido por Apollo, Tavily y
// Lusha; no es la cuota contratada de ningún proveedor y no deriva de
// `tool_catalog.monthly_credits_allowance`.
export { getWizardBudgetAdminSnapshot } from './wizard-budget-period-queries';
export type {
  WizardBudgetAdminSnapshot,
  WizardBudgetPeriodRow,
  WizardBudgetChangeEntry,
  WizardBudgetActor,
  WizardRunWorstCaseCredits,
} from './wizard-budget-period-queries';
export {
  updateWizardBudgetPeriod,
  updateWizardMaxCreditsPerExecution,
} from './wizard-budget-period-actions';
export type { WizardBudgetMutationResult } from './wizard-budget-period-actions';
