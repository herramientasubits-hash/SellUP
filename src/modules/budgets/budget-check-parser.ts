// ============================================================
// budgets — safe parser for metadata.budget_check (Hito G)
// ============================================================
// Normalises the raw JSON stored in provider_usage_logs.metadata->budget_check
// into a typed, human-readable struct. Never throws — returns null on null input
// and fills missing fields with safe defaults.

import type { BudgetOnExceed, BudgetScopeApplied } from './types';

export type BudgetCheckOutcome =
  | 'allowed'
  | 'alerted'
  | 'would_block'
  | 'technical_error'
  | 'missing_user'
  | 'unknown';

export interface ParsedBudgetCheck {
  raw: Record<string, unknown>;
  mode: string;
  providerKey: string | null;
  operationKey: string | null;
  allowed: boolean;
  wouldBlockInEnforcement: boolean;
  scopeApplied: BudgetScopeApplied | 'unknown' | null;
  matchedRuleId: string | null;
  onExceed: BudgetOnExceed | null;
  reason: string | null;
  consumedCredits: number | null;
  projectedCredits: number | null;
  remainingCredits: number | null;
  technicalError: string | null;
  missingUser: boolean;
  /** Derived human-readable outcome label */
  outcome: BudgetCheckOutcome;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (isFinite(n)) return n;
  }
  return null;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  return fallback;
}

/**
 * Parses a raw metadata.budget_check value into a typed struct.
 * Returns null when the input is null/undefined.
 */
export function parseBudgetCheck(raw: unknown): ParsedBudgetCheck | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;

  const r = raw as Record<string, unknown>;

  const technicalError = str(r['technical_error']);
  const missingUser = r['missing_user'] === true;
  const allowed = bool(r['allowed'], true);
  const wouldBlock = bool(r['would_block_in_enforcement'], false);

  let outcome: BudgetCheckOutcome;
  if (technicalError) {
    outcome = 'technical_error';
  } else if (missingUser) {
    outcome = 'missing_user';
  } else if (!allowed || wouldBlock) {
    outcome = 'would_block';
  } else if (str(r['reason']) !== null) {
    outcome = 'alerted';
  } else {
    outcome = 'allowed';
  }

  const scopeRaw = str(r['scope_applied']);
  const validScopes: Array<BudgetScopeApplied | 'unknown'> = [
    'user', 'group', 'role', 'global', 'none', 'unknown',
  ];
  const scopeApplied: BudgetScopeApplied | 'unknown' | null =
    scopeRaw && validScopes.includes(scopeRaw as BudgetScopeApplied | 'unknown')
      ? (scopeRaw as BudgetScopeApplied | 'unknown')
      : scopeRaw
        ? 'unknown'
        : null;

  const onExceedRaw = str(r['on_exceed']);
  const validOnExceed: BudgetOnExceed[] = ['alert', 'block', 'require_approval'];
  const onExceed: BudgetOnExceed | null =
    onExceedRaw && validOnExceed.includes(onExceedRaw as BudgetOnExceed)
      ? (onExceedRaw as BudgetOnExceed)
      : null;

  return {
    raw: r,
    mode: str(r['mode']) ?? 'alert_only',
    providerKey: str(r['provider_key']),
    operationKey: str(r['operation_key']),
    allowed,
    wouldBlockInEnforcement: wouldBlock,
    scopeApplied,
    matchedRuleId: str(r['matched_rule_id']),
    onExceed,
    reason: str(r['reason']),
    consumedCredits: num(r['consumed_credits']),
    projectedCredits: num(r['projected_credits']),
    remainingCredits: num(r['remaining_credits']),
    technicalError,
    missingUser,
    outcome,
  };
}

// ── Human-readable labels ─────────────────────────────────────────────────────

export const OUTCOME_LABEL: Record<BudgetCheckOutcome, string> = {
  allowed:        'Permitido',
  alerted:        'Alertado',
  would_block:    'Habría bloqueado',
  technical_error:'Error técnico',
  missing_user:   'Sin usuario',
  unknown:        'Desconocido',
};

export const SCOPE_LABEL: Record<BudgetScopeApplied | 'unknown', string> = {
  user:    'Usuario',
  group:   'Grupo',
  role:    'Rol',
  global:  'Global',
  none:    'Ninguno',
  unknown: 'Desconocido',
};

export const ON_EXCEED_LABEL: Record<BudgetOnExceed | 'none', string> = {
  alert:            'Alertar',
  block:            'Bloquear',
  require_approval: 'Requiere aprobación',
  none:             'No configurado',
};
