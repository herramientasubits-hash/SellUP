import { formatInAppZone } from '@/lib/format-date';
import type { BudgetOnExceed, BudgetPeriodType, BudgetScopeType } from '@/modules/usage-tracking/types';

export const PERIOD_LABELS: Record<BudgetPeriodType, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  annual: 'Anual',
  custom: 'Personalizado',
};

export const ON_EXCEED_LABELS: Record<BudgetOnExceed, string> = {
  alert: 'Alertar',
  block: 'Bloquear',
  require_approval: 'Requiere aprobación',
};

export const SCOPE_LABELS: Record<BudgetScopeType, string> = {
  global: 'Global',
  role: 'Rol',
  group: 'Grupo',
  user: 'Usuario',
};

export function formatLimit(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) {
    parts.push(`${credits.toLocaleString('es-CO')} ${credits === 1 ? 'crédito' : 'créditos'}`);
  }
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)} USD`);
  return parts.join(' · ') || '—';
}

export function formatRuleDate(iso: string): string {
  return formatInAppZone(iso, { dateStyle: 'short' }, 'es-CO');
}
