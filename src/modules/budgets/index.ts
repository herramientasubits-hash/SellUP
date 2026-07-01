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
} from './types';

export { getPeriodBounds, periodStartIso, periodEndIso } from './periods';
export { checkBudget, getAdminBudgetSummary } from './budget-resolution';
export { updateProviderAllowance } from './allowance-actions';
export type { UpdateProviderAllowanceResult } from './allowance-actions';
export {
  parseBudgetCheck,
  OUTCOME_LABEL,
  SCOPE_LABEL,
  ON_EXCEED_LABEL,
} from './budget-check-parser';
export type { ParsedBudgetCheck, BudgetCheckOutcome } from './budget-check-parser';
