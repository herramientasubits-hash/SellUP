'use client';

import type { AdminProviderBudgetRow } from '@/modules/budgets';
import type { BudgetOnExceed } from '@/modules/usage-tracking/types';

interface Props {
  providers: AdminProviderBudgetRow[];
  resolvedAt: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatAmount(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

function computeStatus(row: AdminProviderBudgetRow): 'no_rule' | 'ok' | 'warning' | 'exceeded' {
  if (row.activeRules === 0) return 'no_rule';
  const overCredits = row.remainingCredits != null && row.remainingCredits <= 0;
  const overUsd = row.remainingUsd != null && row.remainingUsd <= 0;
  if (overCredits || overUsd) return 'exceeded';
  const warnCredits = row.remainingCredits != null && row.globalLimitCredits != null
    && row.remainingCredits < row.globalLimitCredits * 0.2;
  const warnUsd = row.remainingUsd != null && row.globalLimitUsd != null
    && row.remainingUsd < row.globalLimitUsd * 0.2;
  if (warnCredits || warnUsd) return 'warning';
  return 'ok';
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  no_rule: { label: 'Sin regla', className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  ok:      { label: 'OK',        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' },
  warning: { label: 'Advertencia', className: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  exceeded:{ label: 'Excedido',  className: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

const ACTION_LABEL: Record<BudgetOnExceed | 'none', string> = {
  alert:            'Alertar',
  block:            'Bloquear',
  require_approval: 'Requiere aprobación',
  none:             'No configurado',
};

// ── component ─────────────────────────────────────────────────────────────────

export function BudgetProvidersTable({ providers, resolvedAt }: Props) {
  const resolvedDate = new Date(resolvedAt).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Aún no hay reglas de presupuesto configuradas. Este panel ya puede mostrar consumo registrado por proveedor.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/20">
              {['Proveedor', 'Reglas activas', 'Consumido', 'Límite global', 'Disponible', 'Estado', 'Acción configurada'].map(
                (col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-medium text-muted-foreground"
                  >
                    {col}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {providers.map((row) => {
              const status = computeStatus(row);
              const badge = STATUS_BADGE[status];
              const actionKey: BudgetOnExceed | 'none' = (row.onExceed as BudgetOnExceed) ?? 'none';
              const consumed = formatAmount(row.consumedCredits, row.consumedUsd);
              const limit = formatAmount(row.globalLimitCredits, row.globalLimitUsd);
              const available = formatAmount(row.remainingCredits, row.remainingUsd);

              return (
                <tr key={row.providerKey} className="hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-medium text-foreground">
                        {row.displayName ?? row.providerKey}
                      </span>
                      <span className="ml-2 text-[10px] text-muted-foreground/60">{row.providerKey}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.activeRules > 0 ? row.activeRules : '—'}
                  </td>
                  <td className="px-4 py-3 text-foreground">{consumed}</td>
                  <td className="px-4 py-3 text-foreground">{limit}</td>
                  <td className="px-4 py-3 text-foreground">{available}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {ACTION_LABEL[actionKey]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="px-1 text-[11px] text-muted-foreground/50">
        Datos del período mensual actual · Actualizado {resolvedDate}
      </p>
    </div>
  );
}
